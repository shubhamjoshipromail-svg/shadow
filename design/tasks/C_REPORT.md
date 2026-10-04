# C · COLD START — "watch me do this" — report

**Task:** `design/tasks/QUEUE_2026-10-04.md` → **C** (of G/S/C/L). Everything below is task C only.
**Status:** complete. Full backend suite green (`199 passed`, in this working tree, which also contains the other
queue tasks' in-flight changes); `observe.js` passes `node --check` and a stub-DOM runtime smoke. No tracked file
outside task C's ownership was edited; `engine.py`, `main.py`, `store.py` were not touched (other agents have
uncommitted changes to them in this working tree — those are not mine). Nothing was committed or pushed; nothing ran
on `:8000`.

## What was built

| File | Role |
| --- | --- |
| `backend/shadow/static/observe.js` (new, 421 lines) | Generic page observer. No app cooperation, no UI, no network. Discovers inputs/selects/textareas/checkboxes/buttons; infers a stable name + human label (`label[for]`, `aria-label`, `aria-labelledby`, `placeholder`, nearest `legend`/heading); emits `observe` on load/route change, `field_changed`, `action`; exposes `window.shadowObserve = {snapshot(), on(fn), observe(), refresh(), fields(), NAME}`. |
| `backend/shadow/onboard.py` (new, 917 lines) | `propose_task`, `infer_without_llm`, `repair_proposal`, `demos_to_cases`, `save_task_definition`, `load_custom_taskdef`, `list_custom`, `Demo`/`ObservedField`/`ObservedAction`, `OnboardProposal`. Pure data translation; the only LLM call is `propose_task` (injectable `parse_fn`). |
| `backend/shadow/packs/custom/` (new) | Where generated definitions land: `README.md` + `<slug>.json` with a `version` (bumped on re-save). |
| `backend/tests/test_onboard.py` (new, 11 tests) | Offline inference, GenericPack load, Session predict→gap on a 4th demo, fake-LLM proposal repair, fallback, save/load round-trip, event folding, observe.js contract. |
| `design/tasks/C_REPORT.md` | This file. |

### The chain
`goal + [Demo ×3]` → `TaskDefinition` → `GenericPack` (same `Pack` protocol, no engine code) → `Session` predict →
expert diverges → **structural gap** → a cue-probe question is queued. Exactly the cold-start loop, on a form the
repo has never seen ("support ticket escalation", invented inside the test).

### Inference rules (`infer_without_llm`)
- every observed control becomes a `FeatureDef` (num/cat/bool/date; free text maps to `cat`);
- **decision fields** = fields the expert *changed* whose final value **varies across demos** (single-demo fallback:
  every changed field);
- **actions** = the buttons pressed last, named in `snake_case` with the human label kept, severity defaulted from
  the action word (reject/escalate > review > resolve);
- the demos are embedded as `demo.capture` cases, so `Session(pack)` already replays them.

