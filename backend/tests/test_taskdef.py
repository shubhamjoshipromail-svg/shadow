"""Task-agnostic learning core: TaskDefinition, GenericPack, observation mapping.

Acceptance for T2: load a second, non-invoice workflow as data
(`packs/examples/expense_approval.json`), run `workmap.run_map` and proof-style
boundary variants over it, round-trip perturbations, and show that missing
features evaluate as "does not hold" instead of crashing.
"""

from __future__ import annotations

import copy
import json
import random
from datetime import date, timedelta

from shadow import dsl
from shadow.packs.generic import GenericPack
from shadow.taskdef import (
    GENERIC_NAMESPACE,
    coerce_feature,
    load_example,
    missing_features,
    observation_to_case,
    parse_task_definition,
    propose_taskdef_prompt,
)
from shadow.workmap import Guardrail, Quote, Rule, WorkMap, check_proposal, run_map

TASK = load_example("expense_approval")
PACK = GenericPack(TASK)
FEATURE_NAMES = {f.name for f in TASK.features}

TRUE_T = 750.0  # the expert's unwritten threshold; the 2021 doc says 500


# ------------------------------------------------------------------ fixtures
def oracle_field(case: dict, field: str):
    """An independent label source (stands in for a human/deterministic checker)."""
    facts = case["facts"]
    amount = facts.get("amount_eur") or 0.0
    if field == "approval_route":
        if facts.get("contractor"):
            return "manager_approve"
        if amount > TRUE_T:
            return "finance_review"
        return "auto_approve"
    if field == "gl_account":
        if facts.get("customer_billable") and facts.get("category") == "software":
            return "9100"
        return {"travel": "6200", "software": "6300", "equipment": "6300", "meals": "6400"}.get(
            facts.get("category"), "6500")
    raise AssertionError(f"no oracle for {field}")


def make_map(T: float = 500.0, *, with_guardrail: bool = True) -> WorkMap:
    wm = WorkMap(pack_id=PACK.id, task=PACK.task, expert=PACK.expert_name, params={"T_amount": T})
    wm.rules.append(Rule(
        id="R1", title="Claims above the finance threshold go to finance",
        when="task.amount_eur > params.T_amount and task.receipt_attached",
        then={"approval_route": "finance_review"},
        quote=Quote(text="Above seven hundred and fifty it always goes to finance.")))
    if with_guardrail:
        wm.guardrails.append(Guardrail(
            id="G1", title="Do not auto-approve above the finance threshold", type="hard_limit",
            when="task.amount_eur > params.T_amount and task.receipt_attached",
            action="finance_review",
            quote=Quote(text="If it is over the line finance looks at it before it is approved.")))
    for n in [*wm.rules, *wm.guardrails]:
        n.refresh_belief()
    return wm


def case_of(case_id: str) -> dict:
    return next(c for c in PACK.demo_cases()["capture"] + PACK.demo_cases()["tutor"] if c["id"] == case_id)


# ------------------------------------------------------------------- schema
def test_load_example_schema():
    assert TASK.id == "expense_approval"
    assert TASK.namespace == GENERIC_NAMESPACE
    assert [d.name for d in TASK.decision_fields] == ["approval_route", "gl_account"]
    assert {f.type for f in TASK.features} == {"num", "cat", "bool", "date"}
    assert [f.name for f in TASK.threshold_features()] == ["amount_eur", "days_since_expense"]
    assert TASK.process_doc and "500 EUR" in TASK.process_doc
    assert len(TASK.process_rules) == 7


def test_pydantic_json_roundtrip():
    again = parse_task_definition(TASK.model_dump_json())
    assert again.model_dump() == TASK.model_dump()


def test_action_precedence_is_severity_order():
    assert PACK.action_precedence == ["reject", "request_receipt", "finance_review",
                                      "manager_approve", "auto_approve"]
    assert PACK.actions == ["reject", "request_receipt", "finance_review", "manager_approve", "auto_approve"]


