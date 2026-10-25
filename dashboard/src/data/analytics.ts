import type { FactInventory, FactSales, Warehouse } from './types'
import { DAY, inRange, pct, sum, type RegionFilter, type Totals } from './metrics'

// Metrics for the Products, Stores and Customers pages, and the sales and stock cards on Dashboard and Products.
// Everything is computed from the gold rows; nothing here is stored.

export type Period = 'MTD' | '90D' | 'YTD'

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'MTD', label: 'Month' },
  { value: '90D', label: '90 days' },
  { value: 'YTD', label: 'Year' },
]

export interface Range {
  from: Date
  to: Date
  prevFrom: Date
  prevTo: Date
  /** "1 Jul – 27 Jul 2024" */
  label: string
  /** "vs same days of June" */
  vs: string
}

const short = (d: Date) => d.toLocaleString('en', { day: 'numeric', month: 'short' })

/** The period ends at the last sale; the comparison is the equal span just before it (or a year before, for YTD). */
export function periodRange(wh: Warehouse, p: Period): Range {
  const to = wh.today
  const y = to.getFullYear()
  const last = new Date(to.getTime() - 1000)
  let from: Date
  let prevFrom: Date
  let prevTo: Date
  let vs: string
  if (p === 'MTD') {
    from = new Date(y, to.getMonth(), 1)
    prevFrom = new Date(y, to.getMonth() - 1, 1)
    prevTo = new Date(Math.min(from.getTime(), new Date(y, to.getMonth() - 1, to.getDate(), to.getHours(), to.getMinutes(), to.getSeconds()).getTime()))
    const previousMonth = prevFrom.toLocaleString('en', { month: 'long' })
    vs = prevTo.getTime() === from.getTime() ? `vs ${previousMonth}` : `vs same days of ${previousMonth}`
  } else if (p === '90D') {
    from = new Date(to.getTime() - 90 * DAY)
    prevFrom = new Date(to.getTime() - 180 * DAY)
    prevTo = from
    vs = 'vs the 90 days before'
  } else {
    from = new Date(y, 0, 1)
    prevFrom = new Date(y - 1, 0, 1)
    prevTo = new Date(y - 1, to.getMonth(), to.getDate(), to.getHours(), to.getMinutes(), to.getSeconds())
    vs = `vs ${y - 1} to date`
  }
  return { from, to, prevFrom, prevTo, label: `${short(from)} – ${short(last)} ${y}`, vs }
}

export interface Compared {
  now: Totals & { aov: number }
  /** Null when the comparison span holds no sales (e.g. the first year on record). */
  change: { revenue: number; orders: number; units: number; aov: number } | null
}

const withAov = (t: Totals) => ({ ...t, aov: t.orders ? t.revenue / t.orders : 0 })

export function compare(rows: FactSales[], r: Range): Compared {
  const now = withAov(sum(inRange(rows, r.from, r.to)))
  const prev = withAov(sum(inRange(rows, r.prevFrom, r.prevTo)))
  if (prev.orders === 0) return { now, change: null }
  return {
    now,
    change: {
      revenue: pct(now.revenue, prev.revenue),
      orders: pct(now.orders, prev.orders),
      units: pct(now.units, prev.units),
      aov: pct(now.aov, prev.aov),
    },
  }
}

export function storeIdsIn(wh: Warehouse, region: RegionFilter) {
  return new Set(wh.stores.filter((s) => region === 'All' || s.region === region).map((s) => s.store_id))
}

const dayKey = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** Midnight at or before the end of the range. A part-day after it would read as a collapse, so day charts stop there. */
export function lastMidnight(r: Range) {
  return new Date(r.to.getFullYear(), r.to.getMonth(), r.to.getDate())
}

/** Complete calendar days in the range, including days without sales. */
function days(r: Range) {
  const out: Date[] = []
  const end = lastMidnight(r)
  for (let d = new Date(r.from.getFullYear(), r.from.getMonth(), r.from.getDate()); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(d)
  }
  return out
}

// ---------- Sales ----------

