import { useState, type CSSProperties } from 'react'
import type { MonthPoint } from '../data/metrics'
import { count, money, moneyShort, niceMax, signedPct } from '../lib/format'
import { Info } from './Info'
import { Segmented } from './Segmented'

interface Props {
  year: number
  years: number[]
  onYear: (y: number) => void
  points: MonthPoint[]
  /** Same months one year earlier, drawn as ghost bars for months not started yet. */
  lastYear: MonthPoint[]
  /** The month the dashboard shows; clicking a bar picks another. */
  selected: number
  onSelect: (month: number) => void
}

export function RevenueChart({ year, years, onYear, points, lastYear, selected, onSelect }: Props) {
  // The tooltip shows only while a bar is hovered or focused; otherwise the selected month stays highlighted.
  const [hover, setHover] = useState<number | null>(null)
  const active = hover ?? selected
  const hide = () => setHover(null)

  const heights = points.map((p, i) => (p.future ? lastYear[i].revenue : p.revenue))
  const max = niceMax(Math.max(...heights))
  const done = points.filter((p) => !p.future)
  const total = done.reduce((a, p) => a + p.revenue, 0)
  const avg = total / done.length
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i)
  const a = points[active]
  const ghost = a.future ? lastYear[active] : null

  return (
    <section className="card chart-card" aria-labelledby="rev-title">
      <header className="card-head">
        <h2 className="card-title" id="rev-title">
          Revenue <Info text="Sum of fact_sales.amount by calendar month. Dashed bars mark months with no sales yet, sized to last year's figure when there is one. Click a month to show it across the dashboard." />
          <span className="card-sub">{money(total)} so far this year</span>
        </h2>
        <Segmented small label="Year" options={years.map((y) => ({ value: y, label: String(y) }))} value={year} onChange={onYear} />
      </header>

      <div className="chart">
        <div className="y-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / max) * 100}%` }}>
              {moneyShort(t)}
            </span>
          ))}
        </div>
        <div className="plot">
          {ticks.map((t) => (
            <span key={t} className="grid-line" style={{ bottom: `${(t / max) * 100}%` }} aria-hidden="true" />
          ))}
          <span className="avg-line" style={{ bottom: `${(avg / max) * 100}%` }} aria-hidden="true">
            <span>avg {moneyShort(avg)}</span>
          </span>

          <div className="bars" onMouseLeave={hide}>
            {points.map((p, i) => {
              const h = (heights[i] / max) * 100
              const state = p.future ? 'is-future' : i === active ? 'is-active' : ''
              return (
                <button
                  key={p.month}
                  className={`bar-col ${state} ${i === selected ? 'is-selected' : ''}`}
                  aria-pressed={i === selected}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={hide}
                  onClick={() => !p.future && onSelect(i)}
                  aria-label={
                    p.future ? `${p.label} ${year}, no sales yet${lastYear[i].revenue ? `. ${year - 1}: ${money(lastYear[i].revenue)}` : ''}` : `${p.label} ${year}, revenue ${money(p.revenue)}`
                  }
                >
                  <span className="bar-track">
                    <span className="bar" style={{ height: `${h}%`, '--d': `${i * 28}ms` } as CSSProperties}>
                      {i === active && !p.future && <span className="bar-cap" />}
                    </span>
                  </span>
                  <span className="bar-label">{p.label}</span>
                </button>
              )
            })}
          </div>

          {hover !== null && (
            <div
              className={`tip ${active >= 9 ? 'tip-left' : ''}`}
              style={{
                left: `${((active + 0.5) / 12) * 100}%`,
                bottom: `min(${(heights[active] / max) * 100}%, calc(100% - 132px))`,
              }}
              aria-live="polite"
            >
              <p className="tip-title">
                {a.label} {year}
                {a.partial && <span> · to date</span>}
              </p>
              {ghost ? (
                <>
                  <p className="tip-row">
                    <span>No sales yet</span>
                  </p>
                  {ghost.revenue > 0 && (
                    <p className="tip-row">
                      <span>{year - 1}</span>
                      <b>{money(ghost.revenue)}</b>
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="tip-row">
                    <span>Revenue</span>
                    <b>{money(a.revenue)}</b>
                  </p>
                  <p className="tip-row">
                    <span>Orders</span>
                    <b>{count(a.orders)}</b>
                  </p>
                  {a.vsLastYear !== null && (
                    <p className="tip-row">
                      <span>vs last year</span>
                      <b className={a.vsLastYear >= 0 ? 'pos' : 'neg'}>{signedPct(a.vsLastYear)}</b>
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
