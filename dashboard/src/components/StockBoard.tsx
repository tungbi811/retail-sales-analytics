import { CalendarDays, Check, Clock, Download, PackagePlus } from 'lucide-react'
import type { Lane, Warehouse } from '../data/types'
import { regions, type RegionFilter } from '../data/metrics'
import { watchDays, type BoardCard } from '../data/analytics'
import { count, money, moneyShort, signedPct } from '../lib/format'
import { toneOf } from '../lib/tones'
import { downloadCsv } from '../lib/csv'
import { Info } from './Info'
import { longDate } from './Coverage'

interface Props {
  wh: Warehouse
  region: RegionFilter
  /** Every product's card, before the category filter. */
  cards: BoardCard[]
  categories: string[]
  category: string
  onCategory: (c: string) => void
  rank: Map<string, number>
  onOpen: (id: string) => void
}

// The watch threshold is a dbt setting (watch_days), read from gold.product_stock.
const lanes = (watch: number | null): { key: Lane; title: string; note: string }[] => [
  { key: 'out', title: 'Out of stock', note: 'Empty in at least one store' },
  { key: 'low', title: 'Below safety', note: 'Short somewhere, empty nowhere' },
  { key: 'watch', title: 'Low cover', note: watch === null ? 'Stocked, but few days of sales left' : `Stocked, but under ${watch} days of sales left` },
  { key: 'ok', title: 'Healthy', note: 'At safety stock in every store' },
]

// Emptiest lanes put the most stores short first; calm lanes put the closest to running out, then the best sellers, first.
const ORDER: Record<Lane, (a: BoardCard, b: BoardCard) => number> = {
  out: (a, b) => b.short.length - a.short.length || b.order - a.order,
  low: (a, b) => b.short.length - a.short.length || b.order - a.order,
  watch: (a, b) => (a.cover ?? Infinity) - (b.cover ?? Infinity),
  ok: (a, b) => b.revenue - a.revenue,
}

/** "Hạ Long" → "HL", "Vinh" → "VI". */
const initials = (city: string) => {
  const words = city.split(/[\s.]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : city.slice(0, 2)).toUpperCase()
}

const AVATARS = 3

