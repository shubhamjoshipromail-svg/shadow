# TWO · two experts, one task — report

Queue: `design/tasks/QUEUE_2026-10-04c.md` (task TWO). Shared rules as in `QUEUE_2026-10-04.md`.
Owner of `backend/shadow/compare.py` and `backend/tests/test_compare.py` only.

## Status

Done, tests green, **new files only**. No edit to `engine.py`, `main.py`, `store.py`, `perception.py`,
`capture.js`, `site/**`, `extension/**`, `design/video/**`. No commits/pushes. Nothing was run on :8000
(no server was started at all — `compare.py` is pure functions, exercised by pytest).

New files:

| file | lines | what |
|---|---|---|
| `backend/shadow/compare.py` | 328 | `compare_maps`, `questions_for`, `comparison_pool`; pure, no session/store/LLM |
| `backend/tests/test_compare.py` | 12 tests | two hand-built AP maps: different capex thresholds, one extra guardrail |

## What it does

`compare_maps(pack, map_a, map_b, cases=None, *, generated=60, seed=0, boundaries=True)`

Builds the shared pool (`comparison_pool`): the caller's `cases` (the union of both experts'
session cases) + `pack.generate_cases(generated, seed=seed)` + boundary variants around every
learned threshold, built with `pack.threshold_variant` at 0.9× / 0.97× / 1.03× / 1.1× of each
value that either map stores, clipped to the quantity's `lo`/`hi`, always from a base case whose
non-threshold condition would hold (`_relaxed_holds`, the same trick as `proof.py`).

Runs `workmap.run_map(map, pack, case, ACTIVE)` for every case on both maps and returns:

```python
{
  "agree": int,                 # (case, field) pairs both maps resolve identically
  "disagree": [                 # ONE entry per conflict = (field, deciding-rule pair)
    {
      "case": "cmp-T_capex-1.03-7", "case_describe": "invoice 4471 from …",
      "field": "cost_center", "field_label": "Cost center",
      "a_value": "0400", "a_rule": "R1", "a_rule_title": "…", "a_quote": "…",
      "b_value": None, "b_rule": None, "b_rule_title": None, "b_quote": None,
      "a_expert": "Sabine", "b_expert": "Uwe", "count": 23,   # 23 cases share this conflict
    }, …
  ],
  "only_a": ["rule title", …],  # nodes matched across maps by condition + effect, NOT by id
  "only_b": ["No asset number, no capex booking"],
  "threshold_diffs": [{"param": "T_capex", "a": 5000.0, "b": 8000.0}],
  "experts": {"a": "Sabine", "b": "Uwe"},
  "n_cases": 128, "n_comparisons": 244,
}
```

`questions_for(conflict, expert=None)`

- `questions_for(conflict)` → `{"Sabine": q_a, "Uwe": q_b}`.
- `questions_for(conflict, "Uwe")` (name, or `"a"`/`"b"`) → just that side's question.
- Asking Uwe when Sabine chose `0400` and he left it unset:
  `"Sabine codes this to 0400, you code it to nothing — what do you look at?"`
  Non-`cost_center` fields use the pack's own label: `"…sets Tax code to RC, you set it to V19…"`.
  The question only ever states the other expert's choice and asks what this one looks at — no verdict.

Node matching (`only_a`/`only_b`) uses `(kind, normalized when, effect)` so the same judgment
compiled under a different id by a different session is **not** reported as unique
(`test_same_judgment_under_a_different_id_is_not_only_a`). Ids drift, semantics don't.

## Acceptance checks (exact output)

```
$ cd backend && .venv/bin/pytest -q tests/test_compare.py
............                                                             [100%]
12 passed in 0.22s

$ cd backend && .venv/bin/pytest -q
........................................................................ [ 82%]
...............................................                          [100%]
259 passed, 4 xfailed in 4.32s

$ .venv/bin/python -c "from shadow import compare; print('import ok:', compare.__all__)"
import ok: ['compare_maps', 'questions_for', 'comparison_pool']
```

