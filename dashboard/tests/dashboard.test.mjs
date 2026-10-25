import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { warehouse } from './fixture.mjs'

const baseURL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'
let browser

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
})
after(async () => {
  await browser?.close()
})

async function openDashboard(t, viewport = { width: 1440, height: 1100 }) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce', timezoneId: 'Asia/Ho_Chi_Minh', locale: 'en-US' })
  t.after(() => page.close())
  await page.route('**/api/warehouse', (route) => route.fulfill({ json: warehouse }))
  await page.goto(baseURL)
  await page.locator('.dash .kpis').waitFor()
  return page
}

const picker = (page) => page.locator('.period-picker p')
const kpiValue = (page, label) => page.locator('.kpi', { has: page.locator('.kpi-label', { hasText: label }) }).locator('.kpi-value .sr-only')
const split = (page) => page.locator('.kpi .split').getAttribute('aria-label')
const cardTitles = (page) => page.locator('.main section.card').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-labelledby')))

test('the nav has four tabs: Sales and Inventory are merged into Dashboard and Products', async (t) => {
  const page = await openDashboard(t)
  const tabs = await page.locator('.nav-item').evaluateAll((nodes) => nodes.map((n) => n.firstChild.textContent))
  assert.deepEqual(tabs, ['Dashboard', 'Products', 'Stores', 'Customers'], 'Ask lives on the rail')
})

test('the dashboard holds sales cards only; stores and stock lists live on their own tabs', async (t) => {
  const page = await openDashboard(t)
  assert.deepEqual(await cardTitles(page), ['gauge-title', 'rev-title', 'stack-title', 'latest-title', 'heat-title', 'mix-title'])
  assert.deepEqual(await page.locator('.kpi-label').allInnerTexts(), ['Revenue', 'Orders', 'Units sold', 'Avg order'])

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Products/ }).click()
  await page.locator('#stock-alerts').waitFor()
  // Products opens on the stock board; sales and coverage are views beside it.
  assert.deepEqual(await cardTitles(page), ['board-title'])
  assert.deepEqual(await page.getByRole('group', { name: 'View' }).getByRole('button').allInnerTexts(), ['Stock board', 'Sales', 'Coverage'])
})

test('the month picker steps between months and stops at the first sale and today', async (t) => {
  const page = await openDashboard(t)
  const back = page.getByRole('button', { name: 'Previous month' })
  const next = page.getByRole('button', { name: 'Next month' })
  assert.equal(await picker(page).innerText(), 'February 2024, through Feb 19')
  assert.equal(await next.isDisabled(), true)
  assert.equal(await kpiValue(page, 'Revenue').innerText(), '1,000')

  await back.click()
  assert.equal(await picker(page).innerText(), 'January 2024')
  assert.equal(await back.isDisabled(), true)
  assert.equal(await kpiValue(page, 'Revenue').innerText(), '600')
  assert.equal(await page.getByRole('button', { name: /^Jan 2024/ }).getAttribute('aria-pressed'), 'true')

  await next.click()
  assert.equal(await picker(page).innerText(), 'February 2024, through Feb 19')
})

test('clicking a revenue bar selects that month across the dashboard', async (t) => {
  const page = await openDashboard(t)
  await page.getByRole('button', { name: /^Jan 2024/ }).click()
  assert.equal(await picker(page).innerText(), 'January 2024')
  assert.equal(await kpiValue(page, 'Orders').innerText(), '3')
  assert.equal(await page.locator('#latest-title').innerText(), 'Last day of January')
  // Months with no sales yet cannot be picked.
  await page.getByRole('button', { name: /^Mar 2024/ }).click()
  assert.equal(await picker(page).innerText(), 'January 2024')
})

test('the first month on record shows no deltas and is measured against the average month', async (t) => {
  const page = await openDashboard(t)
  await page.getByRole('button', { name: 'Previous month' }).click()
  assert.deepEqual(await page.locator('.kpi-note > span:not(.delta)').allInnerTexts(), Array(4).fill('first month on record'))
  assert.equal(await page.locator('.kpis .delta').count(), 0)
  assert.equal(await page.locator('.kpis .ring').count(), 0, 'no "of last month" ring without a last month')
  assert.match(await page.locator('.gauge-copy h3').innerText(), /First month on record/)
  assert.equal(await page.locator('.gauge-value .sr-only').innerText(), '100', 'January is the only finished month, so it is the average')
})

test('month pace keeps counting past 100 when the month beats the last', async (t) => {
  const page = await openDashboard(t)
  assert.match(await page.locator('#gauge-title').innerText(), /Month pace/)
  assert.equal(await page.locator('.gauge-value .sr-only').innerText(), '167')
  assert.deepEqual(await page.locator('.kpi-note > span:not(.delta)').allInnerTexts(), Array(4).fill('vs last month'))
  // Against 1–19 Jan: 300 revenue, 2 orders, 3 units.
  assert.deepEqual(await page.locator('.kpis .delta').evaluateAll((nodes) => nodes.map((n) => n.textContent.replace(/^up|^down/, ''))), ['233.3%', '100.0%', '166.7%', '66.7%'])
})

