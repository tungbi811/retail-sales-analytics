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


def data_info(connect) -> str:
    return f'{describe_lake()}\n\n{describe_gold(connect)}'
