import type { DimCustomer, DimProduct, DimStore, FactInventory, FactSales, Warehouse } from './types'

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

function generateInventory(rand: () => number): FactInventory[] {
  const rows: FactInventory[] = []
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

export function loadMockWarehouse(): Warehouse {
  const rand = mulberry32(20261024)
  return {
    stores,
    products,
    customers: generateCustomers(rand),
    sales: generateSales(rand),
    inventory: generateInventory(rand),
    today: TODAY,
    syncedAt: new Date(2026, 9, 24, 6, 0),
    source: 'sample',
    currency: 'USD',
  }
}
