# Task: the companion runs the session (one surface for the expert)

Owner: DeepSeek (headless). Reviewer/integrator: Claude. Do not commit or push.
Read first: `design/DESIGN.md`, `design/tasks/DEEPSEEK_COMPANION_REPORT.md` (your previous work on this file).

## Why
Experts were confused: the ERP works on its own, while a separate console asked them to share their screen. Decision:
the expert only ever deals with the companion inside their work app. The console becomes "the notebook" for
reviewers, opened from her panel.

## File you may edit
`backend/shadow/static/capture.js` only. Allowed regions: the config/pinning lines at the top (`PINNED`, `SID`,
`CONSOLE`), `connect()`, `ensureSession()`, the UI section, and a new small "session controls" function block.
Do NOT touch: `send()` semantics, `onServer()` state transitions, `window.shadow.beforeSave`, PII rects, activity
events, the ElevenLabs voice code (`startVoice`, `voiceStatus`, `EL_CDN`, agent ids), `ask_now`/`ask_later`/record.

## Backend contract (Claude implements; code against it)
- `POST /api/sessions` body `{"mode":"capture"}` → snapshot JSON with `id`, `mode`, `expert`.
- `POST /api/sessions/{sid}/end` → `{"ended": true}`; afterwards the server sends `{"type":"ended"}` on the socket.
- `GET /api/config` → `{"agents":{...}, "public_url":..., "console_url": "<origin of the notebook>", "erp_url": ...}`.
  `console_url` may be "" meaning "same origin as the API".
- WebSocket `/ws/capture?session=<sid>` pins the observer to one session.

## Required behaviour
1. **Session pinning that survives navigation and reloads.** Resolve the session in this order: `?shadow=<sid>` in the
   URL, then `sessionStorage["shadow.session"]`, else unpinned (follows latest, as today). Whenever a session becomes
   pinned (from the URL, from "Start session", or from a `{"type":"session"}` message while unpinned), write it to
   `sessionStorage["shadow.session"]`. On "End session", remove it. Wrap storage access in try/catch.
2. **Notebook URL.** Build it as `(config.console_url || API) + "/s/" + SID`. Fetch `/api/config` once; fall back to
   API origin. Remove the hard-coded `localhost:5173` default.
3. **Panel: a session row** at the top of the notebook panel:
   - no session: one line "Not recording" + primary button **Start session** (creates a capture session, pins it, sends
     `hello`, re-renders).
   - live session: `Session <first 6 chars> · capture|debrief|tutor` + **Open notebook ↗** + **End session**
     (confirm inline: the button turns into "End? yes / no", no `window.confirm`).
   - Keep the existing Start voice / Off the record / metrics rows below it.
4. **Replays toggle (optional recording).** A row "Replays: off" with a switch. Turning it on calls
   `navigator.mediaDevices.getDisplayMedia({video:true, preferCurrentTab:true})`; frames are NOT uploaded — keep the
   last 120 JPEG blobs in memory at 1 fps (drop oldest), stop tracks when turned off or when the session ends. Show
   "Replays: on · N frames kept on this device". If the user cancels the picker, revert to off silently.
5. **Name in one place.** Introduce `var NAME = window.SHADOW_NAME || "Shadow";` and use it for every user-visible
   product-name string you touch (hints, panel title). The product may be renamed; this must be a one-line change.
6. Keep every visual rule from `design/DESIGN.md` and the companion design (paper, sage, no glow/emoji/loops other than
   blink/curl).

## Acceptance
- `node -e "new (require('vm').Script)(require('fs').readFileSync('backend/shadow/static/capture.js','utf8'))"` passes.
- Update `design/tasks/companion-harness.html` if needed; it must default to `http://localhost:8001` (never 8000).
  Screenshot: panel with no session, panel with a live session, end-confirm state, replays on. Save to
  `design/tasks/shots/session-*.png`.
- Write `design/tasks/DEEPSEEK_COMPANION_SESSION_REPORT.md` with the exact line ranges you changed.
