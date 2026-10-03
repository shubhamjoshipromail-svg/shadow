# Codex assistance status

Shubham authorized Codex to request work from Opus and delegate the assigned tasks to GPT-6.1 Sol / GPT-6 Luna until the Codex usage reset at **2026-10-03 13:31:05 America/Los_Angeles**.

## Coordination

- Task request delivered in the active Claude chat, “Shadow AI Apprentice hackathon project.”
- Opus assigned three tasks against base commit `76f991f`; all accepted and delegated at approximately 13:13 Pacific.
- Three agents are running. Target return times 13:23–13:26; final cutoff 13:31:05 Pacific.
- Opus owns implementation integration, commits, and pushes. Codex will not commit, push, restart shared servers, or change credentials.
- Please put assignments and follow-ups in `advisory/codex-coordination/OPUS_TASKS.md`; Codex will update this status and write task reports in this directory.

## Ownership

| Agent | Model | Exclusive files | Status |
|---|---|---|---|
| eval_harness | GPT-6.1 Sol | new `backend/scripts/eval_curves.py`, `backend/eval_out/` | Running |
| erp_session | GPT-6 Luna | `src/lib/erp/store.tsx`; VAT line only in `src/routes/invoice.$id.tsx` | Running |
| elevenlabs_setup | GPT-6.1 Sol | new `backend/scripts/setup_elevenlabs.py`; agent-ID entry in `.gitignore` | Running |

Each agent may write its own `*_REPORT.md` in this coordination folder. The parent owns this status file.

## Validation boundaries

- ERP agent will build and use mocks/static verification. It will not create a session against the shared live backend, because Opus is operating that demo. The actual live-session transition check remains for Opus unless an isolated server becomes necessary and approved by assignment.
- ElevenLabs agent will run dry-run and local mocked checks; it will not create/update actual cloud agents or print credentials.
- Evaluation runs offline through the Python engine APIs, with independent evaluation cases and explicit simulation caveats.

## Integration note for Opus (13:14)

The ERP polling task can refresh invoice data, but `capture.js` currently adopts `SID` from its first server session message and continues sending that ID in events and `beforeSave`. The capture WebSocket also stays attached to that session. Switching the latest backend session can therefore change the inbox while the companion still targets the old expert session. This is outside Codex Task 2 ownership (`capture.js` and server remain yours). Please verify/rebind the observer when switching to tutor, or explicitly reload the ERP with the tutor session ID. We will report data polling separately from complete observer-session switching.
