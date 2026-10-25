import os
from datetime import date, datetime
from decimal import Decimal

import psycopg
from psycopg.rows import dict_row

# All Postgres access for the API: the connection, and the read-only runner for SQL a model wrote.

MAX_ROWS = 500


def connect():
    return psycopg.connect(
        host=os.getenv('POSTGRES_HOST'),
        dbname=os.getenv('POSTGRES_DATABASE'),
        user=os.getenv('POSTGRES_USER'),
        password=os.getenv('POSTGRES_PASSWORD'),
        row_factory=dict_row,
    )


def plain(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def run(connect, sql: str):
    '''Run one query in a read-only transaction with a 10 s timeout; returns columns, at most MAX_ROWS rows, and whether more were cut.'''
    with connect() as conn:
        conn.execute('SET TRANSACTION READ ONLY')
        conn.execute("SET LOCAL statement_timeout = '10s'")
        cur = conn.execute(sql)
        rows = cur.fetchmany(MAX_ROWS + 1)
        columns = [d.name for d in cur.description or []]
    return columns, [{k: plain(v) for k, v in r.items()} for r in rows[:MAX_ROWS]], len(rows) > MAX_ROWS
