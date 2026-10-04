#!/usr/bin/env node
/**
 * tts.mjs — render one ElevenLabs mp3 per voiceover line into out/vo/.
 *
 * Credentials: ELEVENLABS_API_KEY is read from the environment at run time. It is never printed, never
 * logged and never written to disk — the only place it is used is the `xi-api-key` request header.
 *
 * assemble.mjs places these files at the voiceover timestamps and works fine when they are absent, so
 * this step is optional. Do not run it casually: it spends TTS credits. `--dry-run` lists the plan and
 * calls nothing.
 *
 * Model: `eleven_v3` by default, because it performs the inline audio tags in voiceover.txt
 * (`[warmly]`, `[curious]`, …). Override with `--model`. The tags are sent to the API and stripped by
 * make_vtt.mjs for the captions. One voice per speaker: Mira, Sabine, and the narrator.
 *
 * Usage (from the repo root):
 *   node design/video/tts.mjs --dry-run
 *   ELEVENLABS_API_KEY=… node design/video/tts.mjs
 *   ELEVENLABS_API_KEY=… node design/video/tts.mjs --line 4 --force
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULTS = {
  voiceover: join(DIR, 'voiceover.txt'),
  outDir: join(DIR, 'out', 'vo'),
  voice: 'cgSgspJ2msm6clMCkdW9',
  model: 'eleven_v3',
  stability: 0.4,
  similarity: 0.8,
  api: 'https://api.elevenlabs.io/v1/text-to-speech',
  perLineDelayMs: 350,
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const eq = a.indexOf('=')
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (eq >= 0) out[key] = a.slice(eq + 1)
    else if (['dryRun', 'force', 'list', 'help'].includes(key)) out[key] = true
    else out[key] = argv[++i]
  }
  return out
}

const ARGS = parseArgs(process.argv.slice(2))

if (ARGS.help) {
  console.log(`Usage: node design/video/tts.mjs [options]
  --voiceover <path>   narration source (default design/video/voiceover.txt)
  --out-dir <dir>      mp3 destination (default design/video/out/vo)
  --voice <id>         ElevenLabs voice id (default ${DEFAULTS.voice})
  --model <id>         model id (default ${DEFAULTS.model})
  --stability <n>      voice stability (default ${DEFAULTS.stability})
  --similarity <n>     similarity boost (default ${DEFAULTS.similarity})
  --line <n>           render only the n-th voiceover line (1-based)
  --force              re-render files that already exist
  --dry-run            print the plan; no key, no network, no files
  --list               list the lines and their target files, then exit
  --help

ELEVENLABS_API_KEY must be set in the environment for a real run; it is never printed or saved.`)
  process.exit(0)
}

const config = {
  voiceover: resolve(ARGS.voiceover || DEFAULTS.voiceover),
  outDir: resolve(ARGS.outDir || DEFAULTS.outDir),
  voice: String(ARGS.voice || DEFAULTS.voice),
  model: String(ARGS.model || DEFAULTS.model),
  stability: Number(ARGS.stability || DEFAULTS.stability),
  similarity: Number(ARGS.similarity || DEFAULTS.similarity),
  line: ARGS.line ? Number(ARGS.line) : null,
  perLineDelayMs: Number(ARGS.perLineDelayMs ?? DEFAULTS.perLineDelayMs),
  force: !!ARGS.force,
}

function toSeconds(stamp) {
  return String(stamp).split(':').map(Number).reduce((n, p) => n * 60 + p, 0)
}

/** "MM:SS (Speaker) Text" -> { start, speaker, text, file }. */
function parseVoiceover(raw) {
  const lines = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const m = rawLine.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+?)\s*$/)
    if (!m) continue
    const spk = m[2].match(/^\(([^)]+)\)\s*(.*)$/)
    lines.push({
      start: toSeconds(m[1]),
      speaker: spk ? spk[1].trim() : '',
      text: (spk ? spk[2] : m[2]).trim(),
    })
  }
  return lines.map((l, i) => ({ ...l, index: i + 1, file: join(config.outDir, `${String(i + 1).padStart(2, '0')}.mp3`) }))
}

