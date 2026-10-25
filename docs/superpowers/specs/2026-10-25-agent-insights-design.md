# Agent Insights: a multi-agent team over a new data lake

Date: 2026-10-25 · Status: draft for review

## Intent

Everything Pantio does today looks backwards: Excel → Postgres bronze → dbt silver/gold → dashboard, plus Text to SQL,
which answers questions with one SQL query over gold. The owner wants forward-looking answers SQL cannot give:
which products will run out of stock next month, what revenue will be, which customers will churn.

The answer is to bring the owner's earlier project, `~/Projects/multi-agent-data-to-decisions`, into Pantio. That
project is a team of four AG2 agents that take a business question and data, run the whole data-science workflow
(frame the problem → analyse/model → turn results into recommendations), and return a report an executive can act on.
In Pantio the team works over a **new data lake** of raw files, not the warehouse, so it can find insights and make
predictions the warehouse was never shaped for.

All data in Pantio is fake, so the lake is generated too.

## Goals

1. A data lake of raw, structured and semi-structured files in mixed formats, consistent with the Excel data's IDs,
   with enough history for forecasting.
2. The four agents from the old project, running inside Pantio's API on AG2 0.14.x, reading the lake (and gold,
   read-only).
3. A new dashboard view, reached from a rail button below Text to SQL, where the user types a question, watches the
   agents discuss live (or hides it), answers the agents' clarifying question if asked, and gets a Markdown report.
4. The team uses the same provider and model as Text to SQL, chosen in Settings.

## Non-goals (for now)

- Charts in the report, and agents producing or reading images. The current model (`gpt-5.4-mini`) is the reason;
  charts are a later step.
- Saving runs to disk or a database. Runs live in the dashboard's memory like Text to SQL history.
- A Docker sandbox for agent code.
- Any change to the warehouse pipeline: it keeps reading `data/business_sale_test.xlsx`. The lake does not feed dbt.
- Scheduling agent runs in Airflow, multi-user support.

## Anti-goals (a failure even if it technically works)

- Text to SQL or Settings breaking because of the SDK downgrade.
- Agents writing to Postgres or to the lake. Both are read-only to them.
- Report numbers that do not come from code the Coder actually ran. The old Data Scientist rule stays:
  "Each response must be based on executed results, not assumptions."
- Rewriting the owner's agents into something unrecognisable. They hand-wrote the old project and reverted 18
  AI-assisted commits on 2026-10-13 to get back to their own version; the port keeps their prompts, Pydantic outputs,
  tools and hand-offs, changing only what Pantio requires (listed below).

## Decisions the owner made

### Framework and runtime

- **AG2 0.14.0** (the last 0.x release, 2026-06-26; still `from autogen import ...`), not AG2 1.x. Old code ran on
  AG2 0.9.9 via the `autogen==0.9.9` alias package. Note: AG2 is not Microsoft AutoGen (`autogen-agentchat`).
  Install `ag2[openai,anthropic,gemini,jupyter-executor]==0.14.0` (exact extras: builder's call, but all three
  providers and the Jupyter executor must work).
- **Downgrade Pantio's SDKs** into one environment rather than run a separate service. AG2 0.14.0 pins
  `openai<3`, `anthropic<1`, `google-genai<3`. Pantio has `openai 3.37.0`, `anthropic 2.3.0`, `google-genai 2.33.0`.
  Targets: `openai` 2.54.0, `anthropic` 0.125.0, `google-genai` unchanged. Text to SQL uses
  `client.beta.messages.create` (anthropic), `client.responses.create` (openai), `models.generate_content`
  (genai); all exist in the target versions. Settings uses `client.models.list()` for all three. The existing tests
  (`uv run python -m unittest discover -s tests -t .`) must pass after the downgrade, before any agent work starts.
- **Local Jupyter** for the Coder: `LocalJupyterServer` + `JupyterCodeExecutor`, as in the old project, so variables
  persist between the Coder's steps. Code runs on the owner's Mac with their permissions; accepted.
- **Same provider and model as Text to SQL**: `active_provider()` and `model_for()` from
  `api/services/text_to_sql/providers.py`, keys from the root `.env`. No second setting. Each agent's `LLMConfig`
  is built from these instead of the hard-coded `gpt-4.1-mini`.

### The four agents (port of the old project)

Kept as written in `multi_agents/*.py` and `group_chat.py`, including temperatures, Pydantic outputs, and flow:

1. **BusinessAnalyst** (initial agent): calls `get_data_info`, may call `request_clarification` (pauses the run and
   asks the user one question), then `complete_business_analyst` saving `objective`, `stakeholders_expectations`,
   `research_questions`, `problem_type` to context → hands to BusinessTranslator.
