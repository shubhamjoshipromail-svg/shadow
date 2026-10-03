# Shadow — project context for Claude Code sessions

**Shadow** is an AI apprentice that learns *what the AI doesn't already know*. It predicts an expert's decision before they make it; when the expert does something it can't explain, it waits for a natural pause and asks one question; the answer becomes an executable, behavior-verified **Work Map** that then teaches a new hire (and can be exported for agents). Built for the HackNation × ElevenLabs "AI Apprentice" challenge (brief: Capture / Map / Teach + the five Apprentice Tests). Owner: Shubham (solo).

Read first: `SHADOW_ARCHITECTURE.md` (design + reasoning), `SABINE_ROLE_CARD.md` (the demo expert's hidden rules), `advisory/` (independent reviews: advice, not spec).

## Repo layout
- `/` (root) — **Nordwerk ERP**, the observed sandbox app. Lovable project (TanStack Start), synced to GitHub `shubhamjoshipromail-svg/shadow` (private). **Keep it at the root. Never force-push or rewrite pushed history on `main`** (Lovable mirrors it). Observer contract: `src/lib/erp/shadow.ts`.
- `backend/` — **Shadow Core** (FastAPI + numpy). The engine is plain Python; LLMs only translate.
  - `shadow/engine.py` the loop: predict → gap (parametric vs structural) → hypotheses → EVOI vs interruption cost → ask at pause → compile answer → retro-replay → debrief (coverage / conflict / exploration probes, frozen self-exam, teach-back) → tutor (save intercept, BKT mastery)
  - `receipts.py` learning receipts (before/after prediction, quote, rule + param diff, provenance, later independent checks); `proof.py` sealed boundary tests (fresh cases around a learned threshold, predictions frozen + SHA-256 committed before labels, labels from humans only, each label also teaches)
  - `workmap.py` executable Work Map + belief ("words propose, behavior disposes"); `bayes.py` threshold posteriors + BALD; `planner.py` EVOI, pause gate, LinTS question-type bandit; `hypotheses.py`; `compiler.py`; `novice.py`; `perception.py` (vision)
  - `llm.py` / `llm_openai.py` provider routing per tier: vision → gpt-6-luna, fast/spoken → claude-haiku-4-5, reason/compile → claude-sonnet-5-5; failover + spend meter (`/health`)
  - `converse.py` ElevenLabs **Custom LLM** brain (`/v1/chat/completions`): control tags `[[shadow:ask|debrief|intervene|say …]]`; filler/idle turns → `skip_turn` tool call (an empty reply makes ElevenLabs retry and stall)
  - `packs/ap_invoices/` the only workflow pack (process doc, cases, perturbations, exploration priors) + `oracle.py` (hidden rules for simulation only)
  - `sim.py` simulated expert (Rehearsal mode, tests, eval) — never a live-learning claim
  - `static/capture.js` observer + **Shadow student companion** + in-page ElevenLabs voice (served at `/capture.js`)
  - `scripts/`: `set_keys.py` (hidden key entry → `backend/.env`), `setup_elevenlabs.py` (create/update the two agents), `eval_curves.py` (held-out comparison → `eval_out/`)
- `console/` — Shadow console / "notebook" (React + Vite + ElevenLabs React SDK). Optional for experts; judges' view of predictions, hypotheses, Work Map, learning receipts; `/s/:sid/proof` is the evaluator's sealed-test page.

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
- Product principle from the user: **never make it "less"** — rigor yes, timidity no. Shadow should feel like a real shadow: invisible until wanted.
- Budget is tight (~$4 Anthropic, ~$4 OpenAI): prefer cheap tiers, check `/health` spend.

## Multi-agent coordination (Claude Code ↔ Codex ↔ Astra)
- **Claude Code (Opus) owns integration, `backend/shadow/**`, `console/**`, commits and pushes.**
- Codex / other agents take bounded tasks only: assignments in `advisory/codex-coordination/OPUS_TASKS.md` (exact file ownership + acceptance checks + do-not-touch list); they report in `CODEX_STATUS.md` / `*_REPORT.md`, don't commit, and never edit files outside their ownership.
- Astra writes reviews into `advisory/<topic>-<date>/` only. Treat as advice; adopt only what makes the product meaningfully better.
- Never have two agents edit `engine.py` at once.

## Status (checkpoint tag `v0.1-checkpoint`)
Working end to end in the ERP: live predictions → gap → question in ~0.2s at a pause → real Claude compile of spoken/typed answers (rules + net/gross threshold + guardrails) → debrief → tutor blocks a wrong save with the expert's words. Voice via ElevenLabs agents (Custom LLM → Shadow) with proper silence. Eval (simulated, oracle-assisted, held out): exact agreement doc-only 38% / always-ask-why 73% / Shadow 98% at 0% confabulation; 70% at 40% confabulation.

Live learning proof (done): every answer, and every counterexample that moves a threshold, gets a receipt; independent checks only count predictions committed after the receipt on other cases. Evaluator flow: teach any threshold live → "Test it" → freeze sealed test → label (console or ERP) → misses correct the map → next round on fresh cases → "Restart from saved map" proves persistence. Proofs refuse Rehearsal sessions; `/sim/step` refuses live sessions. Verified live 2026-10-03 (real compile of a typed answer, taught 3,600, evaluator labelled at 4,000: round 1 9/11 with both misses in the 3,600–4,000 band, T moved to 4,069, after restart 11/11). `/api/history` lists receipts + proofs across sessions.

Known gaps / next (see `advisory/product-engine-investigation-2026-10-03/OPUS_HANDOFF.md`):
1. Receipt panel is per session; a restarted session shows earlier receipts only via `/api/history` (proof page lists earlier proofs).
2. Rules referencing facts not on screen compile but never fire → should trigger "I can't see X — where do you look it up?"
3. Explicit session/workflow identity (today: unpinned observers follow the latest session), persistent session recovery.
4. **Task-agnostic learning** (cold start: goal + demonstrations → runtime TaskDefinition/FeatureSchema; vision readings → decision points; generalize `inv.`-specific paths). Packs become optional adapters/priors.
5. Browser extension with persistent side panel (bundle the voice SDK; no CDN imports in MV3).
6. Stable deploy on Railway (user sets keys in Railway themselves) instead of ngrok.

## Handoff (2026-10-03, end of session)
- Deployed on Railway project `hacknation-apprentice` (us-west2): core https://core-production-c5ac.up.railway.app (API + notebook + capture.js, Postgres), erp https://erp-production-e3b0.up.railway.app. Pending: user sets API keys in Railway; then run `setup_elevenlabs.py --public-url <core>` (ask first).
- Design system: `design/DESIGN.md`. DeepSeek delegation pattern + rules: memory `delegate-to-deepseek`; specs in `design/tasks/`.
- DeepSeek queue running: `design/tasks/QUEUE_2026-10-03.md` (T1 coach, T2 task-agnostic taskdef + generic pack, T3 landing site, T4 video storyboard/recorder, T5 rename dry-run). Each writes new files + `*_REPORT.md`; review diffs (new files only), judge, then integrate. Logs: `design/tasks/queue-T*.log`.
- Open decisions for the user: product name (recommend Tacet; character Mira; reports in design/tasks/DEEPSEEK_NAMES*_REPORT.md); proactive tutor before video (recommended).
