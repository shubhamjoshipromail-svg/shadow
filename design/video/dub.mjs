#!/usr/bin/env node
/**
 * dub.mjs — make the German version of the film with ElevenLabs Dubbing.
 *
 * Flow (all against https://api.elevenlabs.io/v1):
 *   1. POST /dubbing            multipart upload of out/film.mp4 with
 *                               target_lang=de, source_lang=en, num_speakers=3, watermark=false
 *   2. GET  /dubbing/{id}       poll until status is `dubbed` (or fail on `failed`)
 *   3. GET  /dubbing/{id}/audio/de  download the German audio → out/film.de.mp4. If the endpoint
 *                               returns a video stream it is written straight through; if it returns
 *                               audio only, the dubbed track is muxed over the original video with the
 *                               local ffmpeg-static (video copied, audio re-encoded to AAC).
 *   4. GET  /dubbing/{id}/transcript/de?format_type=webvtt  → out/film.de.vtt when the API returns it.
 *                               When it does not, the English out/film.vtt is left in place and the
 *                               script says so: **cue text is never translated locally**.
 *
 * Credentials: ELEVENLABS_API_KEY is read from the environment at run time, used only in the
 * `xi-api-key` header, and never printed or written to disk. Every request has a timeout and every
 * failure names the step that failed.
 *
 * This script spends ElevenLabs credits, so run it deliberately. `--dry-run` needs no key and no
 * network. `--id <dubbing_id>` resumes a job without re-uploading (cheap if a previous run timed out
 * while polling).
 *
 * Usage (from the repo root):
 *   node design/video/dub.mjs --dry-run
 *   ELEVENLABS_API_KEY=… node design/video/dub.mjs
 *   ELEVENLABS_API_KEY=… node design/video/dub.mjs --id abc123        # resume polling
 *   ELEVENLABS_API_KEY=… node design/video/dub.mjs --no-transcript    # audio/video only
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULTS = {
  api: 'https://api.elevenlabs.io/v1',
  film: join(DIR, 'out', 'film.mp4'),
  out: join(DIR, 'out', 'film.de.mp4'),
  vtt: join(DIR, 'out', 'film.de.vtt'),
  englishVtt: join(DIR, 'out', 'film.vtt'),
  targetLang: 'de',
  sourceLang: 'en',
  numSpeakers: 3,
  watermark: false,
  name: 'Tacet — product film',
  timeout: 1800,        // overall polling budget, seconds
  poll: 5,              // seconds between status checks
  requestTimeout: 300,  // per-request timeout, seconds
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const eq = a.indexOf('=')
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (eq >= 0) out[key] = a.slice(eq + 1)
    else if (['dryRun', 'noTranscript', 'watermark', 'help'].includes(key)) out[key] = true
    else out[key] = argv[++i]
  }
  return out
}

const ARGS = parseArgs(process.argv.slice(2))

if (ARGS.help) {
  console.log(`Usage: node design/video/dub.mjs [options]
  --film <path>          source film (default design/video/out/film.mp4)
  --out <path>           German video (default design/video/out/film.de.mp4)
  --vtt <path>           German subtitles (default design/video/out/film.de.vtt)
  --target-lang <code>   language to dub into (default ${DEFAULTS.targetLang})
  --source-lang <code>   language of the source (default ${DEFAULTS.sourceLang})
  --num-speakers <n>     speaker count for the dub (default ${DEFAULTS.numSpeakers})
  --name <string>        dubbing name shown in the ElevenLabs UI
  --watermark            request the ElevenLabs watermark (default off)
  --id <dubbing_id>      resume an existing job; skips the upload
  --timeout <sec>        overall poll timeout (default ${DEFAULTS.timeout})
  --poll <sec>           seconds between status checks (default ${DEFAULTS.poll})
  --request-timeout <sec>  timeout per HTTP request (default ${DEFAULTS.requestTimeout})
  --no-transcript        skip the German transcript (leave the English VTT as-is)
  --dry-run              print the plan; no key, no network
  --help

ELEVENLABS_API_KEY must be set in the environment for a real run; it is never printed or saved.`)
  process.exit(0)
}

const config = {
  api: String(ARGS.api || DEFAULTS.api).replace(/\/$/, ''),
  film: resolve(ARGS.film || DEFAULTS.film),
  out: resolve(ARGS.out || DEFAULTS.out),
  vtt: resolve(ARGS.vtt || DEFAULTS.vtt),
  englishVtt: resolve(ARGS.englishVtt || DEFAULTS.englishVtt),
  targetLang: String(ARGS.targetLang || DEFAULTS.targetLang),
  sourceLang: String(ARGS.sourceLang || DEFAULTS.sourceLang),
  numSpeakers: Number(ARGS.numSpeakers ?? DEFAULTS.numSpeakers),
  watermark: ARGS.watermark === true || ARGS.watermark === 'true',
  name: String(ARGS.name || DEFAULTS.name),
  timeout: Number(ARGS.timeout ?? DEFAULTS.timeout),
  poll: Number(ARGS.poll ?? DEFAULTS.poll),
  requestTimeout: Number(ARGS.requestTimeout ?? DEFAULTS.requestTimeout),
  id: ARGS.id ? String(ARGS.id) : null,
  noTranscript: !!ARGS.noTranscript,
}

function fail(msg) { console.error(`dub.mjs: ${msg}`); process.exit(1) }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
const mb = (bytes) => (bytes / 1_000_000).toFixed(2)

if (ARGS.dryRun) {
  const filmState = existsSync(config.film) ? `${mb(statSync(config.film).size)} MB` : 'MISSING — assemble first'
  console.log(`dub.mjs — dry run (no key, no network)`)
  console.log(`  source          ${config.film}  (${filmState})`)
  console.log(`  target          ${config.out}`)
  console.log(`  subtitles       ${config.vtt}  (English fallback: ${config.englishVtt})`)
  console.log(`  POST            ${config.api}/dubbing  target_lang=${config.targetLang} source_lang=${config.sourceLang} num_speakers=${config.numSpeakers} watermark=${config.watermark}`)
  console.log(`  poll            GET ${config.api}/dubbing/{id}  every ${config.poll}s, up to ${config.timeout}s`)
  console.log(`  download        GET ${config.api}/dubbing/{id}/audio/${config.targetLang}  → ${config.out}`)
  if (config.id) console.log(`  resume          existing dubbing id ${config.id} (upload skipped)`)
  if (config.noTranscript) console.log(`  transcript      skipped (--no-transcript); English VTT left in place`)
  else console.log(`  transcript      GET ${config.api}/dubbing/{id}/transcript/${config.targetLang}?format_type=webvtt  → ${config.vtt} if available`)
  console.log(`  on no transcript  ${config.englishVtt} is left in place; cue text is never translated locally`)
  process.exit(0)
}

const KEY = process.env.ELEVENLABS_API_KEY
if (!KEY) fail('ELEVENLABS_API_KEY is not set in the environment (never pass it on the command line; export it).')

/** fetch with a hard timeout; the key stays in the header and is never logged. */
async function request(url, init, label) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.requestTimeout * 1000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${label} timed out after ${config.requestTimeout}s`)
    throw new Error(`${label} failed: ${e.message}`)
  } finally {
    clearTimeout(timer)
  }
}

/** POST /v1/dubbing — multipart upload; returns the dubbing id. */
async function createDub() {
  if (!existsSync(config.film)) fail(`missing ${config.film} — build the film first (assemble.mjs)`)
  const buf = readFileSync(config.film)
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'video/mp4' }), 'film.mp4')
  form.append('name', config.name)
  form.append('source_lang', config.sourceLang)
  form.append('target_lang', config.targetLang)
  form.append('num_speakers', String(config.numSpeakers))
  form.append('watermark', String(config.watermark))
  const res = await request(`${config.api}/dubbing`, { method: 'POST', headers: { 'xi-api-key': KEY }, body: form }, 'POST /v1/dubbing')
  const text = await res.text()
  if (!res.ok) throw new Error(`POST /v1/dubbing → ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ''}`)
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`POST /v1/dubbing returned non-JSON: ${text.slice(0, 200)}`) }
  const id = json.dubbing_id || json.id
  if (!id) throw new Error(`POST /v1/dubbing returned no dubbing_id: ${text.slice(0, 200)}`)
  console.log(`  uploaded ${config.film} (${mb(buf.length)} MB) → dubbing ${id}${json.expected_duration_sec ? ` (expected ~${Math.round(json.expected_duration_sec)}s)` : ''}`)
  return id
}

/** GET /v1/dubbing/{id} until the dub is ready; throws on failure or timeout. */
async function waitForDubbed(id) {
  const start = Date.now()
  let last = ''
  for (;;) {
    const res = await request(`${config.api}/dubbing/${id}`, { headers: { 'xi-api-key': KEY } }, `GET /v1/dubbing/${id}`)
    const text = await res.text()
    if (!res.ok) throw new Error(`GET /v1/dubbing/${id} → ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`)
    let json = {}
    try { json = JSON.parse(text) } catch { /* keep polling on an odd body */ }
    const status = String(json.status || '')
    if (status !== last) { console.log(`  dubbing ${id}: ${status || 'unknown'}`); last = status }
    if (status === 'dubbed') return json
    if (status === 'failed') throw new Error(`dubbing ${id} failed${json.error ? `: ${json.error}` : ''}`)
    if (Date.now() - start > config.timeout * 1000) {
      throw new Error(`dubbing ${id} did not finish within ${config.timeout}s (last status: ${last || 'unknown'}) — resume with --id ${id}`)
    }
    await sleep(config.poll * 1000)
  }
}

/** GET /v1/dubbing/{id}/audio/{lang}; returns the downloaded file and its content type. */
async function downloadAudio(id) {
  const url = `${config.api}/dubbing/${id}/audio/${config.targetLang}`
  const res = await request(url, { headers: { 'xi-api-key': KEY } }, `GET /v1/dubbing/${id}/audio/${config.targetLang}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GET /v1/dubbing/${id}/audio/${config.targetLang} → ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) throw new Error('the dubbed-audio download was empty')
  const download = `${config.out}.download`
  writeFileSync(download, buf)
  return { download, contentType: (res.headers.get('content-type') || '').toLowerCase(), bytes: buf.length }
}

