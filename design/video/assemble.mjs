#!/usr/bin/env node
/**
 * assemble.mjs — build out/film.mp4 (1600×900, H.264, ≤ 8 MB) + out/poster.jpg from the recorded frames.
 *
 * Pipeline shape:
 *   1. read frames/manifest.json (written by record.mjs) and lay every shot on its storyboard timeline;
 *   2. render one 1600×900 clip per shot — a gentle Ken-Burns push or pull, alternating by shot;
 *   3. crossfade the clips at the storyboard shot boundaries (offset = the shot's `in` time, so the
 *      timeline never drifts), trim to the film length;
 *   4. lay out/vo/NN.mp3 at the voiceover.txt timestamps (mixed over a silent base). No mp3s? The film
 *      is still built, with a silent audio track;
 *   5. encode H.264 + AAC, shrink the CRF until the file is under --max-bytes, then write poster.jpg
 *      from the hero shot.
 *
 * Requires `ffmpeg-static`, installed locally in design/video:
 *     cd design/video && npm install
 *
 * Usage (from the repo root):
 *   node design/video/assemble.mjs
 *   node design/video/assemble.mjs --dry-run
 *   node design/video/assemble.mjs --frames design/video/frames --crf 24 --max-bytes 8000000
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULTS = {
  frames: join(DIR, 'frames'),
  out: join(DIR, 'out'),
  voiceover: join(DIR, 'voiceover.txt'),
  voDir: join(DIR, 'out', 'vo'),
  width: 1600,
  height: 900,
  fps: 25,
  crossfade: 0.5,       // seconds at each shot boundary
  zoom: 0.08,           // total Ken-Burns travel (fraction of frame)
  crf: 23,
  maxRate: '700k',
  audioBitrate: '96k',
  maxBytes: 8_000_000,  // "≤ 8 MB"
  posterShot: 'S2.1',
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const eq = a.indexOf('=')
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (eq >= 0) out[key] = a.slice(eq + 1)
    else if (['dryRun', 'noVo', 'noPoster', 'keepTmp', 'help'].includes(key)) out[key] = true
    else out[key] = argv[++i]
  }
  return out
}

const ARGS = parseArgs(process.argv.slice(2))

if (ARGS.help) {
  console.log(`Usage: node design/video/assemble.mjs [options]
  --frames <dir>       directory with manifest.json + PNGs (default design/video/frames)
  --out <dir>          output directory for film.mp4 + poster.jpg (default design/video/out)
  --voiceover <path>   narration source for VO timestamps (default design/video/voiceover.txt)
  --vo-dir <dir>       mp3 directory (default design/video/out/vo)
  --width --height     output size (default ${DEFAULTS.width}x${DEFAULTS.height})
  --fps <n>            frame rate (default ${DEFAULTS.fps})
  --crossfade <sec>    crossfade at each shot boundary (default ${DEFAULTS.crossfade})
  --zoom <fraction>    Ken-Burns travel per shot (default ${DEFAULTS.zoom})
  --crf <n>            starting x264 CRF (default ${DEFAULTS.crf})
  --max-rate <rate>    x264 VBV max bitrate (default ${DEFAULTS.maxRate})
  --max-bytes <n>      hard size ceiling (default ${DEFAULTS.maxBytes})
  --poster-shot <id>   shot used for poster.jpg (default ${DEFAULTS.posterShot})
  --no-vo              ignore out/vo even if the mp3s exist
  --no-poster          skip poster.jpg
  --keep-tmp           keep the per-shot clips in <out>/tmp
  --dry-run            print the plan; render nothing
  --help`)
  process.exit(0)
}

const config = {
  frames: resolve(ARGS.frames || DEFAULTS.frames),
  out: resolve(ARGS.out || DEFAULTS.out),
  voiceover: resolve(ARGS.voiceover || DEFAULTS.voiceover),
  voDir: resolve(ARGS.voDir || DEFAULTS.voDir),
  width: Number(ARGS.width || DEFAULTS.width),
  height: Number(ARGS.height || DEFAULTS.height),
  fps: Number(ARGS.fps || DEFAULTS.fps),
  crossfade: Number(ARGS.crossfade ?? DEFAULTS.crossfade),
  zoom: Number(ARGS.zoom ?? DEFAULTS.zoom),
  crf: Number(ARGS.crf || DEFAULTS.crf),
  maxRate: String(ARGS.maxRate || DEFAULTS.maxRate),
  audioBitrate: String(ARGS.audioBitrate || DEFAULTS.audioBitrate),
  maxBytes: Number(ARGS.maxBytes || DEFAULTS.maxBytes),
  posterShot: String(ARGS.posterShot || DEFAULTS.posterShot),
  noVo: !!ARGS.noVo,
  noPoster: !!ARGS.noPoster,
  keepTmp: !!ARGS.keepTmp,
}

function fail(msg) { console.error(`assemble.mjs: ${msg}`); process.exit(1) }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function timecode(t) {
  const s = Math.floor(t % 60)
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
const mb = (bytes) => (bytes / 1_000_000).toFixed(2)

/** Run ffmpeg, capture stderr, throw with the tail on failure. */
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

