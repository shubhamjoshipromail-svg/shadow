#!/usr/bin/env node
/**
 * record.mjs — drive the deployed product through design/video/STORYBOARD.md and screenshot every shot.
 *
 * How it works (plain Chrome DevTools Protocol, no framework):
 *   1. starts Chrome with --remote-debugging-port and a throwaway profile
 *      (or attaches with --no-launch to a Chrome you already started that way);
 *   2. opens one browser context, then two pages — the notebook (console) and the ERP;
 *   3. creates a REHEARSAL (simulated-expert) capture session over the HTTP API and advances it
 *      with POST /api/sessions/{sid}/sim/step — the same endpoint the notebook's "step" button uses;
 *   4. for every shot in the storyboard, puts the right state on screen and writes a PNG.
 *
 * It never touches :8000 (the rule in design/tasks/QUEUE_2026-10-03.md). It refuses a URL whose port
 * is 8000. Point it at the deployed core (default) or at a local core on :8001.
 *
 * Dependency: `ws` (the only one). From the repo root:
 *     npm i -D ws            # already present transitively in this repo; pin it if you like
 *
 * Run from anywhere (paths are resolved from the repo root):
 *     node design/video/record.mjs --check-storyboard
 *     node design/video/record.mjs --dry-run
 *     node design/video/record.mjs                       # all shots that run in rehearsal
 *     node design/video/record.mjs --until S2.6          # hook + capture only
 *     node design/video/record.mjs --proof-session <sid> # also the sealed-test inserts (live session)
 *
 * The sealed-test shots (S3.2–S3.4) need a live session that already froze a proof; Rehearsal sessions
 * refuse sealed tests by design. Without --proof-session those three shots are skipped with a note.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// tear-down hook, wired to the real cleanup once Chrome is up (see the end of the file)
let _cleanup = () => {}
process.on('uncaughtException', (e) => { console.error(`record.mjs: ${e.stack || e.message}`); _cleanup(); process.exit(1) })
process.on('SIGINT', () => { _cleanup(); process.exit(130) })

// --------------------------------------------------------------------------- names (one place)
const NAMES = {
  product: process.env.SHADOW_PRODUCT || 'Tacet',      // repo still says "Shadow" today
  character: process.env.SHADOW_CHARACTER || 'Mira',
  expert: process.env.SHADOW_EXPERT || 'Sabine',
  trainee: process.env.SHADOW_NOVICE || 'Lena',
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_CORE = 'https://core-production-c5ac.up.railway.app'
const DEFAULT_ERP = 'https://erp-production-e3b0.up.railway.app'
const STORYBOARD = join(ROOT, 'design', 'video', 'STORYBOARD.md')
const VOICEOVER = join(ROOT, 'design', 'video', 'voiceover.txt')
const FILM_SECONDS = 75

// --------------------------------------------------------------------------- shots
// `apply` moves the product to the state the frame shows; the shot itself is captured by the page
// named in `page` (or the card applies to the console page). `t`/`dur` come straight from the
// storyboard; `in`/`out` are derived and cross-checked by --check-storyboard.
const SHOTS = [
  {
    id: 'S1.1', phase: 'hook', t: 0, dur: 3, page: 'console',
    caption: 'The written process is from 2019.',
    vo: '00:00',
    apply: async (ctx) => { await ctx.pages.console.content(card2019()) },
  },
  {
    id: 'S1.2', phase: 'hook', t: 3, dur: 5, page: 'erp',
    caption: 'Sabine has done this for 24 years. She retires Friday.',
    vo: '00:00',
    apply: async (ctx) => {
      if (!ctx.sid) ctx.sid = (await createSession(ctx, { mode: 'capture', pack: ctx.pack, simulate: true, fresh: true })).id
      await ctx.pages.console.navigate(`${ctx.console}/s/${ctx.sid}`)
      await ctx.pages.erp.navigate(`${ctx.erp}/?shadow=${ctx.sid}`)
      await ctx.pages.erp.waitForSelector('[data-shadow-entity^="invoice:"]')
      await ctx.pages.console.waitForText('Capture', 25000).catch(() => {})
    },
  },
  {
    id: 'S2.1', phase: 'capture', t: 8, dur: 4, page: 'erp',
    caption: 'Before she touches it, Mira writes its guess down.',
    vo: '00:09',
    apply: async (ctx) => {
      await ctx.pages.erp.navigate(`${ctx.erp}/invoice/${ctx.captureCase}?shadow=${ctx.sid}`)
      await ctx.pages.erp.waitForSelector('[data-shadow-field="cost_center"]')
      await ensureCase(ctx, ctx.sid, ctx.captureCase)
      await sleep(900) // let the prediction card + companion paint
    },
  },
  {
    id: 'S2.2', phase: 'capture', t: 12, dur: 4, page: 'erp',
    caption: 'She books it to 0400 — capex. The doc said 4711.',
    vo: '00:12',
    apply: async (ctx) => {
      await setField(ctx.pages.erp, 'cost_center', '0400')
      await ensureDecided(ctx, ctx.sid, ctx.captureCase)
      await sleep(700)
    },
  },
  {
    id: 'S2.3', phase: 'capture', t: 16, dur: 4, page: 'console',
    caption: "It doesn't interrupt. It waits for a pause.",
    vo: '00:15',
    apply: async (ctx) => {
      await waitFor(async () => !!(await snapshot(ctx, ctx.sid)).pending.awaiting,
        { label: 'a question released at a natural pause', timeout: 20000 })
      await ctx.pages.console.eval('window.scrollTo(0,0)')
      await sleep(500)
    },
  },
  {
    id: 'S2.4', phase: 'capture', t: 20, dur: 6, page: 'console',
    caption: 'Then it asks one question: what made her do that?',
    vo: '00:21',
    apply: async (ctx) => {
      const before = await snapshot(ctx, ctx.sid)
      if (before.pending.awaiting) {
        const r = await simStep(ctx, ctx.sid)
        ctx.log(`    sim/step → ${r.did}${r.said ? ` “${String(r.said).slice(0, 64)}…”` : ''}`)
      } else {
        throw new Error('no pending question to answer')
      }
      await waitFor(async () => {
        const s = await snapshot(ctx, ctx.sid)
        return s.receipts.length > 0 && !s.pending.compiling
      }, { label: 'the learning receipt to be published', timeout: 25000 })
      await sleep(700)
    },
  },
  {
    id: 'S2.5', phase: 'capture', t: 26, dur: 5, page: 'console',
    caption: "Her answer becomes a rule. Before: 4711. Now: 0400.",
    vo: '00:28',
    apply: async (ctx) => { await ctx.pages.console.scrollToText('Learning receipts'); await sleep(500) },
  },
  {
    id: 'S2.6', phase: 'capture', t: 31, dur: 3, page: 'erp',
    caption: 'The before and the after, written down.',
    vo: '00:36',
    apply: async (ctx) => {
      const toast = await waitFor(async () => /Noted:|have said/i.test(await companionText(ctx.pages.erp)),
        { label: 'the companion toast', timeout: 3000 }).catch(() => false)
      ctx.log(`    companion toast visible: ${toast ? 'yes' : 'no (captured the companion anyway)'}`)
      await sleep(250)
    },
  },
  {
    id: 'S3.1', phase: 'proof', t: 34, dur: 5, page: 'console',
    caption: 'Independent test. Pick the threshold she just taught.',
    vo: '00:34',
    apply: async (ctx) => {
      const sid = ctx.proofSid || ctx.sid
      await ctx.pages.console.navigate(`${ctx.console}/s/${sid}/proof`)
      await ctx.pages.console.waitForText('Sealed boundary test', 20000)
        .catch(async () => { await ctx.pages.console.dumpText(join(ctx.out, 'S3.1-debug.txt')) })
      await sleep(500)
    },
  },
  {
    id: 'S3.2', phase: 'proof', t: 39, dur: 5, page: 'console', requiresProof: true,
    caption: '11 unseen invoices, committed with a hash before any label.',
    vo: '00:39',
    apply: async (ctx) => {
      await ctx.pages.console.scrollToText('sha-256 commitment')
      await sleep(400)
    },
  },
  {
    id: 'S3.3', phase: 'proof', t: 44, dur: 3, page: 'console', requiresProof: true,
    caption: 'Two are wrong. Both just under the line.',
    vo: '00:43',
    apply: async (ctx) => { await ctx.pages.console.scrollToText('Unseen invoice'); await sleep(300) },
  },
  {
    id: 'S3.4', phase: 'proof', t: 47, dur: 3, page: 'console', requiresProof: true,
    caption: 'Each miss corrects the map. Next round: 11 for 11.',
    vo: '00:48',
    apply: async (ctx) => { await sleep(200) },
  },
  {
    id: 'S4.1', phase: 'tutor', t: 50, dur: 4, page: 'console',
    caption: 'Monday. A new hire gets the same invoices.',
    vo: '00:51',
    apply: async (ctx) => {
      ctx.tutorSid = await createTutorWithMap(ctx)
      await ctx.pages.console.navigate(`${ctx.console}/s/${ctx.tutorSid}`)
      await ctx.pages.erp.navigate(`${ctx.erp}/invoice/${ctx.tutorCase}?shadow=${ctx.tutorSid}`)
      await ctx.pages.erp.waitForSelector('[data-shadow-field="cost_center"]')
      await ensureCase(ctx, ctx.tutorSid, ctx.tutorCase) // opens the case for the tutor, no attempt yet
      // reload the notebook so its snapshot has the open case (tutor_open has no prediction event)
      await ctx.pages.console.navigate(`${ctx.console}/s/${ctx.tutorSid}`)
      await ctx.pages.console.waitForText('Tutor', 20000).catch(() => {})
      await sleep(500)
    },
  },
  {
    id: 'S4.2', phase: 'tutor', t: 54, dur: 5, page: 'erp',
    caption: 'She codes it 4711, as the 2019 doc says.',
    vo: '00:51',
    apply: async (ctx) => { await setField(ctx.pages.erp, 'cost_center', '4711'); await sleep(500) },
  },
  {
    id: 'S4.3', phase: 'tutor', t: 59, dur: 4, page: 'erp',
    caption: "Mira stops the save — in Sabine's words.",
    vo: '00:55',
    apply: async (ctx) => {
      const r = await simStep(ctx, ctx.tutorSid)
      ctx.log(`    tutor sim/step → ${r.did}${r.verdict && !r.verdict.allow ? ' (blocked)' : ''}`)
      await waitFor(async () => /stop here|No asset|not capex|capex/i.test(await companionText(ctx.pages.erp)),
        { label: 'the intervention plate', timeout: 8000 }).catch(() => {})
      await sleep(300)
    },
  },
  {
    id: 'S4.4', phase: 'tutor', t: 63, dur: 3, page: 'console',
    caption: 'Then it steps back and lets her work.',
    vo: '01:04',
    apply: async (ctx) => {
      await ctx.pages.console.scrollToText(`mastery`).catch(() => {})
      await sleep(400)
    },
  },
  {
    id: 'S5.1', phase: 'close', t: 66, dur: 4, page: 'console',
    caption: 'The Work Map. Every line links to the moment and her words.',
    vo: '01:04',
    apply: async (ctx) => {
      await ctx.pages.console.navigate(`${ctx.console}/s/${ctx.tutorSid || ctx.sid}/map`)
      await ctx.pages.console.waitForText('Signature', 20000)
        .catch(async () => { await ctx.pages.console.dumpText(join(ctx.out, 'S5.1-debug.txt')) })
      await sleep(400)
    },
  },
  {
    id: 'S5.2', phase: 'close', t: 70, dur: 3, page: 'console',
    caption: 'Exportable to agents — as guardrails, not advice.',
    vo: '01:04',
    apply: async (ctx) => {
      await ctx.pages.console.navigate(`${ctx.core}/api/sessions/${ctx.tutorSid || ctx.sid}/export/skill`)
      await sleep(700)
    },
  },
  {
    id: 'S5.3', phase: 'close', t: 73, dur: 2, page: 'console',
    caption: 'Learns the part of the job nobody wrote down.',
    vo: '01:09',
    apply: async (ctx) => { await ctx.pages.console.content(cardTagline()) },
  },
]

for (const s of SHOTS) { s.in = s.t; s.out = s.t + s.dur }

// --------------------------------------------------------------------------- cards (design system)
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function shellCard({ kicker, title, lines = [], foot = '', accent = '#4e6b44' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Geist:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<title>${esc(kicker)}</title>
<style>
  html,body{height:100%;margin:0}
  body{background:#f4f1ea;color:#22201c;font-family:Geist,system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center}
  .sheet{width:min(1120px,84%);background:#fbf9f4;border:1px solid #e2ddd2;padding:66px 76px}
  .kicker{font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9a9488}
  h1{font-family:Newsreader,Georgia,serif;font-weight:400;font-size:54px;line-height:1.08;letter-spacing:-.015em;margin:28px 0 0;max-width:26ch}
  .rule{border-left:3px solid ${accent};padding-left:20px;margin-top:30px}
  p{font-size:17px;line-height:1.65;color:#6b665d;margin:8px 0 0;max-width:62ch}
  .foot{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#9a9488;margin-top:48px;border-top:1px solid #e2ddd2;padding-top:14px}
  b{color:#22201c;font-weight:500}
</style></head><body><div class="sheet">
  <div class="kicker">${esc(kicker)}</div>
  ${title ? `<h1>${title}</h1>` : ''}
  ${lines.length ? `<div class="rule">${lines.map((l) => `<p>${l}</p>`).join('')}</div>` : ''}
  <div class="foot">${esc(foot)}</div>
</div></body></html>`
}

function card2019() {
  return shellCard({
    kicker: 'Nordwerk Maschinenbau · AP Work Instruction AP-WI-03 · revised 2019',
    title: '“Equipment and IT hardware: cost center <b>4711</b>.”',
    lines: [
      'The document names the cost centers, the tax code and the due date.',
      'It does not say when equipment stops being maintenance and becomes capex.',
    ],
    foot: 'quoted verbatim · backend/shadow/packs/ap_invoices/process_doc_2019.md',
    accent: '#a2412e',
  })
}

function cardTagline() {
  return shellCard({
    kicker: NAMES.product,
    title: 'Learns the part of the job nobody wrote down.',
    lines: [
      `${NAMES.character} writes its guess before the expert acts. When she does something it cannot explain, ` +
      'it waits for a pause, asks one question, and keeps the answer as a rule that is tested on cases nobody has seen.',
    ],
    foot: `${NAMES.expert}’s Work Map · sealed boundary test · tutor for ${NAMES.trainee}`,
  })
}

// --------------------------------------------------------------------------- tiny CDP client
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function waitFor(fn, { timeout = 20000, interval = 350, label = 'condition' } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try { if (await fn()) return true } catch (e) { last = e }
    await sleep(interval)
  }
  throw new Error(`timed out (${timeout}ms) waiting for ${label}${last ? `: ${last.message}` : ''}`)
}

/** Like waitFor, but resolves with the first truthy value instead of `true`. */
async function retry(fn, { timeout = 20000, interval = 350, label = 'condition' } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v } catch (e) { last = e }
    await sleep(interval)
  }
  throw new Error(`timed out (${timeout}ms) waiting for ${label}${last ? `: ${last.message}` : ''}`)
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.handlers = new Map() }

  async connect() {
    const mod = await import('ws')
    const WebSocketImpl = mod.WebSocket || mod.default
    await new Promise((pass, fail) => {
      this.ws = new WebSocketImpl(this.url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 })
      this.ws.once('open', pass)
      this.ws.once('error', fail)
      this.ws.on('message', (d) => this._onMessage(d))
    })
  }

  _onMessage(data) {
    let msg
    try { msg = JSON.parse(data.toString()) } catch { return }
    if (msg.id && this.pending.has(msg.id)) {
      const { pass, fail } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) fail(new Error(`${msg.error.message || 'CDP error'}${msg.error.data ? `: ${msg.error.data}` : ''}`))
      else pass(msg.result)
      return
    }
    if (msg.method) {
      const list = this.handlers.get(msg.method)
      if (list) for (const fn of [...list]) fn(msg.params, msg.sessionId)
    }
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id
    return new Promise((pass, fail) => {
      this.pending.set(id, { pass, fail })
      const payload = { id, method, params }
      if (sessionId) payload.sessionId = sessionId
      this.ws.send(JSON.stringify(payload))
    })
  }

  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn) }
  off(method, fn) { const l = this.handlers.get(method); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1) } }

  waitEvent(method, sessionId, timeoutMs = 25000) {
    return new Promise((pass, fail) => {
      const fn = (params, sid) => { if (sessionId && sid !== sessionId) return; cleanup(); pass(params) }
      const timer = setTimeout(() => { cleanup(); fail(new Error(`timeout waiting for ${method}`)) }, timeoutMs)
      const cleanup = () => { clearTimeout(timer); this.off(method, fn) }
      this.on(method, fn)
    })
  }
}