def test_generic_pack_protocol_surface():
    for attr in ("id", "name", "task", "expert_name", "process_doc", "decision_fields", "actions",
                 "action_precedence", "namespace"):
        assert hasattr(PACK, attr), attr
    for method in ("derive", "normalize", "perturb", "describe", "describe_delta", "generate_cases",
                   "demo_cases", "seed_map", "threshold_params", "threshold_variant",
                   "booking_from_decision"):
        assert callable(getattr(PACK, method)), method
    assert [d.name for d in PACK.decision_fields] == ["approval_route", "gl_account"]


def test_exploration_priors_are_sets():
    assert PACK.exploration_priors
    assert all(isinstance(p, set) for p in PACK.exploration_priors)


# -------------------------------------------------------------------- derive
def test_derive_uses_generic_namespace_not_inv():
    ctx = PACK.derive(case_of("exp-7002"))
    assert set(ctx) == {GENERIC_NAMESPACE}
    node = ctx[GENERIC_NAMESPACE]
    assert FEATURE_NAMES <= set(node)
    assert "net" not in node and "inv" not in ctx  # no invoice assumptions leaked in


def test_derive_date_helpers_and_missing_helpers():
    node = PACK.derive(case_of("exp-7001"))[GENERIC_NAMESPACE]
    assert node["submit_date"] == "2026-09-20"
    assert node["submit_date_month"] == 9
    assert node["submit_date_day"] == 20
    assert node["submit_date_days_ago"] == (date(2026, 10, 3) - date(2026, 9, 20)).days
    empty = PACK.derive(observation_to_case(TASK, [], case_id="empty"))[GENERIC_NAMESPACE]
    assert empty["amount_eur"] is None
    assert empty["submit_date_month"] is None


def test_generate_cases_deterministic_and_typed():
    a = PACK.generate_cases(25, seed=3)
    b = PACK.generate_cases(25, seed=3)
    assert [c["id"] for c in a] == [c["id"] for c in b]
    assert [c["facts"] for c in a] == [c["facts"] for c in b]
    submit_pool = TASK.feature("submit_date").values
    for case in a:
        facts = case["facts"]
        assert set(facts) == FEATURE_NAMES
        assert 20 <= facts["amount_eur"] <= 8000 and facts["amount_eur"] % 10 == 0
        assert facts["category"] in TASK.feature("category").options
        assert isinstance(facts["receipt_attached"], bool)
        assert facts["submit_date"] in submit_pool


def test_demo_cases_capture_and_tutor():
    demo = PACK.demo_cases()
    assert [c["id"] for c in demo["capture"]] == ["exp-7001", "exp-7002", "exp-7003", "exp-7004"]
    assert [c["id"] for c in demo["tutor"]] == ["exp-8001", "exp-8002", "exp-8003"]
    for case in demo["capture"] + demo["tutor"]:
        assert set(case["facts"]) == FEATURE_NAMES
        assert case["booking"]["approval_route"] is None and case["booking"]["note"] == ""


def test_seed_map_from_written_process():
    seed = PACK.seed_map()
    assert set(seed) == {"steps", "rules", "guardrails", "params"}
    assert seed["params"] == {}
    assert all(r["origin"] == "doc" for r in seed["rules"])
    assert [g["id"] for g in seed["guardrails"]] == ["G1"]
    s3 = next(s for s in seed["steps"] if s["id"] == "S3")
    assert set(s3["rule_ids"]) == {"D1", "D2", "D3", "D4"}


# ------------------------------------------------------------------ work map
def test_run_map_generic_task_uses_param():
    case = case_of("exp-7002")  # software, 1280 EUR, receipt attached
    fired = run_map(make_map(500.0, with_guardrail=False), PACK, case)
    assert fired.fields["approval_route"].value == "finance_review"
    quiet = run_map(make_map(2000.0, with_guardrail=False), PACK, case)
    assert "approval_route" not in quiet.fields


def test_run_map_doc_seed_gives_the_written_answer():
    wm = WorkMap(pack_id=PACK.id, task=PACK.task, expert=PACK.expert_name, **PACK.seed_map())
    pred = run_map(wm, PACK, case_of("exp-7002"))
    assert pred.fields["gl_account"].value == "6300"
    assert pred.fields["approval_route"].value == "manager_approve"  # doc limit, not the hidden 750


