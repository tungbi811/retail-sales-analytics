import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import anthropic
import httpx
import httpx2
import openai
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.genai import errors as genai_errors

from api import ask, settings

# Run from the project root: uv run python -m unittest api.test_settings


def anthropic_error(cls, status):
    return cls('error', response=httpx2.Response(status, request=httpx2.Request('GET', 'https://api.anthropic.com')), body=None)


def openai_error(cls, status):
    return cls('error', response=httpx.Response(status, request=httpx.Request('GET', 'https://api.openai.com')), body=None)


class FakeModels:
    '''Stands in for client.models on all three SDKs: lists the given models, or raises the given error.'''

    def __init__(self, items=(), error=None):
        self.items, self.error = list(items), error
        self.looked_up = []

    def list(self):
        if self.error:
            raise self.error
        return self.items

    def retrieve(self, model):
        self.looked_up.append(model)
        if self.error:
            raise self.error
        return SimpleNamespace(id=model)

    def get(self, *, model):
        return self.retrieve(model)


class SettingsTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.env_file = Path(folder.name) / '.env'
        self.env_file.write_text('POSTGRES_HOST=localhost\n')
        for p in [mock.patch.object(settings, 'ENV_FILE', self.env_file), mock.patch.dict(os.environ, {}, clear=True)]:
            p.start()
            self.addCleanup(p.stop)
        self.clients = []
        app = FastAPI()
        app.include_router(settings.register())
        app.include_router(ask.register(None))
        self.app = app
        self.http = TestClient(app, client=('127.0.0.1', 50000))

    def fake(self, models):
        '''Every client the settings build gets these models; returns the keys they were built with.'''
        built = []

        def client_for(provider, key):
            built.append((provider, key))
            return SimpleNamespace(models=models)

        p = mock.patch.object(settings, 'client_for', client_for)
        p.start()
        self.addCleanup(p.stop)
        return built

    def test_shows_the_active_provider_and_only_the_end_of_each_key(self):
        os.environ.update({'ANTHROPIC_API_KEY': 'sk-ant-secret-1234', 'ASK_PROVIDER': 'openai', 'ASK_OPENAI_MODEL': 'gpt-test'})
        out = self.http.get('/api/settings/ai').json()
        self.assertEqual(out['provider'], 'openai')
        by_id = {p['id']: p for p in out['providers']}
        self.assertEqual((by_id['claude']['key'], by_id['openai']['key'], by_id['gemini']['key']), ('…1234', None, None))
        self.assertEqual((by_id['openai']['model'], by_id['openai']['default']), ('gpt-test', 'gpt-6.1-sol'))
        self.assertNotIn('secret', json.dumps(out))

    def test_without_a_choice_claude_is_active(self):
        os.environ['ASK_PROVIDER'] = 'nonsense'
        self.assertEqual(self.http.get('/api/settings/ai').json()['provider'], 'claude')

    def test_saving_writes_the_env_file_and_applies_at_once(self):
        out = self.http.put('/api/settings/ai', json={'provider': 'gemini', 'model': 'gemini-test', 'key': 'AIza-new-9876'}).json()
        written = self.env_file.read_text()
        self.assertIn('POSTGRES_HOST=localhost', written, 'other settings are kept')
        for line in ["ASK_PROVIDER='gemini'", "ASK_GEMINI_MODEL='gemini-test'", "GEMINI_API_KEY='AIza-new-9876'"]:
            self.assertIn(line, written)
        self.assertEqual((ask.active_provider(), ask.model_for('gemini'), ask.has_key('gemini')), ('gemini', 'gemini-test', True))
        self.assertEqual(out['provider'], 'gemini')
        self.assertNotIn('AIza-new', json.dumps(out))

    def test_saving_without_a_key_keeps_the_saved_one(self):
        os.environ['OPENAI_API_KEY'] = 'sk-old-1111'
        self.http.put('/api/settings/ai', json={'provider': 'openai', 'model': 'gpt-test'})
        self.assertEqual(os.environ['OPENAI_API_KEY'], 'sk-old-1111')
        self.assertNotIn('OPENAI_API_KEY', self.env_file.read_text())

    def test_a_new_key_replaces_whichever_variable_already_holds_one(self):
        os.environ['GOOGLE_API_KEY'] = 'old'
        self.http.put('/api/settings/ai', json={'provider': 'gemini', 'model': 'gemini-test', 'key': 'new-key-1'})
        self.assertEqual(os.environ['GOOGLE_API_KEY'], 'new-key-1')
        self.assertNotIn('GEMINI_API_KEY', os.environ)

    def test_values_that_would_break_the_env_file_are_refused(self):
        for body in [
            {'provider': 'claude', 'model': 'claude-opus-5-5', 'key': 'sk-ant\nASK_PROVIDER=x'},
            {'provider': 'claude', 'model': "claude' x"},
            {'provider': 'mistral', 'model': 'm'},
        ]:
            with self.subTest(body=body):
                self.assertEqual(self.http.put('/api/settings/ai', json=body).status_code, 422)
        self.assertEqual(self.env_file.read_text(), 'POSTGRES_HOST=localhost\n')

    def test_models_come_from_the_provider_using_the_pasted_key(self):
        built = self.fake(FakeModels([SimpleNamespace(id=i) for i in ['gpt-6.1-sol', 'text-embedding-4', 'gpt-6-realtime', 'o5-mini', 'dall-e-4']]))
        out = self.http.post('/api/settings/ai/models', json={'provider': 'openai', 'key': 'sk-pasted'}).json()
        self.assertEqual(out, {'models': ['gpt-6.1-sol', 'o5-mini'], 'error': None})
        self.assertEqual(built, [('openai', 'sk-pasted')])

    def test_gemini_lists_only_models_that_generate_text(self):
        self.fake(FakeModels([
            SimpleNamespace(name='models/gemini-3.8-flash', supported_actions=['generateContent', 'countTokens']),
            SimpleNamespace(name='models/text-embedding-5', supported_actions=['embedContent']),
        ]))
        out = self.http.post('/api/settings/ai/models', json={'provider': 'gemini'}).json()
        self.assertEqual(out['models'], ['gemini-3.8-flash'])

    def test_models_fall_back_to_the_current_model_when_the_key_fails(self):
        self.fake(FakeModels(error=anthropic_error(anthropic.AuthenticationError, 401)))
        out = self.http.post('/api/settings/ai/models', json={'provider': 'claude', 'key': 'bad'}).json()
        self.assertEqual(out, {'models': ['claude-opus-5-5'], 'error': 'Claude rejected the key.'})

    def test_models_without_any_key_show_the_current_model(self):
        built = self.fake(FakeModels())
        out = self.http.post('/api/settings/ai/models', json={'provider': 'claude'}).json()
        self.assertEqual(out, {'models': ['claude-opus-5-5'], 'error': None})
        self.assertEqual(built, [], 'no request is sent without a key')

    def test_connection_checks_the_model_with_the_saved_key(self):
        os.environ['ANTHROPIC_API_KEY'] = 'sk-ant-saved'
        models = FakeModels()
        built = self.fake(models)
        out = self.http.post('/api/settings/ai/test', json={'provider': 'claude', 'model': 'claude-sonnet-5-5'}).json()
        self.assertEqual(out, {'ok': True, 'error': None})
        self.assertEqual((built, models.looked_up), ([('claude', None)], ['claude-sonnet-5-5']))

    def test_connection_explains_what_went_wrong(self):
        cases = [
            ('claude', anthropic_error(anthropic.NotFoundError, 404), 'Claude has no model named x.'),
            ('openai', openai_error(openai.AuthenticationError, 401), 'OpenAI rejected the key.'),
            ('openai', openai.APIConnectionError(request=httpx.Request('GET', 'https://api.openai.com')), 'Cannot reach the OpenAI API.'),
            ('gemini', genai_errors.ClientError(404, {'error': {'message': 'not found'}}), 'Gemini has no model named x.'),
            ('gemini', genai_errors.ClientError(400, {'error': {'message': 'API key not valid'}}), 'Gemini rejected the key.'),
        ]
        for provider, error, message in cases:
            with self.subTest(provider=provider, message=message):
                self.fake(FakeModels(error=error))
                out = self.http.post('/api/settings/ai/test', json={'provider': provider, 'model': 'x', 'key': 'k'}).json()
                self.assertEqual(out, {'ok': False, 'error': message})

    def test_connection_without_any_key_asks_for_one(self):
        self.fake(FakeModels())
        out = self.http.post('/api/settings/ai/test', json={'provider': 'gemini', 'model': 'gemini-3.8-flash'}).json()
        self.assertEqual(out, {'ok': False, 'error': 'Paste a Gemini API key first.'})

    def test_other_computers_are_refused(self):
        remote = TestClient(self.app, client=('192.168.1.20', 50000))
        self.assertEqual(remote.get('/api/settings/ai').status_code, 403)
        self.assertEqual(remote.put('/api/settings/ai', json={'provider': 'claude', 'model': 'claude-opus-5-5', 'key': 'k'}).status_code, 403)
        self.assertEqual(self.env_file.read_text(), 'POSTGRES_HOST=localhost\n')

    def test_ask_uses_the_provider_chosen_in_settings(self):
        os.environ['ASK_PROVIDER'] = 'gemini'
        response = self.http.post('/api/ask', json={'question': 'Revenue by month'})
        self.assertEqual(response.status_code, 503)
        self.assertIn('Gemini', response.json()['detail'])
        listed = self.http.get('/api/ask/providers').json()
        self.assertEqual([p['id'] for p in listed if p['active']], ['gemini'])


if __name__ == '__main__':
    unittest.main()
