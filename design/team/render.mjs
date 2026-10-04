#!/usr/bin/env node
/**
 * render.mjs — render team.html (transparent overlay, pure function of time) to PNG frames.
 *   node design/team/render.mjs <outDir>               every frame at 30 fps
 *   node design/team/render.mjs <outDir> --t 1,29.5    just those times (t<time>.png)
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
const DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(DIR, '../..')
const WS = createRequire(join(ROOT, 'package.json'))('ws')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9343, W = 1080, H = 1920, FPS = 30
const out = resolve(process.argv[2] || 'frames'); mkdirSync(out, { recursive: true })
const ti = process.argv.indexOf('--t'), only = ti > 0 ? process.argv[ti + 1].split(',').map(Number) : null

const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(tmpdir(), 'tacet-team-' + process.pid)}`,
  '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${W},${H}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
let list
for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (list.find((x) => x.type === 'page')) break } catch {} await new Promise((r) => setTimeout(r, 250)) }
const ws = new WS(list.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.on('open', r))
let id = 0; const pend = new Map()
ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } })
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, (d) => d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
await send('Page.navigate', { url: pathToFileURL(join(DIR, 'team.html')).href })
for (let i = 0; i < 120; i++) { const r = await send('Runtime.evaluate', { expression: 'window.ready===true', returnByValue: true }); if (r.result.value) break; await new Promise((r) => setTimeout(r, 250)) }
const dur = (await send('Runtime.evaluate', { expression: 'window.DUR', returnByValue: true })).result.value
const times = only || Array.from({ length: Math.round(dur * FPS) }, (_, i) => i / FPS)
for (let i = 0; i < times.length; i++) {
  await send('Runtime.evaluate', { expression: `seek(${times[i]})` })
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })
  writeFileSync(join(out, only ? `t${times[i]}.png` : `f${String(i).padStart(5, '0')}.png`), Buffer.from(data, 'base64'))
  if (!only && i % 150 === 0) console.log(`frame ${i}/${times.length}`)
}
ws.close(); ch.kill()