def test_run_map_missing_feature_rule_is_quiet():
    case = observation_to_case(TASK, [{"field": "amount_eur", "value": "1280"}],
                               case_id="no-receipt-reading")
    assert case["facts"]["receipt_attached"] is None
    pred = run_map(make_map(500.0, with_guardrail=False), PACK, case)
    assert "approval_route" not in pred.fields


def test_missing_features_evaluate_as_does_not_hold_not_crash():
    case = observation_to_case(TASK, [], case_id="all-missing")
    ctx = PACK.derive(case)
    assert set(missing_features(TASK, case)) == FEATURE_NAMES
    for expr in ("task.amount_eur > 100", "task.amount_eur < 100", "task.amount_eur == 0",
                 "task.receipt_attached == True", "task.category in ['travel', 'software']",
                 "task.submit_date < '2026-01-01'", "task.days_since_expense > 5"):
        assert dsl.holds(expr, ctx) is False, expr


def test_cat_and_bool_rules_fire():
    wm = WorkMap(pack_id=PACK.id, task=PACK.task, expert=PACK.expert_name)
    wm.rules.append(Rule(id="R2", title="Billable software clears to customer",
                         when="task.category == 'software' and task.customer_billable",
                         then={"gl_account": "9100"}))
    for n in wm.rules:
        n.refresh_belief()
    hits = run_map(wm, PACK, case_of("exp-7002"))
    assert hits.fields["gl_account"].value == "9100"
    miss = run_map(wm, PACK, case_of("exp-7001"))  # travel, not customer-billable
    assert "gl_account" not in miss.fields


def test_guardrail_missing_feature_does_not_trigger():
    wm = make_map(750.0, with_guardrail=True)
    case = observation_to_case(TASK, [], case_id="blind")
    pred = run_map(wm, PACK, case)
    assert pred.triggered_guardrails == []
    assert check_proposal(wm, PACK, case, {}, "auto_approve") == []


def test_check_proposal_flags_rule_and_guardrail():
    wm = make_map(750.0, with_guardrail=True)
    case = case_of("exp-7002")  # 1280 EUR, receipt attached
    violations = check_proposal(wm, PACK, case, {"approval_route": "auto_approve"}, "auto_approve")
    kinds = {v.kind for v in violations}
    assert "rule" in kinds and "guardrail" in kinds
    assert {v.node_id for v in violations} == {"R1", "G1"}
    assert check_proposal(wm, PACK, case, {"approval_route": "finance_review"}, "finance_review") == []


def test_doc_guardrail_fires_only_with_a_reading():
    wm = WorkMap(pack_id=PACK.id, task=PACK.task, expert=PACK.expert_name, **PACK.seed_map())
    without_receipt = observation_to_case(
        TASK,
        [{"field": "amount_eur", "value": "1280"}, {"field": "receipt_attached", "value": "no"}],
        case_id="no-receipt")
    assert "G1" in run_map(wm, PACK, without_receipt).triggered_guardrails
    blind = observation_to_case(TASK, [{"field": "amount_eur", "value": "1280"}], case_id="unread")
    assert "G1" not in run_map(wm, PACK, blind).triggered_guardrails


# ---------------------------------------------------------------- perturbations
def test_perturb_variants_roundtrip():
    case = case_of("exp-7002")
    variants = PACK.perturb(case, random.Random(3))
    assert len(variants) > 10
    varied: set[str] = set()
    for v in variants:
        probe = v["_probe"]
        feature = probe["feature"]
        varied.add(feature)
        assert v["facts"][feature] == probe["to"]
        for other in FEATURE_NAMES - {feature}:
            assert v["facts"][other] == case["facts"][other], (feature, other)
        assert PACK.describe_delta(case, v) == probe["delta"]
        assert json.loads(json.dumps(v))["facts"][feature] == probe["to"]  # JSON-safe
        ctx = PACK.derive(v)[GENERIC_NAMESPACE]
        assert FEATURE_NAMES <= set(ctx)  # still evaluable, missingness preserved
    assert {"amount_eur", "category", "receipt_attached", "submit_date"} <= varied


