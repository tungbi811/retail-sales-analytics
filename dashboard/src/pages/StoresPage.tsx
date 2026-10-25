import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, MapPin } from 'lucide-react'
import type { Warehouse } from '../data/types'
import { monthWindow, regions } from '../data/metrics'
import { monthsToDate, periodRange, storeStats, topProductsAt, type Period, type StoreStat } from '../data/analytics'
import { count, money, moneyShort, signedPct } from '../lib/format'
import { Num } from '../components/Num'
import { Info } from '../components/Info'
import { BarList, Columns } from '../components/Charts'
import { VnMap } from '../components/VnMap'
import { Footnote, PageHead } from '../components/PageHead'

interface Props {
  wh: Warehouse
  period: Period
  onPeriod: (p: Period) => void
  /** Column the store ranking opens sorted by. */
  rankBy?: SortKey
  /** Store to open on, from search. */
  store?: string
}

const TONES = ['s1', 's2', 's4', 's3', 's5']

export function StoresPage({ wh, period, onPeriod, rankBy, store: focus }: Props) {
  const range = useMemo(() => periodRange(wh, period), [wh, period])
  const stats = useMemo(() => storeStats(wh, range), [wh, range])
  const regionList = useMemo(() => regions(wh), [wh])
  const tone = (region: string) => TONES[regionList.indexOf(region) % TONES.length]
  const [selected, setSelected] = useState(() => focus ?? [...stats].sort((a, b) => a.rank - b.rank)[0]?.store_id ?? '')
  const store = stats.find((s) => s.store_id === selected) ?? stats[0]
  const byRegion = regionList.map((region) => ({ region, stores: stats.filter((s) => s.region === region).length }))

  return (
    <main className="main">
      <PageHead title="Stores" wh={wh} period={period} onPeriod={onPeriod} span={range.label} />

      <div className="row row-map">
        <section className="card map-card" aria-labelledby="map-title">
          <header className="card-head">
            <h2 className="card-title" id="map-title">
              Store locations <Info text="Locations from gold.dim_store. Equal-sized pins identify stores; alert badges show the latest stock snapshot, independent of the sales period. Select a store to see its details." />
            </h2>
            <span className="map-count"><MapPin size={14} strokeWidth={1.8} aria-hidden="true" />{stats.length} locations</span>
          </header>
          <ul className="region-keys" aria-label="Regions">
            {byRegion.map((r) => (
              <li key={r.region}>
                <i className={`key ${tone(r.region)}`} aria-hidden="true" />
                <b>{r.region}</b>
                <span>{r.stores} {r.stores === 1 ? 'store' : 'stores'}</span>
              </li>
            ))}
          </ul>
          <VnMap stores={stats} tone={tone} selected={store?.store_id ?? ''} onSelect={setSelected} />
        </section>

        {store && <StoreDetail key={`${store.store_id}-${period}`} wh={wh} store={store} range={range} tone={tone(store.region)} count={stats.length} />}
      </div>

      <StoreRanking sortBy={rankBy ?? 'revenue'} stores={stats} selected={store?.store_id} onSelect={setSelected} tone={tone} />

      <Footnote wh={wh}>
        Positions are real Pantio showrooms, matched to each store's region and added to the Stores sheet. Sales from gold.fact_sales, stock from gold.stock_position.
      </Footnote>
    </main>
  )
}