class Page {
  constructor(cdp, sessionId, ctx) { this.cdp = cdp; this.sessionId = sessionId; this.ctx = ctx }

  send(method, params) { return this.cdp.send(method, params, this.sessionId) }

  async init() {
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: this.ctx.width, height: this.ctx.height, deviceScaleFactor: this.ctx.scale, mobile: false,
    })
    await this.send('Emulation.setScrollbarsHidden', { hidden: true }).catch(() => {})
  }

  async navigate(url, { timeout = 25000, settle = 750 } = {}) {
    const loaded = this.cdp.waitEvent('Page.loadEventFired', this.sessionId, timeout).catch(() => null)
    await this.send('Page.navigate', { url })
    await loaded
    await sleep(settle)
  }

  async content(html, { settle = 1100 } = {}) {
    await this.navigate('data:text/html;charset=utf-8,' + encodeURIComponent(html), { settle })
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) {
      throw new Error(`evaluate failed: ${r.exceptionDetails.text} ${(r.exceptionDetails.exception || {}).description || ''}`)
    }
    return r.result ? r.result.value : undefined
  }

  async waitForSelector(selector, timeout = 20000) {
    return waitFor(() => this.eval(`!!document.querySelector(${JSON.stringify(selector)})`),
      { timeout, label: `selector ${selector}` })
  }

  async waitForText(text, timeout = 20000) {
    const needle = JSON.stringify(String(text).toLowerCase())
    return waitFor(
      () => this.eval(`!!document.body && document.body.innerText.toLowerCase().includes(${needle})`),
      { timeout, label: `text “${text}”` },
    )
  }

  async scrollToText(needle) {
    return this.eval(`(() => {
      const hit = [...document.querySelectorAll('*')].find((e) => !e.children.length
        && e.textContent && e.textContent.trim().toLowerCase().includes(${JSON.stringify(String(needle).toLowerCase())}));
      if (!hit) return false;
      hit.scrollIntoView({ block: 'center' });
      return true;
    })()`)
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  }

  /** Write what the page currently shows, for debugging a shot that did not match. */
  async dumpText(file) {
    const text = await this.eval('document.body ? document.body.innerText : "(no body)"').catch((e) => `(dump failed: ${e.message})`)
    writeFileSync(file, String(text))
  }
}

