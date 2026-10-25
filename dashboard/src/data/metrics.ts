import type { FactSales, Region, Warehouse } from './types'

export type RegionFilter = Region | 'All'

export const DAY = 86_400_000

export interface Totals {
  revenue: number
  orders: number
  units: number
}

export function sum(rows: FactSales[]): Totals {
  let revenue = 0
  let units = 0
  for (const r of rows) {
    revenue += r.amount
    units += r.quantity
  }
  return { revenue, orders: rows.length, units }
}

export const pct = (now: number, before: number) => (before === 0 ? 0 : ((now - before) / before) * 100)

export function regions(wh: Warehouse) {
  return [...new Set(wh.stores.map((s) => s.region))].sort((a, b) => a.localeCompare(b))
}

export function years(wh: Warehouse) {
  return [...new Set(wh.sales.map((s) => s.sale_datetime.getFullYear()))].sort()
}

export function salesFor(wh: Warehouse, region: RegionFilter) {
  if (region === 'All') return wh.sales
  const ids = new Set(wh.stores.filter((s) => s.region === region).map((s) => s.store_id))
  return wh.sales.filter((r) => ids.has(r.store_id))
}

export function inRange(rows: FactSales[], from: Date, to: Date) {
  const a = from.getTime()
  const b = to.getTime()
  return rows.filter((r) => {
    const t = r.sale_datetime.getTime()
    return t >= a && t < b
  })
}

/** One calendar month on the dashboard, from gold.report_periods: the month in progress runs to the last sale and is
 *  compared with the same days of the month before; a finished month is compared with the whole month before. */
export interface MonthWindow {
  year: number
  month: number
  /** YYYY-MM, the key in gold.report_periods and gold.sales_monthly */
  period: string
  from: Date
  to: Date
  prevFrom: Date
  prevTo: Date
  /** Still in progress: `to` is the last sale, not the 1st of the next month. */
  current: boolean
}

