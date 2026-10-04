// tech-sfx.mjs — subtle sound effects via the ElevenLabs Sound Effects API -> out/tech_sfx/*.mp3 + sfx.json (key read from backend/.env, never printed)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const DIR = dirname(fileURLToPath(import.meta.url)), OUT = join(DIR, 'out/tech_sfx'); mkdirSync(OUT, { recursive: true })
const key = (readFileSync(join(DIR, '../../backend/.env'), 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!key) { console.log('no key'); process.exit(0) }
const defs = {
  click: ['a single soft mechanical keyboard key click, quiet, dry, close microphone', 0.5],
  stamp: ['a soft rubber stamp pressed on paper, one gentle thud, quiet, dry', 0.8],
  chime: ['a single quiet soft glass chime, short, gentle, pleasant notification', 1.4],
  tick:  ['a tiny crisp digital tick, very short, subtle, dry', 0.5],
}
for (const [n, [text, dur]] of Object.entries(defs)) {
  const f = join(OUT, n + '.mp3'); if (existsSync(f)) continue
  const r = await fetch('https://api.elevenlabs.io/v1/sound-generation', { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ text, duration_seconds: dur, prompt_influence: 0.6 }) })
  if (!r.ok) { console.log(n, 'failed', r.status); continue }
  writeFileSync(f, Buffer.from(await r.arrayBuffer())); console.log('wrote', n)
}
const ev = []
;[11.5, 11.72, 11.95, 12.18].forEach((t) => ev.push({ file: 'click.mp3', t, vol: 0.5 }))
ev.push({ file: 'stamp.mp3', t: 12.58, vol: 0.55 })
ev.push({ file: 'chime.mp3', t: 20.2, vol: 0.4 })
for (let i = 0; i < 6; i++) ev.push({ file: 'tick.mp3', t: 36.5 + i * 0.4, vol: 0.28 })
ev.push({ file: 'stamp.mp3', t: 40.0, vol: 0.5 })
ev.push({ file: 'stamp.mp3', t: 44.2, vol: 0.4 }, { file: 'stamp.mp3', t: 44.75, vol: 0.35 }, { file: 'stamp.mp3', t: 45.3, vol: 0.4 })
ev.push({ file: 'stamp.mp3', t: 48.05, vol: 0.45 })
ev.push({ file: 'chime.mp3', t: 54.3, vol: 0.3 })
writeFileSync(join(OUT, 'sfx.json'), JSON.stringify(ev.filter((e) => existsSync(join(OUT, e.file))), null, 1))