// --------------------------------------------------------------------------- product helpers
async function api(ctx, path, init) {
  const r = await fetch(`${ctx.core}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init && init.headers) },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${init && init.method || 'GET'} ${path} → ${r.status} ${text.slice(0, 240)}`)
  return text ? JSON.parse(text) : null
}

const createSession = (ctx, body) => api(ctx, '/api/sessions', { method: 'POST', body: JSON.stringify(body) })
const simStep = (ctx, sid) => api(ctx, `/api/sessions/${sid}/sim/step`, { method: 'POST' })
const snapshot = (ctx, sid) => api(ctx, `/api/sessions/${sid}`)
const postEvent = (ctx, sid, evt) => api(ctx, `/api/sessions/${sid}/events`, { method: 'POST', body: JSON.stringify(evt) })

/** Make sure `cid` is the open case and its prediction is committed (Opening a case never decides it). */
async function ensureCase(ctx, sid, cid, { timeout = 15000 } = {}) {
  const has = async () => {
    const s = await snapshot(ctx, sid)
    return s.current_case === cid && s.predictions && s.predictions[cid] ? s : null
  }
  const now = await has()
  if (now) return now
  // capture.js normally opens the case from the URL; nudge the engine directly if it has not yet
  await postEvent(ctx, sid, { type: 'case_opened', case_id: cid, client_ts: Date.now() / 1000 }).catch(() => {})
  return retry(has, { timeout, label: `case ${cid} open with a prediction` })
}

