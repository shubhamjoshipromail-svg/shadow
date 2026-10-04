# Report: T2 · TASKDEF — task-agnostic learning core

Task: `design/tasks/QUEUE_2026-10-03.md` §T2 · Owner: DeepSeek (headless) · Status: done, **not wired in, not committed**.
No servers, no `:8000`, no existing files touched (only the four files this task lists were created).

## Deliverables

| File | What |
|---|---|
| `backend/shadow/taskdef.py` | `TaskDefinition` pydantic model (goal, decision fields, actions + severity, features with type/source/threshold ranges), `observation_to_case`, `coerce_feature`, `missing_features`, `propose_taskdef_prompt`, loaders. Pure, no LLM calls. |
| `backend/shadow/packs/generic.py` | `GenericPack(TaskDefinition)` implementing the whole `Pack` surface the engine uses (`derive/normalize/perturb/describe/describe_delta/generate_cases/seed_map/threshold_params/threshold_variant/demo_cases/booking_from_decision`) + optional `namespace`, `derive_noise`, `case_noun`. |
| `backend/shadow/packs/examples/expense_approval.json` | A second, non-invoice workflow **as data**: employee expense approval (claim → route + GL account), written 2021 process, 7 doc rules, 1 doc guardrail, 4 capture + 3 tutor demo cases. |
| `backend/tests/test_taskdef.py` | 31 tests (acceptance was "load the JSON, run `run_map` + proof-style variants, round-trip perturbations, missing features 'does not hold'"). |

## Acceptance checks (pasted output)

```
$ cd backend && .venv/bin/pytest -q tests/test_taskdef.py
...............................                                          [100%]
31 passed in 0.17s

$ cd backend && .venv/bin/pytest -q
........................................................................ [ 96%]
.....                                                                    [100%]
149 passed in 3.09s          # 118 before this task + 31 new
```

Also verified out-of-band (not a committed test): a real `Session` starts with `GenericPack` and the
pack's own seed map, samples a 40-case pool, and predicts:

```
$ .venv/bin/python - <<'PY'
from shadow.engine import Session; from shadow.store import Store
from shadow.packs.generic import GenericPack; from shadow.taskdef import load_example
pack = GenericPack(load_example('expense_approval'))
s = Session('smoke-t2', pack, mode='capture', use_llm=False, store=Store('sqlite:///:memory:'))
print('wm rules:', [r.id for r in s.wm.rules], 'guardrails:', [g.id for g in s.wm.guardrails])
print('cases:', s.case_order, 'pool:', len(s.pool))
print('describe:', pack.describe(s.cases[s.case_order[0]]))
PY
wm rules: ['D1','D2','D3','D4','D5','D6','D7'] guardrails: ['G1']
cases: ['exp-7001','exp-7002','exp-7003','exp-7004'] pool: 40
describe: Employee expense approval exp-7001 — Amount: 240 EUR, Category: travel, Receipt attached: yes, ...
```

## What is covered

- **Schema.** `TaskDefinition` validates feature/decision-field name uniqueness, process-rule `then` targets,
  guardrail actions, num ranges, and `threshold_capable ⇒ num`. JSON round-trips exactly
  (`parse(parse_json(t)).model_dump() == t.model_dump()`).
- **Generic namespace.** `derive()` returns `{"task": {…}}`, never `inv.`. Every declared feature is present,
  `None` when unobserved, plus `submit_date_month/day/days_ago` helpers.
- **Missingness is explicit and safe.** `observation_to_case` records an availability state per feature
  (`observed / expert_supplied / derived / missing / unreadable / conflicting`); unreadable values and missing
  readings are `None`. `dsl.holds` on `None` returns `False` for `>`, `<`, `==`, `in`, so a rule that needs an
  unobserved fact stays quiet instead of inventing a value. Guardrails on unread facts also do not trigger.
- **Observation bridge.** DOM field events / vision readings `{field,label,value}` match features by
  name/label/screen source; unsupported readings land in `_unmapped`, disagreements in `_conflicts` (first
  grounded reading is kept). Type coercion handles `1.280,50` / `€ 1,234.50` / `12,5`, `yes/no/checked/blurred`,
  `18.09.2026` → `2026-09-18`, and junk → `(None, 'unreadable')` without crashing.
- **Generation + probes.** `generate_cases` is deterministic by seed, respects options/values/weights/ranges/step.
  `perturb` varies every feature sensibly by type (num spread + scale, cat alternatives, bool flip, date ±7/±30 d),
  preserves every other feature, records `_probe` provenance, and round-trips through JSON + re-derivation.
- **Written process → seed map.** `seed_map()` emits `origin='doc'` rules/guardrails and wires `rule_ids` into steps,
  ready for `WorkMap(**seed_map())`; a test runs `run_map` over the doc map and gets the written (incomplete) answer.
