import { useMemo } from 'react'
import type { Warehouse, FactSales } from '../data/types'
import { inRange, regions } from '../data/metrics'
import { lastMidnight, latestDay, recentSales, stackedByRegion, type Range } from '../data/analytics'
import { dayMonth, money, moneyShort, time } from '../lib/format'
import { toneOf } from '../lib/tones'
import { Info } from './Info'
import { DayRing, StackedBars } from './SalesViz'

interface Props {
  wh: Warehouse
  rows: FactSales[]
  range: Range
}

interface LatestProps extends Props {
  /** The month is still in progress, so its last orders are the newest ones. */
  current: boolean
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

export function RegionStack({ wh, rows, range }: Props) {
  const stacked = useMemo(() => stackedByRegion(wh, rows, range), [wh, rows, range])
  const regionList = useMemo(() => regions(wh), [wh])
  const cut = lastMidnight(range)
  const partial = range.to.getTime() - cut.getTime() > 1000 ? cut : null

  return (
    <section className="card byday-card" aria-labelledby="stack-title">
      <header className="card-head">
        <h2 className="card-title" id="stack-title">
          {stacked.weekly ? 'Revenue by week' : 'Revenue by day'}{' '}
          <Info text="Complete days only, stacked by the store's region. Long periods are grouped into weeks starting Monday. Dashed line: average bar." />
        </h2>
        <p className="legend">
          {stacked.regions.map((r) => (
            <span key={r}>
              <i className={`key ${toneOf(regionList, r)}`} /> {r}
            </span>
          ))}
          {partial && <span className="muted">{dayMonth(partial)} still open</span>}
        </p>
      </header>
      <StackedBars data={stacked} />
    </section>
  )
}

export function LatestDay({ wh, rows, range, current }: LatestProps) {
  const latest = useMemo(() => latestDay(rows, range), [rows, range])
  const recent = useMemo(() => recentSales(wh, inRange(rows, range.from, range.to), 5), [wh, rows, range])
  const month = range.from.toLocaleString('en', { month: 'long' })

  return (
    <section className="card latest-card" aria-labelledby="latest-title">
      <header className="card-head">
        <h2 className="card-title" id="latest-title">
          {current ? 'Latest full day' : `Last day of ${month}`}{' '}
          <Info text="Revenue of the last complete day, against the average complete day of the month. The ring wraps past 100% in a second colour." />
        </h2>
        <span className="live-pill">
          <span className="sync-dot" aria-hidden="true" />
          {latest.orders} orders
        </span>
      </header>
      <DayRing day={latest} />
      <p className="latest-note">
        An average day in {month} brings {moneyShort(latest.avgRevenue)} from {latest.avgOrders.toFixed(0)} orders.
      </p>
      <h3 className="sub-title">{current ? 'Just in' : `Last orders of ${month}`}</h3>
      <ul className="justin">
        {recent.map((s) => (
          <li key={s.sale_id}>
            <span className="avatar avatar-sm justin-avatar">{initials(s.customer)}</span>
            <span className="justin-main">
              <b>{s.customer}</b>
              <span>
                {s.product} × {s.quantity} · {s.city} · {time(s.sale_datetime)}
              </span>
            </span>
            <span className="justin-amt">{money(s.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
