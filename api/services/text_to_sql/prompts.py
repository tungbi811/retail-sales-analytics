from functools import lru_cache

# What the model is told: the rules, the gold schema read from Postgres, and the JSON shape of its answer.

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

# Columns whose distinct values are worth showing the model, so filters use the stored spelling.
VALUE_COLUMNS = [
    ('dim_store', 'region'),
    ('dim_store', 'city'),
    ('dim_product', 'category'),
    ('dim_customer', 'gender'),
    ('dim_customer', 'age_group'),
]


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
        'is_out_of_stock flag restock needs. Never sum stock across time. For sell rate, days of cover, stock level or '
        'restock cost use gold.stock_position (one row per store x product), and for a product\'s stock board lane use '
        'gold.product_stock (region \'All\' covers every store); do not work these out from fact_sales yourself.'
    )
    out.append(f"Sales run from {span['first']:%Y-%m-%d} to {span['last']:%Y-%m-%d %H:%M}; treat {span['last']:%Y-%m-%d} as today.")
    return '\n'.join(out)
