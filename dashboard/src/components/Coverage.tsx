import { useMemo, useState } from 'react'
import type { Warehouse } from '../data/types'
import type { RegionFilter } from '../data/metrics'
import { inventoryStats, level, type Level } from '../data/analytics'
import { money } from '../lib/format'
import { Info } from './Info'

interface Props {
  wh: Warehouse
  region: RegionFilter
}

const LEVELS: { key: Level; label: string }[] = [
  { key: 'out', label: 'Out' },
  { key: 'low', label: 'Below safety' },
  { key: 'ok', label: '1–2× safety' },
  { key: 'good', label: '2–4×' },
  { key: 'deep', label: '4×+' },
]

export const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleString('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

/** Every fact_inventory row as a cell, products down and stores across. */
export function CoverageMatrix({ wh, region }: Props) {
  const inv = useMemo(() => inventoryStats(wh, region), [wh, region])
  const [hover, setHover] = useState<string | null>(null)
  const cell = new Map(inv.rows.map((i) => [`${i.product_id}|${i.store_id}`, i]))
  const cities = inv.stores.map((s) => s.city)
  const head = (s: (typeof inv.stores)[number]) => (cities.filter((c) => c === s.city).length > 1 ? `${s.city} ${s.store_id}` : s.city)
  const h = hover ? inv.rows.find((i) => i.inventory_id === hover) : null
  const hp = h ? wh.products.find((p) => p.product_id === h.product_id) : null
  const hs = h ? inv.stores.find((s) => s.store_id === h.store_id) : null

  return (
    <section className="card" aria-labelledby="matrix-title">
      <header className="card-head">
        <h2 className="card-title" id="matrix-title">
          Stock against safety <Info text="Each cell is one fact_inventory row: stock_qty, coloured by how it compares with safety_stock." />
        </h2>
        <ul className="heat-legend matrix-legend" aria-label="Legend">
          {LEVELS.map((l) => (
            <li key={l.key}>
              <i className={`lv lv-${l.key}`} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      </header>
      <p className="heat-readout" aria-live="polite">
        {h && hp && hs ? (
          <>
            <b>{hp.product_name}</b> at {head(hs)} · <b>{h.stock_qty}</b> on hand, safety {h.safety_stock} · worth {money(h.stock_value)} · counted {longDate(h.last_updated)}
          </>
        ) : (
          <>Hover a cell to see the count. Numbers are units on hand.</>
        )}
      </p>
      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Product</span>
              </th>
              {inv.stores.map((s) => (
                <th scope="col" key={s.store_id} title={s.address}>
                  {head(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {wh.products.map((p, pi) => (
              <tr key={p.product_id}>
                <th scope="row">{p.product_name}</th>
                {inv.stores.map((s, si) => {
                  const i = cell.get(`${p.product_id}|${s.store_id}`)
                  if (!i) return <td key={s.store_id} />
                  const lv = level(i)
                  return (
                    <td key={s.store_id}>
                      <span
                        className={`mcell lv-${lv} ${hover === i.inventory_id ? 'is-hover' : ''}`}
                        style={
                          {
                            '--d': `${(pi + si) * 14}ms`,
                          } as React.CSSProperties
                        }
                        tabIndex={0}
                        onMouseEnter={() => setHover(i.inventory_id)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(i.inventory_id)}
                        onBlur={() => setHover(null)}
                        aria-label={`${p.product_name} at ${head(s)}: ${i.stock_qty} on hand, safety ${i.safety_stock}`}
                      >
                        {i.stock_qty}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
