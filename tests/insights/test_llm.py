import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from autogen import AssistantAgent, LLMConfig

from api.services.insights import kernel, llm
from api.services.text_to_sql.providers import PROVIDERS


class ModelConfigTest(unittest.TestCase):
    @mock.patch.dict(os.environ, {'TEXT_TO_SQL_PROVIDER': 'claude',
                                 'TEXT_TO_SQL_CLAUDE_MODEL': 'claude-opus-5-5', 'ANTHROPIC_API_KEY': 'k'}, clear=True)
    def test_llm_config_follows_settings(self):
        entry = llm.llm_config(0.3).model_dump()['config_list'][0]
        self.assertEqual((entry['api_type'], entry['model'], entry['api_key']),
                         ('anthropic', 'claude-opus-5-5', 'k'))
        self.assertEqual(entry['temperature'], 0.3)
        self.assertIs(entry['stream'], False)
        self.assertIs(entry['parallel_tool_calls'], False)

    @mock.patch.dict(os.environ, {'TEXT_TO_SQL_PROVIDER': 'openai',
                                 'TEXT_TO_SQL_OPENAI_MODEL': 'gpt-5.4-mini', 'OPENAI_API_KEY': 'k'}, clear=True)
    def test_gpt5_mini_has_no_temperature(self):
        for model in ['gpt-5.4-mini', 'o3-mini']:
            with self.subTest(model=model), mock.patch.dict(os.environ, {'TEXT_TO_SQL_OPENAI_MODEL': model}):
                config = llm.llm_config(0.7).model_dump()
                self.assertNotIn('temperature', config['config_list'][0])
                self.assertNotIn('temperature', config)

    @mock.patch.dict(os.environ, {'TEXT_TO_SQL_PROVIDER': 'openai',
                                 'TEXT_TO_SQL_OPENAI_MODEL': 'gpt-4.1-mini', 'OPENAI_API_KEY': 'test'}, clear=True)
    def test_zero_temperature_survives_agent_copy_and_tool_registration(self):
        def calculate() -> str:
            return '1'

        with mock.patch('httpx.Client.send', side_effect=AssertionError('No network')):
            agent = AssistantAgent(name='Coder', llm_config=llm.llm_config(0.0), functions=[calculate])
        self.assertEqual([item.name for item in agent.tools], ['calculate'])
        self.assertEqual(agent.llm_config.model_dump()['config_list'][0].get('temperature'), 0.0)
        self.assertEqual(LLMConfig.ensure_config(agent.llm_config).model_dump()['config_list'][0].get('temperature'), 0.0)

    @mock.patch.dict(os.environ, {'TEXT_TO_SQL_PROVIDER': 'gemini',
                                 'TEXT_TO_SQL_GEMINI_MODEL': 'gemini-test', 'GOOGLE_API_KEY': 'alias'}, clear=True)
    def test_gemini_uses_google_api_type_and_key_alias(self):
        entry = llm.llm_config(0.6).model_dump()['config_list'][0]
        self.assertEqual((entry['api_type'], entry['model'], entry['api_key']), ('google', 'gemini-test', 'alias'))

    def test_temperature_support_matches_provider_and_model(self):
        for provider, model, expected in [('openai', 'gpt-5.4-mini', False), ('openai', 'o3-mini', False),
                                          ('openai', 'gpt-4.1', True), ('claude', 'o3-test', True),
                                          ('gemini', 'gpt-5-test', True)]:
            with self.subTest(provider=provider, model=model):
                self.assertIs(llm.takes_temperature(provider, model), expected)


class KernelTest(unittest.TestCase):
    def test_setup_cell_drops_keys_and_is_read_only(self):
        keys = {name: 'secret' for _, _, names in PROVIDERS.values() for name in names}
        env = {**keys, 'POSTGRES_HOST': 'localhost', 'POSTGRES_DATABASE': 'pantio',
               'POSTGRES_USER': 'reader', 'POSTGRES_PASSWORD': 'password'}
        namespace = {}
        with mock.patch.dict(os.environ, env), mock.patch('psycopg.connect') as connect:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.description = [SimpleNamespace(name='n')]
            cursor.fetchall.return_value = [(1,)]
            exec(kernel.SETUP_CELL, namespace)
            for name in keys:
                self.assertNotIn(name, os.environ)
            self.assertEqual(namespace['LAKE'], Path(__file__).resolve().parents[2] / 'lake')
            self.assertEqual(namespace['gold']('select 1').to_dict('records'), [{'n': 1}])
            connect.assert_called_once_with(host='localhost', dbname='pantio', user='reader', password='password',
                                            options='-c default_transaction_read_only=on')
            cursor.execute.assert_called_once_with('select 1')

    @mock.patch.dict(os.environ, {'OPENAI_API_KEY': 'parent-key'})
    def test_open_kernel_runs_setup_with_expected_timeout_and_preserves_parent_keys(self):
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(kernel, 'LocalJupyterServer') as server, \
             mock.patch.object(kernel, 'JupyterCodeExecutor') as executor:
            executor.return_value.execute_code_blocks.return_value = SimpleNamespace(exit_code=0, output='')
            workdir = Path(directory) / 'work'
            result = kernel.open_kernel(workdir)
            self.assertEqual(result, (server.return_value, executor.return_value))
            self.assertTrue(workdir.is_dir())
            server.assert_called_once_with(log_file=str(workdir / 'jupyter.log'))
            executor.assert_called_once_with(server.return_value, output_dir=workdir, timeout=1200)
            blocks = executor.return_value.execute_code_blocks.call_args.args[0]
            self.assertEqual([(b.language, b.code) for b in blocks], [('python', kernel.SETUP_CELL)])
            self.assertEqual(os.environ['OPENAI_API_KEY'], 'parent-key')

    def test_open_kernel_stops_server_on_executor_or_setup_failure(self):
        for failure in ('executor', 'setup_exception', 'setup_result'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory, \
                 mock.patch.object(kernel, 'LocalJupyterServer') as server, \
                 mock.patch.object(kernel, 'JupyterCodeExecutor') as executor:
                if failure == 'executor':
                    executor.side_effect = RuntimeError('executor failed')
                elif failure == 'setup_exception':
                    executor.return_value.execute_code_blocks.side_effect = RuntimeError('setup failed')
                else:
                    executor.return_value.execute_code_blocks.return_value = SimpleNamespace(exit_code=1, output='setup failed')
                with self.assertRaisesRegex(RuntimeError, 'failed'):
                    kernel.open_kernel(Path(directory))
                server.return_value.stop.assert_called_once_with()