/** Drive the simulated expert until `cid` has a recorded decision (an episode). */
async function ensureDecided(ctx, sid, cid, { timeout = 20000 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const s = await snapshot(ctx, sid)
    if (s.episodes.some((e) => e.case_id === cid)) return s
    const r = await simStep(ctx, sid)
    ctx.log(`    sim/step → ${r.did}${r.case ? ` ${r.case}` : ''}${r.action ? ` (${r.action})` : ''}`)
    await sleep(500)
  }
  throw new Error(`timed out waiting for a decision on ${cid}`)
}

/** One full learn cycle on a simulated capture session: open → decide → answer the pause question → receipt. */
async function learnOneCase(ctx, sid, cid) {
  await postEvent(ctx, sid, { type: 'case_opened', case_id: cid }).catch(() => {})
  await ensureCase(ctx, sid, cid)
  await ensureDecided(ctx, sid, cid)
  await waitFor(async () => !!(await snapshot(ctx, sid)).pending.awaiting,
    { label: 'a question released at a pause', timeout: 25000 })
  const s = await snapshot(ctx, sid)
  if (s.pending.awaiting) await simStep(ctx, sid)
  await waitFor(async () => {
    const x = await snapshot(ctx, sid)
    return x.receipts.length > 0 && !x.pending.compiling
  }, { label: 'the learning receipt', timeout: 25000 })
  return snapshot(ctx, sid)
}