2. **BusinessTranslator** (orchestrator): system message filled with stakeholder expectations and research questions;
   sends one step at a time to DataScientist via `execute_business_translation_step`; loops until all research
   questions are answered; writes the final Markdown report (recommendations by stakeholder/theme, no technical
   jargon, traceable question → finding → recommendation). After work → back to the user (run ends).
3. **DataScientist**: picks the method, splits it into small steps sent to Coder via `execute_data_scientist_step`,
   reviews outputs, returns findings with `complete_data_scientist_task`.
4. **Coder**: writes Python, runs it with `run_code` in Jupyter. Success → output to `current_agent`; error → the
   first lines back to Coder to fix.

`DefaultPattern` with `group_after_work=AgentTarget(business_analyst)` and `max_rounds=200` stays (200 is the safety
cap).

**Changes Pantio requires, and only these:**

- `get_data_info` describes the lake sources and gold tables (see "Data the agents see") instead of
  `pd.read_csv` on uploaded files. The Analyst prompt's "call get_data_info first" rule stays.
- The "no plots / no visualisations" rules in the Coder and DataScientist prompts **stay** (no charts for now).
- `convert_message_to_markdown` **stays**, but uses the active provider and model from Settings, not `gpt-4.1-nano`.
- Coder's prompt gains the lake and gold access facts (paths, DuckDB, the read-only connection) it needs to load data.
- Known bug in the old `run_code`: two `except Exception` clauses, so the second never runs. Fix so a failed retry
  returns "Execution failed" as intended.

### The data lake

- A new store of raw files, separate from the warehouse; formats mixed across CSV, JSON, JSONL and Parquet; only
  structured or semi-structured data (no PDFs, images, free text documents).
- Fake, generated by a script, consistent with the Excel IDs (the same 20 products, 10 stores, 100 customers) so the
  agents can join lake data to gold.
- Includes a **denser order history** of its own (raw order events), since the Excel sales sheet has only 5,000 rows
  over 2024-01-01 → 2024-07-27, too thin to forecast from.
- **Independent of gold except for IDs.** The lake shares product, store and customer IDs with the Excel file but
  is its own history, about 300 orders a day. It doesn't contain or reproduce the Excel sales, and its stock
  snapshots don't have to match `fact_inventory`. So revenue and stock in an Insights report will differ from the
  dashboard. The report says its numbers are "from the data lake", and that is the stated exception to PRODUCT.md's
  "every number traces to a gold model column". Gold stays available to the agents for reference (product names,
  categories, store regions), not as the source of truth for lake figures.

### The screen

- A new rail button directly below Text to SQL (`dashboard/src/components/Shell.tsx`, `VIEWS`), label **Insights**,
  new `View` value, new page.
- The user types a question; the agents' discussion streams in **live, like a group chat** (option B from the
  mockup): every message labelled with its agent; the Coder's code and its output in collapsible blocks (the old
  Streamlit app's `in_expander`). A **Hide discussion** toggle collapses the stream to one status line
  (current agent + elapsed time).
- When the BusinessAnalyst asks a clarifying question, a reply box appears in the stream and the run waits.
- A **Stop** button ends a run early.
- When the run ends, the BusinessTranslator's Markdown report shows below the stream, rendered (headings, bullets,
  emphasis, tables). No charts.
- **The run ends after the report.** In the owner's code the BusinessTranslator's after-work is
  `RevertToUserTarget`, so AG2 sends one more `input_request` after the report. Pantio answers it with "exit"
  automatically, which leaves the agent code unchanged. It is told apart from a clarification request by who spoke
  last (the BusinessTranslator, after its final report). Jupyter shuts down when the run ends.
- **Follow up** button under a finished report: it starts a **new run** whose first message carries the previous
  question and report as context, plus the new question. No kernel or state is reused. The BusinessAnalyst still
  calls `get_data_info` and frames the problem, but it can build on the earlier report.
