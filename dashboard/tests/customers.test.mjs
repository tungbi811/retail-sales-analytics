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

async function openCustomers(t, reducedMotion = 'reduce') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'en-US' })
  t.after(() => page.close())
  await page.route('**/api/warehouse', (route) => route.fulfill({ json: warehouse }))
  await page.goto(baseURL)
  await page.locator('.nav-item', { hasText: 'Customers' }).click()
  await page.locator('#health-title').waitFor()
  return page
}

const tile = (page, label) => page.locator('.health > div', { has: page.locator('dt', { hasText: label }) })

test('customer health reads as four numbers, each against the period before', async (t) => {
  const page = await openCustomers(t)
  assert.equal(await page.locator('.health-vs').innerText(), 'Change vs same days of January')
  assert.deepEqual(await page.locator('.health dt').allInnerTexts(), ['Active customers', 'Returning', 'Spend per customer', 'Orders per customer'])
  // February: one customer, 4 orders, 1,000. Same days of January: the same customer, 2 orders, 300.
  assert.match(await tile(page, 'Active customers').innerText(), /^Active customers\s+1\s+No change\s+of 1 on file$/)
  assert.match(await tile(page, 'Returning').innerText(), /100%\s+\+100 pts/)
  assert.match(await tile(page, 'Spend per customer').innerText(), /1,000\s+\+233%/)
  assert.match(await tile(page, 'Orders per customer').innerText(), /4\.0\s+\+100%/)
})

test('spend groups say what share of revenue the top customers bring', async (t) => {
  const page = await openCustomers(t)
  assert.equal(await page.locator('.tiers-lede').innerText(), 'The top 1 customer brings 100% of revenue.')
  assert.deepEqual(await page.locator('.tiers-table tbody th').allInnerTexts(), ['Top 10%'], 'empty groups are left out')
  assert.match(await page.locator('.tiers-foot').innerText(), /Median spend\s+1,000\s+·\s+0%\s+ordered only once/)
  assert.equal(await page.locator('.swarm, .cal').count(), 0)
})

test('age capsules never overflow their track while they animate to a smaller period', async (t) => {
  const page = await openCustomers(t, 'no-preference')
  const period = (name) => page.getByRole('group', { name: 'Period', exact: true }).getByRole('button', { name, exact: true }).click()
  await period('90 days')
  await page.waitForTimeout(1200)
  await period('Month')
  const tallest = await page.evaluate(async () => {
    const seen = []
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      seen.push(Math.max(...[...document.querySelectorAll('.capsule-fill')].map((f) => parseFloat(f.style.height))))
    }
    return Math.max(...seen)
  })
  assert.ok(tallest <= 100.01, `tallest capsule reached ${tallest.toFixed(0)}% of its track`)
})
