# Agent Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team of four AG2 agents, ported from `~/Projects/multi-agent-data-to-decisions`, answers forward-looking business questions over a new generated data lake. It runs from a new "Insights" view in the dashboard, where the user watches the discussion live and gets a Markdown report.

**Architecture:** A seeded generator writes six raw sources to `lake/` as CSV, JSON, JSONL and Parquet. The agents run inside the FastAPI app on AG2 0.14.0, with one local Jupyter server per run. A `Run` object consumes AG2's event iterator in a background thread and turns the events into plain stream messages. The dashboard reads those messages over Server-Sent Events.

**Tech Stack:** Python 3.12, FastAPI, `ag2[openai,anthropic,gemini,jupyter-executor]==0.14.0`, DuckDB, pandas, pyarrow, React 19 + Vite, `react-markdown` + `remark-gfm`, Playwright tests.

**Spec:** `docs/superpowers/specs/2026-10-25-agent-insights-design.md`

## Global Constraints

- AG2 is pinned to `0.14.0`. Imports are `from autogen import ...`. Do not use AG2 1.x or Microsoft `autogen-agentchat`.
- SDKs: `openai==2.54.0`, `anthropic==0.125.0`, `google-genai` stays at 2.33.0. The existing tests must pass after the downgrade, before any agent work starts.
- Same provider and model as Text to SQL: use `active_provider()`, `model_for()` and `has_key()` from `api/services/text_to_sql/providers.py`. Add no new settings.
- The agents' prompts, Pydantic outputs, tools, temperatures, hand-offs, `DefaultPattern(group_after_work=AgentTarget(business_analyst))` and `max_rounds=200` are copied verbatim from the old repo's `multi_agents/*.py`. Change only what a task names.
- No charts. The "no plots / visualisations" rules stay in the Coder and DataScientist prompts.
- Agents are read-only on Postgres and on `lake/`. This guards against honest mistakes only: a read-only session plus the prompt rule.
- Lake: span 2023-01-01 → 2024-07-31, about 300 orders a day, the same product, store and customer IDs as `data/business_sale_test.xlsx`, a fixed seed, and git-ignored output.
- Rail button label: `Insights`. Report numbers are labelled "from the data lake".
- The working tree has unrelated uncommitted changes. Every commit `git add`s only the files its task lists.
- Python tests run with `uv run python -m unittest discover -s tests -t .`. Dashboard tests run with `cd dashboard && npm test`, which needs `npm run dev` running. No test calls a live model.

## Review Focus

1. **Stop during a long Coder step.** Stop must end the stream at once with `end: stopped`, and the Jupyter server must not be left running. Owner: Task 6 `test_stop_ends_stream_and_closes_jupyter`.
2. **Reload or reconnect mid-run (React StrictMode mounts twice).** The stream must replay from the start without duplicating or losing messages. Owner: Task 7 `test_events_replay_from_start`.
3. **No API key, or a rejected key.** The user should see a plain sentence pointing to Settings, not a stuck spinner. Owner: Task 7 `test_start_without_key_points_to_settings`, plus Task 6 `test_provider_error_becomes_error_message`.
4. **A clarification request versus the post-report input request.** Only the first should show a reply box. The second is auto-answered with "exit". Owner: Task 6 `test_input_after_translator_report_auto_exits`.
5. **A second question while a run is busy.** The UI disables Ask until the run ends, and the API answers 409. Owner: Task 7 `test_second_run_while_busy_is_409`, plus Task 9 `ask is disabled while a run is going`.

---

### Task 1: SDK downgrade and AG2 install

**Files:**
- Modify: `pyproject.toml`, `uv.lock`
- Modify: `.gitignore` (add `lake/`)
- Add to the commit: `docs/superpowers/specs/2026-10-25-agent-insights-design.md`, `docs/superpowers/plans/2026-10-25-agent-insights.md`

