import { useId, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { kpis, RegionFilter } from '../data/metrics'
import type { SortKey } from '../pages/StoresPage'
import { count, money, moneyShort } from '../lib/format'
import { Info } from './Info'
import { Num } from './Num'
import { jump } from '../lib/scroll'

type Kpis = ReturnType<typeof kpis>

export function Delta({ value, unit = '%' }: { value: number; unit?: string }) {
  const up = value >= 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className={`delta ${up ? 'delta-up' : 'delta-down'}`}>
      <Icon size={11} strokeWidth={2.4} aria-hidden="true" />
      <span className="sr-only">{up ? 'up' : 'down'}</span>
      {Math.abs(value).toFixed(1)}
      {unit}
    </span>
  )
}

interface CardProps {
  tone: 1 | 2 | 3 | 4
  label: string
  info: string
  value: ReactNode
  delta: ReactNode
  note: string
  link?: string
  onLink?: () => void
  viz?: ReactNode
}

export function KpiCard({ tone, label, info, value, delta, note, link, onLink, viz }: CardProps) {
  return (
    <article className={`kpi tone-${tone}`}>
      <h2 className="kpi-label">
        {label} <Info text={info} />
      </h2>
      <div className="kpi-body">
        <div>
          <p className="kpi-value">{value}</p>
          <p className="kpi-note">
            {delta} <span>{note}</span>
          </p>
        </div>
        {viz && <div className="kpi-viz">{viz}</div>}
      </div>
      {link && (
        <button className="kpi-link" onClick={onLink}>
          {link}
        </button>
      )}
    </article>
  )
}

export function MiniBars({ items }: { items: { label: string; revenue: number }[] }) {
  const max = Math.max(...items.map((i) => i.revenue))
  return (
    <div className="minibars" role="img" aria-label={items.map((i) => `${i.label} ${moneyShort(i.revenue)}`).join(', ')}>
      {items.map((i, n) => (
        <span key={i.label} className={n === items.length - 1 ? 'is-now' : ''}>
          <span style={{ height: `${Math.max(18, (i.revenue / max) * 100)}%` }} />
        </span>
      ))}
    </div>
  )
}

export function Spark({ values, label }: { values: number[]; label?: string }) {
  const w = 92
  const h = 40
  // 3-day average, drawn as a Catmull-Rom curve, so the trend reads over daily noise.
  const avg = values.map((_, i) => {
    const win = values.slice(Math.max(0, i - 2), i + 1)
    return win.reduce((a, b) => a + b, 0) / win.length
  })
  const max = Math.max(...avg)
  const min = Math.min(...avg)
  const pts = avg.map((v, i) => [(i / (avg.length - 1)) * (w - 6) + 3, h - 4 - ((v - min) / (max - min || 1)) * (h - 10)])
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)]
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)]
    d += ` C${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6} ${x2} ${y2}`
  }
  const [lx, ly] = pts[pts.length - 1]
  // Unique per instance: several sparks on one page each need their own gradient.
  const fill = `spark-fill-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    // Keyed on the data so a new series redraws from the left.
    <svg key={values.join(',')} className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label ?? `Daily orders this month, latest ${values[values.length - 1]}`}>
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${lx} ${h} L3 ${h} Z`} fill={`url(#${fill})`} />
      <path d={d} className="spark-line" pathLength={1} />
      <circle cx={lx} cy={ly} r="3.5" className="spark-dot" />
    </svg>
  )
}

function Ring({ value, caption }: { value: number; caption: string }) {
  const r = 15
  const c = 2 * Math.PI * r
  const p = Math.min(1, value)
  return (
    <svg className="ring" viewBox="0 0 40 40" width="40" height="40" role="img" aria-label={`${Math.round(p * 100)} percent ${caption}`}>
      <circle cx="20" cy="20" r={r} className="ring-track" />
      <circle cx="20" cy="20" r={r} className="ring-fill" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 20 20)" />
      <text x="20" y="20" dy="0.35em" textAnchor="middle" className="ring-text">
        {Math.round(p * 100)}%
      </text>
    </svg>
  )
}

/** Share of the month's orders by region, or by store city inside one region. */
function OrderSplit({ items }: { items: { label: string; share: number }[] }) {
  const top = Math.max(...items.map((i) => i.share), 0.01)
  return (
    <ul className="split" aria-label={items.map((i) => `${i.label} ${Math.round(i.share * 100)}%`).join(', ')}>
      {items.map((i) => (
        <li key={i.label}>
          <span className="split-label">{i.label}</span>
          <span className="split-track" aria-hidden="true">
            <span style={{ width: `${(i.share / top) * 100}%` }} />
          </span>
          <b>{Math.round(i.share * 100)}%</b>
        </li>
      ))}
    </ul>
  )
}

export function RingWithCaption({ value, caption }: { value: number; caption: string }) {
  return (
    <span className="ring-wrap">
      <Ring value={value} caption={caption} />
      <span className="ring-caption">{caption}</span>
    </span>
  )
}

interface KpiCardsProps {
  k: Kpis
  go: (page: 'Products') => void
  region: RegionFilter
  onRegion: (r: RegionFilter) => void
  onRank: (key: SortKey) => void
}

export function KpiCards({ k, go, region, onRegion, onRank }: KpiCardsProps) {
  const note = k.hasPrev ? 'vs last month' : 'first month on record'
  // The orders link drills into the busiest region in its bars, and back out again.
  const top = k.orders.split[0]?.label
  return (
    <section className="kpis" aria-label="Month to date">
      <KpiCard
        tone={1}
        label="Revenue"
        info="Sum of fact_sales.amount, month to date."
        value={<Num value={k.revenue.value} format={money} />}
        delta={k.revenue.change !== null && <Delta value={k.revenue.change} />}
        note={note}
        link="See by day"
        onLink={() => jump('stack-title')}
        viz={<MiniBars items={k.revenue.lastThree} />}
      />
      <KpiCard
        tone={2}
        label="Orders"
        info="Count of fact_sales rows in the month. Bars: share of those orders by region, or by store city when one region is selected."
        value={<Num value={k.orders.value} format={count} />}
        delta={k.orders.change !== null && <Delta value={k.orders.change} />}
        note={note}
        link={region !== 'All' ? 'Show all regions' : top ? `Show ${top}` : undefined}
        onLink={() => onRegion(region !== 'All' ? 'All' : (top as RegionFilter))}
        viz={<OrderSplit items={k.orders.split} />}
      />
      <KpiCard
        tone={3}
        label="Units sold"
        info={`Sum of fact_sales.quantity. Ring shows this month so far as a share of all ${k.prevMonthLabel} units.`}
        value={<Num value={k.units.value} format={count} />}
        delta={k.units.change !== null && <Delta value={k.units.change} />}
        note={note}
        link="See products"
        onLink={() => go('Products')}
        viz={k.units.ofPrevMonth !== null && <RingWithCaption value={k.units.ofPrevMonth} caption={`of ${k.prevMonthLabel}`} />}
      />
      <KpiCard
        tone={4}
        label="Avg order"
        info="fact_sales.amount divided by order count, month to date. Bars: the last three months."
        value={<Num value={k.aov.value} format={money} />}
        delta={k.aov.change !== null && <Delta value={k.aov.change} />}
        note={note}
        link="Rank stores by avg order"
        onLink={() => onRank('aov')}
        viz={<MiniBars items={k.revenue.lastThree.map((m) => ({ label: m.label, revenue: m.orders ? m.revenue / m.orders : 0 }))} />}
      />
    </section>
  )
}
