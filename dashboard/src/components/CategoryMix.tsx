import { useState } from 'react'
import type { categoryMix } from '../data/metrics'
import { money } from '../lib/format'
import { Info } from './Info'
import { Num } from './Num'
import { useTweenList } from '../lib/motion'

type Mix = ReturnType<typeof categoryMix>

const CX = 110
const CY = 104
const R = 84
const W = 26
const GAP = 1.6 // degrees between segments

function polar(deg: number, r: number) {
  const a = ((deg - 180) * Math.PI) / 180
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)]
}

function segment(from: number, to: number) {
  const [x1, y1] = polar(from, R)
  const [x2, y2] = polar(to, R)
  const [x3, y3] = polar(to, R - W)
  const [x4, y4] = polar(from, R - W)
  return `M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2} L${x3} ${y3} A${R - W} ${R - W} 0 0 0 ${x4} ${y4} Z`
}

export function CategoryMix({ mix, month }: { mix: Mix; month: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const shares = useTweenList(mix.items.map((i) => i.share), 800)
  let at = 0
  const segs = mix.items.map((it, i) => {
    const from = at + GAP / 2
    at += (shares[i] ?? 0) * 180
    return { ...it, from, to: Math.max(from + 0.5, at - GAP / 2) }
  })
  const focus = hover === null ? null : mix.items[hover]

  // Largest-remainder rounding so the listed shares add up to exactly 100%.
  const raw = mix.items.map((i) => i.share * 100)
  const pcts = raw.map(Math.floor)
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0])
  const short = 100 - pcts.reduce((a, b) => a + b, 0)
  for (let n = 0; n < short; n++) pcts[order[n][1]] += 1

  return (
    <section className="card mix-card" aria-labelledby="mix-title">
      <h2 className="card-title" id="mix-title">
        Revenue by category <Info text="fact_sales.amount joined to dim_product.category, month to date." />
      </h2>
      <div className="mix">
        <div className="mix-total">
          <p className="mix-value">
            <Num value={focus ? focus.revenue : mix.total} format={money} />
          </p>
          <p className="mix-caption">{focus ? `${focus.category} · ${(focus.share * 100).toFixed(1)}%` : `${month}, all categories`}</p>
        </div>
        <svg className="mix-arc" viewBox="0 0 220 112" role="img" aria-label={mix.items.map((i) => `${i.category} ${(i.share * 100).toFixed(0)}%`).join(', ')}>
          {segs.map((s, i) => (
            <path
              key={s.category}
              d={segment(s.from, s.to)}
              className={`mix-seg s${i + 1} ${hover !== null && hover !== i ? 'is-dim' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      </div>
      <ul className="mix-list">
        {mix.items.map((it, i) => (
          <li key={it.category}>
            <button
              className={hover === i ? 'is-hover' : ''}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <i className={`key s${i + 1}`} aria-hidden="true" />
              <span>{it.category}</span>
              <span className="num mix-amt">
                <Num value={it.revenue} format={money} />
              </span>
              <span className="num">{pcts[i]}%</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