**Interfaces:**
- Produces: an environment where `import autogen; autogen.__version__ == '0.14.0'`, plus `duckdb` and `pyarrow` importable, with all existing tests green.

- [ ] **Step 1: Change dependencies.** Set `"anthropic==0.125.0"` and `"openai==2.54.0"`. Add `"ag2[openai,anthropic,gemini,jupyter-executor]==0.14.0"`, `"duckdb>=1.4"` and `"pyarrow>=21"`. Run `uv lock && uv sync`.
  Expected: the resolve succeeds. If `pandas>=3.1.0` or `numpy>=2.5.4` conflict with an AG2 extra, report the conflict instead of loosening Pantio's pins.
- [ ] **Step 2: Run the existing API tests.**
  Run: `uv run python -m unittest discover -s tests -t .`
  Expected: all pass. A failure means a Text to SQL or Settings call changed between SDK versions. Fix it in `api/services/text_to_sql/providers.py` without changing the tests' assertions.
- [ ] **Step 3: Smoke-check Settings against the real keys.** Start the API, then run `curl -s localhost:8000/api/text-to-sql/providers` and `curl -s -XPOST localhost:8000/api/text-to-sql -H 'content-type: application/json' -d '{"question":"Revenue by month"}'`.
  Expected: the providers list returns, and the question comes back with SQL and rows from `gpt-5.4-mini`.
- [ ] **Step 4: Commit.** Commit `pyproject.toml uv.lock .gitignore` plus the spec and plan with the message `Downgrade SDKs for AG2 0.14 and add the agent insights plan`.

### Task 2: Lake reference data, promotions and orders

**Files:**
- Create: `ingestion/lake/__init__.py`, `ingestion/lake/reference.py`, `ingestion/lake/promotions.py`, `ingestion/lake/orders.py`
- Test: `tests/lake/__init__.py`, `tests/lake/test_orders.py`

**Interfaces:**
- Produces:
  - `Reference` (dataclass): `products: pd.DataFrame` (`product_id, product_name, category`), `stores: pd.DataFrame` (`store_id, store_name, region, city`), `customers: pd.DataFrame` (`customer_id, gender, birth_year`). Loaded by `load_reference(xlsx: Path) -> Reference` from the Products, Stores and Customers sheets.
  - `START = date(2023, 1, 1)`, `END = date(2024, 7, 31)`, `SEED = 811` in `ingestion/lake/__init__.py`.
  - `make_promotions(ref, rng) -> list[dict]` with keys `promotion_id, name, product_ids, categories, store_ids, start, end, discount_pct`.
  - `make_orders(ref, promotions, rng) -> tuple[list[dict], set[str]]`: order events, plus the set of churner customer IDs that later tasks use. Each order event has `order_id, ts (ISO 8601), store_id, customer_id (None for walk-ins), channel ('store'|'web'|'app'), lines: [{product_id, qty, unit_price, discount_pct}]`.
  - `write_jsonl_by_day(rows, root: Path, source: str, ts_key='ts')` writes `root/<source>/dt=YYYY-MM-DD/part-0.jsonl`.

Shape the generator must produce, which the tests pin: a mean of 250–350 orders a day; weekend volume above weekday; Nov–Dec above Feb–Mar; lines inside an active promotion carry its `discount_pct`, with quantities above the non-promo baseline; about 15% of customers are churners whose order rate in the last 90 days is under a third of their first 90 days; about 30% of orders are walk-ins (`customer_id` None); 0.5% of events are exact duplicates; per-product unit prices stay in a band around a per-product base price.

