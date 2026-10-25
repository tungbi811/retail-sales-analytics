import { useEffect, useMemo, useRef, useState } from 'react'
import { Droplets, Palette, Sparkles, Waves, Wind, X, type LucideIcon } from 'lucide-react'
import type { Warehouse } from '../data/types'
import { salesFor, type RegionFilter } from '../data/metrics'
import { categoryStats, monthsToDate, periodRange, productDetail, productStats, stockBoard, type Period, type ProductStat } from '../data/analytics'
import { count, money, moneyShort, signedPct } from '../lib/format'
import { toneOf } from '../lib/tones'
import { Num } from '../components/Num'
import { Info } from '../components/Info'
import { BarList, Columns } from '../components/Charts'
import { Segmented } from '../components/Segmented'
import { Footnote, PageHead } from '../components/PageHead'
import { StockBoard } from '../components/StockBoard'
import { CoverageMatrix } from '../components/Coverage'
import { RevenueDrivers } from '../components/RevenueDrivers'

interface Props {
  wh: Warehouse
  region: RegionFilter
  onRegion: (r: RegionFilter) => void
  period: Period
  onPeriod: (p: Period) => void
  /** Product to open, from search. */
  product?: string
}

// One glyph per category, in the same order as the category colours.
const ICONS: LucideIcon[] = [Wind, Droplets, Waves, Palette, Sparkles]

type View = 'board' | 'sales' | 'coverage'
const VIEWS: { value: View; label: string }[] = [
  { value: 'board', label: 'Stock board' },
  { value: 'sales', label: 'Sales' },
  { value: 'coverage', label: 'Coverage' },
]

