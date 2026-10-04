"""Two experts, one task: the compare module (no LLM, no session).

Two hand-built maps of the AP invoice workflow differ exactly the way two real experts
would: a different capex threshold, and one of them has a guardrail the other never
mentioned. The tests check that the comparison finds the band between the thresholds,
groups it as *one* conflict per deciding-rule pair, names the extra guardrail, reports
the threshold difference, and asks each expert a neutral question.
"""

from __future__ import annotations

from shadow import compare
from shadow.packs import get_pack
from shadow.workmap import Guardrail, Quote, Rule, WorkMap

PACK = get_pack("ap_invoices")
SABINE, UWE = "Sabine", "Uwe"
CAPEX_TITLE = "Equipment over the capex threshold → 0400"
GUARDRAIL_TITLE = "No asset number, no capex booking"


# ------------------------------------------------------------------ fixtures
def _map(expert: str, threshold: float, *, with_guardrail: bool = False) -> WorkMap:
    wm = WorkMap(pack_id="ap_invoices", task=PACK.task, expert=expert, params={"T_capex": threshold})
    wm.rules.append(Rule(
        id="R1", title=CAPEX_TITLE,
        when="inv.category in ['equipment', 'it_hardware'] and inv.net_eur > params.T_capex",
        then={"cost_center": "0400"}, step_id="S3",
        quote=Quote(text="Equipment over the threshold is always capex."),
    ))
    wm.rules.append(Rule(
        id="R2", title="Running costs → 4711",
        when="inv.category in ['service', 'consumables', 'software', 'freight']",
        then={"cost_center": "4711"}, step_id="S3",
        quote=Quote(text="Services and consumables are running costs."),
    ))
    wm.rules.append(Rule(
        id="R3", title="Domestic invoices get tax code V19",
        when="True", then={"tax_code": "V19"}, step_id="S4",
        quote=Quote(text="Domestic suppliers always carry V19."),
    ))
    if with_guardrail:
        wm.guardrails.append(Guardrail(
            id="G1", title=GUARDRAIL_TITLE, type="hard_limit",
            when="booking.cost_center in ['0400', '0410'] and not inv.asset_number_available",
            action="hold",
            quote=Quote(text="No asset number? Then I can't book it to capex."),
        ))
    for node in [*wm.rules, *wm.guardrails]:
        node.refresh_belief()
    return wm


def _case() -> dict:
    return PACK.demo_cases()["capture"][0]


def _result():
    return compare.compare_maps(PACK, _map(SABINE, 5000), _map(UWE, 8000, with_guardrail=True), cases=[])


def _group(result, field, a_rule, b_rule):
    for g in result["disagree"]:
        if g["field"] == field and g["a_rule"] == a_rule and g["b_rule"] == b_rule:
            return g
    return None


# ------------------------------------------------------------------ threshold diff
def test_threshold_diff_is_reported():
    result = _result()
    assert result["threshold_diffs"] == [{"param": "T_capex", "a": 5000.0, "b": 8000.0}]
    assert result["experts"] == {"a": SABINE, "b": UWE}


def test_identical_maps_have_no_threshold_diff_or_disagreement():
    a = _map(SABINE, 5000)
    b = _map(SABINE, 5000)
    result = compare.compare_maps(PACK, a, b, cases=[], boundaries=False)
    assert result["threshold_diffs"] == []
    assert result["only_a"] == [] and result["only_b"] == []
    assert result["disagree"] == []
    assert result["agree"] > 0


# ------------------------------------------------------------------ only_a / only_b
def test_extra_guardrail_is_named_as_only_b():
    result = _result()
    assert GUARDRAIL_TITLE in result["only_b"]
    assert result["only_a"] == []


def test_same_judgment_under_a_different_id_is_not_only_a():
    a = _map(SABINE, 5000)
    b = _map(UWE, 5000)
    b.rules[1].id = "R99"  # Uwe's compiler named it differently
    only_a, only_b = compare._shared_and_unique(a, b)
    assert "Running costs → 4711" not in only_a
    assert "Running costs → 4711" not in only_b


