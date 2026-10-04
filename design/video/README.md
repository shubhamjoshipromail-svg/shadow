# `design/video` — the 75-second product film

The film is reproducible from the storyboard, not hand-assembled in an editor. Four scripts and one
narration file produce `out/film.mp4`, `out/film.vtt` and `out/poster.jpg`.

| File | What it is |
|---|---|
| `STORYBOARD.md` | Shot-by-shot plan: timestamps, what's on screen, the URL/state, the burned-in caption and the VO line. Names live in one place at the top. |
| `voiceover.txt` | Narration with timings, one read per line, ≤ 170 words. `(Mira)` / `(Sabine)` marks who speaks. |
| `record.mjs` | Node + Chrome DevTools Protocol recorder. Drives the **deployed** product in Rehearsal (simulated expert) with `POST /api/sessions/{sid}/sim/step` and writes one PNG per shot to `frames/` (1600×900 at device scale 2 → 3200×1800). |
| `make_vtt.mjs` | `voiceover.txt` → `out/film.vtt` (WebVTT; ≤ 42 chars per line, ≤ 2 lines per cue; a longer line is split across consecutive cues inside its own time window). |
| `tts.mjs` | Optional: one ElevenLabs mp3 per voiceover line into `out/vo/NN.mp3`. Reads `ELEVENLABS_API_KEY` from the environment at run time; never prints or writes it. |
| `assemble.mjs` | `frames/` → `out/film.mp4` + `out/poster.jpg`. Ken-Burns per shot, crossfades at the storyboard boundaries, VO placed at its timestamps, H.264 1600×900 ≤ 8 MB. Works with or without the VO mp3s. |
| `frames/` | Recorder output: `S<act>.<shot>-<caption>.png` + `manifest.json` (timings, captions, VO cue, file, session ids). |
| `out/` | Film output: `film.mp4`, `film.vtt`, `poster.jpg` (+ `vo/` if TTS was run). |

## Install

```bash
cd design/video && npm install    # ffmpeg-static, local to this folder
```

Node 20+ (this repo uses Node 22) and Chrome or Chromium are also required for `record.mjs`.

## Rebuild (the 3 commands)

Run from the repo root:

```bash
node design/video/record.mjs        # 1. fresh frames + manifest.json (deployed product, 1600×900 @2)
node design/video/make_vtt.mjs      # 2. out/film.vtt from voiceover.txt
node design/video/assemble.mjs      # 3. out/film.mp4 + out/poster.jpg
```

Add the read (optional; `assemble.mjs` is silent without it):

```bash
ELEVENLABS_API_KEY=… node design/video/tts.mjs   # out/vo/01.mp3 … one file per line
node design/video/assemble.mjs                   # place the VO at its timestamps
```

Then copy the three files the product site wants: `out/film.mp4`, `out/film.vtt`, `out/poster.jpg` →
`site/assets/`.

> In a sandboxed/CI shell where Chrome's own sandbox cannot start, add `--no-sandbox`; if `:9222` is already
> taken by another Chrome, add `--port 9335`. On a normal desktop neither flag is needed. The recorder never
> touches `:8000`.

## `record.mjs`

```bash
node design/video/record.mjs --dry-run                # plan + resolved URLs, nothing launched
node design/video/record.mjs --check-storyboard       # record.mjs and STORYBOARD.md agree, 75 s total
node design/video/record.mjs --check-voiceover        # ≤ 170 narration words
node design/video/record.mjs --until S2.6             # hook + capture
node design/video/record.mjs --phase tutor            # tutor beat (runs the capture state first)
node design/video/record.mjs --only S1.1,S5.3         # selected shots (earlier steps still run for state)
node design/video/record.mjs --headed                 # watch it
node design/video/record.mjs --proof-session <live-sid>  # sealed-test inserts S3.2–S3.4
```

Defaults: `--core https://core-production-c5ac.up.railway.app` (origins come from `/api/config`),
`--out design/video/frames`, 1600×900 at scale 2. The recorder refuses any URL whose port is `:8000`.

The capture and tutor beats are real Rehearsal sessions. The sealed-test beats (S3.2–S3.4) are **live
inserts**: a Rehearsal session refuses `POST /api/sessions/{sid}/proofs` by design, so they cannot be
filmed in Rehearsal. Without `--proof-session` those three shots are skipped in the manifest, and
`assemble.mjs` holds the previous frame for their duration so the timeline and the VO stay aligned.

## `assemble.mjs`

```bash
node design/video/assemble.mjs --dry-run
node design/video/assemble.mjs --frames design/video/frames --out design/video/out
node design/video/assemble.mjs --crossfade 0.4 --zoom 0.06 --crf 24 --max-bytes 8000000
node design/video/assemble.mjs --no-vo --no-poster
```

- One 1600×900 clip per shot; the Ken-Burns push alternates direction and the clip length carries a
  crossfade tail, so the `xfade` offset is exactly the shot's `in` time and the 75 s timeline never drifts.
- Every `out/vo/NN.mp3` is delayed to its `voiceover.txt` timestamp and mixed over a silent base; with no
  mp3s the film still builds with a silent track.
- Encoded H.264 + AAC; if the file is over `--max-bytes`, the CRF is raised and it is encoded again (max 4
  passes). `poster.jpg` is taken from the hero shot (`--poster-shot`, default `S2.1`).

## Notes

- `--product`, `--character`, `--expert`, `--trainee` override the four names in `record.mjs`'s `NAMES`
  constant for the title cards. Product name is still undecided ("Shadow" in the deployed product, "Tacet"
  in the cards); see `design/tasks/DEEPSEEK_NAMES*_REPORT.md`.
- The recorder keeps the product's own mode mark visible on purpose; do not crop it out of the frames.
- `--keep` leaves Chrome and its temp profile in place for a manual retake; otherwise both are cleaned up.
