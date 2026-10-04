#!/usr/bin/env node
/**
 * make_vtt.mjs — turn voiceover.txt into a WebVTT subtitle file (out/film.vtt).
 *
 * The film's captions are rendered by the page that plays film.mp4 (the landing parses this file and
 * paints the active cue in the design system), so this file is the single source of caption text.
 *
 *   voiceover.txt        one line per read: "MM:SS Text" (optionally "(Speaker) Text")
 *   out/film.vtt         WEBVTT cues, each ≤ MAX_LINE chars per line and ≤ MAX_LINES lines per cue;
 *                        a long line is split across consecutive cues inside its own time window.
 *
 * Timings come from voiceover.txt, not from the mp3s (assemble.mjs places the audio at the same
 * timestamps). A cue ends where the next one begins; the last cue ends at --film-seconds.
 *
 * Usage:
 *   node design/video/make_vtt.mjs
 *   node design/video/make_vtt.mjs --voiceover design/video/voiceover.txt --out design/video/out/film.vtt
 *   node design/video/make_vtt.mjs --dry-run
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULTS = {
  voiceover: join(DIR, 'voiceover.txt'),
  out: join(DIR, 'out', 'film.vtt'),
  filmSeconds: 75,
  maxLine: 42,
  maxLines: 2,
  speakers: true,
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) { out._.push(a); continue }
    const eq = a.indexOf('=')
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    if (eq >= 0) out[key] = a.slice(eq + 1)
    else if (['dryRun', 'noSpeakers', 'help'].includes(key)) out[key] = true
    else out[key] = argv[++i]
  }
  return out
}

const ARGS = parseArgs(process.argv.slice(2))

if (ARGS.help) {
  console.log(`Usage: node design/video/make_vtt.mjs [options]
  --voiceover <path>   narration source (default design/video/voiceover.txt)
  --out <path>         WebVTT output (default design/video/out/film.vtt)
  --film-seconds <n>   end of the last cue (default ${DEFAULTS.filmSeconds})
  --max-line <n>       max characters per caption line (default ${DEFAULTS.maxLine})
  --max-lines <n>      max lines per cue (default ${DEFAULTS.maxLines})
  --no-speakers        drop the "(Speaker)" prefixes instead of rendering "Speaker: text"
  --dry-run            print the cues, write nothing
  --help`)
  process.exit(0)
}

const config = {
  voiceover: resolve(ARGS.voiceover || DEFAULTS.voiceover),
  out: resolve(ARGS.out || DEFAULTS.out),
  filmSeconds: Number(ARGS.filmSeconds || DEFAULTS.filmSeconds),
  maxLine: Number(ARGS.maxLine || DEFAULTS.maxLine),
  maxLines: Number(ARGS.maxLines || DEFAULTS.maxLines),
  speakers: ARGS.noSpeakers ? false : DEFAULTS.speakers,
}

/** "MM:SS" / "HH:MM:SS" -> seconds. */
function toSeconds(stamp) {
  const parts = String(stamp).split(':').map(Number)
  return parts.reduce((n, p) => n * 60 + p, 0)
}

/** Wire format: "HH:MM:SS.mmm". */
function timestamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const frac = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}`
}

/** Read "MM:SS Text" lines into [{ start, speaker, text }]. */
export function parseVoiceover(raw) {
  const lines = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const m = rawLine.match(/^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+?)\s*$/)
    if (!m) continue
    const body = m[2]
    const spk = body.match(/^\(([^)]+)\)\s*(.*)$/)
    lines.push({
      start: toSeconds(m[1]),
      speaker: spk ? spk[1].trim() : '',
      text: (spk ? spk[2] : body).trim(),
    })
  }
  return lines
}

/** Greedy word-wrap to the line budget (over-long single words are allowed to overflow). */
export function wrap(text, maxLine) {
  const words = text.split(/\s+/).filter(Boolean)
  const out = []
  let line = ''
  for (const w of words) {
    if (!line) { line = w; continue }
    if ((line + ' ' + w).length <= maxLine) line += ' ' + w
    else { out.push(line); line = w }
  }
  if (line) out.push(line)
  return out
}

/**
 * Build cues: wrap each line, group the wrapped lines into cues of ≤ maxLines, and split the line's
 * time window across those cues by character weight so nothing is ever dropped.
 */
export function buildCues(lines, config) {
  const cues = []
  lines.forEach((line, i) => {
    const end = i + 1 < lines.length ? lines[i + 1].start : config.filmSeconds
    const start = line.start
    const spoken = config.speakers && line.speaker ? `${line.speaker}: ${line.text}` : line.text
    const wrapped = wrap(spoken, config.maxLine)
    const groups = []
    for (let j = 0; j < wrapped.length; j += config.maxLines) groups.push(wrapped.slice(j, j + config.maxLines))
    const window = Math.max(0.4, end - start)
    const weights = groups.map((g) => g.join(' ').length)
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1
    let t = start
    groups.forEach((group, g) => {
      const last = g === groups.length - 1
      const dur = last ? end - t : Math.max(0.6, (window * weights[g]) / totalWeight)
      const cueEnd = last ? end : Math.min(end, t + dur)
      cues.push({ start: t, end: cueEnd, lines: group })
      t = cueEnd
    })
  })
  return cues
}

function render(cues) {
  const blocks = ['WEBVTT', '']
  blocks.push('NOTE Tacet product film — captions generated from design/video/voiceover.txt', '')
  for (const cue of cues) {
    blocks.push(`${timestamp(cue.start)} --> ${timestamp(cue.end)}`)
    blocks.push(...cue.lines)
    blocks.push('')
  }
  return blocks.join('\n')
}

// --------------------------------------------------------------------------- main
if (!existsSync(config.voiceover)) {
  console.error(`make_vtt.mjs: missing ${config.voiceover}`)
  process.exit(1)
}
const lines = parseVoiceover(readFileSync(config.voiceover, 'utf8'))
if (!lines.length) {
  console.error(`make_vtt.mjs: no "MM:SS Text" lines in ${config.voiceover}`)
  process.exit(1)
}
const cues = buildCues(lines, config)
const vtt = render(cues)
const longest = cues.reduce((n, c) => Math.max(n, ...c.lines.map((l) => l.length)), 0)
const widest = cues.reduce((n, c) => Math.max(n, c.lines.length), 0)

if (ARGS.dryRun) {
  console.log(vtt)
} else {
  mkdirSync(dirname(config.out), { recursive: true })
  writeFileSync(config.out, vtt)
  console.log(`make_vtt.mjs: ${lines.length} voiceover lines → ${cues.length} cues`)
  console.log(`  longest caption line: ${longest}/${config.maxLine} chars; most lines in a cue: ${widest}/${config.maxLines}`)
  console.log(`  written: ${config.out}`)
}