export interface DayPoint {
  date: Date
  revenue: number
  orders: number
  /** Trailing 7-day average revenue. */
  avg7: number
  weekend: boolean
}

export function daily(rows: FactSales[], r: Range): DayPoint[] {
  const by = new Map<number, { revenue: number; orders: number }>()
  for (const s of inRange(rows, r.from, lastMidnight(r))) {
    const k = dayKey(s.sale_datetime)
    const d = by.get(k) ?? { revenue: 0, orders: 0 }
    d.revenue += s.amount
    d.orders += 1
    by.set(k, d)
  }
  const list = days(r).map((date) => ({ date, ...(by.get(date.getTime()) ?? { revenue: 0, orders: 0 }) }))
  return list.map((d, i) => {
    const win = list.slice(Math.max(0, i - 6), i + 1)
    return {
      ...d,
      avg7: win.reduce((a, b) => a + b.revenue, 0) / win.length,
      weekend: d.date.getDay() === 0 || d.date.getDay() === 6,
    }
  })
}

export function recentSales(wh: Warehouse, rows: FactSales[], n: number) {
  const stores = new Map(wh.stores.map((s) => [s.store_id, s]))
  const products = new Map(wh.products.map((p) => [p.product_id, p]))
  const customers = new Map(wh.customers.map((c) => [c.customer_id, c]))
  return rows
    .slice(-n)
    .reverse()
    .map((s) => ({
      ...s,
      store: stores.get(s.store_id)?.store_name ?? s.store_id,
      city: stores.get(s.store_id)?.city ?? '',
      product: products.get(s.product_id)?.product_name ?? s.product_id,
      customer: customers.get(s.customer_id)?.customer_name ?? s.customer_id,
    }))
}

// ---------- Products ----------

/** Units each store × product sells per day, over the 90 days before the last sale. */
function sellRate(wh: Warehouse) {
  const from = new Date(wh.today.getTime() - 90 * DAY)
  const rate = new Map<string, number>()
  for (const s of inRange(wh.sales, from, wh.today)) {
    const k = `${s.store_id}|${s.product_id}`
    rate.set(k, (rate.get(k) ?? 0) + s.quantity / 90)
  }
  return rate
}

export function monthsToDate(wh: Warehouse) {
  const y = wh.today.getFullYear()
  return Array.from({ length: wh.today.getMonth() + 1 }, (_, m) => ({
    month: m,
    label: new Date(y, m, 1).toLocaleString('en', { month: 'short' }),
  }))
}

export function productStats(wh: Warehouse, rows: FactSales[], r: Range, region: RegionFilter) {
  const now = inRange(rows, r.from, r.to)
  const prev = inRange(rows, r.prevFrom, r.prevTo)
  const y = wh.today.getFullYear()
  const months = monthsToDate(wh)
  const ids = storeIdsIn(wh, region)
  const rate = sellRate(wh)

  const total = now.reduce((a, s) => a + s.amount, 0)
  const list = wh.products.map((p) => {
    const mine = now.filter((s) => s.product_id === p.product_id)
    const t = sum(mine)
    const before = sum(prev.filter((s) => s.product_id === p.product_id))
    const monthly = months.map(() => 0)
    for (const s of rows) {
      if (s.product_id === p.product_id && s.sale_datetime.getFullYear() === y) monthly[s.sale_datetime.getMonth()] += s.amount
    }
    const inv = wh.inventory.filter((i) => i.product_id === p.product_id && ids.has(i.store_id))
    const stock = inv.reduce((a, i) => a + i.stock_qty, 0)
    const perDay = inv.reduce((a, i) => a + (rate.get(`${i.store_id}|${i.product_id}`) ?? 0), 0)
    return {
      ...p,
      revenue: t.revenue,
      previousRevenue: before.revenue,
      previousOrders: before.orders,
      units: t.units,
      orders: t.orders,
      price: t.units ? t.revenue / t.units : 0,
      share: total ? t.revenue / total : 0,
      change: before.orders ? pct(t.revenue, before.revenue) : null,
      monthly,
      stock,
      low: inv.filter((i) => i.below_safety_stock).length,
      out: inv.filter((i) => i.is_out_of_stock).length,
      cover: perDay ? stock / perDay : null,
    }
  })
  const top = Math.max(...list.map((p) => p.revenue))
  return list.map((p) => ({ ...p, ofTop: top ? p.revenue / top : 0 })).sort((a, b) => b.revenue - a.revenue)
}

