import { useEffect, useState, type FormEvent } from 'react'
import { Check, PlugZap, TriangleAlert } from 'lucide-react'
import { Segmented } from '../components/Segmented'
import type { ProviderId } from './TextToSqlPage'

interface ProviderSettings {
  id: ProviderId
  label: string
  model: string
  default: string
  /** The end of the saved key, like "…4f2a", or null when none is saved. */
  key: string | null
}

interface AiSettings {
  provider: ProviderId
  providers: ProviderSettings[]
}

type Status = { state: 'idle' } | { state: 'busy' } | { state: 'ok'; message: string } | { state: 'failed'; message: string }

const IDLE: Status = { state: 'idle' }

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/settings/ai${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(typeof json?.detail === 'string' ? json.detail : `The API answered ${res.status}. Is it running on port 8000?`)
  return json
}

/** Which AI writes the SQL on the Text to SQL page: one provider, its model and its key, saved to the root .env. */
export function SettingsPage() {
  const [saved, setSaved] = useState<AiSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderId>('claude')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [test, setTest] = useState<Status>(IDLE)
  const [save, setSave] = useState<Status>(IDLE)

  useEffect(() => {
    call<AiSettings>('', 'GET')
      .then((s) => {
        setSaved(s)
        pick(s, s.provider)
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  const chosen = saved?.providers.find((p) => p.id === provider)

  function loadModels(p: ProviderId, pasted?: string) {
    call<{ models: string[]; error: string | null }>('/models', 'POST', { provider: p, key: pasted || undefined })
      .then((r) => {
        setModels(r.models)
        setModelsError(r.error)
      })
      .catch((e: Error) => setModelsError(e.message))
  }

  // Switching provider shows its saved model and key; a pasted key is not carried across.
  function pick(s: AiSettings, p: ProviderId) {
    const next = s.providers.find((x) => x.id === p)
    setProvider(p)
    setModel(next?.model ?? '')
    setKey('')
    setModels(next ? [next.model] : [])
    setModelsError(null)
    setTest(IDLE)
    setSave(IDLE)
    loadModels(p)
  }

  function connection() {
    return { provider, model, key: key.trim() || undefined }
  }

  function runTest() {
    setTest({ state: 'busy' })
    call<{ ok: boolean; error: string | null }>('/test', 'POST', connection())
      .then((r) => setTest(r.ok ? { state: 'ok', message: `Connected to ${chosen?.label} · ${model}` } : { state: 'failed', message: r.error ?? 'The connection failed.' }))
      .catch((e: Error) => setTest({ state: 'failed', message: e.message }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setSave({ state: 'busy' })
    call<AiSettings>('', 'PUT', connection())
      .then((s) => {
        setSaved(s)
        setKey('')
        setSave({ state: 'ok', message: 'Saved. Text to SQL uses this from the next question.' })
      })
      .catch((err: Error) => setSave({ state: 'failed', message: err.message }))
  }

  const changed = saved && chosen ? provider !== saved.provider || model !== chosen.model || key.trim() !== '' : false
  const options = models.includes(model) || !model ? models : [model, ...models]

  return (
    <main className="main">
      <div className="title-row">
        <h1>Settings</h1>
      </div>

      {loadError ? (
        <section className="card placeholder" role="alert">
          <h2>Can't load the settings</h2>
          <p>{loadError}</p>
        </section>
      ) : (
        <form className="card settings" onSubmit={submit} aria-busy={!saved}>
          <header className="settings-head">
            <h2>AI connection</h2>
            <p className="muted">The Ask page uses this provider to turn questions into SQL. Keys are saved to the root .env on this computer.</p>
          </header>

          <div className="settings-row">
            <span className="settings-label">Provider</span>
            {saved && <Segmented label="Provider" value={provider} onChange={(p) => pick(saved, p)} options={saved.providers.map((p) => ({ value: p.id, label: p.label }))} />}
          </div>

          <label className="settings-row">
            <span className="settings-label">Model</span>
            <select
              className="settings-input"
              value={model}
              onChange={(e) => {
                setModel(e.target.value)
                setTest(IDLE)
              }}
            >
              {options.map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === chosen?.default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
          {modelsError && (
            <p className="settings-note">
              <TriangleAlert size={14} strokeWidth={1.9} aria-hidden="true" /> Couldn't list models: {modelsError}
            </p>
          )}

          <label className="settings-row">
            <span className="settings-label">API key</span>
            <input
              className="settings-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              placeholder={chosen?.key ? `Saved key ${chosen.key}. Paste a new one to replace it.` : `Paste your ${chosen?.label ?? ''} API key`}
              onChange={(e) => {
                setKey(e.target.value)
                setTest(IDLE)
              }}
              onBlur={() => key.trim() && loadModels(provider, key.trim())}
            />
          </label>

          <footer className="settings-actions">
            <button type="button" className="btn" disabled={!saved || !model || test.state === 'busy'} onClick={runTest}>
              <PlugZap size={15} strokeWidth={1.8} aria-hidden="true" />
              {test.state === 'busy' ? 'Testing…' : 'Test connection'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!changed || !model || save.state === 'busy'}>
              {save.state === 'busy' ? 'Saving…' : 'Save'}
            </button>
            <span className="settings-status" role="status">
              {[test, save].map((s, i) =>
                s.state === 'ok' ? (
                  <span key={i} className="settings-ok">
                    <Check size={14} strokeWidth={2.2} aria-hidden="true" /> {s.message}
                  </span>
                ) : s.state === 'failed' ? (
                  <span key={i} className="settings-failed">
                    <TriangleAlert size={14} strokeWidth={1.9} aria-hidden="true" /> {s.message}
                  </span>
                ) : null,
              )}
            </span>
          </footer>
        </form>
      )}
    </main>
  )
}
