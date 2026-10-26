import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, CornerDownRight, MessageSquarePlus, Send, Settings, Square, Telescope } from 'lucide-react'
import { agentName, ended, followEvents, reply, startRun, stop, type InsightsRun, type Previous, type StreamMessage } from '../data/insights'
import { count, time } from '../lib/format'
import { Report } from '../components/Report'

interface Provider {
  id: string
  label: string
  model: string
  ready: boolean
  active: boolean
}

interface Props {
  runs: InsightsRun[]
  onRuns: (update: (runs: InsightsRun[]) => InsightsRun[]) => void
  onSettings: () => void
}

const SUGGESTIONS = [
  'Which products will run out of stock next month?',
  'What revenue should we expect over the next three months?',
  'Which customers are likely to stop buying, and why?',
]

/**
 * A business question for the agent team. They explore the data lake and the gold models, talk it through
 * (shown live, or folded to one status line), and finish with a report. Earlier runs stay listed on the left until a reload.
 */
export function InsightsPage({ runs, onRuns, onSettings }: Props) {
  const [draft, setDraft] = useState('')
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [hidden, setHidden] = useState(false)
  // The run on screen; null follows the newest. Only the newest can still be going.
  const [selected, setSelected] = useState<string | null>(null)
  const run = runs[runs.length - 1]
  const going = run !== undefined && !ended(run)
  const shown = runs.find((r) => r.id === selected) ?? run
  const current = providers?.find((p) => p.active)
  // Until the providers load, or if the API can't list them, let questions through and show any error in the run.
  const connected = current?.ready ?? true

  useEffect(() => {
    fetch('/api/text-to-sql/providers')
      .then((r) => (r.ok ? r.json() : []))
      .then(setProviders)
      .catch(() => setProviders([]))
  }, [])

  // Follow the latest run while it is going. The API replays from the start, so keep only messages that are new.
  const runId = run?.id
  const live = going && !runId?.startsWith('local-')
  useEffect(() => {
    if (!runId || !live) return
    return followEvents(runId, (m, i) =>
      onRuns((list) => list.map((r) => (r.id === runId && i === r.messages.length ? { ...r, messages: [...r.messages, m] } : r))),
    )
  }, [runId, live, onRuns])

  function ask(question: string, previous?: Previous) {
    const q = question.trim()
    if (q.length < 3 || going || !connected) return
    setDraft('')
    setSelected(null)
    const startedAt = Date.now()
    startRun(q, previous)
      .then((id) => onRuns((list) => [...list, { id, question: q, messages: [], startedAt, previous }]))
      .catch((e: Error) =>
        onRuns((list) => [
          ...list,
          { id: `local-${startedAt}`, question: q, startedAt, previous, messages: [{ kind: 'error', text: e.message }, { kind: 'end', status: 'error' }] },
        ]),
      )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    ask(draft)
  }

  function stopRun() {
    if (!run) return
    const id = run.id
    stop(id)
      .then(() => onRuns((list) => list.map((r) => (r.id === id && !ended(r) ? { ...r, messages: [...r.messages, { kind: 'end', status: 'stopped' }] } : r))))
      .catch(() => undefined)
  }

  return (
    <main className="main ask-main">
      <div className="title-row">
        <div className="title-group">
          <h1>Insights</h1>
          <p className="ask-using">
            {current?.model && (
              <span>
                <b>{current.label}</b> · {current.model}
              </span>
            )}
            <button onClick={onSettings}>Change in Settings</button>
          </p>
        </div>
        <p className="sync">
          <span className="sync-dot" aria-hidden="true" />
          <b>Read-only</b> data lake and gold models
        </p>
      </div>

      <section className="ask-page insights-page">
        <aside className="ask-list" aria-label="Questions">
          <header className="ask-list-head">
            <h2>Questions</h2>
            <span className="muted">{runs.length ? `${count(runs.length)} asked` : 'none yet'}</span>
          </header>
          {runs.length === 0 ? (
            <p className="ask-none muted">Questions you ask the agents stay here until you reload the page.</p>
          ) : (
            <ul className="ask-threads">
              {runs
                .slice()
                .reverse()
                .map((r) => (
                  <li key={r.id}>
                    <button className="ask-thread" aria-current={shown?.id === r.id ? 'true' : undefined} onClick={() => setSelected(r.id)}>
                      <span className="ask-avatar" aria-hidden="true">
                        {r.previous ? <CornerDownRight size={15} strokeWidth={1.8} /> : <Telescope size={15} strokeWidth={1.8} />}
                      </span>
                      <span className="ask-thread-text">
                        <span className="ask-thread-top">
                          <b>{r.question}</b>
                          <time>{time(new Date(r.startedAt))}</time>
                        </span>
                        <span className={outcome(r).error ? 'ask-thread-sub is-error' : 'ask-thread-sub'}>{outcome(r).text}</span>
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
              <Telescope size={15} strokeWidth={1.8} />
            </span>
            <span className="ask-chat-who">
              <b>Agent team</b>
              <span className="muted">Business Analyst, Business Translator, Data Scientist and Coder</span>
            </span>
            {shown && (
              <button className="ask-new" aria-expanded={!hidden} onClick={() => setHidden((h) => !h)}>
                {hidden ? <ChevronDown size={14} strokeWidth={1.9} aria-hidden="true" /> : <ChevronUp size={14} strokeWidth={1.9} aria-hidden="true" />}
                {hidden ? 'Show discussion' : 'Hide discussion'}
              </button>
            )}
            {going && (
              <button className="ask-new" onClick={stopRun}>
                <Square size={13} strokeWidth={2} aria-hidden="true" /> Stop
              </button>
            )}
          </header>

          <div className="ask-log" aria-live="polite">
            {!run &&
              (connected ? (
                <div className="ask-in">
                  <span className="ask-avatar" aria-hidden="true">
                    <Telescope size={15} strokeWidth={1.8} />
                  </span>
                  <div className="ask-in-body">
                    <p className="ask-bubble">
                      Ask a business question that needs more than one query: what will run out, what revenue to expect, who is likely to stop buying. The agents explore the data lake, test their ideas in code, and write a report.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="ask-connect">
                  <p>
                    <b>Connect an AI provider in Settings</b>
                    {current?.label} has no API key yet. Add one, or pick another provider, to ask the agents.
                  </p>
                  <button className="btn btn-primary" onClick={onSettings}>
                    <Settings size={15} strokeWidth={1.8} aria-hidden="true" />
                    Open Settings
                  </button>
                </div>
              ))}
            {shown && (
              <RunView key={shown.id} run={shown} hidden={hidden} onSettings={onSettings} canAsk={!going && connected} onFollowUp={(q, previous) => ask(q, previous)} />
            )}
          </div>

          <div className={run ? 'ask-compose' : 'ask-compose is-empty'}>
            <ul className="ask-quick" aria-label="Example questions">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button disabled={going || !connected} onClick={() => ask(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
            <form className="ask-form" onSubmit={submit}>
              <label className="sr-only" htmlFor="insights-input">
                Your question
              </label>
              <textarea
                id="insights-input"
                rows={1}
                value={draft}
                maxLength={1000}
                disabled={!connected}
                placeholder="Ask the agents a business question…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    ask(draft)
                  }
                }}
              />
              <button className="ask-send" type="submit" disabled={going || !connected || draft.trim().length < 3} aria-label="Ask">
                <Send size={16} strokeWidth={1.9} />
              </button>
            </form>
            <p className="ask-hint">Agents take a few minutes and use the model chosen in Settings.</p>
          </div>
        </div>
      </section>
    </main>
  )
}

interface RunViewProps {
  run: InsightsRun
  hidden: boolean
  onSettings: () => void
  canAsk: boolean
  onFollowUp: (question: string, previous: Previous) => void
}

function RunView({ run, hidden, onSettings, canAsk, onFollowUp }: RunViewProps) {
  const end = run.messages.find((m) => m.kind === 'end')
  const report = run.messages.find((m) => m.kind === 'report')?.text
  // The Business Translator's last message is the report itself; show it once, as the report.
  const stream = run.messages.filter((m) => !(m.kind === 'message' && m.agent === 'BusinessTranslator' && m.text === report))
  const last = run.messages.findLast((m) => m.kind !== 'end')
  const waiting = !end && last?.kind === 'ask'
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hidden) bottom.current?.scrollIntoView({ block: 'end' })
  }, [run.messages.length, hidden])

  return (
    <article className="ask-entry">
      <div className="ask-out">
        {run.previous && <p className="insights-follow-of muted">Follow-up to: {run.previous.question}</p>}
        <p className="ask-q">{run.question}</p>
        <span className="ask-meta">
          <b>You</b> {time(new Date(run.startedAt))}
        </span>
      </div>

      {hidden ? (waiting ? <Item m={last} /> : !end && <Status run={run} />) : stream.map((m, i) => <Item key={i} m={m} />)}
      {!hidden && !end && !waiting && <Status run={run} />}
      {/* Keyed by position, so a second question from the agents gets a fresh box. */}
      {waiting && <ReplyBox key={run.messages.length} runId={run.id} />}

      {run.messages.map((m, i) =>
        m.kind === 'error' ? (
          <div key={`e${i}`} className="ask-connect insights-error" role="alert">
            <p>{m.text}</p>
            <button className="btn" onClick={onSettings}>
              <Settings size={15} strokeWidth={1.8} aria-hidden="true" />
              Open Settings
            </button>
          </div>
        ) : null,
      )}
      {end?.kind === 'end' && end.status === 'stopped' && <p className="insights-ended muted">Stopped. The agents did not finish this question.</p>}
      {end?.kind === 'end' && end.status === 'done' && report === undefined && <p className="insights-ended muted">The agents finished without a report.</p>}
      {report !== undefined && (
        <>
          <Report markdown={report} />
          <FollowUp disabled={!canAsk} onAsk={(q) => onFollowUp(q, { question: run.question, report })} />
        </>
      )}
      <div ref={bottom} />
    </article>
  )
}

/** The folded view: who spoke last and how long the run has taken. */
function Status({ run }: { run: InsightsRun }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const last = run.messages.findLast((m) => 'agent' in m && m.agent !== 'User')
  const who = last && 'agent' in last ? agentName(last.agent) : 'Business Analyst'
  const s = Math.max(0, Math.floor((now - run.startedAt) / 1000))
  return (
    <p className="insights-status" role="status">
      <span className="ask-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {`${who} is working · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}
    </p>
  )
}

function Item({ m }: { m: StreamMessage }) {
  if (m.kind === 'message' || m.kind === 'ask')
    return (
      <div className={m.agent === 'User' ? 'ask-out' : 'ask-in'}>
        {m.agent !== 'User' && <Avatar agent={m.agent} />}
        <div className="ask-in-body">
          <p className={m.agent === 'User' ? 'ask-q' : 'ask-bubble insights-bubble'}>{m.text}</p>
          <span className="ask-meta">
            <b>{m.agent === 'User' ? 'You' : agentName(m.agent)}</b>
          </span>
        </div>
      </div>
    )
  if (m.kind === 'code' || m.kind === 'output')
    return (
      <div className="ask-in">
        <Avatar agent={m.agent} />
        <div className="ask-in-body">
          <details className="insights-detail">
            <summary>
              {agentName(m.agent)} · {m.kind === 'code' ? 'ran code' : 'result'}
            </summary>
            <pre>{m.kind === 'code' ? m.code : m.text}</pre>
          </details>
        </div>
      </div>
    )
  return null
}

const INITIALS: Record<string, string> = { BusinessAnalyst: 'BA', BusinessTranslator: 'BT', DataScientist: 'DS', Coder: 'CO' }

function Avatar({ agent }: { agent: string }) {
  return (
    <span className="ask-avatar" aria-hidden="true">
      {INITIALS[agent] ?? agent.slice(0, 2).toUpperCase()}
    </span>
  )
}

function ReplyBox({ runId }: { runId: string }) {
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle')
  if (state === 'sent') return null
  function send(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setState('sending')
    reply(runId, text.trim())
      .then(() => setState('sent'))
      .catch((err: Error) => setState(err.message))
  }
  return (
    <form className="ask-form insights-reply" onSubmit={send}>
      <label className="sr-only" htmlFor="insights-reply">
        Your reply
      </label>
      <textarea id="insights-reply" rows={2} value={text} maxLength={2000} placeholder="Answer the Business Analyst…" onChange={(e) => setText(e.target.value)} />
      <button className="ask-send" type="submit" disabled={state === 'sending' || !text.trim()} aria-label="Send reply">
        <Send size={16} strokeWidth={1.9} />
      </button>
      {state !== 'idle' && state !== 'sending' && <p className="ask-error" role="alert">{state}</p>}
    </form>
  )
}

/** A next question that carries this run's question and report into a new run. */
function FollowUp({ disabled, onAsk }: { disabled: boolean; onAsk: (question: string) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  if (!open)
    return (
      <button className="btn insights-follow" disabled={disabled} onClick={() => setOpen(true)}>
        <MessageSquarePlus size={15} strokeWidth={1.8} aria-hidden="true" />
        Follow up
      </button>
    )
  function send(e: FormEvent) {
    e.preventDefault()
    if (text.trim().length < 3 || disabled) return
    onAsk(text.trim())
    setOpen(false)
    setText('')
  }
  return (
    <form className="ask-form insights-reply" onSubmit={send}>
      <label className="sr-only" htmlFor="insights-follow">
        Your follow-up question
      </label>
      <textarea id="insights-follow" rows={2} autoFocus value={text} maxLength={1000} placeholder="Ask a follow-up about this report…" onChange={(e) => setText(e.target.value)} />
      <button className="ask-send" type="submit" disabled={disabled || text.trim().length < 3} aria-label="Ask follow-up">
        <Send size={16} strokeWidth={1.9} />
      </button>
    </form>
  )
}

/** The one-line summary under a run in the list. */
function outcome(run: InsightsRun): { text: string; error?: boolean } {
  const end = run.messages.find((m) => m.kind === 'end')
  const error = run.messages.find((m) => m.kind === 'error')
  if (error?.kind === 'error') return { text: error.text, error: true }
  if (!end || end.kind !== 'end') return { text: 'Agents working…' }
  if (end.status === 'stopped') return { text: 'Stopped' }
  return { text: run.messages.some((m) => m.kind === 'report') ? 'Report ready' : 'Finished without a report' }
}
