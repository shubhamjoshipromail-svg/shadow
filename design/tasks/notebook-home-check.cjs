// Focused smoke for console /app home (mocked API). No real backend touched.
const http = require('http')
const fs = require('fs')
const path = require('path')
const { chromium } = require('/private/tmp/tacet-sol-tools/node_modules/playwright')

const DIST = '/Users/shubhamjoshi/Hacknation 2/console/dist'
const PORT = 4399
const BASE = `http://localhost:${PORT}`

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (!p.startsWith('/app')) { res.writeHead(404); return res.end('not found') }
  let rel = p.slice('/app'.length)
  if (rel === '' || rel === '/') rel = '/index.html'
  const file = path.join(DIST, rel)
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    return fs.createReadStream(file).pipe(res)
  }
  // SPA fallback
  res.writeHead(200, { 'Content-Type': 'text/html' })
  fs.createReadStream(path.join(DIST, 'index.html')).pipe(res)
})

const WORKFLOWS = [
  { id: 'ap_invoices', name: 'Supplier invoice approval', kind: 'built_in', version: 1, experts: ['Sabine'], learners: [], sessions: 4 },
  { id: 'expense_claims', name: 'Expense claim review', kind: 'learned', version: 3, experts: ['Jonas'], learners: ['Lena'], sessions: 2 },
]
const SESSIONS = [
  { id: 'S-2026-0001', mode: 'capture', expert: 'Sabine', pack: 'ap_invoices', metrics: { episodes: 6, rules_learned: 3 } },
  { id: 'S-2026-0002', mode: 'tutor', expert: 'Sabine', pack: 'ap_invoices', metrics: { episodes: 2, rules_learned: 3 } },
]

function commonRoutes(page, state) {
  page.route('**/health', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, llm: true, spend: { usd: 1.234, calls: 12 } }) }))
  page.route('**/api/config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: {} }) }))
  page.route('**/api/workflows', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WORKFLOWS) }))
  page.route('**/api/sessions', async (r) => {
    const req = r.request()
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      state.posts.push(body)
      if (state.postPlan) return state.postPlan(r, body)
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'S-NEW' }) })
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSIONS) })
  })
  page.route('**/api/llm/check', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: { anthropic: { ok: true, model: 'claude-haiku-4-5' } } }) }))
}

async function newPage(browser, width, height, state) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await commonRoutes(page, state)
  return { page, ctx, errors }
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

