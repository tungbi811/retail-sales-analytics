import { useState, type ReactNode } from 'react'
import { useTweenList } from '../lib/motion'

interface Col {
  label: string
  value: number
  /** Tooltip / screen reader text for the column. */
  title: string
}

/** Small vertical bars that grow from zero and tween between filters. Selection supports hover, keyboard and touch. */
export function Columns({ items, format, highlight, label, onSelect }: { items: Col[]; format: (n: number) => string; highlight?: number; label: string; onSelect?: (index: number) => void }) {
  const shown = useTweenList(
    items.map((i) => i.value),
    700,
  )
  const max = Math.max(...items.map((i) => i.value)) || 1
  const [hover, setHover] = useState<number | null>(null)
  return (
    <ol className="cols" aria-label={label} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it, i) => {
        const body = (
          <>
            <span className="col-value" aria-hidden="true">
              {format(shown[i] ?? 0)}
            </span>
            <span className="col-track" aria-hidden="true">
              <span className="col-bar" style={{ height: `${Math.max(3, ((shown[i] ?? 0) / max) * 100)}%` }} />
            </span>
            <span className="col-label">{it.label}</span>
            <span className="sr-only">{it.title}</span>
          </>
        )
        return (
          <li
            key={it.label}
            className={`col ${i === highlight ? 'is-active' : ''} ${i === hover ? 'is-hover' : ''}`}
            onMouseEnter={() => { setHover(i); onSelect?.(i) }}
            onMouseLeave={() => setHover(null)}
          >
            {onSelect ? (
              <button
                className="col-button"
                aria-label={it.title}
                aria-pressed={i === highlight}
                onFocus={() => { setHover(i); onSelect(i) }}
                onBlur={() => setHover(null)}
                onClick={() => onSelect(i)}
              >
                {body}
              </button>
            ) : body}
          </li>
        )
      })}
    </ol>
  )
}

interface BarRow {
  key: string
  label: ReactNode
  sub?: ReactNode
  value: number
  /** 0..1 width of the bar. */
  share: number
  tone?: 'warn' | 'neg'
}

/** Ranked rows with an inline bar. Rows become buttons when onSelect is given. */
export function BarList({
  rows,
  format,
  selected,
  onSelect,
  label,
}: {
  rows: BarRow[]
  format: (n: number) => ReactNode
  selected?: string
  onSelect?: (key: string) => void
  label: string
}) {
  const widths = useTweenList(
    rows.map((r) => r.share),
    700,
  )
  return (
    <ul className="barlist" aria-label={label}>
      {rows.map((r, i) => {
        const body = (
          <>
            <span className="barlist-text">
              <span className="barlist-label">{r.label}</span>
              {r.sub && <span className="barlist-sub">{r.sub}</span>}
            </span>
            <span className="barlist-value">{format(r.value)}</span>
            <span className="barlist-track" aria-hidden="true">
              <span className={`barlist-bar ${r.tone ? `is-${r.tone}` : ''}`} style={{ width: `${Math.max(0, Math.min(1, widths[i] ?? 0)) * 100}%` }} />
            </span>
          </>
        )
        return (
          <li key={r.key}>
            {onSelect ? (
              <button className={`barlist-row ${selected === r.key ? 'is-selected' : ''}`} aria-pressed={selected === r.key} onClick={() => onSelect(r.key)}>
                {body}
              </button>
            ) : (
              <div className="barlist-row">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
