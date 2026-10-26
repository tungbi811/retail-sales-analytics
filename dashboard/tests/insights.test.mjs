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
  { kind: 'output', agent: 'Coder', tool: 'run_code', text: 'Output:\n173263' },
]

/** The API's stream: every message so far, replayed from the start. A long retry keeps the browser from reconnecting mid-test. */
const sse = (messages) => ['retry: 600000\n\n', ...messages.map((m) => `data: ${JSON.stringify(m)}\n\n`)].join('')

let runs = 0
const nextRun = (route) => route.fulfill({ json: { id: `run${++runs}` } })

async function open(t, { messages = DISCUSSION, start = nextRun } = {}) {
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
  // The loading placeholder has the same heading while the page's code loads, so wait for the page itself.
  await page.locator('.insights-page').waitFor()
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
  await page.locator('.ask-using').getByText('gpt-5.4-mini').waitFor()
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
  // The last item is the Coder's result, so the Data Scientist is reading it now.
  assert.match(await page.getByRole('status').innerText(), /^Data Scientist is working · \d+:\d\d$/)
  await page.getByRole('button', { name: 'Show discussion' }).click()
  assert.equal(await page.locator('.ask-log .ask-in').count(), 4)
})

test('when an agent asks, the only box is the reply box, and it closes once sent', async (t) => {
  const question = { kind: 'ask', agent: 'BusinessAnalyst', text: 'Should I look at all regions, or only the North?' }
  const { page, posts } = await open(t, { messages: [...DISCUSSION.slice(0, 1), question] })
  await ask(page)
  await page.getByText(question.text).waitFor()
  assert.equal(await page.locator('textarea').count(), 1, 'one box, not a reply box and a question box')
  assert.equal(await page.getByLabel('Your question').count(), 0)
  assert.equal(await page.getByText(question.text).count(), 1, 'the question shows once')
  await page.getByLabel('Your reply').fill('Only North')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await page.getByLabel('Your reply').waitFor({ state: 'detached' })
  assert.deepEqual(posts.at(-1), { path: 'reply', body: { text: 'Only North' } })
  assert.equal(await page.locator('textarea').count(), 0, 'no box while the agents work again')
})

test('stop posts stop and ends the run', async (t) => {
  const { page, posts } = await open(t)
  await ask(page)
  await page.getByText('Framed as a 30-day stock-out forecast per store and product.').waitFor()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByText('Stopped. The agents did not finish this question.').waitFor()
  assert.equal(posts.at(-1).path, 'stop')
  await page.getByLabel('Your question').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0)
  assert.equal(await page.getByRole('status').count(), 0)
})

test('the question box hides while the agents work', async (t) => {
  const { page } = await open(t)
  await ask(page)
  await page.getByText('Framed as a 30-day stock-out forecast per store and product.').waitFor()
  assert.equal(await page.locator('textarea').count(), 0)
  assert.equal(await page.getByRole('list', { name: 'Example questions' }).count(), 0)
  assert.match(await page.getByRole('status').innerText(), /is working/)
})

test('a finished run lets you ask again', async (t) => {
  const { page } = await open(t, { messages: [...DISCUSSION, { kind: 'end', status: 'done' }] })
  await ask(page)
  await page.getByText('The agents finished without a report.').waitFor()
  assert.equal(await page.getByRole('list', { name: 'Example questions' }).getByRole('button').count(), 8, 'suggestions move above the box once the list holds questions')
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

const REPORT = [
  '## Stock-out risk, next 30 days',
  '',
  'Six store and product pairs will likely run out **before their next delivery**.',
  '',
  '| Store | Product | Days of cover |',
  '| --- | --- | ---: |',
  '| Store 101 | Lipstick | 4 |',
  '| Store 102 | Toner | 6 |',
].join('\n')

const FINISHED = [
  ...DISCUSSION,
  { kind: 'message', agent: 'BusinessTranslator', text: REPORT },
  { kind: 'report', text: REPORT },
  { kind: 'end', status: 'done' },
]

test('report renders markdown tables with the data lake label', async (t) => {
  const { page } = await open(t, { messages: FINISHED })
  await ask(page)
  const report = page.getByRole('region', { name: 'Report' })
  await report.waitFor()
  assert.equal(await report.locator('.report-source').innerText(), 'From the data lake')
  assert.equal(await report.getByRole('heading', { level: 2 }).innerText(), 'Stock-out risk, next 30 days')
  assert.equal(await report.locator('strong').innerText(), 'before their next delivery')
  assert.deepEqual(await report.locator('th').allInnerTexts(), ['Store', 'Product', 'Days of cover'])
  assert.deepEqual(await report.locator('tbody tr').first().locator('td').allInnerTexts(), ['Store 101', 'Lipstick', '4'])
  assert.equal(await page.locator('.ask-log .ask-meta b', { hasText: 'Business Translator' }).count(), 0, 'the report shows once, not also as a chat bubble')
  assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).count(), 0)
})