let ffmpegBin = null
async function loadFfmpeg() {
  if (ffmpegBin) return ffmpegBin
  try { ffmpegBin = (await import('ffmpeg-static')).default } catch { ffmpegBin = null }
  if (!ffmpegBin || !existsSync(ffmpegBin)) fail('ffmpeg-static is not installed. Run: cd design/video && npm install')
  return ffmpegBin
}

function ffmpeg(bin, args, { label = 'ffmpeg' } = {}) {
  return new Promise((pass, failRun) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000) })
    child.on('error', (e) => failRun(new Error(`${label}: ${e.message}`)))
    child.on('close', (code) => {
      if (code === 0) return pass()
      failRun(new Error(`${label}: ffmpeg exited ${code}\n${err.trim().split('\n').slice(-8).join('\n')}`))
    })
  })
}

/** Write the German video. A video stream goes straight through; audio-only is muxed over the source. */
async function writeGermanVideo(download) {
  mkdirSync(dirname(config.out), { recursive: true })
  if (download.contentType.startsWith('video/')) {
    renameSync(download.download, config.out)
    return { mode: `dubbed video (${download.contentType})` }
  }
  const bin = await loadFfmpeg()
  const tmpOut = `${config.out}.tmp.mp4`
  await ffmpeg(bin, [
    '-y', '-loglevel', 'error',
    '-i', config.film,
    '-i', download.download,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-shortest',
    tmpOut,
  ], { label: 'mux the German audio over the film' })
  renameSync(tmpOut, config.out)
  rmSync(download.download, { force: true })
  return { mode: `dubbed audio muxed over the original video (${download.contentType || 'unknown type'})` }
}

