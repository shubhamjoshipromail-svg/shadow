#!/usr/bin/env node
// render_png.mjs <jobs.json> — each job {out, html}: a full HTML document rendered to a 1920x1080 transparent PNG
// (headless Chrome over CDP; waits for web fonts). Same pattern as design/team/render.mjs.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const WS = createRequire(join(ROOT, 'package.json'))('ws')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9347, W = +process.env.PNG_W || 1920, H = +process.env.PNG_H || 1080
const jobs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const prof = join(tmpdir(), 'tacet-demo-' + process.pid)
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--hide-scrollbars',
  '--force-device-scale-factor=1', `--window-size=${W},${H}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
let list
for (let i = 0; i < 80; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (list.find((x) => x.type === 'page')) break } catch {} await new Promise((r) => setTimeout(r, 250)) }
const ws = new WS(list.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.on('open', r))
let id = 0; const pend = new Map()
ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } })
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, (d) => d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
let frameId = (await send('Page.getFrameTree')).frameTree.frame.id
for (const job of jobs) {
  await send('Page.setDocumentContent', { frameId, html: job.html })
  for (let i = 0; i < 80; i++) {
    const r = await send('Runtime.evaluate', { expression: '[...document.querySelectorAll("link[rel=stylesheet]")].every(l => l.sheet) && (!document.querySelector("link[rel=stylesheet]") || document.fonts.size > 0) && document.fonts.status === "loaded" && [...document.images].every(i => i.complete)', returnByValue: true })
    if (r.result.value) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await new Promise((r) => setTimeout(r, 60))
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })
  writeFileSync(job.out, Buffer.from(data, 'base64'))
}
ws.close(); ch.kill(); try { rmSync(prof, { recursive: true, force: true }) } catch {}
console.log(`rendered ${jobs.length} png`)
