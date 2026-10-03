# Proposed follow-up for Opus

Read this when convenient. This is an advisory handoff requested by the user, not a message to interrupt or restart the current process. No implementation has been assigned. Recheck the current branch: the audit examined `be00baadcd0db27070d2f023d3411498f7f49b19`, and concurrent work may have fixed or changed these observations.

## Product decision to make explicit

Build **one Shadow web application with manager, expert, and learner views, plus a browser companion**. Keep the ERP as a demo/test workplace. Reuse today's console session and map views; do not create a separate application for each role.

The most defensible current description is: “An apprentice that learns and applies expert judgment within an instrumented invoice workflow.” The desired next claim is: “An apprentice that can begin learning an unfamiliar browser workflow from an outcome and demonstrations.” Those claims have different acceptance requirements.

## Priority 0: prove the live loop and expose its state

**Problem:** synthetic results and a polished UI can be mistaken for proof of reliable live learning. At the audit's spot check, ERP/backend were running but the companion's notebook target on port 5173 was unavailable.

**Proposed work:** make existing console/map links reachable; keep active test sessions undisturbed. Add a learning receipt showing the pre-answer prediction, expert teaching statement, rule diff, independent subsequent prediction/result, map version, and provenance. Expose compilation failures and pending work clearly. Ensure a live session rejects synthetic stepping. Label stated versus independently tested knowledge in exports.

**Integration points:** `backend/shadow/main.py`, `engine.py`, `exports.py`; `console/src/pages/Console.tsx`, `MapPage.tsx`; `backend/shadow/static/capture.js`.

**Acceptance:** an evaluator chooses a supported threshold after the build is frozen; live mode learns from the actual answer; unseen boundary cases use the new rule; a counterexample corrects it; a restarted session uses the saved map. Record every failure. No FakeCompiler, oracle answers, or manual map insertion in this proof. This remains an invoice test, not a task-generalization test.

**Claim discipline:** the stored 98.3% score comes from oracle-assisted simulation with 27 questions versus the comparator's six, at the zero-corruption setting. At 40% injected explanation corruption, Shadow's stored whole-decision agreement is 70%. Do not present the best result alone as real-world accuracy or human-time efficiency.

## Priority 1: make the product legible and persistent

**Problem:** “Capture an expert” defaults to Sabine and a fresh map; tutoring names Lena. Backend expert strings and saved maps exist, but company assignments and workflow ownership do not.

**Proposed work:** add workflow selection, expert/learner identity, and explicit new-versus-continue learning. Use stable IDs; scope all sessions to workspace and workflow. Replace latest-global-session routing before supporting multiple users. Introduce saved session recovery and durable evidence references; the current session API exposes the in-memory session registry even though storage has persisted rows.

**Acceptance:** two simultaneous experts cannot change each other's observer target or maps; continuing a workflow preserves knowledge; a fresh capture clearly advertises its reset; learner progress refers to a fixed knowledge version. Company policy and expert preference remain distinguishable.

## Priority 2: browser companion

**Problem:** today's companion relies on `data-shadow-*`, `window.shadowERP`, and cooperative save hooks; it is not an extension.

**Proposed work:** a new extension package with persistent side panel, normalized event capture, explicit session identity, optional site permissions, and the current ERP adapter. Bundle the voice SDK rather than dynamically importing CDN code. Keep server reasoning shared with the console.

**Depends on:** the event/session identity contract from Priority 1. It can be developed without waiting for complete company assignment UX.

**Acceptance:** follow navigation across two enabled origins, retain the session, deduplicate events after reconnect/worker restart, keep unsupported pages explicit, and demonstrate voice/text answers. Generic coaching must not claim the ERP's save-blocking capability on every website. Full details: [browser proposal](BROWSER_COMPANION_PROPOSAL.md).

## Priority 3: cold-start learning

**Problem:** new tasks are blocked at case admission and schema representation, before question quality becomes relevant. Vision currently emits display events only. Core exploration and threshold code still assumes `inv.` fields.

**Proposed work:** a runtime TaskDefinition and FeatureSchema; grounded Observation and Episode records; goal/example onboarding; schema-aware compilation; missingness-aware rule evaluation; a generic observation-to-case bridge. Keep optional packs for high-fidelity adapters and known-domain acceleration.

**Integration points:** `packs/base.py`, `perception.py`, `engine.py` constructor/open_case/on_event and exploration/threshold paths, `compiler.py`, `dsl.py`, `workmap.py`; new-task flow in the web app/extension.

**Acceptance:** an unfamiliar workflow enters without a new handwritten pack, SOP, case list, or hidden policy. A human demonstrates, teaches an unusual rule, and independently labels fresh cases. Predictions are frozen before labels. Missing facts lead to questions. No generated scenario is allowed to self-certify its expected answer. Full specification and research: [novel-task proposal](NOVEL_TASK_LEARNING_PROPOSAL.md).

## Priority 4: evidence graph and company rollout

Reuse Work Map cards, quotes, hypothesis bars, and threshold curves. Add typed graph relationships only when sourced from stored evidence: supports, contradicts, overrides, belongs-to, used-in-prediction, checked-by. Add map-version diffs and a concise “why this suggestion” execution trace.

The graph is a view of stored knowledge and runtime rule use. It must not be presented as access to the language model's hidden reasoning. Give users calibrated wording: observed, stated, tested on N examples, contested, or unknown. Today's belief score is not a calibrated accuracy estimate.

Then add manager workflow assignments, approved map publication, expert conflict resolution, and per-learner progression. Those are shared role views, not more standalone frontends.

## Bounded future work packages

If help is requested later, assign explicit ownership after inspecting Opus's current work:

| Package | Independent deliverable | Dependency |
|---|---|---|
| Live proof/evaluation | Evidence ledger and frozen-test protocol, then isolated replay fixtures | Current live loop stable |
| Browser shell | Extension panel, routing, permission and reconnect tests | Agreed event/session contract |
| Novel-task engine | Schema proposal/admission and observation normalization | TaskDefinition contract |
| Product UX | Workflow/role selection and readable evidence view | IDs, persistence and status contract |

Avoid simultaneous edits to `engine.py`. A separate adapter or test package can be reviewed before integration. Do not automatically resume previous subagents; the user explicitly requested checking what is still needed first.

## Audit artifacts

- [Full current-state audit](PRODUCT_AND_ENGINE_AUDIT.md)
- [Browser companion proposal](BROWSER_COMPANION_PROPOSAL.md)
- [Cold-start learning research and proposal](NOVEL_TASK_LEARNING_PROPOSAL.md)
- [Read-only diagnostic script](diagnose_boundaries.py)
- [Results and source hashes](verification.json)

All investigation-authored files are confined to this advisory directory. The audit made no production code edits and did not start, stop, or mutate any live learning session.
