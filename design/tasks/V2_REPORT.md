# V2 · FILM, FINAL CUT — report

Task: `design/tasks/QUEUE_2026-10-04d.md` § V2 (readable shots, no black frames, expressive voices,
German via ElevenLabs Dubbing, README). Owned files: `design/video/**` only. Report: this file.

I built and **dry-ran** the tooling. I did **not** record against the product, did not call ElevenLabs
(TTS or dubbing), never committed, and never touched `:8000` — those are Claude's steps after deploy.
All acceptance checks below are real pasted runs.

## What I built

| File | Status | What changed |
|---|---|---|
| `design/video/record.mjs` | modified | Every shot names a `focus` (CSS selector or list); the recorder injects capture CSS into the page **and every shadow root**, crops each frame to the focus box (+24 px) at device scale 2, pads that crop in place to the smallest 16:9 canvas on `#f4f1ea`, and writes `focus` / `focusBox` / `focusMatched` / `frame` (or `focusFallback`) into `manifest.json`. `--check-storyboard` now also enforces a focus per shot, S1.x-only wide frames, and no off-brand words in captions; `--check-voiceover` also rejects off-brand words. |
| `design/video/STORYBOARD.md` | rewritten | New **Focus (frame)** column mirroring `record.mjs`; S4.1/S4.2/S4.4 words and descriptions aligned with the code; format/assembly sections document the 2× focus crop, the `#f4f1ea` letterbox, the no-black-frame rule and the hygiene list. |
| `design/video/assemble.mjs` | modified | Scales-to-fit + **pads to 16:9 on `#f4f1ea`** (paper) instead of crop-to-fill, for clips and `poster.jpg`; every clip is validated to come from a real PNG (a missing shot holds the previous real frame — crossfades only between real frames); the finished film is sampled every 0.5 s (`fps=2,signalstats`) and the run **fails on any frame with mean luminance < 10 %**; new `--check-frames [--film]`; `--dry-run` runs the same check on an existing `out/film.mp4`. |
| `design/video/tts.mjs` | modified | Default model `eleven_v3` (kept `--model` override); per-speaker voices as before (Mira `cgSgspJ2msm6clMCkdW9`, Sabine `XrExE9yKIg1WjnnlVkGX`, narrator `hpp4J3VqNfWAUOO0d1Us`); inline `[audio tags]` are sent to the API; dry run shows the resolved voice per line; fixed the `perLineDelayMs` config. |
| `design/video/voiceover.txt` | rewritten | Tightened to a calm product read (148 words incl. tags) with inline `[calmly]`, `[curious]`, `[quietly]`, `[gently]`, `[matter-of-fact]`, `[firmly]`, `[warmly]`, `[softly]`. |
| `design/video/make_vtt.mjs` | modified | `stripTags()` removes `[audio tags]` before cues are built; longest line 42/42, max 2 lines/cue, tags/off-brand words absent from the VTT. |
| `design/video/dub.mjs` | **new** | German dub: `POST /v1/dubbing` (multipart, `target_lang=de`, `source_lang=en`, `num_speakers=3`, `watermark=false`), poll `GET /v1/dubbing/{id}`, download `GET /v1/dubbing/{id}/audio/de` → `out/film.de.mp4` (video passthrough or audio muxed over the film with local `ffmpeg-static`), transcript `GET /v1/dubbing/{id}/transcript/de?format_type=webvtt` → `out/film.de.vtt`, else leave the English VTT and say so. Per-request and overall timeouts, `--id` resume, key only in `xi-api-key`, never printed. |
| `design/video/README.md` | rewritten | The exact commands **in order** (record → vtt → tts → assemble → dub) and the expected outputs; options for each script; focus/letterbox/hygiene/black-frame notes; dub caveats. |
| `design/video/package.json` | modified | Added `dub` and `check:storyboard` scripts. |

`design/video/out/`, `frames/` and `out/vo/` were left exactly as they were (dry runs only).

## 1. Readable shots

- `focus` is a selector or a list; the frame is the union of the visible matches, padded 24 px, resolved
  through **shadow roots** as well (the companion is one). Captured with `Page.captureScreenshot`'s
  `clip` at device scale 2 (`captureBeyondViewport` so an element below the fold can be clipped), then
  padded in place to the smallest 16:9 canvas containing it on `#f4f1ea`; `assemble.mjs` pads again as a
  no-op safety net.
