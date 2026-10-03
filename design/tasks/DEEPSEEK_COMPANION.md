# Task: put Codex's pixel-intern companion into the live capture script

Owner: DeepSeek (headless). Reviewer and visual judge: Claude (Opus). Do not commit or push.

## Goal
`backend/shadow/static/capture.js` draws Shadow's in-app companion (bottom-right, inside a shadow DOM) as a hand-drawn
SVG kid with glow, sparkles and a breathing loop. Replace **only its visual layer** with the design in
`advisory/companion-design-2026-10-03/` (`shadow-companion.js` + `index.html`): the pixel-art intern portrait with
round glasses and a notebook, warm paper panel, sage accent, one soft blink and a rare curl shift, a small square badge
for state. Read both files fully first.

## Files you may edit
- `backend/shadow/static/capture.js` — ONLY the UI section (from the `// ---- UI (shadow DOM ...)` comment through
  `render()`, `flash()`, `toast()` and the panel markup). Nothing else.

## Do not touch
Everything else, including: WebSocket/session logic, `send()`, `onServer()` state transitions, `window.shadow.beforeSave`,
PII rect reporting, activity events, the ElevenLabs voice code (`startVoice`, `voiceStatus`, `EL_CDN`, agent ids),
`ask_now` / `ask_later` / record toggling semantics. Every existing control must keep working with the same wiring:
raise-hand → "ask me now" / "later", the question caption with the type-to-answer field, voice start/stop + status,
off-the-record toggle, notebook link (`CONSOLE`), metrics rows, toasts after `learned`, tutor interventions.

## Visual spec (judge will check each)
1. Artwork: the sprite sheet is served at `API + "/companion/intern.png"` (1254×1254). Crop exactly like
   `shadow-companion.js`: `<svg viewBox="145 96 426 520">`, a blink layer that is the same image translated `-552 0`
   clipped to the eye ellipses, and the curl layer. Portrait 56px wide (height ×1.23). No other figure.
2. Map the script's flags `F` onto the seven design states: offline → offline; off → paused; asking or hand → question
   (badge `?`); learned → learned (badge `✓`); thinking → thinking; voice listening → listening; otherwise idle. Tutor
   intervention keeps using the question style with the expert's quote.
3. Palette and type exactly from the design: paper `#fffdf7`, ink `#30362f`, muted `#697165`, line `#e0e3d8`, accent
   `#627857`, system sans 13px; panel radius ≤ 12px, a single soft shadow `0 8px 26px #26321d12`. Expert quotes inside
   the panel in Georgia/serif italic.
4. Refused: glow, sparkles, neon, gradients, bouncing, breathing/scaling loops, emoji. The only loops are the blink and
   the curl, and both stop under `prefers-reduced-motion` and in paused/offline.
5. Idle the portrait sits at ~0.86 opacity; question/listening at 1. A hover hint ("Here when you need me") appears to
   the left. The question caption appears as a small paper card above her, not a chat bubble.
6. Toast after learning: one or two short lines on paper, e.g. "Noted: Equipment over 3,600 net is capex" and
   "I'd have said 4711, now 0400". Wording "Noted" (captured, not verified).

## Acceptance checks (run them)
- `node -e "new (require('vm').Script)(require('fs').readFileSync('backend/shadow/static/capture.js','utf8'))"` passes.
- `grep -c "sparks\|glow\|breathe" backend/shadow/static/capture.js` → 0.
- Render a standalone harness: create `design/tasks/companion-harness.html` that sets `window.SHADOW_API =
  "http://localhost:8000"`, loads `../../backend/shadow/static/capture.js`, and adds buttons that call a test hook to
  set each state. Screenshot each of the 7 states with headless Chrome (1200×800) into `design/tasks/shots/`.
- Write `design/tasks/DEEPSEEK_COMPANION_REPORT.md`: what changed, the screenshot list, anything you could not do.
