from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.services.text_to_sql.errors import plain_error
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
        except Exception as e:
            known = plain_error(provider, e)
            if known is None:
                raise
            raise HTTPException(status_code=known[0], detail=known[1])

    return router
