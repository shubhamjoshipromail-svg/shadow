# T4 · VIDEO — 75-second demo film plan + tooling · report

**Status:** done. All four listed files created; no existing file edited; nothing committed or pushed; nothing run
against `:8000`.

## What I built

| File | Contents |
|---|---|
| `design/video/STORYBOARD.md` | 19-shot, 75.0 s plan for hook → capture → sealed test → tutor → close. Each row: time, what's on screen, the URL/state, the burned-in caption, and how `record.mjs` gets the frame. Names (`PRODUCT_NAME`/`CHARACTER_NAME`/expert/trainee) live in one block at the top. Truthfulness rules for the edit at the bottom. |
| `design/video/voiceover.txt` | Narration with timings; **147 narration words** (168 including timestamps and speaker tags), limit 170. `(Mira)` / `(Sabine)` marks the spoken turns. |
| `design/video/record.mjs` | Node + Chrome DevTools Protocol recorder. Launches (or attaches to) headless Chrome, opens a notebook page and an ERP page, creates a **Rehearsal** session (`simulate:true`) and a tutor session `from_session`, advances the product with `POST /api/sessions/{sid}/sim/step`, and writes one PNG per shot plus `frames/manifest.json`. `--dry-run`, `--check-storyboard`, `--check-voiceover`, `--until`, `--only`, `--phase`, `--proof-session`, `--no-sandbox`, `--no-launch`. Refuses any port-8000 URL. |
| `design/video/README.md` | Dependency (`ws`), all commands, how the recorder works, the `--no-sandbox` caveat, and the ffmpeg pipeline (concat from `manifest.json`, caption burn-in, Ken-Burns alternative, ElevenLabs TTS one-liner). |
| `design/video/frames/` (output) | 16 PNGs at 2400×1350 plus `manifest.json` (per-shot in/out, caption, VO cue, file, session ids). S3.2–S3.4 are intentionally not filmed in Rehearsal. |

**Acceptance checks** are not spelled out for T4 in `QUEUE_2026-10-03.md`, so I defined them as: syntax, the
storyboard/code agreement check, the voiceover limit, the `:8000` refusal, and one real end-to-end rehearsal
recording against the deployed product. All outputs are pasted below.

### Frames produced (16/19)

```
S1.1-the-written-process-is-from-2019.png
S1.2-sabine-has-done-this-for-24-years-she-retires-fr.png
S2.1-before-she-touches-it-mira-writes-its-guess-down.png
S2.2-she-books-it-to-0400-capex-the-doc-said-4711.png
S2.3-it-doesnt-interrupt-it-waits-for-a-pause.png
S2.4-then-it-asks-one-question-what-made-her-do-that.png
S2.5-her-answer-becomes-a-rule-before-4711-now-0400.png
S2.6-the-before-and-the-after-written-down.png
S3.1-independent-test-pick-the-threshold-she-just-tau.png
S4.1-monday-a-new-hire-gets-the-same-invoices.png
S4.2-she-codes-it-4711-as-the-2019-doc-says.png
S4.3-mira-stops-the-save-in-sabines-words.png
S4.4-then-it-steps-back-and-lets-her-work.png
S5.1-the-work-map-every-line-links-to-the-moment-and-.png
S5.2-exportable-to-agents-as-guardrails-not-advice.png
S5.3-learns-the-part-of-the-job-nobody-wrote-down.png
```

S3.2, S3.3, S3.4 are skipped with the note *"no --proof-session (sealed tests are refused by rehearsal
sessions)"* — exactly the product's own rule. They are the live inserts described in the storyboard; run
`node design/video/record.mjs --proof-session <live-sid>` on a live capture session that already froze a proof
to capture them.

## How to integrate (exact call sites)

1. **Nothing in the app needs changing.** T4 is plan + tooling; no product file is imported or edited. The
   recorder talks to the deployed API only.
2. **Film:** from the repo root, `npm i -D ws` once, then `node design/video/record.mjs`. Defaults already
   point at the deployed core (`https://core-production-c5ac.up.railway.app`); the recorder resolves
   `console_url` (empty → core origin) and `erp_url` from `/api/config` at run time.
