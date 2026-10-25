import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Copy, Database, Download, MessageSquarePlus, Search, Send, Settings, Sparkles } from 'lucide-react'
import type { Warehouse } from '../data/types'
import { count, dayMonth, moneyShort, time } from '../lib/format'
import { downloadCsv } from '../lib/csv'
import { Segmented } from '../components/Segmented'

export interface AskResult {
  question: string
  provider: ProviderId
  model: string
  sql: string
  explanation: string
  chart: 'none' | 'bar' | 'line'
  columns: string[]
  rows: Record<string, string | number | boolean | null>[]
  truncated: boolean
}

export type ProviderId = 'claude' | 'openai' | 'gemini'

interface Provider {
  id: ProviderId
  label: string
  model: string
  /** Its API key is set. */
  ready: boolean
  /** Chosen in Settings: Ask sends every question to it. */
  active: boolean
}

/** `id` is when the question was sent, `at` when the answer came back. */
export type AskEntry = { id: number; question: string; provider: ProviderId } & ({ status: 'loading' } | { status: 'done'; result: AskResult; at: number } | { status: 'error'; message: string; at: number })

type Show = 'all' | 'done' | 'error'

const SUGGESTIONS = [
  'Top 5 products by revenue in July',
  'Revenue by region for each month',
  'Which stores have products out of stock?',
  'Average order value by age group',
  'Which hour of the day sells the most?',
]

const SHOWN_ROWS = 100

const LABELS: Record<ProviderId, string> = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini' }
const INITIALS: Record<ProviderId, string> = { claude: 'CL', openai: 'OA', gemini: 'GE' }
const FALLBACK: Provider = { id: 'claude', label: 'Claude', model: '', ready: true, active: true }

/** The API answers with the provider chosen in Settings. */
async function askApi(question: string): Promise<AskResult> {
  const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.detail ?? `The API answered ${res.status}. Is it running on port 8000?`)
  return body
}

interface Props {
  wh: Warehouse
  entries: AskEntry[]
  onEntries: (update: (e: AskEntry[]) => AskEntry[]) => void
  onData: () => void
  onSettings: () => void
}

/**
 * Laid out like an inbox: questions asked on the left, the conversation in the middle, what the model can see on the right.
 * The model chosen in Settings writes the SQL; the API runs it read-only over the gold models.
 */