export type ProductStat = ReturnType<typeof productStats>[number]

export function categoryStats(products: ProductStat[]) {
  const by = new Map<string, { category: string; revenue: number; units: number; products: number; low: number }>()
  for (const p of products) {
    const c = by.get(p.category) ?? { category: p.category, revenue: 0, units: 0, products: 0, low: 0 }
    c.revenue += p.revenue
    c.units += p.units
    c.products += 1
    c.low += p.low
    by.set(p.category, c)
  }
  const total = products.reduce((a, p) => a + p.revenue, 0)
  return [...by.values()].map((c) => ({ ...c, share: total ? c.revenue / total : 0 })).sort((a, b) => b.revenue - a.revenue)
}

/** Revenue of one product split by region, and its stock in each store. */
export function productDetail(wh: Warehouse, rows: FactSales[], r: Range, productId: string) {
  const now = inRange(rows, r.from, r.to).filter((s) => s.product_id === productId)
  const regionOf = new Map(wh.stores.map((s) => [s.store_id, s.region]))
  const byRegion = new Map<string, number>()
  for (const s of now) byRegion.set(regionOf.get(s.store_id)!, (byRegion.get(regionOf.get(s.store_id)!) ?? 0) + s.amount)
  const total = now.reduce((a, s) => a + s.amount, 0)
  const regionsList = [...new Set(wh.stores.map((s) => s.region))].sort((a, b) => a.localeCompare(b))
  const stores = new Map(wh.stores.map((s) => [s.store_id, s]))
  return {
    regions: regionsList.map((region) => ({ region, revenue: byRegion.get(region) ?? 0, share: total ? (byRegion.get(region) ?? 0) / total : 0 })),
    stock: wh.inventory
      .filter((i) => i.product_id === productId)
      .map((i) => ({ ...i, store: stores.get(i.store_id)!.store_name, city: stores.get(i.store_id)!.city }))
      .sort((a, b) => a.store_id.localeCompare(b.store_id, undefined, { numeric: true })),
  }
}

// ---------- Stores ----------

export function storeStats(wh: Warehouse, r: Range) {
  const rate = sellRate(wh)
  const list = wh.stores.map((s) => {
    const rows = wh.sales.filter((x) => x.store_id === s.store_id)
    const c = compare(rows, r)
    const inv = wh.inventory.filter((i) => i.store_id === s.store_id)
    const y = wh.today.getFullYear()
    const monthly = monthsToDate(wh).map(() => 0)
    for (const x of rows) if (x.sale_datetime.getFullYear() === y) monthly[x.sale_datetime.getMonth()] += x.amount
    const stock = inv.reduce((a, i) => a + i.stock_qty, 0)
    const perDay = inv.reduce((a, i) => a + (rate.get(`${i.store_id}|${i.product_id}`) ?? 0), 0)
    return {
      ...s,
      ...c.now,
      change: c.change?.revenue ?? null,
      customers: new Set(inRange(rows, r.from, r.to).map((x) => x.customer_id)).size,
      monthly,
      low: inv.filter((i) => i.below_safety_stock).length,
      out: inv.filter((i) => i.is_out_of_stock).length,
      stockValue: inv.reduce((a, i) => a + i.stock_value, 0),
      cover: perDay ? stock / perDay : null,
    }
  })
  const ranked = [...list].sort((a, b) => b.revenue - a.revenue)
  const top = ranked[0]?.revenue ?? 0
  return list.map((s) => ({ ...s, rank: ranked.indexOf(s) + 1, ofTop: top ? s.revenue / top : 0 }))
}