def test_perturb_of_perturbation_is_stable():
    case = case_of("exp-7001")
    first = PACK.perturb(case, random.Random(1))[0]
    second = PACK.perturb(first, random.Random(2))
    assert second
    for v in second:
        assert set(v["facts"]) == FEATURE_NAMES
        assert PACK.describe_delta(first, v)


def test_describe_and_describe_delta():
    text = PACK.describe(case_of("exp-7002"))
    assert "exp-7002" in text and "Amount" in text and "1280" in text
    variant = PACK.threshold_variant(case_of("exp-7002"), "amount_eur", "amount_eur", 900.0)
    assert PACK.describe_delta(case_of("exp-7002"), variant).startswith("Amount at")


# ----------------------------------------------------------------- thresholds
def test_threshold_params_and_variant():
    params = PACK.threshold_params()
    assert set(params) == {"amount_eur", "days_since_expense"}
    spec = params["amount_eur"]
    assert spec["bases"] == {"amount_eur": "task.amount_eur"}
    assert spec["lo"] == 20 and spec["hi"] == 8000
    case = case_of("exp-7001")
    v = PACK.threshold_variant(case, "amount_eur", "amount_eur", 1234.0)
    assert v["facts"]["amount_eur"] == 1234.0 and v["_probe"]["feature"] == "amount_eur"
    clipped = PACK.threshold_variant(case, "amount_eur", "amount_eur", 99_999)
    assert clipped["facts"]["amount_eur"] == 8000.0
    assert PACK.threshold_variant(case, "category", "category", 1) is None
    # the base case is never mutated
    assert case["facts"]["amount_eur"] == 240.0


def test_proof_style_boundary_roundtrip():
    """Replicate proof.py's boundary plan on the generic pack and show labels correct the threshold."""
    plan = [300.0, 450.0, 490.0, 510.0, 600.0, 700.0, 800.0, 1200.0]
    bases = PACK.generate_cases(12, seed=5)
    bases = [b for b in bases if b["facts"]["receipt_attached"] is True and not b["facts"]["contractor"]][:4]
    assert bases

    def score(T: float) -> tuple[int, int, list[float]]:
        wm = make_map(T, with_guardrail=False)
        agree = 0
        misses: list[float] = []
        for i, value in enumerate(plan):
            v = PACK.threshold_variant(bases[i % len(bases)], "amount_eur", "amount_eur", value)
            assert v is not None
            pred = run_map(wm, PACK, v)
            got = pred.fields.get("approval_route")
            label = oracle_field(v, "approval_route")
            # no rule fires -> the written default (auto-approve) is the prediction
            got_value = got.value if got is not None else "auto_approve"
            if got_value == label:
                agree += 1
            else:
                misses.append(value)
        return agree, len(plan), misses

    doc_agree, total, doc_misses = score(500.0)  # the written (incomplete) threshold
    learned_agree, _, learned_misses = score(TRUE_T)  # the taught threshold
    assert learned_agree == total
    assert doc_agree < total and doc_misses == [510.0, 600.0, 700.0]
    assert learned_misses == []

    # controls outside the rule's domain stay quiet however large the amount
    wm = make_map(TRUE_T, with_guardrail=False)
    control = copy.deepcopy(bases[0])
    control["facts"]["receipt_attached"] = False
    control["facts"]["amount_eur"] = 7999.0
    assert "approval_route" not in run_map(wm, PACK, control).fields


# ---------------------------------------------------------------- observations
def test_normalize_and_booking_from_decision_roundtrip():
    case = case_of("exp-7001")
    booking = PACK.booking_from_decision(case, {"approval_route": "manager_approve", "gl_account": "6200"})
    normalized = PACK.normalize(case, booking)
    assert normalized == {"approval_route": "manager_approve", "gl_account": "6200"}
    assert PACK.normalize(case, {}) == {"approval_route": None, "gl_account": None}