export function AskPage({ wh, entries, onEntries, onData, onSettings }: Props) {
  const [draft, setDraft] = useState('')
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [show, setShow] = useState<Show>('all')
  const [find, setFind] = useState('')
  const [active, setActive] = useState<number | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = entries.some((e) => e.status === 'loading')

  useEffect(() => {
    fetch('/api/ask/providers')
      .then((r) => (r.ok ? r.json() : []))
      .then(setProviders)
      .catch(() => setProviders([]))
    input.current?.focus()
  }, [])

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [entries.length, entries[entries.length - 1]?.status])

  function send(question: string) {
    const q = question.trim()
    if (q.length < 3 || busy || !connected) return
    const id = Date.now()
    setDraft('')
    setActive(id)
    const p = current.id
    onEntries((list) => [...list, { id, question: q, provider: p, status: 'loading' }])
    askApi(q)
      .then((result) => onEntries((list) => list.map((e) => (e.id === id ? { id, question: q, provider: p, status: 'done', result, at: Date.now() } : e))))
      .catch((err: Error) => onEntries((list) => list.map((e) => (e.id === id ? { id, question: q, provider: p, status: 'error', message: err.message, at: Date.now() } : e))))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    send(draft)
  }

  function jumpTo(id: number) {
    setActive(id)
    document.getElementById(`ask-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const current = providers?.find((p) => p.active) ?? FALLBACK
  // Until the providers load, or if the API can't list them, let questions through and show any error in the thread.
  const connected = current.ready
  const provider = current.id
  const failed = entries.filter((e) => e.status === 'error').length
  const needle = find.trim().toLowerCase()
  const listed = entries
    .filter((e) => (show === 'all' ? true : e.status === show) && (!needle || e.question.toLowerCase().includes(needle)))
    .slice()
    .reverse()
  const latest = entries[entries.length - 1]

  return (
    <main className="main ask-main">
      <div className="title-row">
        <div className="title-group">
          <h1>Ask</h1>
          <p className="ask-using">
            {current.model && (
              <span>
                <b>{current.label}</b> · {current.model}
              </span>
            )}
            <button onClick={onSettings}>Change in Settings</button>
          </p>
        </div>
        <p className="sync">
          <span className="sync-dot" aria-hidden="true" />
          <b>Read-only</b> gold models
        </p>
      </div>

      <section className="ask-page">
        <aside className="ask-list" aria-label="Questions">
          <header className="ask-list-head">
            <h2>Questions</h2>
            <span className="muted">{entries.length ? `${count(entries.length)} asked` : 'none yet'}</span>
          </header>
          <Segmented
            small
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              { value: 'all', label: 'All' },
              { value: 'done', label: 'Answered' },
              { value: 'error', label: failed ? `Failed ${failed}` : 'Failed' },
            ]}
          />
          <label className="ask-find">
            <Search size={15} strokeWidth={1.8} aria-hidden="true" />
            <span className="sr-only">Search questions</span>
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search questions" />
          </label>
          {entries.length === 0 ? (
            <div className="ask-try">
              <h3 className="panel-sub">Try asking</h3>
              <ul aria-label="Questions to try">
                {SUGGESTIONS.map((s) => (
                  <li key={s}>
                    <button disabled={!connected} onClick={() => send(s)}>
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : listed.length === 0 ? (
            <p className="ask-none muted">No questions match.</p>
          ) : (
            <ul className="ask-threads">
              {listed.map((e) => (
                <li key={e.id}>
                  <button className="ask-thread" aria-current={active === e.id ? 'true' : undefined} onClick={() => jumpTo(e.id)}>
                    <span className="ask-avatar" aria-hidden="true">
                      {INITIALS[e.provider]}
                    </span>
                    <span className="ask-thread-text">
                      <span className="ask-thread-top">
                        <b>{e.question}</b>
                        <time>{time(new Date(e.id))}</time>
                      </span>
                      <span className={e.status === 'error' ? 'ask-thread-sub is-error' : 'ask-thread-sub'}>
                        {e.status === 'loading' ? 'Writing the query…' : e.status === 'error' ? e.message : e.result.explanation}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="ask-chat">
          <header className="ask-chat-head">
            <span className="ask-avatar" aria-hidden="true">
              {INITIALS[provider]}
            </span>
            <span className="ask-chat-who">
              <span>
                <b>{current.label}</b>
                {current.model && <span className="ask-chip">{current.model}</span>}
              </span>
              <span className="muted">
                <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" /> Text to SQL{latest ? <> · {latest.question}</> : null}
              </span>
            </span>
            <button className="ask-new" disabled={entries.length === 0 || busy} onClick={() => onEntries(() => [])}>
              <MessageSquarePlus size={14} strokeWidth={1.9} aria-hidden="true" /> New chat
            </button>
          </header>

          <div className="ask-log" aria-live="polite">
            <p className="ask-day">Today</p>
            {entries.length === 0 &&
              (connected ? (
                <Incoming provider={provider} meta={current.label}>
                  <p className="ask-bubble">Ask about sales, stores, products, customers or stock. I write the SQL and run it read-only on the gold models.</p>
                </Incoming>
              ) : (
                <div className="ask-connect">
                  <p>
                    <b>Connect an AI provider in Settings</b>
                    {current.label} has no API key yet. Add one, or pick another provider, to start asking.
                  </p>
                  <button className="btn btn-primary" onClick={onSettings}>
                    <Settings size={15} strokeWidth={1.8} aria-hidden="true" />
                    Open Settings
                  </button>
                </div>
              ))}
            {entries.map((e) => (
              <article key={e.id} id={`ask-${e.id}`} className="ask-entry">
                <div className="ask-out">
                  <p className="ask-q">{e.question}</p>
                  <span className="ask-meta">
                    <b>You</b> {time(new Date(e.id))}
                  </span>
                </div>
                {e.status === 'loading' && (
                  <Incoming provider={e.provider}>
                    <p className="ask-bubble ask-typing">
                      <span className="ask-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="sr-only">{LABELS[e.provider]} is writing the query</span>
                    </p>
                  </Incoming>
                )}
                {e.status === 'error' && (
                  <Incoming provider={e.provider} meta={`${LABELS[e.provider]} ${time(new Date(e.at))}`}>
                    <p className="ask-bubble ask-error" role="alert">
                      {e.message}
                    </p>
                  </Incoming>
                )}
                {e.status === 'done' && (
                  <Incoming provider={e.result.provider} meta={`${LABELS[e.result.provider]} · ${e.result.model} ${time(new Date(e.at))}`}>
                    <Answer result={e.result} />
                  </Incoming>
                )}
              </article>
            ))}
            <div ref={end} />
          </div>

          <div className={entries.length ? 'ask-compose' : 'ask-compose is-empty'}>
            <ul className="ask-quick" aria-label="Example questions">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button disabled={busy || !connected} onClick={() => send(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
            <form className="ask-form" onSubmit={submit}>
              <label className="sr-only" htmlFor="ask-input">
                Your question
              </label>
              <textarea
                id="ask-input"
                ref={input}
                rows={1}
                value={draft}
                maxLength={500}
                disabled={!connected}
                placeholder="Ask a question…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send(draft)
                  }
                }}
              />
              <button className="ask-send" type="submit" disabled={busy || !connected || draft.trim().length < 3} aria-label="Ask">
                <Send size={16} strokeWidth={1.9} />
              </button>
            </form>
            <p className="ask-hint">
              <kbd>Enter</kbd> to send, <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
            </p>
          </div>
        </div>

        <Scope wh={wh} onData={onData} />
      </section>
    </main>
  )
}

/** What the model can query: the gold tables, how much is in them, and the limits on a query. */
function Scope({ wh, onData }: { wh: Warehouse; onData: () => void }) {
  const first = wh.sales[0]?.sale_datetime
  const last = wh.sales[wh.sales.length - 1]?.sale_datetime
  const tables = useMemo(
    () =>
      [
        ['fact_sales', wh.sales.length],
        ['fact_inventory', wh.inventory.length],
        ['dim_customer', wh.customers.length],
        ['dim_product', wh.products.length],
        ['dim_store', wh.stores.length],
      ] as const,
    [wh],
  )
  return (
    <aside className="ask-side" aria-label="What you can ask about">
      <header className="ask-side-head">
        <span className="ask-avatar ask-avatar-lg" aria-hidden="true">
          <Database size={20} strokeWidth={1.7} />
        </span>
        <span>
          <h2>Gold schema</h2>
          <span className="muted">{wh.source === 'postgres' ? 'Postgres, built by dbt' : 'Sample data'}</span>
        </span>
      </header>
      <dl className="ask-facts">
        {tables.map(([t, n]) => (
          <div key={t}>
            <dt>
              <code>{t}</code>
            </dt>
            <dd>{count(n)}</dd>
          </div>
        ))}
      </dl>
      <h3 className="panel-sub">Sales cover</h3>
      <p className="ask-side-text">{first && last ? `${dayMonth(first)} ${first.getFullYear()} to ${dayMonth(last)} ${last.getFullYear()}` : 'No sales'}</p>
      <h3 className="panel-sub">Every query</h3>
      <ul className="ask-rules">
        <li>One SELECT, nothing that writes</li>
        <li>Stops after 10 seconds</li>
        <li>Returns at most 500 rows</li>
      </ul>
      <button className="ask-side-link" onClick={onData}>
        Data source details
      </button>
    </aside>
  )
}

/** A message from the model: initials on the left, the bubble, then who and when underneath. */
function Incoming({ provider, meta, children }: { provider: ProviderId; meta?: string; children: ReactNode }) {
  return (
    <div className="ask-in">
      <span className="ask-avatar" aria-hidden="true">
        {INITIALS[provider]}
      </span>
      <div className="ask-in-body">
        {children}
        {meta && <span className="ask-meta">{meta}</span>}
      </div>
    </div>
  )
}

function Answer({ result }: { result: AskResult }) {
  const { columns, rows } = result
  const [copied, setCopied] = useState(false)
  if (!result.sql)
    return (
      <div className="ask-answer">
        <p className="ask-bubble ask-explain">{result.explanation}</p>
      </div>
    )

  function copy() {
    navigator.clipboard?.writeText(result.sql).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  const download = () => downloadCsv('pantio-answer.csv', columns, rows)

  return (
    <div className="ask-answer">
      <p className="ask-bubble ask-explain">{result.explanation}</p>
      <div className="ask-card">
      {rows.length === 0 ? <p className="muted">The query ran and returned no rows.</p> : <AnswerChart result={result} />}
      {rows.length > 0 && (
        <div className="ask-table-wrap">
          <table className="ask-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} scope="col" className={typeof rows[0][c] === 'number' ? 'num' : ''}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, SHOWN_ROWS).map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>
                      {typeof r[c] === 'number' ? count(r[c] as number) : String(r[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="ask-foot">
        <span className="muted">
          {rows.length > SHOWN_ROWS ? `Showing ${SHOWN_ROWS} of ${count(rows.length)} rows` : `${count(rows.length)} ${rows.length === 1 ? 'row' : 'rows'}`}
          {result.truncated && ', stopped at 500'}
        </span>
        {rows.length > 0 && (
          <button className="ask-tool" onClick={download}>
            <Download size={13} strokeWidth={2} aria-hidden="true" /> CSV
          </button>
        )}
      </div>
      <details className="ask-sql">
        <summary>SQL</summary>
        <pre>
          <code>{result.sql}</code>
        </pre>
        <button className="ask-tool" onClick={copy}>
          {copied ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : <Copy size={13} strokeWidth={2} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </details>
      </div>
    </div>
  )
}

/** Bars for a label against a number, a line for a date or month against a number. Other shapes stay a table. */
function AnswerChart({ result }: { result: AskResult }) {
  const { columns, rows, chart } = result
  const label = columns.find((c) => typeof rows[0][c] !== 'number') ?? columns[0]
  const value = columns.find((c) => c !== label && typeof rows[0][c] === 'number')
  if (chart === 'none' || !value || rows.length < 2) return null
  const values = rows.map((r) => Number(r[value]) || 0)
  const max = Math.max(...values, 1)

  if (chart === 'line') {
    const w = 520
    const h = 120
    const min = Math.min(...values, 0)
    const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 12) + 6, h - 8 - ((v - min) / (max - min || 1)) * (h - 22)])
    return (
      <figure className="ask-line">
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${value} by ${label}, from ${moneyShort(values[0])} to ${moneyShort(values[values.length - 1])}`}>
          <polyline points={pts.map((p) => p.join(',')).join(' ')} />
          {pts.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3" />
          ))}
        </svg>
        <figcaption>
          <span>{String(rows[0][label])}</span>
          <span>{String(rows[rows.length - 1][label])}</span>
        </figcaption>
      </figure>
    )
  }

  return (
    <ul className="ask-bars" aria-label={`${value} by ${label}`}>
      {rows.slice(0, 12).map((r, i) => (
        <li key={i}>
          <span className="ask-bar-label">{String(r[label])}</span>
          <span className="ask-bar-track" aria-hidden="true">
            <span style={{ width: `${(values[i] / max) * 100}%` }} />
          </span>
          <b>{moneyShort(values[i])}</b>
        </li>
      ))}
    </ul>
  )
}
