# Shadow

**An apprentice that learns what the AI doesn't already know.**
HackNation × ElevenLabs — *The AI Apprentice*.

Shadow watches an expert work. It commits a prediction before every decision, and notices when the expert does something it can't explain. It waits for a natural pause and asks the single question worth asking. The answer becomes an executable, behavior-verified Work Map, which then teaches the next hire (and can certify an agent).

- Architecture and reasoning: [SHADOW_ARCHITECTURE.md](SHADOW_ARCHITECTURE.md)
- Voice setup: [ELEVENLABS_SETUP.md](ELEVENLABS_SETUP.md)
- Sandbox ERP (Lovable): [LOVABLE_PROMPT.md](LOVABLE_PROMPT.md)

## Repo
```
/ (root)   Nordwerk ERP sandbox, the observed app. Built and synced by Lovable (TanStack Start). Keep it at root.
  src/lib/erp/shadow.ts  observer contract: data-shadow-* attributes, window.shadowERP, beforeSave
backend/   Shadow Core: FastAPI + numpy + Claude
  shadow/engine.py       the loop: predict → gap → hypotheses → EVOI → ask → learn → test
  shadow/workmap.py      executable Work Map + belief (words propose, behavior disposes)
  shadow/bayes.py        threshold posteriors + BALD probe selection
  shadow/planner.py      EVOI vs interruption cost, pause gate, LinTS question-type bandit
  shadow/hypotheses.py   competing explanations, scored on history + expert attention
  shadow/converse.py     ElevenLabs Custom LLM brain
  shadow/packs/          domain packs (ap_invoices = the brief's Sabine example)
  shadow/sim.py          simulated expert (offline runs, tests, rehearsal)
  shadow/static/capture.js   drop-in observer for any web app (+ save intercept)
console/   Shadow console (React + Vite + Tailwind + ElevenLabs React SDK)
advisory/  independent reviews (advice, not spec)
```

> The root is a Lovable-connected project. Don't force-push or rewrite pushed history on `main`; Lovable mirrors it.

## Run locally
```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cp .env.example .env   # add ANTHROPIC_API_KEY (without it, sessions run on the simulated expert)
.venv/bin/uvicorn shadow.main:app --port 8000 --reload
```
```bash
cd console && npm install && npm run dev   # Shadow console, http://localhost:5173
```
```bash
npm install && VITE_SHADOW_API=http://localhost:8000 npm run dev   # Nordwerk ERP (root)
```
Tests: `cd backend && .venv/bin/pytest -q`. The full capture → debrief → tutor loop runs against simulated Sabine.

## Try it without any keys
Start a capture session, then click **autoplay** next to *simulated Sabine*:
1. Shadow predicts each invoice from the 2019 process doc.
2. It finds gaps, asks at pauses and learns rules.
3. **Start debrief**, then autoplay again: it closes gaps, probes unseen cases, examines itself and gets the teach-back confirmed.
4. **Teach a new hire**, then step: the simulated trainee codes a €7,200 equipment invoice as opex, and the tutor blocks the save.