/**
 * Create the tutor session from the capture session's map. Sessions live in memory on the core, so a
 * mid-run restart can silently leave the tutor with the seed-only map; detect that and rebuild the
 * capture map rather than filming a tutor that never learned anything.
 */
async function createTutorWithMap(ctx) {
  const learned = (s) => s.map.rules.filter((r) => r.origin !== 'doc')
  let tutor = await createSession(ctx, {
    mode: 'tutor', trainee: NAMES.trainee, from_session: ctx.sid, simulate: true, pack: ctx.pack,
  })
  let tmap = await snapshot(ctx, tutor.id)
  if (tmap.map_source.kind === 'session' && learned(tmap).length) return tutor.id
  ctx.log(`    tutor inherited kind=${tmap.map_source.kind} with 0 learned rules — the core likely restarted; rebuilding the capture map`)
  const fresh = await createSession(ctx, { mode: 'capture', simulate: true, fresh: true, pack: ctx.pack })
  await learnOneCase(ctx, fresh.id, ctx.captureCase)
  ctx.sid = fresh.id
  tutor = await createSession(ctx, {
    mode: 'tutor', trainee: NAMES.trainee, from_session: ctx.sid, simulate: true, pack: ctx.pack,
  })
  tmap = await snapshot(ctx, tutor.id)
  const n = learned(tmap).length
  if (tmap.map_source.kind !== 'session' || !n) throw new Error('tutor could not inherit a learned map')
  ctx.log(`    rebuilt: capture ${ctx.sid} → tutor ${tutor.id} with ${n} learned rule(s)`)
  return tutor.id
}

/** Set a data-shadow-field control and let React + capture.js see it (native setter, then events). */
async function setField(page, field, value) {
  const ok = await page.eval(`(() => {
    const el = document.querySelector('[data-shadow-field="' + ${JSON.stringify(field)} + '"]');
    if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  })()`)
  if (!ok) throw new Error(`no [data-shadow-field="${field}"] on the page`)
  return sleep(300)
}

