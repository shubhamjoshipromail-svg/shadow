# T1 · COACH — proactive tutor logic (pure module, not wired in)

Status: **done**, acceptance green. New files only — nothing existing was edited, nothing committed.

- `backend/shadow/coach.py` — pure functions, no I/O, no LLM.
- `backend/tests/test_coach.py` — 26 tests (acceptance asks ≥ 15), incl. the full simulated trainee run.

## What I built

All four spec functions live in `backend/shadow/coach.py`:

| function | what it does |
|---|---|
| `next_case(map, pack, mastery, seen_ids, candidates) -> case \| None` | Curriculum. Scores each candidate by the trusted nodes it exercises (the map's own `run_map` prediction, so booking-dependent guardrails are attributed to the case that would provoke them). Ordering: **weak guardrails first when mastery < 0.5**; then the lowest-mastery node the case exercises; then the most *other* weak nodes (interleaving); then candidate order for determinism. Returns `None` when the pool is empty or fully seen. |
| `brief(map, pack, case, mastery) -> dict` | Pre-case coaching: `fields` (the decision fields in play, fired first then near-firing, with `label`, `title`, `p`, `why`, `also`), `focus` (the single rule to watch), the constant predict-first prompt `"What would you code this to, and why?"`, `guardrails` ids, `intervention` = `fade(...)`, and `worked_example` (the expert's `quote` + `screen_moment`) only when the rule in play is below **0.3** mastery. |
| `hint_ladder(map, pack, case, booking, action, level) -> dict` | Graduated hint. Level **1** = which field, **2** = rule title, **3** = the expert's own words, **4** = the answer. Output clamps level to 1–4; `title`/`quote`/`answer` are `None` until their level and the `text` grows one clause per level, so nothing leaks early. When `check_proposal` finds no objection it hints off the map's own prediction instead (preferring a learned node over a doc rule). |
| `fade(mastery_p) -> "coach" \| "check" \| "silent"` | `coach` < 0.5, `check` ≥ 0.5, `silent` only ≥ 0.85. Added an optional keyword `guardrail=False`; when true the function never returns `silent` (a guardrail is never allowed to fade to silence). Callers must pass `guardrail=<focus["guardrail"]>`. |

Supporting helpers: `_trusted_nodes` (mirrors `Session.tutor_report`: non-doc + `workmap.TRUSTED`), `_node_fields`, `_nearly_fires`, `_available`, `_worked_example`, `_label`, `_fallback_node`.

Design decisions worth reviewing:
- **"Nearly fires"** = the node is not fired, but every non-`params.` field its `when` references is present and non-`None` in the derived context. These appear in `brief["fields"]` as `fires=False` (and in `also`), but they never supply a worked example unless they are the focus.
- **Worked example** is restricted to fired rules (or the focus rule) below 0.3, so a case with many distant rules does not flood the brief.
- **Interleaving** = prefer the case that exercises more distinct weak (< 0.85) nodes, all else equal.
- Mastery `p` for an unseen node is `None`; ordering treats it as `0.0` (practice unseen first). `brief`/`fade` surface `None` honestly.
- No product name is hardcoded anywhere in `coach.py`; hint text uses `wm.expert`, rule titles and pack field labels.

## Acceptance

Command: `cd backend && .venv/bin/pytest -q tests/test_coach.py`

```
..........................                                               [100%]
26 passed in 0.31s
```

Verbose (all pass):
```
tests/test_coach.py::test_next_case_returns_an_unseen_case PASSED
tests/test_coach.py::test_next_case_skips_seen_ids PASSED
tests/test_coach.py::test_next_case_returns_none_when_everything_seen PASSED
tests/test_coach.py::test_next_case_returns_none_on_empty_pool PASSED
tests/test_coach.py::test_next_case_prefers_the_weakest_rule PASSED
tests/test_coach.py::test_next_case_puts_shaky_guardrails_first PASSED
tests/test_coach.py::test_next_case_interleaves_weak_skills PASSED
tests/test_coach.py::test_next_case_falls_back_when_map_has_no_trusted_nodes PASSED
tests/test_coach.py::test_next_case_ignores_untrusted_inferred_nodes PASSED
tests/test_coach.py::test_brief_names_the_fields_that_matter_and_the_prompt PASSED
tests/test_coach.py::test_brief_reports_fired_rule_as_mattering PASSED
tests/test_coach.py::test_brief_lists_nearly_firing_rules_as_also PASSED
tests/test_coach.py::test_brief_shows_a_worked_example_below_0_3_mastery PASSED
tests/test_coach.py::test_brief_omits_worked_example_above_0_3_mastery PASSED
tests/test_coach.py::test_brief_falls_back_to_doc_prediction_without_learned_nodes PASSED
tests/test_coach.py::test_hint_level_1_reveals_only_the_field PASSED
tests/test_coach.py::test_hint_level_2_reveals_the_rule_title_not_the_words PASSED
tests/test_coach.py::test_hint_level_3_reveals_the_experts_words PASSED
tests/test_coach.py::test_hint_level_4_reveals_the_answer PASSED
tests/test_coach.py::test_hint_ladder_escalates_monotonically PASSED
tests/test_coach.py::test_hint_ladder_clamps_levels PASSED
tests/test_coach.py::test_hint_ladder_uses_the_prediction_when_nothing_is_wrong PASSED
tests/test_coach.py::test_hint_ladder_matches_check_proposal_target PASSED
tests/test_coach.py::test_fade_thresholds PASSED
tests/test_coach.py::test_fade_never_silences_a_guardrail PASSED
tests/test_coach.py::test_full_simulated_trainee_run_escalates_and_fades PASSED
```

The last test is the acceptance's full simulated trainee run: it walks
`PACK.demo_cases()["tutor"] + PACK.generate_cases(20)` through `next_case`
(the trainee misses the first exposure of a skill, then improves, updated with
the engine's BKT), and asserts every candidate is used, hints escalate
monotonically and hide later levels, at least one coached skill later fades to
`check`/`silent`, and no guardrail ever fades to `silent`.

Full-suite note: `cd backend && .venv/bin/pytest -q` is **146 passed, 3 failed**.
All 3 failures are in `tests/test_taskdef.py`, an unrelated in-progress module
from task T2; T1 does not import or touch it.

## How to integrate (exact call sites)

`coach.py` imports only `shadow.dsl`, `shadow.packs.base` and `shadow.workmap`,
so `engine.py` can import it without a cycle.

1. **`Session.__init__`, `backend/shadow/engine.py:107-108`** — today tutor mode
   pins `case_order` to `demo["tutor"]`. Keep `self.cases` as is and, for tutor
   mode, choose the next case with
   `coach.next_case(self.wm, self.pack, self.mastery, self.tutor_seen, self.tutor_pool)`
   where `self.tutor_pool = demo["tutor"] + self.pack.generate_cases(N)` and
   `self.tutor_seen` is a `set[str]` appended in `open_case`. Handle `None`
   (curriculum exhausted) explicitly — never silently fall back.
2. **`Session.tutor_open`, `engine.py:1509-1514`** — before emitting
   `tutor_case`, compute `coach.brief(self.wm, self.pack, self.cases[case_id], self.mastery)`
   and add it to the payload as `"brief"`. The companion can render
   `fields` + `predict`; `worked_example` is already gated by mastery.
3. **`Session.before_save`, `engine.py:1516-1559`** — on a violation, replace the
   immediate full `explain` with a rung of the ladder:
   `level = {"coach": 1, "check": 3, "silent": 4}[coach.fade(self.mastery.get(v.node_id, {}).get("p"), guardrail=isinstance(node, Guardrail))]`
   (level rises with repeated attempts on the same `case_id`; `tutor_attempted`
   can hold an attempt counter). The existing `intervention` can carry
   `coach.hint_ladder(...)["text"]` for the spoken line and keep the full
   `explain` for the console.
4. **`Session.tutor_report`, `engine.py:1586-1594`** — add per-rule
   `"fade": coach.fade(p, guardrail=...)` and reuse `next_case` for the
   `practice_next` pick so the report and the curriculum agree.
5. **`Session._bkt`, `engine.py:1567`** — no change; `coach` already consumes the
   exact `{node_id: {"p", "opportunities", "status", "title"}}` shape it writes.

## Open questions

1. **`fade` guardrail flag.** The spec signature is `fade(mastery_p)`. "Silent
   only for non-guardrails ≥ 0.85" needs the guardrail bit, so I added optional
   `guardrail=False`; `fade(0.9)` still returns `"silent"` as a bare call. If the
   integrator prefers, enforce guardrails at the call site instead.
2. **Interruption budget.** `fade` says how much to say, but not *when*; the
   engine's pause gate / EVOI still owns timing. Coach should not emit on its own.
3. **Repeated-attempt escalation.** `next_case` picks cases; the per-case hint
   level is stateful (attempt counter), which I left to the caller so `coach.py`
   stays pure.
4. **Near-fire precision.** "Every referenced fact is available" is deliberately
   simple. Once thresholds exist in `params`, a distance-to-threshold notion
   ("within one step of firing") would be sharper.
5. **Curriculum exhaustion.** `next_case` returns `None`; the engine needs an
   explicit end-of-curriculum state (next step: generate fresh cases or debrief),
   not a silent restart.
6. **Pack-agnostic.** Everything reads `pack.decision_fields` and the map, so
   `coach.py` should also work against the future `GenericPack` (T2) untouched.