;(async () => {
  await new Promise((res) => server.listen(PORT, res))
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const out = { consoleErrors: [], checks: [], shots: [] }
  const check = (name, ok, detail) => { out.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

  try {
    // ---- desktop layout + diagnostics hidden + screenshots ----
    {
      const state = { posts: [] }
      const { page, ctx, errors } = await newPage(browser, 1440, 900, state)
      await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' })
      await page.waitForSelector('text=Teach Mira how you work.')
      check('desktop: no horizontal overflow', (await overflow(page)) <= 1, `scrollW-innerW=${await overflow(page)}`)
      check('header: 1180px container', await page.evaluate(() => !!document.querySelector('header .max-w-\\[1180px\\]')))
      check('intro heading present', await page.locator('h1', { hasText: 'Teach Mira how you work.' }).count() === 1)
      check('intro sentence present', await page.locator('text=Show the decisions you make. Mira learns the rules, then helps someone else follow them.').count() >= 1)
      check('legacy tagline removed', await page.locator('text=Learns the part of the job nobody wrote down.').count() === 0)
      check('Nordwerk intro removed', await page.locator('text=Expert knowledge capture').count() === 0)
      check('connected state shown', await page.locator('header >> text=Connected').count() === 1)
      check('product-home link', await page.locator('a[href="/"]').count() === 1)
      check('diagnostics collapsed by default', await page.evaluate(() => { const d = document.querySelector('details'); return d && !d.open }))
      check('diagnostics content not visible', !(await page.locator('text=ElevenLabs interviewer agent').isVisible()))
      check('settings moved health/cost inside details', await page.locator('details >> text=core · connected').count() === 1)
      check('spend shown inside details', await page.locator('details >> text=$1.234 · 12 calls').count() === 1)
      const shot = '/private/tmp/tacet-home-smoke/home-desktop-1440.png'
      await page.screenshot({ path: shot, fullPage: true })
      out.shots.push(shot)
      out.consoleErrors.push(...errors)
      await ctx.close()
    }

    // ---- mobile 390 overflow ----
    {
      const state = { posts: [] }
      const { page, ctx, errors } = await newPage(browser, 390, 844, state)
      await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' })
      await page.waitForSelector('text=Teach Mira how you work.')
      check('mobile390: no horizontal overflow', (await overflow(page)) <= 1, `scrollW-innerW=${await overflow(page)}`)
      check('mobile390: primary CTA present', await page.locator('button', { hasText: 'Start capture' }).count() === 1)
      check('mobile390: secondary CTA present', await page.locator('button', { hasText: 'Start tutoring' }).count() === 1)
      const shot = '/private/tmp/tacet-home-smoke/home-mobile-390.png'
      await page.screenshot({ path: shot, fullPage: true })
      out.shots.push(shot)
      out.consoleErrors.push(...errors)
      await ctx.close()
    }

    // ---- workflow selection retained + capture payload ----
    {
      const state = { posts: [] }
      const { page, ctx, errors } = await newPage(browser, 1440, 900, state)
      await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' })
      await page.waitForSelector('text=Choose a workflow')
      check('workflow options rendered', await page.locator('input[name="wf"]').count() === 2)
      check('default workflow selected', await page.locator('input[name="wf"]').nth(0).isChecked())
      const wfText = await page.locator('section', { hasText: 'Choose a workflow' }).innerText()
      check('no technical version/counts at top of workflow', !/\bv\d+\b/.test(wfText) && !/\bsessions?\b/i.test(wfText), wfText.replace(/\n/g, ' | '))
      check('built-in/learned metadata present + subordinate', /Built in/.test(wfText) && /Learned from a person/.test(wfText))
      await page.locator('input[name="wf"]').nth(1).check()
      check('selection retained after click', await page.locator('input[name="wf"]').nth(1).isChecked())
      await page.locator('label', { hasText: 'Supplier invoice approval' }).click()
      await page.locator('label', { hasText: 'Expense claim review' }).click()
      await page.locator('select').selectOption('de')
      await page.locator('button', { hasText: 'Start capture' }).click()
      await page.waitForTimeout(300)
      const body = state.posts[0]
      check('capture payload unchanged', JSON.stringify(body) === JSON.stringify({ mode: 'capture', lang: 'de', pack: 'expense_claims', simulate: false, fresh: true }), JSON.stringify(body))
      out.consoleErrors.push(...errors)
      await ctx.close()
    }

    // ---- tutor payload (from_session resolves against matching pack) ----
    {
      const state = { posts: [] }
      const { page, ctx, errors } = await newPage(browser, 1440, 900, state)
      await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' })
      await page.waitForSelector('text=Choose a workflow')
      await page.locator('button', { hasText: 'Start tutoring' }).click()
      await page.waitForTimeout(300)
      const body = state.posts[0]
      check('tutor payload unchanged', JSON.stringify(body) === JSON.stringify({ mode: 'tutor', trainee: 'Lena', pack: 'ap_invoices', from_session: 'S-2026-0001', simulate: false }), JSON.stringify(body))
      out.consoleErrors.push(...errors)
      await ctx.close()
    }

    // ---- busy duplicate guard ----
    {
      const state = { posts: [], postPlan: (r) => new Promise((res) => setTimeout(() => res(r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'S-SLOW' }) })), 900)) }
      const { page, ctx, errors } = await newPage(browser, 1440, 900, state)
      await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' })
      await page.waitForSelector('text=Choose a workflow')
      const cap = page.locator('button', { hasText: 'Start capture' })
      await cap.click()
      await page.waitForTimeout(80)
      const capDisabled = await cap.isDisabled()
      const tutorDisabled = await page.locator('button', { hasText: 'Start tutoring' }).isDisabled()
      await cap.click({ force: true }).catch(() => {})
      await page.waitForTimeout(200)
      check('busy: both CTAs disabled', capDisabled && tutorDisabled, `capture=${capDisabled} tutor=${tutorDisabled}`)
      check('busy: only one POST issued', state.posts.length === 1, `posts=${state.posts.length}`)
      out.consoleErrors.push(...errors)
      await ctx.close()
    }

    // ---- visible start error (role=alert, outside details) ----
    {
      const state = { posts: [], postPlan: (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' }) }
      const { page, ctx, errors } = await newPage(browser, 1440, 900, state)
      await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' })
      await page.waitForSelector('text=Choose a workflow')
      await page.locator('button', { hasText: 'Start capture' }).click()
      const alert = page.locator('[role="alert"]')
      await alert.waitFor({ state: 'visible' })
      const inDetails = await alert.evaluate((el) => !!el.closest('details'))
      check('start error visible as role=alert outside details', (await alert.count()) === 1 && !inDetails)
      check('start error mentions failure', (await alert.innerText()).includes('Couldn’t start the session'))
      out.consoleErrors.push(...errors)
      await ctx.close()
    }

    // ---- practice notice visible before start ----
    {
      const state = { posts: [] }
      const { page, ctx, errors } = await newPage(browser, 1440, 900, state)
      // force no LLM key -> rehearsal true
      await page.unroute('**/health')
      await page.route('**/health', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, llm: false }) }))
      await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' })
      await page.waitForSelector('text=Teach Mira how you work.')
      check('practice notice visible before starts', await page.locator('text=Practice mode.').isVisible())
      out.consoleErrors.push(...errors)
      await ctx.close()
    }
  } finally {
    await browser.close()
    server.close()
  }

  out.passed = out.checks.filter((c) => c.ok).length
  out.failed = out.checks.filter((c) => !c.ok).length
  fs.writeFileSync('/private/tmp/tacet-home-smoke/result.json', JSON.stringify(out, null, 2))
  console.log(`\n${out.passed} passed, ${out.failed} failed`)
  console.log('pageerrors:', out.consoleErrors.length ? out.consoleErrors.slice(0, 5) : 'none')
  process.exit(out.failed ? 1 : 0)
})().catch((e) => { console.error('HARNESS ERROR', e); server.close(); process.exit(2) })
