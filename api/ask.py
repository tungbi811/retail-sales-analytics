import json
import os
import re
from datetime import date, datetime
from decimal import Decimal
from functools import lru_cache

from typing import Literal

import anthropic
import openai
import psycopg
from fastapi import APIRouter, HTTPException
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel, Field

# Text to SQL over the gold models: a model (Claude, OpenAI or Gemini) writes one read-only query, the API runs it.
# Keys come from the root .env (loaded by api.main). The Settings page (api.settings) picks the provider with
# ASK_PROVIDER and its model with ASK_<PROVIDER>_MODEL, and saves keys there.

MAX_ROWS = 500

# id: (label, default model, env vars that hold its key)
PROVIDERS = {
    'claude': ('Claude', 'claude-opus-5-5', ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']),
    'openai': ('OpenAI', 'gpt-6.1-sol', ['OPENAI_API_KEY']),
    'gemini': ('Gemini', 'gemini-3.8-flash', ['GEMINI_API_KEY', 'GOOGLE_API_KEY']),
}

ANSWER_SCHEMA = {
    'type': 'object',
    'properties': {
        'sql': {'type': 'string', 'description': 'One PostgreSQL SELECT (or WITH ... SELECT) over the gold schema. Empty when the question cannot be answered from the data.'},
        'explanation': {'type': 'string', 'description': 'One or two plain sentences: what the query returns, or why the question cannot be answered.'},
        'chart': {'type': 'string', 'enum': ['none', 'bar', 'line'], 'description': 'bar for a category against one number, line for a date or month against one number, none otherwise.'},
    },
    'required': ['sql', 'explanation', 'chart'],
    'additionalProperties': False,
}

SYSTEM = '''You turn questions about Pantio, a Vietnamese cosmetics retailer, into PostgreSQL queries over its sales warehouse.

Rules:
- Write one SELECT statement (a WITH clause is fine). Never write to the database or call functions that touch the server, files or other databases.
- Only use the tables and columns listed below, always schema-qualified as gold.<table>.
- Amounts have no currency; call them revenue or amount, not VND or dollars.
- Give columns short readable aliases (store, revenue, orders) and round money to whole numbers.
- Order results so the most important row comes first, and keep them under {max_rows} rows; aggregate rather than list raw sales.
- The data is historical. "This month", "latest" or "recently" mean relative to the last sale date given below, not today's date.
- If the question cannot be answered from these tables, return an empty sql and say why in the explanation.

{schema}'''

# Columns whose distinct values are worth showing Claude, so filters use the stored spelling.
VALUE_COLUMNS = [
    ('dim_store', 'region'),
    ('dim_store', 'city'),
    ('dim_product', 'category'),
    ('dim_customer', 'gender'),
    ('dim_customer', 'age_group'),
]

FORBIDDEN = re.compile(r'\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|lock|listen|notify|set|reset|comment|security)\b|\bpg_\w+\s*\(|\bdblink|\blo_\w+\s*\(', re.IGNORECASE)


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    # Left out, Ask uses the provider chosen in Settings.
    provider: Literal['claude', 'openai', 'gemini'] | None = None


class Declined(Exception):
    '''The model refused, or its safety filter blocked the answer.'''


class CutOff(Exception):
    '''The answer hit the output limit before the JSON was complete.'''


def active_provider() -> str:
    provider = os.getenv('ASK_PROVIDER', '')
    return provider if provider in PROVIDERS else 'claude'


def model_for(provider: str) -> str:
    return os.getenv(f'ASK_{provider.upper()}_MODEL') or PROVIDERS[provider][1]


def has_key(provider: str) -> bool:
    return any(os.getenv(k) for k in PROVIDERS[provider][2])


def guard(sql: str) -> str:
    '''Return the query ready to run, or raise ValueError if it is not a single read-only SELECT.'''
    # Checks run on the code alone: string literals and comments may contain any word or semicolon.
    code = re.sub(r"'(?:[^']|'')*'", "''", sql)
    code = re.sub(r'--[^\n]*|/\*.*?\*/', ' ', code, flags=re.DOTALL).strip().rstrip(';').strip()
    if not code:
        raise ValueError('No query was written.')
    if ';' in code:
        raise ValueError('Only one statement is allowed.')
    if not re.match(r'(select|with)\b', code, re.IGNORECASE):
        raise ValueError('Only SELECT queries are allowed.')
    hit = FORBIDDEN.search(code)
    if hit:
        raise ValueError(f'"{hit.group(0).strip()}" is not allowed in a read-only query.')
    return re.sub(r';\s*$', '', sql.strip())


def plain(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


@lru_cache(maxsize=1)
def describe_schema(connect) -> str:
    with connect() as conn:
        cols = conn.execute('''
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'gold'
            ORDER BY table_name, ordinal_position
        ''').fetchall()
        values = {}
        for table, column in VALUE_COLUMNS:
            rows = conn.execute(f'SELECT DISTINCT {column} AS v FROM gold.{table} ORDER BY 1 LIMIT 30').fetchall()
            values[(table, column)] = [r['v'] for r in rows]
        span = conn.execute('SELECT min(sale_datetime) AS first, max(sale_datetime) AS last FROM gold.fact_sales').fetchone()

    tables: dict[str, list[str]] = {}
    for c in cols:
        line = f"{c['column_name']} {c['data_type']}"
        if (c['table_name'], c['column_name']) in values:
            line += ' -- one of: ' + ', '.join(str(v) for v in values[(c['table_name'], c['column_name'])])
        tables.setdefault(c['table_name'], []).append(line)

    out = ['Tables (schema gold):']
    for table, lines in tables.items():
        out.append(f'\ngold.{table}')
        out.extend(f'  {line}' for line in lines)
    out.append(
        '\nNotes: fact_sales has one row per sale (an order); join it to dim_store, dim_product, dim_customer by their ids '
        'and to dim_date on sale_date = date_day. fact_inventory is a snapshot per store x product; below_safety_stock and '
        'is_out_of_stock flag restock needs. Never sum stock across time.'
    )
    out.append(f"Sales run from {span['first']:%Y-%m-%d} to {span['last']:%Y-%m-%d %H:%M}; treat {span['last']:%Y-%m-%d} as today.")
    return '\n'.join(out)


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


def run(connect, sql: str):
    with connect() as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        conn.execute("SET LOCAL statement_timeout = '10s'")
        cur = conn.execute(sql)
        rows = cur.fetchmany(MAX_ROWS + 1)
        columns = [d.name for d in cur.description or []]
    return columns, [{k: plain(v) for k, v in r.items()} for r in rows[:MAX_ROWS]], len(rows) > MAX_ROWS


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


def register(connect):
    router = APIRouter()

    @router.get('/api/ask/providers')
    def providers():
        active = active_provider()
        return [{'id': p, 'label': label, 'model': model_for(p), 'ready': has_key(p), 'active': p == active} for p, (label, _, _) in PROVIDERS.items()]

    @router.post('/api/ask')
    def ask(q: Question):
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
