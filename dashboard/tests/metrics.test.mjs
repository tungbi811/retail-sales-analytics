// Month window, KPI, pace and heatmap maths behind the Dashboard. Node strips the types from metrics.ts.
process.env.TZ = 'Asia/Ho_Chi_Minh'

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { categoryMix, kpis, monthPace, monthWindow, salesByTime, salesFor, stockAlerts } from '../src/data/metrics.ts'

const at = (y, m, d, h = 0) => new Date(y, m, d, h)
const sale = (sale_id, store_id, product_id, sale_datetime, quantity, amount) => ({ sale_id, store_id, product_id, customer_id: 'c', sale_datetime, quantity, amount })

// January is the first month on record; February is in progress, with the last sale on 19 Feb.
const wh = {
  stores: [
    { store_id: 'n1', store_name: 'Hanoi showroom', region: 'Miền Bắc', city: 'Hà Nội' },
    { store_id: 'n2', store_name: 'Haiphong showroom', region: 'Miền Bắc', city: 'Hải Phòng' },
    { store_id: 's1', store_name: 'Saigon showroom', region: 'Miền Nam', city: 'TP.HCM' },
  ],
  products: [
    { product_id: 'p1', product_name: 'Toner', category: 'Skincare' },
    { product_id: 'p2', product_name: 'Lipstick', category: 'Makeup' },
  ],
  sales: [
    sale('j1', 'n1', 'p1', at(2024, 0, 5, 10), 2, 100),
    sale('j2', 'n2', 'p1', at(2024, 0, 10, 14), 1, 200),
    // After 20 Jan, so outside the "same days of last month" comparison.
    sale('j3', 's1', 'p2', at(2024, 0, 25, 16), 3, 300),
    sale('f1', 'n1', 'p1', at(2024, 1, 2, 10), 1, 150),
    sale('f2', 'n1', 'p2', at(2024, 1, 10, 12), 2, 250),
    sale('f3', 'n2', 'p1', at(2024, 1, 15, 18), 1, 100),
    sale('f4', 's1', 'p2', at(2024, 1, 19, 20), 4, 500),
  ],
  inventory: [
    { inventory_id: 'i1', store_id: 'n1', product_id: 'p1', stock_qty: 4, safety_stock: 5, is_out_of_stock: false, below_safety_stock: true },
    { inventory_id: 'i2', store_id: 's1', product_id: 'p2', stock_qty: 0, safety_stock: 5, is_out_of_stock: true, below_safety_stock: true },
    { inventory_id: 'i3', store_id: 'n2', product_id: 'p2', stock_qty: 1, safety_stock: 5, is_out_of_stock: false, below_safety_stock: true },
    { inventory_id: 'i4', store_id: 'n2', product_id: 'p1', stock_qty: 9, safety_stock: 5, is_out_of_stock: false, below_safety_stock: false },
  ],
  today: at(2024, 1, 20, 12),
}

const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 0.01, `${msg ?? ''} expected ${expected}, got ${actual}`)

test('the month in progress runs to today and compares with the same days of last month', () => {
  const w = monthWindow(wh, 2024, 1)
  assert.equal(w.current, true)
  assert.deepEqual([w.from, w.to, w.prevFrom, w.prevTo], [at(2024, 1, 1), wh.today, at(2024, 0, 1), at(2024, 0, 20, 12)])
})

test('a finished month runs to the 1st of the next and compares with the whole month before', () => {
  const w = monthWindow(wh, 2024, 0)
  assert.equal(w.current, false)
  assert.deepEqual([w.from, w.to, w.prevFrom, w.prevTo], [at(2024, 0, 1), at(2024, 1, 1), at(2023, 11, 1), at(2024, 0, 1)])
})

test('KPIs for the month in progress compare against the same days of last month', () => {
  const k = kpis(wh, wh.sales, monthWindow(wh, 2024, 1), 'All')
  assert.equal(k.monthLabel, 'February 2024')
  assert.equal(k.hasPrev, true)
  assert.deepEqual([k.revenue.value, k.orders.value, k.units.value, k.aov.value], [1000, 4, 8, 250])
  // 1–20 Jan holds j1 and j2 only: 300 revenue, 2 orders, 3 units.
  near(k.revenue.change, ((1000 - 300) / 300) * 100, 'revenue change')
  near(k.orders.change, 100, 'orders change')
  near(k.units.change, ((8 - 3) / 3) * 100, 'units change')
  near(k.aov.change, ((250 - 150) / 150) * 100, 'aov change')
  // The ring is against all of January (6 units), not the same days.
  near(k.units.ofPrevMonth, 8 / 6, 'units ring')
})

test('the first month on record reports no change and no earlier bars', () => {
  const k = kpis(wh, wh.sales, monthWindow(wh, 2024, 0), 'All')
  assert.equal(k.hasPrev, false)
  assert.deepEqual([k.revenue.change, k.orders.change, k.units.change, k.aov.change, k.units.ofPrevMonth], [null, null, null, null, null])
  assert.deepEqual(k.revenue.lastThree.map((m) => m.label), ['Jan'])
})