- A CSS-selector match that fails logs `focus … matched nothing`, records the full viewport and sets
  `focusFallback: true` in the manifest — visible, never silent.
- Only **S1.1/S1.2** use `focus: 'body'` (wide establishing); `--check-storyboard` fails if any other
  shot does.
- Focus selects, per shot (full table in `STORYBOARD.md`): ERP booking-form column (S2.1/S2.2/S4.2),
  console “When to ask” section (S2.3), question + hypothesis cards (S2.4), “Learning receipts” (S2.5),
  companion `#toast` (S2.6), proof “Freeze a test”/commitment/table/score (S3.1–S3.4), tutor prediction
  card (S4.1), companion `.card` stop plate (S4.3), “Lena’s mastery” (S4.4), Work Map `article.panel`
  capped to a 400 px band (S5.1), export `pre` (S5.2), tagline `.sheet` (S5.3).
- **Hygiene.** `HIDE_CSS` hides `[data-k]`, `#b-finish`, `.text-candidate`, `header .ml-auto >
  button:nth-child(-n+2)` (the step/autoplay buttons), `.card h4`, `.card.nudge` and
  `article.panel > p`; it is injected into the document and every shadow root. A second pass hides any
  short leaf element whose text still contains *practice, rehearsal, simulated, step* or *autoplay*.
  Nothing in the product is changed behaviourally.

## 2. No black frames

- `assemble.mjs` already held the previous frame for a missing shot; it now also **validates every clip
  source** before encoding, and each `xfade` is therefore between two real frames. `--dry-run` prints
  `crossfades: N × 0.5s, all between real frames`.
- After encoding, `checkNoBlackFrames()` samples the film at 2 fps (`fps=2,signalstats,metadata=print`)
  and reads `lavfi.signalstats.YAVG`; a sample below 10 % of full scale fails the run with the sample
  count, mean, darkest percentage and its timestamp.
- The same check is exposed as `--check-frames` and is run by `--dry-run` against an existing
  `out/film.mp4`, so the acceptance command literally exercises it.

## 3. Expressive voices

- `tts.mjs` default model is `eleven_v3`; `--model` still overrides. Per-speaker voices unchanged and
  shown in `--dry-run`. `voiceover.txt` carries inline tags; the API receives them and `make_vtt.mjs`
  strips them from the captions (verified: no `[` remains in the VTT). Narration tightened to 148 words.

## 4. German via ElevenLabs Dubbing

- `dub.mjs` implements the exact contract in the task, with `--dry-run` (no key/network), `--id` resume,
  per-request timeout (`--request-timeout`, 300 s) and overall poll budget (`--timeout`, 1800 s, prints
  the `--id` to resume), and clear per-step errors. It never translates cue text locally: without a
  transcript it leaves `out/film.vtt` (English) in place, says so, and exits 2 (film written, subtitles
  missing). `film.de.mp4` is written either straight from a video response or by muxing the dubbed audio
  over the film with the local `ffmpeg-static`.

## 5. README

`design/video/README.md` now lists the five commands in order with their expected outputs, plus options
and the dev caveats (`--no-sandbox`, `--port 9335`, the `:8000` refusal).

## Acceptance — pasted output

```text
=== 1. syntax (node --check) ===
design/video/record.mjs  ok
design/video/make_vtt.mjs  ok
design/video/tts.mjs  ok
design/video/assemble.mjs  ok
design/video/dub.mjs  ok

=== 2. package.json ===
valid JSON

=== 3. storyboard ===
storyboard shots in doc: 19; in record.mjs: 19; total 75s
✓ STORYBOARD.md and record.mjs agree on every shot and on the 75s total

=== 4. voiceover ===
voiceover narration words: 148 (limit 170); whole file incl. timings: 178
✓ voiceover.txt within the 170-word limit and free of off-brand words
```