test('the orders card splits by region, then by store city once a region is picked', async (t) => {
  const page = await openDashboard(t)
  assert.equal(await split(page), 'Miền Bắc 75%, Miền Nam 25%')
  await page.getByRole('group', { name: 'Region' }).getByRole('button', { name: 'Miền Bắc' }).click()
  await page.waitForFunction(() => document.querySelector('.kpi .split')?.getAttribute('aria-label')?.startsWith('Hà Nội'))
  assert.equal(await split(page), 'Hà Nội 67%, Hải Phòng 33%')
})

test('the revenue tooltip shows only while a bar is hovered', async (t) => {
  const page = await openDashboard(t)
  const tip = page.locator('.chart-card .tip')
  assert.equal(await tip.count(), 0)
  await page.getByRole('button', { name: /^Jan 2024/ }).hover()
  assert.match(await tip.locator('.tip-title').innerText(), /Jan 2024/)
  await page.locator('h1').hover()
  assert.equal(await tip.count(), 0)
  assert.equal(await page.getByRole('button', { name: /^Feb 2024/ }).getAttribute('aria-pressed'), 'true', 'the selected month stays marked')
})

test('sales by time shades run from the quietest to the busiest slot', async (t) => {
  const page = await openDashboard(t)
  const shade = (name) => page.getByRole('cell', { name }).getAttribute('class')
  assert.match(await shade('Mon 20–22: 500, 1 orders'), /\bh5\b/)
  assert.match(await shade('Thu 18–20: 100, 1 orders'), /\bh1\b/)
  assert.match(await shade('Sun 10–12: 0, 0 orders'), /\bh0\b/)
})

test('the low stock button lists alerts and jumps to the restock board', async (t) => {
  const page = await openDashboard(t)
  const bell = page.getByRole('button', { name: 'Low stock, 3 items below safety stock' })
  await bell.click()
  const pop = page.getByRole('dialog', { name: 'Low stock' })
  assert.match(await pop.locator('.stock-pop-head').innerText(), /3 below safety stock · 1 out/)
  assert.deepEqual(await pop.locator('.stock-pop-main b').allInnerTexts(), ['Lipstick', 'Lipstick', 'Toner'], 'emptiest first')
  assert.deepEqual(await pop.locator('.status').allInnerTexts(), ['Out', 'Low', 'Low'])

  await page.keyboard.press('Escape')
  assert.equal(await pop.count(), 0)
  await bell.click()
  await page.locator('h1').click()
  assert.equal(await pop.count(), 0, 'a click outside closes it')

  await bell.click()
  await pop.getByRole('button', { name: 'See all 3 on the restock board' }).click()
  assert.match(await page.locator('.nav-item[aria-current="page"]').innerText(), /^Products/)
  await page.waitForFunction(() => document.activeElement?.id === 'stock-alerts')
})

test('wide screens put the gauge, revenue and category mix on one row; phones do not scroll sideways', async (t) => {
  const page = await openDashboard(t, { width: 1920, height: 1100 })
  const tops = await Promise.all(['.gauge-card', '.chart-card', '.mix-card'].map(async (s) => Math.round((await page.locator(s).boundingBox()).y)))
  assert.equal(new Set(tops).size, 1, `cards start at ${tops.join(', ')}`)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
})

test('every KPI link leads to a view of the same number', async (t) => {
  const page = await openDashboard(t)
  const links = page.locator('.kpis .kpi-link')
  assert.deepEqual(await links.allInnerTexts(), ['See by day', 'Show Miền Bắc', 'See products', 'Rank stores by avg order'])

  // Orders drills into the busiest region in its bars, then back out.
  await links.filter({ hasText: 'Show Miền Bắc' }).click()
  await page.waitForFunction(() => document.querySelector('.kpi .split')?.getAttribute('aria-label')?.startsWith('Hà Nội'))
  assert.equal(await page.getByRole('group', { name: 'Region' }).locator('[aria-pressed="true"]').innerText(), 'Miền Bắc')
  await links.filter({ hasText: 'Show all regions' }).click()
  assert.equal(await split(page), 'Miền Bắc 75%, Miền Nam 25%')

  await links.filter({ hasText: 'See products' }).click()
  assert.equal(await page.locator('.nav-item[aria-current="page"]').evaluate((n) => n.firstChild.textContent), 'Products')
})

test('avg order opens the store ranking sorted by avg order, and the Stores tab alone does not', async (t) => {
  const page = await openDashboard(t)
  await page.locator('.kpis .kpi-link', { hasText: 'Rank stores by avg order' }).click()
  const sorted = page.locator('#ranking-title').locator('xpath=..').locator('th[aria-sort="descending"]')
  assert.equal(await sorted.innerText(), 'Avg order')
  await page.locator('.nav-item', { hasText: 'Dashboard' }).click()
  await page.locator('.nav-item', { hasText: 'Stores' }).click()
  assert.equal(await sorted.innerText(), 'Revenue')
})
