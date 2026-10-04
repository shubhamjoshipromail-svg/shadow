# `design/video` — the 75-second demo film

Four files, one job: make the 75-second demo reproducible instead of hand-waved.

| File | What it is |
|---|---|
| `STORYBOARD.md` | Shot-by-shot plan: timestamps, what's on screen, the URL/state, the burned-in caption, and how the recorder gets each frame. Names live in one place at the top. |
| `voiceover.txt` | Narration with timings, ≤ 170 words, calm and concrete. `(Mira)` / `(Sabine)` marks who speaks. |
| `record.mjs` | Node + Chrome DevTools Protocol recorder. Drives the **deployed** product in **Rehearsal (simulated expert)** with `POST /api/sessions/{sid}/sim/step`, and writes one PNG per shot to `frames/`. |
| `frames/` | Output: `S<act>.<shot>-<caption>.png` plus `manifest.json` (shot id, in/out, caption, VO cue, file, session ids). |

The capture and tutor beats are real Rehearsal sessions. The sealed-test beats (S3.2–S3.4) are **live inserts**:
a Rehearsal session refuses `POST /api/sessions/{sid}/proofs` by design, so they cannot be filmed in Rehearsal.
S3.1 (the learned threshold) films fine in Rehearsal, with the page's own "rehearsal session · tests disabled"
mark visible.

## Install

Requires Node 20+ (this repo uses Node 22) and Chrome or Chromium.

```bash
npm i -D ws          # the only dependency; already present transitively in this repo
```

`ws` is loaded lazily, so `--dry-run`, `--check-storyboard` and `--check-voiceover` work without it.

## Commands

Run from the repo root (paths are resolved from the repo root, so any CWD works):

```bash
# static checks, no browser, no network
node design/video/record.mjs --check-storyboard   # record.mjs and STORYBOARD.md agree, 75s total
node design/video/record.mjs --check-voiceover    # ≤ 170 narration words
node --check design/video/record.mjs              # syntax

# see the plan and the resolved URLs
node design/video/record.mjs --dry-run

# film the whole thing (S3.2–S3.4 are skipped until you pass --proof-session)
node design/video/record.mjs

# subsets / phases
node design/video/record.mjs --until S2.6          # hook + capture
node design/video/record.mjs --phase tutor         # tutor beat (runs the capture state first)
node design/video/record.mjs --only S1.1,S5.3      # selected shots (earlier steps still run for state)

# real Chrome flags
node design/video/record.mjs --headed              # watch it
node design/video/record.mjs --no-sandbox          # CI / sandboxed shells where Chrome's sandbox can't init
node design/video/record.mjs --no-launch --port 9222   # attach to a Chrome you started with --remote-debugging-port
node design/video/record.mjs --chrome /path/to/chrome  # explicit binary

# sealed-test inserts (S3.2–S3.4) from a live session that already froze a proof
node design/video/record.mjs --proof-session <live-sid>
```

Defaults: `--core https://core-production-c5ac.up.railway.app` (the recorder reads `/api/config` for the
notebook and ERP origins), `--out design/video/frames`, viewport 1600×900 at scale 1.5 (2400×1350 PNG).

**Never :8000.** The recorder refuses any `--core`/`--console`/`--erp` whose port is 8000, per
`design/tasks/QUEUE_2026-10-03.md`. Use the deployed URL or a local core on `:8001`.

### Why `--no-sandbox` sometimes

Chrome starts its own sandbox; inside another sandbox (CI, containers, some agent shells) that fails with
`sandbox initialization failed: Operation not permitted` and Chrome dies before the debug port opens. Passing
`--no-sandbox` is the fix in those environments. Leave it off on your own machine.

## How the recorder works

1. `--remote-debugging-port` Chrome (throwaway profile) or attach with `--no-launch`.
2. Connect to the browser WebSocket, open **two** pages: the notebook (console) and the ERP. Two pages matter:
   the ERP companion has to stay connected when the notebook is on screen, or the toast/plate events are missed.
3. `POST /api/sessions` with `{ simulate: true }` for the capture session and
   `{ mode: "tutor", from_session: <capture> }` for the tutor, then advance the simulator with
   `POST /api/sessions/{sid}/sim/step`.
