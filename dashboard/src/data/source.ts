import { loadMockWarehouse } from './mock'
import type { FactSales, ProductStock, StockPosition, StockRules, StoreStock, Warehouse } from './types'

// VITE_DATA=sample forces the generated sample data; anything else reads the API.
export const wantsSample = import.meta.env.VITE_DATA === 'sample'

type Json<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] }

interface ApiWarehouse {
  stores: Warehouse['stores']
  products: Warehouse['products']
  customers: Warehouse['customers']
  sales: Json<FactSales>[]
  inventory: StockPosition[]
  product_stock: ProductStock[]
  store_stock: StoreStock[]
  stock_rules: StockRules
  today: string | null
  synced_at: string | null
}

export async function loadWarehouse(sample = wantsSample): Promise<Warehouse> {
  if (sample) return loadMockWarehouse()

  const res = await fetch('/api/warehouse')
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `API answered ${res.status}`)
  }
  const api: ApiWarehouse = await res.json()
  if (!api.today) throw new Error('gold.fact_sales is empty')

  return {
    stores: api.stores,
    products: api.products,
    customers: api.customers,
    sales: api.sales.map((s) => ({ ...s, sale_datetime: new Date(s.sale_datetime) })),
    inventory: api.inventory,
    productStock: api.product_stock,
    storeStock: api.store_stock,
    stockRules: api.stock_rules,
    // Ranges end exclusively at "today", so step past the last sale to include it.
    today: new Date(new Date(api.today).getTime() + 1000),
    syncedAt: api.synced_at ? new Date(api.synced_at) : null,
    source: 'postgres',
    currency: null,
  }
}
