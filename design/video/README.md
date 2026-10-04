# `design/video` — the 75-second product film

The film is reproducible from the storyboard, not hand-assembled in an editor. Five scripts and one
narration file produce `out/film.mp4`, `out/film.vtt`, `out/poster.jpg` and (via ElevenLabs Dubbing)
`out/film.de.mp4` + `out/film.de.vtt`.

| File | What it is |
|---|---|
| `STORYBOARD.md` | Shot-by-shot plan: timestamps, what's on screen, the URL/state, the **focus selector**, the burned-in caption and the VO line. Names live in one place at the top. |
| `voiceover.txt` | Narration with timings, one read per line, ≤ 170 words. `(Mira)` / `(Sabine)` marks who speaks. Inline `[audio tags]` like `[warmly]` / `[curious]` are for the voice model and are stripped from the captions. |
| `record.mjs` | Node + Chrome DevTools Protocol recorder. Drives the deployed product, hides the off-brand controls, and writes one PNG per shot to `frames/`, **cropped to that shot's focus box** (a CSS selector or list, resolved through shadow DOM) at device scale 2 and **padded to the smallest 16:9 canvas in the paper colour `#f4f1ea`**. Wide `body` frames are only used by S1.x. |
| `make_vtt.mjs` | `voiceover.txt` → `out/film.vtt` (WebVTT; strips audio tags; ≤ 42 chars per line, ≤ 2 lines per cue; a longer line is split across consecutive cues inside its own time window). |
| `tts.mjs` | One ElevenLabs mp3 per voiceover line into `out/vo/NN.mp3`. Model `eleven_v3` by default (`--model` overrides); one voice per speaker — Mira `cgSgspJ2msm6clMCkdW9`, Sabine `XrExE9yKIg1WjnnlVkGX`, narrator `hpp4J3VqNfWAUOO0d1Us`. Reads `ELEVENLABS_API_KEY` from the environment at run time; never prints or writes it. |
| `assemble.mjs` | `frames/` → `out/film.mp4` + `out/poster.jpg`. Letterboxes every frame into the 16:9 master on the paper colour `#f4f1ea` (a no-op when `record.mjs` already padded it), gentle Ken-Burns per shot, crossfades only between real frames (a missing shot holds the previous real frame), VO placed at its timestamps, H.264 1600×900 ≤ 8 MB, then samples the film every 0.5 s and fails on any frame under 10 % mean luminance. |
| `dub.mjs` | `out/film.mp4` → `out/film.de.mp4` + `out/film.de.vtt` via ElevenLabs Dubbing (`target_lang=de`, `source_lang=en`, `num_speakers=3`, `watermark=false`). Never translates cue text locally: if the German transcript is unavailable, the English `out/film.vtt` is left in place and the script says so. Reads `ELEVENLABS_API_KEY` from the environment; never prints it. |
| `frames/` | Recorder output: `S<act>.<shot>-<caption>.png` + `manifest.json` (timings, captions, VO cue, focus selector, resolved crop box, file, session ids). |
| `out/` | Film output: `film.mp4`, `film.vtt`, `poster.jpg`, `film.de.mp4`, `film.de.vtt` (+ `vo/` when TTS has run). |

## Install

```bash
cd design/video && npm install    # ffmpeg-static, local to this folder
```

Node 20+ (this repo uses Node 22) and Chrome or Chromium are also required for `record.mjs`.

## Rebuild — the exact commands, in order

Run from the repo root:

```bash
# 1. fresh frames + manifest.json (deployed product, 1600×900 @2, one focused crop per shot)
node design/video/record.mjs

# 2. captions from the narration
node design/video/make_vtt.mjs                       # → out/film.vtt

# 3. the voiceover (optional — assemble builds a silent track without it; spends TTS credits)
ELEVENLABS_API_KEY=… node design/video/tts.mjs       # → out/vo/01.mp3 … one file per line

# 4. the film (letterboxed, crossfaded, mixed, black-frame checked)
node design/video/assemble.mjs                       # → out/film.mp4 + out/poster.jpg

# 5. the German version (spends dubbing credits; needs the English film from step 4)
ELEVENLABS_API_KEY=… node design/video/dub.mjs       # → out/film.de.mp4 + out/film.de.vtt
```

Expected outputs after a clean run:

```text
frames/S1.1-*.png … frames/S5.3-*.png   one focused PNG per recorded shot (± manifest.json)
out/film.vtt                            18 cues, ≤ 42 chars/line, ≤ 2 lines/cue
out/vo/01.mp3 … out/vo/17.mp3           17 reads (per-speaker voices, eleven_v3)
out/film.mp4                            1600×900, 25 fps, H.264 + AAC, ≤ 8 MB, no black frame
out/poster.jpg                          still from the hero shot (S2.1)
out/film.de.mp4                         the dub muxed over the same picture
out/film.de.vtt                         German WebVTT when the transcript endpoint returns it
```

Then copy the files the product site wants: `out/film.mp4`, `out/film.vtt`, `out/poster.jpg` →
`site/assets/` (and `out/film.de.*` for the German page).

> In a sandboxed/CI shell where Chrome's own sandbox cannot start, add `--no-sandbox`; if `:9222` is
> already taken by another Chrome, add `--port 9335`. On a normal desktop neither flag is needed. The
> recorder never touches `:8000`.

## `record.mjs`

```bash
node design/video/record.mjs --dry-run                # plan + focus selectors + resolved URLs, nothing launched
node design/video/record.mjs --check-storyboard       # record.mjs and STORYBOARD.md agree; 75 s total; S1.x only wide
node design/video/record.mjs --check-voiceover        # ≤ 170 narration words
node design/video/record.mjs --until S2.6             # hook + capture
node design/video/record.mjs --phase tutor            # tutor beat (runs the capture state first)
node design/video/record.mjs --only S1.1,S5.3         # selected shots (earlier steps still run for state)
node design/video/record.mjs --headed                 # watch it
node design/video/record.mjs --proof-session <live-sid>  # sealed-test inserts S3.2–S3.4
```

