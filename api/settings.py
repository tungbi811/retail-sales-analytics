import os
import re
from pathlib import Path
from typing import Literal

import anthropic
import openai
from dotenv import set_key
from fastapi import APIRouter, Depends, HTTPException, Request
from google import genai
from google.genai import errors as genai_errors
from pydantic import BaseModel, Field

from api.ask import PROVIDERS, active_provider, model_for

# Settings for Ask's AI connection: which provider, which model, and its key, saved to the root .env.
# Keys are written to disk and the API has no login, so only requests from this computer are answered.

ENV_FILE = Path(__file__).resolve().parents[1] / '.env'
LOCAL = {'127.0.0.1', '::1', 'localhost'}

# OpenAI lists every model it serves; keep the ones that answer text.
OPENAI_CHAT = re.compile(r'^(gpt-|o\d)')
OPENAI_OTHER = re.compile(r'audio|realtime|tts|transcribe|image|search|embedding|instruct')

Provider = Literal['claude', 'openai', 'gemini']
# Values go into .env as KEY='value', so quotes, spaces and line breaks are refused.
Key = Field(default=None, min_length=1, max_length=300, pattern=r'^[^\s\'"]+$')
Model = Field(min_length=1, max_length=100, pattern=r'^[\w.:/-]+$')


class Connection(BaseModel):
    provider: Provider
    key: str | None = Key


class Check(Connection):
    model: str = Model


def local_only(request: Request):
    if not request.client or request.client.host not in LOCAL:
        raise HTTPException(status_code=403, detail='AI settings can only be changed on the computer running the API.')


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


def current() -> dict:
    return {
        'provider': active_provider(),
        'providers': [{'id': p, 'label': label, 'model': model_for(p), 'default': default, 'key': masked(p)} for p, (label, default, _) in PROVIDERS.items()],
    }


def save(name: str, value: str):
    set_key(ENV_FILE, name, value)
    os.environ[name] = value


def register():
    router = APIRouter(prefix='/api/settings/ai', dependencies=[Depends(local_only)])

    @router.get('')
    def show():
        return current()

    @router.put('')
    def update(c: Check):
        if c.key:
            save(key_var(c.provider), c.key)
        save(f'ASK_{c.provider.upper()}_MODEL', c.model)
        save('ASK_PROVIDER', c.provider)
        return current()

    @router.post('/models')
    def models(c: Connection):
        fallback = [model_for(c.provider)]
        if not (c.key or masked(c.provider)):
            return {'models': fallback, 'error': None}
        try:
            return {'models': list_models(c.provider, client_for(c.provider, c.key)) or fallback, 'error': None}
        except Exception as e:
            return {'models': fallback, 'error': problem(c.provider, fallback[0], e)}

    @router.post('/test')
    def test(c: Check):
        if not (c.key or masked(c.provider)):
            return {'ok': False, 'error': f'Paste a {PROVIDERS[c.provider][0]} API key first.'}
        client = client_for(c.provider, c.key)
        try:
            if c.provider == 'gemini':
                client.models.get(model=c.model)
            else:
                client.models.retrieve(c.model)
        except Exception as e:
            return {'ok': False, 'error': problem(c.provider, c.model, e)}
        return {'ok': True, 'error': None}

    return router
