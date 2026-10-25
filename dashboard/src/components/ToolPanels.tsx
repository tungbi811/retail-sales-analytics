import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { CircleHelp, Database, MapPin, Package, RotateCw, Search, User } from 'lucide-react'
import type { Warehouse } from '../data/types'
import { count, dayMonth, money, when } from '../lib/format'
import { Panel } from './Panel'

/** Lower case without accents, so "da nang" finds Đà Nẵng. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()

const LIMIT = 5

interface SearchProps {
  wh: Warehouse
  onStore: (id: string) => void
  onProduct: (id: string) => void
  onClose: () => void
}

/** Stores and products open on their own tab; customers answer in place, since no tab lists them all. */
export function SearchPanel({ wh, onStore, onProduct, onClose }: SearchProps) {
  const [q, setQ] = useState('')
  const buyers = useMemo(() => {
    const stores = new Map(wh.stores.map((s) => [s.store_id, s.city]))
    const by = new Map<string, { orders: number; spend: number; last: Date; cities: Map<string, number> }>()
    for (const s of wh.sales) {
      const b = by.get(s.customer_id) ?? { orders: 0, spend: 0, last: s.sale_datetime, cities: new Map() }
      b.orders += 1
      b.spend += s.amount
      if (s.sale_datetime > b.last) b.last = s.sale_datetime
      const city = stores.get(s.store_id) ?? ''
      b.cities.set(city, (b.cities.get(city) ?? 0) + 1)
      by.set(s.customer_id, b)
    }
    return by
  }, [wh])

  const needle = fold(q.trim())
  const hit = (...fields: string[]) => needle.length > 0 && fields.some((f) => fold(f).includes(needle))
  const stores = wh.stores.filter((s) => hit(s.store_name, s.city, s.region, s.address ?? '')).slice(0, LIMIT)
  const products = wh.products.filter((p) => hit(p.product_name, p.category)).slice(0, LIMIT)
  const customers = wh.customers.filter((c) => hit(c.customer_name)).slice(0, LIMIT)
  const none = needle.length > 0 && stores.length + products.length + customers.length === 0

  // Arrow keys walk the result buttons; the input is the top of the list.
  function walk(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('input, .find-hit')]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    next?.focus()
    e.preventDefault()
  }

  return (
    <Panel title="Search" sub="Find a store, product or customer by name, city or category." icon={Search} onClose={onClose} side="right">
      <div className="find" onKeyDown={walk}>
        <label className="find-box">
          <Search size={16} strokeWidth={1.8} aria-hidden="true" />
          <span className="sr-only">Search the warehouse</span>
          <input data-autofocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try Đà Nẵng, Kem Nền or a customer" />
        </label>

        {!needle && <p className="find-hint">Accents are optional. Press / anywhere to open search, ? for help.</p>}
        {none && <p className="find-hint">Nothing matches “{q.trim()}”.</p>}

        {stores.length > 0 && (
          <FindGroup title="Stores">
            {stores.map((s) => (
              <li key={s.store_id}>
                <button className="find-hit" onClick={() => onStore(s.store_id)}>
                  <MapPin size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    <b>{s.store_name}</b>
                    <span>
                      {s.city} · {s.region}
                    </span>
                  </span>
                  <span className="find-go">Open on map</span>
                </button>
              </li>
            ))}
          </FindGroup>
        )}

        {products.length > 0 && (
          <FindGroup title="Products">
            {products.map((p) => (
              <li key={p.product_id}>
                <button className="find-hit" onClick={() => onProduct(p.product_id)}>
                  <Package size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    <b>{p.product_name}</b>
                    <span>{p.category}</span>
                  </span>
                  <span className="find-go">Open product</span>
                </button>
              </li>
            ))}
          </FindGroup>
        )}

        {customers.length > 0 && (
          <FindGroup title="Customers">
            {customers.map((c) => {
              const b = buyers.get(c.customer_id)
              const city = b && [...b.cities.entries()].sort((x, y) => y[1] - x[1])[0][0]
              return (
                <li key={c.customer_id} className="find-person">
                  <User size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    <b>{c.customer_name}</b>
                    <span>
                      {c.gender}, {c.age_group}
                      {b ? ` · ${count(b.orders)} orders, ${money(b.spend)} · mostly ${city} · last ${dayMonth(b.last)}` : ' · no orders yet'}
                    </span>
                  </span>
                </li>
              )
            })}
          </FindGroup>
        )}
      </div>
    </Panel>
  )
}

function FindGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="find-group" aria-label={title}>
      <h3>{title}</h3>
      <ul>{children}</ul>
    </section>
  )
}

interface DataProps {
  wh: Warehouse
  onReload: (sample?: boolean) => void
  onClose: () => void
}

/** Where the numbers come from, how fresh they are, and a way to fetch them again. */
export function DataPanel({ wh, onReload, onClose }: DataProps) {
  const live = wh.source === 'postgres'
  const first = wh.sales[0]?.sale_datetime
  const last = wh.sales[wh.sales.length - 1]?.sale_datetime
  const tables: [string, string, number][] = [
    ['fact_sales', 'sales', wh.sales.length],
    ['stock_position', 'stock rows', wh.inventory.length],
    ['dim_customer', 'customers', wh.customers.length],
    ['dim_product', 'products', wh.products.length],
    ['dim_store', 'stores', wh.stores.length],
  ]
  return (
    <Panel title="Data" sub="Where these numbers come from and how fresh they are." icon={Database} onClose={onClose}>
      <dl className="data-facts">
        <div>
          <dt>Source</dt>
          <dd>{live ? 'Postgres, dbt gold models' : 'Sample data made in the browser'}</dd>
        </div>
        <div>
          <dt>Last dbt run</dt>
          <dd>{wh.syncedAt ? when(wh.syncedAt) : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Sales cover</dt>
          <dd>{first && last ? `${dayMonth(first)} ${first.getFullYear()} to ${dayMonth(last)} ${last.getFullYear()}` : 'No sales'}</dd>
        </div>
      </dl>

      <h3 className="panel-sub">Rows loaded</h3>
      <ul className="data-tables">
        {tables.map(([table, label, n]) => (
          <li key={table}>
            <code>gold.{table}</code>
            <span>
              <b>{count(n)}</b> {label}
            </span>
          </li>
        ))}
      </ul>

      <div className="panel-actions">
        <button className="btn btn-primary" data-autofocus onClick={() => onReload(!live)}>
          <RotateCw size={15} strokeWidth={1.8} aria-hidden="true" />
          {live ? 'Reload from Postgres' : 'Make new sample data'}
        </button>
        <button className="btn" onClick={() => onReload(live)}>
          {live ? 'Use sample data' : 'Try live data'}
        </button>
      </div>
    </Panel>
  )
}

const GLOSSARY: { group: string; terms: [string, string][] }[] = [
  {
    group: 'Sales',
    terms: [
      ['Revenue', 'Sum of fact_sales.amount. Amounts are stored without a currency.'],
      ['Orders', 'Count of fact_sales rows. Each sale is one order.'],
      ['Units sold', 'Sum of fact_sales.quantity.'],
      ['Avg order', 'Revenue divided by orders.'],
      ['vs last month', 'The month so far against the same days of last month. A finished month is compared with the whole month before.'],
      ['Month pace', 'Revenue as a share of last month’s total. It can pass 100.'],
    ],
  },
  {
    group: 'Stock',
    terms: [
      ['Below safety stock', 'stock_position rows where stock_qty is under safety_stock.'],
      ['Out of stock', 'stock_position rows where stock_qty is 0.'],
      ['Days of cover', 'Stock on hand divided by units sold per day over the last 90 days of sales. Worked out in dbt (stock_position).'],
    ],
  },
  {
    group: 'Charts',
    terms: [
      ['Sales by time', 'Revenue per weekday and two-hour slot over the 12 weeks to the selected month’s end. Darker is busier.'],
      ['Category mix', 'Revenue by dim_product.category for the selected month.'],
    ],
  },
]

export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <Panel title="Help" sub="What each number means and where it comes from." icon={CircleHelp} onClose={onClose}>
      {GLOSSARY.map((g) => (
        <section key={g.group} className="glossary">
          <h3 className="panel-sub">{g.group}</h3>
          <dl>
            {g.terms.map(([term, def]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{def}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <h3 className="panel-sub">Shortcuts</h3>
      <ul className="keys">
        <li>
          <kbd>/</kbd> Search
        </li>
        <li>
          <kbd>?</kbd> Help
        </li>
        <li>
          <kbd>Esc</kbd> Close a panel
        </li>
        <li>
          <kbd>Enter</kbd> Ask, in the Ask panel
        </li>
      </ul>
    </Panel>
  )
}
