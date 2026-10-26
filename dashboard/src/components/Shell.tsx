import { useEffect, useRef, useState } from 'react'
import { useThumb } from '../lib/motion'
import { CircleAlert, CircleCheck, LayoutDashboard, LoaderCircle, MessageCircleQuestion, Package, Search, Settings, Sparkles, Lightbulb } from 'lucide-react'
import type { stockAlerts } from '../data/metrics'
import { ended, waiting, type InsightsRun } from '../data/insights'
import type { Warehouse } from '../data/types'
import { SyncPill } from './PageHead'

/** Pages in the top nav. Text to SQL, Insights and Settings are reached from the rail instead. */
export const PAGES = ['Dashboard', 'Products', 'Stores', 'Customers'] as const
export type Page = (typeof PAGES)[number] | 'Text to SQL' | 'Insights' | 'Settings'

type Alerts = ReturnType<typeof stockAlerts>

interface HeaderProps {
  page: Page
  onPage: (p: Page) => void
  alerts: Alerts
  onAlerts: () => void
  /** Toggles a tool panel: search from the search button, data from the source line under the brand. */
  onTool: (t: Tool) => void
  /** Null while the warehouse loads or after it failed to. */
  wh: Warehouse | null
  /** The latest Insights run, and whether it ended while you were on another page. */
  run?: InsightsRun
  runUnread: boolean
  onRun: () => void
}

export function Header({ page, onPage, alerts, onAlerts, onTool, wh, run, runUnread, onRun }: HeaderProps) {
  const source = wh?.source
  const navRef = useRef<HTMLElement>(null)
  const thumb = useThumb(navRef, '[aria-current="page"]', [page])
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M5 4h9.5a5.5 5.5 0 0 1 0 11H10v5H5z" fill="currentColor" />
            <path d="M10 8.5h4.2a2 2 0 0 1 0 4H10z" fill="var(--brand-cut)" />
          </svg>
        </span>
        <span>
          <span className="brand-name">Pantio</span>
          <button className="brand-sub" title="Data source" data-panel-toggle onClick={() => onTool('data')}>
            Sales warehouse{source === 'postgres' ? ' · live' : source === 'sample' ? ' · sample data' : ''}
          </button>
        </span>
      </div>

      <nav className="nav" aria-label="Main" ref={navRef}>
        <span className="nav-thumb" style={thumb} aria-hidden="true" />
        {PAGES.map((p) => (
          <button
            key={p}
            className="nav-item"
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        ))}
      </nav>

      <div className="header-end">
        <button className="search-btn" aria-label="Search, press /" data-panel-toggle onClick={() => onTool('search')}>
          <Search size={15} strokeWidth={1.8} aria-hidden="true" />
          <span className="search-btn-label">Search</span>
          <kbd aria-hidden="true">/</kbd>
        </button>
        <StockBell alerts={alerts} onAll={onAlerts} />
        {page !== 'Insights' && run && <RunChip run={run} unread={runUnread} onOpen={onRun} />}
        <SyncPill wh={wh} onData={() => onTool('data')} />
      </div>
    </header>
  )
}

/**
 * The Insights run away from its page: working, waiting on your answer, or finished since you last looked.
 * Hidden otherwise. Opens Insights.
 */
function RunChip({ run, unread, onOpen }: { run: InsightsRun; unread: boolean; onOpen: () => void }) {
  const going = !ended(run)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!going) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [going])

  const end = run.messages.find((m) => m.kind === 'end')
  const state = waiting(run) ? 'ask' : going ? 'working' : unread && end?.status === 'done' ? 'done' : unread && end?.status === 'error' ? 'error' : null
  if (!state) return null
  const minutes = Math.floor((now - run.startedAt) / 60_000)
  const [Icon, label, detail] = {
    working: [LoaderCircle, 'Agents working', minutes < 1 ? 'just started' : `${minutes} min`],
    ask: [MessageCircleQuestion, 'Agents need your answer', null],
    done: [CircleCheck, 'Report ready', null],
    error: [CircleAlert, 'Insights run failed', null],
  }[state] as [typeof Search, string, string | null]

  return (
    <button className={`sync run-chip run-chip-${state}`} title={run.question} onClick={onOpen} role="status">
      <Icon size={15} strokeWidth={2} aria-hidden="true" />
      <span className="run-chip-label">
        <b>{label}</b>
        {detail && ` · ${detail}`}
      </span>
    </button>
  )
}

/** Low-stock alerts: every store × product below safety stock, emptiest first. */
function StockBell({ alerts, onAll }: { alerts: Alerts; onAll: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const out = alerts.filter((a) => a.out).length

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="stock-bell" ref={ref}>
      <button
        className="icon-btn"
        aria-label={`Low stock, ${alerts.length} items below safety stock`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <Package size={17} strokeWidth={1.8} />
        {alerts.length > 0 && <span className="icon-badge">{alerts.length}</span>}
      </button>
      {open && (
        <div className="stock-pop" role="dialog" aria-label="Low stock">
          <header className="stock-pop-head">
            <b>Low stock</b>
            <span>
              {alerts.length ? `${alerts.length} below safety stock · ${out} out` : 'Everything is at or above safety stock'}
            </span>
          </header>
          <ul className="stock-pop-list">
            {alerts.slice(0, 6).map((a) => (
              <li key={a.id}>
                <span className="stock-pop-main">
                  <b>{a.product}</b>
                  <span>{a.store}</span>
                </span>
                <span className={`status ${a.out ? 'status-out' : 'status-low'}`}>{a.out ? 'Out' : 'Low'}</span>
                <span className="stock-pop-qty">
                  <b>{a.stock}</b> / {a.safety}
                </span>
              </li>
            ))}
          </ul>
          {alerts.length > 0 && (
            <button
              className="stock-pop-all"
              onClick={() => {
                setOpen(false)
                onAll()
              }}
            >
              See all {alerts.length} on the restock board
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export type Tool = 'search' | 'data' | 'help'

export type View = 'dashboard' | 'ask' | 'insights' | 'settings'

const VIEWS: { view: View; label: string; Icon: typeof Search }[] = [
  { view: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { view: 'ask', label: 'Text to SQL', Icon: Sparkles },
  { view: 'insights', label: 'Insights', Icon: Lightbulb },
]

/** Views beside every page: the dashboard pages, Text to SQL or Insights, with Settings at the bottom. */
export function Rail({ view, onView }: { view: View; onView: (v: View) => void }) {
  const button = ({ view: v, label, Icon }: (typeof VIEWS)[number]) => (
    <button key={v} className="rail-btn" aria-label={label} title={label} aria-current={view === v ? 'page' : undefined} onClick={() => onView(v)}>
      <Icon size={17} strokeWidth={1.8} />
    </button>
  )
  return (
    <aside className="rail" aria-label="Views">
      {VIEWS.map(button)}
      <span className="rail-gap" aria-hidden="true" />
      {button({ view: 'settings', label: 'Settings', Icon: Settings })}
    </aside>
  )
}