3. **Sealed-test inserts:** on the live evaluator flow (teach a threshold → *Test it* → freeze → label),
   copy the session id from the URL and run
   `node design/video/record.mjs --proof-session <sid>`. That re-creates the capture/tutor rehearsal frames
   too; use `--only S3.1,S3.2,S3.3,S3.4` to write only the proof frames.
4. **Editing:** `design/video/frames/manifest.json` is the cut list — `{id, in, out, phase, caption, vo, file}`.
   `design/video/README.md` has the ffmpeg recipe that reads it.
5. **Rename:** the only place names change is the `NAMES` constant at the top of `record.mjs` (overridable with
   `--product/--character/--expert/--trainee`) and the matching table at the top of `STORYBOARD.md`. The
   product wordmark inside the real UI frames is the repo's current "shadow" until T5's rename lands; re-run
   the recorder after T5 to refresh.
6. **Where this feeds the submission:** the storyboard is the shoot plan, `voiceover.txt` is the read,
   `record.mjs` produces the B-roll, and the ffmpeg recipe in `README.md` assembles
   `design/video/tacet-demo.mp4`. The landing page's video slot (`site/assets/demo.mp4`, T3) can take that
   file unchanged.

## Acceptance checks — pasted output

### Static checks

```
$ node --check design/video/record.mjs && echo SYNTAX_OK
SYNTAX_OK

$ node design/video/record.mjs --check-storyboard
storyboard shots in doc: 19; in record.mjs: 19; total 75s
✓ STORYBOARD.md and record.mjs agree on every shot and on the 75s total

$ node design/video/record.mjs --check-voiceover
voiceover narration words: 147 (limit 170); whole file incl. timings: 168
✓ voiceover.txt within the 170-word limit

$ node design/video/record.mjs --core http://localhost:8000 --dry-run     # guard test
record.mjs: --core → http://localhost:8000 is :8000. QUEUE_2026-10-03 forbids :8000; use the deployed core or :8001.
exit=1
```

### Dry run

```
$ node design/video/record.mjs --dry-run
record.mjs — Tacet / Mira · dry run (nothing launched, no network)
core      https://core-production-c5ac.up.railway.app
console   https://core-production-c5ac.up.railway.app (from /api/config at run time)
erp       https://erp-production-e3b0.up.railway.app (from /api/config at run time)
out       /Users/shubhamjoshi/Hacknation 2/design/video/frames
chrome    /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
viewport  1600x900 @1.5x
session   new REHEARSAL capture session (simulate:true), then a tutor session from it
proof     none — S3.2–S3.4 will be skipped (set --proof-session <sid>)

  S1.1  00:00–00:03  hook     The written process is from 2019.
  S1.2  00:03–00:08  hook     Sabine has done this for 24 years. She retires Friday.
  S2.1  00:08–00:12  capture  Before she touches it, Mira writes its guess down.
  S2.2  00:12–00:16  capture  She books it to 0400 — capex. The doc said 4711.
  S2.3  00:16–00:20  capture  It doesn't interrupt. It waits for a pause.
  S2.4  00:20–00:26  capture  Then it asks one question: what made her do that?
  S2.5  00:26–00:31  capture  Her answer becomes a rule. Before: 4711. Now: 0400.
  S2.6  00:31–00:34  capture  The before and the after, written down.
  S3.1  00:34–00:39  proof    Independent test. Pick the threshold she just taught.
  S3.2  00:39–00:44  proof    11 unseen invoices, committed with a hash before any label.
  S3.3  00:44–00:47  proof    Two are wrong. Both just under the line.
  S3.4  00:47–00:50  proof    Each miss corrects the map. Next round: 11 for 11.
  S4.1  00:50–00:54  tutor    Monday. A new hire gets the same invoices.
  S4.2  00:54–00:59  tutor    She codes it 4711, as the 2019 doc says.
  S4.3  00:59–01:03  tutor    Mira stops the save — in Sabine's words.
  S4.4  01:03–01:06  tutor    Then it steps back and lets her work.
  S5.1  01:06–01:10  close    The Work Map. Every line links to the moment and her words.
  S5.2  01:10–01:13  close    Exportable to agents — as guardrails, not advice.
  S5.3  01:13–01:15  close    Learns the part of the job nobody wrote down.
```