export const monthKey = (year: number, month: number) => {
  const d = new Date(year, month, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthWindow(wh: Warehouse, year: number, month: number): MonthWindow {
  const period = monthKey(year, month)
  const p = wh.periods.find((x) => x.period === period)
  // Months outside the data (before the first sales year) are plain calendar months with nothing to compare.
  const from = new Date(year, month, 1)
  return {
    year,
    month,
    period,
    from: p?.from_at ?? from,
    to: p?.to_at ?? new Date(year, month + 1, 1),
    prevFrom: p?.prev_from_at ?? new Date(year, month - 1, 1),
    prevTo: p?.prev_to_at ?? from,
    current: p?.is_current ?? false,
  }
}

const NO_MONTH = { revenue: 0, orders: 0, units: 0, avg_order: 0, has_previous: false, revenue_change_pct: null, orders_change_pct: null, units_change_pct: null, avg_order_change_pct: null, units_of_prev_month: null }

/** The KPI cards for one month: numbers and like-for-like changes come from gold.sales_monthly. */
export function kpis(wh: Warehouse, rows: FactSales[], w: MonthWindow, region: RegionFilter) {
  const monthOf = (period: string) => wh.salesMonthly.find((m) => m.month === period && m.region === region) ?? NO_MONTH
  const m = monthOf(w.period)

  // The first month on record has nothing before it: no earlier bars to draw.
  const lastThree = [2, 1, 0]
    .map((back) => {
      const from = new Date(w.year, w.month - back, 1)
      const r = monthOf(monthKey(w.year, w.month - back))
      return { label: from.toLocaleString('en', { month: 'short' }), revenue: r.revenue, orders: r.orders, back }
    })
    .filter((x) => x.back === 0 || x.orders > 0)

  // Where the orders came from: regions on the overview, the busiest stores inside one region.
  const monthRows = inRange(rows, w.from, w.to)
  const stores = new Map(wh.stores.map((s) => [s.store_id, s]))
  const byKey = new Map<string, number>()
  for (const r of monthRows) {
    const s = stores.get(r.store_id)
    const key = region === 'All' ? (s?.region ?? '') : (s?.city ?? r.store_id)
    byKey.set(key, (byKey.get(key) ?? 0) + 1)
  }
  const split = [...byKey.entries()]
    .map(([label, n]) => ({ label, share: monthRows.length ? n / monthRows.length : 0 }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 3)

  return {
    monthLabel: w.from.toLocaleString('en', { month: 'long', year: 'numeric' }),
    prevMonthLabel: w.prevFrom.toLocaleString('en', { month: 'short' }),
    hasPrev: m.has_previous,
    revenue: { value: m.revenue, change: m.revenue_change_pct, lastThree },
    orders: { value: m.orders, change: m.orders_change_pct, split },
    units: { value: m.units, change: m.units_change_pct, ofPrevMonth: m.units_of_prev_month },
    aov: { value: m.avg_order, change: m.avg_order_change_pct },
  }
}

export interface MonthPoint {
  month: number
  label: string
  revenue: number
  orders: number
  vsLastYear: number | null
  /** Month has not started yet. */
  future: boolean
  /** Month is in progress (month to date). */
  partial: boolean
}

export function monthly(wh: Warehouse, rows: FactSales[], year: number): MonthPoint[] {
  const by = (y: number) => {
    const acc = Array.from({ length: 12 }, () => ({ revenue: 0, orders: 0 }))
    for (const r of rows) {
      if (r.sale_datetime.getFullYear() !== y) continue
      const m = acc[r.sale_datetime.getMonth()]
      m.revenue += r.amount
      m.orders += 1
    }
    return acc
  }
  const cur = by(year)
  const prev = by(year - 1)
  const t = wh.today
  // The month in progress is compared with the same days one year earlier, not the full month.
  const sameDayLastYear = new Date(year - 1, t.getMonth(), t.getDate(), t.getHours(), t.getMinutes())
  const prevPartial = sum(inRange(rows, new Date(year - 1, t.getMonth(), 1), sameDayLastYear)).revenue
  return cur.map((m, i) => {
    const future = year > t.getFullYear() || (year === t.getFullYear() && i > t.getMonth())
    const partial = year === t.getFullYear() && i === t.getMonth()
    return {
      month: i,
      label: new Date(year, i, 1).toLocaleString('en', { month: 'short' }),
      revenue: m.revenue,
      orders: m.orders,
      vsLastYear: future || prev[i].revenue === 0 ? null : pct(m.revenue, partial ? prevPartial : prev[i].revenue),
      future,
      partial,
    }
  })
}

/** Year-to-date revenue measured against last year's full-year total. */
export function yearPace(wh: Warehouse, rows: FactSales[]) {
  const t = wh.today
  const y = t.getFullYear()
  const yearStart = new Date(y, 0, 1)
  const lastYearStart = new Date(y - 1, 0, 1)
  const lastYearSameDay = new Date(y - 1, t.getMonth(), t.getDate(), t.getHours())
  const ytd = sum(inRange(rows, yearStart, t)).revenue
  const lastYearTotal = sum(inRange(rows, lastYearStart, yearStart)).revenue
  // Nothing to measure against when the warehouse holds a single year.
  if (lastYearTotal === 0) return null
  const lastYearYtd = sum(inRange(rows, lastYearStart, lastYearSameDay)).revenue

  // Days until this year's running total passes last year's, at the current daily average.
  const elapsedDays = (t.getTime() - yearStart.getTime()) / DAY
  const perDay = ytd / elapsedDays
  const remaining = lastYearTotal - ytd
  const passDate = remaining <= 0 ? null : new Date(t.getTime() + (remaining / perDay) * DAY)

  return {
    year: y,
    ytd,
    lastYearTotal,
    score: Math.min(100, Math.round((ytd / lastYearTotal) * 100)),
    vsLastYearYtd: pct(ytd, lastYearYtd),
    passDate,
  }
}

/** Revenue since the 1st against last month's full total, and where the month lands at its current daily rate.
 *  A finished month lands where it closed. */
export function monthPace(rows: FactSales[], w: MonthWindow) {
  const end = new Date(w.year, w.month + 1, 1)
  const mtd = sum(inRange(rows, w.from, w.to)).revenue
  const lastMonthTotal = sum(inRange(rows, w.prevFrom, w.from)).revenue
  // Nothing to measure against in the first month on record.
  if (lastMonthTotal === 0) return null

  const perDay = mtd / ((w.to.getTime() - w.from.getTime()) / DAY)
  const projected = w.current ? perDay * ((end.getTime() - w.from.getTime()) / DAY) : mtd
  const remaining = lastMonthTotal - mtd
  const pass = remaining <= 0 || !w.current ? null : new Date(w.to.getTime() + (remaining / perDay) * DAY)

  return {
    month: w.from.toLocaleString('en', { month: 'long' }),
    lastMonth: w.prevFrom.toLocaleString('en', { month: 'long' }),
    current: w.current,
    mtd,
    lastMonthTotal,
    projected,
    score: Math.round((mtd / lastMonthTotal) * 100),
    vsLastMonth: pct(projected, lastMonthTotal),
    /** When the running total passes last month's, if that happens before the month ends. */
    passDate: pass && pass < end ? pass : null,
    passed: remaining <= 0,
  }
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Revenue and orders by weekday × two-hour band over the 12 weeks up to `end`. */
export function salesByTime(rows: FactSales[], end: Date) {
  const recent = inRange(rows, new Date(end.getTime() - 84 * DAY), end)
  const hours = recent.map((r) => r.sale_datetime.getHours())
  // Bands cover the trading hours present in the data, rounded to even hours.
  const first = hours.length ? Math.floor(Math.min(...hours) / 2) * 2 : 8
  const last = hours.length ? Math.max(...hours) : 21
  const bands: string[] = []
  for (let h = first; h <= last; h += 2) bands.push(`${h}–${h + 2}`)

  const grid = bands.map(() => WEEKDAYS.map(() => ({ orders: 0, revenue: 0 })))
  for (const r of recent) {
    const band = Math.floor((r.sale_datetime.getHours() - first) / 2)
    const day = (r.sale_datetime.getDay() + 6) % 7
    grid[band][day].orders += 1
    grid[band][day].revenue += r.amount
  }
  const max = Math.max(...grid.flat().map((c) => c.revenue))
  return { grid, bands, max, weeks: 12, end }
}

export function categoryMix(wh: Warehouse, rows: FactSales[], w: MonthWindow) {
  const monthRows = inRange(rows, w.from, w.to)
  const cat = new Map(wh.products.map((p) => [p.product_id, p.category]))
  const totals = new Map<string, number>()
  for (const r of monthRows) {
    const c = cat.get(r.product_id)!
    totals.set(c, (totals.get(c) ?? 0) + r.amount)
  }
  const total = [...totals.values()].reduce((a, b) => a + b, 0)
  const items = [...totals.entries()]
    .map(([category, revenue]) => ({ category, revenue, share: revenue / total }))
    .sort((a, b) => b.revenue - a.revenue)
  return { total, items }
}

export function stockAlerts(wh: Warehouse, region: RegionFilter) {
  const stores = new Map(wh.stores.map((s) => [s.store_id, s]))
  const products = new Map(wh.products.map((p) => [p.product_id, p]))
  return wh.inventory
    .filter((i) => i.below_safety_stock && (region === 'All' || stores.get(i.store_id)!.region === region))
    .map((i) => ({
      id: i.inventory_id,
      product: products.get(i.product_id)!.product_name,
      category: products.get(i.product_id)!.category,
      store: stores.get(i.store_id)!.store_name,
      stock: i.stock_qty,
      safety: i.safety_stock,
      out: i.is_out_of_stock,
    }))
    .sort((a, b) => a.stock / a.safety - b.stock / b.safety)
}

/** Monthly revenue rows for the Export button. */
export function toCsv(points: MonthPoint[], year: number, region: RegionFilter) {
  const lines = ['year,month,region,revenue,orders,vs_last_year_pct']
  for (const p of points) {
    if (p.future) continue
    lines.push(
      [year, p.month + 1, region, p.revenue.toFixed(2), p.orders, p.vsLastYear?.toFixed(1) ?? ''].join(','),
    )
  }
  return lines.join('\n')
}
