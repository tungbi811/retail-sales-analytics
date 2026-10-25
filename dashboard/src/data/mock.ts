import type { DimCustomer, DimProduct, DimStore, FactSales, Level, ProductStock, ReportPeriod, SalesMonth, StockPosition, StockRules, StoreStock, Warehouse } from './types'
import { DAY } from './metrics.ts'

// Sample data only. Deterministic so screenshots and numbers stay stable between reloads.

const TODAY = new Date(2026, 9, 24, 14, 30) // 24 Oct 2026, local time
const START = new Date(2025, 0, 1)

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const store = (store_id: string, store_name: string, region: string, city: string, latitude: number, longitude: number): DimStore => ({
  store_id,
  store_name,
  region,
  address: `${store_name}, ${city}`,
  city,
  latitude,
  longitude,
})
const stores: DimStore[] = [
  store('S01', 'Riverside', 'North', 'Hà Nội', 21.03, 105.85),
  store('S02', 'Old Town', 'North', 'Hải Phòng', 20.86, 106.68),
  store('S03', 'Harbour', 'Central', 'Đà Nẵng', 16.06, 108.22),
  store('S04', 'Market Hall', 'Central', 'Huế', 16.46, 107.59),
  store('S05', 'Southgate', 'South', 'TP.HCM', 10.78, 106.7),
  store('S06', 'Bay Road', 'South', 'Vũng Tàu', 10.35, 107.08),
]
const storeWeight = [1.25, 0.8, 1.1, 1.35, 0.9, 0.6]

const catalog: [string, string, number][] = [
  ['Oak serving board', 'Kitchen', 42],
  ['Chef knife 20cm', 'Kitchen', 68],
  ['Cast iron pan', 'Kitchen', 54],
  ['Linen apron', 'Kitchen', 24],
  ['Stoneware mug', 'Tableware', 14],
  ['Dinner plate set', 'Tableware', 48],
  ['Glass carafe', 'Tableware', 22],
  ['Pasta bowl', 'Tableware', 16],
  ['Wool throw', 'Textiles', 79],
  ['Linen napkins (4)', 'Textiles', 28],
  ['Cotton tea towel', 'Textiles', 9],
  ['Olive oil 500ml', 'Pantry', 15],
  ['Sea salt flakes', 'Pantry', 7],
  ['Ground coffee 250g', 'Pantry', 11],
  ['Honey 340g', 'Pantry', 10],
  ['Beeswax candle', 'Home', 18],
  ['Ceramic vase', 'Home', 36],
  ['Rattan basket', 'Home', 31],
]
const products: DimProduct[] = catalog.map(([name, category], i) => ({
  product_id: `P${String(i + 1).padStart(2, '0')}`,
  product_name: name,
  category,
}))
const AGE_GROUPS: [string, number, number][] = [
  ['20-24', 2002, 2006],
  ['25-29', 1997, 2001],
  ['30-34', 1992, 1996],
  ['35-39', 1987, 1991],
]
const CUSTOMERS = 400

function generateCustomers(rand: () => number): DimCustomer[] {
  return Array.from({ length: CUSTOMERS }, (_, i) => {
    const [age_group, from, to] = AGE_GROUPS[Math.floor(rand() * AGE_GROUPS.length)]
    return {
      customer_id: `C${String(i + 1).padStart(4, '0')}`,
      customer_name: `Customer ${i + 1}`,
      gender: rand() < 0.62 ? 'Female' : 'Male',
      birth_year: from + Math.floor(rand() * (to - from + 1)),
      age_group,
    }
  })
}

const productWeight = catalog.map(([, , price]) => 1 / Math.sqrt(price))

// Retail seasonality by month, Jan..Dec.
const season = [0.72, 0.68, 0.8, 0.84, 0.92, 1.0, 0.95, 0.9, 1.0, 1.08, 1.25, 1.55]
// ISO weekday 1..7 (Mon..Sun)
const weekdayFactor = [0, 0.8, 0.82, 0.88, 0.95, 1.12, 1.38, 1.05]
// Opening hours 8..21, weight per hour; weekends peak earlier.
const hourWeekday = [0.3, 0.6, 0.9, 1.0, 1.35, 1.4, 1.0, 0.85, 0.9, 1.25, 1.45, 1.2, 0.7, 0.35]
const hourWeekend = [0.25, 0.7, 1.2, 1.5, 1.6, 1.45, 1.35, 1.2, 1.0, 0.85, 0.7, 0.5, 0.3, 0.15]

