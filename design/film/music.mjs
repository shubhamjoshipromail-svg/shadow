// music.mjs — optional music bed via ElevenLabs Music API -> out/music.mp3 (skips quietly on failure). Key read from backend/.env, never printed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const DIR = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(join(DIR, '../../backend/.env'), 'utf8')
const key = (env.match(/^ELEVENLABS_API_KEY=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!key) { console.log('no key; skipping music'); process.exit(0) }
if (existsSync(join(DIR, 'out/music.mp3')) && !process.argv.includes('--force')) { console.log('music exists'); process.exit(0) }
const r = await fetch('https://api.elevenlabs.io/v1/music', { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'Restrained modern minimal instrumental for a product film: soft felt piano, gentle analog synth pad, a slow quiet pulse, warm and confident, spacious, no vocals, no drums fills, gradually building very slightly, calm resolve at the end.', music_length_ms: 78000 }) })
if (!r.ok) { console.log('music API unavailable:', r.status); process.exit(0) }
writeFileSync(join(DIR, 'out/music.mp3'), Buffer.from(await r.arrayBuffer())); console.log('music written')
