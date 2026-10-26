import os
import threading
import unittest
from types import SimpleNamespace
from unittest import mock

from autogen.agentchat.group import (
    AgentTarget, ContextVariables, RevertToUserTarget, TerminateTarget,
)

from api.services.insights.agents import (
    BusinessAnalyst, BusinessTranslator, Coder, DataScientist, GroupChat,
)
from api.services.insights.agents import business_analyst, group_chat, markdown
from api.services.insights.kernel import SETUP_CELL


class FakeExecutor:
    def __init__(self, *results):
        self.results = iter(results)
        self.calls = []

    def execute_code_blocks(self, blocks):
        self.calls.append([block.code for block in blocks])
        result = next(self.results)
        if isinstance(result, Exception):
            raise result
        return result

    def restart(self):
        self.calls.append('restart')


def tool(agent, name):
    return next(item.func for item in agent.tools if item.name == name)


@mock.patch.dict(os.environ, {
    'TEXT_TO_SQL_PROVIDER': 'openai', 'OPENAI_API_KEY': 'test',
    'TEXT_TO_SQL_OPENAI_MODEL': 'gpt-4.1-mini',
})
class AgentsTest(unittest.TestCase):
    def setUp(self):
        self.network = mock.patch('httpx.Client.send', side_effect=AssertionError('No network in agent tests'))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_group_chat_wires_the_old_flow(self):
        chat = GroupChat(lambda: None, FakeExecutor(), threading.Event())
        self.assertIsInstance(chat.pattern.initial_agent, BusinessAnalyst)
        self.assertEqual([agent.name for agent in chat.pattern.agents],
                         ['BusinessAnalyst', 'BusinessTranslator', 'DataScientist', 'Coder'])
        self.assertIsInstance(chat.pattern.group_after_work, AgentTarget)
        self.assertEqual(chat.pattern.group_after_work.agent_name, 'BusinessAnalyst')
        self.assertIsInstance(chat.pattern.agents[1].handoffs.after_works[0].target, RevertToUserTarget)
        self.assertEqual(chat.pattern.context_variables.to_dict(), {
            'current_agent': '', 'objective': '', 'problem_type': '',
            'stakeholders_expectations': [], 'research_questions': [],
        })

    def test_prompts_are_the_old_ones(self):
        analyst = BusinessAnalyst(lambda: None)
        translator = BusinessTranslator()
        translator.context_variables = ContextVariables(data={
            'stakeholders_expectations': 'Grow revenue', 'research_questions': ['Why?'],
        })
        translator.update_agent_state_before_reply([])
        scientist = DataScientist()
        coder = Coder(FakeExecutor(), threading.Event())
        for agent, line in [
            (analyst, 'Your role is to transform user requirements into structured, actionable business analysis outputs.'),
            (translator, 'You act as the bridge between technical findings and strategic decision-making.'),
            (scientist, 'You operate in an iterative loop until the Business Translator confirms the objective is met.'),
            (coder, 'Your mission is to take structured analytical step instructions and implement them as complete, runnable Python code within a Jupyter Notebook environment.'),
        ]:
            with self.subTest(agent=agent.name):
                self.assertIn(line, agent.system_message)
        self.assertIn('Do not request or produce visualizations or plots', scientist.system_message)
        self.assertIn('Do not create plots, charts, or images.', coder.system_message)
        self.assertIn('Never write to the lake or the database.', coder.system_message)
        self.assertIn('call get_data_info first to see the data lake sources and the gold tables', analyst.system_message)
        for agent, temperature in [(analyst, 0.5), (translator, 0.3), (scientist, 0.3), (coder, 0.0)]:
            with self.subTest(agent=agent.name):
                self.assertEqual(agent.llm_config['config_list'][0]['temperature'], temperature)

    def test_run_code_retries_then_fails_cleanly(self):
        executor = FakeExecutor(RuntimeError('first'), SimpleNamespace(exit_code=0, output=''), RuntimeError('second'))
        reply = tool(Coder(executor, threading.Event()), 'run_code')(
            'print(1)', ContextVariables(data={'current_agent': 'DataScientist'}))
        self.assertEqual(reply.message, 'Execution failed: second')
        self.assertIsInstance(reply.target, RevertToUserTarget)
        self.assertEqual(executor.calls, [['print(1)'], 'restart', [SETUP_CELL], ['print(1)']])

    def test_run_code_restarts_setup_before_successful_retry(self):
        executor = FakeExecutor(RuntimeError('lost kernel'), SimpleNamespace(exit_code=0, output=''),
                                SimpleNamespace(exit_code=0, output='1'))
        reply = tool(Coder(executor, threading.Event()), 'run_code')(
            'print(1)', ContextVariables(data={'current_agent': 'DataScientist'}))
        self.assertEqual(reply.message, 'Output:\n1')
        self.assertEqual(reply.target.agent_name, 'DataScientist')
        self.assertEqual(executor.calls, [['print(1)'], 'restart', [SETUP_CELL], ['print(1)']])

    def test_run_code_setup_exception_fails_cleanly(self):
        executor = FakeExecutor(RuntimeError('first'), RuntimeError('setup failed'))
        reply = tool(Coder(executor, threading.Event()), 'run_code')('print(1)', ContextVariables())
        self.assertEqual(reply.message, 'Execution failed: setup failed')
        self.assertIsInstance(reply.target, RevertToUserTarget)

    def test_run_code_setup_failure_does_not_retry_user_code(self):
        executor = FakeExecutor(RuntimeError('lost kernel'),
                                SimpleNamespace(exit_code=1, output='setup import failed'),
                                SimpleNamespace(exit_code=0, output='should not run'))
        reply = tool(Coder(executor, threading.Event()), 'run_code')(
            'print(1)', ContextVariables(data={'current_agent': 'DataScientist'}))
        self.assertEqual(reply.message, 'Execution failed: setup import failed')
        self.assertIsInstance(reply.target, RevertToUserTarget)
        self.assertEqual(executor.calls, [['print(1)'], 'restart', [SETUP_CELL]])

    def test_run_code_after_stop_terminates(self):
        stopped = threading.Event()
        stopped.set()
        executor = FakeExecutor()
        reply = tool(Coder(executor, stopped), 'run_code')('print(1)', ContextVariables())
        self.assertEqual(reply.message, 'Stopped by the user.')
        self.assertIsInstance(reply.target, TerminateTarget)
        self.assertEqual(executor.calls, [])

    def test_run_code_stopped_mid_cell_terminates_without_restart(self):
        stopped = threading.Event()

        class StoppingExecutor(FakeExecutor):
            def execute_code_blocks(self, blocks):
                stopped.set()
                return super().execute_code_blocks(blocks)

        executor = StoppingExecutor(RuntimeError('kernel shut down'))
        reply = tool(Coder(executor, stopped), 'run_code')('slow()', ContextVariables())
        self.assertEqual(reply.message, 'Stopped by the user.')
        self.assertIsInstance(reply.target, TerminateTarget)
        self.assertEqual(executor.calls, [['slow()']])

    def test_run_code_error_output_returns_first_two_lines_to_coder(self):
        executor = FakeExecutor(SimpleNamespace(exit_code=1, output='line 1\nline 2\nline 3'))
        reply = tool(Coder(executor, threading.Event()), 'run_code')('broken()', ContextVariables())
        self.assertEqual(reply.message, 'line 1\nline 2')
        self.assertEqual(reply.target.agent_name, 'Coder')
        self.assertEqual(executor.calls, [['broken()']])

    def test_get_data_info_uses_lake_and_gold(self):
        connect = object()
        # data_info is Markdown already; asking a model to rewrite ~10k characters lost most of them.
        with mock.patch.object(business_analyst, 'data_info', return_value='## Data lake') as describe, \
             mock.patch.object(business_analyst, 'convert_message_to_markdown') as convert:
            reply = tool(BusinessAnalyst(connect), 'get_data_info')()
        self.assertEqual(reply.message, '## Data lake')
        convert.assert_not_called()
        self.assertEqual(reply.target.agent_name, 'BusinessAnalyst')
        describe.assert_called_once_with(connect)

    def test_group_chat_returns_run_response_without_consuming_events(self):
        chat = GroupChat(lambda: None, FakeExecutor(), threading.Event())
        response = object()
        with mock.patch.object(group_chat, 'run_group_chat', return_value=response) as run:
            self.assertIs(chat.run('What drives sales?'), response)
        run.assert_called_once_with(pattern=chat.pattern, messages='What drives sales?', max_rounds=200)

    def test_markdown_uses_active_model_and_preserves_whole_message(self):
        for output, expected in [('```markdown\n# Report\n```', '# Report'), ('  report  ', 'report')]:
            with self.subTest(output=output), mock.patch.object(markdown, 'OpenAIWrapper') as wrapper:
                client = wrapper.return_value
                client.extract_text_or_completion_object.return_value = [output]
                self.assertEqual(markdown.convert_message_to_markdown('All facts'), expected)
                config = wrapper.call_args.kwargs
                self.assertEqual(config['config_list'][0]['model'], 'gpt-4.1-mini')
                self.assertEqual(config['config_list'][0]['temperature'], 0)
                # OpenAI answers 400 to parallel_tool_calls on a request without tools.
                self.assertNotIn('parallel_tool_calls', config)
                self.assertNotIn('parallel_tool_calls', config['config_list'][0])
                client.create.assert_called_once_with(messages=[{
                    'role': 'user',
                    'content': 'Convert the whole message to markdown format (do not summarise or remove anything):\nAll facts',
                }])