export function ProductsPage({ wh, region, onRegion, period, onPeriod, product }: Props) {
  const rows = useMemo(() => salesFor(wh, region), [wh, region])
  const range = useMemo(() => periodRange(wh, period), [wh, period])
  const products = useMemo(() => productStats(wh, rows, range, region), [wh, rows, range, region])
  const cards = useMemo(() => stockBoard(wh, region, products), [wh, region, products])
  const cats = useMemo(() => categoryStats(products), [products])
  const catOrder = useMemo(() => [...new Set(wh.products.map((p) => p.category))].sort((a, b) => a.localeCompare(b)), [wh])
  const tone = (c: string) => toneOf(catOrder, c)
  const Icon = (c: string) => ICONS[Math.max(0, catOrder.indexOf(c)) % ICONS.length]

  const [view, setView] = useState<View>('board')
  const [cat, setCat] = useState<string>('All')
  const [open, setOpen] = useState<string | null>(product ?? null)
  const closeDrawer = useMemo(() => () => setOpen(null), [])

  const rank = new Map(products.map((p, i) => [p.product_id, i + 1]))
  const filtered = products.filter((p) => cat === 'All' || p.category === cat)
  const drawer = products.find((p) => p.product_id === open)

  return (
    <main className="main page-products">
      <PageHead
        title="Products"
        tabs={<Segmented label="View" options={VIEWS} value={view} onChange={setView} />}
        wh={wh}
        region={region}
        onRegion={onRegion}
        period={period}
        onPeriod={onPeriod}
        span={view === 'coverage' ? 'Stock is a snapshot; the period does not apply' : range.label}
      />

      {view === 'board' && <StockBoard wh={wh} region={region} cards={cards} categories={catOrder} category={cat} onCategory={setCat} rank={rank} onOpen={setOpen} />}

      {view === 'sales' && products.length > 0 && (
        <div className="row products-top">
          <RevenueDrivers products={filtered} category={cat} comparison={range.vs} onSelect={setOpen} />

          <section className="card shelf" aria-labelledby="shelf-title">
            <h2 className="card-title" id="shelf-title">
              Categories <Info text="dim_product.category as stored in the source. Several products sit in surprising categories; see the dbt README. Select one to filter." />
            </h2>
            <ul className="shelf-list">
              {cats.map((c) => {
                const CatIcon = Icon(c.category)
                return (
                  <li key={c.category}>
                    <button className={`shelf-row ${cat === c.category ? 'is-on' : ''}`} onClick={() => setCat((v) => (v === c.category ? 'All' : c.category))} aria-pressed={cat === c.category}>
                      <span className={`shelf-icon ${tone(c.category)}`} aria-hidden="true">
                        <CatIcon size={18} strokeWidth={1.7} />
                      </span>
                      <span className="shelf-text">
                        <b>{c.category}</b>
                        <span>
                          {c.products} products · {count(c.units)} units
                          {c.low > 0 && ` · ${c.low} low`}
                        </span>
                      </span>
                      <span className="shelf-value">
                        <Num value={c.revenue} format={moneyShort} />
                        <span>{Math.round(c.share * 100)}%</span>
                      </span>
                      <span className="shelf-track" aria-hidden="true">
                        <span className={tone(c.category)} style={{ width: `${c.share * 100}%` }} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>
      )}

      {view === 'coverage' && <CoverageMatrix wh={wh} region={region} />}

      {drawer && <ProductDrawer wh={wh} rows={rows} range={range} product={drawer} tone={tone(drawer.category)} onClose={closeDrawer} />}

      <Footnote wh={wh}>
        Sales from gold.fact_sales, stock from gold.stock_position (one count per store × product; stock adds up across stores, never across dates). Cover and lanes come from
        dbt (gold.stock_position, gold.product_stock): stock on hand divided by units sold per day over the last 90 days of sales.
      </Footnote>
    </main>
  )
}

interface FocusProps {
  wh: Warehouse
  rows: Parameters<typeof productDetail>[1]
  range: ReturnType<typeof periodRange>
  product: ProductStat
  tone: string
  onClose: () => void
}

function ProductDrawer({ wh, rows, range, product, tone, onClose }: FocusProps) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog?.focus()
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab' || !dialog) return
      const controls = dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      const first = controls[0] ?? dialog
      const last = controls[controls.length - 1] ?? dialog
      if (document.activeElement === dialog || !dialog.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        e.preventDefault()
        const target = e.shiftKey ? last : first
        target.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      trigger?.focus()
    }
  }, [onClose])
  const detail = useMemo(() => productDetail(wh, rows, range, product.product_id), [wh, rows, range, product.product_id])
  const months = monthsToDate(wh)
  const maxStock = Math.max(...detail.stock.map((s) => Math.max(s.stock_qty, s.safety_stock)), 1)
  // Two stores can share a city, so those get the store id too.
  const cities = detail.stock.map((s) => s.city)
  const name = (s: (typeof detail.stock)[number]) => (cities.filter((c) => c === s.city).length > 1 ? `${s.city} ${s.store_id}` : s.city)
  return (
    <>
    <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
    <aside className="drawer store-detail" aria-labelledby="product-title" role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
      <header className="store-head">
        <span className={`store-dot ${tone}`} aria-hidden="true" />
        <div>
          <h2 id="product-title">{product.product_name}</h2>
          <p className="store-addr">
            {product.category} · {money(product.price)} per unit
          </p>
        </div>
        <button className="icon-btn drawer-close" onClick={onClose} aria-label="Close product detail">
          <X size={16} strokeWidth={1.8} />
        </button>
      </header>

      <dl className="stat-grid">
        <div>
          <dt>Revenue</dt>
          <dd>
            <Num value={product.revenue} format={money} />
          </dd>
        </div>
        <div>
          <dt>Units</dt>
          <dd>
            <Num value={product.units} format={count} />
          </dd>
        </div>
        <div>
          <dt>Change</dt>
          <dd className={product.change === null ? '' : product.change >= 0 ? 'pos' : 'neg'}>{product.change === null ? '—' : signedPct(product.change)}</dd>
        </div>
        <div>
          <dt>Days of cover</dt>
          <dd>{product.cover === null ? '—' : Math.round(product.cover)}</dd>
        </div>
      </dl>

      <h3 className="sub-title">Revenue by month, {wh.today.getFullYear()}</h3>
      <Columns
        label={`${product.product_name} revenue by month`}
        items={months.map((m) => ({ label: m.label, value: product.monthly[m.month], title: `${m.label}: ${money(product.monthly[m.month])}` }))}
        format={moneyShort}
        highlight={months.length - 1}
      />

      <h3 className="sub-title">By region</h3>
      <BarList
        label="Revenue by region"
        rows={detail.regions.map((r) => ({ key: r.region, label: r.region, value: r.share * 100, share: r.share }))}
        format={(n) => `${Math.round(n)}%`}
      />

      <h3 className="sub-title">
        Stock by store <span className="sub-note">bar: on hand · tick: safety stock</span>
      </h3>
      <ul className="stockbars" aria-label="Stock by store">
        {detail.stock.map((s) => (
          <li key={s.inventory_id} className={s.is_out_of_stock ? 'is-out' : s.below_safety_stock ? 'is-low' : ''}>
            <span className="stockbars-name">{name(s)}</span>
            <span className="stockbars-track" aria-hidden="true">
              <span className="stockbars-bar" style={{ width: `${(s.stock_qty / maxStock) * 100}%` }} />
              <span className="stockbars-tick" style={{ left: `${(s.safety_stock / maxStock) * 100}%` }} />
            </span>
            <span className="stockbars-qty">
              {s.stock_qty}
              <span className="sr-only"> on hand, safety {s.safety_stock}</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
    </>
  )
}
