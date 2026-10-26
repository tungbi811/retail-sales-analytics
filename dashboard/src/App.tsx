import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock, Download, RotateCw } from 'lucide-react'
import { loadWarehouse } from './data/source'
import type { Warehouse } from './data/types'
import {
  categoryMix,
  kpis,
  monthPace,
  monthWindow,
  monthly,
  regions,
  salesByTime,
  salesFor,
  stockAlerts,
  toCsv,
  yearPace,
  years,
  type RegionFilter,
} from './data/metrics'
import { dayMonth, setCurrency } from './lib/format'
import { Header, Rail, type Page, type Tool, type View } from './components/Shell'
import { DataPanel, HelpPanel, SearchPanel } from './components/ToolPanels'
import { RefreshContext } from './components/PageHead'
import { KpiCards } from './components/KpiCards'
import { FirstMonth, MonthGauge, YearGauge } from './components/YearGauge'
import { jump } from './lib/scroll'
import { RevenueChart } from './components/RevenueChart'
import { SalesByTime } from './components/SalesByTime'
import { CategoryMix } from './components/CategoryMix'
import { Segmented } from './components/Segmented'
import type { Period, Range } from './data/analytics'
import { LatestDay, RegionStack } from './components/SalesCards'
import { ProductsPage } from './pages/ProductsPage'
import { StoresPage, type SortKey } from './pages/StoresPage'
import { CustomersPage } from './pages/CustomersPage'
import { TextToSqlPage, type TextToSqlEntry } from './pages/TextToSqlPage'
import { SettingsPage } from './pages/SettingsPage'
import { ended, followEvents, type InsightsRun } from './data/insights'

interface Intent {
  n: number
  rankBy?: SortKey
  store?: string
  product?: string
}

// Insights brings a Markdown renderer, so it loads when first opened instead of with the dashboard.
const InsightsPage = lazy(() => import('./pages/InsightsPage').then((m) => ({ default: m.InsightsPage })))

// Which rail button lights up for a page, and where each one leads.
const VIEW_OF: Partial<Record<Page, View>> = { 'Text to SQL': 'ask', Insights: 'insights', Settings: 'settings' }
const PAGE_OF: Record<View, Page> = { dashboard: 'Dashboard', ask: 'Text to SQL', insights: 'Insights', settings: 'Settings' }

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; wh: Warehouse }

