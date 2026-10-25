import type { ReactNode } from 'react'
import type { monthPace, yearPace } from '../data/metrics'
import { dayMonth, money } from '../lib/format'
import { Info } from './Info'
import { useTween } from '../lib/motion'

type Pace = NonNullable<ReturnType<typeof yearPace>>
type MonthPace = NonNullable<ReturnType<typeof monthPace>>

const CX = 130
const CY = 120
const R = 86
const START = -120
const SWEEP = 240

function point(deg: number, r: number) {
  const a = (deg * Math.PI) / 180
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)]
}

function arc(from: number, to: number, r: number) {
  const [x1, y1] = point(from, r)
  const [x2, y2] = point(to, r)
  return `M${x1} ${y1} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

interface DialCardProps {
  title: string
  info: string
  score: number
  unit: string
  label: string
  heading: ReactNode
  copy: ReactNode
  link?: string
  onLink?: () => void
}

function DialCard({ title, info, score, unit, label, heading, copy, link, onLink }: DialCardProps) {
  // The arc stops at a full sweep; the number keeps counting past 100.
  const value = useTween(Math.max(0, score), 900)
  const shown = Math.min(100, value)
  const end = START + (SWEEP * shown) / 100
  const [kx, ky] = point(end, R)
  const ticks = Array.from({ length: 31 }, (_, i) => START + (SWEEP * i) / 30)

  return (
    <section className="card gauge-card tone-gauge" aria-labelledby="gauge-title">
      <h2 className="card-title" id="gauge-title">
        {title} <Info text={info} />
      </h2>

      <div className="gauge">
        <svg viewBox="0 0 260 180" role="img" aria-label={label}>
          <defs>
            <linearGradient id="gauge-grad" gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="220" y2="0">
              <stop offset="0" stopColor="var(--gauge-from)" />
              <stop offset="1" stopColor="var(--gauge-to)" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => {
            const long = i % 5 === 0
            const [x1, y1] = point(t, R + 20)
            const [x2, y2] = point(t, R + (long ? 31 : 27))
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={t <= end ? 'tick tick-on' : 'tick'} />
          })}
          <path d={arc(START, START + SWEEP, R)} className="gauge-track" />
          <path d={arc(START, end, R)} className="gauge-fill" stroke="url(#gauge-grad)" />
          <circle cx={kx} cy={ky} r="9" className="gauge-knob" />
          <circle cx={kx} cy={ky} r="3.5" className="gauge-knob-dot" />
        </svg>
        <div className="gauge-readout">
          <p className="gauge-value">
            <span aria-hidden="true">{Math.round(value)}</span>
            <span className="sr-only">{Math.round(score)}</span>
          </p>
          <p className="gauge-unit">{unit}</p>
        </div>
      </div>

      <div className="gauge-copy">
        <h3>{heading}</h3>
        <p>{copy}</p>
      </div>
      {link && (
        <button className="kpi-link" onClick={onLink}>
          {link}
        </button>
      )}
    </section>
  )
}

export function YearGauge({ pace, onLink }: { pace: Pace; onLink: () => void }) {
  const ahead = pace.vsLastYearYtd >= 0
  return (
    <DialCard
      title="Year to date"
      info={`Revenue since 1 Jan ${pace.year} as a share of the full ${pace.year - 1} total.`}
      score={pace.score}
      unit={`% of ${pace.year - 1} revenue`}
      label={`${pace.score} percent of ${pace.year - 1} revenue reached`}
      heading={
        <>
          {ahead ? 'Ahead of last year' : 'Behind last year'}{' '}
          <span className={`delta ${ahead ? 'delta-up' : 'delta-down'}`}>
            {ahead ? '+' : '−'}
            {Math.abs(pace.vsLastYearYtd).toFixed(0)}% vs {pace.year - 1} at this date
          </span>
        </>
      }
      copy={
        <>
          {money(pace.ytd)} so far against {money(pace.lastYearTotal)} in {pace.year - 1}.{' '}
          {pace.passDate
            ? `At this pace ${pace.year} passes it on ${dayMonth(pace.passDate)}.`
            : `${pace.year} has already passed it.`}
        </>
      }
      link="See year view"
      onLink={onLink}
    />
  )
}

/** Used when the warehouse holds a single year, so there is no year-on-year pace to show. */
export function MonthGauge({ pace, onLink }: { pace: MonthPace; onLink: () => void }) {
  const ahead = pace.vsLastMonth >= 0
  return (
    <DialCard
      title="Month pace"
      info={`${pace.month} revenue as a share of the full ${pace.lastMonth} total. For the month in progress, the projection carries its daily average to the month end.`}
      score={pace.score}
      unit={`% of ${pace.lastMonth} revenue`}
      label={`${pace.score} percent of ${pace.lastMonth} revenue reached`}
      heading={
        pace.current ? (
          <>
            {ahead ? `On track to beat ${pace.lastMonth}` : `Tracking below ${pace.lastMonth}`}{' '}
            <span className={`delta ${ahead ? 'delta-up' : 'delta-down'}`}>
              {ahead ? '+' : '−'}
              {Math.abs(pace.vsLastMonth).toFixed(0)}% projected
            </span>
          </>
        ) : (
          <>
            {ahead ? `Beat ${pace.lastMonth}` : `Below ${pace.lastMonth}`}{' '}
            <span className={`delta ${ahead ? 'delta-up' : 'delta-down'}`}>
              {ahead ? '+' : '−'}
              {Math.abs(pace.vsLastMonth).toFixed(0)}%
            </span>
          </>
        )
      }
      copy={
        pace.current ? (
          <>
            {money(pace.mtd)} so far against {money(pace.lastMonthTotal)} in {pace.lastMonth}. At this pace {pace.month} ends near {money(pace.projected)}
            {pace.passed ? `, already past ${pace.lastMonth}.` : pace.passDate ? ` and passes ${pace.lastMonth} on ${dayMonth(pace.passDate)}.` : '.'}
          </>
        ) : (
          <>
            {pace.month} closed at {money(pace.mtd)} against {money(pace.lastMonthTotal)} in {pace.lastMonth}.
          </>
        )
      }
      link="See by day"
      onLink={onLink}
    />
  )
}

/** The first month on record has no month before it, so it is measured against the year's average month. */
export function FirstMonth({ month, revenue, average, year }: { month: string; revenue: number; average: number; year: number }) {
  const score = average ? Math.round((revenue / average) * 100) : 0
  const above = revenue >= average
  return (
    <DialCard
      title="Month pace"
      info={`The first month on record has no month before it, so it is compared with the average finished month of ${year}.`}
      score={score}
      unit="% of an average month"
      label={`${score} percent of an average month`}
      heading={
        <>
          First month on record{' '}
          <span className={`delta ${above ? 'delta-up' : 'delta-down'}`}>
            {above ? 'above' : 'below'} average
          </span>
        </>
      }
      copy={
        <>
          No earlier month to compare with. {month} brought {money(revenue)} against an average month of {money(average)} in {year}.
        </>
      }
    />
  )
}