/** Products as cards in four lanes, by the emptiest store each one has. Like a Kanban board, but the lanes come from the stock counts. */
export function StockBoard({ wh, region, cards, categories, category, onCategory, rank, onOpen }: Props) {
  const shown = cards.filter((c) => category === 'All' || c.category === category)
  const short = shown.filter((c) => c.short.length > 0)
  const shelves = short.reduce((a, c) => a + c.short.length, 0)
  const stocked = shown.length - short.length
  const done = shown.length ? stocked / shown.length : 0
  const dates = cards.flatMap((c) => wh.inventory.filter((i) => i.product_id === c.product_id).map((i) => i.last_updated)).sort()
  const regionList = regions(wh)
  const watch = watchDays(wh)
  const where = region === 'All' ? '' : ` in ${region}`

  function exportList() {
    const rows = short.flatMap((c) =>
      c.short.map((i) => ({ product: c.product_name, category: c.category, store: i.store.store_name, city: i.store.city, stock_qty: i.stock_qty, safety_stock: i.safety_stock, order_units: i.shortfall, order_cost: i.cost })),
    )
    downloadCsv('pantio-restock.csv', ['product', 'category', 'store', 'city', 'stock_qty', 'safety_stock', 'order_units', 'order_cost'], rows)
  }

  return (
    <>
      <section className="card board-banner" aria-labelledby="board-title" id="stock-alerts" tabIndex={-1}>
        <span className="board-mark" aria-hidden="true" />
        <div className="board-lede">
          <h2 id="board-title">
            {short.length ? `${short.length} of ${shown.length} products need restocking${where}.` : `Every product is at safety stock${where}.`}
          </h2>
          <p>
            <CalendarDays size={13} strokeWidth={1.8} aria-hidden="true" />
            {dates.length ? `Counted ${longDate(dates[0])} – ${longDate(dates[dates.length - 1])}` : 'No stock counts'}
            <span aria-hidden="true">·</span>
            {count(shelves)} store shelves short
            <Info text="Each card is a product. Its lane comes from gold.product_stock: out of stock or below safety_stock in some store, or under the watch_days of cover set in dbt. Stock is a snapshot, so the period does not apply." />
          </p>
        </div>

        <div className="board-show">
          <span>Show</span>
          <div className="board-cats" role="group" aria-label="Category">
            {['All', ...categories].map((c) => (
              <button key={c} aria-pressed={category === c} onClick={() => onCategory(c)}>
                {c !== 'All' && <i className={toneOf(categories, c)} aria-hidden="true" />}
                {c === 'All' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>

        <div className="board-progress">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="16" pathLength="100" />
            <circle cx="20" cy="20" r="16" pathLength="100" strokeDasharray={`${done * 100} 100`} />
          </svg>
          <span className="board-pct">{Math.round(done * 100)}%</span>
          <span>
            <b>
              {stocked} of {shown.length}
            </b>
            fully stocked
          </span>
        </div>

        <button className="btn btn-primary" onClick={exportList} disabled={shelves === 0}>
          <Download size={15} strokeWidth={1.9} aria-hidden="true" />
          Restock list
        </button>
      </section>

      <div className="lanes">
        {lanes(watch).map((l) => {
          const items = shown.filter((c) => c.lane === l.key).sort(ORDER[l.key])
          const units = items.reduce((a, c) => a + c.order, 0)
          return (
            <section className={`lane lane-${l.key}`} key={l.key} aria-labelledby={`lane-${l.key}`}>
              <header className="lane-head">
                <i aria-hidden="true" />
                <h3 id={`lane-${l.key}`}>{l.title}</h3>
                <span className="lane-n">{items.length}</span>
                {units > 0 && (
                  <span className="lane-units" title="Units to order to bring every short store back to safety stock">
                    +{count(units)} units
                  </span>
                )}
              </header>
              <p className="lane-note">{l.note}</p>
              {items.length ? (
                <ul>
                  {items.map((c, i) => (
                    <li key={c.product_id} style={{ '--d': `${i * 30}ms` } as React.CSSProperties}>
                      <Card card={c} tone={toneOf(categories, c.category)} rank={rank.get(c.product_id)} regionList={regionList} watch={watch} onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lane-empty">No products here</p>
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}

function Card({ card: c, tone, rank, regionList, watch, onOpen }: { card: BoardCard; tone: string; rank?: number; regionList: string[]; watch: number | null; onOpen: (id: string) => void }) {
  const extra = c.short.length - AVATARS
  const cover = c.cover === null ? null : Math.round(c.cover)
  return (
    <button className="scard" onClick={() => onOpen(c.product_id)}>
      <span className="scard-top">
        <span className="scard-tag">
          <i className={tone} aria-hidden="true" />
          {c.category}
        </span>
        {rank && <span className="scard-rank" title="Rank by revenue in the period">#{rank}</span>}
      </span>

      <span className="scard-name">{c.product_name}</span>
      <span className="scard-sales">
        {money(c.revenue)}
        {c.change !== null && <span className={c.change >= 0 ? 'pos' : 'neg'}>{signedPct(c.change, 0)}</span>}
        <span className="scard-units">· {count(c.units)} units</span>
      </span>

      <span className="scard-check">
        <span>
          <Check size={13} strokeWidth={2.2} aria-hidden="true" />
          {c.stocked}/{c.stores}
          <span className="sr-only"> stores at safety stock</span>
        </span>
        <span className="scard-bar" aria-hidden="true">
          <span style={{ width: `${c.stores ? (c.stocked / c.stores) * 100 : 0}%` }} />
        </span>
      </span>

      <span className="scard-foot">
        {c.short.length > 0 && (
          <span className="scard-stores">
            {c.short.slice(0, AVATARS).map((i) => {
              const t = toneOf(regionList, i.store.region)
              return (
                <span key={i.inventory_id} className={`scard-avatar ${t}-soft ${t}-ink ${i.is_out_of_stock ? 'is-out' : ''}`} title={`${i.store.store_name}, ${i.store.city}: ${i.stock_qty} of ${i.safety_stock}`} aria-hidden="true">
                  {initials(i.store.city)}
                </span>
              )
            })}
            {extra > 0 && (
              <span className="scard-avatar scard-more" aria-hidden="true">
                +{extra}
              </span>
            )}
            <span className="sr-only">Short in {c.short.map((i) => i.store.city).join(', ')}</span>
          </span>
        )}
        <span className={`scard-due ${cover !== null && watch !== null && cover < watch ? 'is-soon' : ''}`}>
          <Clock size={12} strokeWidth={2} aria-hidden="true" />
          {cover === null ? 'No recent sales' : `${cover}d cover`}
        </span>
        {c.order > 0 && (
          <span className="scard-order" title={`Order ${c.order} units, about ${moneyShort(c.cost)} at unit cost`}>
            <PackagePlus size={13} strokeWidth={1.9} aria-hidden="true" />+{count(c.order)}
          </span>
        )}
      </span>
    </button>
  )
}