### End-to-end rehearsal run (deployed product, Chrome 154 headless, port 9223)

```
$ node design/video/record.mjs --no-sandbox --port 9223 --out design/video/frames
storyboard shots in doc: 19; in record.mjs: 19; total 75s
✓ STORYBOARD.md and record.mjs agree on every shot and on the 75s total
voiceover narration words: 147 (limit 170); whole file incl. timings: 168
✓ voiceover.txt within the 170-word limit
resolved from /api/config: console=https://core-production-c5ac.up.railway.app erp=https://erp-production-e3b0.up.railway.app
record.mjs — Tacet / Mira · 19/19 shots · out /Users/shubhamjoshi/Hacknation 2/design/video/frames
launched /Applications/Google Chrome.app/Contents/MacOS/Google Chrome (pid 86926, debug :9223)
S1.1  00:00–00:03  ✓  design/video/frames/S1.1-the-written-process-is-from-2019.png
S1.2  00:03–00:08  ✓  design/video/frames/S1.2-sabine-has-done-this-for-24-years-she-retires-fr.png
S2.1  00:08–00:12  ✓  design/video/frames/S2.1-before-she-touches-it-mira-writes-its-guess-down.png
    sim/step → decided inv-4471 (post)
S2.2  00:12–00:16  ✓  design/video/frames/S2.2-she-books-it-to-0400-capex-the-doc-said-4711.png
S2.3  00:16–00:20  ✓  design/video/frames/S2.3-it-doesnt-interrupt-it-waits-for-a-pause.png
    sim/step → answered “Equipment over five thousand euros net is always capex.…”
S2.4  00:20–00:26  ✓  design/video/frames/S2.4-then-it-asks-one-question-what-made-her-do-that.png
S2.5  00:26–00:31  ✓  design/video/frames/S2.5-her-answer-becomes-a-rule-before-4711-now-0400.png
    companion toast visible: yes
S2.6  00:31–00:34  ✓  design/video/frames/S2.6-the-before-and-the-after-written-down.png
S3.1  00:34–00:39  ✓  design/video/frames/S3.1-independent-test-pick-the-threshold-she-just-tau.png
S3.2  SKIP  no --proof-session (sealed tests are refused by rehearsal sessions)
S3.3  SKIP  no --proof-session (sealed tests are refused by rehearsal sessions)
S3.4  SKIP  no --proof-session (sealed tests are refused by rehearsal sessions)
S4.1  00:50–00:54  ✓  design/video/frames/S4.1-monday-a-new-hire-gets-the-same-invoices.png
S4.2  00:54–00:59  ✓  design/video/frames/S4.2-she-codes-it-4711-as-the-2019-doc-says.png
    tutor sim/step → trainee_mistake (blocked)
S4.3  00:59–01:03  ✓  design/video/frames/S4.3-mira-stops-the-save-in-sabines-words.png
S4.4  01:03–01:06  ✓  design/video/frames/S4.4-then-it-steps-back-and-lets-her-work.png
S5.1  01:06–01:10  ✓  design/video/frames/S5.1-the-work-map-every-line-links-to-the-moment-and-.png
S5.2  01:10–01:13  ✓  design/video/frames/S5.2-exportable-to-agents-as-guardrails-not-advice.png
S5.3  01:13–01:15  ✓  design/video/frames/S5.3-learns-the-part-of-the-job-nobody-wrote-down.png
done: 16 frame(s) written, manifest at design/video/frames/manifest.json
exit=0
```

Manifest summary (the final take):

```
mode: rehearsal (simulated expert)
capture session: 1f1e0b4607  tutor: bfdbb55d1a  proof: null
S1.1 0-3 frame      S3.1 34-39 frame    S4.4 63-66 frame
S1.2 3-8 frame      S3.2 39-44 SKIP     S5.1 66-70 frame
S2.1 8-12 frame     S3.3 44-47 SKIP     S5.2 70-73 frame
S2.2 12-16 frame    S3.4 47-50 SKIP     S5.3 73-75 frame
S2.3 16-20 frame    S4.1 50-54 frame
S2.4 20-26 frame    S4.2 54-59 frame
S2.5 26-31 frame    S4.3 59-63 frame
S2.6 31-34 frame
```

