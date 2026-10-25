import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { asApi } from './fixture.mjs'

const baseURL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'
let browser

const warehouse = {
  stores: [
    { store_id: 'north', store_name: 'Hanoi showroom', region: 'Miền Bắc', city: 'Hà Nội', address: '1 Hanoi Street', latitude: 21.03, longitude: 105.85 },
    { store_id: 'south', store_name: 'Saigon showroom', region: 'Miền Nam', city: 'TP.HCM', address: '2 Saigon Street', latitude: 10.78, longitude: 106.7 },
    { store_id: 'central', store_name: 'Danang showroom', region: 'Miền Trung', city: 'Đà Nẵng', address: '3 Danang Street', latitude: 16.05, longitude: 108.2 },
  ],
  products: [
    { product_id: 'toner', product_name: 'Toner', category: 'Skincare' },
    { product_id: 'cleanser', product_name: 'Cleanser', category: 'Skincare' },
    { product_id: 'cream', product_name: 'Moisturizer', category: 'Skincare' },
  ],
  customers: ['a', 'b'].map((id) => ({ customer_id: id, customer_name: id, gender: 'Other', birth_year: 1990, age_group: '25–34' })),
  sales: [
    { sale_id: 'jan-1', store_id: 'north', product_id: 'toner', customer_id: 'a', sale_datetime: '2024-01-05T12:00:00', sale_date: '2024-01-05', quantity: 1, amount: 100 },
    { sale_id: 'jan-2', store_id: 'north', product_id: 'cleanser', customer_id: 'b', sale_datetime: '2024-01-20T12:00:00', sale_date: '2024-01-20', quantity: 1, amount: 200 },
    { sale_id: 'feb-1', store_id: 'north', product_id: 'cream', customer_id: 'a', sale_datetime: '2024-02-15T12:00:00', sale_date: '2024-02-15', quantity: 1, amount: 750 },
    { sale_id: 'feb-2', store_id: 'south', product_id: 'toner', customer_id: 'a', sale_datetime: '2024-02-16T12:00:00', sale_date: '2024-02-16', quantity: 1, amount: 200 },
  ],
  inventory: [
    { inventory_id: 'n1', store_id: 'north', product_id: 'toner', last_updated: '2024-02-20', stock_qty: 0, safety_stock: 5, unit_cost: 10, stock_value: 0, is_out_of_stock: true, below_safety_stock: true },
    { inventory_id: 'n2', store_id: 'north', product_id: 'cleanser', last_updated: '2024-02-20', stock_qty: 1, safety_stock: 5, unit_cost: 10, stock_value: 10, is_out_of_stock: false, below_safety_stock: true },
    { inventory_id: 's1', store_id: 'south', product_id: 'toner', last_updated: '2024-02-20', stock_qty: 2, safety_stock: 5, unit_cost: 10, stock_value: 20, is_out_of_stock: false, below_safety_stock: true },
    { inventory_id: 'c1', store_id: 'central', product_id: 'cream', last_updated: '2024-02-20', stock_qty: 10, safety_stock: 5, unit_cost: 10, stock_value: 100, is_out_of_stock: false, below_safety_stock: false },
  ],
  today: '2024-02-20T12:00:00',
  synced_at: '2024-02-20T12:00:00',
}

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
})
after(async () => {
  await browser?.close()
})

async function openStores(t, data = warehouse, viewport = { width: 1440, height: 1100 }) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' })
  t.after(() => page.close())
  await page.route('**/api/warehouse', (route) => route.fulfill({ json: asApi(data) }))
  await page.goto(baseURL)
  await page.getByRole('button', { name: 'Stores', exact: true }).click()
  await page.locator('.store-detail').waitFor()
  return page
}

async function metrics(page) {
  return page.locator('.store-detail .stat-grid dd').evaluateAll((nodes) => nodes.map((node) => node.querySelector('.sr-only')?.textContent ?? node.textContent))
}

async function waitForMetrics(page, expected) {
  await page.waitForFunction((want) => {
    const values = [...document.querySelectorAll('.store-detail .stat-grid dd')].map((node) => node.querySelector('.sr-only')?.textContent ?? node.textContent)
    return JSON.stringify(values) === JSON.stringify(want)
  }, expected, { timeout: 3000 })
  assert.deepEqual(await metrics(page), expected)
}

