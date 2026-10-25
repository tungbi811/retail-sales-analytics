import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { asApi, warehouse as stocked } from './fixture.mjs'

const baseURL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'
let browser

const sale = (id, store, product, date, amount) => ({ sale_id: id, store_id: store, product_id: product, customer_id: 'a', sale_datetime: `${date}T10:00:00`, sale_date: date, quantity: 1, amount })

// Biggest seller declines; the biggest percentage gain contributes only +2.
const warehouse = {
  stores: [
    { store_id: 'north', store_name: 'Hanoi showroom', region: 'Miền Bắc', city: 'Hà Nội', address: '1 Hanoi Street', latitude: 21.03, longitude: 105.85 },
    { store_id: 'south', store_name: 'Saigon showroom', region: 'Miền Nam', city: 'TP.HCM', address: '2 Saigon Street', latitude: 10.78, longitude: 106.7 },
  ],
  products: [
    { product_id: 'wash', product_name: 'Sữa tắm', category: 'Body' },
    { product_id: 'toner', product_name: 'Toner', category: 'Body' },
    { product_id: 'tiny', product_name: 'Travel wash', category: 'Body' },
    { product_id: 'cleanser', product_name: 'Cleanser', category: 'Body' },
    { product_id: 'lipstick', product_name: 'Lipstick', category: 'Makeup' },
    { product_id: 'blush', product_name: 'Blush', category: 'Makeup' },
    { product_id: 'powder', product_name: 'Powder', category: 'Makeup' },
  ],
  customers: [{ customer_id: 'a', customer_name: 'An', gender: 'Other', birth_year: 1990, age_group: '25–34' }],
  sales: [
    ...[['wash', 1000, 900], ['toner', 100, 350], ['tiny', 1, 3], ['cleanser', 200, 0], ['lipstick', 0, 50], ['blush', 50, 70], ['powder', 60, 60]].flatMap(([product, previous, current]) => [
      ...(previous ? [sale(`jan-${product}`, 'north', product, '2024-01-05', previous)] : []),
      ...(current ? [sale(`feb-${product}`, 'north', product, '2024-02-05', current)] : []),
    ]),
    sale('jan-south', 'south', 'wash', '2024-01-06', 400),
    sale('feb-south', 'south', 'wash', '2024-02-06', 200),
    // Outside the same-days comparison, but included in the 90-day period.
    sale('late-january', 'north', 'toner', '2024-01-28', 10000),
  ],
  inventory: [],
  today: '2024-02-20T12:00:00',
  synced_at: '2024-02-20T12:00:00',
}

before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }) })
after(async () => { await browser?.close() })

async function openProducts(t, data = warehouse, viewport = { width: 1440, height: 1100 }, view = 'Sales') {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce', timezoneId: 'Asia/Ho_Chi_Minh', locale: 'en-US' })
  t.after(() => page.close())
  await page.route('**/api/warehouse', (route) => route.fulfill({ json: asApi(data) }))
  await page.goto(baseURL)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Products/ }).click()
  await page.locator('.lanes').waitFor()
  await view_(page, view)
  return page
}

const view_ = (page, name) => page.getByRole('group', { name: 'View' }).getByRole('button', { name, exact: true }).click()
const drivers = (page) => page.getByRole('region', { name: 'What drove the sales change?' })
const driverNames = (page) => drivers(page).locator('tbody button').allTextContents()
const changes = (page) => drivers(page).locator('tbody .driver-change').allTextContents()

test('drivers rank actual revenue impact, include gains and losses, and reconcile the hidden tail', async (t) => {
  const page = await openProducts(t)
  assert.equal(await drivers(page).count(), 1, 'replace the best-seller hero with revenue-change drivers')
  assert.equal(await page.getByText('Best seller', { exact: true }).count(), 0)
  assert.deepEqual(await driverNames(page), ['Sữa tắm', 'Toner', 'Cleanser', 'Lipstick', 'Blush'])
  assert.deepEqual(await changes(page), ['−300', '+250', '−200', '+50', '+20'])
  assert.match(await drivers(page).locator('.drivers-summary').innerText(), /−178/)
  assert.match(await drivers(page).locator('.drivers-summary').innerText(), /1,811.*1,633/s)
  assert.match(await drivers(page).locator('tfoot').innerText(), /Other products \(1\).*\+2/s)
  assert.match(await drivers(page).locator('.drivers-period').innerText(), /same days of January/)
})

test('products with no sales in either the previous or current period keep their full absolute contribution', async (t) => {
  const page = await openProducts(t)
  await drivers(page).waitFor()
  const stopped = drivers(page).locator('tbody tr', { hasText: 'Cleanser' })
  assert.match(await stopped.innerText(), /200.*0.*−200/s)
  const started = drivers(page).locator('tbody tr', { hasText: 'Lipstick' })
  assert.match(await started.innerText(), /0.*50.*\+50/s)
  assert.match(await started.innerText(), /No comparison sales/)
})