export default function App() {
  const [page, setPage] = useState<Page>('Dashboard')
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  // Filters follow you between pages, so switching tabs compares like with like.
  const [region, setRegion] = useState<RegionFilter>('All')
  const [period, setPeriod] = useState<Period>('MTD')
  // Where a link or search result lands: a store, a product, or the store ranking sorted by one column.
  const [intent, setIntent] = useState<Intent>({ n: 0 })
  const [tool, setTool] = useState<Tool | null>(null)
  // Text to SQL history lives here so leaving the page keeps the conversation.
  const [chat, setChat] = useState<TextToSqlEntry[]>([])
  // Insights runs too, so a run keeps streaming into its history while you look at other pages.
  const [insights, setInsights] = useState<InsightsRun[]>([])
  // The run whose result you have seen: the header announces a finished run until you have been on Insights.
  const [readRun, setReadRun] = useState<string | null>(null)
  const closeTool = useCallback(() => setTool(null), [])
  // The header buttons open their panel, or close it when it is already open.
  const toggleTool = useCallback((t: Tool) => setTool((cur) => (cur === t ? null : t)), [])

  // One light pastel theme.
  useEffect(() => {
    document.documentElement.dataset.palette = 'pastel'
    document.documentElement.dataset.theme = 'light'
  }, [])

  // "/" opens search and "?" opens help, from anywhere except a text field.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const panel = e.key === '/' ? 'search' : e.key === '?' ? 'help' : null
      if (panel && !e.metaKey && !e.ctrlKey && !t.closest('input, textarea, [contenteditable]')) {
        e.preventDefault()
        setTool(panel)
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  const fetchData = useCallback((sample?: boolean) => {
    setLoad({ status: 'loading' })
    loadWarehouse(sample)
      .then((wh) => {
        setCurrency(wh.currency)
        setLoad({ status: 'ready', wh })
      })
      .catch((e: Error) => setLoad({ status: 'error', message: e.message }))
  }, [])

  useEffect(() => fetchData(), [fetchData])

  // Follow the latest run from here rather than the Insights page, so it keeps streaming while you are elsewhere.
  // The API replays from the start, so keep only messages that are new.
  const run = insights[insights.length - 1]
  const runId = run?.id
  const runLive = run !== undefined && !ended(run) && !run.id.startsWith('local-')
  useEffect(() => {
    if (!runId || !runLive) return
    return followEvents(runId, (m, i) => {
      setInsights((list) => list.map((r) => (r.id === runId && i === r.messages.length ? { ...r, messages: [...r.messages, m] } : r)))
    })
  }, [runId, runLive])
  const runUnread = run !== undefined && ended(run) && readRun !== run.id

  // Leaving Insights after the latest run ended means you have seen how it ended.
  function show(p: Page) {
    if (page === 'Insights' && run && ended(run)) setReadRun(run.id)
    setPage(p)
  }

  const wh = load.status === 'ready' ? load.wh : null
  const allAlerts = useMemo(() => (wh ? stockAlerts(wh, 'All') : []), [wh])

  // Refresh keeps the current numbers on screen while it fetches, unlike fetchData, which shows the skeleton.
  const [refreshState, setRefreshState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const refresh = useMemo(
    () => ({
      state: refreshState,
      refresh: () => {
        setRefreshState('busy')
        loadWarehouse(false)
          .then((next) => {
            setCurrency(next.currency)
            setLoad({ status: 'ready', wh: next })
            setRefreshState('idle')
          })
          .catch(() => setRefreshState('failed'))
      },
    }),
    [refreshState],
  )

  function open(p: Page) {
    setIntent((i) => ({ n: i.n + 1 }))
    show(p)
  }

  function land(p: Page, target: Omit<Intent, 'n'>) {
    setIntent((i) => ({ n: i.n + 1, ...target }))
    show(p)
    setTool(null)
  }

  function rankStores(key: SortKey) {
    land('Stores', { rankBy: key })
    requestAnimationFrame(() => jump('ranking-title'))
  }

  function showAlerts() {
    show('Products')
    requestAnimationFrame(() => {
      const el = document.getElementById('stock-alerts')
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus({ preventScroll: true })
    })
  }

  return (
    <RefreshContext.Provider value={refresh}>
      <div className="app">
        <Header
          page={page}
          onPage={open}
          alerts={allAlerts}
          onAlerts={showAlerts}
          onTool={toggleTool}
          wh={wh}
          run={run}
          runUnread={runUnread}
          onRun={() => land('Insights', {})}
        />
        <Rail view={VIEW_OF[page] ?? 'dashboard'} onView={(v) => land(PAGE_OF[v], {})} />
        {wh && tool === 'search' && <SearchPanel wh={wh} onStore={(id) => land('Stores', { store: id })} onProduct={(id) => land('Products', { product: id })} onClose={closeTool} />}
        {wh && tool === 'data' && (
          <DataPanel
            wh={wh}
            onReload={(sample) => {
              setTool(null)
              fetchData(sample)
            }}
            onClose={closeTool}
          />
        )}
        {tool === 'help' && <HelpPanel onClose={closeTool} />}

        {page === 'Settings' ? (
          <SettingsPage />
        ) : page === 'Insights' ? (
          // Insights reads the data lake through the API, so it does not wait for the warehouse.
          <Suspense fallback={<Loading page={page} />}>
            <InsightsPage runs={insights} onRuns={setInsights} onSettings={() => land('Settings', {})} />
          </Suspense>
        ) : load.status === 'ready' ? (
          <PageView
            page={page}
            wh={load.wh}
            go={open}
            intent={intent}
            onRank={rankStores}
            onAlerts={showAlerts}
            region={region}
            onRegion={setRegion}
            period={period}
            onPeriod={setPeriod}
            chat={chat}
            onChat={setChat}
            onData={() => setTool('data')}
            onSettings={() => land('Settings', {})}
          />
        ) : load.status === 'error' ? (
          <main className="main">
            <div className="title-row">
              <h1>{page}</h1>
            </div>
            <section className="card placeholder" role="alert">
              <h2>Can't load the warehouse</h2>
              <p>{load.message}</p>
              <p>
                Start the API from the project root with <code>uv run uvicorn api.main:app --port 8000</code>, then retry.
              </p>
              <div className="placeholder-actions">
                <button className="btn btn-primary" onClick={() => fetchData()}>
                  <RotateCw size={15} strokeWidth={1.8} aria-hidden="true" />
                  Retry
                </button>
                <button className="btn" onClick={() => fetchData(true)}>
                  Use sample data
                </button>
              </div>
            </section>
          </main>
        ) : (
          <Loading page={page} />
        )}
      </div>
    </RefreshContext.Provider>
  )
}

function Loading({ page }: { page: Page }) {
  return (
    <main className="main" aria-busy="true" aria-label="Loading the warehouse">
      <div className="title-row">
        <h1>{page}</h1>
      </div>
      <div className="toolbar">
        <span className="skeleton skeleton-pill" />
      </div>
      <div className="kpis">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="skeleton skeleton-kpi" />
        ))}
      </div>
      <div className="row row-a">
        <span className="skeleton skeleton-panel" />
        <span className="skeleton skeleton-panel" />
      </div>
    </main>
  )
}