- **Thresholds / sealed-test shape.** `threshold_params()` returns `{feature: {lo, hi, step, scale, bases:{name:
  "task.<name>"}}}`; `threshold_variant` clips but does **not** snap to `step` (sealed boundaries must stay exact)
  and never mutates the base case. The proof-style test rebuilds `proof.py`'s boundary plan on the generic pack:
  the written 500 EU threshold scores 5/8 (misses exactly in the 510–700 band), the taught 750 scores 8/8, and a
  control with `receipt_attached=False` stays quiet at 7,999.
- **Prompt builder.** `propose_taskdef_prompt(goal, sample_observations)` returns the LLM prompt text with the
  skeleton schema and the "use only grounded facts / do not invent policy" rules. It builds no request and makes no
  call; a test asserts it is a plain deterministic string.

## Integration: every `inv.` hard-code in `engine.py` and the minimal change

`grep -n 'inv\.' shadow/engine.py` finds exactly **two** code literals; the surrounding novelty logic adds two more
domain couplings. Other `pack.derive(...)` call sites just spread the dict and are already namespace-agnostic.

| Line | Current | Minimal change |
|---|---|---|
| 1242 | `… if r.startswith("inv.")}` | Read the namespace once: `ns = getattr(self.pack, "namespace", "inv")`, then `if r.startswith(f"{ns}.")`. |
| 1249 | `b, x = self.pack.derive(base)["inv"], self.pack.derive(v)["inv"]` | Same `ns`: `self.pack.derive(base)[ns]`. Today this **raises `KeyError: 'inv'`** for `GenericPack` (reproduced). |
| 1245–1246 | `noise = {"id","supplier_id","supplier_name","day","month","dup_days","days_to_skonto","n_lines","categories","net","gross","net_eur","gross_eur","vat_rate","supplier_country","domestic"}` | `noise = set(getattr(self.pack, "derive_noise", <existing invoice set>))`; `GenericPack` already exposes `derive_noise`. Keeps the invoice pack's behaviour as the fallback. |
| 1189 | `f"Two of your rules collide on one case: same invoice, but …"` | `f"Two of your rules collide on one {getattr(self.pack, 'case_noun', 'case')}: but …"`. `TaskDefinition.case_noun` defaults to `"case"`; the example sets nothing so it reads "case". |
| 1233 | docstring: *"a new supplier whose bank details just changed"* | Comment only; reword to a domain-neutral example. |

Recommended (small) protocol note in `packs/base.py`: document optional members `namespace: str`, `derive_noise:
set[str]`, `case_noun: str`, `exploration_priors: list[set[str]]`, `booking_from_decision`, `threshold_variant`.
The engine already reads `exploration_priors` via `getattr(..., [])`, so only the four rows above are required.

Outside `engine.py`, the same literal appears in **LLM prompt text**, not code paths, and should be namespace-
formatted if a generic pack is ever compiled live:
- `shadow/compiler.py:34` and `:55` — example expression `inv.category == 'equipment' and inv.net_eur > params.T_capex`.
- `shadow/hypotheses.py:109` — example expression `inv.category == 'equipment' and inv.net_eur > 5000`.
- `shadow/sim.py:21–41` — intentionally the invoice simulator's own scripts; leave as-is.

## Open questions / judgment calls

1. **Where the pack's identity lives.** `GenericPack` is constructed from a `TaskDefinition` object; the engine/store
   still key maps by `pack_id`. A runtime-learned task should get a stable id + version from the task model, and
   `store`/`/api/sessions` should carry the task version so a resumed session binds to the same definition.
2. **`normalize` for computed decision fields.** The invoice pack derives `payment_timing` from `payment_date`.
   Generic decision fields are passed through from the booking; a task that needs a computed decision field needs a
   small, declarative derivation hook (expression or lookup) rather than Python. Not added on purpose.
3. **Derived features.** `derive()` only computes date helpers. The proposal's "derived" availability wants a
   declarative `derived = "expr"` on a feature; deferred until the compiler can emit it safely.
4. **Sealed tests on non-amount thresholds.** `proof.py`'s discovery path uses `pack.decision_fields[0]` and the
   first threshold param; for a task whose first decision field is not the thresholded one, `build` still works but
   the default `param` choice may need a hint. The generic pack supplies both `amount_eur` and `days_since_expense`.
5. **Prompt output validation.** `propose_taskdef_prompt` builds the request; nothing yet parses/validates the LLM's
   JSON into a `TaskDefinition`. The model's validators are ready for that step (`parse_task_definition`).
6. **`demo` vs generated cases.** The example ships explicit demo cases so behavior is reproducible; if `demo` is
   absent, `demo_cases()` falls back to seeded generation. A task owner may want to mark an example "complete".
