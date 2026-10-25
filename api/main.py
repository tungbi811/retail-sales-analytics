import json
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from psycopg.rows import dict_row

from api.ask import register as register_ask
from api.settings import register as register_settings

# Read-only API over the dbt gold models, consumed by the dashboard in dashboard/.
# Run from the project root: uv run uvicorn api.main:app --reload --port 8000

ROOT = Path(__file__).resolve().parents[1]
RUN_RESULTS = ROOT / 'dbt' / 'target' / 'run_results.json'

load_dotenv(ROOT / '.env')

app = FastAPI(title='Pantio API')

QUERIES = {
    'stores': '''
        SELECT store_id::text, store_name, region, address, city,
               latitude::float8 AS latitude, longitude::float8 AS longitude
        FROM gold.dim_store
        ORDER BY store_id
    ''',
    'products': 'SELECT product_id::text, product_name, category FROM gold.dim_product ORDER BY product_id',
    'customers': '''
        SELECT customer_id::text, customer_name, gender, birth_year, age_group
        FROM gold.dim_customer
        ORDER BY customer_id
    ''',
    'sales': '''
        SELECT sale_id::text, sale_datetime, sale_date, product_id::text, store_id::text,
               customer_id::text, quantity, amount
        FROM gold.fact_sales
        ORDER BY sale_datetime
    ''',
    'inventory': '''
        SELECT inventory_id::text, store_id::text, product_id::text, last_updated, stock_qty,
               safety_stock, unit_cost, stock_value, is_out_of_stock, below_safety_stock
        FROM gold.fact_inventory
    ''',
}


def connect():
    return psycopg.connect(
        host=os.getenv('POSTGRES_HOST'),
        dbname=os.getenv('POSTGRES_DATABASE'),
        user=os.getenv('POSTGRES_USER'),
        password=os.getenv('POSTGRES_PASSWORD'),
        row_factory=dict_row,
    )


def last_dbt_run():
    # generated_at of the last dbt invocation; falls back to the file's mtime
    try:
        return json.loads(RUN_RESULTS.read_text())['metadata']['generated_at']
    except (OSError, KeyError, ValueError):
        if RUN_RESULTS.exists():
            return datetime.fromtimestamp(RUN_RESULTS.stat().st_mtime, timezone.utc).isoformat()
        return None


@app.get('/api/warehouse')
def warehouse():
    try:
        with connect() as conn:
            data = {name: conn.execute(sql).fetchall() for name, sql in QUERIES.items()}
    except psycopg.OperationalError as e:
        raise HTTPException(status_code=503, detail=f'Cannot reach Postgres: {e}')
    except psycopg.errors.UndefinedTable as e:
        raise HTTPException(status_code=503, detail=f'Gold models missing, run dbt first: {e}')

    # The data is historical, so "today" is the latest sale rather than the wall clock
    today = max((s['sale_datetime'] for s in data['sales']), default=None)
    return {**data, 'today': today, 'synced_at': last_dbt_run(), 'source': 'postgres'}


app.include_router(register_ask(connect))
app.include_router(register_settings())
