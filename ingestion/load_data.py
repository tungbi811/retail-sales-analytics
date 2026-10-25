import os
import re
from pathlib import Path
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Resolved from this file, so it works from any working directory (local run or Airflow task)
EXCEL_PATH = Path(__file__).resolve().parents[1] / 'data' / 'business_sale_test.xlsx'

SHEETS ={
    'Products': ('products', ['product_id', 'product_name', 'category']),
    'Stores': ('stores', ['store_id', 'store_name', 'region', 'address', 'city', 'latitude', 'longitude']),
    'Customers': ('customers', ['customer_id', 'customer_name', 'gender', 'birth_year']),
    'Sales': ('sales', ['sale_id', 'date', 'product_id', 'store_id', 'customer_id', 'quantity', 'amount']),
    'Inventory': ('inventory', ['inventory_id', 'store_id', 'product_id', 'stock_qty', 'safety_stock', 'unit_cost', 'stock_value', 'last_updated'])
}

def to_snake(name):
    return re.sub(r'([a-z])([A-Z])', r'\1_\2', name).lower()

def load_bronze_tables():
    load_dotenv()
    engine = create_engine(f'postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}@{os.getenv('POSTGRES_HOST')}:5432/{os.getenv('POSTGRES_DATABASE')}')

    dfs = pd.read_excel(EXCEL_PATH, sheet_name=None)

    with engine.begin() as conn:
        for sheet, (table, cols) in SHEETS.items():
            df = dfs[sheet]
            df.columns = [to_snake(c) for c in df.columns]
            df = df[cols]
            conn.execute(text(f'TRUNCATE bronze.{table}'))
            df.to_sql(table, conn, schema='bronze', if_exists='append', index=False)
            print(f"{table}: {len(df)} rows")

if __name__ == '__main__':
    load_bronze_tables()