test('follow up starts a new run with the earlier question and report', async (t) => {
  const { page, posts } = await open(t, { messages: FINISHED })
  await ask(page)
  await page.getByRole('button', { name: 'Follow up' }).click()
  assert.equal(await page.locator('textarea').count(), 1, 'the follow-up goes in the box at the bottom')
  assert.match(await page.locator('.insights-follow-chip').innerText(), /Follow-up to: Which products will run out of stock next month\?/)
  await page.getByLabel('Your follow-up question').fill('Which of these should we reorder first?')
  await page.getByRole('button', { name: 'Ask follow-up' }).click()
  await page.getByText('Follow-up to: Which products will run out of stock next month?').waitFor()
  assert.deepEqual(posts.at(-1), {
    path: 'runs',
    body: { question: 'Which of these should we reorder first?', previous: { question: 'Which products will run out of stock next month?', report: REPORT } },
  })
  const listed = page.getByRole('complementary', { name: 'Questions' }).locator('.ask-thread-top b')
  assert.deepEqual(await listed.allInnerTexts(), ['Which of these should we reorder first?', 'Which products will run out of stock next month?'], 'newest first')
})

test('runs survive leaving and coming back to Insights', async (t) => {
  const { page } = await open(t, { messages: FINISHED })
  await ask(page)
  await page.getByRole('region', { name: 'Report' }).waitFor()
  await rail(page).getByRole('button', { name: 'Dashboard' }).click()
  await page.locator('.dash .kpis').waitFor()
  await rail(page).getByRole('button', { name: 'Insights' }).click()
  await page.getByRole('region', { name: 'Report' }).waitFor()
  const list = page.getByRole('complementary', { name: 'Questions' })
  assert.deepEqual(await list.locator('.ask-thread-top b').allInnerTexts(), ['Which products will run out of stock next month?'])
  assert.equal(await list.locator('.ask-thread-sub').innerText(), 'Report ready')
  assert.equal(await page.locator('.ask-log .ask-in').count(), 4, 'the discussion is still there, once')
})

test('report html is not injected', async (t) => {
  const html = '## Result\n\n<img src=x onerror="window.injected = true"> <b>bold?</b>'
  const { page } = await open(t, { messages: [{ kind: 'report', text: html }, { kind: 'end', status: 'done' }] })
  await ask(page)
  const report = page.getByRole('region', { name: 'Report' })
  await report.waitFor()
  assert.equal(await report.locator('img, b').count(), 0)
  assert.match(await report.innerText(), /<img src=x onerror="window\.injected = true">/)
  assert.equal(await page.evaluate(() => window.injected), undefined)
})

test('suggested questions start a run from the list on the left', async (t) => {
  const { page, posts } = await open(t)
  const tryList = page.getByRole('list', { name: 'Questions to try' }).getByRole('button')
  assert.equal(await tryList.count(), 8)
  await tryList.filter({ hasText: 'Which promotions actually lifted sales' }).click()
  await page.getByText('Framed as a 30-day stock-out forecast per store and product.').waitFor()
  assert.deepEqual(posts, [{ path: 'runs', body: { question: 'Which promotions actually lifted sales, and by how much?' } }])
  assert.equal(await page.getByRole('list', { name: 'Questions to try' }).count(), 0, 'the list gives way to the asked questions')
})

test('hand-offs read as labelled cards, agent messages as Markdown, and your reply as a full bubble', async (t) => {
  const { page } = await open(t, {
    messages: [
      { kind: 'output', agent: 'BusinessAnalyst', tool: 'get_data_info', text: '## Data lake\n\n### orders\n174,134 rows' },
      { kind: 'output', agent: 'BusinessTranslator', tool: 'execute_business_translation_step', text: 'Data Scientist, please help:\n\nMeasure **lift** per promotion.' },
      { kind: 'message', agent: 'User', text: 'everything' },
      { kind: 'message', agent: 'DataScientist', text: 'Plan:\n\n1. Baseline per product\n2. Lift per promotion' },
    ],
  })
  await ask(page)
  const handoff = page.locator('.insights-handoff')
  await handoff.waitFor()
  assert.equal(await handoff.locator('.insights-handoff-label').innerText(), 'Business Translator · Asked the Data Scientist')
  assert.equal(await handoff.locator('strong').innerText(), 'lift')
  assert.equal(await page.locator('.insights-detail summary').innerText(), 'Business Analyst · read the data catalog')
  assert.equal(await page.locator('.insights-bubble ol li').count(), 2, 'numbered lists render as lists')
  const reply = page.locator('.ask-log .ask-q', { hasText: 'everything' })
  const box = await reply.boundingBox()
  assert.ok(box.width > 90, `"everything" fits on one line (was ${box.width}px wide)`)
  assert.equal(await reply.innerText(), 'everything')
})

test('a busy API says so plainly, without a Settings button', async (t) => {
  const busy = 'The agents are still working on another question, maybe from another tab. Ask again when it has finished.'
  const { page } = await open(t, { start: (route) => route.fulfill({ status: 409, json: { detail: busy } }) })
  await ask(page)
  const alert = page.getByRole('alert')
  await alert.waitFor()
  assert.equal(await alert.innerText(), busy)
  assert.equal(await alert.getByRole('button', { name: 'Open Settings' }).count(), 0)
})