const lines = (() => {
  if (!existsSync(config.voiceover)) {
    console.error(`tts.mjs: missing ${config.voiceover}`)
    process.exit(1)
  }
  const all = parseVoiceover(readFileSync(config.voiceover, 'utf8'))
  if (!all.length) {
    console.error(`tts.mjs: no "MM:SS Text" lines in ${config.voiceover}`)
    process.exit(1)
  }
  if (!config.line) return all
  const chosen = all.filter((l) => l.index === config.line)
  if (!chosen.length) {
    console.error(`tts.mjs: --line ${config.line} is out of range (1..${all.length})`)
    process.exit(1)
  }
  return chosen
})()

const mb = (s) => s.toFixed(2)

// One voice per speaker: Mira (the companion), Sabine (the expert), and the narrator. `--voice` forces
// a single voice for every line instead.
const SPEAKER_VOICES = { mira: 'cgSgspJ2msm6clMCkdW9', sabine: 'XrExE9yKIg1WjnnlVkGX', '': 'hpp4J3VqNfWAUOO0d1Us' }
const voiceFor = (line) => (ARGS.voice ? config.voice : SPEAKER_VOICES[(line.speaker || '').toLowerCase()] || config.voice)

if (ARGS.list || ARGS.dryRun) {
  console.log(`tts.mjs — ${lines.length} line(s) · model ${config.model}${ARGS.voice ? ` · voice ${config.voice} (forced)` : ' · voices Mira/Sabine/narrator'}`)
  for (const l of lines) {
    const state = existsSync(l.file) ? 'exists' : 'to render'
    console.log(`  ${String(l.index).padStart(2, '0')}  ${new Date(l.start * 1000).toISOString().slice(14, 19)}  ${state.padEnd(9)}  ${l.file.replace(DIR + '/', '')}  ${voiceFor(l)}  “${l.text}”`)
  }
}

if (ARGS.list || ARGS.dryRun) process.exit(0)

const apiKey = process.env.ELEVENLABS_API_KEY
if (!apiKey) {
  console.error('tts.mjs: ELEVENLABS_API_KEY is not set in the environment (never pass it on the command line; export it).')
  process.exit(1)
}

mkdirSync(config.outDir, { recursive: true })

async function synthOne(line) {
  const tmp = `${line.file}.part`
  const body = {
    text: line.text,
    model_id: config.model,
    voice_settings: { stability: config.stability, similarity_boost: config.similarity },
  }
  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${DEFAULTS.api}/${encodeURIComponent(voiceFor(line))}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey, // kept in memory only; never logged or written
          accept: 'audio/mpeg',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        lastError = `${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`
        if (res.status === 429 || res.status >= 500) { await sleep(1500 * attempt); continue }
        break
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (!buf.length) { lastError = 'empty audio response'; await sleep(1000 * attempt); continue }
      writeFileSync(tmp, buf)
      renameSync(tmp, line.file)
      return buf.length
    } catch (e) {
      lastError = e.message
      await sleep(1500 * attempt)
    } finally {
      try { rmSync(tmp, { force: true }) } catch {}
    }
  }
  throw new Error(`line ${line.index} failed: ${lastError}`)
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let done = 0
for (const line of lines) {
  if (existsSync(line.file) && !config.force) {
    console.log(`  ${String(line.index).padStart(2, '0')}  skip (exists)  ${line.file.replace(DIR + '/', '')}`)
    continue
  }
  const bytes = await synthOne(line)
  done++
  console.log(`  ${String(line.index).padStart(2, '0')}  ✓  ${line.file.replace(DIR + '/', '')}  (${mb(bytes / 1024)} KB)`)
  if (config.perLineDelayMs) await sleep(config.perLineDelayMs)
}
console.log(`tts.mjs: ${done} file(s) written to ${config.outDir}`)
