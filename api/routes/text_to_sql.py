from typing import Literal

import anthropic
import openai
import psycopg
from fastapi import APIRouter, HTTPException
from google.genai import errors as genai_errors
from pydantic import BaseModel, Field

from api.services.text_to_sql.providers import PROVIDERS, active_provider, has_key, model_for
from api.services.text_to_sql.service import answer

# A question in plain words in, the SQL a model wrote and its rows out. Used by the dashboard's "Ask in plain words" page.


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    # Left out, the provider chosen in Settings answers.
    provider: Literal['claude', 'openai', 'gemini'] | None = None


def register(connect):
    router = APIRouter(prefix='/api/text-to-sql')

    @router.get('/providers')
    def providers():
        active = active_provider()
        return [{'id': p, 'label': label, 'model': model_for(p), 'ready': has_key(p), 'active': p == active} for p, (label, _, _) in PROVIDERS.items()]

    @router.post('')
    def text_to_sql(q: Question):
        provider = q.provider or active_provider()
        label = PROVIDERS[provider][0]
        if not has_key(provider):
            raise HTTPException(status_code=503, detail=f'{label} has no API key. Add one in Settings.')
        try:
            return answer(q.question.strip(), connect, provider)
        except (anthropic.AuthenticationError, openai.AuthenticationError):
            raise HTTPException(status_code=503, detail=f'The {label} API key was rejected. Check it in Settings.')
        except (anthropic.RateLimitError, openai.RateLimitError):
            raise HTTPException(status_code=429, detail=f'{label} is rate limited right now. Try again in a minute.')
        except (anthropic.APIConnectionError, openai.APIConnectionError):
            raise HTTPException(status_code=503, detail=f'Cannot reach the {label} API.')
        except (anthropic.APIStatusError, openai.APIStatusError) as e:
            raise HTTPException(status_code=502, detail=f'{label} API error {e.status_code}.')
        except genai_errors.APIError as e:
            raise HTTPException(status_code=502, detail=f'Gemini API error {e.code}: {e.message}')
        except psycopg.OperationalError as e:
            raise HTTPException(status_code=503, detail=f'Cannot reach Postgres: {e}')

    return router