/** Text inside the companion's shadow root (it has no host id, so gather every shadow host). */
async function companionText(page) {
  return page.eval(`(() => [...document.querySelectorAll('*')]
    .filter((e) => e.shadowRoot)
    .map((e) => e.shadowRoot.textContent || '')
    .join(' ').replace(/\\s+/g, ' ').trim())()`)
}

// --------------------------------------------------------------------------- args + helpers
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const eq = a.indexOf('=')
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (eq >= 0) { out[key] = a.slice(eq + 1); continue }
    if (['dryRun', 'checkStoryboard', 'checkVoiceover', 'headed', 'noLaunch', 'keep', 'quiet', 'noSandbox', 'help'].includes(key)) {
      out[key] = true
    } else {
      out[key] = argv[++i]
    }
  }
  return out
}

function log(msg) { if (!ARGS.quiet) console.log(msg) }
function fail(msg) { console.error(`record.mjs: ${msg}`); process.exit(1) }

function assertNot8000(label, url) {
  if (!url) return
  try {
    const u = new URL(url)
    const port = u.port || (u.protocol === 'https:' ? '443' : '80')
    if (port === '8000') fail(`${label} → ${url} is :8000. QUEUE_2026-10-03 forbids :8000; use the deployed core or :8001.`)
  } catch { /* relative URL: nothing to check */ }
}

function findChrome() {
  const candidates = [
    ARGS.chrome,
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((c) => existsSync(c)) || null
}

// --------------------------------------------------------------------------- storyboard / voiceover checks
function extractStoryboardIds(md) {
  const ids = []
  const re = /^\|\s*\*\*(S\d+\.\d+)\*\*\s*\|/gm
  let m
  while ((m = re.exec(md))) ids.push(m[1])
  return ids
}

function checkStoryboard() {
  if (!existsSync(STORYBOARD)) fail(`missing ${STORYBOARD}`)
  const doc = extractStoryboardIds(readFileSync(STORYBOARD, 'utf8'))
  const code = SHOTS.map((s) => s.id)
  const problems = []
  for (const id of code) if (!doc.includes(id)) problems.push(`record.mjs shot ${id} is not in STORYBOARD.md`)
  for (const id of doc) if (!code.includes(id)) problems.push(`STORYBOARD.md shot ${id} is not in record.mjs`)
  const total = SHOTS.reduce((n, s) => n + s.dur, 0)
  if (total !== FILM_SECONDS) problems.push(`shot durations sum to ${total}s, expected ${FILM_SECONDS}s`)
  for (const s of SHOTS) {
    if (!s.caption) problems.push(`${s.id} has no caption`)
    if (!s.vo) problems.push(`${s.id} has no voiceover cue`)
  }
  console.log(`storyboard shots in doc: ${doc.length}; in record.mjs: ${code.length}; total ${total}s`)
  if (problems.length) { for (const p of problems) console.error(`  ✗ ${p}`); process.exit(1) }
  console.log('✓ STORYBOARD.md and record.mjs agree on every shot and on the 75s total')
}

function checkVoiceover() {
  if (!existsSync(VOICEOVER)) fail(`missing ${VOICEOVER}`)
  const raw = readFileSync(VOICEOVER, 'utf8')
  const narration = raw.split('\n')
    .map((l) => l.replace(/^\s*\d{2}:\d{2}\s*/, '').replace(/\([^)]*\)/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
  const words = narration.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w))
  const rawWords = raw.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w))
  console.log(`voiceover narration words: ${words.length} (limit 170); whole file incl. timings: ${rawWords.length}`)
  if (words.length > 170) fail(`voiceover.txt narration is ${words.length} words (limit 170)`)
  console.log('✓ voiceover.txt within the 170-word limit')
}

// --------------------------------------------------------------------------- planning output
function planLines(ctx) {
  const lines = []
  lines.push(`core      ${ctx.core}`)
  lines.push(`console   ${ctx.console || `${ctx.core} (from /api/config at run time)`}`)
  lines.push(`erp       ${ctx.erp || `${DEFAULT_ERP} (from /api/config at run time)`}`)
  lines.push(`out       ${ctx.out}`)
  lines.push(`chrome    ${ARGS.noLaunch ? `attach to :${ctx.port}` : (findChrome() || 'not found (--chrome <path>)')}`)
  lines.push(`viewport  ${ctx.width}x${ctx.height} @${ctx.scale}x`)
  lines.push(`session   ${ARGS.session ? `existing ${ARGS.session}` : 'new REHEARSAL capture session (simulate:true), then a tutor session from it'}`)
  lines.push(`proof     ${ctx.proofSid ? `existing live session ${ctx.proofSid}` : 'none — S3.2–S3.4 will be skipped (set --proof-session <sid>)'}`)
  lines.push('')
  for (const s of SHOTS) lines.push(`  ${s.id}  ${mmss(s.in)}–${mmss(s.out)}  ${s.phase.padEnd(8)} ${s.caption}`)
  return lines
}

function mmss(t) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// --------------------------------------------------------------------------- main
const ARGS = parseArgs(process.argv.slice(2))