I inspected the frames directly (`read_image`): S1.1 quotes the real 2019 doc; S2.5 shows the receipt
`Cost center 4711 → 0400` with her quote and `~ T_capex → 4.999,5 on inv.net_eur`; S2.6 shows the companion
toast *"Noted: Equipment over 5,000 EUR net is capex / I'd have said 4711, now 0400"*; S4.3 shows the tutor
plate *"Sabine would stop here. Why do you think?"* with the quote *"Equipment over five thousand euros net is
always capex."*; S5.1 shows the Work Map `v1` with §3 carrying the learned rule and quote; S5.3 is the
tagline card. Every frame keeps the product's own `rehearsal · simulated …` mark visible.

## Findings and decisions

1. **`sim/step` alone is not enough to reach a state.** Two pages are required (notebook + ERP) or the
   companion misses `ask`/`learned`/`intervene` events while the notebook is being captured, and state must be
   read from the snapshot rather than assumed from a `sim/step` return value: `capture.js` opens cases on its
   own, so the first `sim/step` on an open case decides instead of opening. Fixed with `ensureCase`
   (DOM/`case_opened` nudge, wait for `current_case` + committed prediction) and `ensureDecided` (wait for an
   episode).
2. **Sessions are in memory on the deployed core.** During one take the Railway core restarted mid-run; the
   tutor session then silently inherited the seed-only map and filmed a block with no quote. `createTutorWithMap`
   now detects `map_source.kind !== "session"` / zero learned rules and rebuilds the capture map through the
   same simulated path, so this fails loudly or heals instead of producing a misleading frame.
3. **`innerText` is uppercased by `.label`.** `waitForText('Sealed boundary test')` and `waitForText('Signature')`
   failed against the real pages; the wait is now case-insensitive. `scrollToText` matches on `includes`.
4. **The tutor beat follows the doc, not capex.** Lena codes the €7,209 machine to 4711 (what the 2019 doc
   says) and the learned capex rule expects 0400 at €5,000 net, so the block is the rule Sabine taught. The
   original storyboard said 0410; corrected to 4711 to match both the doc and the simulator's wrong attempt.
5. **The storyboard's caption for S2.4 was aspirational.** The real question is
   *"You coded invoice 4471 to 0400 instead of 4711. What made you do that?"*; the card now matches the
   product and the voiceover line was rewritten to the same words.
6. **S3.2–S3.4 cannot be rehearsal frames.** `POST /api/sessions/{sid}/proofs` refuses Rehearsal sessions, so
   those three shots are documented as live inserts and are skipped unless `--proof-session` is given. S3.1
   films in Rehearsal and honestly shows `rehearsal session · tests disabled`.

## Open questions

1. **Where do S3.2–S3.4 come from?** The verified 2026-10-03 live run has the numbers (taught 3,600; round 1
   9/11; T → 4,069; after restart 11/11) but those sessions are gone from memory. Re-run the evaluator flow on
   the deployed build (it needs API keys in Railway) and film with `--proof-session <sid>`, or storyboard the
   three inserts from a screen recording of that flow.
2. **Product name.** The cards say "Tacet" / "Mira"; the real UI frames still say "shadow". Do we wait for T5's
   rename before the final take, or accept the "shadow" wordmark in the B-roll?
3. **Voice.** `voiceover.txt` is written for one narrator plus two quoted turns (Mira/Sabine). Should the
   ElevenLabs read use the interviewer agent's voice (consistent with the product), or a separate narrator and
   two character voices? The file's `(Mira)`/`(Sabine)` marks are there for the latter.
4. **Length.** 75.0 s fits 19 shots with long holds. If the submission limit is shorter, the storyboard's beat
   notes mark the proof section as the first thing to compress (S3.1 + one proof sheet instead of three).
5. **Captions as burned-in text or a separate SRT?** README supports both; a final call needs the chosen font
   sizes so the lower-third never covers the receipt amounts.
