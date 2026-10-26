# Pantio dashboard

React + Vite dashboard over the dbt gold models.

## Run with live data

In `dashboard/`, start the API (it reads Postgres using the root `.env`):

```bash
npm run api
```

Then, in a second terminal in `dashboard/`:

```bash
npm install
npm run dev
```

Vite proxies `/api` to `localhost:8000`.

## Run with sample data

```bash
VITE_DATA=sample npm run dev
```

The sample generator lives in `src/data/mock.ts`; the API loader in `src/data/source.ts`.

## Pages

Four tabs, each owning its own numbers so the same metric isn't shown twice:

- **Dashboard**: one month at a time (arrows by the date, or click a bar in the revenue chart): KPIs, year or month pace, revenue by month,
  revenue by day and region, the latest full day, sales by time and category mix.
- **Products**: three views.
  - **Stock board**, the default: one card per product in four lanes (Out of stock, Below safety, Low cover under 60 days, Healthy), with a category filter and a **Restock list** CSV.
  - **Sales**: what drove the sales change, and categories.
  - **Coverage**: stock against safety for every store × product.
- **Stores**: the store map and ranking.
- **Customers**: top customer, who buys, spend by age, customer health (active, returning, spend and orders per customer, each against the period before), who brings the revenue (top 10% / next 40% / bottom 50%), and the customer list.

All four read `/api/warehouse`. The business rules (stock levels, days of cover, lanes, the periods and what they
are compared with, monthly KPIs, returning customers, spend tiers) are worked out in dbt (`dbt/models/gold`, see
`dbt/README.md`); `src/data/metrics.ts` and `src/data/analytics.ts` look those up and add the breakdowns and charts.
Sample data (`VITE_DATA=sample`) and the test fixtures have no dbt behind them, so `src/data/mock.ts` mirrors the
rules for them.

The Stores map reads `latitude` / `longitude` from `gold.dim_store`, which come from the Address, City,
Latitude and Longitude columns of the Stores sheet. The Vietnam outline is pre-built from Natural Earth
(`world-atlas`); regenerate it with `node scripts/build-vn-map.mjs` if you change the extent.

## Header and rail

- **Search** (header button, or press `/`): stores, products and customers by name, city or category, accents optional.
  A store opens on the Stores map, a product opens its detail on Products, a customer shows their orders in place.
- **Data source** (the line under the logo): the source, last dbt run, rows loaded per table, and reload.
- **Help** (press `?`): what each metric means and which column it comes from.
- **dbt run** pill on the Dashboard: when the gold tables were last built; its refresh button reloads the data in place.

The rail on the left (bottom bar on phones) switches views: **Dashboard**, **Text to SQL**, and **Settings** at the bottom.

## Text to SQL

A question in plain words becomes SQL over the gold models (`POST /api/text-to-sql`, `api/routes/text_to_sql.py`,
`api/services/text_to_sql/`, `src/pages/TextToSqlPage.tsx`). It is laid out like an inbox: questions asked on the left,
the chat in the middle, the gold tables and query limits on the right.

The provider and model are chosen in **Settings** (`src/pages/SettingsPage.tsx`, `api/routes/settings.py`), which saves
them to the root `.env` and applies them at once:

| Provider | Key                                    | Default model      | Model variable              |
|----------|----------------------------------------|--------------------|-----------------------------|
| Claude   | `ANTHROPIC_API_KEY`                    | `claude-opus-5-5`  | `TEXT_TO_SQL_CLAUDE_MODEL`  |
| OpenAI   | `OPENAI_API_KEY`                       | `gpt-5.4-mini`     | `TEXT_TO_SQL_OPENAI_MODEL`  |
| Gemini   | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | `gemini-3.8-flash` | `TEXT_TO_SQL_GEMINI_MODEL`  |

`TEXT_TO_SQL_PROVIDER` holds the chosen provider (OpenAI when unset). OpenAI defaults to `gpt-5.4-mini`; a saved model overrides this default. Settings only answers requests from this computer,
and only the last four characters of a saved key are ever sent to the browser.

The model writes one SELECT; the API checks it, runs it in a read-only transaction with a 10 s timeout, returns at most
500 rows, and sends a failing query back to the same model once to fix. Without a key the page points to Settings.
The conversation stays while you switch views; **New chat** clears it.

## Tests

```bash
npm test
```

- `tests/metrics.test.mjs`: unit tests for the dashboard maths in `src/data/metrics.ts` (month windows, KPIs, pace, heatmap).
- `tests/dashboard.test.mjs`, `tests/rail.test.mjs`, `tests/stores.test.mjs`, `tests/products.test.mjs`, `tests/customers.test.mjs`:
  browser tests with Playwright against a mocked `/api/warehouse` (and `/api/text-to-sql`, `/api/settings/ai`);
  `tests/fixture.mjs` holds the shared fake warehouse.
  They need `npm run dev` running; set `DASHBOARD_URL` if it is not on `http://localhost:5173`.

The API (text-to-SQL guard, providers, repair loop, settings) has Python tests with fake clients in `tests/`, run from the project root:

```bash
uv run python -m unittest discover -s tests -t .
```