if (ARGS.help) {
  console.log(`Usage: node design/video/record.mjs [options]
  --core <url>          Shadow Core + notebook (default ${DEFAULT_CORE})
  --console <url>       notebook origin (default: /api/config console_url, else --core)
  --erp <url>           demo workplace origin (default: /api/config erp_url, else ${DEFAULT_ERP})
  --out <dir>           screenshot directory (default design/video/frames)
  --session <sid>       reuse an existing session instead of creating a rehearsal one
  --proof-session <sid> live session with a frozen proof, for S3.1–S3.4
  --only a,b            capture only these shots (earlier steps still run to reach their state)
  --until <id>          run the film up to and including this shot
  --phase <name>        hook | capture | proof | tutor | close
  --chrome <path>       Chrome/Chromium binary (default: auto-detect / CHROME_PATH)
  --port <n>            remote debugging port (default 9222)
  --width --height --scale  viewport (default 1600x900 @1.5)
  --headed              show the browser
  --no-sandbox          pass --no-sandbox to Chrome (needed in CI/sandboxed shells where Chrome's
                        own sandbox cannot initialise; leave it off on your own machine)
  --no-launch           attach to a Chrome already running with --remote-debugging-port
  --keep                leave Chrome open when done
  --dry-run             print the plan, touch nothing
  --check-storyboard    verify STORYBOARD.md and record.mjs agree
  --check-voiceover     verify voiceover.txt is within 170 narration words
  --quiet               less logging`)
  process.exit(0)
}

if (ARGS.checkStoryboard) { checkStoryboard(); process.exit(0) }
if (ARGS.checkVoiceover) { checkVoiceover(); process.exit(0) }
if (ARGS.product) NAMES.product = ARGS.product
if (ARGS.character) NAMES.character = ARGS.character
if (ARGS.expert) NAMES.expert = ARGS.expert
if (ARGS.trainee) NAMES.trainee = ARGS.trainee

const ctx = {
  core: String(ARGS.core || DEFAULT_CORE).replace(/\/$/, ''),
  console: ARGS.console ? String(ARGS.console).replace(/\/$/, '') : '',
  erp: ARGS.erp ? String(ARGS.erp).replace(/\/$/, '') : '',
  out: ARGS.out ? resolve(ARGS.out) : join(ROOT, 'design', 'video', 'frames'),
  width: Number(ARGS.width || 1600),
  height: Number(ARGS.height || 900),
  scale: Number(ARGS.scale || 1.5),
  port: Number(ARGS.port || 9222),
  proofSid: ARGS.proofSession || null,
  sid: ARGS.session || null,
  tutorSid: null,
  pack: ARGS.pack || 'ap_invoices',
  captureCase: ARGS.captureCase || 'inv-4471',
  tutorCase: ARGS.tutorCase || 'inv-5120',
  pages: {},
  log,
}
assertNot8000('--core', ctx.core)
if (ctx.console) assertNot8000('--console', ctx.console)
if (ctx.erp) assertNot8000('--erp', ctx.erp)
if (ctx.proofSid && ctx.proofSid === ctx.sid) ctx.proofSid = null

if (ARGS.dryRun) {
  console.log(`record.mjs — ${NAMES.product} / ${NAMES.character} · dry run (nothing launched, no network)`)
  console.log(planLines(ctx).join('\n'))
  console.log(`\nTo run:  node design/video/record.mjs${ARGS.proofSession ? ` --proof-session ${ARGS.proofSession}` : ''}`)
  process.exit(0)
}

checkStoryboard()
checkVoiceover()

// selection: steps up to the last selected shot still run their `apply` so the selected shot has state
const selected = new Set()
if (ARGS.only) String(ARGS.only).split(',').map((s) => s.trim()).filter(Boolean).forEach((id) => selected.add(id))
else if (ARGS.until) { for (const s of SHOTS) { selected.add(s.id); if (s.id === ARGS.until) break } }
else if (ARGS.phase) SHOTS.filter((s) => s.phase === ARGS.phase).forEach((s) => selected.add(s.id))
else SHOTS.forEach((s) => selected.add(s.id))
if (!selected.size) fail(`nothing selected (unknown --only/--until/--phase?)`)
for (const id of selected) if (!SHOTS.some((s) => s.id === id)) fail(`unknown shot id ${id}`)
const lastIndex = Math.max(...SHOTS.map((s, i) => (selected.has(s.id) ? i : -1)))

// resolve the notebook + ERP origins from the deployed core unless overridden
try {
  const cfg = await (await fetch(`${ctx.core}/api/config`)).json()
  if (!ctx.console) ctx.console = (cfg.console_url || ctx.core).replace(/\/$/, '')
  if (!ctx.erp) ctx.erp = (cfg.erp_url || DEFAULT_ERP).replace(/\/$/, '')
  log(`resolved from /api/config: console=${ctx.console} erp=${ctx.erp}`)
} catch (e) {
  if (!ctx.console) ctx.console = ctx.core
  if (!ctx.erp) ctx.erp = DEFAULT_ERP
  log(`/api/config unavailable (${e.message}); using console=${ctx.console} erp=${ctx.erp}`)
}
assertNot8000('console', ctx.console)
assertNot8000('erp', ctx.erp)