4. For each shot: bring the product to the state, `Page.captureScreenshot`, write the PNG, append to
   `manifest.json`.

Shot state is driven by the snapshot, not by trusting a `sim/step` return value: `ensureCase` waits for
`current_case` + a committed prediction (nudging with a `case_opened` event if capture.js has not opened the
case yet), and `ensureDecided` waits for an episode. The tutor creation goes through `createTutorWithMap`,
which detects the one real failure mode of a deployed core — sessions are in memory, so a deploy/restart
mid-run leaves the tutor with the seed-only map — and rebuilds the capture map through the same simulated
path instead of filming a tutor that never learned anything.

## Turning frames into an mp4

1. **Write the captions.** The manifest has `caption`, `vo` and `in`/`out` per shot. Make an SRT/ASS in the
   edit, or use them for a lower-third. Fonts: Newsreader (testimony), Geist (interface), IBM Plex Mono
   (codes/amounts/hashes) — see `design/DESIGN.md`.

2. **Record the voiceover** from `voiceover.txt` (strip the `HH:MM` timings; the words are the read).
   ElevenLabs TTS, e.g. with the same voice as the interviewer agent:

   ```bash
   sed -E 's/^[0-9]{2}:[0-9]{2} //; s/\([^)]*\) ?//g' design/video/voiceover.txt > /tmp/vo.txt
   curl -s -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID" \
     -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
     -d "$(node -e 'console.log(JSON.stringify({text:require("fs").readFileSync("/tmp/vo.txt","utf8"),model_id:"eleven_multilingual_v2"}))')" \
     -o design/video/frames/voiceover.mp3
   ```

3. **Build a still-timed cut from `manifest.json`.** ffmpeg's concat demuxer takes each PNG with a duration;
   repeat the last file at the end (the demuxer ignores the final entry's duration otherwise).

   ```bash
   node -e '
     const m=require("./design/video/frames/manifest.json");
     const fs=require("fs"), path=require("path");
     const rows=[];
     for(const s of m.shots.filter(s=>s.file)) rows.push(`file ${JSON.stringify(path.basename(s.file))}`, `duration ${s.out-s.in}`);
     if(rows.length) rows.push(`file ${JSON.stringify(path.basename(m.shots.filter(s=>s.file).at(-1).file))}`);
     fs.writeFileSync("design/video/frames/slides.txt", rows.join("\n")+"\n");
   '
   cd design/video/frames
   ffmpeg -y -f concat -safe 0 -i slides.txt -i voiceover.mp3 \
     -vf "fps=25,format=yuv420p,subtitles=captions.ass" \
     -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k -shortest ../tacet-demo.mp4
   ```

   No captions file yet? Drop the `subtitles=...` filter.

4. **Prefer motion to stills?** Each frame can be a 4-second push-in instead of a cut (replace the concat
   input per shot):

   ```bash
   ffmpeg -y -loop 1 -i S2.5-her-answer-becomes-a-rule.png -t 5 \
     -vf "scale=2600:-2,zoompan=z='min(zoom+0.0008,1.08)':d=125:s=1920x1080:fps=25,format=yuv420p" \
     -c:v libx264 -crf 18 shot-s2-5.mp4
   ```

   Then concat the per-shot mp4s and lay the voiceover over the result:
   `ffmpeg -f concat -safe 0 -i shots.txt -i voiceover.mp3 -c:v copy -c:a aac -shortest tacet-demo.mp4`.

5. Level the audio (`loudnorm=I=-16:TP=-1.5:LRA=11`) and keep the finished file at
   `1920x1080 / 25fps / H.264 / AAC`.

## Notes

- `--product`, `--character`, `--expert`, `--trainee` override the four names in `record.mjs`'s `NAMES`
  constant for the title cards. Product name is still undecided ("Shadow" in the repo, "Tacet" in the cards);
  see `design/tasks/DEEPSEEK_NAMES*_REPORT.md`.
- The recorder keeps the product's own "rehearsal · simulated expert" mark legible on purpose; do not crop it
  out of the capture/tutor frames.
- `--keep` leaves Chrome and its temp profile in place for a manual retake; otherwise both are cleaned up.
