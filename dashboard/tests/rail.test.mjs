import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { warehouse } from './fixture.mjs'

const baseURL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'
let browser

const answer = {
  question: 'Top products by revenue',
  provider: 'claude',
  model: 'claude-opus-5-5',
  sql: 'SELECT p.product_name AS product, sum(f.amount) AS revenue\nFROM gold.fact_sales f JOIN gold.dim_product p USING (product_id)\nGROUP BY 1 ORDER BY 2 DESC',
  explanation: 'Revenue per product, highest first.',
  chart: 'bar',
  columns: ['product', 'revenue'],
  rows: [
    { product: 'Lipstick', revenue: 1050 },
    { product: 'Toner', revenue: 550 },
  ],
  truncated: false,
}

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
})
after(async () => {
  await browser?.close()
})

const PROVIDERS = [
  { id: 'claude', label: 'Claude', model: 'claude-opus-5-5', ready: true, active: true },
  { id: 'openai', label: 'OpenAI', model: 'gpt-5.4-mini', ready: true, active: false },
  { id: 'gemini', label: 'Gemini', model: 'gemini-3.8-flash', ready: false, active: false },
]

async function open(t, ask = (route) => route.fulfill({ json: answer }), providers = PROVIDERS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'Asia/Ho_Chi_Minh', locale: 'en-US' })
  t.after(() => page.close())
  const loads = []
  await page.route('**/api/warehouse', (route) => {
    loads.push(Date.now())
    route.fulfill({ json: warehouse })
  })
  await page.route('**/api/text-to-sql', ask)
  await page.route('**/api/text-to-sql/providers', (route) => route.fulfill({ json: providers }))
  await page.goto(baseURL)
  await page.locator('.dash .kpis').waitFor()
  return { page, loads }
}

const rail = (page) => page.getByRole('complementary', { name: 'Views' })
const searchButton = (page) => page.getByRole('button', { name: 'Search, press /' })
const panel = (page) => page.getByRole('dialog')
const tryAsking = (page, name) => page.getByRole('list', { name: 'Questions to try' }).getByRole('button', { name })

async function openAsk(page) {
  await rail(page).getByRole('button', { name: 'Text to SQL' }).click()
  await page.getByRole('heading', { name: 'Text to SQL', level: 1 }).waitFor()
}

test('the rail switches between the dashboard, Text to SQL, Insights and Settings, with no theme or colour switch', async (t) => {
  const { page } = await open(t)
  const labels = await rail(page).getByRole('button').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('title')))
  assert.deepEqual(labels, ['Dashboard', 'Text to SQL', 'Insights', 'Settings'])
  assert.equal(await rail(page).getByRole('button', { name: 'Dashboard' }).getAttribute('aria-current'), 'page')
  assert.deepEqual(await page.locator('.nav-item').allInnerTexts(), ['Dashboard', 'Products', 'Stores', 'Customers'], 'no badge and no Text to SQL tab in the top nav')
  assert.equal(await page.getByRole('button', { name: /theme|palette|colour/i }).count(), 0)
})

test('panels close on Escape, on a click outside, and on their own button', async (t) => {
  const { page } = await open(t)
  await searchButton(page).click()
  assert.equal(await panel(page).getAttribute('class'), 'panel panel-right', 'search opens under its button, on the right')
  await page.keyboard.press('Escape')
  assert.equal(await panel(page).count(), 0)
  await searchButton(page).click()
  await page.locator('.kpis').click({ position: { x: 300, y: 20 } })
  assert.equal(await panel(page).count(), 0)
  await searchButton(page).click()
  await searchButton(page).click()
  assert.equal(await panel(page).count(), 0)
})

test('"/" opens search, which ignores accents and opens a store on the map', async (t) => {
  const { page } = await open(t)
  await page.keyboard.press('/')
  const box = page.getByRole('searchbox')
  assert.equal(await box.evaluate((n) => n === document.activeElement), true, 'search starts focused')
  await box.fill('hai phong')
  await page.getByRole('button', { name: /Haiphong showroom/ }).click()
  assert.match(await page.locator('.nav-item[aria-current="page"]').innerText(), /^Stores/)
  assert.equal(await page.locator('#store-title').innerText(), 'Haiphong showroom')
  assert.equal(await panel(page).count(), 0)
})

