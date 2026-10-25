import { useState } from 'react'
import type { latestDay, stackedByRegion } from '../data/analytics'
import { dayMonth, money, moneyShort } from '../lib/format'
import { useTween } from '../lib/motion'
import { toneOf } from '../lib/tones'

type Day = ReturnType<typeof latestDay>

/** Ring filled by the latest complete day's revenue against an average day; past 100% the ring wraps in a second colour. */
export function DayRing({ day }: { day: Day }) {
  const ratio = day.avgRevenue ? day.revenue / day.avgRevenue : 0
  const p = useTween(Math.min(2, ratio), 1100)
  const r = 74
  const c = 2 * Math.PI * r
  const first = Math.min(1, p)
  const over = Math.max(0, p - 1)
  const diff = (ratio - 1) * 100
  return (
    <div className="day-ring">
      <svg viewBox="0 0 180 180" role="img" aria-label={`${Math.round(ratio * 100)} percent of an average day`}>
        <circle cx="90" cy="90" r={r} className="day-ring-track" />
        <circle cx="90" cy="90" r={r} className="day-ring-fill" strokeDasharray={`${c * first} ${c}`} transform="rotate(-90 90 90)" />
        {over > 0 && <circle cx="90" cy="90" r={r} className="day-ring-over" strokeDasharray={`${c * over} ${c}`} transform="rotate(-90 90 90)" />}
      </svg>
      <div className="day-ring-center">
        <span className="day-ring-label">{dayMonth(day.date)}</span>
        <b>{moneyShort(day.revenue)}</b>
        <span className={diff >= 0 ? 'pos' : 'neg'}>
          {diff >= 0 ? '+' : '−'}
          {Math.abs(diff).toFixed(0)}% vs avg day
        </span>
      </div>
    </div>
  )
}

type Stacked = ReturnType<typeof stackedByRegion>

/** Revenue per day (or week) stacked by region, with the period average as a dashed line. */
export function StackedBars({ data }: { data: Stacked }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.buckets.map((b) => b.total)) * 1.08
  const avg = data.buckets.reduce((a, b) => a + b.total, 0) / Math.max(1, data.buckets.length)
  const h = hover === null ? null : data.buckets[hover]
  const label = (d: Date) => (data.weekly ? `Week of ${dayMonth(d)}` : d.toLocaleString('en', { weekday: 'short', day: 'numeric', month: 'short' }))
  const tick = data.weekly ? 4 : 7
  return (
    <div className="stacked" onMouseLeave={() => setHover(null)}>
      <div className="stacked-plot">
        <span className="stacked-avg" style={{ bottom: `${(avg / max) * 100}%` }}>
          <span>avg {moneyShort(avg)}</span>
        </span>
        {data.buckets.map((b, i) => (
          <div
            key={b.start.getTime()}
            className={`stacked-col ${hover === i ? 'is-hover' : ''}`}
            onMouseEnter={() => setHover(i)}
            style={{ '--d': `${i * (data.buckets.length > 40 ? 8 : 18)}ms` } as React.CSSProperties}
          >
            <div className="stacked-bar" style={{ height: `${(b.total / max) * 100}%` }}>
              {b.parts.map((v, p) => (
                <span key={p} className={`stacked-part ${toneOf(data.regions, data.regions[p])}`} style={{ flexGrow: v }} />
              ))}
            </div>
            {i % tick === 0 && <span className="stacked-label">{dayMonth(b.start)}</span>}
          </div>
        ))}
      </div>
      {h && hover !== null && (
        <div className={`tip ${hover > data.buckets.length * 0.7 ? 'tip-left' : ''}`} style={{ left: `${((hover + 0.5) / data.buckets.length) * 100}%`, top: 0 }}>
          <p className="tip-title">{label(h.start)}</p>
          {data.regions.map((r, p) => (
            <p className="tip-row" key={r}>
              {r} <b>{money(h.parts[p])}</b>
            </p>
          ))}
          <p className="tip-row">
            Total <b>{money(h.total)}</b>
          </p>
        </div>
      )}
    </div>
  )
}
