import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, CornerDownRight, Lightbulb, MessageSquarePlus, Send, Settings, Square, X } from 'lucide-react'
import { agentName, ended, followEvents, reply, startRun, stop, type InsightsRun, type Previous, type StreamMessage } from '../data/insights'
import { count, time } from '../lib/format'
import { Md, Report } from '../components/Report'

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

// Questions the data lake can answer: each needs orders, stock, deliveries, promotions or customer activity, not one query.
const SUGGESTIONS = [
  'Which products will run out of stock next month?',
  'What revenue should we expect over the next three months?',
  'Which customers are likely to stop buying, and why?',
  'Which promotions actually lifted sales, and by how much?',
  'Which suppliers deliver late most often, and what does it cost us?',
  'Which stores need more stock before the November–December peak?',
  'What do customers do in the weeks before they stop buying?',
  'How much do weekends and the year-end season add to revenue?',
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
  // A report the next question follows up on.
  const [followUp, setFollowUp] = useState<Previous | null>(null)
  // "<run id>:<message count>" of the last question answered, so its box closes until the agents ask again.
  const [answered, setAnswered] = useState<string | null>(null)
  const [replyError, setReplyError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const run = runs[runs.length - 1]
  const going = run !== undefined && !ended(run)
  const shown = runs.find((r) => r.id === selected) ?? run
  const asking = going && run.messages[run.messages.length - 1]?.kind === 'ask' && answered !== `${run.id}:${run.messages.length}`
  // One box at the bottom: a new question when nothing is running, the reply when an agent asks, and none while they work.
  const mode = !going ? 'ask' : asking ? 'reply' : null
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
    send()
  }

  function send() {
    if (mode === 'ask') {
      if (draft.trim().length < 3) return
      ask(draft, followUp ?? undefined)
      setFollowUp(null)
    } else if (mode === 'reply' && draft.trim()) {
      const key = `${run.id}:${run.messages.length}`
      const text = draft.trim()
      setReplyError(null)
      reply(run.id, text)
        .then(() => {
          setAnswered(key)
          setDraft('')
        })
        .catch((err: Error) => setReplyError(err.message))
    }
  }

  function startFollowUp(previous: Previous) {
    setFollowUp(previous)
    requestAnimationFrame(() => input.current?.focus())
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
            <div className="ask-try">
              <h3 className="panel-sub">Try asking</h3>
              <ul aria-label="Questions to try">
                {SUGGESTIONS.map((q) => (
                  <li key={q}>
                    <button disabled={!connected} onClick={() => ask(q)}>
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="ask-none muted">Questions you ask stay here until you reload the page.</p>
            </div>
          ) : (
            <ul className="ask-threads">
              {runs
                .slice()
                .reverse()
                .map((r) => (
                  <li key={r.id}>
                    <button className="ask-thread" aria-current={shown?.id === r.id ? 'true' : undefined} onClick={() => setSelected(r.id)}>
                      <span className="ask-avatar" aria-hidden="true">
                        {r.previous ? <CornerDownRight size={15} strokeWidth={1.8} /> : <Lightbulb size={15} strokeWidth={1.8} />}
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
              <Lightbulb size={15} strokeWidth={1.8} />
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
                    <Lightbulb size={15} strokeWidth={1.8} />
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
              <RunView key={shown.id} run={shown} hidden={hidden} onSettings={onSettings} canAsk={!going && connected} onFollowUp={startFollowUp} />
            )}
          </div>

          {mode && (
            <div className={run ? 'ask-compose' : 'ask-compose is-empty'}>
              {mode === 'ask' && !followUp && (
                <ul className="ask-quick" aria-label="Example questions">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button disabled={!connected} onClick={() => ask(s)}>
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {mode === 'ask' && followUp && (
                <p className="insights-follow-chip">
                  <CornerDownRight size={14} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    Follow-up to: <b>{followUp.question}</b>
                  </span>
                  <button aria-label="Cancel follow-up" onClick={() => setFollowUp(null)}>
                    <X size={14} strokeWidth={1.9} />
                  </button>
                </p>
              )}
              <form className="ask-form" onSubmit={submit}>
                <label className="sr-only" htmlFor="insights-input">
                  {mode === 'reply' ? 'Your reply' : followUp ? 'Your follow-up question' : 'Your question'}
                </label>
                <textarea
                  id="insights-input"
                  ref={input}
                  rows={1}
                  value={draft}
                  maxLength={mode === 'reply' ? 2000 : 1000}
                  disabled={!connected}
                  placeholder={mode === 'reply' ? 'Answer the Business Analyst…' : followUp ? 'Ask a follow-up about this report…' : 'Ask the agents a business question…'}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                />
                <button
                  className="ask-send"
                  type="submit"
                  disabled={!connected || draft.trim().length < (mode === 'reply' ? 1 : 3)}
                  aria-label={mode === 'reply' ? 'Send reply' : followUp ? 'Ask follow-up' : 'Ask'}
                >
                  <Send size={16} strokeWidth={1.9} />
                </button>
              </form>
              {replyError && mode === 'reply' && (
                <p className="ask-hint is-error" role="alert">
                  {replyError}
                </p>
              )}
              <p className="ask-hint">
                {mode === 'reply' ? 'The Business Analyst needs an answer before the agents go on.' : 'Agents take a few minutes and use the model chosen in Settings.'}
              </p>
            </div>
          )}
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
  onFollowUp: (previous: Previous) => void
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

      {run.messages.map((m, i) =>
        m.kind === 'error' ? (
          <div key={`e${i}`} className="ask-connect insights-error" role="alert">
            <p>{m.text}</p>
            {/* Only key and provider problems are fixed in Settings. */}
            {m.text.includes('Settings') && (
              <button className="btn" onClick={onSettings}>
                <Settings size={15} strokeWidth={1.8} aria-hidden="true" />
                Open Settings
              </button>
            )}
          </div>
        ) : null,
      )}
      {end?.kind === 'end' && end.status === 'stopped' && <p className="insights-ended muted">Stopped. The agents did not finish this question.</p>}
      {end?.kind === 'end' && end.status === 'done' && report === undefined && <p className="insights-ended muted">The agents finished without a report.</p>}
      {report !== undefined && (
        <>
          <Report markdown={report} />
          <button className="btn insights-follow" disabled={!canAsk} onClick={() => onFollowUp({ question: run.question, report })}>
            <MessageSquarePlus size={15} strokeWidth={1.8} aria-hidden="true" />
            Follow up
          </button>
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
  // After a hand-off, the agent it went to is the one working; after code, the Coder until its result is back.
  const next = last?.kind === 'output' && last.tool ? NEXT[last.tool] : last?.kind === 'code' ? 'Coder' : undefined
  const who = next ?? (last && 'agent' in last ? agentName(last.agent) : 'Business Analyst')
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

// What each agent tool's result is, in plain words. Hand-offs show open; data and code stay folded.
const HANDOFFS: Record<string, string> = {
  complete_business_analyst: 'Framed the question',
  execute_business_translation_step: 'Asked the Data Scientist',
  execute_data_scientist_step: 'Asked the Coder',
  complete_data_scientist_task: 'Findings for the Business Translator',
}
const NEXT: Record<string, string> = {
  complete_business_analyst: 'Business Translator',
  execute_business_translation_step: 'Data Scientist',
  execute_data_scientist_step: 'Coder',
  complete_data_scientist_task: 'Business Translator',
  run_code: 'Data Scientist',
}
const FOLDED: Record<string, string> = { get_data_info: 'read the data catalog', run_code: 'result' }

function Item({ m }: { m: StreamMessage }) {
  if ((m.kind === 'message' || m.kind === 'ask') && m.agent === 'User')
    return (
      <div className="ask-out">
        <p className="ask-q">{m.text}</p>
        <span className="ask-meta">
          <b>You</b>
        </span>
      </div>
    )
  if (m.kind === 'message' || m.kind === 'ask')
    return (
      <div className="ask-in">
        <Avatar agent={m.agent} />
        <div className="ask-in-body">
          <div className="ask-bubble insights-bubble">
            <Md text={m.text} />
          </div>
          <span className="ask-meta">
            <b>{agentName(m.agent)}</b>
          </span>
        </div>
      </div>
    )
  if (m.kind === 'output' && m.tool && HANDOFFS[m.tool])
    return (
      <div className="ask-in">
        <Avatar agent={m.agent} />
        <div className="ask-in-body">
          <div className="insights-handoff">
            <p className="insights-handoff-label">
              {agentName(m.agent)} · {HANDOFFS[m.tool]}
            </p>
            <Md text={m.text} />
          </div>
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
              {agentName(m.agent)} · {m.kind === 'code' ? 'ran code' : FOLDED[m.tool ?? ''] ?? 'result'}
            </summary>
            {m.kind === 'output' && m.tool === 'get_data_info' ? <Md text={m.text} /> : <pre>{m.kind === 'code' ? m.code : m.text}</pre>}
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


/** The one-line summary under a run in the list. */
function outcome(run: InsightsRun): { text: string; error?: boolean } {
  const end = run.messages.find((m) => m.kind === 'end')
  const error = run.messages.find((m) => m.kind === 'error')
  if (error?.kind === 'error') return { text: error.text, error: true }
  if (!end || end.kind !== 'end') return { text: 'Agents working…' }
  if (end.status === 'stopped') return { text: 'Stopped' }
  return { text: run.messages.some((m) => m.kind === 'report') ? 'Report ready' : 'Finished without a report' }
}