test('the last-three bars skip empty months before the first sale', () => {
  const k = kpis(wh, wh.sales, monthWindow(wh, 2024, 1), 'All')
  assert.deepEqual(k.revenue.lastThree.map((m) => [m.label, m.revenue, m.orders]), [['Jan', 600, 3], ['Feb', 1000, 4]])
})

test('orders split by region on the overview and by store city inside one region', () => {
  const w = monthWindow(wh, 2024, 1)
  assert.deepEqual(kpis(wh, wh.sales, w, 'All').orders.split, [{ label: 'Miền Bắc', share: 0.75 }, { label: 'Miền Nam', share: 0.25 }])
  const north = kpis(wh, salesFor(wh, 'Miền Bắc'), w, 'Miền Bắc').orders.split
  assert.deepEqual(north.map((s) => s.label), ['Hà Nội', 'Hải Phòng'])
  near(north[0].share, 2 / 3)
  near(north[1].share, 1 / 3)
})

test('orders split keeps the top three and is empty for a month without sales', () => {
  const many = { ...wh, stores: ['a', 'b', 'c', 'd'].map((id) => ({ store_id: id, region: 'R', city: id.toUpperCase() })) }
  const rows = ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'c', 'c', 'd'].map((s, i) => sale(`x${i}`, s, 'p1', at(2024, 1, 3, 10), 1, 10))
  const split = kpis(many, rows, monthWindow(many, 2024, 1), 'R').orders.split
  assert.deepEqual(split.map((s) => [s.label, s.share]), [['A', 0.4], ['B', 0.3], ['C', 0.2]])
  assert.deepEqual(kpis(wh, [], monthWindow(wh, 2024, 1), 'All').orders.split, [])
})

test('month pace is missing for the first month on record', () => {
  assert.equal(monthPace(wh.sales, monthWindow(wh, 2024, 0)), null)
})

test('month pace projects the month in progress and dates the pass of last month', () => {
  const short = { ...wh, today: at(2024, 1, 11) }
  const rows = [sale('a', 'n1', 'p1', at(2024, 0, 15), 1, 600), sale('b', 'n1', 'p1', at(2024, 1, 5), 1, 300)]
  const p = monthPace(rows, monthWindow(short, 2024, 1))
  // 300 over 10 days is 30 a day; February 2024 has 29 days.
  assert.equal(p.current, true)
  assert.equal(p.score, 50)
  near(p.projected, 870, 'projection')
  near(p.vsLastMonth, 45, 'vs last month')
  assert.deepEqual(p.passDate, at(2024, 1, 21))
  assert.equal(p.passed, false)
})

test('month pace can pass 100 and stops projecting once a month is over', () => {
  const live = monthPace(wh.sales, monthWindow(wh, 2024, 1))
  assert.equal(live.score, 167)
  assert.equal(live.passed, true)
  assert.equal(live.passDate, null)

  const later = { ...wh, today: at(2024, 2, 10) }
  const closed = monthPace(wh.sales, monthWindow(later, 2024, 1))
  assert.equal(closed.current, false)
  assert.equal(closed.projected, 1000)
  assert.equal(closed.passDate, null)
  near(closed.vsLastMonth, ((1000 - 600) / 600) * 100)
})

test('sales by time covers the 12 weeks to the selected month end, Monday first', () => {
  const old = sale('old', 'n1', 'p1', at(2023, 9, 2, 8), 1, 9999)
  const heat = salesByTime([old, ...wh.sales], wh.today)
  assert.deepEqual(heat.bands, ['10–12', '12–14', '14–16', '16–18', '18–20', '20–22'], 'the October sale at 8h is outside the window')
  assert.equal(heat.max, 500)
  // 19 Feb 2024 is a Monday; 5 Jan and 2 Feb are Fridays.
  assert.deepEqual(heat.grid[5][0], { orders: 1, revenue: 500 })
  assert.deepEqual(heat.grid[0][4], { orders: 2, revenue: 250 })

  const january = salesByTime(wh.sales, at(2024, 1, 1))
  assert.equal(january.max, 300, 'a January window ignores February sales')
})

test('category mix shares the selected month only', () => {
  const mix = categoryMix(wh, wh.sales, monthWindow(wh, 2024, 1))
  assert.equal(mix.total, 1000)
  assert.deepEqual(mix.items.map((i) => [i.category, i.share]), [['Makeup', 0.75], ['Skincare', 0.25]])
})

test('stock alerts list rows below safety stock, emptiest first, filtered by region', () => {
  assert.deepEqual(stockAlerts(wh, 'All').map((a) => [a.id, a.out]), [['i2', true], ['i3', false], ['i1', false]])
  assert.deepEqual(stockAlerts(wh, 'Miền Bắc').map((a) => a.id), ['i3', 'i1'])
})