- [ ] **Step 1: Write the failing tests** in `tests/lake/test_orders.py`, building a reference from the real Excel file:
  - `test_ids_match_excel`: every product, store and customer ID in the orders is in `load_reference(...)`.
  - `test_daily_volume`: the mean orders per day is within `[250, 350]`, every day from START to END has orders, and none fall outside.
  - `test_seasonality_and_weekends`: the mean of Nov–Dec 2023 daily orders exceeds Feb–Mar 2023 by more than 20%, and the weekend mean exceeds the weekday mean.
  - `test_promotions_lift_quantity`: the mean qty on promo lines exceeds non-promo lines for the same products.
  - `test_churners_fade`: for each churner, orders in the last 90 days are below a third of orders in their first 90 days, and churners make up 10–20% of customers.
  - `test_same_seed_same_output`: two runs with `np.random.default_rng(SEED)` give equal results.
- [ ] **Step 2: Run** `uv run python -m unittest tests.lake.test_orders -v`. Expected: an ImportError.
- [ ] **Step 3: Implement** `reference.py`, `promotions.py` (about 3 promotions a month, 5–25% off, 3–14 days long) and `orders.py`. Use a vectorised Poisson daily count times weekday and month multipliers. Keep it pure: no file writes except in `write_jsonl_by_day`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Generate lake orders and promotions`.

### Task 3: Lake stock, deliveries, engagement, catalog and the entry point

**Files:**
- Create: `ingestion/lake/stock.py`, `ingestion/lake/engagement.py`, `ingestion/lake/catalog.py`, `ingestion/make_lake.py`
- Modify: `README.md` (one line in the folder table and a "Data lake" run line)
- Test: `tests/lake/test_make_lake.py`

**Interfaces:**
- Consumes: Task 2's `Reference`, `make_promotions`, `make_orders`, `write_jsonl_by_day`, `START`, `END`, `SEED`.
- Produces:
  - `make_stock(ref, orders, rng) -> tuple[pd.DataFrame, pd.DataFrame]`: daily snapshots (`snapshot_date, store_id, product_id, on_hand, safety_stock`) and deliveries (`delivery_id, supplier, store_id, product_id, ordered_date, promised_date, delivered_date, qty`). Demand comes from the orders. A reorder is placed when on-hand drops below a reorder point, and it arrives after a supplier lead time. 4–8 store × product pairs get demand growth that outruns their resupply, so their projected on-hand reaches 0 during 2024-08.
  - `make_engagement(ref, orders, deliveries, churners, rng) -> tuple[list[dict], list[dict]]`: web events (`event_id, ts, customer_id, session_id, type in {visit, view, cart, checkout, login}, product_id|None`) and tickets (`ticket_id, kind in {ticket, review}, customer_id, store_id, order_id|None, category, rating 1–5|None, opened_at, closed_at|None`). Churners' web activity fades along with their orders, and they get more late-delivery tickets and low ratings than other customers. In one source, `opened_at` mixes two timestamp formats.
  - `write_catalog(root: Path, sources: dict[str, dict]) -> None` writes `lake/_catalog.json`: `{source: {path, format, grain, columns: {name: meaning}, notes}}` for the 6 sources.
  - `main(out: Path = Path('lake'), xlsx: Path = Path('data/business_sale_test.xlsx')) -> None` in `ingestion/make_lake.py`, run as `uv run python -m ingestion.make_lake`. It deletes `out` first, then writes:
    - `orders/dt=*/part-0.jsonl`, `web_events/dt=*/part-0.jsonl`
    - `stock_snapshots/month=YYYY-MM/part-0.parquet`
    - `supplier_deliveries/deliveries.csv`
    - `promotions/promotions.json`, `support_tickets/tickets.json`
    - `_catalog.json`

- [ ] **Step 1: Write the failing tests** in `tests/lake/test_make_lake.py`. They run `main(out=tmp)` once in `setUpClass` and read the output with DuckDB:
  - `test_all_sources_and_catalog`: all 6 sources exist with the formats above, and `_catalog.json` lists exactly those 6 with non-empty `columns`.
  - `test_stockouts_in_august`: at least 4 store × product pairs have a mean daily demand over the last 30 days that exceeds their last on-hand plus inbound deliveries divided by 31.
  - `test_churners_have_worse_experience`: churners' mean rating is lower than non-churners', and their share of late-delivery tickets is higher.
  - `test_rerun_is_identical`: a second `main` into another temp dir gives byte-identical `deliveries.csv` and `_catalog.json`.
- [ ] **Step 2: Run** `uv run python -m unittest tests.lake.test_make_lake -v`. Expected: an ImportError.
- [ ] **Step 3: Implement** the three modules and `main`.
- [ ] **Step 4: Run** the lake tests, then `uv run python -m ingestion.make_lake && du -sh lake`. Expected: PASS, and `lake/` under 200 MB.
- [ ] **Step 5: Commit** with the message `Generate the data lake: stock, deliveries, engagement, catalog`.

### Task 4: Data access and model config for the agents

**Files:**
- Create: `api/services/insights/__init__.py`, `api/services/insights/data.py`, `api/services/insights/llm.py`, `api/services/insights/kernel.py`
- Test: `tests/insights/__init__.py`, `tests/insights/test_data.py`, `tests/insights/test_llm.py`

**Interfaces:**
- Consumes: `lake/_catalog.json` (Task 3), plus `active_provider`, `model_for`, `PROVIDERS` and `key_var`.
- Produces:
  - `LAKE = Path(__file__).resolve().parents[3] / 'lake'`.
  - `describe_lake(root: Path = LAKE) -> str`: per source, its catalog entry plus 3 sample rows read with DuckDB. If the catalog is missing, it says to run `uv run python -m ingestion.make_lake`.
  - `describe_gold(connect) -> str`: gold table names and columns from `information_schema.columns where table_schema = 'gold'`.
  - `data_info(connect) -> str`: both together, used by the Business Analyst's `get_data_info`.
  - `llm_config(temperature: float) -> LLMConfig`: for the active provider and model, with `api_type` `openai` for openai, `anthropic` for claude and `google` for gemini; `api_key` from `os.getenv(key_var(provider))`; `stream=False`, `parallel_tool_calls=False`. Leave out `temperature` when the model only accepts the default. Decide that with `takes_temperature(provider, model) -> bool`: False for openai models matching `^(gpt-5|o\d)`, True otherwise.
  - `SETUP_CELL: str` in `kernel.py`: the Python run once as the first cell of every kernel. It pops every key env var named in `PROVIDERS`, imports `duckdb`, `pandas as pd` and `warnings`, sets `LAKE` to the absolute lake path, and defines `gold(sql: str) -> pd.DataFrame`. `gold` opens psycopg with the `POSTGRES_*` vars and `options='-c default_transaction_read_only=on'`.
  - `open_kernel(workdir: Path) -> tuple[LocalJupyterServer, JupyterCodeExecutor]`: starts a server logging to `workdir/jupyter.log` and an executor with `output_dir=workdir`, `timeout=1200`, then runs `SETUP_CELL`.

- [ ] **Step 1: Write the failing tests.**
  - `test_describe_lake_lists_six_sources_with_samples` uses a tiny lake from `ingestion.make_lake.main` in a temp dir, monkeypatching START and END to 14 days to keep it fast.
  - `test_describe_lake_without_catalog_says_how_to_make_it`.
  - `test_llm_config_follows_settings`: env `TEXT_TO_SQL_PROVIDER=claude`, `TEXT_TO_SQL_CLAUDE_MODEL=claude-opus-5-5`, `ANTHROPIC_API_KEY=k` gives `api_type == 'anthropic'` and `model == 'claude-opus-5-5'`.
  - `test_gpt5_mini_has_no_temperature`: openai with `gpt-5.4-mini` gives a config without `temperature`.
  - `test_setup_cell_drops_keys_and_is_read_only`: exec `SETUP_CELL` in a dict namespace with `OPENAI_API_KEY` set, with psycopg mocked. Afterwards `OPENAI_API_KEY` is not in `os.environ`, and `gold('select 1')` passes the read-only `options`.
- [ ] **Step 2: Run** `uv run python -m unittest tests.insights.test_data tests.insights.test_llm -v`. Expected: an ImportError.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Give the insights agents lake and gold access and the Settings model`.

