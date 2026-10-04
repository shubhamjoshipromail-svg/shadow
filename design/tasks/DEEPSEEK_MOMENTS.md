# DeepSeek task — clickable screen moments on the Work Map

Repo root: /Users/shubhamjoshi/Hacknation 2. Product Tacet, apprentice Mira. Read `design/DESIGN.md`,
`console/src/pages/MapPage.tsx`, `console/src/lib/types.ts`, `console/src/lib/api.ts`, `console/src/components/ui.tsx`,
and in the backend (READ ONLY) `backend/shadow/workmap.py` (ScreenMoment), `backend/shadow/main.py` (session snapshot,
frames/replay endpoints if any), `backend/shadow/static/capture.js` (search "replay" / frames kept in the browser).

The brief requires: "The Work Map: a clickable timeline where every step shows the screen moment, the decision, the
reason in the expert's words and the guardrails around it." Today MapPage shows each step's screen moment as a plain
`▶ 03:12 · invoice 4471` span that does nothing.

You own ONLY `console/src/pages/MapPage.tsx` and a NEW `console/src/components/Moment.tsx`. Do not edit any other file
(other agents are editing console/** and backend right now). Never use port 8000. No commits.

Make every screen moment (on steps, rules and guardrails that have one) a button that opens an inline moment panel
under that row: the timestamp, the case/entity, the field and the before → after change, the expert's quote spoken at
that moment (from the step's/rule's evidence or receipts in the snapshot), the attention path if present
(`ScreenMoment.path`), and a frame image if the snapshot exposes one (only if an existing endpoint serves it; never invent
one). Keyboard accessible, one open at a time, Escape closes. Design system only: hairline rules, Mono for time/codes,
Newsreader for the quote, provenance glyphs via <Mark/>, no cards/pills/shadows/gradients, motion ≤ 240ms. If a moment has
no data beyond the timestamp, show what exists and say "frame not kept" in muted mono (frames stay in the browser for
privacy).

Check: `cd console && npx tsc --noEmit -p . && npm run build` pass. Write
`design/tasks/DEEPSEEK_MOMENTS_REPORT.md` with what fields you used and a screenshot if you can (console against the
deployed API is fine: https://tacet.up.railway.app — read only).