```text
=== 8. assemble --dry-run on existing frames (black-frame check) ===
assemble.mjs — dry run
  frames     /Users/shubhamjoshi/Hacknation 2/design/video/frames
  out        /Users/shubhamjoshi/Hacknation 2/design/video/out
  output     1600x900 @25fps  ≤ 8.00 MB  (crossfade 0.5s, KB 0.08, letterbox 0xf4f1ea)
  film       01:15 (75s) · 19 shots · 3 held
  voiceover  17/17 mp3(s) in /Users/shubhamjoshi/Hacknation 2/design/video/out/vo
  poster     S2.1 → poster.jpg
    S1.1  00:00–00:03  own
    ...
    S3.2  00:39–00:44  hold(S3.1-independent-t…)
    S3.3  00:44–00:47  hold(S3.1-independent-t…)
    S3.4  00:47–00:50  hold(S3.1-independent-t…)
    ...
    S5.3  01:13–01:15  own
  150 samples every 0.5s · mean luma 84.4% · darkest 13.2% @ 72.5s ✓ (floor 10% mean luminance)

=== 7. make_vtt (to /tmp, real out/ untouched) ===
make_vtt.mjs: 17 voiceover lines → 18 cues
  longest caption line: 42/42 chars; most lines in a cue: 2/2
  tag/off-brand scan of VTT: none

=== 6. tts --dry-run ===
tts.mjs — 17 line(s) · model eleven_v3 · voices Mira/Sabine/narrator
  04  00:12  exists  out/vo/04.mp3  XrExE9yKIg1WjnnlVkGX  “[quietly] Capex. Zero four hundred.”
  06  00:21  exists  out/vo/06.mp3  cgSgspJ2msm6clMCkdW9  “[gently] You coded it 0400. What made you do that?”
  ...
```

Extra verification (not required, done to prove the pipeline is real):

```text
=== 9. negative test: black-frame check must FAIL ===
assemble.mjs: 6 samples every 0.5s · mean luma 6.3% · darkest 6.3% @ 0.0s — below the 10% mean-luminance floor
exit=1

=== 10. full assemble smoke test in /tmp (portrait crop -> paper letterbox, missing shot -> hold) ===
assemble.mjs — 00:09 · 3 shots (1 held) · 0 VO track(s)
  T1  00:00–00:03  clip ✓
  T2  00:03–00:06  clip ✓
  T3  00:06–00:09  clip ✓  (held frame)
  crossfades: 2 × 0.5s, all between real frames
  film pass 1: crf 23, maxrate 700k → 0.76 MB
  18 samples every 0.5s · mean luma 87.4% · darkest 86.5% @ 0.0s ✓ (floor 10% mean luminance)
  top-left 4x4 pixel of the portrait shot (paper #f4f1ea ≈ f3f0e7 after H.264):
  00000000: f3f0 e7f3 f0e7 f3f0 e7f3 f0e7 ...
```

`node design/video/dub.mjs --dry-run` prints the upload/poll/download/transcript URLs and the
`target_lang=de source_lang=en num_speakers=3 watermark=false` fields, exits 0, no key, no network.

## Deviations / limits (honest)

1. **I did not record** (task rule) and did not call ElevenLabs. The focus selectors were written from
   `console/src`, `src/routes/invoice.$id.tsx` and `backend/shadow/static/capture.js`; they were not
   exercised against the live DOM. The resolver logs and marks any miss (`focusFallback`), and the
   storyboard/code is the one place to adjust after the first real recording.
2. **The existing `out/film.mp4` was not rebuilt.** It was produced by the previous cut (full-screen
   frames, crop-to-fill) and still passes the new check (darkest 13.2 %). Re-running `assemble.mjs`
   after a recording will use the paper letterbox and the focused frames.
3. **Dubbing was not run** (no key, and it spends credits). The happy path is implemented to the API
   contract in the task; the transcript fallback (keep the English VTT, never translate locally) is
   explicit and exits 2 so a partial result is visible.
4. `S3.2–S3.4` remain live inserts (a Rehearsal session refuses sealed tests). Their focus selectors
   target the real proof sheet (`section.panel:has(table)`) and will need `--proof-session <live-sid>`.
5. Two pre-existing working-tree changes in `advisory/product-engine-investigation-2026-10-03/` were
   already dirty when I started and were left untouched.

## Not touched / rules

`backend/**` (including `engine.py`/`main.py`/`store.py`), `console/**`, `src/**`, `site/**`,
`extension/**`, `advisory/**`; nothing committed or pushed; nothing run on `:8000`.
