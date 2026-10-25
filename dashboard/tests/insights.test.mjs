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

const PROVIDERS = [
  { id: 'claude', label: 'Claude', model: 'claude-opus-5-5', ready: true, active: false },
  { id: 'openai', label: 'OpenAI', model: 'gpt-5.4-mini', ready: true, active: true },
  { id: 'gemini', label: 'Gemini', model: 'gemini-3.8-flash', ready: false, active: false },
]

const DISCUSSION = [
  { kind: 'message', agent: 'BusinessAnalyst', text: 'Framed as a 30-day stock-out forecast per store and product.' },
  { kind: 'message', agent: 'DataScientist', text: 'Estimate daily demand from orders, then compare with stock and inbound deliveries.' },
  { kind: 'code', agent: 'Coder', code: "duckdb.sql(f\"select count(*) from read_json_auto('{LAKE}/orders/*/*.jsonl')\")" },
  { kind: 'output', agent: 'Coder', text: 'Output:\n173263' },
]

/** The API's stream: every message so far, replayed from the start. A long retry keeps the browser from reconnecting mid-test. */
const sse = (messages) => ['retry: 600000\n\n', ...messages.map((m) => `data: ${JSON.stringify(m)}\n\n`)].join('')

async function open(t, { messages = DISCUSSION, start = (route) => route.fulfill({ json: { id: 'run1' } }) } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'Asia/Ho_Chi_Minh', locale: 'en-US' })
  t.after(() => page.close())
  const posts = []
  await page.route('**/api/warehouse', (route) => route.fulfill({ json: warehouse }))
  await page.route('**/api/text-to-sql/providers', (route) => route.fulfill({ json: PROVIDERS }))
  await page.route('**/api/insights/runs', (route) => {
    posts.push({ path: 'runs', body: route.request().postDataJSON() })
    return start(route)
  })
  await page.route('**/api/insights/runs/*/events', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(messages) }),
  )
  await page.route(/\/api\/insights\/runs\/[^/]+\/(reply|stop)$/, (route) => {
    const path = new URL(route.request().url()).pathname.split('/').pop()
    posts.push({ path, body: route.request().postDataJSON() })
    return route.fulfill({ status: 204 })
  })
  await page.goto(baseURL)
  await page.locator('.dash .kpis').waitFor()
  await rail(page).getByRole('button', { name: 'Insights' }).click()
  await page.getByRole('heading', { name: 'Insights', level: 1 }).waitFor()
  return { page, posts }
}

const rail = (page) => page.getByRole('complementary', { name: 'Views' })
const askButton = (page) => page.getByRole('button', { name: 'Ask', exact: true })

async function ask(page, question = 'Which products will run out of stock next month?') {
  await page.getByLabel('Your question').fill(question)
  await askButton(page).click()
}

test('rail shows Insights below Text to SQL', async (t) => {
  const { page } = await open(t)
  const labels = await rail(page).getByRole('button').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('title')))
  // Third, right under the Text to SQL button, whatever that one is called.
  assert.deepEqual([labels.length, labels[2], labels[3]], [4, 'Insights', 'Settings'])
  assert.equal(await rail(page).getByRole('button', { name: 'Insights' }).getAttribute('aria-current'), 'page')
  assert.match(await page.locator('.ask-using').innerText(), /^OpenAI · gpt-5.4-mini\s+Change in Settings$/)
  assert.equal(await page.locator('.ask-hint').innerText(), 'Agents take a few minutes and use the model chosen in Settings.')
})

test("stream shows each agent's messages with code collapsed", async (t) => {
  const { page, posts } = await open(t)
  await ask(page)
  await page.getByText('Framed as a 30-day stock-out forecast per store and product.').waitFor()
  assert.deepEqual(posts, [{ path: 'runs', body: { question: 'Which products will run out of stock next month?' } }])
  assert.deepEqual(await page.locator('.ask-log .ask-meta b').allInnerTexts(), ['You', 'Business Analyst', 'Data Scientist'])
  const details = page.locator('.insights-detail')
  assert.deepEqual(await details.locator('summary').allInnerTexts(), ['Coder · ran code', 'Coder · result'])
  assert.deepEqual(await details.evaluateAll((nodes) => nodes.map((n) => n.open)), [false, false])
  assert.equal(await page.getByText('173263').isVisible(), false)
  await details.first().locator('summary').click()
  assert.match(await details.first().locator('pre').innerText(), /read_json_auto/)
})

test('hide discussion leaves one status line', async (t) => {
  const { page } = await open(t)
  await ask(page)
  await page.getByText('Framed as a 30-day stock-out forecast per store and product.').waitFor()
  await page.getByRole('button', { name: 'Hide discussion' }).click()
  assert.equal(await page.locator('.ask-log .ask-in').count(), 0)
  assert.match(await page.getByRole('status').innerText(), /^Coder is working · \d+:\d\d$/)
  await page.getByRole('button', { name: 'Show discussion' }).click()
  assert.equal(await page.locator('.ask-log .ask-in').count(), 4)
})

test('ask shows a reply box that posts the reply', async (t) => {
  const question = { kind: 'ask', agent: 'BusinessAnalyst', text: 'Should I look at all regions, or only the North?' }
  const { page, posts } = await open(t, { messages: [...DISCUSSION.slice(0, 1), question] })
  await ask(page)
  await page.getByText(question.text).waitFor()
  await page.getByLabel('Your reply').fill('Only North')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await page.getByLabel('Your reply').waitFor({ state: 'detached' })
  assert.deepEqual(posts.at(-1), { path: 'reply', body: { text: 'Only North' } })
})

test('stop posts stop and ends the run', async (t) => {
  const { page, posts } = await open(t)
  await ask(page)
  await page.getByText('Framed as a 30-day stock-out forecast per store and product.').waitFor()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByText('Stopped. The agents did not finish this question.').waitFor()
  assert.equal(posts.at(-1).path, 'stop')
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0)
  assert.equal(await page.getByRole('status').count(), 0)
})

test('ask is disabled while a run is going', async (t) => {
  const { page } = await open(t)
  await ask(page)
  await page.getByText('Framed as a 30-day stock-out forecast per store and product.').waitFor()
  await page.getByLabel('Your question').fill('And next quarter?')
  assert.equal(await askButton(page).isDisabled(), true)
  assert.equal(await page.getByRole('list', { name: 'Example questions' }).getByRole('button').first().isDisabled(), true)
})

test('a finished run lets you ask again', async (t) => {
  const { page } = await open(t, { messages: [...DISCUSSION, { kind: 'end', status: 'done' }] })
  await ask(page)
  await page.getByText('The agents finished without a report.').waitFor()
  await page.getByLabel('Your question').fill('And next quarter?')
  assert.equal(await askButton(page).isDisabled(), false)
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0)
})

test('missing key error links to Settings', async (t) => {
  const { page } = await open(t, { start: (route) => route.fulfill({ status: 503, json: { detail: 'OpenAI has no API key. Add one in Settings.' } }) })
  await ask(page)
  const alert = page.getByRole('alert')
  await alert.waitFor()
  assert.match(await alert.innerText(), /OpenAI has no API key\. Add one in Settings\./)
  await alert.getByRole('button', { name: 'Open Settings' }).click()
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
})
