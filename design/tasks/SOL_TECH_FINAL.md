# Sol: finish the tech walkthrough (new closing line, final render, commit)

Run on the Mac: it has `design/film/out/tech_vo_fast/` (per-line narration), `design/film/out/tech_sfx/`, Chrome,
Google Fonts and `backend/.env` (ELEVENLABS_API_KEY). Work only on branch `main-p6gs53`. **Never push to `main`**
(the owner is recording off it). Touch only the files listed under "Commit".

## Context
- `design/film/tech.html` is fixed on `main-p6gs53` (commit 7170793): observe-diagram arrows centred, closing card
  reads "What you say becomes a rule. What you do proves it." Earlier, a syntax error killed the script, so every
  frame showed the opening hook. Fixed; stills at 57.5s now show the closing card.
- `design/film/out/tech.mp4` is still the OLD cut (old arrows, spoken "Words propose. Behavior disposes.").
- `design/film/out/tech.vtt` is final (original timings, new closing text). Do not let render.mjs rewrite it:
  always pass `--keep-vtt`.

## Steps
1. `git fetch origin && git checkout main-p6gs53 && git pull origin main-p6gs53`
2. Find the exact voice of the current narration. Look in ElevenLabs history (`GET /v1/history`) for the take
   "Words propose. Behavior disposes." and lines 01-08 of `design/film/tech-voiceover.txt`, and note their voice_id,
   model_id and voice settings. Do not guess. The narrator in `design/video/tts.mjs` is `hpp4J3VqNfWAUOO0d1Us`,
   but confirm it against the history. Never print the key.
3. Generate ONE new take with that exact voice, model and settings: "What you say becomes a rule. What you do
   proves it." (no audio tag). Calm and closing, matching line 08's pace. If `tech_vo_fast` clips were sped up
   (compare each history item's duration with the matching file in `tech_vo_fast/`), apply the same tempo to the
   new take. Rename the old `tech_vo_fast/09.mp3` to `09.words-propose.mp3` and save the new take as `09.mp3`.
   Up to 3 takes. Pick the most natural one, ideally checking it by transcription.
4. Timing: line 09 starts at 53.3s (`LINES` in render.mjs) and DUR is 58.0s. The take must end by about 57.6s
   (length 4.3s or less). If it's longer, generate a tighter take rather than changing the visuals.
5. Render: `node design/film/render.mjs --comp tech --keep-vtt`. This does the full render with the audio mix
   (vo + sfx). Then run `--comp tech --sheet` to refresh `out/tech-contact.jpg`.
6. Verify, and report each result:
   - `git diff --stat design/film/out/tech.vtt` is empty, unless the new take ends after 56.79s. In that case,
     move ONLY the last cue's end time by hand to the take's end + 0.25s.
   - `ffprobe` shows a duration of 58.0s or less (it must be 60s or less), h264 + aac 48 kHz.
   - Stills `--comp tech --stills 9,55,57.5`: the 9s still shows the fixed arrows (`action · save` chip not
     clipped); 55 and 57.5 show the closing card with the new line; fonts are Newsreader, Geist and Plex Mono
     (no fallback serif).
   - Loudness: peaks under -2 dBFS. Play 52-58s and confirm the new line is heard once, with no leftover
     "Words propose".
7. Commit only `design/film/out/tech.mp4`, `design/film/out/tech-contact.jpg` (and `design/film/out/tech.vtt`
   if step 6 required the one-cue edit). Message: "Tech walkthrough: final render with the new closing line",
   ending with `Co-Authored-By: WOZCODE <contact@withwoz.com>`. Then `git push origin main-p6gs53`.
   Do not commit `out/stills/`, `out/sheet/`, `out/tech-silent.mp4` or `out/tech_vo_fast/`.

## Report
Voice id, model and settings used; take length; vtt changed or not; duration; the stills checked; commit hash.