### Task 5: Port the four agents

**Files:**
- Create: `api/services/insights/agents/__init__.py`, `business_analyst.py`, `business_translator.py`, `data_scientist.py`, `coder.py`, `group_chat.py`, `markdown.py`. Copy each from `~/Projects/multi-agent-data-to-decisions/multi_agents/` and keep the file names.
- Test: `tests/insights/test_agents.py`

**Interfaces:**
- Consumes: Task 4's `llm_config`, `data_info` and `open_kernel` executor.
- Produces:
  - `convert_message_to_markdown(message: str) -> str` in `markdown.py`. Same prompt as the old `utils/utils.py`, but it calls the active model through an `autogen.OpenAIWrapper` built from `llm_config(0)` instead of `gpt-4.1-nano`.
  - `BusinessAnalyst(connect)`, `BusinessTranslator()`, `DataScientist()` and `Coder(executor: JupyterCodeExecutor, stopped: threading.Event)`. Each builds its `LLMConfig` with `llm_config(<its old temperature>)`: 0.5, 0.3, 0.3 and 0.0 respectively.
  - `GroupChat(connect, executor, stopped)` with `.run(question: str) -> RunResponse`. It calls `run_group_chat(pattern, messages=question, max_rounds=200)` and returns the response object itself, not `.events`.

