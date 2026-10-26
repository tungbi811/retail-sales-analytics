import json
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from api.services.text_to_sql import prompts, providers, service

# Run from the project root: uv run python -m unittest discover -s tests -t .


def reply(sql, explanation='Revenue by region.', chart='bar', stop='end_turn'):
    text = json.dumps({'sql': sql, 'explanation': explanation, 'chart': chart})
    return SimpleNamespace(stop_reason=stop, content=[SimpleNamespace(type='text', text=text)])


class FakeClient:
    '''Stands in for anthropic.Anthropic: returns the queued replies and records each request.'''

    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.requests.append({**kwargs, 'messages': list(kwargs['messages'])})
        return self.replies.pop(0)


class FakeOpenAI:
    def __init__(self, *texts, refuse=False):
        self.texts = list(texts)
        self.refuse = refuse
        self.requests = []
        self.responses = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.requests.append({**kwargs, 'input': list(kwargs['input'])})
        text = self.texts.pop(0)
        part = SimpleNamespace(type='refusal', refusal='no') if self.refuse else SimpleNamespace(type='output_text', text=text)
        return SimpleNamespace(status='completed', output=[SimpleNamespace(type='message', content=[part])], output_text=text)


class FakeGemini:
    def __init__(self, *texts):
        self.texts = list(texts)
        self.requests = []
        self.models = SimpleNamespace(generate_content=self.generate_content)

    def generate_content(self, **kwargs):
        self.requests.append({**kwargs, 'contents': list(kwargs['contents'])})
        text = self.texts.pop(0)
        return SimpleNamespace(text=text, candidates=[SimpleNamespace(finish_reason='SAFETY')])


def text(sql, explanation='Revenue by region.', chart='bar'):
    return json.dumps({'sql': sql, 'explanation': explanation, 'chart': chart})


class AnswerTest(unittest.TestCase):
    def setUp(self):
        patches = [
            mock.patch.object(service, 'describe_schema', return_value='gold.fact_sales ...'),
            mock.patch.object(service, 'run', return_value=(['region', 'revenue'], [{'region': 'Miền Trung', 'revenue': 10}], False)),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_returns_sql_rows_and_chart(self):
        client = FakeClient(reply('SELECT region, revenue FROM t;'))
        out = service.answer('Revenue by region?', None, 'claude', client)
        self.assertEqual(out['sql'], 'SELECT region, revenue FROM t')
        self.assertEqual(out['rows'], [{'region': 'Miền Trung', 'revenue': 10}])
        self.assertEqual(out['chart'], 'bar')
        self.assertEqual((out['provider'], out['model']), ('claude', 'claude-opus-5-5'))
        request = client.requests[0]
        self.assertEqual(request['model'], 'claude-opus-5-5')
        self.assertEqual(request['fallbacks'], 'default')
        self.assertIn('gold.fact_sales', request['system'][0]['text'])

    def test_unsafe_query_goes_back_to_claude_once(self):
        client = FakeClient(reply('DELETE FROM gold.fact_sales'), reply('SELECT 1'))
        out = service.answer('Clear the sales', None, 'claude', client)
        self.assertEqual(out['sql'], 'SELECT 1')
        self.assertIn('failed', client.requests[1]['messages'][-1]['content'])
        service.run.assert_called_once_with(None, 'SELECT 1')

    def test_gives_up_after_the_repair_round(self):
        client = FakeClient(reply('DROP TABLE x'), reply('DROP TABLE y'))
        with self.assertRaises(HTTPException) as e:
            service.answer('Drop it', None, 'claude', client)
        self.assertEqual(e.exception.status_code, 422)
        service.run.assert_not_called()

    def test_unanswerable_question_returns_the_reason_without_running(self):
        out = service.answer('What is the weather?', None, 'claude', FakeClient(reply('', 'The warehouse has no weather data.', 'none')))
        self.assertEqual(out['explanation'], 'The warehouse has no weather data.')
        self.assertEqual(out['rows'], [])
        service.run.assert_not_called()

    def test_refusal_is_reported(self):
        with self.assertRaises(HTTPException) as e:
            service.answer('...', None, 'claude', FakeClient(reply('', stop='refusal')))
        self.assertEqual(e.exception.status_code, 422)


class OtherProvidersTest(unittest.TestCase):
    def setUp(self):
        patches = [
            mock.patch.object(service, 'describe_schema', return_value='gold.fact_sales ...'),
            mock.patch.object(service, 'run', return_value=(['n'], [{'n': 1}], False)),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    @mock.patch.dict('os.environ', {}, clear=True)
    def test_openai_gets_the_schema_as_a_strict_format_and_repairs_in_the_same_conversation(self):
        client = FakeOpenAI(text('DELETE FROM x'), text('SELECT 1'))
        out = service.answer('How many?', None, 'openai', client)
        self.assertEqual((out['provider'], out['model'], out['sql']), ('openai', 'gpt-5.4-mini', 'SELECT 1'))
        first, second = client.requests
        self.assertEqual(first['model'], 'gpt-5.4-mini')
        self.assertEqual(second['model'], 'gpt-5.4-mini')
        self.assertEqual(first['text']['format']['strict'], True)
        self.assertIn('gold.fact_sales', first['instructions'])
        self.assertEqual([m['role'] for m in second['input']], ['user', 'assistant', 'user'])

    def test_openai_refusal_is_reported(self):
        with self.assertRaises(HTTPException) as e:
            service.answer('...', None, 'openai', FakeOpenAI('', refuse=True))
        self.assertEqual((e.exception.status_code, e.exception.detail), (422, 'OpenAI declined to answer that question.'))

    def test_gemini_answers_and_a_blocked_reply_is_declined(self):
        client = FakeGemini(text('SELECT 1'))
        out = service.answer('How many?', None, 'gemini', client)
        self.assertEqual((out['model'], out['sql']), ('gemini-3.8-flash', 'SELECT 1'))
        self.assertEqual(client.requests[0]['config'].response_json_schema, prompts.ANSWER_SCHEMA)
        with self.assertRaises(HTTPException) as e:
            service.answer('...', None, 'gemini', FakeGemini(''))
        self.assertEqual(e.exception.status_code, 422)

    def test_model_can_be_changed_from_env(self):
        with mock.patch.dict('os.environ', {'TEXT_TO_SQL_GEMINI_MODEL': 'gemini-test'}):
            self.assertEqual(providers.model_for('gemini'), 'gemini-test')


if __name__ == '__main__':
    unittest.main()
