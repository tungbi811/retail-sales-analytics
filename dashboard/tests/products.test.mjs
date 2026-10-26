import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { asApi, warehouse as stocked } from './fixture.mjs'

const baseURL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'
let browser

const sale = (id, store, product, date, amount) => ({ sale_id: id, store_id: store, product_id: product, customer_id: 'a', sale_datetime: `${date}T10:00:00`, sale_date: date, quantity: 1, amount })

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
const ranking = (page) => page.getByRole('region', { name: 'Top products' })
const rankedNames = (page) => ranking(page).locator('tbody button').allTextContents()
const revenues = (page) => ranking(page).locator('tbody .ranking-revenue').allTextContents()

test('products rank by revenue up to date, with no period to pick', async (t) => {
  const page = await openProducts(t)
  assert.deepEqual(await rankedNames(page), ['Toner', 'Sữa tắm', 'Cleanser', 'Blush', 'Powder'])
  assert.deepEqual(await revenues(page), ['10,450', '2,500', '200', '120', '120'])
  assert.deepEqual(await ranking(page).locator('tbody .ranking-share').allTextContents(), ['78%', '19%', '1%', '1%', '1%'])
  assert.match(await ranking(page).locator('tfoot').innerText(), /Other products \(2\).*54/s)
  assert.equal(await ranking(page).locator('.ranking-span').innerText(), 'All products · Up to Feb 20 2024')
  for (const view of ['Stock board', 'Sales', 'Coverage']) {
    await view_(page, view)
    assert.equal(await page.getByRole('group', { name: 'Period', exact: true }).count(), 0, `no period picker on ${view}`)
    assert.equal(await page.locator('.page-products .period').innerText(), 'Up to Feb 20 2024')
  }
  assert.equal(await page.getByText('What drove the sales change?').count(), 0)
})

test('region and category filters narrow the ranking', async (t) => {
  const page = await openProducts(t)
  await page.getByRole('group', { name: 'Region', exact: true }).getByRole('button', { name: 'Miền Bắc' }).click()
  assert.deepEqual((await revenues(page)).slice(0, 2), ['10,450', '1,900'])
  await page.locator('.shelf-row', { hasText: 'Makeup' }).click()
  assert.match(await ranking(page).locator('.ranking-span').innerText(), /^Makeup/)
  assert.deepEqual(await rankedNames(page), ['Blush', 'Powder', 'Lipstick'])
  assert.equal(await ranking(page).locator('tfoot').count(), 0)
  // The category carries over to the stock board.
  await view_(page, 'Stock board')
  assert.equal(await page.getByRole('group', { name: 'Category', exact: true }).getByRole('button', { name: 'Makeup', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('.scard').count(), 3)
})

test('a category without sales says so', async (t) => {
  const data = structuredClone(warehouse)
  data.sales = [sale('jan', 'north', 'wash', '2024-01-05', 100), sale('feb', 'north', 'wash', '2024-02-05', 100)]
  const page = await openProducts(t, data)
  await page.locator('.shelf-row', { hasText: 'Makeup' }).click()
  assert.match(await ranking(page).innerText(), /No sales yet/)
  assert.equal(await ranking(page).locator('table').count(), 0)
})

test('ranked products open their detail drawer with keyboard activation, without a period change', async (t) => {
  const page = await openProducts(t)
  await ranking(page).getByRole('button', { name: 'Cleanser', exact: true }).focus()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog')
  assert.equal(await drawer.getByRole('heading', { level: 2 }).innerText(), 'Cleanser')
  assert.deepEqual(await drawer.locator('.stat-grid dt').allInnerTexts(), ['Revenue', 'Units', 'Share of revenue', 'Days of cover'])
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]'))), true, 'Tab stays inside the product detail')
  await page.keyboard.press('Escape')
  assert.equal(await drawer.count(), 0)
  assert.equal(await ranking(page).getByRole('button', { name: 'Cleanser', exact: true }).evaluate((node) => node === document.activeElement), true, 'Escape returns focus to the selected product')
})

test('the ranking fits a narrow viewport without page overflow', async (t) => {
  const page = await openProducts(t, warehouse, { width: 390, height: 844 })
  await ranking(page).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual((await revenues(page)).slice(0, 2), ['10,450', '2,500'])
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
