import { createContext, useContext, type ReactNode } from 'react'
import { Clock, RotateCw } from 'lucide-react'
import type { Warehouse } from '../data/types'
import { PERIODS, type Period } from '../data/analytics'
import { DAY, regions, type RegionFilter } from '../data/metrics'
import { when } from '../lib/format'
import { Segmented } from './Segmented'

interface Props {
  title: string
  wh: Warehouse
  region?: RegionFilter
  onRegion?: (r: RegionFilter) => void
  period?: Period
  onPeriod?: (p: Period) => void
  /** Text next to the clock, usually the date span. */
  span: ReactNode
  actions?: ReactNode
  /** Views of the page, shown next to the title. */
  tabs?: ReactNode
}

/** Title and the region / period filters shared by the analytics pages. */
export function PageHead({ title, wh, region, onRegion, period, onPeriod, span, actions, tabs }: Props) {
  const regionTabs = [{ value: 'All' as RegionFilter, label: 'Overview' }, ...regions(wh).map((r) => ({ value: r, label: r }))]
  return (
    <>
      <div className="title-row">
        {tabs ? (
          <div className="title-group">
            <h1>{title}</h1>
            {tabs}
          </div>
        ) : (
          <h1>{title}</h1>
        )}
      </div>
      <div className="toolbar">
        {region !== undefined && onRegion ? (
          <Segmented label="Region" options={regionTabs} value={region} onChange={onRegion} />
        ) : (
          <span />
        )}
        <p className="period">
          <Clock size={14} strokeWidth={1.8} aria-hidden="true" />
          {span}
        </p>
        <div className="toolbar-actions">
          {actions}
          {period && onPeriod && <Segmented label="Period" options={PERIODS} value={period} onChange={onPeriod} />}
        </div>
      </div>
    </>
  )
}

/** Reloads the warehouse in place: the page keeps the old numbers until the new ones land. */
export const RefreshContext = createContext<{ state: 'idle' | 'busy' | 'failed'; refresh: () => void } | null>(null)

/** The header's data status: when dbt last built the gold models, amber after a day without a run. Opens the data panel; the arrow pulls the latest from Postgres. */
export function SyncPill({ wh, onData }: { wh: Warehouse | null; onData: () => void }) {
  const r = useContext(RefreshContext)
  if (!wh) return null
  const live = wh.source === 'postgres'
  const failed = r?.state === 'failed'
  const stale = live && !failed && wh.syncedAt !== null && Date.now() - wh.syncedAt.getTime() > DAY
  const title = [live && 'Last dbt run, from dbt/target/run_results.json', stale && 'Over a day since the last run']
  return (
    <div className="sync" title={title.filter(Boolean).join('. ') || undefined}>
      <button className="sync-main" aria-label="Data source and freshness" data-panel-toggle onClick={onData}>
        <span className={`sync-dot ${wh.syncedAt && !failed ? '' : 'sync-dot-off'} ${stale ? 'sync-dot-stale' : ''}`} aria-hidden="true" />
        <span className="sync-label">
          {failed ? (
            <b>Couldn't reach Postgres</b>
          ) : wh.syncedAt ? (
            <>
              <b>{live ? 'dbt run' : 'Synced'}</b> {when(wh.syncedAt)}
            </>
          ) : (
            <b>No dbt run recorded</b>
          )}
        </span>
      </button>
      {live && r && (
        <button
          className="sync-refresh"
          aria-label="Reload the latest data"
          title="Reload the latest data"
          aria-busy={r.state === 'busy'}
          disabled={r.state === 'busy'}
          onClick={r.refresh}
        >
          <RotateCw size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function Footnote({ wh, children }: { wh: Warehouse; children: ReactNode }) {
  return (
    <p className="footnote">
      {wh.source === 'postgres' ? children : 'Sample data, generated in the browser in the shape of the dbt gold models. None of these numbers are real.'}
    </p>
  )
}
