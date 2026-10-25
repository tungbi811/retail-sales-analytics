// Row shapes mirror the dbt gold models in dbt/models/gold.
// Swap the mock generator for an API that returns these rows and every view keeps working.

export type Region = string

export interface DimStore {
  store_id: string
  store_name: string
  region: Region
  address: string
  city: string
  latitude: number
  longitude: number
}

export interface DimProduct {
  product_id: string
  product_name: string
  category: string
}

export interface DimCustomer {
  customer_id: string
  customer_name: string
  gender: string
  birth_year: number
  age_group: string
}

export interface FactSales {
  sale_id: string
  sale_datetime: Date
  sale_date: string // YYYY-MM-DD
  product_id: string
  store_id: string
  customer_id: string
  quantity: number
  amount: number
}

export interface FactInventory {
  inventory_id: string
  store_id: string
  product_id: string
  last_updated: string
  stock_qty: number
  safety_stock: number
  unit_cost: number
  stock_value: number
  is_out_of_stock: boolean
  below_safety_stock: boolean
}

export interface Warehouse {
  stores: DimStore[]
  products: DimProduct[]
  customers: DimCustomer[]
  sales: FactSales[]
  inventory: FactInventory[]
  /** The "as of" date for month-to-date figures. */
  today: Date
  /** When the pipeline last loaded the gold models. */
  syncedAt: Date | null
  /** Where the rows came from. Sample data is labelled as such everywhere. */
  source: 'postgres' | 'sample'
  /** ISO currency code for amounts, or null when the warehouse does not record one. */
  currency: string | null
}
