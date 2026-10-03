# DeepSeek companion task — report

Task: `design/tasks/DEEPSEEK_COMPANION.md` — put the `advisory/companion-design-2026-10-03/`
pixel-intern companion into the live capture script, visual layer only.
Status: **done**. No commit, no push, no server restart.

## What changed

One file: `backend/shadow/static/capture.js`.

Edit boundary was exactly the UI section, from
`// ------------------------------------------------------------- UI (shadow DOM ...)`
(line 215) through `render()`, `flash()`, `toast()` (line 449). I spliced the new section in and
verified programmatically that the bytes **before** and **after** that range are unchanged from
the previous revision (242 UI lines replaced by 228). Nothing else in the file was touched:
WebSocket/session logic, `send()`, `onServer()` transitions, `window.shadow.beforeSave`, PII rects,
activity events, `startVoice`/`voiceStatus`/`EL_CDN`/agent ids, and `ask_now`/`ask_later`/record
semantics are all byte-identical.

Inside the UI section:

- **Artwork.** Replaced the hand-drawn SVG kid with the sprite sheet at
  `API + "/companion/intern.png"`: `<svg viewBox="145 96 426 520">`, a blink layer that is the
  same image translated `-552 0` and clipped to the two eye ellipses, and a curl layer clipped to
  the hair path — exactly as `shadow-companion.js`. Portrait is `56px` wide, height `×1.23`,
  `image-rendering:pixelated`. It is the only figure.
- **Seven design states** in the exact priority from the spec:
  `offline → offline`; `F.off → paused`; `F.asking || F.hand → question` (badge `?`);
  `F.learned → learned` (badge `✓`); `F.thinking → thinking`; voice listening
  (`V.conv && !V.speaking && /listen/i.test(V.status)`) `→ listening`; otherwise `idle`.
  `paused` badge `Ⅱ`, `offline` badge `–`. The state drives a `state-*` class, the badge, the
  hover hint and the panel status line.
- **Palette/type** taken from the design: paper `#fffdf7`, ink `#30362f`, muted `#697165`,
  line `#e0e3d8`, accent `#627857`, system sans 13px. Panel/caption/toast/card radius `12px`
  (the spec's `≤ 12px` overrides the study's 15px) and the single soft shadow
  `0 8px 26px #26321d12`. Expert quotes (`q` in tutor interventions) are Georgia/serif italic.
- **Refused list honourned.** No halo, sparkles, neon, gradients, bounce or scale loops;
  `grep -c "sparks\|glow\|breathe"` is 0. The only loops are the blink and the curl, and both stop
  in `paused`/`offline` and under `prefers-reduced-motion` (plus a hook-driven `still` class).
  No emoji anywhere (the old microphone glyph was removed from the caption hint).
- **Idle/hover/question.** Idle portrait is `opacity:.86`, question/listening `1`; a paper hover
  hint ("Here when you need me", state-specific text) sits to the left; the question caption is a
  small paper card above her (not a chat bubble) and keeps the existing `#cap-in` Enter-to-answer
  field.
- **Toast.** Paper card, one or two short lines, "Noted" in sage bold, e.g.
  "Noted: Equipment over 3,600 net is capex" / "I'd have said 4711, now 0400".

Every existing control is kept with the same IDs and the same wiring: `#kid`, `#later`, `#cap-in`,
`#b-ask`, `#b-voice`, `#b-off`, `#b-debrief`, `#b-teach`, `#nb`, `#v-st`/`#v-t`, the three metric
rows, `#cards`, `#toast`, `#hc`. I statically verified every `$("…")` id in the file still exists in
the markup, and added only one new listener (the new panel close button `#b-close`, UI-only).

**Test hook.** Added `window.__shadowCompanion` in the UI section:
`setState(name)` (the seven design states, plus `setPanel`, `setHint`, `setMotion`, `showToast`,
`clear`) so the harness can force each state with no server.

