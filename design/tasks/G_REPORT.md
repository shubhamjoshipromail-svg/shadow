# G · GENERALITY — the second-workflow truth test, and the leaks

Status: **done**. The same engine learns `expense_approval` with no workflow-specific engine code; the full
suite is green.

Owned files changed (only these; `engine.py`, `main.py`, `store.py` untouched):

| File | Change |
|---|---|
| `backend/shadow/questions.py` | all templates read the pack's `case_noun`, field labels, option labels and action labels; added the `deviation` template |
| `backend/shadow/compiler.py` | `namespace(pack)` / `example_expression(pack)` / `system(pack)`; compile prompt takes its namespace + example from the pack |
| `backend/shadow/hypotheses.py` | `_system(pack)`; proposal prompt takes its namespace + example from the pack |
| `backend/shadow/novice.py` | novice prompt now reads the pack's `goal` (when present) + `process_doc` |
| `backend/shadow/packs/generic.py` | exposes `goal` and `action_labels` from the `TaskDefinition` |
| `backend/shadow/packs/examples/expense_approval.json` | `"case_noun": "claim"` |
| `backend/tests/test_generality.py` | new — the truth test + leak guards |

## 1. The chain under test

Hidden rules live in the test only (no pack, no oracle):

- `task.receipt_attached == False and task.amount_eur > 750` → `approval_route = finance_review`
- `task.category == 'meals' and task.customer_billable == True` → `approval_route = finance_review`

