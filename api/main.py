from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI

from api.db import connect
from api.routes import settings, text_to_sql, warehouse

# API over the dbt gold models, consumed by the dashboard in dashboard/.
# Run from the project root: uv run uvicorn api.main:app --reload --port 8000

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

app = FastAPI(title='Pantio API')

app.include_router(warehouse.register(connect))
app.include_router(text_to_sql.register(connect))
app.include_router(settings.register())