def test_observation_to_case_mapping_and_missingness():
    observations = [
        {"field": "Expense form \u00b7 Amount (EUR)", "value": "1.280,50"},
        {"field": "category", "value": "Software"},
        {"field": "Receipt attached", "value": "yes"},
        {"field": "Days since expense", "value": "12"},
        {"field": "Submitted", "value": "18.09.2026"},
        {"field": "Some unknown widget", "value": "x"},
    ]
    case = observation_to_case(TASK, observations, case_id="obs-1")
    assert case["facts"]["amount_eur"] == 1280.5
    assert case["facts"]["category"] == "software"  # canonicalised against options
    assert case["facts"]["receipt_attached"] is True
    assert case["facts"]["days_since_expense"] == 12.0
    assert case["facts"]["submit_date"] == "2026-09-18"
    assert case["facts"]["preapproved"] is None
    assert case["_availability"]["preapproved"] == "missing"
    assert case["_availability"]["amount_eur"] == "observed"
    assert case["_unmapped"] == ["Some unknown widget"]
    assert missing_features(TASK, case) == ["preapproved", "customer_billable", "contractor"]


def test_observation_unreadable_value_stays_explicit():
    case = observation_to_case(TASK, [
        {"field": "amount_eur", "value": "unreadable"},
        {"field": "receipt_attached", "value": "blurred"},
    ], case_id="unreadable")
    assert case["facts"]["amount_eur"] is None
    assert case["facts"]["receipt_attached"] is None
    assert case["_availability"]["amount_eur"] == "unreadable"
    assert case["_availability"]["receipt_attached"] == "unreadable"


def test_observation_conflict_keeps_first_and_records_it():
    case = observation_to_case(TASK, [
        {"field": "category", "value": "travel"},
        {"field": "category", "value": "software"},
    ], case_id="conflict")
    assert case["facts"]["category"] == "travel"
    assert case["_availability"]["category"] == "conflicting"
    assert case["_conflicts"] == [{"feature": "category", "kept": "travel", "saw": "software"}]


def test_observation_expert_source_is_labelled():
    case = observation_to_case(TASK, [{"field": "category", "value": "meals", "source": "expert"}],
                               case_id="taught")
    assert case["_availability"]["category"] == "expert_supplied"


def test_coerce_feature_types_and_junk():
    amount = TASK.feature("amount_eur")
    assert coerce_feature(amount, "1.280,50") == (1280.5, "observed")
    assert coerce_feature(amount, "\u20ac 1,234.50") == (1234.5, "observed")
    assert coerce_feature(amount, "12,5") == (12.5, "observed")
    assert coerce_feature(amount, "not a number") == (None, "unreadable")
    assert coerce_feature(amount, None) == (None, "missing")
    assert coerce_feature(TASK.feature("receipt_attached"), "checked") == (True, "observed")
    assert coerce_feature(TASK.feature("receipt_attached"), "maybe") == (None, "unreadable")
    assert coerce_feature(TASK.feature("submit_date"), "18.09.2026") == ("2026-09-18", "observed")
    assert coerce_feature(TASK.feature("submit_date"), "soon") == (None, "unreadable")
    assert coerce_feature(TASK.feature("category"), "SOFTWARE") == ("software", "observed")


def test_observation_to_case_never_crashes_on_junk():
    for observations in ([[], None], ["garbage"], [{"field": None, "value": None}],
                         [{"value": 5}], [object()]):
        case = observation_to_case(TASK, observations or [], case_id="junk")
        assert set(case["facts"]) == FEATURE_NAMES
        assert PACK.derive(case)  # still evaluable


# -------------------------------------------------------------------- prompt
def test_propose_taskdef_prompt_is_offline_text():
    observations = [{"field": "Amount", "label": "Amount", "value": "120"},
                    {"field": "Category", "value": "travel"}]
    prompt = propose_taskdef_prompt("Approve employee expense claims fairly", observations, app="Expense tool")
    assert isinstance(prompt, str)
    assert "Approve employee expense claims fairly" in prompt
    assert "Approve employee expense claims fairly" in propose_taskdef_prompt(
        "Approve employee expense claims fairly", observations)  # deterministic
    assert "Expense tool" in prompt
    assert GENERIC_NAMESPACE in prompt and "task.amount" in prompt
    assert "JSON" in prompt
    assert "do not invent" in prompt.lower() or "never encode" in prompt.lower()
    # observations are embedded as data, not executed
    assert json.dumps("travel") in prompt or "travel" in prompt
