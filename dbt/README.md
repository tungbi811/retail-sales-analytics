# Pantio dbt project

bronze (raw Excel sheets) → silver (cleaned, typed, tested views) → gold (tables the dashboard and text to SQL read).

```
models/
├── bronze/sources.yml        the five tables ingestion/ loads
├── silver/                   stg_sales, stg_inventory, stg_products, stg_stores, stg_customers
└── gold/
    ├── core/                 the star schema: fact_sales, fact_inventory, dim_date, dim_product, dim_store, dim_customer
    ├── inventory/            business rules for stock
    │   ├── stock_position    store × product: units per day, days of cover, stock level, shortfall, restock cost
    │   ├── product_stock     product × region (and 'All'): stock, days of cover, low cover flag, stock board lane
    │   ├── store_stock       store: stock, sell rate, days of cover
    │   └── stock_rules       the settings below as one row, so the dashboard can name them
    ├── sales/                business rules for sales
    │   ├── report_periods    each month, MTD, 90D and YTD: the window and the window it is compared with
    │   └── sales_monthly     month × region (and 'All'): revenue, orders, units, avg order, like-for-like change
    └── exposures.yml         which dashboard page reads which table
```

## Business rules

The stock rules live in `models/gold/inventory` and their settings in `dbt_project.yml`:

| Setting            | Value | Meaning                                                                   |
|--------------------|-------|---------------------------------------------------------------------------|
| `sell_rate_days`   | 90    | Units per day = units sold in the 90 days up to the last sale, / 90       |
| `watch_days`       | 60    | A product goes on watch when no store is short but cover is under 60 days |
| `stock_ok_below`   | 2     | Stock level ok under 2× safety stock                                      |
| `stock_good_below` | 4     | good under 4×, deep from 4× up                                            |

Sales comparisons follow one rule, in `report_periods`: "now" is one second after the last sale, and a window in
progress (this month, the last 90 days, this year) is compared with the same span of the window before, never past
that window's end. A finished month is compared with the whole month before.

The dashboard and text to SQL read the results, so a rule changes in one place: edit the setting, run `dbt build`.
Sample data in the dashboard (`VITE_DATA=sample`) mirrors these rules in `dashboard/src/data/mock.ts`.

## Run

From this folder, with the root `.env` loaded:

```bash
uv run --env-file ../.env dbt build                       # models and every test
uv run --env-file ../.env dbt test --select test_type:unit # just the business-rule unit tests
uv run --env-file ../.env dbt docs generate && uv run --env-file ../.env dbt docs serve  # lineage, with the dashboard pages at the end
```