test('search opens a product on the Products tab and answers customers in place', async (t) => {
  const { page } = await open(t)
  await searchButton(page).click()
  await page.getByRole('searchbox').fill('an ng')
  assert.match(await page.locator('.find-person').innerText(), /An Nguyen[\s\S]*7 orders, 1,600 · mostly Hà Nội · last Feb 19/)
  await page.getByRole('searchbox').fill('lip')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('#product-title').innerText(), 'Lipstick')
  await page.getByRole('searchbox').waitFor({ state: 'detached' })
})

test('search says when nothing matches', async (t) => {
  const { page } = await open(t)
  await page.keyboard.press('/')
  await page.getByRole('searchbox').fill('zzz')
  assert.match(await panel(page).innerText(), /Nothing matches “zzz”/)
})

test('ask sends the question and shows the answer as bars, a table and the SQL', async (t) => {
  let body
  const { page } = await open(t, (route) => {
    body = route.request().postDataJSON()
    route.fulfill({ json: answer })
  })
  await openAsk(page)
  assert.equal(await page.locator('.nav-item[aria-current="page"]').count(), 0, 'ask is a view of its own, outside the top nav')
  assert.equal(await rail(page).getByRole('button', { name: 'Text to SQL' }).getAttribute('aria-current'), 'page')
  assert.equal(await panel(page).count(), 0)
  const input = page.getByRole('textbox', { name: 'Your question' })
  assert.equal(await input.evaluate((n) => n === document.activeElement), true, 'the box starts focused')
  await input.fill('Top products by revenue')
  await input.press('Enter')
  await page.locator('.ask-answer').waitFor()
  assert.deepEqual(body, { question: 'Top products by revenue' }, 'the API picks the provider chosen in Settings')
  assert.match(await page.locator('.ask-foot').innerText(), /^2 rows/)
  assert.match(await page.locator('.ask-in .ask-meta').innerText(), /^Claude · claude-opus-5-5 \d\d:\d\d$/, 'who answered and when, under the reply')
  assert.match(await page.locator('.ask-out .ask-meta').innerText(), /^You \d\d:\d\d$/)
  assert.equal(await page.locator('.ask-q').innerText(), 'Top products by revenue')
  assert.equal(await page.locator('.ask-explain').innerText(), 'Revenue per product, highest first.')
  assert.deepEqual(await page.locator('.ask-bar-label').allInnerTexts(), ['Lipstick', 'Toner'])
  assert.deepEqual(await page.locator('.ask-table td').allInnerTexts(), ['Lipstick', '1,050', 'Toner', '550'])
  assert.match(await page.locator('.ask-sql code').textContent(), /FROM gold\.fact_sales/)
  assert.equal(await input.inputValue(), '', 'the box clears after sending')

  // The question is listed on the left, like an inbox.
  const asked = page.getByRole('complementary', { name: 'Questions' })
  assert.match(await asked.locator('.ask-thread').innerText(), /Top products by revenue[\s\S]*Revenue per product, highest first\./)

  // The conversation survives leaving the page.
  await rail(page).getByRole('button', { name: 'Dashboard' }).click()
  await openAsk(page)
  assert.equal(await page.locator('.ask-entry').count(), 1)

  // New chat starts over.
  await page.getByRole('button', { name: 'New chat' }).click()
  assert.equal(await page.locator('.ask-entry').count(), 0)
})

test('a long question stays inside its row in the list', async (t) => {
  const { page } = await open(t)
  await openAsk(page)
  await tryAsking(page, 'Top 5 products by revenue in July').click()
  await page.locator('.ask-answer').waitFor()
  const spill = await page.locator('.ask-thread').evaluate((row) => {
    const edge = row.querySelector('.ask-thread-text').getBoundingClientRect().right
    return [...row.querySelectorAll('.ask-thread-top, .ask-thread-sub')].map((n) => Math.round(n.getBoundingClientRect().right - edge))
  })
  assert.deepEqual(spill, [0, 0], 'the title, time and preview end at the row edge')
})

