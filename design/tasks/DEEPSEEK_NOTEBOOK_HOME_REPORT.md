# DEEPSEEK_NOTEBOOK_HOME — report

Task: `design/tasks/DEEPSEEK_NOTEBOOK_HOME.md` · Owner: DeepSeek · Status: implemented, checked, **not committed**.
Owned files touched: `console/src/pages/Home.tsx` (rewritten) and this report. Nothing else was edited — no CSS,
components, other routes, backend or landing page. No commits, deploys or shared servers. No real backend session
was created; every network call in the smoke was mocked in the browser.

## What the page is now

Top-to-bottom, one register (Geist / Newsreader / IBM Plex Mono, paper–ink–sage, 1px rules, radius ≤ 3px):

1. **Header** — a 1180px container matching the landing (`site/index.html --maxw`). Wordmark left; a quiet
   `Product home` link to `/` (the console is mounted at `/app`) and a single `Connecting → Connected / Unavailable`
   state on the right, carried by a 6px square **and** the word. Core/LLM status and spend moved out of the header.
2. **Intro** — eyebrow `Your notebook`; serif `Teach Mira how you work.` at 48px desktop / 34px mobile; one 17px
   sentence *“Show the decisions you make. Mira learns the rules, then helps someone else follow them.”* The old
   tagline, the Nordwerk kicker and the long paragraph are gone.
3. **Choose a workflow** (before any start) — 16px heading, every existing radio option, selected workflow retained.
   Names at 16px; subordinate 14px metadata with a provenance glyph (`§` built in / `▮` learned from a person) plus
   expert/learner names. Selection is a thin 2px sage left rule. No technical version or session counts. Loading
   (`Loading workflows…`), error (`Couldn’t load workflows — using the default.`) and truthful empty state.
4. **Actions** — desktop two columns ~60/40 divided by a hairline (`3fr_2fr`, `md:border-l`), stacked on mobile.
   No enclosing cards. `1` serif *Learn from an expert* 30px + 44px filled-ink `Start capture`, with the compact
   `Expert speaks` select beside it; `2` serif *Teach someone new* 30px + 44px quiet outline `Start tutoring`.
   Busy disables both and shows mode-specific progress. `rehearsal` shows a visible **Practice mode** plate before
   the starts (not hidden in settings).
5. **Session start errors** — `role="alert"`, placed beside the actions, outside `<details>`; a failed start can
   never be hidden in the collapsed settings.
6. **Working in another app?** — explains the extension on the work page → turn Mira on → `Learn this task`, and
   that the result appears above as another selectable workflow. No invented install link, no generic onboarding.
7. **Continue a session** — readable rows: human mode label (`Expert` / `New hire`) + expert at 14px, `cases ·
   rules` at 14px, id subordinate in 11px mono. Same `nav(/s/:id)`; no sessions dropped.
8. **Settings & diagnostics** — a closed `<details>` at the foot: both ElevenLabs agent fields (same localStorage
   keys and `onBlur` save), provider check (now with `checking` state **and** a caught error line), Live/Practice
   toggle, `continue from saved map`, and the moved connection block (core, LLM key, `$spend · calls`). Responsive
   1/2/3-column grid; no API, payload, routing or default changes.

## What was preserved

- `start()` payloads byte-for-byte:
  - capture → `{"mode":"capture","lang":<lang>,"pack":<workflow>,"simulate":<rehearsal>,"fresh":<!continueSaved>}`
  - tutor → `{"mode":"tutor","trainee":"Lena","pack":<workflow>,"from_session":<matching capture session|null>,"simulate":<rehearsal>}`
- `/api/config`, `/health`, `/api/sessions`, `/api/workflows`, `/api/llm/check` calls and their error tolerance.
- localStorage semantics (`shadow.agent.interviewer` / `shadow.agent.tutor`) and all state defaults
  (`workflow='ap_invoices'`, `lang='en'`, `continueSaved=false`, rehearsal off until a health/provider signal).
