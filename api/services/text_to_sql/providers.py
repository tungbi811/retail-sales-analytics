import json
import os
import re

import anthropic
import openai
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types

from api.services.text_to_sql.prompts import ANSWER_SCHEMA

# The three model providers: which one is chosen, its model and key, and a writer that asks it for SQL.
# Keys and choices live in the root .env; the Settings page writes TEXT_TO_SQL_PROVIDER and TEXT_TO_SQL_<PROVIDER>_MODEL.

# id: (label, default model, env vars that hold its key)
PROVIDERS = {
    'claude': ('Claude', 'claude-opus-5-5', ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']),
    'openai': ('OpenAI', 'gpt-5.4-mini', ['OPENAI_API_KEY']),
    'gemini': ('Gemini', 'gemini-3.8-flash', ['GEMINI_API_KEY', 'GOOGLE_API_KEY']),
}

PROVIDER_VAR = 'TEXT_TO_SQL_PROVIDER'

# OpenAI lists every model it serves; keep the ones that answer text.
OPENAI_CHAT = re.compile(r'^(gpt-|o\d)')
OPENAI_OTHER = re.compile(r'audio|realtime|tts|transcribe|image|search|embedding|instruct')


def active_provider() -> str:
    provider = os.getenv(PROVIDER_VAR, '')
    return provider if provider in PROVIDERS else 'openai'


def model_var(provider: str) -> str:
    return f'TEXT_TO_SQL_{provider.upper()}_MODEL'


def model_for(provider: str) -> str:
    return os.getenv(model_var(provider)) or PROVIDERS[provider][1]


def has_key(provider: str) -> bool:
    return any(os.getenv(k) for k in PROVIDERS[provider][2])


def key_var(provider: str) -> str:
    '''The variable holding the provider's key: the one already set, else its usual name.'''
    names = PROVIDERS[provider][2]
    return next((n for n in names if os.getenv(n)), names[0])


def masked(provider: str) -> str | None:
    key = os.getenv(key_var(provider))
    return f'…{key[-4:]}' if key else None


def client_for(provider: str, key: str | None):
    '''A client for a pasted key, or for the saved one when key is None.'''
    if provider == 'claude':
        return anthropic.Anthropic(api_key=key, max_retries=0, timeout=15) if key else anthropic.Anthropic(max_retries=0, timeout=15)
    if provider == 'openai':
        return openai.OpenAI(api_key=key, max_retries=0, timeout=15) if key else openai.OpenAI(max_retries=0, timeout=15)
    return genai.Client(api_key=key) if key else genai.Client()


def list_models(provider: str, client) -> list[str]:
    models = client.models.list()
    if provider == 'claude':
        return [m.id for m in models]
    if provider == 'openai':
        return [m.id for m in models if OPENAI_CHAT.match(m.id) and not OPENAI_OTHER.search(m.id)]
    return [m.name.removeprefix('models/') for m in models if 'generateContent' in (m.supported_actions or [])]


def problem(provider: str, model: str, e: Exception) -> str:
    '''A plain sentence for an error from listing or checking models.'''
    label = PROVIDERS[provider][0]
    if isinstance(e, (anthropic.AuthenticationError, anthropic.PermissionDeniedError, openai.AuthenticationError, openai.PermissionDeniedError)):
        return f'{label} rejected the key.'
    if isinstance(e, (anthropic.NotFoundError, openai.NotFoundError)):
        return f'{label} has no model named {model}.'
    if isinstance(e, (anthropic.APIConnectionError, openai.APIConnectionError)):
        return f'Cannot reach the {label} API.'
    if isinstance(e, (anthropic.APIStatusError, openai.APIStatusError)):
        return f'{label} API error {e.status_code}.'
    if isinstance(e, genai_errors.APIError):
        if e.code == 404:
            return f'{label} has no model named {model}.'
        # Gemini answers a bad key with 400 API_KEY_INVALID.
        if e.code in (400, 401, 403):
            return f'{label} rejected the key.'
        return f'{label} API error {e.code}.'
    raise e


class Declined(Exception):
    '''The model refused, or its safety filter blocked the answer.'''


class CutOff(Exception):
    '''The answer hit the output limit before the JSON was complete.'''


# Each writer keeps its own conversation, so the repair round sees the query that failed.


class ClaudeWriter:
    def __init__(self, system: str, model: str, client=None):
        self.client = client or anthropic.Anthropic()
        self.system, self.model, self.messages = system, model, []

    def write(self, text: str) -> dict:
        self.messages.append({'role': 'user', 'content': text})
        response = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            betas=['server-side-fallback-2026-07-01'],
            fallbacks='default',
            output_config={'effort': 'medium', 'format': {'type': 'json_schema', 'schema': ANSWER_SCHEMA}},
            system=[{'type': 'text', 'text': self.system, 'cache_control': {'type': 'ephemeral'}}],
            messages=self.messages,
        )
        if response.stop_reason == 'refusal':
            raise Declined()
        if response.stop_reason == 'max_tokens':
            raise CutOff()
        self.messages.append({'role': 'assistant', 'content': response.content})
        return json.loads(next(b.text for b in response.content if b.type == 'text'))


class OpenAIWriter:
    def __init__(self, system: str, model: str, client=None):
        self.client = client or openai.OpenAI()
        self.system, self.model, self.input = system, model, []

    def write(self, text: str) -> dict:
        self.input.append({'role': 'user', 'content': text})
        response = self.client.responses.create(
            model=self.model,
            instructions=self.system,
            input=self.input,
            text={'format': {'type': 'json_schema', 'name': 'sql_answer', 'strict': True, 'schema': ANSWER_SCHEMA}},
        )
        if response.status == 'incomplete':
            raise CutOff()
        parts = [p for item in response.output if item.type == 'message' for p in item.content]
        if any(p.type == 'refusal' for p in parts):
            raise Declined()
        out = response.output_text
        self.input.append({'role': 'assistant', 'content': out})
        return json.loads(out)


class GeminiWriter:
    def __init__(self, system: str, model: str, client=None):
        self.client = client or genai.Client()
        self.model, self.contents = model, []
        self.config = genai_types.GenerateContentConfig(system_instruction=system, response_mime_type='application/json', response_json_schema=ANSWER_SCHEMA)

    def write(self, text: str) -> dict:
        self.contents.append(genai_types.Content(role='user', parts=[genai_types.Part(text=text)]))
        response = self.client.models.generate_content(model=self.model, contents=self.contents, config=self.config)
        if not response.text:
            reason = response.candidates[0].finish_reason if response.candidates else None
            raise CutOff() if reason == genai_types.FinishReason.MAX_TOKENS else Declined()
        self.contents.append(genai_types.Content(role='model', parts=[genai_types.Part(text=response.text)]))
        return json.loads(response.text)


WRITERS = {'claude': ClaudeWriter, 'openai': OpenAIWriter, 'gemini': GeminiWriter}