Defaults: `--core https://core-production-c5ac.up.railway.app` (origins come from `/api/config`),
`--out design/video/frames`, 1600×900 at scale 2. The recorder refuses any URL whose port is `:8000`.

- **Focus.** Every shot's `focus` is a CSS selector or a list of them; the frame is the union of the
  visible matches plus 24 px padding, searched through shadow roots too (the companion lives in one),
  captured at 2× and padded in place to the smallest 16:9 canvas containing it in `#f4f1ea`. Only S1.x
  name `body` (wide establishing). A selector that matches nothing logs a `focus … matched nothing`
  line, marks `focusFallback` in the manifest and records the full viewport.
- **Hygiene.** Before each capture the recorder injects CSS into the page and every shadow root that
  hides the header's step/autoplay buttons, `[data-k]` companion buttons, `#b-finish` and `.card`
  headings, then hides any short leaf text that still contains *practice, rehearsal, simulated, step*
  or *autoplay*.
- The capture and tutor beats are real Rehearsal sessions. The sealed-test beats (S3.2–S3.4) are
  **live inserts**: a Rehearsal session refuses `POST /api/sessions/{sid}/proofs` by design, so they
  cannot be filmed in Rehearsal. Without `--proof-session` those three shots are skipped in the
  manifest, and `assemble.mjs` holds the previous real frame for their duration — never black.

## `make_vtt.mjs` and `tts.mjs`

```bash
node design/video/make_vtt.mjs --dry-run               # print the cues, write nothing
node design/video/make_vtt.mjs --out /tmp/film.vtt
node design/video/tts.mjs --dry-run                    # list lines, resolved voice, model; no key
ELEVENLABS_API_KEY=… node design/video/tts.mjs --line 4 --force
```

`tts.mjs` sends the line's `[audio tags]` to the API and keeps one voice per speaker; `make_vtt.mjs`
strips the tags so they never reach the captions. Both scripts read the key from the environment only.

## `assemble.mjs`

```bash
node design/video/assemble.mjs --dry-run                # plan + check an existing out/film.mp4 for black frames
node design/video/assemble.mjs --check-frames           # only sample the encoded film
node design/video/assemble.mjs --check-frames --film out/film.mp4
node design/video/assemble.mjs --frames design/video/frames --out design/video/out
node design/video/assemble.mjs --crossfade 0.4 --zoom 0.06 --crf 24 --max-bytes 8000000
node design/video/assemble.mjs --no-vo --no-poster
```

- Each source is scaled to fit and **padded to 16:9 with `#f4f1ea`** before the Ken-Burns push, so a
  cropped panel keeps its readable scale.
- One clip per shot; the Ken-Burns push alternates direction and the clip length carries a crossfade
  tail, so the `xfade` offset is exactly the shot's `in` time and the 75 s timeline never drifts.
- Every clip comes from a real PNG (own or held), so crossfades are only between real frames. A missing
  shot holds the previous frame; the film never shows an empty card.
- **Black-frame check:** the finished film is sampled every 0.5 s (`fps=2,signalstats`) and the run
  fails if any sample's mean luminance (`YAVG`) is below 10 % of full scale. `--dry-run` runs the same
  check against an existing `out/film.mp4`.
- Every `out/vo/NN.mp3` is delayed to its `voiceover.txt` timestamp and mixed over a silent base; with
  no mp3s the film still builds with a silent track.
- Encoded H.264 + AAC; if the file is over `--max-bytes`, the CRF is raised and it is encoded again
  (max 4 passes). `poster.jpg` is taken from the hero shot (`--poster-shot`, default `S2.1`).

## `dub.mjs`

```bash
node design/video/dub.mjs --dry-run                    # plan; no key, no network
ELEVENLABS_API_KEY=… node design/video/dub.mjs
ELEVENLABS_API_KEY=… node design/video/dub.mjs --id <dubbing_id>   # resume polling, no re-upload
ELEVENLABS_API_KEY=… node design/video/dub.mjs --no-transcript
```

- Uploads `out/film.mp4` to `POST /v1/dubbing` with `target_lang=de`, `source_lang=en`,
  `num_speakers=3`, `watermark=false`, then polls `GET /v1/dubbing/{id}` until `dubbed`.
- Downloads `GET /v1/dubbing/{id}/audio/de`. A video response is written straight to
  `out/film.de.mp4`; an audio-only response is muxed over the original video with the local
  `ffmpeg-static` (video copied, audio AAC).
- `GET /v1/dubbing/{id}/transcript/de?format_type=webvtt` → `out/film.de.vtt` when available. If it is
  not, the English `out/film.vtt` is left in place and the script says so; **cue text is never
  translated locally**. The film still exits with the German video written (exit code 2 signals only
  the missing subtitles).
- Every request has a timeout (`--request-timeout`, default 300 s) and the poll has an overall budget
  (`--timeout`, default 1800 s); on timeout it prints the `--id` needed to resume. The key is only ever
  sent in the `xi-api-key` header.

## Notes

- `--product`, `--character`, `--expert`, `--trainee` override the four names in `record.mjs`'s `NAMES`
  constant for the title cards. Product name is still undecided ("Shadow" in the deployed product,
  "Tacet" in the cards); see `design/tasks/DEEPSEEK_NAMES*_REPORT.md`.
- `--keep` leaves Chrome and its temp profile in place for a manual retake; otherwise both are cleaned
  up.