- Earlier runs stay while the user moves around the dashboard (kept in `App.tsx` state like Text to SQL's `chat`),
  and are gone on reload.

## Builder's calls (made by me, not confirmed by the owner; flag if wrong)

### Lake layout and contents

- Location: `lake/` at the repo root, Hive-style partitions where it makes sense
  (`lake/<source>/dt=YYYY-MM-DD/part-*.ext`). Generated files are git-ignored; the generator is committed and uses
  a fixed seed so re-running it gives identical files.
- Generator: `ingestion/make_lake.py` (or similar), run with `uv run python -m ingestion.make_lake`. Reads products,
  stores and customers from the Excel file so IDs match.
- Time span: **2023-01-01 → 2024-07-31** (19 months), so there is a full prior year for seasonality. "Today" for
  predictions is the last lake day; "next month" means August 2024.
- Sources (one per question type the owner named):

  | Source | Format | Grain | Serves |
  |---|---|---|---|
  | `orders` | JSONL, partitioned by day | one order event with nested lines (product, qty, unit price, discount), store, customer (or null for walk-ins), channel, timestamp | demand / revenue forecasting |
  | `stock_snapshots` | Parquet, partitioned by month | store × product × day: on-hand, safety stock | stock-out prediction |
  | `supplier_deliveries` | CSV | one delivery: product, store, supplier, ordered date, promised date, delivered date, qty | stock-out prediction (lead times) |
  | `promotions` | JSON | one promotion: products/categories, stores, start/end, discount % | revenue forecasting |
  | `web_events` | JSONL, partitioned by day | one event: customer, session, type (visit, view, cart, checkout, login), product, timestamp | churn |
  | `support_tickets` | JSON | one ticket or review: customer, store, order, category, rating 1–5, opened/closed | churn |

- Volume: about 300 orders a day, so roughly 170k orders and 300–500k order lines over the 19 months, plus web
  events at a similar scale. That is still small enough for DuckDB to read in seconds.
- Realistic signals baked in so the agents can find something true: weekly and yearly seasonality, promotion uplift,
  a few store × product pairs whose demand outruns deliveries (stock-outs in Aug 2024), and customers who go quiet
  after late deliveries or low ratings (churn). Also a little messiness typical of raw data (some nulls, a few
  duplicate events, mixed timestamp formats in one source).
- A catalog file (`lake/_catalog.json` or `lake/README.md`) describing each source: path pattern, format, columns,
  grain, meaning. `get_data_info` reads it, plus a small sample per source, so the Analyst sees what exists without
  loading everything.

### Data the agents see

- Lake: read with DuckDB from Python in Jupyter (`duckdb` added as a dependency).
- Gold: read-only Postgres access from Jupyter, using the same `POSTGRES_*` env vars and a read-only session
  (e.g. `default_transaction_read_only=on`). The agents must not be able to write.
- `get_data_info` lists lake sources (from the catalog) and gold tables (names and columns from
  `information_schema`).
- How hard "read-only" is: it guards against honest mistakes, not a model trying to write. A read-only session
  setting plus the prompt rule is enough. The Coder runs in local Jupyter with the owner's permissions, which the owner
  accepted, so it could undo the setting or open its own connection. No separate Postgres role and no file
  permissions on `lake/`. The Jupyter server gets an environment without the provider API keys, because the code
  doesn't need them.
- "Every number comes from executed code" relies on the existing prompt rule. There is no automated number check.
  The guard is the user's view: every Coder output stays visible in the discussion stream, so a number in the report
  can be traced by eye. The manual end-to-end run checks this once.

### Placement and API shape

- Agents ported to `api/services/insights/` (one module per agent plus the group chat, mirroring the old layout).
- Routes in `api/routes/insights.py`, registered in `api/main.py` like the others. Shape (builder may refine):
  start a run (question in, run id out); stream its events (Server-Sent Events); send the user's reply to a
  clarification; stop a run.
- A run executes in a background thread holding the AG2 event iterator (as `main.py` in the old project consumes
  `response.events`), translating events to messages for the stream: text messages, Coder tool calls (code), tool
  responses (outputs), input requests (clarification), run completion (report).
- One Jupyter server per run, working directory under `logs/insights/<run_id>/` (already git-ignored), shut down
  when the run ends or is stopped.
- Same error handling style as `api/routes/text_to_sql.py`: no key → "add one in Settings", rejected key, rate
  limit, unreachable API, each as a plain sentence in the stream.
- The page states that a run takes minutes, not seconds.

### Testing

- Python unit tests for: `get_data_info` over a tiny generated lake; event → stream-message translation; the run
  lifecycle (start, reply, stop) with a fake event iterator. No live model calls in tests.
- Lake generator test: fixed seed gives identical output; IDs match the Excel file.
- Dashboard tests in the existing style (`dashboard/tests/*.test.mjs`) for the rail button and the page states
  (streaming, hidden, waiting for reply, report).
- One manual end-to-end run with the real model on a forecasting question before calling it done.

## Left to the builder

- The exact generator distributions and parameters, within the shape above.
- How AG2 0.14's `LLMConfig` maps each Pantio provider (`api_type` for Claude/Gemini) and handling of model
  parameters a provider rejects (e.g. some newer models accept only the default temperature; fall back rather
  than fail).
- The SSE message format, the Markdown renderer for the dashboard, and the page's visual details, following
  `DESIGN.md`.
- Order of work, as long as the SDK downgrade and passing tests come first.