interface PageViewProps {
  page: Page
  wh: Warehouse
  go: (page: Page) => void
  intent: Intent
  onRank: (key: SortKey) => void
  onAlerts: () => void
  region: RegionFilter
  onRegion: (r: RegionFilter) => void
  period: Period
  onPeriod: (p: Period) => void
  chat: TextToSqlEntry[]
  onChat: (update: (e: TextToSqlEntry[]) => TextToSqlEntry[]) => void
  onData: () => void
  onSettings: () => void
}

function PageView({ page, intent, chat, onChat, onData, onSettings, ...p }: PageViewProps) {
  // Keyed per page and landing, so each mounts fresh, counts up, and opens on what was asked for.
  const key = `${page}-${intent.n}`
  switch (page) {
    case 'Products':
      return <ProductsPage key={key} {...p} product={intent.product} />
    case 'Stores':
      return <StoresPage key={key} {...p} rankBy={intent.rankBy} store={intent.store} />
    case 'Customers':
      return <CustomersPage key={key} {...p} />
    case 'Text to SQL':
      return <TextToSqlPage key={key} wh={p.wh} entries={chat} onEntries={onChat} onData={onData} onSettings={onSettings} />
    default:
      return <Dashboard key={key} {...p} />
  }
}

interface DashboardProps {
  wh: Warehouse
  go: (page: Page) => void
  onRank: (key: SortKey) => void
  region: RegionFilter
  onRegion: (r: RegionFilter) => void
}