function parseVoiceover(raw) {
  const lines = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const m = rawLine.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+?)\s*$/)
    if (!m) continue
    const start = m[1].split(':').map(Number).reduce((n, p) => n * 60 + p, 0)
    const spk = m[2].match(/^\(([^)]+)\)\s*(.*)$/)
    lines.push({ start, speaker: spk ? spk[1].trim() : '', text: (spk ? spk[2] : m[2]).trim() })
  }
  return lines
}

// --------------------------------------------------------------------------- plan
const manifestPath = join(config.frames, 'manifest.json')
if (!existsSync(manifestPath)) fail(`missing ${manifestPath} — run record.mjs first (or pass --frames)`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!Array.isArray(manifest.shots) || !manifest.shots.length) fail(`${manifestPath} has no shots`)

const shots = manifest.shots.slice().sort((a, b) => a.in - b.in)
const total = Math.max(...shots.map((s) => Number(s.out) || 0))
if (!(total > 0)) fail('could not derive a film length from manifest shot timings')

// Source image per shot: its own frame, else hold the most recent one (so a missing sealed-test insert
// does not shorten the film or shift every later timestamp).
let last = null
for (const s of shots) {
  const own = s.file && existsSync(s.file) ? s.file : null
  if (own) last = own
  s._own = own
  s._source = own || last
}
const first = shots.find((s) => s._own)
if (!first) fail(`no frame PNGs found for ${manifestPath} (looked in ${config.frames})`)
for (const s of shots) if (!s._source) s._source = first._own
const held = shots.filter((s) => !s._own)
const hero = shots.find((s) => s.id === config.posterShot) || shots.find((s) => s._own)

const voiceover = existsSync(config.voiceover) ? parseVoiceover(readFileSync(config.voiceover, 'utf8')) : []
const voTracks = []
if (!config.noVo) {
  voiceover.forEach((line, i) => {
    const file = join(config.voDir, `${String(i + 1).padStart(2, '0')}.mp3`)
    if (existsSync(file)) voTracks.push({ ...line, file })
  })
}

if (ARGS.dryRun) {
  console.log(`assemble.mjs — dry run`)
  console.log(`  frames     ${config.frames}`)
  console.log(`  out        ${config.out}`)
  console.log(`  output     ${config.width}x${config.height} @${config.fps}fps  ≤ ${mb(config.maxBytes)} MB  (crossfade ${config.crossfade}s, KB ${config.zoom})`)
  console.log(`  film       ${timecode(total)} (${total}s) · ${shots.length} shots · ${held.length} held`)
  console.log(`  voiceover  ${voTracks.length}/${voiceover.length} mp3(s) in ${config.voDir}${config.noVo ? ' (--no-vo)' : ''}`)
  console.log(`  poster     ${config.noPoster ? 'skipped' : `${hero.id} → poster.jpg`}`)
  for (const s of shots) {
    const tag = s._own ? 'own' : `hold(${s._source.split('/').pop().slice(0, 18)}…)`
    console.log(`    ${s.id}  ${timecode(s.in)}–${timecode(s.out)}  ${tag}`)
  }
  process.exit(0)
}

// --------------------------------------------------------------------------- ffmpeg
let ffmpegPath
try {
  ffmpegPath = (await import('ffmpeg-static')).default
} catch {
  fail('ffmpeg-static is not installed. Run: cd design/video && npm install')
}
if (!ffmpegPath || !existsSync(ffmpegPath)) fail('ffmpeg-static did not provide a binary; run: cd design/video && npm install')

mkdirSync(config.out, { recursive: true })
const tmp = join(config.out, 'tmp')
if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

const W = config.width
const H = config.height
const FPS = config.fps
const CF = Math.max(0, Math.min(config.crossfade, 3))
const Z = Math.max(0, config.zoom)
const scratchW = Math.round(W * 1.5)
const scratchH = Math.round(H * 1.5)

console.log(`assemble.mjs — ${timecode(total)} · ${shots.length} shots (${held.length} held) · ${voTracks.length} VO track(s)`)

