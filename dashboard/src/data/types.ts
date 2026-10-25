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

/** gold.stock_position: a fact_inventory row plus the stock rules dbt works out (dbt/models/gold/inventory). */
export interface StockPosition {
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
  /** Units sold per day over the sell_rate_days before the last sale. */
  units_per_day: number
  /** stock_qty / units_per_day; null when nothing sold in that window. */
  days_of_cover: number | null
  stock_level: Level
  /** Units needed to reach safety stock, 0 when there are enough. */
  shortfall: number
  restock_cost: number
}

export type Level = 'out' | 'low' | 'ok' | 'good' | 'deep'

export type Lane = 'out' | 'low' | 'watch' | 'ok'

/** gold.product_stock: one product in one region, or in region 'All', with its stock board lane. */
export interface ProductStock {
  product_id: string
  region: Region | 'All'
  stock_qty: number
  units_per_day: number
  days_of_cover: number | null
  lane: Lane
  /** days_of_cover is under the watch_days setting, whatever the lane. */
  low_cover: boolean
}

/** gold.store_stock: one store's stock, sell rate and days of cover. */
export interface StoreStock {
  store_id: string
  stock_qty: number
  units_per_day: number
  days_of_cover: number | null
}

/** gold.stock_rules: the stock settings from dbt_project.yml. */
export interface StockRules {
  sell_rate_days: number
  watch_days: number
  stock_ok_below: number
  stock_good_below: number
}

export interface Warehouse {
  stores: DimStore[]
  products: DimProduct[]
  customers: DimCustomer[]
  sales: FactSales[]
  inventory: StockPosition[]
  productStock: ProductStock[]
  storeStock: StoreStock[]
  stockRules: StockRules
  /** The "as of" date for month-to-date figures. */
  today: Date
  /** When the pipeline last loaded the gold models. */
  syncedAt: Date | null
  /** Where the rows came from. Sample data is labelled as such everywhere. */
  source: 'postgres' | 'sample'
  /** ISO currency code for amounts, or null when the warehouse does not record one. */
  currency: string | null
}