/** "HH:MM:SS.mmm" / "MM:SS" / seconds -> seconds. */
function toSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  if (!value.includes(':')) { const n = Number(value); return Number.isFinite(n) ? n : null }
  const parts = value.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  return parts.reduce((n, p) => n * 60 + p, 0)
}

function stamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

/** Build WebVTT from the API's transcript array (its own German text, never our translation). */
function transcriptToVtt(cues) {
  const blocks = ['WEBVTT', '', 'NOTE Tacet product film — German transcript from ElevenLabs Dubbing', '']
  let n = 0
  for (const cue of cues) {
    const text = String(cue.text ?? cue.transcript ?? '').replace(/\s+/g, ' ').trim()
    const start = toSeconds(cue.start ?? cue.start_time ?? cue.startTime)
    const end = toSeconds(cue.end ?? cue.end_time ?? cue.endTime)
    if (!text || start == null || end == null || end <= start) continue
    blocks.push(`${stamp(start)} --> ${stamp(end)}`, text, '')
    n++
  }
  return n ? blocks.join('\n') : null
}

/** GET the German transcript if the API has one; never invent or translate cue text. */
async function fetchTranscript(id) {
  const url = `${config.api}/dubbing/${id}/transcript/${config.targetLang}?format_type=webvtt`
  const res = await request(url, { headers: { 'xi-api-key': KEY } }, `GET /v1/dubbing/${id}/transcript/${config.targetLang}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, reason: `transcript endpoint returned ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 160)}` : ''}` }
  }
  const body = await res.text()
  if (body.trimStart().toUpperCase().startsWith('WEBVTT')) return { ok: true, vtt: body }
  let json = null
  try { json = JSON.parse(body) } catch { /* not JSON */ }
  if (json) {
    if (typeof json.webvtt === 'string' && json.webvtt.trim()) return { ok: true, vtt: json.webvtt }
    if (typeof json.vtt === 'string' && json.vtt.trim()) return { ok: true, vtt: json.vtt }
    const cues = json.transcript || json.cues || json.segments
    if (Array.isArray(cues)) {
      const vtt = transcriptToVtt(cues)
      if (vtt) return { ok: true, vtt }
    }
  }
  return { ok: false, reason: 'the transcript endpoint returned neither WebVTT nor a timed transcript' }
}