test('map uses equal location pins, stock status, and region counts instead of sales modes', async (t) => {
  const page = await openStores(t)
  assert.equal(await page.locator('.map-card .seg').count(), 0, 'sales metric switcher must not appear on the location map')
  assert.doesNotMatch(await page.locator('.region-keys').innerText(), /revenue/i)
  const radii = await page.locator('.map-bubble').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('r')))
  assert.equal(new Set(radii).size, 1, 'location markers must not be sized by revenue or alert count')
  assert.equal(await page.locator('.map-pin .map-alert').count(), 0, 'pins carry no stock markers; stock lives in the store detail')
  assert.match(await page.locator('.map-pin').first().getAttribute('aria-label'), /2 products below safety.*1 out of stock/)
  await page.locator('.map-pin').nth(1).focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('#store-title').innerText(), 'Saigon showroom')
  assert.match(await page.locator('.map-tip').innerText(), /1 product below safety/)
})

test('map and detail share a bottom edge without page overflow at desktop and mobile widths', async (t) => {
  const page = await openStores(t)
  const map = await page.locator('.map-card').boundingBox()
  const detail = await page.locator('.store-detail').boundingBox()
  assert.ok(Math.abs(map.y + map.height - detail.y - detail.height) < 2, 'desktop cards must have aligned bottom edges')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  const mobileMap = await page.locator('.map-card').boundingBox()
  const mobileDetail = await page.locator('.store-detail').boundingBox()
  assert.ok(mobileDetail.y >= mobileMap.y + mobileMap.height, 'cards must stack on mobile')
})

test('hovering a store month moves its active bar and updates all sales statistics and products', async (t) => {
  const page = await openStores(t)
  await waitForMetrics(page, ['750', '1', '750', '1'])
  const stock = await page.locator('.store-detail .stock-line').innerText()
  await page.locator('.store-detail .col').first().hover()
  await waitForMetrics(page, ['300', '2', '150', '2'])
  assert.equal(await page.locator('.store-detail .col.is-active .col-label').innerText(), 'Jan')
  assert.deepEqual(await page.locator('.store-detail .barlist-label').allTextContents(), ['Cleanser', 'Toner'])
  assert.equal(await page.locator('.store-detail .stock-line').innerText(), stock, 'month selection must not pretend inventory is historical')
  await page.locator('#store-title').hover()
  assert.equal(await page.locator('.store-detail .col.is-active .col-label').innerText(), 'Jan', 'the last inspected month stays selected')
  await page.locator('.store-detail .col').nth(1).hover()
  await waitForMetrics(page, ['750', '1', '750', '1'])
  assert.equal(await page.locator('.store-detail .col.is-active .col-label').innerText(), 'Feb')
  assert.deepEqual(await page.locator('.store-detail .barlist-label').allTextContents(), ['Moisturizer'])
})

test('month statistics also respond to keyboard focus and reset when the store changes', async (t) => {
  const page = await openStores(t)
  const jan = page.locator('.store-detail .cols button').first()
  assert.equal(await jan.count(), 1, 'interactive month bars must be keyboard-accessible buttons')
  await jan.focus()
  await waitForMetrics(page, ['300', '2', '150', '2'])
  await page.keyboard.press('Enter')
  assert.equal(await jan.getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: 'Saigon showroom Miền Nam' }).click()
  await waitForMetrics(page, ['200', '1', '200', '1'])
  assert.equal(await page.locator('.store-detail .col.is-active .col-label').innerText(), 'Feb')
})

test('out-of-stock alerts without a safety-stock breach do not claim low stock', async (t) => {
  const data = structuredClone(warehouse)
  data.inventory[0].safety_stock = 0
  data.inventory[0].below_safety_stock = false
  data.inventory[1].stock_qty = 10
  data.inventory[1].below_safety_stock = false
  const page = await openStores(t, data)
  const pin = page.locator('.map-pin').first()
  assert.match(await pin.getAttribute('aria-label'), /1 out of stock/)
  assert.doesNotMatch(await pin.getAttribute('aria-label'), /below safety/)
  await pin.focus()
  assert.doesNotMatch(await page.locator('.map-tip').innerText(), /below safety/)
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('.store-detail .stock-line b').innerText(), '1 out of stock')
})

test('zero-sales months and stores without alerts have explicit empty states', async (t) => {
  const page = await openStores(t)
  await page.getByRole('button', { name: 'Danang showroom Miền Trung' }).click()
  await page.locator('.store-detail .col').first().hover()
  await waitForMetrics(page, ['0', '0', '0', '0'])
  assert.match(await page.locator('.store-detail').innerText(), /No sales in this period/)
  assert.match(await page.locator('.store-detail .stock-line').innerText(), /All products above safety/)
  assert.equal(await page.locator('.map-pin').nth(2).locator('.map-alert').count(), 0)
})
