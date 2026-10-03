# Tasks for Codex (from Opus) — base commit 76f991f

Three bounded, non-overlapping tasks. Don't commit or push; Opus reviews and commits.
Report in `CODEX_STATUS.md` with: files changed, how you checked, anything you couldn't verify.

## Do not touch (owned by Opus)
- `backend/shadow/**` (engine, converse, main, planner, workmap, llm*, sim, packs, static/capture.js)
- `backend/tests/**`, `console/**`, `SHADOW_ARCHITECTURE.md`, `README.md`
- Never force-push or rewrite history (the repo root is Lovable-synced).

---

## Task 1 — Evaluation harness (the "science" chart)
**You own (new files only):** `backend/scripts/eval_curves.py`, `backend/eval_out/` (generated output).

Compare learning strategies against simulated Sabine, using only the existing public APIs: `shadow.engine.Session`, `shadow.sim` (`fake_propose`, `FakeCompiler`, `oracle_booking`, `sim_answer`), `shadow.packs.get_pack("ap_invoices")`, `shadow.packs.ap_invoices.oracle.decide`, and `shadow.workmap.run_map`. Follow how `backend/tests/test_engine.py` drives a session (open_case → on_decision → drain → tick → on_utterance → drain; then start_debrief / debrief_next).

Conditions:
- **doc-only:** the seed map, no questions.
- **shadow:** the full capture + debrief loop.
- **ask-always-why:** a cue probe after every divergence; the answer is trusted with no verification (approximate by using `FakeCompiler(confabulation=c)` and skipping debrief probes).

For each, measure on 60 fresh `generate_cases(seed=999)`: whole-decision agreement with the oracle (cost_center, tax_code, payment_timing, action), and questions asked.

Do a confabulation sweep c ∈ {0, 0.2, 0.4} for shadow vs ask-always-why. `FakeCompiler` already has a `confabulation` parameter; if it doesn't actually apply it when compiling, implement the confabulated-answer path **inside your script** (subclass), not in `sim.py`.

Outputs:
- `backend/eval_out/results.json`
- `backend/eval_out/curves.svg`, as a self-written SVG (no matplotlib dependency needed).

**Acceptance:** `cd backend && .venv/bin/python scripts/eval_curves.py` runs offline (no API keys) in under 90s and writes both files. The numbers are real, computed outputs, never hardcoded.

## Task 2 — ERP follows the live Shadow session
**You own:** `src/lib/erp/store.tsx`, plus the single VAT line in `src/routes/invoice.$id.tsx` (search `VAT {c.vat_rate}%`).
1. VAT display: Shadow sends `vat_rate` as a fraction (0.19), Lovable seed data uses percent (19). Display `Math.round(rate*100)` when 0 < rate < 1.
2. When `source === "api"`, re-fetch `${SHADOW_API}/api/erp/cases` every 4s. If the set of case ids changed (e.g. Shadow switched to a tutor session with different cases), replace cases and approvals. Otherwise merge only `status` from the server, keeping local booking edits.
3. Keep the "Live data" badge behavior.

**Acceptance:** `npx bun run build` passes at repo root. With the backend on :8000, creating a new session via `curl -XPOST localhost:8000/api/sessions -H 'content-type: application/json' -d '{"mode":"tutor","simulate":true}'` updates the inbox within ~5s without a reload. No other files changed.

## Task 3 — ElevenLabs agent provisioning script
**You own (new file):** `backend/scripts/setup_elevenlabs.py`.

Create or update the two agents described in `ELEVENLABS_SETUP.md` ("Shadow – Interviewer", "Shadow – Tutor") through the official ElevenLabs Agents REST API:
- Custom LLM pointing at `${SHADOW_PUBLIC_URL}/v1`, model id `shadow`.
- The system prompt containing `SHADOW_SESSION={{shadow_session}}`.
- The first messages, languages (interviewer: en plus de; tutor: en).
- Overrides enabled for first message, language and prompt.
- A patient turn-taking setting if the API exposes one.

Verify every field name against the current official ElevenLabs API docs; don't guess. Read `ELEVENLABS_API_KEY` and `SHADOW_PUBLIC_URL` from the environment or `backend/.env`. Never print the key.

`--dry-run` prints the JSON payloads; a normal run prints the two agent ids. Store created ids in `backend/.elevenlabs_agents.json` (gitignored path, so add that line to the root `.gitignore`, which is the only other file you may edit).

**Acceptance:** `--dry-run` works with no key. Field names cite the doc URLs in a comment block at the top of the file.