test('ask suggestions send straight away, and API errors are shown, not swallowed', async (t) => {
  const { page } = await open(t, (route) => route.fulfill({ status: 503, json: { detail: 'Text to SQL needs ANTHROPIC_API_KEY in the root .env file.' } }))
  await openAsk(page)
  assert.match(await page.locator('.ask-in').innerText(), /I write the SQL/, 'an empty thread opens with a greeting from the model')
  await tryAsking(page, 'Which stores have products out of stock?').click()
  assert.equal(await page.getByRole('alert').innerText(), 'Text to SQL needs ANTHROPIC_API_KEY in the root .env file.')
  assert.equal(await page.locator('.ask-in').count(), 1, 'the greeting gives way to the thread')
  await page.getByRole('button', { name: 'Failed 1' }).click()
  assert.match(await page.locator('.ask-thread').innerText(), /needs ANTHROPIC_API_KEY/)
  await page.getByRole('button', { name: 'Answered' }).click()
  assert.equal(await page.locator('.ask-thread').count(), 0)
})

test('data shows where the numbers come from and reloads them', async (t) => {
  const { page, loads } = await open(t)
  await page.getByTitle('Data source').click()
  assert.match(await panel(page).innerText(), /Postgres, dbt gold models/)
  assert.match(await panel(page).innerText(), /Jan 5 2024 to Feb 19 2024/)
  assert.deepEqual(await page.locator('.data-tables li').allInnerTexts(), ['gold.fact_sales\n7 sales', 'gold.stock_position\n4 stock rows', 'gold.dim_customer\n1 customers', 'gold.dim_product\n2 products', 'gold.dim_store\n3 stores'])
  const before = loads.length
  await page.getByRole('button', { name: 'Reload from Postgres' }).click()
  await page.locator('.dash .kpis').waitFor()
  assert.equal(loads.length, before + 1)
})

test('help explains each metric', async (t) => {
  const { page } = await open(t)
  await page.keyboard.press('?')
  const terms = await page.locator('.glossary dt').allInnerTexts()
  for (const term of ['Revenue', 'Orders', 'Units sold', 'Avg order', 'Below safety stock', 'Sales by time']) assert.ok(terms.includes(term), term)
})

test('ask uses the provider chosen in Settings and links there', async (t) => {
  const providers = PROVIDERS.map((p) => ({ ...p, active: p.id === 'openai' }))
  const { page } = await open(t, (route) => route.fulfill({ json: { ...answer, provider: 'openai', model: 'gpt-5.4-mini' } }), providers)
  await openAsk(page)
  await page.locator('.ask-using').getByText('gpt-5.4-mini').waitFor()
  assert.equal(await page.getByRole('radiogroup', { name: 'Model' }).count(), 0, 'no provider switch on Text to SQL')
  assert.match(await page.locator('.ask-using').innerText(), /^OpenAI · gpt-5.4-mini\s+Change in Settings$/)
  await tryAsking(page, 'Average order value by age group').click()
  await page.locator('.ask-answer').waitFor()
  assert.match(await page.locator('.ask-in .ask-meta').innerText(), /^OpenAI · gpt-5.4-mini/)
  await page.getByRole('button', { name: 'Change in Settings' }).click()
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
  assert.equal(await rail(page).getByRole('button', { name: 'Settings' }).getAttribute('aria-current'), 'page')
})

test('without a key, ask points to Settings instead of taking questions', async (t) => {
  const providers = PROVIDERS.map((p) => ({ ...p, active: p.id === 'gemini' }))
  let asked = 0
  const { page } = await open(t, (route) => {
    asked += 1
    route.fulfill({ json: answer })
  }, providers)
  await openAsk(page)
  assert.match(await page.locator('.ask-connect').innerText(), /Connect an AI provider in Settings[\s\S]*Gemini has no API key yet/)
  assert.equal(await page.getByRole('textbox', { name: 'Your question' }).isDisabled(), true)
  assert.equal(await tryAsking(page, 'Average order value by age group').isDisabled(), true)
  assert.equal(asked, 0)
  await page.getByRole('button', { name: 'Open Settings' }).click()
  await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
})