function pick(rand: () => number, weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function generateSales(rand: () => number): FactSales[] {
  const rows: FactSales[] = []
  let n = 0
  for (const d = new Date(START); d <= TODAY; d.setDate(d.getDate() + 1)) {
    const iso = (d.getDay() + 6) % 7 + 1
    const growth = d.getFullYear() === 2026 ? 1.17 : 1
    const noise = 0.85 + rand() * 0.3
    const orders = Math.round(26 * season[d.getMonth()] * weekdayFactor[iso] * growth * noise)
    const hours = iso >= 6 ? hourWeekend : hourWeekday
    const isToday = isoDate(d) === isoDate(TODAY)
    for (let i = 0; i < orders; i++) {
      const hour = 8 + pick(rand, hours)
      const p = pick(rand, productWeight)
      const s = pick(rand, storeWeight)
      const quantity = 1 + pick(rand, [6, 2.5, 1])
      const price = catalog[p][2]
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, Math.floor(rand() * 60))
      if (isToday && at > TODAY) continue
      rows.push({
        sale_id: `T${String(++n).padStart(6, '0')}`,
        sale_datetime: at,
        sale_date: isoDate(at),
        product_id: products[p].product_id,
        store_id: stores[s].store_id,
        customer_id: `C${String(1 + Math.floor(rand() ** 1.6 * CUSTOMERS)).padStart(4, '0')}`,
        quantity,
        amount: Math.round(price * quantity * (0.92 + rand() * 0.16) * 100) / 100,
      })
    }
  }
  return rows
}

type InventoryRow = Omit<StockPosition, 'units_per_day' | 'days_of_cover' | 'stock_level' | 'shortfall' | 'restock_cost'>

function generateInventory(rand: () => number): InventoryRow[] {
  const rows: InventoryRow[] = []
  let n = 0
  for (const s of stores) {
    for (const [i, p] of products.entries()) {
      const safety = 8 + Math.floor(rand() * 12)
      const roll = rand()
      const stock = roll < 0.03 ? 0 : roll < 0.13 ? Math.floor(rand() * safety) : safety + Math.floor(rand() * 60)
      const unitCost = Math.round(catalog[i][2] * 0.45 * 100) / 100
      rows.push({
        inventory_id: `I${String(++n).padStart(4, '0')}`,
        store_id: s.store_id,
        product_id: p.product_id,
        last_updated: isoDate(TODAY),
        stock_qty: stock,
        safety_stock: safety,
        unit_cost: unitCost,
        stock_value: Math.round(stock * unitCost * 100) / 100,
        is_out_of_stock: stock === 0,
        below_safety_stock: stock < safety,
      })
    }
  }
  return rows
}

// The stock rules from dbt/models/gold/inventory and the vars in dbt_project.yml, for sample data and test fixtures only.
// Live data gets these columns from dbt; keep the two in step if a rule changes.
const RULES: StockRules = { sell_rate_days: 90, watch_days: 60, stock_ok_below: 2, stock_good_below: 4 }

type SaleLike = { store_id: string; product_id: string; sale_datetime: Date | string; quantity: number }

function level(i: InventoryRow): Level {
  if (i.stock_qty === 0) return 'out'
  if (i.stock_qty < i.safety_stock) return 'low'
  if (i.stock_qty < RULES.stock_ok_below * i.safety_stock) return 'ok'
  if (i.stock_qty < RULES.stock_good_below * i.safety_stock) return 'good'
  return 'deep'
}

/** Stock, sell rate and days of cover for a group of stock_position rows, as product_stock and store_stock add them up. */
function cover(rows: StockPosition[]) {
  const stock = rows.reduce((a, r) => a + r.stock_qty, 0)
  const perDay = rows.reduce((a, r) => a + r.units_per_day, 0)
  return { stock_qty: stock, units_per_day: perDay, days_of_cover: perDay ? stock / perDay : null }
}

function groupBy<T>(rows: T[], keys: (r: T) => string[]) {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    for (const key of keys(r)) {
      let g = groups.get(key)
      if (!g) groups.set(key, (g = []))
      g.push(r)
    }
  }
  return groups
}

export function withStockRules(stores: DimStore[], sales: SaleLike[], inventory: InventoryRow[]) {
  const times = sales.map((s) => new Date(s.sale_datetime).getTime())
  const from = Math.max(...times) - RULES.sell_rate_days * DAY
  const units = new Map<string, number>()
  for (const [i, s] of sales.entries()) {
    if (times[i] > from) units.set(`${s.store_id}|${s.product_id}`, (units.get(`${s.store_id}|${s.product_id}`) ?? 0) + s.quantity)
  }
  const positions: StockPosition[] = inventory.map((i) => {
    const perDay = (units.get(`${i.store_id}|${i.product_id}`) ?? 0) / RULES.sell_rate_days
    const shortfall = Math.max(i.safety_stock - i.stock_qty, 0)
    return { ...i, units_per_day: perDay, days_of_cover: perDay ? i.stock_qty / perDay : null, stock_level: level(i), shortfall, restock_cost: shortfall * i.unit_cost }
  })

  const regionOf = new Map(stores.map((s) => [s.store_id, s.region]))
  const byProduct = groupBy(positions, (r) => [`${r.product_id}|${regionOf.get(r.store_id)}`, `${r.product_id}|All`])
  const productStock = [...byProduct.entries()].map(([key, g]): ProductStock => {
    const [product_id, region] = key.split('|')
    const c = cover(g)
    const lowCover = c.days_of_cover !== null && c.days_of_cover < RULES.watch_days
    const lane = g.some((r) => r.below_safety_stock && r.is_out_of_stock) ? 'out' : g.some((r) => r.below_safety_stock) ? 'low' : lowCover ? 'watch' : 'ok'
    return { product_id, region, ...c, lane, low_cover: lowCover }
  })
  const storeStock = [...groupBy(positions, (r) => [r.store_id]).entries()].map(([store_id, g]): StoreStock => ({ store_id, ...cover(g) }))
  return { inventory: positions, productStock, storeStock, stockRules: RULES }
}

