"""Describe the raw lake and warehouse tables available to the agents."""

import json
from pathlib import Path

import duckdb


LAKE = Path(__file__).resolve().parents[3] / 'lake'


def describe_lake(root: Path = LAKE) -> str:
    catalog_path = root / '_catalog.json'
    if not catalog_path.exists():
        return 'The data lake is missing. Run uv run python -m ingestion.make_lake to create it.'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    sources = {}
    readers = {'json': 'read_json_auto', 'jsonl': 'read_json_auto',
               'csv': 'read_csv_auto', 'parquet': 'read_parquet'}
    with duckdb.connect() as conn:
        conn.execute("SET TimeZone = 'UTC'")
        for source, entry in catalog.items():
            reader = readers[entry['format']]
            cursor = conn.execute(f'SELECT * FROM {reader}(?) LIMIT 3', [str(root / entry['path'])])
            columns = [column[0] for column in cursor.description]
            samples = [dict(zip(columns, row)) for row in cursor.fetchall()]
            sources[source] = {'catalog': entry, 'sample_rows': samples}
    return json.dumps(sources, ensure_ascii=False, indent=2, default=str)


def describe_gold(connect) -> str:
    with connect() as conn:
        rows = conn.execute("""
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'gold'
            ORDER BY table_name, ordinal_position
        """).fetchall()
    return json.dumps(rows, ensure_ascii=False, indent=2, default=str)


def data_info(connect) -> str:
    return f'Data lake:\n{describe_lake()}\n\nGold warehouse tables and columns:\n{describe_gold(connect)}'
