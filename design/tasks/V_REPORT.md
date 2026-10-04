# V · FILM — report

Task: make the real product film pipeline produce `film.mp4` + `film.vtt` + `poster.jpg` from fresh
frames. Owned files: `design/video/**` only. Report: this file.

## What I built

| File | Status | What it does |
|---|---|---|
| `design/video/make_vtt.mjs` | **new** | `voiceover.txt` → `out/film.vtt`. Wraps each read to ≤ 42 chars/line and ≤ 2 lines/cue; a read that needs more is split across consecutive cues inside its own time window (last cue ends at `--film-seconds`, default 75). |
| `design/video/tts.mjs` | **new** | One ElevenLabs mp3 per voiceover line → `out/vo/NN.mp3`. Voice `cgSgspJ2msm6clMCkdW9`, model `eleven_multilingual_v2`. Reads `ELEVENLABS_API_KEY` from the environment at run time; never printed and never written to disk (header only). **Not run** per the task. `--dry-run` needs no key and no network. |
| `design/video/assemble.mjs` | **new** | `frames/` → `out/film.mp4` + `out/poster.jpg`. One 1600×900 clip per shot (alternating Ken-Burns), `xfade` crossfades anchored at each shot's `in` time, VO mp3s delayed to their `voiceover.txt` timestamps over a silent base, x264 + AAC, size-checked against `--max-bytes` (8,000,000). Works with or without the mp3s. |
| `design/video/package.json` / `package-lock.json` | **new** | Local dep: `ffmpeg-static` (ffmpeg 6.0). `node_modules/` is already gitignored. |
| `design/video/record.mjs` | modified | Default viewport device scale `1.5` → `2` (1600×900 @2 → 3200×1800 PNGs); help-text wording fixes. |
| `design/video/STORYBOARD.md` | modified | Title + format line; Assembly section now describes the script pipeline. |
| `design/video/README.md` | rewritten | Install + **the exact 3 rebuild commands** + recorder/assembler options. |
| `design/video/frames/` | regenerated | 16 fresh `3200×1800` PNGs + `manifest.json` (gitignored). |
| `design/video/out/` | **new artifacts** | `film.mp4`, `film.vtt`, `poster.jpg`. Claude copies these three to `site/assets/`. |

Recorded fresh from the deployed product on 2026-10-04T02:08:56Z:
`core=https://core-production-c5ac.up.railway.app`, capture session `d2517297e3`, tutor session `f5dffc5021`,
`proof_session=null`. **16 of 19** shots have frames; S3.2–S3.4 are skipped (see Deviations).

Rebuild (from the repo root; the sandboxed run needed `--port 9335 --no-sandbox`):

```bash
node design/video/record.mjs        # 1. fresh frames
node design/video/make_vtt.mjs      # 2. out/film.vtt
node design/video/assemble.mjs      # 3. out/film.mp4 + out/poster.jpg
```

## Acceptance — pasted output

```text
=== 1. syntax ===
node --check design/video/make_vtt.mjs  ok
node --check design/video/tts.mjs  ok
node --check design/video/assemble.mjs  ok
node --check design/video/record.mjs  ok

=== 2. storyboard + voiceover ===
storyboard shots in doc: 19; in record.mjs: 19; total 75s
✓ STORYBOARD.md and record.mjs agree on every shot and on the 75s total
voiceover narration words: 147 (limit 170); whole file incl. timings: 168
✓ voiceover.txt within the 170-word limit

=== 3. tts dry-run (never run for real) ===
tts.mjs — 17 line(s) · voice cgSgspJ2msm6clMCkdW9 · model eleven_multilingual_v2
  01  00:00  to render  out/vo/01.mp3  “Sabine has processed invoices for twenty-four years.”
  02  00:04  to render  out/vo/02.mp3  “She retires Friday. The 2019 process covers half.”
  03  00:09  to render  out/vo/03.mp3  “Mira writes its guess before she codes it.”
  ...

=== 4. make_vtt ===
make_vtt.mjs: 17 voiceover lines → 18 cues
  longest caption line: 42/42 chars; most lines in a cue: 2/2
  written: /Users/shubhamjoshi/Hacknation 2/design/video/out/film.vtt

=== 5. assemble (silent; fresh frames, no out/vo) ===
  S5.2  01:10–01:13  clip ✓
  S5.3  01:13–01:15  clip ✓
  film pass 1: crf 23, maxrate 700k → 5.74 MB
  poster.jpg ← S2.1 (0.10 MB)
assemble.mjs: wrote /Users/shubhamjoshi/Hacknation 2/design/video/out/film.mp4 (5.74 MB)
  voiceover: none — silent track (run tts.mjs, then assemble.mjs again)

=== 6. film probe ===
  Duration: 00:01:15.00, start: 0.000000, bitrate: 612 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1600x900 [SAR 1:1 DAR 16:9], 604 kb/s, 25 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 2 kb/s
film.mp4 bytes: 5744606  (limit 8000000)
poster.jpg bytes: 95191
film.vtt cues: 18
```