function Dashboard({ wh, go, onRank, region, onRegion: setRegion }: DashboardProps) {
  const thisYear = wh.today.getFullYear()
  const regionTabs: { value: RegionFilter; label: string }[] = useMemo(
    () => [{ value: 'All', label: 'Overview' }, ...regions(wh).map((r) => ({ value: r, label: r }))],
    [wh],
  )
  const yearList = useMemo(() => years(wh), [wh])

  // The month every card shows. Pick it from the arrows by the date or by clicking a bar in the revenue chart.
  const [sel, setSel] = useState({ year: thisYear, month: wh.today.getMonth() })
  const year = sel.year
  const setYear = (y: number) => setSel({ year: y, month: y === thisYear ? wh.today.getMonth() : 11 })
  const first = wh.sales[0]?.sale_datetime ?? wh.today
  const index = (y: number, m: number) => y * 12 + m
  const step = (by: number) => {
    const d = new Date(sel.year, sel.month + by, 1)
    setSel({ year: d.getFullYear(), month: d.getMonth() })
  }
  const canBack = index(sel.year, sel.month) > index(first.getFullYear(), first.getMonth())
  const canForward = index(sel.year, sel.month) < index(thisYear, wh.today.getMonth())

  const rows = useMemo(() => salesFor(wh, region), [wh, region])
  const w = useMemo(() => monthWindow(wh, sel.year, sel.month), [wh, sel])
  const k = useMemo(() => kpis(wh, rows, w, region), [wh, rows, w, region])
  const pace = useMemo(() => yearPace(wh, rows), [wh, rows])
  const monthTrack = useMemo(() => monthPace(rows, w), [rows, w])
  const months = useMemo(() => monthly(wh, rows, year), [wh, rows, year])
  const finished = months.filter((p) => !p.future && !p.partial)
  const avgMonth = finished.length ? finished.reduce((t, p) => t + p.revenue, 0) / finished.length : 0
  const monthsBefore = useMemo(() => monthly(wh, rows, year - 1), [wh, rows, year])
  const heat = useMemo(() => salesByTime(rows, w.to), [rows, w])
  const mix = useMemo(() => categoryMix(wh, rows, w), [wh, rows, w])
  // The same window for the day-by-day cards.
  const month: Range = useMemo(() => ({ from: w.from, to: w.to, prevFrom: w.prevFrom, prevTo: w.prevTo, label: '', vs: '' }), [w])
  // The last sale, not the wall clock, is "now" for historical data.
  const lastSale = new Date(wh.today.getTime() - 1000)
  const live = wh.source === 'postgres'

  function exportCsv() {
    const blob = new Blob([toCsv(months, year, region)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pantio-revenue-${year}-${region.toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="main">
      <div className="title-row">
        <h1>Dashboard</h1>
      </div>

      <div className="toolbar">
        <Segmented label="Region" options={regionTabs} value={region} onChange={setRegion} />
        <div className="period period-picker">
          <button className="period-step" onClick={() => step(-1)} disabled={!canBack} aria-label="Previous month">
            <ChevronLeft size={15} strokeWidth={2} />
          </button>
          <p aria-live="polite">
            <Clock size={14} strokeWidth={1.8} aria-hidden="true" />
            {w.current ? `${k.monthLabel}, through ${dayMonth(lastSale)}` : k.monthLabel}
          </p>
          <button className="period-step" onClick={() => step(1)} disabled={!canForward} aria-label="Next month">
            <ChevronRight size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={exportCsv}>
            <Download size={15} strokeWidth={1.8} aria-hidden="true" />
            Export
          </button>
        </div>
      </div>

      {/* Rows stack on narrow screens; on wide ones they dissolve into one 4-column grid (see .dash in index.css). */}
      <div className="dash">
        <KpiCards k={k} go={go} region={region} onRegion={setRegion} onRank={onRank} />

        <div className="row row-a">
          {pace ? (
            <YearGauge pace={pace} onLink={() => setYear(thisYear)} />
          ) : (
            monthTrack ? <MonthGauge pace={monthTrack} onLink={() => jump('stack-title')} /> : <FirstMonth month={k.monthLabel.split(' ')[0]} revenue={k.revenue.value} average={avgMonth} year={sel.year} />
          )}
          <RevenueChart
            year={year}
            years={yearList}
            onYear={setYear}
            points={months}
            lastYear={monthsBefore}
            selected={year === sel.year ? sel.month : -1}
            onSelect={(m) => setSel({ year, month: m })}
          />
        </div>

        <div className="row sales-mid">
          <RegionStack wh={wh} rows={rows} range={month} />
          <LatestDay wh={wh} rows={rows} range={month} current={w.current} />
        </div>

        <div className="row row-b">
          <SalesByTime heat={heat} />
          <CategoryMix mix={mix} month={k.monthLabel.split(' ')[0]} />
        </div>
      </div>

      <p className="footnote">
        {live
          ? `Live from the Postgres gold models (fact_sales, stock_position, dim_store, dim_product). Sales run to ${dayMonth(lastSale)} ${thisYear}; amounts are shown as stored, without a currency.`
          : 'Sample data, generated in the browser in the shape of the dbt gold models (fact_sales, stock_position, dim_store, dim_product). None of these numbers are real.'}
      </p>
    </main>
  )
}
