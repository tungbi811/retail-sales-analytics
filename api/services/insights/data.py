"""Describe the raw lake and warehouse tables available to the agents, as Markdown the Business Analyst reads directly."""

import json
from pathlib import Path

import duckdb


LAKE = Path(__file__).resolve().parents[3] / 'lake'
READERS = {'json': 'read_json_auto', 'jsonl': 'read_json_auto', 'csv': 'read_csv_auto', 'parquet': 'read_parquet'}


def describe_lake(root: Path = LAKE) -> str:
    catalog_path = root / '_catalog.json'
    if not catalog_path.exists():
        return 'The data lake is missing. Run uv run python -m ingestion.make_lake to create it.'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    parts = ['## Data lake', 'Raw files under `LAKE`, read with DuckDB in the Coder\'s notebook.']
    with duckdb.connect() as conn:
        conn.execute("SET TimeZone = 'UTC'")
        for source, entry in catalog.items():
            reader = READERS[entry['format']]
            source_sql = f"{reader}('{root / entry['path']}')"
            rows = conn.execute(f'SELECT count(*) FROM {source_sql}').fetchone()[0]
            cursor = conn.execute(f'SELECT * FROM {source_sql} LIMIT 1')
            names = [column[0] for column in cursor.description]
            sample = dict(zip(names, cursor.fetchone() or ()))
            table = '\n'.join(f'| `{name}` | {meaning} |' for name, meaning in entry['columns'].items())
            parts.append(
                f"### {source}\n"
                f"`{reader}('{{LAKE}}/{entry['path']}')` · {entry['format']} · {rows:,} rows · one row per {entry['grain']}\n\n"
                f"{entry['notes']}\n\n"
                f"| Column | Meaning |\n|---|---|\n{table}\n\n"
                f"Sample row: `{json.dumps(sample, ensure_ascii=False, default=str)[:600]}`")
    return '\n\n'.join(parts)


def describe_gold(connect) -> str:
    with connect() as conn:
        rows = conn.execute("""
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'gold'
            ORDER BY table_name, ordinal_position
        """).fetchall()
    tables: dict[str, list[str]] = {}
    for row in rows:
        tables.setdefault(row['table_name'], []).append(f"{row['column_name']} ({row['data_type']})")
    lines = '\n'.join(f'- `gold.{name}`: {", ".join(columns)}' for name, columns in tables.items())
    return f'## Gold warehouse\nCleaned Postgres tables built from the Excel file, read with `gold(sql)`.\n\n{lines}'


def lake_span(root: Path = LAKE) -> tuple[str, str] | None:
    '''First and last order day in the lake.'''
    if not (root / 'orders').exists():
        return None
    with duckdb.connect() as conn:
        conn.execute("SET TimeZone = 'UTC'")
        first, last = conn.execute(f"SELECT min(ts)::DATE, max(ts)::DATE FROM read_json_auto('{root}/orders/dt=*/part-0.jsonl')").fetchone()
    return str(first), str(last)


def usage(span: tuple[str, str] | None) -> str:
    '''Which data answers which kind of question. Facts about the sources, never findings.'''
    history = f'daily history from {span[0]} to {span[1]}' if span else 'daily history'
    return (
        '## Which data to use\n'
        f'- The data lake has the {history}. Use it for anything over time: trends, seasonality, forecasts, '
        'demand, lead times, promotion effects and customer behaviour.\n'
        '- The gold warehouse is a separate, cleaned snapshot built from one Excel file; its figures cover a different '
        'period from the lake. Use it only for names and attributes (product names and categories, store names and '
        'regions, customer details), never for figures in the same calculation as lake data.\n'
        '- Stock, deliveries and promotions are kept per store and product; answer at that grain where it applies.\n'
        '- Lake IDs are strings; cast them to integers to join gold tables. Name products and stores in results, not only IDs.')


def data_info(connect) -> str:
    return f'{usage(lake_span())}\n\n{describe_lake()}\n\n{describe_gold(connect)}'