test('region and category filters update the contribution totals and product rows', async (t) => {
  const page = await openProducts(t)
  await drivers(page).waitFor()
  await page.getByRole('group', { name: 'Region', exact: true }).getByRole('button', { name: 'Miền Bắc' }).click()
  assert.match(await drivers(page).locator('.drivers-summary').innerText(), /\+22/)
  assert.deepEqual((await driverNames(page)).slice(0, 3), ['Toner', 'Cleanser', 'Sữa tắm'])
  await page.locator('.shelf-row', { hasText: 'Makeup' }).click()
  assert.match(await drivers(page).locator('.drivers-period').innerText(), /Makeup/)
  assert.match(await drivers(page).locator('.drivers-summary').innerText(), /\+70/)
  assert.deepEqual(await driverNames(page), ['Lipstick', 'Blush'])
  // The category carries over to the stock board.
  await view_(page, 'Stock board')
  assert.equal(await page.getByRole('group', { name: 'Category', exact: true }).getByRole('button', { name: 'Makeup', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.scard').count(), 3)
})

test('a period without comparison sales shows an explicit unavailable state, not fabricated growth', async (t) => {
  const page = await openProducts(t)
  await drivers(page).waitFor()
  await page.getByRole('group', { name: 'Period', exact: true }).getByRole('button', { name: '90 days', exact: true }).click()
  assert.match(await drivers(page).innerText(), /No comparison sales/)
  assert.match(await drivers(page).innerText(), /the 90 days before/)
  assert.equal(await drivers(page).locator('table').count(), 0)
  assert.equal(await drivers(page).locator('.drivers-summary').count(), 0)
  await page.getByRole('group', { name: 'Period', exact: true }).getByRole('button', { name: 'Month', exact: true }).click()
  assert.deepEqual((await driverNames(page)).slice(0, 2), ['Sữa tắm', 'Toner'])
})

test('equal net revenue still exposes offsetting product changes', async (t) => {
  const data = structuredClone(warehouse)
  data.sales.push(sale('offset', 'north', 'toner', '2024-02-08', 178))
  const page = await openProducts(t, data)
  await drivers(page).waitFor()
  assert.match(await drivers(page).locator('.drivers-summary').innerText(), /^0\s+net revenue change/)
  assert.equal(await drivers(page).locator('tbody button').count(), 5)
  assert.deepEqual((await changes(page)).slice(0, 2), ['+428', '−300'])
})

test('unchanged products and empty sales periods have honest empty states', async (t) => {
  const data = structuredClone(warehouse)
  data.sales = [sale('jan', 'north', 'wash', '2024-01-05', 100), sale('feb', 'north', 'wash', '2024-02-05', 100)]
  const page = await openProducts(t, data)
  await drivers(page).waitFor()
  assert.match(await drivers(page).innerText(), /No product-level revenue changes/)
  assert.equal(await drivers(page).locator('tbody button').count(), 0)
  await page.locator('.shelf-row', { hasText: 'Makeup' }).click()
  assert.match(await drivers(page).innerText(), /No sales in either period/)
})

test('driver products open their existing detail drawer with keyboard activation', async (t) => {
  const page = await openProducts(t)
  await drivers(page).waitFor()
  await drivers(page).getByRole('button', { name: 'Cleanser', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.getByRole('dialog').getByRole('heading', { level: 2 }).innerText(), 'Cleanser')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]'))), true, 'Tab stays inside the product detail')
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await drivers(page).getByRole('button', { name: 'Cleanser', exact: true }).evaluate((node) => node === document.activeElement), true, 'Escape returns focus to the selected driver')
})

test('a short preceding month never includes current-month sales in the comparison', async (t) => {
  const data = structuredClone(warehouse)
  data.today = '2025-03-31T12:00:00'
  data.sales = [
    sale('previous', 'north', 'wash', '2025-02-05', 100),
    sale('early-current', 'north', 'wash', '2025-03-01', 200),
    sale('later-current', 'north', 'wash', '2025-03-20', 300),
  ]
  const page = await openProducts(t, data)
  await drivers(page).waitFor()
  assert.deepEqual(await changes(page), ['+400'])
  assert.match(await drivers(page).locator('.drivers-summary').innerText(), /100.*500/s)
  assert.match(await drivers(page).locator('.drivers-period').innerText(), /vs February/)
})

test('the contribution table fits a narrow viewport without page overflow', async (t) => {
  const page = await openProducts(t, warehouse, { width: 390, height: 844 })
  await drivers(page).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual((await changes(page)).slice(0, 2), ['−300', '+250'])
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
})

test('the stock board puts each product in the lane of its emptiest store', async (t) => {
  const page = await openProducts(t, stocked, undefined, 'Stock board')
  const lane = (name) => page.getByRole('region', { name }).locator('.scard-name').allInnerTexts()
  assert.deepEqual(await lane('Out of stock'), ['Lipstick'])
  assert.deepEqual(await lane('Below safety'), ['Toner'])
  assert.match(await page.getByRole('region', { name: 'Low cover' }).innerText(), /No products here/)
  assert.equal(await page.locator('#board-title').innerText(), '2 of 2 products need restocking.')
  const lipstick = page.locator('.scard', { hasText: 'Lipstick' })
  assert.match(await lipstick.innerText(), /0\/2/, 'no store holds safety stock')
  assert.match(await lipstick.locator('.sr-only', { hasText: 'Short in' }).innerText(), /Short in TP\.HCM, Hải Phòng/, 'emptiest store first')
  assert.match(await lipstick.locator('.scard-order').innerText(), /\+9/)

  // Region narrows the stores on each card.
  await page.getByRole('group', { name: 'Region', exact: true }).getByRole('button', { name: 'Miền Nam' }).click()
  assert.deepEqual(await lane('Out of stock'), ['Lipstick'])
  assert.match(await page.locator('#board-title').innerText(), /1 of 2 products need restocking in Miền Nam/)

  // Cards open the product detail.
  await lipstick.click()
  assert.equal(await page.locator('#product-title').innerText(), 'Lipstick')
})

test('the restock list downloads every short store as CSV', async (t) => {
  const page = await openProducts(t, stocked, undefined, 'Stock board')
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Restock list' }).click()])
  assert.equal(file.suggestedFilename(), 'pantio-restock.csv')
  const csv = await (await file.createReadStream()).toArray()
  const lines = Buffer.concat(csv).toString().split('\n')
  assert.equal(lines[0], 'product,category,store,city,stock_qty,safety_stock,order_units,order_cost')
  assert.equal(lines.length, 4)
})