The full-suite count includes other queue jobs that landed in the same tree while this ran
(`test_mcp_server.py`, `test_perception.py`, …); no pre-existing test regressed.

Extra check (not in the test file), `GenericPack` works with no invoice code:

```
$ .venv/bin/python  # two maps over shadow/packs/examples/expense_approval.json, T=500 vs T=1500
pack: shadow/packs/examples/expense_approval.json
fields: ['approval_route', 'gl_account'] thresholds: ['amount_eur', 'days_since_expense']
agree 46 disagree 1 n_cases 68 thr [{'param': 'T', 'a': 500.0, 'b': 1500.0}]
conflict: approval_route auto_approve None 17
```

## Integration — exact call sites for Claude

No `engine.py` change is needed: a live `Session` already exposes everything
(`engine.py:108` `self.wm`, `:110` `self.cases`, `:111` `self.case_order`, `:104` `self.pack`).

### 1. `backend/shadow/main.py` — top of file, add the import

```python
from shadow import compare
```

### 2. `backend/shadow/main.py` — new endpoint (next to `/api/workflows`, after `match_workflow`)

```python
class CompareQuery(BaseModel):
    a: str            # session id of expert 1
    b: str            # session id of expert 2


@app.get("/api/workflows/compare")
async def compare_workflows(a: str, b: str) -> dict[str, Any]:
    """Where do two experts' Work Maps for the same workflow agree, disagree, and differ?"""
    if a not in sessions or b not in sessions:
        raise HTTPException(404, "both sessions must be live to compare their maps")
    sa, sb = sessions[a], sessions[b]
    if sa.pack.id != sb.pack.id:
        raise HTTPException(400, "the two sessions are different workflows")
    cases = [sa.cases[c] for c in sa.case_order] + [sb.cases[c] for c in sb.case_order]
    return compare.compare_maps(sa.pack, sa.wm, sb.wm, cases)
```

### 3. Comparing experts who are not live (after a restart)

Resolve each expert's newest saved map through the store (never the simulator's —
use `latest_map_row`, which already filters Rehearsal):

```python
from shadow.workmap import WorkMap
from shadow.packs import get_pack

pack = get_pack(pack_id)
row = store.latest_map_row(expert, pack_id)          # {"map": {...}, "version": n, "session_id": sid}
wm = WorkMap(**row["map"])
```

Pool cases then come from the session rows of `store.list_sessions()` for that expert/pack, or simply
from `pack.demo_cases()["capture"]`; the generated + boundary cases are added by `compare_maps` itself,
so an empty `cases=[]` still produces a meaningful comparison.

### 4. Console (Claude owns `console/**`)

Render one card per `disagree` entry: example case describe, `a_rule_title` + `a_quote` vs
`b_rule_title` + `b_quote`, and a `count` badge ("23 cases"). The action for the user is
`questions_for(conflict, expert_name)` — one neutral question per expert; wire each to the existing
ask/utterance path (`POST /api/sessions/{sid}/utterance`) so the answer becomes a normal rule.
`only_a`/`only_b` is the "what one knows and the other doesn't" list; `threshold_diffs` is the
"your limit is 5 000, hers is 8 000" strip.

## Notes / decisions

- **Agreement counting**: only `(case, field)` pairs where at least one map predicts a value.
  Both-`None` means neither map covers the field and is skipped, not counted as agreement.
- **`disagree` is grouped**, so its length is the number of *conflicts*, not the number of cases;
  `count` is how many cases share that conflict and `case` is the first example.
  A `None` value is a real disagreement (one rule fires, the other map has none) and is kept,
  which is exactly the "extra guardrail" case in the tests.
- **Threshold quantity inference**: `comparison_pool` finds the quantity a rule compares against by
  looking for the `pack.threshold_params()` basis expression inside the rule's `when`
  (falling back to all supported quantities). No session bookkeeping required.
- **Determinism**: `case` ids and the generated pool depend only on `seed`; `test_comparison_is_deterministic`
  covers it.
- One `except Exception` around `pack.threshold_params()` so a pack with no numeric thresholds still compares.