// 1. one clip per shot (duration = shot + crossfade headroom, so every xfade has a full tail)
const clips = []
for (let i = 0; i < shots.length; i++) {
  const s = shots[i]
  const D = Number(s.out) - Number(s.in)
  const frames = Math.max(2, Math.round((D + CF + 0.12) * FPS))
  const dur = frames / FPS
  const rate = (Z / frames).toFixed(7)
  // alternate push-in / pull-out so consecutive holds do not feel identical
  const zExpr = i % 2 === 0
    ? `min(1+${rate}*on,${(1 + Z).toFixed(4)})`
    : `max(${(1 + Z).toFixed(4)}-${rate}*on,1)`
  const vf = [
    `scale=${scratchW}:${scratchH}:force_original_aspect_ratio=increase`,
    `crop=${scratchW}:${scratchH}`,
    `zoompan=z='${zExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`,
    'setsar=1', 'format=yuv420p',
  ].join(',')
  const file = join(tmp, `${String(i).padStart(2, '0')}-${s.id}.mp4`)
  await ffmpeg(ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-t', dur.toFixed(3), '-i', s._source,
    '-vf', vf,
    '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-an', file,
  ], { label: `${s.id} clip` })
  clips.push(file)
  console.log(`  ${s.id}  ${timecode(s.in)}–${timecode(s.out)}  clip ✓  ${s._own ? '' : '(held frame)'}`)
}

// 2. crossfade the clips at the storyboard boundaries and mux the voiceover
const inputs = []
for (const clip of clips) inputs.push('-i', clip)
const baseIndex = clips.length
inputs.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000')
const voInputs = []
for (const track of voTracks) {
  voInputs.push({ ...track, index: baseIndex + 1 + voInputs.length })
  inputs.push('-i', track.file)
}

const filter = []
let prev = '0:v'
for (let k = 1; k < clips.length; k++) {
  const out = `x${k}`
  filter.push(`[${prev}][${k}:v]xfade=transition=fade:duration=${CF}:offset=${shots[k].in}[${out}]`)
  prev = out
}
filter.push(`[${prev}]format=yuv420p,trim=duration=${total},setpts=PTS-STARTPTS[vout]`)

if (voInputs.length) {
  filter.push(`[${baseIndex}:a]aresample=48000[abase]`)
  const labels = voInputs.map((t, i) => {
    filter.push(`[${t.index}:a]adelay=${Math.round(t.start * 1000)}:all=1,aresample=48000[a${i}]`)
    return `[a${i}]`
  })
  filter.push(`[abase]${labels.join('')}amix=inputs=${labels.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`)
} else {
  filter.push(`[${baseIndex}:a]aresample=48000[aout]`)
}

let attempt = 0
let crf = config.crf
let maxRate = config.maxRate
let filmPath = join(config.out, 'film.mp4')
let bytes = 0
for (;;) {
  attempt++
  await ffmpeg(ffmpegPath, [
    '-y', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', filter.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
    '-maxrate', maxRate, '-bufsize', '1600k',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
    '-c:a', 'aac', '-b:a', config.audioBitrate, '-ar', '48000',
    '-movflags', '+faststart',
    '-t', String(total),
    filmPath,
  ], { label: `film (crf ${crf})` })
  bytes = statSync(filmPath).size
  console.log(`  film pass ${attempt}: crf ${crf}, maxrate ${maxRate} → ${mb(bytes)} MB`)
  if (bytes <= config.maxBytes) break
  if (attempt >= 4) fail(`film is ${mb(bytes)} MB after ${attempt} passes (limit ${mb(config.maxBytes)} MB)`)
  crf = Math.min(30, crf + 3)
  if (crf >= 30) maxRate = '520k'
  await sleep(200)
}

// 3. poster from the hero shot
if (!config.noPoster) {
  if (!hero || !hero._source) fail('no hero frame for poster.jpg')
  const posterPath = join(config.out, 'poster.jpg')
  await ffmpeg(ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-i', hero._source,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
    '-frames:v', '1', '-q:v', '4',
    posterPath,
  ], { label: 'poster.jpg' })
  console.log(`  poster.jpg ← ${hero.id} (${mb(statSync(posterPath).size)} MB)`)
}

if (!config.keepTmp) rmSync(tmp, { recursive: true, force: true })

console.log(`assemble.mjs: wrote ${filmPath} (${mb(bytes)} MB)`)
if (voInputs.length) console.log(`  voiceover: ${voInputs.length} line(s) placed at their timestamps`)
else console.log('  voiceover: none — silent track (run tts.mjs, then assemble.mjs again)')