Allowed changes from the old code, and nothing else:
- `get_data_info` loses its `data_path` parameter and returns `convert_message_to_markdown(data_info(connect))`. The Analyst's prompt workflow step 2 now reads "call get_data_info first to see the data lake sources and the gold tables".
- The Coder's system message gains a block naming `LAKE`, DuckDB (`duckdb.sql(f"select ... from read_json_auto('{LAKE}/orders/*/*.jsonl')")`, `read_parquet`, `read_csv_auto`) and `gold(sql)`. It also states: "Never write to the lake or the database."
- The Coder's `run_code` uses the injected executor and fixes the double `except`: the first failure restarts the kernel, re-runs `SETUP_CELL` and retries; a second failure returns `Execution failed: <error>` with `RevertToUserTarget()`. If `stopped.is_set()`, it returns `ReplyResult(message='Stopped by the user.', target=TerminateTarget())` without running the code.
- `GroupChat.run` sends the question as the message, not `Data path: ... Requirements: ...`.

- [ ] **Step 1: Write the failing tests** with env `TEXT_TO_SQL_PROVIDER=openai`, `OPENAI_API_KEY=test` and no network:
  - `test_group_chat_wires_the_old_flow`: the pattern's initial agent is `BusinessAnalyst`, its agents are the 4 names in the old order, and `group_after_work` targets `BusinessAnalyst`.
  - `test_prompts_are_the_old_ones`: each agent's system message contains a distinctive line from the old file, for example `"You operate in an iterative loop until the Business Translator confirms the objective is met."`
  - `test_run_code_retries_then_fails_cleanly`: with a fake executor that raises twice, the reply message starts with `Execution failed` and the target is a `RevertToUserTarget`.
  - `test_run_code_after_stop_terminates`: with `stopped` set, the target is a `TerminateTarget` and the fake executor is never called.
  - `test_get_data_info_uses_lake_and_gold`: with `data_info` and `convert_message_to_markdown` patched, the message contains the patched text and the target is `BusinessAnalyst`.
- [ ] **Step 2: Run** `uv run python -m unittest tests.insights.test_agents -v`. Expected: an ImportError.
- [ ] **Step 3: Port** the files with only the allowed changes. Diff each file against the old one before committing.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Port the four agents to AG2 0.14 inside Pantio`.

### Task 6: Run lifecycle and event translation

**Files:**
- Create: `api/services/insights/stream.py`, `api/services/insights/runs.py`
- Test: `tests/insights/test_runs.py`

**Interfaces:**
- Consumes: Task 5's `GroupChat(connect, executor, stopped).run(question).events`, an iterator of AG2 events of type `text`, `tool_call`, `tool_response`, `input_request` and `run_completion`, and Task 4's `open_kernel`.
- Produces:
  - The stream message (a plain dict), which Tasks 7–9 use. Exactly these forms:
    - `{"kind": "message", "agent": str, "text": str}`
    - `{"kind": "code", "agent": "Coder", "code": str}`
    - `{"kind": "output", "agent": str, "text": str}`
    - `{"kind": "ask", "agent": "BusinessAnalyst", "text": str}`
    - `{"kind": "report", "text": str}`
    - `{"kind": "error", "text": str}`
    - `{"kind": "end", "status": "done" | "stopped" | "error"}`
  - `Translator.feed(event) -> list[dict]`, in `stream.py`, follows the old `main.py` rules:
    - text: `message`, skipping the User's first message.
    - Coder `tool_call`: `code`, taken from the `code` argument.
    - Any other `tool_call`: remember the sender.
    - `tool_response`: `output`, attributed to the remembered sender, else to `System`.
    - `input_request`: if the last `message` came from `BusinessTranslator`, emit `report` with that text and auto-respond `exit`. Otherwise emit `ask` with the last message or output text, and leave the request pending.
    - `run_completion`: `end` with `done`.
  - `follow_up_message(question: str, previous: dict | None) -> str` builds the first message. `previous` is `{"question", "report"}`. With a previous run, the message is "Earlier question: …\n\nEarlier report:\n…\n\nFollow-up question: …".
  - `Run`, in `runs.py`: `Run(question, previous, connect, workdir_root=Path('logs/insights'))` with these members:
    - `.id: str`
    - `.start()`: a daemon thread that runs `open_kernel`, then `GroupChat.run`, then feeds every event.
    - `.messages_after(i: int, timeout: float) -> list[dict]`: blocks on a `threading.Condition`.
    - `.reply(text) -> None`: raises `ValueError` if nothing is waiting.
    - `.stop() -> None`
    - `.done: bool`
  - When the thread finishes, by any path, it shuts down the Jupyter server in `finally`.
  - `RUNS: dict[str, Run]` and `busy() -> bool`, for whether any run is not done.
  - Provider SDK exceptions inside the thread become an `error` message using the same plain sentences as `api/routes/text_to_sql.py`, followed by `end` with `error`. Move that mapping into a shared `api/services/text_to_sql/errors.py: plain_error(provider, e) -> tuple[int, str]` and use it from both places.

- [ ] **Step 1: Write the failing tests.** Use a fake `GroupChat` whose `run` yields scripted events, and patch `open_kernel` with a fake server that records `stop()`.
  - `test_translates_old_event_kinds`: a scripted analyst → translator → scientist → coder sequence gives the exact message list.
  - `test_clarification_waits_for_reply`: an `input_request` after an Analyst `request_clarification` gives `ask`, and `reply('Only North')` calls the event's `respond('Only North')`.
  - `test_input_after_translator_report_auto_exits`: an `input_request` after a BusinessTranslator text gives `report` with that text, `respond('exit')` is called, and no `ask` appears.
  - `test_stop_ends_stream_and_closes_jupyter`: `stop()` during a blocked fake event appends `end: stopped` at once, sets `stopped`, auto-answers a pending input with `exit`, calls the fake server's `stop()`, and drops later events.
  - `test_provider_error_becomes_error_message`: a fake run raising `openai.AuthenticationError` gives `error` with `"The OpenAI API key was rejected. Check it in Settings."`, then `end: error`.
  - `test_follow_up_message_carries_context`.
- [ ] **Step 2: Run** `uv run python -m unittest tests.insights.test_runs -v`. Expected: an ImportError.
- [ ] **Step 3: Implement** `errors.py` (and switch `routes/text_to_sql.py` to it), `stream.py` and `runs.py`.
- [ ] **Step 4: Run** the new tests and the full suite. Expected: PASS, with the Text to SQL route tests unchanged.
- [ ] **Step 5: Commit** with the message `Run the agent team in the background and stream its messages`.

### Task 7: Insights API routes

**Files:**
- Create: `api/routes/insights.py`
- Modify: `api/main.py` (register the router), `README.md` (API table rows)
- Test: `tests/routes/test_insights.py`

**Interfaces:**
- Consumes: Task 6's `Run`, `RUNS`, `busy`, the stream message forms, and `has_key` / `active_provider`.
- Produces:
  - `POST /api/insights/runs` with body `{question: str (3–1000 chars), previous?: {question: str, report: str}}`. It returns `{id}`. It answers 503 `"<Label> has no API key. Add one in Settings."` when the key is missing, and 409 `"Agents are already working on a question."` when `busy()`.
  - `GET /api/insights/runs/{id}/events`: `text/event-stream`. Each stream message is one `data: <json>\n\n`. The stream replays from message 0 and closes after `end`. Unknown id gives 404.
  - `POST /api/insights/runs/{id}/reply` with body `{text}`: 204, or 409 when the run isn't waiting for a reply.
  - `POST /api/insights/runs/{id}/stop`: 204.

- [ ] **Step 1: Write the failing tests** with FastAPI `TestClient` and `Run` patched to a fake that has preset messages:
  - `test_start_without_key_points_to_settings`
  - `test_second_run_while_busy_is_409`
  - `test_events_replay_from_start`: two consecutive GETs on a finished run both return the full list, ending with `end`.
  - `test_reply_when_not_waiting_is_409`
  - `test_stop_returns_204`
- [ ] **Step 2: Run** `uv run python -m unittest tests.routes.test_insights -v`. Expected: an ImportError.
- [ ] **Step 3: Implement** the router with `register(connect)`, matching the other routes' pattern, using a `StreamingResponse` over `run.messages_after`.
- [ ] **Step 4: Run** the full Python suite. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Add the insights API`.

### Task 8: Insights view: rail button, live stream, hide, reply, stop

**Files:**
- Create: `dashboard/src/pages/InsightsPage.tsx`, `dashboard/src/data/insights.ts`
- Modify: `dashboard/src/components/Shell.tsx` (`View` gets `'insights'`, and `VIEWS` gets `{ view: 'insights', label: 'Insights', Icon: Telescope }` after Text to SQL), `dashboard/src/App.tsx` (`Page` gets `'Insights'`, plus `VIEW_OF`, `PAGE_OF` and `PageView`), `dashboard/src/index.css`
- Test: `dashboard/tests/insights.test.mjs`

**Interfaces:**
- Consumes: Task 7's endpoints and the stream message forms.
- Produces:
  - `startRun(question: string, previous?: {question: string; report: string}): Promise<string>`, `followEvents(id: string, onMessage: (m: StreamMessage) => void): () => void` (an `EventSource` that returns a close function), `reply(id, text)` and `stop(id)`, all in `data/insights.ts`.
  - `type StreamMessage` mirrors the Task 6 forms exactly.
  - `type InsightsRun = { id: string; question: string; messages: StreamMessage[]; startedAt: number; previous?: {question: string; report: string} }`.
  - `InsightsPage({ runs, onRuns, onSettings })`. Its state lives in `App.tsx` as `const [insights, setInsights] = useState<InsightsRun[]>([])`, like `chat`.

Behaviour: a question box with an Ask button. The page notes that "Agents take a few minutes and use the model chosen in Settings." The stream shows one bubble per message, labelled with the agent name; `code` and `output` appear in collapsed `<details>`.

A **Hide discussion** toggle collapses the stream to one status line: `"<last agent> is working · m:ss"`. The `ask` message shows a reply box under it. **Stop** is visible while the run has no `end`. An `error` shows its text with a link to Settings. Ask is disabled while the run has no `end`. Follow `DESIGN.md` tokens.

- [ ] **Step 1: Write the failing tests** in `dashboard/tests/insights.test.mjs`, in the style of `rail.test.mjs`. Route `**/api/insights/runs` and `**/api/insights/runs/*/events`, with `route.fulfill({ status: 200, headers: {'content-type': 'text/event-stream'}, body })`.
  - `rail shows Insights below Text to SQL`
  - `stream shows each agent's messages with code collapsed`
  - `hide discussion leaves one status line`
  - `ask shows a reply box that posts the reply`
  - `stop posts stop and ends the run`
  - `ask is disabled while a run is going`
  - `missing key error links to Settings`
- [ ] **Step 2: Run** `cd dashboard && node --test tests/insights.test.mjs` with `npm run dev` running. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` (all files), `npm run lint` and `npm run build`. Expected: all pass, and `rail.test.mjs` is unchanged and green.
- [ ] **Step 5: Commit** with the message `Add the Insights view with the live agent discussion`.

### Task 9: Report, Follow up, and history

**Files:**
- Modify: `dashboard/package.json` (add `react-markdown@10.1.0`, `remark-gfm@4.0.1`), `dashboard/src/pages/InsightsPage.tsx`, `dashboard/src/index.css`, `dashboard/README.md`
- Create: `dashboard/src/components/Report.tsx`
- Test: `dashboard/tests/insights.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 8's `InsightsRun`, `startRun(question, previous)`.
- Produces: `Report({ markdown }: { markdown: string })`, which renders GFM (headings, lists, emphasis, tables) with no raw HTML. Above the rendered report it shows the label `From the data lake`.

Behaviour:
- A `report` message renders as a `Report` card below the stream.
- Under the report, **Follow up** opens a question box. Sending it calls `startRun(newQuestion, {question: run.question, report})`, and the new run appears as its own entry, showing "Follow-up to: <earlier question>".
- Earlier runs are listed on the page, newest first. They survive switching views and are gone on reload.

- [ ] **Step 1: Write the failing tests:**
  - `report renders markdown tables with the data lake label`
  - `follow up starts a new run with the earlier question and report`: assert on the POST body.
  - `runs survive leaving and coming back to Insights`
  - `report html is not injected`: a report containing `<img src=x onerror=...>` shows as text.
- [ ] **Step 2: Run** `node --test tests/insights.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Run `npm install` for the two packages.
- [ ] **Step 4: Run** `npm test`, `npm run lint` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `Show the agents' report and allow follow-ups`.

### Task 10: End-to-end check with the real model

**Files:** none, unless a fix is needed.

- [ ] **Step 1: Prepare.** Run `uv run python -m ingestion.make_lake`, start the API and `npm run dev`. Settings shows OpenAI with `gpt-5.4-mini`.
- [ ] **Step 2: Ask** "Which products will run out of stock next month?" in Insights.
  Expected:
  - The Analyst calls `get_data_info`, then the Translator, Data Scientist and Coder loop in the stream.
  - The Coder reads `lake/` with DuckDB without errors piling up.
  - The report names store × product pairs that overlap the pairs the generator planted, with numbers that also appear in Coder outputs in the stream.
  - Jupyter is gone afterwards: `pgrep -f kernelgateway` prints nothing.
- [ ] **Step 3: Ask a follow-up:** "Only for the North region." Expected: a new run whose report builds on the first.
- [ ] **Step 4: Ask** "Which customers are likely to churn?" and press **Stop** midway. Expected: the stream ends with stopped, and Jupyter is shut down.
- [ ] **Step 5: Report.** Note the run times, the token cost if AG2 reports it, and anything the model got wrong. Commit only if fixes were needed.