function StoreDetail({ wh, store: baseStore, range, tone, count: storeCount }: { wh: Warehouse; store: StoreStat; range: ReturnType<typeof periodRange>; tone: string; count: number }) {
  const [month, setMonth] = useState<number | null>(null)
  const months = monthsToDate(wh)
  const detailRange = useMemo(() => {
    if (month === null) return range
    const w = monthWindow(wh, wh.today.getFullYear(), month)
    const label = w.from.toLocaleString('en', { month: 'long', year: 'numeric' }) + (w.current ? ' to date' : '')
    return { ...w, label, vs: `vs ${w.prevFrom.toLocaleString('en', { month: 'long' })}` }
  }, [wh, range, month])
  const store = useMemo(() => month === null ? baseStore : storeStats(wh, detailRange).find((s) => s.store_id === baseStore.store_id) ?? baseStore, [wh, baseStore, detailRange, month])
  const top = useMemo(() => topProductsAt(wh, detailRange, store.store_id, 5), [wh, detailRange, store.store_id])

  return (
    <section className="card store-detail" aria-labelledby="store-title">
      <header className="store-head">
        <span className={`store-dot ${tone}`} aria-hidden="true" />
        <div>
          <h2 id="store-title">{store.store_name}</h2>
          <p className="store-addr">
            <MapPin size={13} strokeWidth={1.8} aria-hidden="true" />
            {store.address}
          </p>
        </div>
        <span className="rank-chip">
          #{store.rank} <span>of {storeCount}</span>
        </span>
      </header>

      <p className="store-period" aria-live="polite">{detailRange.label}</p>
      <dl className="stat-grid">
        <div>
          <dt>Revenue</dt>
          <dd>
            <Num value={store.revenue} format={money} />
            {store.change !== null && <span className={store.change >= 0 ? 'pos' : 'neg'} title={detailRange.vs}>{signedPct(store.change)}</span>}
          </dd>
        </div>
        <div>
          <dt>Orders</dt>
          <dd>
            <Num value={store.orders} format={count} />
          </dd>
        </div>
        <div>
          <dt>Avg order</dt>
          <dd>
            <Num value={store.aov} format={money} />
          </dd>
        </div>
        <div>
          <dt>Customers</dt>
          <dd>
            <Num value={store.customers} format={count} />
          </dd>
        </div>
      </dl>

      <h3 className="sub-title">Revenue by month, {wh.today.getFullYear()}</h3>
      <Columns
        label={`${store.store_name} revenue by month`}
        items={months.map((m) => ({ label: m.label, value: store.monthly[m.month], title: `${m.label}: ${money(store.monthly[m.month])}` }))}
        format={moneyShort}
        highlight={month ?? (range.from.getMonth() === wh.today.getMonth() ? months.length - 1 : undefined)}
        onSelect={setMonth}
      />

      <div className="store-products">
        <h3 className="sub-title">Top products</h3>
        {top.length ? (
          <BarList
            label={`Top products at ${store.store_name}`}
            rows={top.map((p) => ({ key: p.product, label: p.product, value: p.revenue, share: p.ofTop }))}
            format={moneyShort}
          />
        ) : <p className="empty-note">No sales in this period.</p>}
      </div>

      <p className={`stock-line ${store.low || store.out ? 'is-low' : ''}`} title="Latest inventory snapshot; does not change with the sales month.">
        <b>{store.low ? `${store.low} products below safety` : store.out ? `${store.out} out of stock` : 'All products above safety'}</b>
        {store.out > 0 && store.low > 0 && <span> · {store.out} out of stock</span>}
        <span> · stock worth {moneyShort(store.stockValue)}</span>
        {store.cover !== null && <span> · ~{Math.round(store.cover)} days of cover</span>}
      </p>
    </section>
  )
}

export type SortKey = 'revenue' | 'orders' | 'aov' | 'customers' | 'low'

const COLS: { key: SortKey; label: string; wide?: boolean }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'orders', label: 'Orders', wide: true },
  { key: 'aov', label: 'Avg order', wide: true },
  { key: 'customers', label: 'Customers', wide: true },
  { key: 'low', label: 'Low stock' },
]

function StoreRanking({ sortBy, stores, selected, onSelect, tone }: { sortBy: SortKey; stores: StoreStat[]; selected?: string; onSelect: (id: string) => void; tone: (r: string) => string }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: sortBy, desc: true })
  const rows = [...stores].sort((a, b) => (sort.desc ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]))
  return (
    <section className="card" aria-labelledby="ranking-title">
      <h2 className="card-title" id="ranking-title">
        All stores <Info text="Every store in gold.dim_store for the period. Select a row to show it on the map." />
      </h2>
      <div className="table-wrap">
        <table className="table table-select">
          <thead>
            <tr>
              <th scope="col">Store</th>
              <th scope="col" className="col-wide">City</th>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className={`num ${c.wide ? 'col-wide' : ''}`} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                  <button onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}>
                    {c.label}
                    {sort.key === c.key && (sort.desc ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUp size={12} aria-hidden="true" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.store_id} className={s.store_id === selected ? 'is-selected' : ''} onClick={() => onSelect(s.store_id)}>
                <th scope="row">
                  <button className="row-btn" onClick={() => onSelect(s.store_id)} aria-pressed={s.store_id === selected}>
                    <i className={`key ${tone(s.region)}`} aria-hidden="true" />
                    <span>
                      <span className="store-name">{s.store_name}</span>
                      <span className="store-region">{s.region}</span>
                    </span>
                  </button>
                </th>
                <td className="col-wide">{s.city}</td>
                <td className="num">
                  <span className="share" aria-hidden="true">
                    <span style={{ width: `${s.ofTop * 100}%` }} />
                  </span>
                  <Num value={s.revenue} format={money} />
                </td>
                <td className="num col-wide">{count(s.orders)}</td>
                <td className="num col-wide">{money(s.aov)}</td>
                <td className="num col-wide">{s.customers}</td>
                <td className="num">{s.low ? <span className="status status-low">{s.low}</span> : <span className="muted">0</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