### Visual-only things removed (with reasoning)

The old companion had flourish cues that are not in the seven-state design. They are gone as
*pictures*, while the logic that sets those flags is untouched: pointer-following pupils, the
`guess` dot, the `busy` dim, and the graduation-cap / raised-arm / spark / ring marks.
`flash("spark"|"okc"|"hush")` is still defined and still called by `onServer`, but now only toggles
a `data-signal` attribute (no motion), so `tutor_ok` and `silence` keep working without violating
the refused list.

## Files created

- `design/tasks/companion-harness.html` — sets `window.SHADOW_API = "http://localhost:8000"`,
  loads `../../backend/shadow/static/capture.js`, renders seven buttons that call
  `window.__shadowCompanion.setState(...)`, plus panel/hint/toast/reduced-motion buttons, and
  accepts `?state=…&panel=1&hint=1&toast=1&motion=off` so each state can be screenshotted headlessly.
- `design/tasks/shots/` — the screenshots below.
- `design/tasks/DEEPSEEK_COMPANION_REPORT.md` — this file.

## Screenshots (headless Chrome, 1200×800)

Seven states, one per design state:

| state | file | reads |
| --- | --- | --- |
| idle | `design/tasks/shots/idle.png` | portrait at .86, no badge |
| question | `design/tasks/shots/question.png` | badge `?`, paper question card + answer field above her |
| listening | `design/tasks/shots/listening.png` | portrait at 1 |
| thinking | `design/tasks/shots/thinking.png` | portrait, no badge |
| learned | `design/tasks/shots/learned.png` | badge `✓` |
| paused | `design/tasks/shots/paused.png` | badge `Ⅱ`, desaturated portrait |
| offline | `design/tasks/shots/offline.png` | badge `–`, desaturated portrait |

Three supplementary checks: `panel-open.png` (paper notebook panel, metrics, sage buttons, close),
`hover-hint.png` ("Here when you need me" to the left), `toast.png` (the two-line paper toast).

## Acceptance checks (run)

```
$ node -e "new (require('vm').Script)(require('fs').readFileSync('backend/shadow/static/capture.js','utf8'))"
# ok
$ grep -c "sparks\|glow\|breathe" backend/shadow/static/capture.js
0
```

The live backend also serves the new script: `curl http://localhost:8000/capture.js` contains the
new UI markers (the `/capture.js` route is `Cache-Control: no-store` and reads from disk).

## What I could not do / caveats

- **The running backend predates the artwork route.** On this machine a `shadow.main:app` process
  has been listening on `127.0.0.1:8000` since before `@app.get("/companion/intern.png")` existed
  and before `backend/shadow/static/intern.png` was added; it answers `404` for that path. Per the
  task I did **not** restart it. So `http://localhost:8000/capture.js` already delivers the new UI,
  but the portrait will 404 in the live ERP until whoever owns the server restarts it (the route
  and the file are already present in the working tree, ready for that restart). I verified the
  source route and the file independently.
- For the harness screenshots I mounted the same `backend/shadow/static/intern.png` behind a
  temporary local proxy (`127.0.0.1:8099`) and pointed headless Chrome at it with
  `--proxy-server` + `--proxy-bypass-list="<-loopback>"`, so `window.SHADOW_API` could stay exactly
  `http://localhost:8000` as the task requires. The proxy was a `/tmp` script, served only the one
  PNG, never forwarded to `:8000`, and was stopped afterwards.
- Headless Chrome 154 writes the `--screenshot` file but does not exit in this environment, so each
  capture was killed once the PNG size was stable (the file itself is complete). One leftover test
  browser process was terminated; the machine's normal (non-headless) Chrome was left alone.
- The notebook link is hidden in the panel screenshot because `SID` is null in the harness — that is
  the pre-existing render rule (`nb.style.display = "none"` without a session), not a regression.
- Nothing is committed or pushed.