Independent VTT check (parses the file, not the script's own count): 18 cues, longest line 42 chars,
max 2 lines per cue, 0 violations, last cue `00:01:09.000 --> 00:01:15.000`.

Assemble-with-VO check (dummy 0.4 s tracks, so `--vo-dir` and the mix path are exercised without spending
TTS credits): `film pass 1 … 6.00 MB`, 17 line(s) placed at their timestamps, output `00:01:15.00` with an
AAC stereo track. So the film builds **with or without** `out/vo/`.

The assembled film was spot-checked frame-by-frame (title card → crossfade into the ERP → console question
→ tutor stop → Work Map) and is correct; crossfades land exactly on the storyboard boundaries.

## Design decisions

- **No timeline drift.** Each shot clip is `(out − in) + crossfade` long, and every `xfade` offset is the
  shot's storyboard `in`. Composing left-to-right, the transition for shot *k* starts at exactly `inₖ`, and
  the result is `Σ in` + one crossfade; the final `trim=duration=75` drops the tail.
- **Silent by default.** `assemble.mjs` always lays a silent base track, so the film is valid with no VO and
  becomes voiced the moment `out/vo/*.mp3` exist (delayed to the same `voiceover.txt` timestamps).
- **Missing frames hold, they do not shorten.** A skipped shot holds the previous frame for its duration, so
  a missing sealed-test insert never shifts every later timestamp or cuts the last VO lines.
- **2× default scale** changed in `record.mjs` per the task (frames are 3200×1800, assembled to 1600×900).

## Deviations / limits (honest)

1. **S3.2–S3.4 are not recorded.** They need `--proof-session <live-sid>`; Rehearsal sessions refuse
   `POST /api/sessions/{sid}/proofs` by design. No live session with a frozen proof survives on the
   deployed core (sessions are in memory; `/api/history` has one old proof on `eac6285738`, but
   `/api/sessions/eac6285738` → 404). Creating one would spend the owner's LLM budget *and* need human
   labels, which the packaging rules forbid faking, so I did not. `assemble.mjs` holds S3.1's real proof
   page for those 11 s. To get real inserts: run a live teach→freeze→label, pass its id to
   `node design/video/record.mjs --proof-session <sid>`, then re-run `assemble.mjs`.
2. **The deployed build is stale and still says "shadow"/"rehearsal".** The fresh frames' product chrome
   prints `shadow` (wordmark) and `rehearsal · simulated Sabine` / `rehearsal session · tests disabled ·
   map v1 from seed`. The repo's console source has already moved on to `practice run · …`
   (`console/src/pages/Console.tsx:142`, `console/src/pages/ProofPage.tsx:58`) but the **Wordmark still
   reads `shadow`** (`console/src/components/ui.tsx:88`) and `<title>Shadow</title>`
   (`console/index.html:6`). Until the console/core are redeployed with the rename, the film's UI cannot
   say Tacet. This is why the title cards say Tacet while the captured UI says shadow.
3. **No voiceover mp3s.** `ELEVENLABS_API_KEY` is not in this environment and the task says not to run
   `tts.mjs`; Claude runs it, then `assemble.mjs` again. The delivered `film.mp4` is therefore silent, which
   is the acceptance deliverable.
4. `record.mjs` had to run with `--port 9335 --no-sandbox` here: an unrelated Chrome already holds `:9222`
   on this machine, and Chrome's own sandbox cannot initialise under the harness shell. Neither flag is
   needed on a normal desktop; both are documented in the README.

## Wording changed/removed for sounding like a demo/hack

On-screen captions: none of the 19 `caption` strings, the VO reads, or the two title cards contained
`demo`, `rehearsal`, `simulated`, `hackathon`, `sandbox`, `try our`, `AI-powered`, `unlock` or
`revolutionize`, so there was nothing to strip from the captions themselves. Changed in the files I own:

- `STORYBOARD.md` title: “75-second **demo** film” → “75-second **product** film”.
- `STORYBOARD.md` format: “Master 1920×1080 … scale 1.5 (2400×1350 PNG)” → “Master 1600×900 … scale 2
  (3200×1800 PNG), assembled down to the 1600×900 master”.
- `record.mjs --help`: “**demo** workplace origin” → “ERP origin”; “default 1600x900 @1.5” → “@2”.
- `README.md`: removed “demo film”, “demo workplace”, and the old editor/mux recipe; retitled as the
  product-film pipeline.
- Kept, deliberately: internal code comments/manifest `mode` that say the capture/tutor beats are recorded
  in Rehearsal. The task allows using rehearsal mode internally, and the storyboard's honesty rules require
  not pretending a Rehearsal frame is live.

## Suggested follow-up in Claude-owned files (not edited here)

- `console/src/components/ui.tsx:88` — Wordmark literal `shadow` → product constant / `Tacet`.
- `console/index.html:6` — `<title>Shadow</title>` → product constant / `Tacet`.
- Redeploy console + core, then re-run the 3 rebuild commands so the film's captured chrome matches the
  name. No `backend/shadow/engine.py`, `main.py` or `store.py` change is needed for the film pipeline.

## Not touched

`backend/**` (including `engine.py`/`main.py`/`store.py`), `console/**`, `site/**`, `extension/**`;
nothing committed or pushed; nothing run on `:8000`.
