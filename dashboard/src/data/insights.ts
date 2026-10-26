// The Insights API: start an agent-team run, follow its discussion as it streams, answer an agent, or stop it.

/** One item in a run's stream, exactly as api/services/insights/stream.py sends it. */
export type StreamMessage =
  | { kind: 'message'; agent: string; text: string }
  | { kind: 'code'; agent: 'Coder'; code: string }
  | { kind: 'output'; agent: string; tool?: string; text: string }
  | { kind: 'ask'; agent: 'BusinessAnalyst'; text: string }
  | { kind: 'report'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'end'; status: 'done' | 'stopped' | 'error' }

export interface Previous {
  question: string
  report: string
}

export interface InsightsRun {
  id: string
  question: string
  messages: StreamMessage[]
  startedAt: number
  previous?: Previous
  /** Message count when the last agent question was answered, so it stops waiting until the agents ask again. */
  answered?: number
}

async function post(path: string, body?: unknown): Promise<Response> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b) => b?.detail)
      .catch(() => null)
    throw new Error(typeof detail === 'string' ? detail : `The API answered ${res.status}. Is it running on port 8000?`)
  }
  return res
}

export async function startRun(question: string, previous?: Previous): Promise<string> {
  const res = await post('/api/insights/runs', { question, previous })
  return (await res.json()).id
}

export async function reply(id: string, text: string): Promise<void> {
  await post(`/api/insights/runs/${id}/reply`, { text })
}

export async function stop(id: string): Promise<void> {
  await post(`/api/insights/runs/${id}/stop`)
}

/**
 * Follows a run's stream. The API replays from the first message on every connection, so `i` is each message's
 * place in the run: the caller keeps what it already has and appends only `i === messages.length`.
 * Returns a function that closes the stream.
 */
export function followEvents(id: string, onMessage: (m: StreamMessage, i: number) => void): () => void {
  const source = new EventSource(`/api/insights/runs/${id}/events`)
  let i = 0
  let ended = false
  source.onopen = () => {
    i = 0
  }
  source.onmessage = (e) => {
    const m = JSON.parse(e.data) as StreamMessage
    onMessage(m, i++)
    if (m.kind === 'end') {
      ended = true
      source.close()
    }
  }
  source.onerror = () => {
    // A closed source will not retry: the API restarted or forgot the run.
    if (ended || source.readyState !== EventSource.CLOSED) return
    onMessage({ kind: 'error', text: 'Lost the connection to the agents. Is the API running on port 8000?' }, i++)
    onMessage({ kind: 'end', status: 'error' }, i++)
  }
  return () => source.close()
}

/** "BusinessAnalyst" → "Business Analyst". */
export const agentName = (agent: string) => agent.replace(/([a-z])([A-Z])/g, '$1 $2')

export const ended = (run: InsightsRun) => run.messages.some((m) => m.kind === 'end')

/** The agents asked something and are waiting for an answer. */
export const waiting = (run: InsightsRun) =>
  !ended(run) && run.messages[run.messages.length - 1]?.kind === 'ask' && run.answered !== run.messages.length
