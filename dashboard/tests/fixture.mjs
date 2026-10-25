// A small warehouse for the browser tests: January 2024 is the first month on record, February runs to 19 Feb.
import { withSalesRules, withStockRules } from '../src/data/mock.ts'

/** The API's answer for a test warehouse, with the tables dbt would build from it: stock_position columns on inventory,
 *  product_stock, store_stock, stock_rules, report_periods, sales_monthly and customer_period. */
export function asApi(wh) {
  const { inventory, productStock, storeStock, stockRules } = withStockRules(wh.stores, wh.sales, wh.inventory)
  // As the API's loader does, "now" is one second after `today`.
  const sales = wh.sales.map((s) => ({ ...s, sale_datetime: new Date(s.sale_datetime) }))
  const { periods, salesMonthly, customerPeriods } = withSalesRules({ stores: wh.stores, products: wh.products, sales, today: new Date(new Date(wh.today).getTime() + 1000) })
  return { ...wh, inventory, product_stock: productStock, store_stock: storeStock, stock_rules: stockRules, report_periods: periods, sales_monthly: salesMonthly, customer_period: customerPeriods }
}

const sale = (sale_id, store_id, product_id, sale_datetime, quantity, amount) => ({ sale_id, store_id, product_id, customer_id: 'a', sale_datetime, sale_date: sale_datetime.slice(0, 10), quantity, amount })

export const warehouse = asApi({
  stores: [
    { store_id: 'n1', store_name: 'Hanoi showroom', region: 'Miền Bắc', city: 'Hà Nội', address: '1 Hanoi Street', latitude: 21.03, longitude: 105.85 },
    { store_id: 'n2', store_name: 'Haiphong showroom', region: 'Miền Bắc', city: 'Hải Phòng', address: '2 Haiphong Street', latitude: 20.86, longitude: 106.68 },
    { store_id: 's1', store_name: 'Saigon showroom', region: 'Miền Nam', city: 'TP.HCM', address: '3 Saigon Street', latitude: 10.78, longitude: 106.7 },
  ],
  products: [
    { product_id: 'p1', product_name: 'Toner', category: 'Skincare' },
    { product_id: 'p2', product_name: 'Lipstick', category: 'Makeup' },
  ],
  customers: [{ customer_id: 'a', customer_name: 'An Nguyen', gender: 'Other', birth_year: 1990, age_group: '25–34' }],
  sales: [
    sale('j1', 'n1', 'p1', '2024-01-05T10:00:00', 2, 100),
    sale('j2', 'n2', 'p1', '2024-01-10T14:00:00', 1, 200),
    sale('j3', 's1', 'p2', '2024-01-25T16:00:00', 3, 300),
    sale('f1', 'n1', 'p1', '2024-02-02T10:00:00', 1, 150),
    sale('f2', 'n1', 'p2', '2024-02-10T12:00:00', 2, 250),
    sale('f3', 'n2', 'p1', '2024-02-15T18:00:00', 1, 100),
    sale('f4', 's1', 'p2', '2024-02-19T20:00:00', 4, 500),
  ],
  inventory: [
    { inventory_id: 'i1', store_id: 'n1', product_id: 'p1', last_updated: '2024-02-19', stock_qty: 4, safety_stock: 5, unit_cost: 10, stock_value: 40, is_out_of_stock: false, below_safety_stock: true },
    { inventory_id: 'i2', store_id: 's1', product_id: 'p2', last_updated: '2024-02-19', stock_qty: 0, safety_stock: 5, unit_cost: 10, stock_value: 0, is_out_of_stock: true, below_safety_stock: true },
    { inventory_id: 'i3', store_id: 'n2', product_id: 'p2', last_updated: '2024-02-19', stock_qty: 1, safety_stock: 5, unit_cost: 10, stock_value: 10, is_out_of_stock: false, below_safety_stock: true },
    { inventory_id: 'i4', store_id: 'n2', product_id: 'p1', last_updated: '2024-02-19', stock_qty: 9, safety_stock: 5, unit_cost: 10, stock_value: 90, is_out_of_stock: false, below_safety_stock: false },
  ],
  today: '2024-02-19T20:00:00',
  synced_at: '2024-02-19T20:00:00',
})