const SETTINGS = {
  provider: 'claude',
  providers: [
    { id: 'claude', label: 'Claude', model: 'claude-opus-5-5', default: 'claude-opus-5-5', key: '…4f2a' },
    { id: 'openai', label: 'OpenAI', model: 'gpt-5.4-mini', default: 'gpt-5.4-mini', key: null },
    { id: 'gemini', label: 'Gemini', model: 'gemini-3.8-flash', default: 'gemini-3.8-flash', key: null },
  ],
}

async function openSettings(t) {
  const { page } = await open(t)
  const calls = []
  await page.route('**/api/settings/ai**', (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/settings/ai', '') || '/'
    const body = req.postDataJSON()
    calls.push({ method: req.method(), path, body })
    if (path === '/models') {
      const lists = { claude: ['claude-opus-5-5', 'claude-sonnet-5-5'], openai: ['gpt-5.4-mini', 'o5-mini'], gemini: ['gemini-3.8-flash'] }
      return route.fulfill({ json: { models: lists[body.provider], error: null } })
    }
    if (path === '/test') return route.fulfill({ json: body.model === 'o5-mini' ? { ok: false, error: 'OpenAI rejected the key.' } : { ok: true, error: null } })
    if (req.method() === 'PUT') return route.fulfill({ json: { ...SETTINGS, provider: body.provider } })
    return route.fulfill({ json: SETTINGS })
  })
  await rail(page).getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('heading', { name: 'AI connection' }).waitFor()
  return { page, calls }
}

const model = (page) => page.getByRole('combobox', { name: 'Model' })
const keyBox = (page) => page.getByLabel('API key')

test('settings show the chosen provider, its models and only the end of its key', async (t) => {
  const { page } = await openSettings(t)
  const providers = page.getByRole('group', { name: 'Provider' })
  assert.equal(await providers.getByRole('button', { name: 'Claude' }).getAttribute('aria-pressed'), 'true')
  await model(page).locator('option', { hasText: 'claude-sonnet-5-5' }).waitFor({ state: 'attached' })
  assert.deepEqual(await model(page).locator('option').allInnerTexts(), ['claude-opus-5-5 (default)', 'claude-sonnet-5-5'])
  assert.match(await keyBox(page).getAttribute('placeholder'), /Saved key …4f2a/)
  assert.equal(await page.getByRole('button', { name: 'Save' }).isDisabled(), true, 'nothing to save yet')
})

test('switching provider changes the model list and never saves on its own', async (t) => {
  const { page, calls } = await openSettings(t)
  await page.getByRole('group', { name: 'Provider' }).getByRole('button', { name: 'OpenAI' }).click()
  await model(page).locator('option', { hasText: 'o5-mini' }).waitFor({ state: 'attached' })
  assert.equal(await model(page).inputValue(), 'gpt-5.4-mini')
  assert.match(await keyBox(page).getAttribute('placeholder'), /Paste your OpenAI API key/)
  assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [])
})

test('test connection reports the result, and save sends the provider, model and pasted key', async (t) => {
  const { page, calls } = await openSettings(t)
  await page.getByRole('group', { name: 'Provider' }).getByRole('button', { name: 'OpenAI' }).click()
  await model(page).locator('option', { hasText: 'o5-mini' }).waitFor({ state: 'attached' })
  await keyBox(page).fill('sk-test-1234')
  await model(page).selectOption('o5-mini')
  await page.getByRole('button', { name: 'Test connection' }).click()
  await page.getByRole('status').getByText('OpenAI rejected the key.').waitFor()
  await model(page).selectOption('gpt-5.4-mini')
  await page.getByRole('button', { name: 'Test connection' }).click()
  await page.getByText('Connected to OpenAI · gpt-5.4-mini').waitFor()
  assert.deepEqual(calls.filter((c) => c.path === '/test').map((c) => c.body), [
    { provider: 'openai', model: 'o5-mini', key: 'sk-test-1234' },
    { provider: 'openai', model: 'gpt-5.4-mini', key: 'sk-test-1234' },
  ])

  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Saved. Text to SQL uses this from the next question.').waitFor()
  assert.deepEqual(calls.filter((c) => c.method === 'PUT').map((c) => c.body), [{ provider: 'openai', model: 'gpt-5.4-mini', key: 'sk-test-1234' }])
  assert.equal(await keyBox(page).inputValue(), '', 'the pasted key is cleared once saved')
})