# ------------------------------------------------------------------ disagreement
def test_the_band_between_thresholds_is_one_conflict():
    result = _result()
    g = _group(result, "cost_center", "R1", None)
    assert g is not None
    assert g["count"] >= 1
    assert g["a_value"] == "0400" and g["b_value"] is None
    assert g["a_quote"] == "Equipment over the threshold is always capex."
    assert g["b_quote"] is None
    assert isinstance(g["case"], str) and g["case_describe"]
    assert g["a_expert"] == SABINE and g["b_expert"] == UWE
    assert g["field_label"] == "Cost center"
    # one entry per conflict: the same rule pair does not appear twice
    pairs = [(x["field"], x["a_rule"], x["b_rule"]) for x in result["disagree"]]
    assert len(pairs) == len(set(pairs))


def test_agreements_are_counted_not_listed_as_conflicts():
    result = _result()
    assert result["agree"] > 0
    fields = {(g["field"], g["a_rule"], g["b_rule"]) for g in result["disagree"]}
    assert ("tax_code", "R3", "R3") not in fields
    assert result["n_comparisons"] == result["agree"] + sum(g["count"] for g in result["disagree"])


def test_guardrail_action_conflict_carries_the_quote():
    result = _result()
    g = _group(result, "action", None, "G1")
    assert g is not None
    assert g["a_value"] is None and g["b_value"] == "hold"
    assert g["b_quote"] == "No asset number? Then I can't book it to capex."
    assert g["field_label"] == "Action"


# ------------------------------------------------------------------ boundary pool
def test_boundary_variants_are_generated_around_each_threshold():
    result = _result()
    assert result["n_cases"] >= 60  # generated
    pool = compare.comparison_pool(PACK, _map(SABINE, 5000), _map(UWE, 8000), cases=[])
    boundary = [c for c in pool if "_compare" in c]
    targets = {c["_compare"]["param"]: set() for c in boundary}
    assert targets and set(targets) == {"T_capex"}
    for c in boundary:
        if "_compare" in c:
            targets["T_capex"].add(c["_compare"]["target"])
    # values straddle both learned thresholds
    assert any(t <= 5000 for t in targets["T_capex"])
    assert any(t >= 5000 for t in targets["T_capex"])
    assert any(5000 < t < 8000 for t in targets["T_capex"])


def test_hand_written_case_enters_the_pool():
    case = _case()
    pool = compare.comparison_pool(PACK, _map(SABINE, 5000), _map(UWE, 8000), cases=[case])
    assert any(c["id"] == case["id"] for c in pool)


# ------------------------------------------------------------------ questions
def test_questions_are_neutral_for_each_expert():
    conflict = _group(_result(), "cost_center", "R1", None)
    q_sabine = compare.questions_for(conflict, SABINE)
    q_uwe = compare.questions_for(conflict, UWE)
    # asking Sabine: state Uwe's choice, ask her what she looks at
    assert "Uwe" in q_sabine and "0400" in q_sabine
    # asking Uwe: state Sabine's choice
    assert "Sabine codes this to 0400" in q_uwe
    assert "what do you look at?" in q_sabine and "what do you look at?" in q_uwe
    # never a verdict
    assert "wrong" not in q_sabine.lower() and "should" not in q_uwe.lower()
    both = compare.questions_for(conflict)
    assert set(both) == {SABINE, UWE}
    assert compare.questions_for(conflict, "a") == q_sabine
    assert compare.questions_for(conflict, "b") == q_uwe


def test_question_for_generic_field_uses_the_label():
    conflict = {
        "field": "tax_code", "field_label": "Tax code",
        "a_value": "RC", "b_value": "V19", "a_expert": SABINE, "b_expert": UWE,
    }
    q = compare.questions_for(conflict, UWE)
    assert q == "Sabine sets Tax code to RC, you set it to V19 — what do you look at?"


# ------------------------------------------------------------------ determinism
def test_comparison_is_deterministic():
    a, b = _map(SABINE, 5000, with_guardrail=True), _map(UWE, 8000)
    r1 = compare.compare_maps(PACK, a, b, cases=[], seed=7)
    r2 = compare.compare_maps(PACK, a, b, cases=[], seed=7)
    assert r1 == r2