mkdirSync(ctx.out, { recursive: true })
log(`record.mjs — ${NAMES.product} / ${NAMES.character} · ${selected.size}/${SHOTS.length} shots · out ${ctx.out}`)

// launch / attach Chrome
let chrome = null
let profile = null
if (!ARGS.noLaunch) {
  const chromePath = findChrome()
  if (!chromePath) fail('no Chrome/Chromium found; pass --chrome <path> or set CHROME_PATH')
  profile = mkdtempSync(join(tmpdir(), 'shadow-video-'))
  const flags = [
    ARGS.headed ? null : '--headless=new',
    `--remote-debugging-port=${ctx.port}`,
    `--user-data-dir=${profile}`,
    `--crash-dumps-dir=${join(profile, 'crash')}`,
    '--remote-allow-origins=*',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-breakpad', '--disable-crash-reporter', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-features=Translate,BackForwardCache', '--hide-scrollbars', '--mute-audio',
    ARGS.noSandbox ? '--no-sandbox' : null, // needed where Chrome's own sandbox cannot initialise
    `--window-size=${ctx.width},${ctx.height}`,
    'about:blank',
  ].filter(Boolean)
  chrome = spawn(chromePath, flags, { stdio: 'ignore', detached: false })
  log(`launched ${chromePath} (pid ${chrome.pid}, debug :${ctx.port})`)
}

const version = await retry(
  async () => (await fetch(`http://127.0.0.1:${ctx.port}/json/version`)).json(),
  { timeout: 20000, interval: 400, label: `Chrome debug port :${ctx.port}` },
)
const cdp = new CDP(version.webSocketDebuggerUrl)
await cdp.connect()

async function newPage() {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const page = new Page(cdp, sessionId, ctx)
  await page.init()
  return page
}
ctx.pages.console = await newPage()
ctx.pages.erp = await newPage()

// tear-down: close CDP, stop Chrome, drop the throwaway profile (unless --keep)
const cleanup = () => {
  if (ARGS.keep) return
  try { cdp.close() } catch {}
  try { if (chrome) chrome.kill('SIGTERM') } catch {}
  if (profile) setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }) } catch {} }, 500)
}
_cleanup = cleanup

// --------------------------------------------------------------------------- run the film
const manifest = []
try {
  for (let i = 0; i <= lastIndex; i++) {
    const shot = SHOTS[i]
    const page = shot.page === 'erp' ? ctx.pages.erp : ctx.pages.console
    const file = join(ctx.out, `${shot.id}-${slug(shot.caption)}.png`)
    const entry = { id: shot.id, in: shot.in, out: shot.out, phase: shot.phase, caption: shot.caption, vo: shot.vo, file: null }

    if (shot.requiresProof && !ctx.proofSid) {
      entry.skipped = 'no --proof-session (sealed tests are refused by rehearsal sessions)'
      manifest.push(entry)
      log(`${shot.id}  SKIP  ${entry.skipped}`)
      continue
    }
    if (!selected.has(shot.id)) {
      try { await shot.apply(ctx) } catch (e) { log(`${shot.id}  (state step failed: ${e.message})`) }
      continue
    }
    try {
      await shot.apply(ctx)
      await page.screenshot(file)
      entry.file = file
      log(`${shot.id}  ${mmss(shot.in)}–${mmss(shot.out)}  ✓  ${file.replace(ROOT + '/', '')}`)
    } catch (e) {
      entry.error = e.message
      log(`${shot.id}  ✗  ${e.message}`)
    }
    manifest.push(entry)
  }

  writeFileSync(join(ctx.out, 'manifest.json'), JSON.stringify({
    product: NAMES.product, character: NAMES.character, expert: NAMES.expert, trainee: NAMES.trainee,
    core: ctx.core, console: ctx.console, erp: ctx.erp,
    session: ctx.sid, tutor_session: ctx.tutorSid, proof_session: ctx.proofSid,
    mode: ctx.proofSid ? 'rehearsal + live proof inserts' : 'rehearsal (simulated expert)',
    film_seconds: FILM_SECONDS, recorded: new Date().toISOString(),
    shots: manifest,
  }, null, 2))

  const ok = manifest.filter((m) => m.file).length
  log(`done: ${ok} frame(s) written, manifest at ${join(ctx.out, 'manifest.json').replace(ROOT + '/', '')}`)
  if (manifest.some((m) => m.error)) log('some shots failed — see the log above')
} catch (e) {
  console.error(`record.mjs: ${e.stack || e.message}`)
  _cleanup()
  process.exit(1)
}

cleanup()

function slug(text) {
  return String(text).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
}
