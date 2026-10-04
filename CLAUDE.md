# Tacet — project context for Claude Code sessions

**Tacet** is an AI apprentice that learns *what the AI doesn't already know*. It predicts an expert's decision before they make it; when the expert does something it can't explain, it waits for a natural pause and asks one question; the answer becomes an executable, behavior-verified **Work Map** that then teaches a new hire (and can be exported for agents). Built for the HackNation × ElevenLabs "AI Apprentice" challenge (brief: Capture / Map / Teach + the five Apprentice Tests). Owner: Shubham (solo).

Read first: `SHADOW_ARCHITECTURE.md` (design + reasoning), `SABINE_ROLE_CARD.md` (the demo expert's hidden rules), `advisory/` (independent reviews: advice, not spec).

## Repo layout
- `/` (root) — **Nordwerk ERP**, the observed sandbox app. Lovable project (TanStack Start), synced to GitHub `shubhamjoshipromail-svg/shadow` (private). **Keep it at the root. Never force-push or rewrite pushed history on `main`** (Lovable mirrors it). Observer contract: `src/lib/erp/shadow.ts`.
- `backend/` — **Tacet Core** (FastAPI + numpy). The engine is plain Python; LLMs only translate.
  - `shadow/engine.py` the loop: predict → gap (parametric vs structural) → hypotheses → EVOI vs interruption cost → ask at pause → compile answer → retro-replay → debrief (coverage / conflict / exploration probes, frozen self-exam, teach-back) → tutor (save intercept, BKT mastery)
  - `receipts.py` learning receipts (before/after prediction, quote, rule + param diff, provenance, later independent checks); `proof.py` sealed boundary tests (fresh cases around a learned threshold, predictions frozen + SHA-256 committed before labels, labels from humans only, each label also teaches)
  - `workmap.py` executable Work Map + belief ("words propose, behavior disposes"); `bayes.py` threshold posteriors + BALD; `planner.py` EVOI, pause gate, LinTS question-type bandit; `hypotheses.py`; `compiler.py`; `novice.py`; `perception.py` (vision)
  - `llm.py` / `llm_openai.py` provider routing per tier: vision → gpt-6-luna, fast/spoken → claude-haiku-4-5, reason/compile → claude-sonnet-5-5; failover + spend meter (`/health`)
  - `converse.py` ElevenLabs **Custom LLM** brain (`/v1/chat/completions`): control tags `[[shadow:ask|debrief|intervene|say …]]`; filler/idle turns → `skip_turn` tool call (an empty reply makes ElevenLabs retry and stall)
  - `packs/ap_invoices/` the only workflow pack (process doc, cases, perturbations, exploration priors) + `oracle.py` (hidden rules for simulation only)
  - `sim.py` simulated expert (Rehearsal mode, tests, eval) — never a live-learning claim
  - `static/capture.js` observer + **Tacet student companion** + in-page ElevenLabs voice (served at `/capture.js`)
  - `scripts/`: `set_keys.py` (hidden key entry → `backend/.env`), `setup_elevenlabs.py` (create/update the two agents), `eval_curves.py` (held-out comparison → `eval_out/`)
- `console/` — Tacet console / "notebook" (React + Vite + ElevenLabs React SDK). Optional for experts; judges' view of predictions, hypotheses, Work Map, learning receipts; `/s/:sid/proof` is the evaluator's sealed-test page.

## Run
```bash
cd backend && .venv/bin/uvicorn shadow.main:app --port 8000      # no --reload: reloads wipe in-memory sessions
cd console && npm run dev                                          # :5173
npm run dev -- --port 8080                                         # ERP at root (deps via `npx bun install`)
ngrok http 8000                                                    # public URL for ElevenLabs; then:
cd backend && .venv/bin/python scripts/setup_elevenlabs.py --public-url <ngrok url>
```
Keys live in `backend/.env` (gitignored): ANTHROPIC_API_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY. Agent ids in `backend/.elevenlabs_agents.json` (gitignored; served via `/api/config`). Tests: `cd backend && .venv/bin/pytest -q`. Voice must be tested in real Chrome — the Claude app's browser pane blocks microphones.

## Conventions
- Commit messages end with `Co-Authored-By: WOZCODE <contact@withwoz.com>`. Commit + push to `main` after each verified step (user asked for this). Run tests before committing.
- Don't restart the backend while the user is testing without saying so (sessions are in memory).
- Live vs Rehearsal is explicit: never silently fall back to the simulator.
- Product principle from the user: **never make it "less"** — rigor yes, timidity no. Tacet should feel like a real shadow: invisible until wanted.
- Budget is tight (~$4 Anthropic, ~$4 OpenAI): prefer cheap tiers, check `/health` spend.

## Multi-agent coordination (Claude Code ↔ Codex ↔ Astra)
- **Claude Code (Opus) owns integration, `backend/shadow/**`, `console/**`, commits and pushes.**
- Codex / other agents take bounded tasks only: assignments in `advisory/codex-coordination/OPUS_TASKS.md` (exact file ownership + acceptance checks + do-not-touch list); they report in `CODEX_STATUS.md` / `*_REPORT.md`, don't commit, and never edit files outside their ownership.
- Astra writes reviews into `advisory/<topic>-<date>/` only. Treat as advice; adopt only what makes the product meaningfully better.
- Never have two agents edit `engine.py` at once.

## Status (2026-10-03, submission-ready)
Product is **Tacet**, apprentice character **Mira** (tutor teaches **Lena**). Live at https://tacet.up.railway.app (landing + film, console `/app`, sealed test `/app/s/<sid>/proof`, Work Map MCP `/mcp`); ERP sandbox https://erp-production-e3b0.up.railway.app (Invoices = built-in AP pack; `/support` = Support desk learned from scratch). Railway project `hacknation-apprentice`, us-west2: `core` (API + console + site, Postgres) and `erp`.

Working end to end: live predictions → gap → one question at a pause → real Claude compile of spoken/typed answers → receipts → sealed boundary tests → debrief (self-exam, teach-back) → tutor blocks a wrong save with the expert's words → report card. Voice: two ElevenLabs agents (interviewer, tutor) on **Eleven v4 Turbo**, Custom LLM → `/v1/chat/completions`, Work Map MCP attached (`setup_elevenlabs.py --mcp`).
- **New-workflow path ("Learn this task") verified live on the Support desk**: goal + demos → runtime task definition → question → compiled rules; questions read like speech (item named by its own id, lowercase scraped labels, open decision controls never treated as facts). Verified on one structured form only, not arbitrary sites.
- Live proof (2026-10-03): taught 3,600, evaluator labelled at 4,000: round 1 9/11 (misses in the 3,600-4,000 band), T moved to 4,069, after restart 11/11.
- Eval (scripted expert, oracle-assisted, held out; not a human result): doc-only 38% / always-ask-why 73% / Tacet 98%; 70% vs 60% at 40% corrupted answers.
- Stretch goals shipped: vision frames → events, tutor report card, Work Map MCP, two experts (`compare.py`, offline-tested), German expert / English tutor (tests; 2 xfail leaks), Chrome extension (unpacked, store pack prepared, not submitted), film with German dub (ElevenLabs TTS v4 + Music + dubbing).
- Tests: `cd backend && .venv/bin/pytest -q` = 269 passed, 2 xfailed, 2 xpassed.
- Submission docs: `README.md` (judge path, brief mapping, honest limits) and `SUBMISSION.md` (form text). Keep them truthful when behavior changes.

Known gaps (see `design/tasks/PRODUCT_READINESS_REVIEW_2026-10-03.md`):
1. Universal tutor enforcement: arbitrary sites don't await `window.shadow.beforeSave`; only the ERP blocks saves.
2. One capture owner per session (console vision vs companion replay are separate streams).
3. Sessions are in memory (a restart ends them; maps persist); receipts per session, `/api/history` across sessions. No self-service delete.
4. Rules referencing facts not on screen compile but never fire → should ask "where do you look it up?".
5. Extension: bundle is local, but voice needs a live mic smoke test in MV3; store submission pending.
6. No LICENSE file (owner to choose).

## Handoff
- Film audio is being regenerated (`design/film/`, `site/assets/`): don't touch those while it runs.
- Keys live only in `backend/.env` and Railway variables; `setup_elevenlabs.py --public-url https://tacet.up.railway.app --mcp` re-points the agents (ask first).
- DeepSeek delegation pattern + rules: memory `delegate-to-deepseek`; specs and reports in `design/tasks/`. Design system: `design/DESIGN.md`.
