# Sol task — "Learn this task": a brand-new workflow, end to end

Repo: /Users/shubhamjoshi/Hacknation 2. Read `CLAUDE.md`, `SHADOW_ARCHITECTURE.md` (skim), and these first:
`backend/shadow/main.py` (`/api/onboard`, `/api/workflows/*`, sessions, `/events`), `backend/shadow/onboard.py`,
`backend/shadow/taskdef.py`, `backend/shadow/packs/generic.py`, `backend/shadow/packs/__init__.py`,
`backend/shadow/workflows.py`, `backend/shadow/static/observe.js`, `backend/shadow/static/capture.js` (the companion),
`extension/` (MV3; `extension/sync.sh` copies capture.js/observe.js into `extension/vendor/`), `console/src/pages/Home.tsx`.

## Why
The product claims it is task-agnostic: an expert on ANY web page turns Mira on, chooses **"Learn this task"**,
does the work a few times, and Mira then predicts / asks at pauses / compiles answers into a Work Map exactly as it
does for the built-in AP-invoice ERP. The server pieces exist (observe.js, /api/onboard, GenericPack, workflow
registry with signature matching), but there is **no "Learn this task" control anywhere**, and nobody has proven the
loop works on a workflow the code has never seen. Home.tsx already tells users to press that button.

## Do
1. **Truth test first.** Start an isolated core: `cd backend && .venv/bin/uvicorn shadow.main:app --port 8001`
   (NEVER use :8000; keys load from backend/.env, never print them). Build a small static test page that is NOT
   invoices (e.g. a travel/expense approval or support-ticket triage form — your choice, put it in
   `backend/tests/fixtures/` or `design/tasks/sol_fixture/`). Drive it headlessly (Chrome CDP or Playwright if
   available) with observe.js: 3 demonstrations → `/api/onboard` → a capture session → more cases where the expert
   deviates from what the map predicts → confirm a question is asked at a pause → answer it (typed utterance endpoint)
   → a rule compiles → later prediction changes → debrief/map/export work → tutor session on that workflow uses the
   map → `/api/workflows/match` says "same" when revisiting the page. Write down every break.
2. **Fix what breaks**, in the backend generically (no per-fixture hacks, no `inv.`-specific paths). You are the only
   agent touching `backend/shadow/**` right now, including `engine.py`. Add pytest coverage for the new-workflow loop
   (offline: LLM calls may be stubbed like the existing tests do). `cd backend && .venv/bin/pytest -q` must pass.
3. **Build "Learn this task"** in the companion (`capture.js`) for pages without a session: a control in the panel →
   asks for a one-line goal → watch mode (clearly visible "watching" state, Stop) collecting observe.js events per
   demonstration (one demonstration = until a submit/save-like action) → after ≥1–3 demos, "Done showing" → POST
   `/api/onboard` with `events: true` → pin the returned session and continue in normal capture. If
   `/api/workflows/match` says "same" for the page, offer to continue that workflow instead; "ask" → ask the user.
   Match the existing companion visual language exactly (warm paper panel, sage accent, no new colors, no emoji,
   copy in the product's calm voice; product name Tacet, apprentice Mira). Then run `bash extension/sync.sh`, make
   sure the extension's popup/background allow this flow on any enabled site (it injects capture.js + observe.js).
4. Verify the companion UI visually (screenshots in `design/tasks/shots/sol-*`), on your fixture page via :8001.

## Rules
- Don't commit or push; Opus reviews and commits. Don't touch `site/`, `design/film/`, `design/video/`,
  `console/` except the one Home.tsx sentence if wording must change. No secrets in any file or log.
- Keep honesty: live vs practice explicit, never fall back to the simulator silently.
- Budget: prefer the cheap LLM tiers; check `/health` spend on :8001 and keep the whole test under ~$1.

## Report
`design/tasks/SOL_NEW_WORKFLOW_REPORT.md`: what you tested (the exact flow), what broke and how you fixed it (files +
why), test results, screenshots, remaining limits stated plainly. Stop the :8001 server when done.
