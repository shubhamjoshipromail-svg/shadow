#!/usr/bin/env node
/**
 * render.mjs — render film.html (a pure function of time) to out/film.mp4 via headless Chrome + CDP + ffmpeg.
 *   node design/film/render.mjs                      full render (frames -> mp4, audio mix, vtt, poster)
 *   node design/film/render.mjs --stills 3,12.5,40   write PNG stills to out/stills/ (no video)
 *   node design/film/render.mjs --sheet              contact sheet every 3s -> out/contact.jpg
 *   node design/film/render.mjs --no-video           only vtt + audio (reuse out/silent.mp4)
 *   node design/film/render.mjs --video-only         frames -> out/<comp>-silent.mp4 only (no audio mix, vtt untouched)
 * Flags: --fps 30  --size 1920x1080  --crf 24  --music path.mp3
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
const DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(DIR, '../..')
const require = createRequire(join(ROOT, 'package.json'))
const WS = require('ws')
const FFMPEG = process.env.FFMPEG || (existsSync(join(ROOT, 'design/video/node_modules/ffmpeg-static/ffmpeg')) ? join(ROOT, 'design/video/node_modules/ffmpeg-static/ffmpeg') : 'ffmpeg')
const CHROME = process.env.CHROME || (existsSync('/Applications/Google Chrome.app') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
const OUT = join(DIR, 'out'); mkdirSync(OUT, { recursive: true })
const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[i + 1]) }
const FPS = Number(flag('fps', 30)), CRF = String(flag('crf', 24))
const [OW, OH] = String(flag('size', '1920x1080')).split('x').map(Number)
const COMP = String(flag('comp', 'film'))
const TECH = COMP === 'tech'
const DUR = TECH ? 58.0 : 77.0
const PORT = 9341

// ---- timings: line i (1-based) starts at LINES[i-1]; keep in sync with L[] in film.html
const LANG = String(flag('lang', 'en'))
const SFX = LANG === 'en' ? '' : '.' + LANG
// audio start times (the visuals in film.html stay on the original L[]); v4 narration needed small per-language shifts
const LINES = TECH ? [0.3, 3.1, 9.7, 14.2, 21.2, 28.3, 35.7, 46.6, 53.3] : LANG === 'de'
  ? [0.8,4.3,8.4,11.5,15.4,21.4,26.2,30.0,37.3,39.2,45.2,50.7,55.0,59.7,62.2,67.4,72.0]
  : [0.6,4.3,8.3,11.5,15.4,21.4,26.2,30.0,37.4,39.1,45.2,51.0,55.0,59.3,62.2,67.4,72.0]
const vo = readFileSync(join(DIR, TECH ? 'tech-voiceover.txt' : LANG === 'en' ? 'voiceover.txt' : `voiceover${SFX}.txt`), 'utf8').split(/\r?\n/).filter((l) => /^\s*\d/.test(l))

async function launch() {
  const profile = join(tmpdir(), 'tacet-film-' + process.pid)
  const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), '--force-device-scale-factor=1', '--window-size=1920,1080', '--no-first-run', '--disable-gpu-vsync', 'about:blank'], { stdio: 'ignore' })
  let list
  for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (list.find((x) => x.type === 'page')) break } catch {} await new Promise((r) => setTimeout(r, 250)) }
  const page = list.find((x) => x.type === 'page')
  const ws = new WS(page.webSocketDebuggerUrl); await new Promise((r) => ws.on('open', r))
  let id = 0; const pend = new Map()
  ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } })
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, (d) => d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: pathToFileURL(join(DIR, TECH ? 'tech.html' : 'film.html')).href })
  for (let i = 0; i < 120; i++) { const r = await send('Runtime.evaluate', { expression: 'window.ready===true', returnByValue: true }); if (r.result.value) break; await new Promise((r) => setTimeout(r, 250)) }
  // off the Mac (no Google Fonts reachable from headless Chrome): FONT_CSS points at local @font-face rules
  if (process.env.FONT_CSS) await send('Runtime.evaluate', { expression: `(async()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(readFileSync(process.env.FONT_CSS, 'utf8'))};document.head.appendChild(s);await document.fonts.load('300 96px Newsreader');await document.fonts.load('italic 300 96px Newsreader');await document.fonts.load('600 36px Geist');await document.fonts.load('500 30px "IBM Plex Mono"');await document.fonts.ready})()`, awaitPromise: true })
  const shot = async (t, fmt = 'jpeg') => {
    await send('Runtime.evaluate', { expression: `seek(${t})` })
    const r = await send('Page.captureScreenshot', fmt === 'png' ? { format: 'png' } : { format: 'jpeg', quality: 94 })
    return Buffer.from(r.data, 'base64')
  }
  const close = () => { try { ws.close() } catch {} ch.kill(); try { rmSync(profile, { recursive: true, force: true }) } catch {} }
  return { shot, close }
}

function vtt() {
  const cues = ['WEBVTT', '', 'NOTE Tacet film — generated by design/film/render.mjs from the voiceover file', '']
  const ts = (s) => { const ms = Math.round(s * 1000); const f = (n, w = 2) => String(n).padStart(w, '0'); return `${f(Math.floor(ms / 3600000))}:${f(Math.floor(ms / 60000) % 60)}:${f(Math.floor(ms / 1000) % 60)}.${f(ms % 1000, 3)}` }
  const wrap = (t, max = TECH ? 56 : 42) => { const o = []; let l = ''; for (const w of t.split(' ')) { if (l && (l + ' ' + w).length > max) { o.push(l); l = w } else l = l ? l + ' ' + w : w } if (l) o.push(l); return o }
  vo.forEach((raw, i) => {
    const m = raw.match(/^\s*\d+:\d+\s+(.*)$/); let body = m[1]
    const sp = body.match(/^\(([^)]+)\)\s*(.*)$/); const who = sp ? sp[1] : ''; body = (sp ? sp[2] : body).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
    const dur = durations[i]; const start = LINES[i], end = Math.min(start + dur + 0.25, i + 1 < LINES.length ? LINES[i + 1] : DUR)
    const text = (who ? who + ': ' : '') + body
    const lines = wrap(text); const groups = []; for (let k = 0; k < lines.length; k += 2) groups.push(lines.slice(k, k + 2))
    const wts = groups.map((g) => g.join(' ').length), tot = wts.reduce((a, b) => a + b, 0); let t = start
    groups.forEach((g, gi) => { const e = gi === groups.length - 1 ? end : t + ((end - start) * wts[gi]) / tot; cues.push(`${ts(t)} --> ${ts(e)}`, ...g, ''); t = e })
  })
  writeFileSync(join(OUT, `${TECH ? 'tech' : 'film'}${SFX}.vtt`), cues.join('\n'))
}
function probe(f) { if (!existsSync(f)) return 0; const r = spawnSync(FFMPEG, ['-i', f], { encoding: 'utf8' }); const m = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/); return +m[1] * 3600 + +m[2] * 60 + +m[3] }
const VO = TECH && !flag('vo', false) ? join(OUT, 'tech_vo_fast') : flag('vo', false) && flag('vo') !== true ? resolve(String(flag('vo'))) : join(ROOT, 'design/video/out/vo')
const durations = vo.map((_, i) => probe(join(VO, String(i + 1).padStart(2, '0') + '.mp3')))
durations.forEach((d, i) => { const next = LINES[i + 1] ?? DUR; if (LINES[i] + d > next + 0.001) console.warn(`overlap: line ${i + 1} ends ${LINES[i] + d} > next start ${next}`) })

async function main() {
  // captions are timed from the voice files: never rewrite them from missing clips, nor for stills / sheet / silent renders
  const haveVo = durations.every((d) => d > 0)
  if (haveVo && !flag('stills') && !flag('sheet') && !flag('video-only') && !flag('keep-vtt')) vtt()
  else if (!flag('stills') && !flag('sheet')) console.log(`vtt untouched (${haveVo ? 'asked' : 'voice clips missing in ' + VO})`)
  if (flag('stills')) {
    const b = await launch(); mkdirSync(join(OUT, 'stills'), { recursive: true })
    for (const t of String(flag('stills')).split(',')) writeFileSync(join(OUT, 'stills', `t${t}.png`), await b.shot(Number(t), 'png'))
    b.close(); return
  }
  if (flag('sheet')) {
    const b = await launch(); const d = join(OUT, 'sheet'); mkdirSync(d, { recursive: true }); let n = 0
    for (let t = 1.5; t < DUR; t += 3) writeFileSync(join(d, `f${String(n++).padStart(3, '0')}.jpg`), await b.shot(t))
    b.close()
    spawnSync(FFMPEG, ['-y', '-framerate', '1', '-i', join(d, 'f%03d.jpg'), '-vf', 'scale=640:-1,tile=4x' + Math.ceil(DUR / 3 / 4) + ':padding=6:color=0x888888', '-frames:v', '1', join(OUT, TECH ? 'tech-contact.jpg' : 'contact.jpg')])
    return
  }
  const silent = join(OUT, TECH ? 'tech-silent.mp4' : 'silent.mp4')
  if (!flag('no-video')) {
    const b = await launch()
    const ff = spawn(FFMPEG, ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-vf', `scale=${OW}:${OH}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-maxrate', '1300k', '-bufsize', '2600k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { stdio: ['pipe', 'ignore', 'inherit'] })
    const N = Math.round(DUR * FPS)
    for (let f = 0; f < N; f++) { const buf = await b.shot(f / FPS); if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r)); if (f % 150 === 0) console.log(`frame ${f}/${N}`) }
    ff.stdin.end(); await new Promise((r) => ff.on('close', r)); b.close()
    if (flag('video-only')) { console.log(`done: ${silent}`); return }
  }
  if (!haveVo) { console.error(`no audio mix: voice clips missing in ${VO} (use --video-only, or --vo <dir>)`); process.exit(1) }
  // audio mix
  const inputs = ['-i', silent]; const filt = []; const labels = []
  vo.forEach((_, i) => { inputs.push('-i', join(VO, String(i + 1).padStart(2, '0') + '.mp3')); const ms = Math.round(LINES[i] * 1000); filt.push(`[${i + 1}:a]adelay=${ms}|${ms},volume=1.0[v${i}]`); labels.push(`[v${i}]`) })
  filt.push(`${labels.join('')}amix=inputs=${vo.length}:normalize=0:dropout_transition=0[vo]`)
  let last = '[vo]'
  let SFXN = 0
  const music = flag('music', existsSync(join(OUT, 'music.mp3')) ? join(OUT, 'music.mp3') : null)
  if (TECH && existsSync(join(OUT, 'tech_sfx/sfx.json'))) {
    const sfx = JSON.parse(readFileSync(join(OUT, 'tech_sfx/sfx.json'), 'utf8'))
    SFXN = sfx.length; sfx.forEach((x, i) => { inputs.push('-i', join(OUT, 'tech_sfx', x.file)); const k = vo.length + 1 + i; const ms = Math.round(x.t * 1000); filt.push(`[${k}:a]adelay=${ms}|${ms},volume=${x.vol}[s${i}]`) })
    filt.push(`${sfx.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sfx.length}:normalize=0:dropout_transition=0[sfx]`)
  }
  if (music && music !== true) {
    inputs.push('-i', music); const mi = vo.length + 1 + SFXN
    filt.push(`[${mi}:a]atrim=0:${DUR},afade=t=in:d=3,afade=t=out:st=${DUR - 4}:d=4,volume=0.16[mus]`)
    filt.push(`[vo]asplit=2[vo1][vo2]`)
    filt.push(`[mus][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=600[duck]`)
    filt.push(`[duck][vo2]amix=inputs=2:normalize=0[mix]`); last = '[mix]'
  }
  if (TECH && filt.some((f) => f.endsWith('[sfx]'))) { filt.push(`${last}[sfx]amix=inputs=2:normalize=0:duration=first[mx2]`); last = '[mx2]' }
  filt.push(`${last}apad,atrim=0:${DUR},loudnorm=I=-16:TP=${TECH ? -2.4 : -2.5}:LRA=9[a]`)
  const r = spawnSync(FFMPEG, ['-y', ...inputs, '-filter_complex', filt.join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-b:a', '128k', '-t', String(DUR), '-movflags', '+faststart', join(OUT, `${TECH ? 'tech' : 'film'}${SFX}.mp4`)], { stdio: 'inherit' })
  if (r.status) process.exit(r.status)
  console.log(`done: out/${TECH ? 'tech' : 'film'}${SFX}.mp4`)
}
main().catch((e) => { console.error(e); process.exit(1) })
