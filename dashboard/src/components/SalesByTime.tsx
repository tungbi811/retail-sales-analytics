import { useState, type CSSProperties } from 'react'
import { WEEKDAYS, type salesByTime } from '../data/metrics'
import { count, dayMonth, money, moneyShort } from '../lib/format'
import { Info } from './Info'

type Heat = ReturnType<typeof salesByTime>

const LEVELS = 5

export function SalesByTime({ heat }: { heat: Heat }) {
  const [hover, setHover] = useState<[number, number] | null>(null)
  const BANDS = heat.bands
  // Shades span the quietest to the busiest slot, not zero to the busiest: every slot sells,
  // so a zero-based scale would push most cells into the top shades.
  const values = heat.grid.flat().map((c) => c.revenue)
  const sold = values.filter((v) => v > 0)
  const min = sold.length ? Math.min(...sold) : 0
  const hasEmpty = sold.length < values.length
  const level = (n: number) => (n === 0 ? 0 : heat.max === min ? LEVELS : Math.min(LEVELS, 1 + Math.floor(((n - min) / (heat.max - min)) * LEVELS)))

  // Busiest slot is the default readout so the card says something before any hover.
  let peak: [number, number] = [0, 0]
  heat.grid.forEach((row, b) => row.forEach((c, d) => c.revenue > heat.grid[peak[0]][peak[1]].revenue && (peak = [b, d])))
  const [b, d] = hover ?? peak
  const cell = heat.grid[b][d]

  return (
    <section className="card heat-card" aria-labelledby="heat-title">
      <header className="card-head">
        <h2 className="card-title" id="heat-title">
          Sales by time <Info text={`Revenue per weekday and two-hour slot over the ${heat.weeks} weeks to ${dayMonth(new Date(heat.end.getTime() - 1000))} (fact_sales.sale_datetime, amount).`} />
        </h2>
        <div className="heat-legend" aria-hidden="true">
          <span>{hasEmpty ? 0 : moneyShort(min)}</span>
          {Array.from({ length: LEVELS + 1 }, (_, i) => i)
            .filter((i) => i > 0 || hasEmpty)
            .map((i) => (
              <i key={i} className={`h${i}`} />
            ))}
          <span>{moneyShort(heat.max)}</span>
        </div>
      </header>

      <p className="heat-readout" aria-live="polite">
        <b>
          {WEEKDAYS[d]} {BANDS[b]}h
        </b>
        <span>{count(cell.orders)} orders</span>
        <span>{money(cell.revenue)}</span>
        {!hover && <span className="heat-peak">top slot</span>}
      </p>

      <div className="heat" role="table" aria-label="Revenue by weekday and time" onMouseLeave={() => setHover(null)}>
        <div role="row" className="heat-row heat-head">
          <span role="columnheader" />
          {WEEKDAYS.map((w) => (
            <span role="columnheader" key={w}>
              {w}
            </span>
          ))}
        </div>
        {heat.grid.map((row, bi) => (
          <div role="row" className="heat-row" key={BANDS[bi]}>
            <span role="rowheader">{BANDS[bi]}</span>
            {row.map((c, di) => (
              <button
                role="cell"
                key={di}
                className={`heat-cell h${level(c.revenue)} ${hover?.[0] === bi && hover?.[1] === di ? 'is-hover' : ''}`}
                aria-label={`${WEEKDAYS[di]} ${BANDS[bi]}: ${money(c.revenue)}, ${c.orders} orders`}
                style={{ '--d': `${(bi + di) * 22}ms` } as CSSProperties}
                onMouseEnter={() => setHover([bi, di])}
                onFocus={() => setHover([bi, di])}
                onBlur={() => setHover(null)}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
