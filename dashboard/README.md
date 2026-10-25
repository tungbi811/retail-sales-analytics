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

Five tabs, each owning its own numbers so the same metric isn't shown twice:

- **Dashboard**: one month at a time (arrows by the date, or click a bar in the revenue chart): KPIs, year or month pace, revenue by month,
  revenue by day and region, the latest full day, sales by time and category mix.
- **Products**: three views.
  - **Stock board**, the default: one card per product in four lanes (Out of stock, Below safety, Low cover under 60 days, Healthy), with a category filter and a **Restock list** CSV.
  - **Sales**: what drove the sales change, and categories.
  - **Coverage**: stock against safety for every store × product.
- **Stores**: the store map and ranking.
- **Customers**: top customer, who buys, spend by age, customer health (active, returning, spend and orders per customer, each against the period before), who brings the revenue (top 10% / next 40% / bottom 50%), and the customer list.
- **Ask**: questions in plain words, laid out like an inbox: questions asked on the left, the chat in the middle,
  the gold tables and query limits on the right. See [Ask](#ask) below.

All of them compute from the same `/api/warehouse` rows (`src/data/metrics.ts` for the dashboard cards,
`src/data/analytics.ts` for the rest).

The Stores map reads `latitude` / `longitude` from `gold.dim_store`, which come from the Address, City,
Latitude and Longitude columns of the Stores sheet. The Vietnam outline is pre-built from Natural Earth
(`world-atlas`); regenerate it with `node scripts/build-vn-map.mjs` if you change the extent.

## Tool rail

The rail on the left (bottom bar on phones) opens a panel beside the page, except Ask, which opens its tab:

- **Search** (or press `/`): stores, products and customers by name, city or category, accents optional.
  A store opens on the Stores map, a product opens its detail on Products, a customer shows their orders in place.
- **Stock alerts**: jumps to the stock board.
- **Ask**: opens the Ask tab.
- **Data**: the source, last dbt run, rows loaded per table, and reload.
- **Help**: what each metric means and which column it comes from.

## Ask

A question in plain words becomes SQL over the gold models (`POST /api/ask`, `api/ask.py`, `src/pages/AskPage.tsx`).
Pick the model in the switch beside the title; the choice is remembered:

| Model  | Key in the root `.env`              | Default model      | Change it with       |
|--------|-------------------------------------|--------------------|----------------------|
| Claude | `ANTHROPIC_API_KEY`                 | `claude-opus-5-5`  | `ASK_CLAUDE_MODEL`   |
| OpenAI | `OPENAI_API_KEY`                    | `gpt-6.1-sol`      | `ASK_OPENAI_MODEL`   |
| Gemini | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | `gemini-3.8-flash` | `ASK_GEMINI_MODEL` |

Whichever model is picked writes one SELECT; the API checks it, runs it in a read-only transaction with a 10 s
timeout, returns at most 500 rows, and sends a failing query back to the same model once to fix.
A model without a key is marked "no key", and asking it names the variable to add. Restart the API after editing `.env`.
The conversation stays while you switch tabs; **New chat** clears it.

## Tests

```bash
npm test
```

- `tests/metrics.test.mjs`: unit tests for the dashboard maths in `src/data/metrics.ts` (month windows, KPIs, pace, heatmap).
- `tests/dashboard.test.mjs`, `tests/rail.test.mjs`, `tests/stores.test.mjs`, `tests/products.test.mjs`: browser tests with
  Playwright against a mocked `/api/warehouse` (and `/api/ask`); `tests/fixture.mjs` holds the shared fake warehouse.
  They need `npm run dev` running; set `DASHBOARD_URL` if it is not on `http://localhost:5173`.

The text-to-SQL guard, the three providers and the repair loop have Python tests with fake clients, run from the project root:

```bash
uv run python -m unittest api.test_ask
```
