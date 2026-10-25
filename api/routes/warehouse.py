import json
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from fastapi import APIRouter, HTTPException

# The dashboard's data: every gold table it reads, plus when dbt last built them.

RUN_RESULTS = Path(__file__).resolve().parents[2] / 'dbt' / 'target' / 'run_results.json'

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
    # Stock with the rules dbt applies (sell rate, days of cover, stock level, lanes); see dbt/models/gold/inventory.
    'inventory': '''
        SELECT inventory_id::text, store_id::text, product_id::text, last_updated, stock_qty,
               safety_stock, unit_cost, stock_value, is_out_of_stock, below_safety_stock,
               units_per_day, days_of_cover, stock_level, shortfall, restock_cost
        FROM gold.stock_position
    ''',
    'product_stock': '''
        SELECT product_id::text, region, stock_qty::int, units_per_day, days_of_cover, lane, low_cover
        FROM gold.product_stock
    ''',
    'store_stock': 'SELECT store_id::text, stock_qty::int, units_per_day, days_of_cover FROM gold.store_stock',
    'stock_rules': 'SELECT sell_rate_days, watch_days, stock_ok_below, stock_good_below FROM gold.stock_rules',
}


def last_dbt_run():
    # generated_at of the last dbt invocation; falls back to the file's mtime
    try:
        return json.loads(RUN_RESULTS.read_text())['metadata']['generated_at']
    except (OSError, KeyError, ValueError):
        if RUN_RESULTS.exists():
            return datetime.fromtimestamp(RUN_RESULTS.stat().st_mtime, timezone.utc).isoformat()
        return None


def register(connect):
    router = APIRouter()

    @router.get('/api/warehouse')
    def warehouse():
        try:
            with connect() as conn:
                data = {name: conn.execute(sql).fetchall() for name, sql in QUERIES.items()}
        except psycopg.OperationalError as e:
            raise HTTPException(status_code=503, detail=f'Cannot reach Postgres: {e}')
        except psycopg.errors.UndefinedTable as e:
            raise HTTPException(status_code=503, detail=f'Gold models missing, run dbt first: {e}')

        # stock_rules is a single row of settings
        data['stock_rules'] = data['stock_rules'][0]
        # The data is historical, so "today" is the latest sale rather than the wall clock
        today = max((s['sale_datetime'] for s in data['sales']), default=None)
        return {**data, 'today': today, 'synced_at': last_dbt_run(), 'source': 'postgres'}

    return router
