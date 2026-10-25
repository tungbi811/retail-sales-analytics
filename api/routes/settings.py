import os
from pathlib import Path
from typing import Literal

from dotenv import set_key
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from api.services.text_to_sql.providers import PROVIDER_VAR, PROVIDERS, active_provider, client_for, key_var, list_models, masked, model_for, model_var, problem

# Settings for text to SQL's AI connection: which provider, which model, and its key, saved to the root .env.
# Keys are written to disk and the API has no login, so only requests from this computer are answered.

ENV_FILE = Path(__file__).resolve().parents[2] / '.env'
LOCAL = {'127.0.0.1', '::1', 'localhost'}

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
        save(model_var(c.provider), c.model)
        save(PROVIDER_VAR, c.provider)
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