// --------------------------------------------------------------------------- main
try {
  console.log(`dub.mjs — ${config.sourceLang} → ${config.targetLang} · ${config.film}`)
  let id = config.id
  if (id) console.log(`  resuming dubbing ${id} (upload skipped)`)
  else id = await createDub()

  await waitForDubbed(id)

  const download = await downloadAudio(id)
  const written = await writeGermanVideo(download)
  console.log(`  wrote ${config.out} (${mb(statSync(config.out).size)} MB) — ${written.mode}`)

  if (config.noTranscript) {
    console.log(`  transcript: skipped (--no-transcript); left ${existsSync(config.englishVtt) ? config.englishVtt : 'the English subtitles'} in place — cue text was NOT translated locally`)
  } else {
    const transcript = await fetchTranscript(id)
    if (transcript.ok) {
      writeFileSync(config.vtt, transcript.vtt.endsWith('\n') ? transcript.vtt : `${transcript.vtt}\n`)
      console.log(`  transcript: wrote ${config.vtt}`)
    } else {
      console.log(`  transcript: unavailable (${transcript.reason})`)
      console.log(existsSync(config.englishVtt)
        ? `  left the English subtitles in place: ${config.englishVtt} — cue text was NOT translated locally`
        : '  no English out/film.vtt either; nothing was written — cue text was NOT translated locally')
      process.exitCode = 2 // the film exists; only the German subtitles are missing
    }
  }

  console.log(`dub.mjs: done (dubbing ${id})`)
} catch (e) {
  fail(e.message)
}
