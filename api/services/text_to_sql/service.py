import psycopg
from fastapi import HTTPException

from api.db import MAX_ROWS, run
from api.services.text_to_sql.prompts import SYSTEM, describe_schema
from api.services.text_to_sql.providers import PROVIDERS, WRITERS, CutOff, Declined, model_for
from api.services.text_to_sql.validation import guard

# Text to SQL over the gold models: a model writes one read-only query, it is checked, run, and repaired once if it fails.


def answer(question: str, connect, provider: str = 'claude', client=None) -> dict:
    system = SYSTEM.format(max_rows=MAX_ROWS, schema=describe_schema(connect))
    model = model_for(provider)
    writer = WRITERS[provider](system, model, client)
    who = {'question': question, 'provider': provider, 'model': model}
    text = question
    # One repair round: a query that fails to check or run goes back to the model with the error.
    for attempt in range(2):
        try:
            out = writer.write(text)
        except Declined:
            raise HTTPException(status_code=422, detail=f'{PROVIDERS[provider][0]} declined to answer that question.')
        except CutOff:
            raise HTTPException(status_code=502, detail='The answer was cut off. Try a narrower question.')
        if not out['sql'].strip():
            return {**who, 'sql': '', 'explanation': out['explanation'], 'chart': 'none', 'columns': [], 'rows': [], 'truncated': False}
        try:
            sql = guard(out['sql'])
            columns, rows, truncated = run(connect, sql)
            return {**who, 'sql': sql, 'explanation': out['explanation'], 'chart': out['chart'], 'columns': columns, 'rows': rows, 'truncated': truncated}
        except (ValueError, psycopg.Error) as e:
            error = str(e).strip().splitlines()[0]
            if attempt == 1:
                raise HTTPException(status_code=422, detail=f'The query did not run: {error}')
            text = f'That query failed: {error}\nFix it and answer again.'