- Only local presentation state was added: `wfState`, `checking`, `checkError`; `busy` became a mode string so the
  progress line can name the action (`Starting capture…` / `Starting tutoring…`). This is not persisted.

## Validation

**Build** — `cd console && npm run build` (tsc -b && vite build): pass, 109 modules, no TS errors.
Only new artefacts in the untracked `console/dist` (git does not track `dist`).

**Focused mocked-API browser smoke** — `/private/tmp/tacet-home-smoke/smoke.cjs`, Playwright 1.63 via
`chromium.launch({ channel: 'chrome' })` (system Chrome, headless), static server for `console/dist`, every
`/api/*` + `/health` response intercepted. **27/27 checks pass, 0 page errors.** Coverage:

| Area | Checks |
| --- | --- |
| Desktop 1440 | no horizontal overflow (`scrollW-innerW=0`), 1180px header, new intro copy, legacy tagline + Nordwerk kicker absent, `Connected` state, `Product home` link |
| Diagnostics | `<details>` closed by default, content not visible, health + `$1.234 · 12 calls` present inside it |
| Mobile 390 | no horizontal overflow (`scrollW-innerW=0`), both CTAs present, stacked layout |
| Workflows | 2 radios, default selected, selection retained, no `v\d`/session counts, built-in/learned metadata present |
| Payloads | capture `{"mode":"capture","lang":"de","pack":"expense_claims","simulate":false,"fresh":true}`; tutor `{"mode":"tutor","trainee":"Lena","pack":"ap_invoices","from_session":"S-2026-0001","simulate":false}` |
| Busy guard | both CTAs disabled while a start is in flight, exactly one POST issued |
| Error | 500 → visible `role="alert"`, outside `<details>`, text `Couldn’t start the session` |
| Practice | `llm:false` health → `Practice mode.` notice visible before any start |

Screenshots (one desktop, one mobile, full page): `/private/tmp/tacet-home-smoke/home-desktop-1440.png`,
`/private/tmp/tacet-home-smoke/home-mobile-390.png`. Result JSON: `/private/tmp/tacet-home-smoke/result.json`.

## Limits / notes for review

- The smoke is mocked and presentation-focused: it proves no overflow, correct states, and unchanged request
  bodies; it does **not** exercise the real backend, WebSocket routing after a start, or real ElevenLabs.
- “Product home” points at `/` (the landing mounted by `backend/shadow/main.py`); if the console is ever served
  without the landing at `/`, that link should be revisited.
- I did not re-run any other suite or start any server.

## Primary review

Reviewed the Home-only diff and the local browser preview. Shortened action descriptions
and extension guidance, increased action body text to16px, and aligned the desktop CTAs
at the bottom of their columns. Simplified the visible German option label; it still sends
lang de and tutor behavior is unchanged. No shared style/component/engine/route edits.

After those edits: console production build passes (existing large-bundle warning),
focused mocked smoke rerun passes27/27 with0 page errors. Exact POST bodies retained,
including learned workflow selection, language, tutor source map, busy and visible-error
behavior. The root ERP build also passed; ERP source was not modified.

Preserved the final result, harness and desktop/mobile390 screenshots under design/tasks.
The harness retains local absolute paths; these must be adjusted when run elsewhere.
Mocked screenshots include example workflows/sessions and are layout evidence, not
live product data. Live verification follows deployment. No real session was created
for the visual review.

## Live deployment verification

Railway Core deployment b2d1d7c4-6f42-49e2-8446-770ee4282868 succeeded.
Public /app JS and CSS byte-equal the local tested production build. HTTPS200 for
notebook, health, workflows, config, landing and privacy page. User Chrome shows
new heading and both start actions, closed diagnostics, and no horizontal overflow
at1280px. Live screenshot saved in shots/notebook-home-live.jpg. No live session
creation or voice call was performed; preservation evidence comes from unchanged
request handlers and the mocked27-check smoke.
