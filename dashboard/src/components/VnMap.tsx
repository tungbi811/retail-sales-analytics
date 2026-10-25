import { useMemo, useState } from 'react'
import { VN_MAP, project } from '../data/vn-map'
import type { StoreStat } from '../data/analytics'

interface Props {
  stores: StoreStat[]
  /** Region name to palette slot (s1..s5). */
  tone: (region: string) => string
  selected: string
  onSelect: (id: string) => void
}

const PIN_R = 9
const HIT_R = 18

interface Placed {
  s: StoreStat
  /** True position. */
  px: number
  py: number
  /** Pin centre after nudging overlapping stores apart. */
  x: number
  y: number
}

/** Pushes overlapping pins apart so stores in the same city stay clickable. */
function dodge(items: Placed[]) {
  for (let pass = 0; pass < 40; pass++) {
    let moved = false
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]
        const b = items[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        const need = HIT_R * 2 + 2
        if (d >= need) continue
        if (d < 0.01) {
          dx = 1
          dy = 0
          d = 1
        }
        const push = (need - d) / 2
        a.x -= (dx / d) * push
        a.y -= (dy / d) * push
        b.x += (dx / d) * push
        b.y += (dy / d) * push
        moved = true
      }
    }
    if (!moved) break
  }
  return items
}

type Side = 'right' | 'left' | 'below'

/** Labels go right of a pin unless another pin sits there, then left, then below. */
function labelSide(p: Placed, all: Placed[]): Side {
  const blocked = (dir: 1 | -1) =>
    all.some((o) => o !== p && Math.abs(o.y - p.y) < 16 && (o.x - p.x) * dir > 0 && Math.abs(o.x - p.x) < 64)
  if (!blocked(1)) return 'right'
  if (!blocked(-1)) return 'left'
  return 'below'
}

function stockLabel(store: StoreStat) {
  const low = `${store.low} ${store.low === 1 ? 'product' : 'products'} below safety`
  if (store.out) return store.low ? `${low} · ${store.out} out of stock` : `${store.out} out of stock`
  return store.low ? low : 'No stock alerts'
}

export function VnMap({ stores, tone, selected, onSelect }: Props) {
  const [hover, setHover] = useState<string | null>(null)
  const placed = useMemo(() => dodge(stores.map((s) => {
    const [px, py] = project(s.longitude, s.latitude)
    return { s, px, py, x: px, y: py }
  })), [stores])

  // One label per city; the store furthest from the cluster carries it.
  const labels = useMemo(() => {
    const byCity = new Map<string, Placed[]>()
    for (const p of placed) byCity.set(p.s.city, [...(byCity.get(p.s.city) ?? []), p])
    return [...byCity.entries()].map(([city, ps]) => {
      const p = ps.reduce((a, b) => (b.x > a.x ? b : a))
      const side = labelSide(p, placed)
      return { city, n: ps.length, p, side }
    })
  }, [placed])

  const focus = hover ? placed.find((p) => p.s.store_id === hover) : undefined

  return (
    <div className="map">
      <svg viewBox={`0 0 ${VN_MAP.width} ${VN_MAP.height}`} className="map-svg" role="group" aria-label="Store locations and stock alerts in Vietnam">
        <defs>
          {/* Neighbours fade out towards the frame so the crop has no hard edge. */}
          <radialGradient id="map-fade" cx="0.4" cy="0.5" r="0.62">
            <stop offset="0.6" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </radialGradient>
          <mask id="map-mask">
            <rect width={VN_MAP.width} height={VN_MAP.height} fill="url(#map-fade)" />
          </mask>
        </defs>
        <path d={VN_MAP.neighbours} className="map-neighbour" mask="url(#map-mask)" />
        <path d={VN_MAP.land} className="map-land" />
        {[...VN_MAP.hoangSa, ...VN_MAP.truongSa].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.6" className="map-island" />
        ))}
        <text {...xy(111.9, 17.45)} className="map-place">Q.Đ. Hoàng Sa</text>
        <text {...xy(113.3, 12.05)} className="map-place">Q.Đ. Trường Sa</text>
        <text {...xy(112.2, 14.2)} className="map-sea">Biển Đông</text>
        <text {...xy(103.1, 19.9)} className="map-country">Laos</text>
        <text {...xy(104.4, 12.9)} className="map-country">Cambodia</text>
        <text {...xy(108.4, 23.05)} className="map-country">China</text>

        {placed.map((p) =>
          Math.hypot(p.x - p.px, p.y - p.py) > 3 ? (
            <g key={`lead-${p.s.store_id}`} className="map-leader">
              <line x1={p.px} y1={p.py} x2={p.x} y2={p.y} />
              <circle cx={p.px} cy={p.py} r="1.8" />
            </g>
          ) : null,
        )}

        {placed.map((p, i) => {
          const on = p.s.store_id === selected
          return (
            <g
              key={p.s.store_id}
              className={`map-pin ${tone(p.s.region)} ${on ? 'is-selected' : ''} ${hover === p.s.store_id ? 'is-hover' : ''}`}
              style={{ '--d': `${i * 50}ms` } as React.CSSProperties}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${p.s.store_name}, ${p.s.city}. ${stockLabel(p.s)}`}
              onClick={() => onSelect(p.s.store_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(p.s.store_id)
                }
              }}
              onMouseEnter={() => setHover(p.s.store_id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(p.s.store_id)}
              onBlur={() => setHover(null)}
            >
              <circle cx={p.x} cy={p.y} r={HIT_R} className="map-hit" />
              {on && <circle cx={p.x} cy={p.y} r={PIN_R + 6} className="map-halo" />}
              <circle cx={p.x} cy={p.y} r={PIN_R} className="map-bubble" />
            </g>
          )
        })}

        {labels.map(({ city, n, p, side }) => {
          const pos: { x: number; y: number; anchor: 'start' | 'end' | 'middle' } =
            side === 'right'
              ? { x: p.x + HIT_R + 3, y: p.y, anchor: 'start' }
              : side === 'left'
                ? { x: p.x - HIT_R - 3, y: p.y, anchor: 'end' }
                : { x: p.x, y: p.y + HIT_R + 12, anchor: 'middle' }
          return (
            <text key={city} x={pos.x} y={pos.y} dy="0.35em" textAnchor={pos.anchor} className="map-label" aria-hidden="true">
              {city}
              {n > 1 && <tspan className="map-label-n"> ×{n}</tspan>}
            </text>
          )
        })}

        {focus && (
          <foreignObject x={Math.max(4, Math.min(VN_MAP.width - 224, focus.x - 110))} y={Math.max(4, focus.y - 105)} width="220" height="88" className="map-tip-anchor" aria-hidden="true">
            <div className="map-tip">
              <b>{focus.s.store_name}</b>
              <span>{focus.s.city}</span>
              <span>{stockLabel(focus.s)}</span>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  )
}

function xy(lon: number, lat: number) {
  const [x, y] = project(lon, lat)
  return { x, y, textAnchor: 'middle' as const }
}