export type StoreStat = ReturnType<typeof storeStats>[number]

export function topProductsAt(wh: Warehouse, r: Range, storeId: string, n: number) {
  const names = new Map(wh.products.map((p) => [p.product_id, p.product_name]))
  const by = new Map<string, number>()
  for (const s of inRange(wh.sales, r.from, r.to)) {
    if (s.store_id === storeId) by.set(s.product_id, (by.get(s.product_id) ?? 0) + s.amount)
  }
  const list = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  const top = list[0]?.[1] ?? 0
  return list.map(([id, revenue]) => ({ product: names.get(id) ?? id, revenue, ofTop: top ? revenue / top : 0 }))
}

// ---------- Customers ----------

export function customerStats(wh: Warehouse, rows: FactSales[], r: Range) {
  const now = inRange(rows, r.from, r.to)
  const before = new Set(rows.filter((s) => s.sale_datetime < r.from).map((s) => s.customer_id))
  const cat = new Map(wh.products.map((p) => [p.product_id, p.category]))
  const storeName = new Map(wh.stores.map((s) => [s.store_id, s.store_name]))

  const by = new Map<string, { revenue: number; orders: number; units: number; last: Date; cats: Map<string, number>; stores: Map<string, number> }>()
  for (const s of now) {
    const c = by.get(s.customer_id) ?? { revenue: 0, orders: 0, units: 0, last: s.sale_datetime, cats: new Map(), stores: new Map() }
    c.revenue += s.amount
    c.orders += 1
    c.units += s.quantity
    if (s.sale_datetime > c.last) c.last = s.sale_datetime
    const k = cat.get(s.product_id)!
    c.cats.set(k, (c.cats.get(k) ?? 0) + s.amount)
    c.stores.set(s.store_id, (c.stores.get(s.store_id) ?? 0) + 1)
    by.set(s.customer_id, c)
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

  const list = wh.customers
    .filter((c) => by.has(c.customer_id))
    .map((c) => {
      const s = by.get(c.customer_id)!
      return {
        ...c,
        revenue: s.revenue,
        orders: s.orders,
        units: s.units,
        last: s.last,
        favourite: top(s.cats),
        homeStore: storeName.get(top(s.stores)) ?? '',
        returning: before.has(c.customer_id),
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  const revenue = list.reduce((a, c) => a + c.revenue, 0)
  const orders = list.reduce((a, c) => a + c.orders, 0)
  return { list, revenue, orders, active: list.length, total: wh.customers.length, returning: list.filter((c) => c.returning).length }
}

export type CustomerStats = ReturnType<typeof customerStats>

/** Customers, revenue and revenue per customer for each gender × age group. */
export function segments(stats: CustomerStats) {
  const genders = [...new Set(stats.list.map((c) => c.gender))].sort()
  const ages = [...new Set(stats.list.map((c) => c.age_group))].sort()
  const cells = genders.map((gender) =>
    ages.map((age) => {
      const group = stats.list.filter((c) => c.gender === gender && c.age_group === age)
      const revenue = group.reduce((a, c) => a + c.revenue, 0)
      return { gender, age, customers: group.length, revenue, perCustomer: group.length ? revenue / group.length : 0 }
    }),
  )
  const max = Math.max(...cells.flat().map((c) => c.revenue))
  return { genders, ages, cells, max }
}

/** Share of each gender's revenue that goes to each category. */
export function categoryByGender(wh: Warehouse, rows: FactSales[], r: Range) {
  const gender = new Map(wh.customers.map((c) => [c.customer_id, c.gender]))
  const cat = new Map(wh.products.map((p) => [p.product_id, p.category]))
  const cats = [...new Set(wh.products.map((p) => p.category))].sort((a, b) => a.localeCompare(b))
  const by = new Map<string, Map<string, number>>()
  for (const s of inRange(rows, r.from, r.to)) {
    const g = gender.get(s.customer_id) ?? 'Unknown'
    const m = by.get(g) ?? new Map<string, number>()
    m.set(cat.get(s.product_id)!, (m.get(cat.get(s.product_id)!) ?? 0) + s.amount)
    by.set(g, m)
  }
  return {
    categories: cats,
    rows: [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([g, m]) => {
        const total = [...m.values()].reduce((a, b) => a + b, 0)
        return { gender: g, total, shares: cats.map((c) => (total ? (m.get(c) ?? 0) / total : 0)) }
      }),
  }
}

// ---------- Inventory ----------

export type Level = 'out' | 'low' | 'ok' | 'good' | 'deep'

/** Stock against safety stock, in five bands. */
export function level(i: FactInventory): Level {
  if (i.stock_qty === 0) return 'out'
  if (i.stock_qty < i.safety_stock) return 'low'
  const x = i.stock_qty / i.safety_stock
  return x < 2 ? 'ok' : x < 4 ? 'good' : 'deep'
}

export function inventoryStats(wh: Warehouse, region: RegionFilter) {
  const ids = storeIdsIn(wh, region)
  const inv = wh.inventory.filter((i) => ids.has(i.store_id))
  const rate = sellRate(wh)
  const products = new Map(wh.products.map((p) => [p.product_id, p]))
  const stores = new Map(wh.stores.map((s) => [s.store_id, s]))

  const restock = inv
    .filter((i) => i.below_safety_stock)
    .map((i) => {
      const perDay = rate.get(`${i.store_id}|${i.product_id}`) ?? 0
      return {
        ...i,
        product: products.get(i.product_id)!.product_name,
        category: products.get(i.product_id)!.category,
        store: stores.get(i.store_id)!.store_name,
        city: stores.get(i.store_id)!.city,
        shortfall: i.safety_stock - i.stock_qty,
        cost: (i.safety_stock - i.stock_qty) * i.unit_cost,
        cover: perDay ? i.stock_qty / perDay : null,
      }
    })
    .sort((a, b) => a.stock_qty / a.safety_stock - b.stock_qty / b.safety_stock || b.cost - a.cost)

  const cover = wh.products
    .map((p) => {
      const rowsOf = inv.filter((i) => i.product_id === p.product_id)
      const stock = rowsOf.reduce((a, i) => a + i.stock_qty, 0)
      const perDay = rowsOf.reduce((a, i) => a + (rate.get(`${i.store_id}|${i.product_id}`) ?? 0), 0)
      return { product: p.product_name, category: p.category, stock, perDay, days: perDay ? stock / perDay : null }
    })
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity))

  const byCategory = new Map<string, { category: string; value: number; units: number }>()
  for (const i of inv) {
    const c = products.get(i.product_id)!.category
    const v = byCategory.get(c) ?? { category: c, value: 0, units: 0 }
    v.value += i.stock_value
    v.units += i.stock_qty
    byCategory.set(c, v)
  }
  const value = inv.reduce((a, i) => a + i.stock_value, 0)
  const dates = inv.map((i) => i.last_updated).sort()

  return {
    rows: inv,
    stores: wh.stores.filter((s) => ids.has(s.store_id)),
    value,
    units: inv.reduce((a, i) => a + i.stock_qty, 0),
    below: restock.length,
    out: inv.filter((i) => i.is_out_of_stock).length,
    restockCost: restock.reduce((a, i) => a + i.cost, 0),
    restock,
    cover,
    categories: [...byCategory.values()].map((c) => ({ ...c, share: value ? c.value / value : 0 })).sort((a, b) => b.value - a.value),
    counted: { from: dates[0], to: dates[dates.length - 1] },
  }
}

export type Lane = 'out' | 'low' | 'watch' | 'ok'

/** A product stocked everywhere still goes on watch when its days of cover drop under this. */
export const WATCH_DAYS = 60

/** One card per product for the stock board: the stores short of safety stock, and the lane the emptiest one puts it in. */
export function stockBoard(wh: Warehouse, region: RegionFilter, products: ProductStat[]) {
  const ids = storeIdsIn(wh, region)
  const stores = new Map(wh.stores.map((s) => [s.store_id, s]))
  return products.map((p) => {
    const rows = wh.inventory.filter((i) => i.product_id === p.product_id && ids.has(i.store_id))
    const short = rows
      .filter((i) => i.below_safety_stock)
      .map((i) => ({ ...i, store: stores.get(i.store_id)!, shortfall: i.safety_stock - i.stock_qty, cost: (i.safety_stock - i.stock_qty) * i.unit_cost }))
      .sort((a, b) => a.stock_qty / a.safety_stock - b.stock_qty / b.safety_stock || b.cost - a.cost)
    const lane: Lane = short.some((i) => i.is_out_of_stock) ? 'out' : short.length ? 'low' : p.cover !== null && p.cover < WATCH_DAYS ? 'watch' : 'ok'
    return {
      ...p,
      lane,
      stores: rows.length,
      stocked: rows.length - short.length,
      short,
      order: short.reduce((a, i) => a + i.shortfall, 0),
      cost: short.reduce((a, i) => a + i.cost, 0),
    }
  })
}

export type BoardCard = ReturnType<typeof stockBoard>[number]

// ---------- Page-specific views ----------

/** The last complete day against the average complete day of the range. */
export function latestDay(rows: FactSales[], r: Range) {
  const end = lastMidnight(r)
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)
  const day = sum(inRange(rows, start, end))
  const n = days(r).length
  const all = sum(inRange(rows, r.from, end))
  return { date: start, ...day, avgRevenue: n ? all.revenue / n : 0, avgOrders: n ? all.orders / n : 0 }
}

/** Revenue per region per bucket. Buckets are days, or weeks when the range is longer than 62 days. */
export function stackedByRegion(wh: Warehouse, rows: FactSales[], r: Range) {
  const list = days(r)
  const weekly = list.length > 62
  const regionOf = new Map(wh.stores.map((s) => [s.store_id, s.region]))
  const regionsList = [...new Set(wh.stores.map((s) => s.region))].sort((a, b) => a.localeCompare(b))
  const bucketOf = (d: Date) => {
    if (!weekly) return dayKey(d)
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
    return monday.getTime()
  }
  const keys = [...new Set(list.map(bucketOf))]
  const index = new Map(keys.map((k, i) => [k, i]))
  const buckets = keys.map((k) => ({ start: new Date(k), parts: regionsList.map(() => 0), total: 0 }))
  for (const s of inRange(rows, r.from, lastMidnight(r))) {
    const b = buckets[index.get(bucketOf(s.sale_datetime))!]
    if (!b) continue
    b.parts[regionsList.indexOf(regionOf.get(s.store_id)!)] += s.amount
    b.total += s.amount
  }
  return { weekly, regions: regionsList, buckets }
}

/** Customers split by spend: the top 10%, the next 40%, and the bottom half, with each group's share of revenue. */
export function spendTiers(stats: CustomerStats) {
  const list = [...stats.list].sort((a, b) => b.revenue - a.revenue)
  const n = list.length
  const top = n ? Math.max(1, Math.round(n * 0.1)) : 0
  const half = Math.max(top, Math.round(n * 0.5))
  const tiers = [
    { key: 'top', label: 'Top 10%', people: list.slice(0, top) },
    { key: 'next', label: 'Next 40%', people: list.slice(top, half) },
    { key: 'rest', label: 'Bottom 50%', people: list.slice(half) },
  ].map((t) => {
    const revenue = t.people.reduce((a, c) => a + c.revenue, 0)
    return { key: t.key, label: t.label, customers: t.people.length, revenue, share: stats.revenue ? revenue / stats.revenue : 0, avg: t.people.length ? revenue / t.people.length : 0 }
  })
  const asc = list.map((c) => c.revenue).reverse()
  const median = n ? (n % 2 ? asc[(n - 1) / 2] : (asc[n / 2 - 1] + asc[n / 2]) / 2) : 0
  return { tiers, median, oneTime: n ? list.filter((c) => c.orders === 1).length / n : 0 }
}