// The windows from dbt/models/gold/sales/report_periods.sql and the KPIs from sales_monthly.sql, for sample data and
// test fixtures only. `now` is one second after the last sale, as the API's "today" is.
export function reportPeriods(now: Date, firstSale: Date): ReportPeriod[] {
  // The same moment in the month (or year) before, rolling day overflow into the next month as dbt's intervals do
  const sameSpan = (y: number, m: number) => new Date(y, m, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds())
  const rows: ReportPeriod[] = []
  for (let d = new Date(firstSale.getFullYear(), 0, 1); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const current = now < end
    const prevFrom = new Date(d.getFullYear(), d.getMonth() - 1, 1)
    const prevTo = current ? new Date(Math.min(d.getTime(), sameSpan(d.getFullYear(), d.getMonth() - 1).getTime())) : d
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    rows.push({ period, kind: 'month', from_at: d, to_at: current ? now : end, prev_from_at: prevFrom, prev_to_at: prevTo, is_current: current })
  }
  const mtd = rows[rows.length - 1]
  const yearStart = new Date(now.getFullYear(), 0, 1)
  return [
    ...rows,
    { ...mtd, period: 'MTD', kind: 'period' },
    { period: '90D', kind: 'period', from_at: new Date(now.getTime() - 90 * DAY), to_at: now, prev_from_at: new Date(now.getTime() - 180 * DAY), prev_to_at: new Date(now.getTime() - 90 * DAY), is_current: true },
    { period: 'YTD', kind: 'period', from_at: yearStart, to_at: now, prev_from_at: new Date(now.getFullYear() - 1, 0, 1), prev_to_at: sameSpan(now.getFullYear() - 1, now.getMonth()), is_current: true },
  ]
}

type SaleRow = { store_id: string; sale_datetime: Date; amount: number; quantity: number }

export function salesMonthly(stores: DimStore[], sales: SaleRow[], periods: ReportPeriod[]): SalesMonth[] {
  const regionOf = new Map(stores.map((s) => [s.store_id, s.region]))
  const regionList = [...new Set(stores.map((s) => s.region)), 'All']
  const change = (now: number, before: number) => (before === 0 ? 0 : ((now - before) / before) * 100)
  return periods
    .filter((p) => p.kind === 'month')
    .flatMap((p) =>
      regionList.map((region) => {
        const mine = sales.filter((s) => region === 'All' || regionOf.get(s.store_id) === region)
        const total = (from: Date, to: Date) => {
          const rows = mine.filter((s) => s.sale_datetime >= from && s.sale_datetime < to)
          const revenue = rows.reduce((a, s) => a + s.amount, 0)
          return { revenue, orders: rows.length, units: rows.reduce((a, s) => a + s.quantity, 0), aov: rows.length ? revenue / rows.length : 0 }
        }
        const now = total(p.from_at, p.to_at)
        const like = total(p.prev_from_at, p.prev_to_at)
        const whole = total(p.prev_from_at, p.from_at)
        const has = whole.orders > 0
        return {
          month: p.period,
          region,
          revenue: now.revenue,
          orders: now.orders,
          units: now.units,
          avg_order: now.aov,
          has_previous: has,
          revenue_change_pct: has ? change(now.revenue, like.revenue) : null,
          orders_change_pct: has ? change(now.orders, like.orders) : null,
          units_change_pct: has ? change(now.units, like.units) : null,
          avg_order_change_pct: has ? change(now.aov, like.aov) : null,
          units_of_prev_month: has && whole.units ? now.units / whole.units : null,
        }
      }),
    )
}

/** Adds the windows and monthly KPIs dbt would work out for this sales data, with `today` as now. */
export function withSalesRules<T extends { stores: DimStore[]; sales: SaleRow[]; today: Date }>(wh: T) {
  const first = new Date(Math.min(...wh.sales.map((s) => s.sale_datetime.getTime()), wh.today.getTime()))
  const periods = reportPeriods(wh.today, first)
  return { ...wh, periods, salesMonthly: salesMonthly(wh.stores, wh.sales, periods) }
}

export function loadMockWarehouse(): Warehouse {
  const rand = mulberry32(20261024)
  const customers = generateCustomers(rand)
  const sales = generateSales(rand)
  return withSalesRules({
    stores,
    products,
    customers,
    sales,
    ...withStockRules(stores, sales, generateInventory(rand)),
    today: TODAY,
    syncedAt: new Date(2026, 9, 24, 6, 0),
    source: 'sample' as const,
    currency: 'USD',
  })
}