`test_second_workflow_full_chain_and_sealed_proof` drives a capture `Session` on `GenericPack(expense_approval)`
with `use_llm=False`, `proposer=no_proposals`, and `ExpenseCompiler` (a `SpokenCompiler`-style stub that turns the
expert's sentence into the rules an LLM would compile). It asserts, in order:

1. prediction from the written process only: `manager_approve`;
2. expert divergence → a **structural** gap (`gap["type"] == "structural"`, `gap["expert"] == "finance_review"`);
3. a question is asked, phrased with the pack's noun/labels, with no `invoice`/`post`;
4. the answer compiles to rules in the pack namespace (`task.*`) with `params.T_amount` and a learned threshold;
5. `run_map` predicts **unseen** generated claims (80/80 in the evidence run below);
6. a sealed `proof.build` round around the learned threshold, labelled by the hidden expert, scores ≥ 90%.

Live evidence from the same code path:

```
doc prediction : manager_approve
expert         : finance_review
question asked : You set claim exp-9001's approval route to finance review instead of line manager. What made you do that?
learned rules  :
    No receipt above 750 EUR goes to finance review | task.receipt_attached == False and task.amount_eur > params.T_amount | {'approval_route': 'finance_review'} | stated
    Client entertainment always gets finance review | task.category == 'meals' and task.customer_billable == True | {'approval_route': 'finance_review'} | stated
T_amount       : 743.28 basis task.amount_eur
unseen claims  : 80/80 correct
proof buckets  : ['above', 'below', 'control', 'spread'] n= 10
proof accuracy : 1.0 (10/10)
```

## 2. Invoice leaks fixed (generically)

- `questions.py` no longer contains "invoice" or invoice actions in user-visible strings. `case_ref` uses
  `pack.case_noun`; `did_phrase` / `value_phrase` use the pack's field labels + `option_labels`; action phrasings
  fall back to `pack.action_labels`. The invoice pack keeps its exact strings because its own data reproduces them
  (and `case_ref` keeps the old bare-id fallback for invoice cases without `invoice_no`).
- `compiler.py` / `hypotheses.py` prompts no longer hard-code `inv.` examples. `example_expression(pack)` returns the
  old invoice example for the invoice pack and builds one from the pack's own features otherwise; `system(pack)` /
  `hypotheses._system(pack)` inject it plus the namespace.
- `novice.py` reads `pack.goal` (new on `GenericPack`) and `pack.process_doc`; the "careful new <name> clerk"
  wording became "careful new hire learning this workflow: <name>".
- `packs/generic.py` exposes `goal` and `action_labels`, so generic packs need no invoice-shaped adapter.

Invoice behaviour is unchanged: `test_invoice_question_phrasing_is_unchanged` pins the exact invoice strings, and the
whole suite still passes.

## 3. New question type: `deviation`

`questions.template(pack, "deviation", case=..., field=..., node_title=...)` returns the neutral fork:

```
On claim exp-9001 that looked different from claims over 500 EUR go to the line manager. Is this an exception,
a change in how it's done now, or a one-off?
```

No "wrong" / "mistake". Test: `test_deviation_template_is_neutral`.

### Engine hook for Claude (code against this — `engine.py`/`planner.py` are not mine to edit)

`planner.QType` must gain `"deviation"` (and a `BASE_COST["deviation"]`, e.g. `0.15`), otherwise
`Inquiry(type="deviation")` fails pydantic validation.

Then, in `engine.py`, replace the per-gap dispatch at the end of `Session.on_judgment` so a structural gap that
contradicts a **confirmed** node gets a deviation question instead of a bare cue probe:

```python
# engine.py, on_judgment() — replace the loop `for gap in ep.gaps: if gap["type"] == "structural": ...`
for gap in ep.gaps:
    if gap["type"] != "structural":
        continue
    node = self._confirmed_contradiction(case, gap["field"], gap["expert"], ep.expert)
    if node is not None and self.mode == "capture":
        self._deviation_question(case, gap, node)
    else:
        self._quick_question(case, gap)  # ask now; don't wait for the LLM's explanations
    self.spawn(self.analyze_gap(ep, case, gap))

def _confirmed_contradiction(self, case, field, expert_value, expert):
    """A confirmed learned node that fires on this case but disagrees with the expert now."""
    ctx = {**self.pack.derive(case), "params": self.wm.params, "booking": expert}
    for n in [*self.wm.rules, *self.wm.guardrails]:
        if n.origin == "doc" or n.belief.status != "confirmed" or not dsl.holds(n.when, ctx):
            continue
        value = n.action if isinstance(n, Guardrail) else n.then.get(field)
        if value is not None and value != expert_value:
            return n
    return None

def _deviation_question(self, case, gap, node):
    dp = self.dps.get(case["id"])
    f = gap["field"]
    q = Inquiry(id=self.planner.new_id(), type="deviation", case_id=case["id"], field=f,
                text=questions.template(self.pack, "deviation", case=case, field=f, node_title=node.title),
                evoi=0.9, impact=0.9, guardrail_gap=1.0 if f == "action" else 0.0,
                phase="live", gap_id=gap["id"], target_node=node.id,
                expert_value=gap["expert"], predicted_value=gap["predicted"],
                screen_moment=(dp.field_moments.get(f) if dp else None) or {"ts": dp.opened_at if dp else self.now()},
                reason=f"expert contradicted the confirmed rule {node.id}")
    self.planner.enqueue(q)
    self.spawn(self.emit("inquiry", {"inquiry": q.to_json()}))
```

The rest of the loop already supports the answer: `compiler.CompiledRule(kind="exception", parent_id=node.id)` lands
via `_node_from_compiled` (which sets `kind="exception"` and `parent=cr.parent_id`), and a `threshold`/`correction`
in the compiled answer is handled by `learn_from_answer` / `_handle_teachback_answer`.

## 4. Acceptance checks (pasted)

```
$ cd backend && .venv/bin/python -m pytest tests/test_generality.py -v
tests/test_generality.py::test_second_workflow_full_chain_and_sealed_proof PASSED [ 16%]
tests/test_generality.py::test_generic_questions_use_pack_nouns_and_labels PASSED [ 33%]
tests/test_generality.py::test_invoice_question_phrasing_is_unchanged PASSED [ 50%]
tests/test_generality.py::test_deviation_template_is_neutral PASSED      [ 66%]
tests/test_generality.py::test_compiler_and_hypotheses_prompts_take_the_pack_namespace PASSED [ 83%]
tests/test_generality.py::test_generic_pack_exposes_goal_and_action_labels PASSED [100%]
============================== 6 passed in 1.10s ===============================

$ cd backend && .venv/bin/python -m pytest -q
........................................................................ [ 36%]
........................................................................ [ 73%]
.....................................................                    [100%]
197 passed in 3.18s
```

(The suite count grew from 187 to 197 while this task ran because tasks C/S landed
`tests/test_onboard.py` + `tests/test_stuck.py` concurrently; the whole suite, including the invoice behaviour
pinned by `test_receipts_proof.py` / `test_taskdef.py` / `test_engine.py`, is green.)

## 5. Residual invoice leak outside my ownership (please fix in `proof.py`)

`proof.py :: build` unconditionally stamps an invoice key onto every frozen proof case:

```python
v.update(id=cid, invoice_no=f"{rng.randint(6000, 9899)}", status="Open", _proof=pid)
```

For a generic pack this invents an `invoice_no` that isn't in the task definition (harmless to `run_map` because
`GenericPack.derive` ignores extras). Suggested generic change:

```python
v.update(id=cid, status="Open", _proof=pid)
if "invoice_no" in v:  # or: if getattr(pack, "namespace", "inv") == "inv"
    v["invoice_no"] = f"{rng.randint(6000, 9899)}"
```

`console/src/components/Prediction.tsx` also hard-codes `Invoice {kase?.invoice_no}`; for non-invoice packs that
header should come from the pack (`case_noun`) or be hidden when the id is absent. I did not touch either file.
