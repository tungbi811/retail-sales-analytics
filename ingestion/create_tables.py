import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
commands = """
    CREATE SCHEMA IF NOT EXISTS bronze;

    CREATE TABLE IF NOT EXISTS bronze.products(
        product_id TEXT,
        product_name TEXT,
        category TEXT
    );

    CREATE TABLE IF NOT EXISTS bronze.stores(
        store_id TEXT,
        store_name TEXT,
        region TEXT
    );

    -- Store positions added to the Stores sheet for the dashboard map
    ALTER TABLE bronze.stores
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS city TEXT,
        ADD COLUMN IF NOT EXISTS latitude TEXT,
        ADD COLUMN IF NOT EXISTS longitude TEXT;

    CREATE TABLE IF NOT EXISTS bronze.customers(
        customer_id TEXT,
        customer_name TEXT,
        gender TEXT,
        birth_year TEXT
    );

    CREATE TABLE IF NOT EXISTS bronze.sales(
        sale_id TEXT,
        date TEXT,
        product_id TEXT,
        store_id TEXT,
        customer_id TEXT,
        quantity TEXT,
        amount TEXT
    );

    CREATE TABLE IF NOT EXISTS bronze.inventory(
        inventory_id TEXT,
        store_id TEXT,
        product_id TEXT,
        stock_qty TEXT,
        safety_stock TEXT,
        unit_cost TEXT,
        stock_value TEXT,
        last_updated TEXT
    );
"""

if __name__ == '__main__':
    conn = None
    try:
        conn = psycopg2.connect(
            host=os.getenv('POSTGRES_HOST'),
            database=os.getenv('POSTGRES_DATABASE'),
            user=os.getenv('POSTGRES_USER'),
            password=os.getenv('POSTGRES_PASSWORD')
        )
        cur = conn.cursor()
        cur.execute(commands)
        cur.close()
        conn.commit()
        print("Tables created successfully in the 'bronze' schema.")
    except Exception as e:
        print(f"Error creating tables: {e}")
    finally:
        if conn is not None:
            conn.close()