### Repair rules (`propose_task` → `repair_proposal`)
The LLM (schema `OnboardProposal`, prompt from `taskdef.propose_taskdef_prompt` + a machine note that `then` is a
list of `{field, value}` pairs, and also accepts the prompt's `{field: value}` object) can be wrong; the
repair makes it safe:
- **unknown fields dropped** — a proposed feature/decision with no matching observed control is removed; rules whose
  `when` references a dropped feature are removed;
- **options merged** from the observed snapshot options *and* the expert's changed values;
- **action severities defaulted** when all zero;
- decision fields and rules kept consistent (a rule target must be a surviving decision field);
- `namespace` is always forced to `task`; anything unrecoverable falls back to `infer_without_llm`, so a hallucinated
  pack can never reach the engine.

## Acceptance checks (verbatim output)

```
$ cd backend && .venv/bin/python -m pytest tests/test_onboard.py -q
...........                                                              [100%]
11 passed in 1.30s

$ cd backend && .venv/bin/python -m pytest -q
........................................................................ [ 36%]
........................................................................ [ 72%]
......................................................                   [100%]
199 passed in 3.02s   # includes the other queue tasks' new tests in this shared tree

$ node --check shadow/static/observe.js
node --check: OK
```

End-to-end transcript (`infer_without_llm` → pack → Session gap → fake-LLM repair):

```
== infer_without_llm (no model) ==
id: support_escalation | case_noun: ticket | namespace: task
decision fields: [('priority', ['Urgent', 'Low', 'Normal']), ('assigned_team', ['Engineering', 'Tier 1', 'Tier 2'])]
actions: [('escalate', 'Escalate', 3), ('resolve', 'Resolve', 1), ('assign', 'Assign', 3)]
features: [('priority', 'cat'), ('customer_tier', 'cat'), ('sla_breached', 'bool'), ('open_days', 'num'), ('summary', 'cat'), ('assigned_team', 'cat')]
embedded demo cases: ['T-1001', 'T-1002', 'T-1003']

== GenericPack loads it ==
pack.id: support_escalation | decisions: ['priority', 'assigned_team']

== Session predict -> gap on the unseen 4th demo ==
prediction fields: {} | action: None
expert booking: {'priority': 'High', 'assigned_team': 'Engineering', 'note': ''} | action: Escalate
gaps: [('priority', 'structural'), ('assigned_team', 'structural'), ('action', 'structural')]
questions raised: [('cue_probe', 'priority'), ('cue_probe', 'assigned_team'), ('cue_probe', 'action')]

== propose_task with a fake LLM (repair + ground) ==
repaired features: ['priority', 'sla_breached', 'open_days']
repaired decisions: [('assigned_team', ['Engineering', 'Tier 1', 'Tier 2']), ('priority', ['Low', 'Normal', 'High', 'Urgent'])]
repaired actions: [('escalate', 'Escalate', 3), ('resolve', 'Resolve', 1), ('assign', 'Assign', 3)]
kept rules: [('D1', 'task.sla_breached == True', {'assigned_team': 'Engineering'})]
namespace forced to: task

ALL ACCEPTANCE STEPS COMPLETED
```

`observe.js` stub-DOM smoke (privacy + change + action):

```
fields: summary, priority, sla_breached, open_days
password field absent: true
priority options: ["Low","Normal","High"]
free text event: {"redacted":true,"before":null,"after":null,"after_length":61}
select event: {"before":"Low","after":"High","value_kind":"cat"}
password event emitted: false
action event: {"name":"escalate","label":"Escalate"}
OBSERVE SMOKE: PASS
```

## For Claude — the API and the main/engine changes (task 3)

Task C deliberately did **not** edit `main.py`/`engine.py`/`store.py`. Here is exactly what to add.

### `POST /api/onboard {goal, demos}` → `{task, pack_id, session}`
Suggested handler in `shadow/main.py`:

```python
class OnboardBody(BaseModel):
    goal: str
    demos: list[dict[str, Any]] = []          # Demo dicts, or raw observe.js events (use events=True)
    events: bool = False                       # True: each demo is a list of observe.js events
    pack_id: str | None = None
    save: bool = True

@app.post("/api/onboard")
async def onboard(body: OnboardBody) -> dict[str, Any]:
    demos = ([onboard.Demo.from_events(d) for d in body.demos] if body.events
             else [onboard.as_demo(d) for d in body.demos])
    task = await onboard.propose_task(body.goal, demos, task_id=body.pack_id, save=body.save)
    pack = GenericPack(task)
    register(pack)                             # shadow.packs.register: get_pack() then finds it by id
    s = Session(uuid.uuid4().hex[:10], pack, mode="capture", expert=pack.expert_name,
                store=store, use_llm=llm.available(), workspace=body.workspace)
    s.map_source = {"kind": "onboarded", "task": task.id, "version": task.version}
    sessions[s.id] = s; latest.append(s.id)
    store.create_session(s.id, "capture", pack.id, s.expert, {"onboarded": True, "goal": body.goal})
    return {"task": task.model_dump(mode="json"), "pack_id": pack.id, "session": s.snapshot()}
```

1. **`register(pack)` is the only integration hook.** `shadow/packs/__init__.py` already exports `register`, and
   `get_pack()` checks `_REGISTRY` before loading `packs/examples/`. So a follow-up
   `POST /api/sessions {pack: "<slug>"}` finds the onboarded pack with no change to the registry. (If you prefer
   not to register, construct the `Session` with `GenericPack(load_custom_taskdef(slug))` directly.)
2. **Offline capture.** `create_session` currently raises `409` when no LLM key is configured and `simulate=False`.
   Cold start must work offline (`propose_task` already falls back to `infer_without_llm`). Add a per-session
   `offline: bool = False` to `NewSession`, and skip the 409 when it is set (pass `use_llm=not (body.simulate or
   body.offline)`); `Session.__init__` already does `use_llm and llm.available()` so nothing else changes.
3. **Serve the observer.** `main.py` already serves `/capture.js`; add
   `@app.get("/observe.js")` returning `FileResponse(..., media_type="application/javascript")` next to it. The host
   page includes it; `window.shadowObserve.on(fn)` posts to `/api/sessions/{sid}/events`. No engine change: the
   existing `on_event` ignores unknown kinds and the new `observe` event is stored by the host, not the engine.
4. **Engine changes: none required.** `Session` only ever calls the `Pack` protocol, and `GenericPack` already
   implements it (`derive/normalize/perturb/describe/describe_delta/generate_cases/seed_map/threshold_params/
   threshold_variant/booking_from_decision/demo_cases`). The cold-start loop reuses `novice.predict` → `run_map`
   → `_classify_gap` → `_quick_question` unchanged; the transcript above is proof.
5. **Known leak left for task G (not touched):** `questions.value_phrase`/`did_phrase`/`case_ref` still hard-code
   invoice nouns (`cost_center`, `tax_code`, `payment_timing`, `"invoice …"`). The cold-start path only hits the
   generic branch of `did_phrase` ("set &lt;field&gt; to &lt;value&gt;"), which is why the session above works; task G owns the
   full genericisation there.

### Notes / limitations
- `observe.js` never reports password/hidden fields, and never reports values for card/IBAN/e-mail-looking inputs;
  free text is a length (`after_length`), and only short codes pass through. The stub-DOM smoke above pins this.
- A decision field is only visible if the observer recorded a *change*. If an expert accepts every default without
  editing a field, cold start sees no decision there — the final action still teaches the action. A future pass can
  compare the last demo's field values on submit instead of changes only.
- `propose_task`'s schema takes `then` as `[{field, value}]` (structured-output-friendly); the repair also accepts
  the prompt's `{field: value}` object shape (tested), while the appended machine note asks for pairs.
- `NAME` is the single product-name constant in both new files (`onboard.NAME`, `observe.js` `NAME`).
