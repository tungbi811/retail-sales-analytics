"""Create an analysis kernel with read-only warehouse access and no model keys."""

from pathlib import Path

from autogen.coding import CodeBlock
from autogen.coding.jupyter import JupyterCodeExecutor, LocalJupyterServer

from api.services.insights.data import LAKE
from api.services.text_to_sql.providers import PROVIDERS


_KEY_VARS = [name for _, _, names in PROVIDERS.values() for name in names]
SETUP_CELL = f'''
import os
for _key in {_KEY_VARS!r}:
    os.environ.pop(_key, None)

from pathlib import Path
import duckdb
import pandas as pd
import warnings
import psycopg

LAKE = Path({str(LAKE)!r})

def gold(sql: str) -> pd.DataFrame:
    with psycopg.connect(
        host=os.getenv('POSTGRES_HOST'),
        dbname=os.getenv('POSTGRES_DATABASE'),
        user=os.getenv('POSTGRES_USER'),
        password=os.getenv('POSTGRES_PASSWORD'),
        options='-c default_transaction_read_only=on',
    ) as conn:
        with conn.cursor() as cursor:
            cursor.execute(sql)
            columns = [column.name for column in cursor.description]
            return pd.DataFrame(cursor.fetchall(), columns=columns)
'''


def open_kernel(workdir: Path) -> tuple[LocalJupyterServer, JupyterCodeExecutor]:
    workdir.mkdir(parents=True, exist_ok=True)
    server = LocalJupyterServer(log_file=str(workdir / 'jupyter.log'))
    try:
        executor = JupyterCodeExecutor(server, output_dir=workdir, timeout=1200)
        result = executor.execute_code_blocks([CodeBlock(language='python', code=SETUP_CELL)])
        if result.exit_code:
            raise RuntimeError(f'Kernel setup failed: {result.output}')
    except BaseException:
        server.stop()
        raise
    return server, executor
