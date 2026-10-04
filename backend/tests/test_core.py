import random

import pytest

from shadow import dsl
from shadow.bayes import Hypothesis, ThresholdPosterior, bald_discrete, posterior_update
from shadow.packs import get_pack
from shadow.packs.ap_invoices.oracle import OracleSabine, decide
from shadow.workmap import Evidence, Guardrail, Quote, Rule, WorkMap, check_proposal, run_map

PACK = get_pack("ap_invoices")


# ------------------------------------------------------------------ DSL
def test_dsl_basic_and_none_safe():
    ctx = {"inv": {"net": 6400, "category": "equipment", "po": None}, "params": {"T": 5000}}
    assert dsl.holds("inv.category == 'equipment' and inv.net > params.T", ctx)
    assert not dsl.holds("inv.missing > 3", ctx)
    assert dsl.holds("inv.category in ['equipment', 'it_hardware']", ctx)
    assert dsl.fields_referenced("inv.net > params.T and inv.category == 'x'") == {"inv.net", "params.T", "inv.category"}


@pytest.mark.parametrize("bad", ["__import__('os')", "inv.__class__", "[x for x in y]", "open('f')", "lambda: 1"])
def test_dsl_rejects_unsafe(bad):
    with pytest.raises(dsl.DSLError):
        dsl.validate(bad)


# ------------------------------------------------------------------ pack + oracle
def test_generator_deterministic_and_derive():
    a = PACK.generate_cases(20, seed=3)
    b = PACK.generate_cases(20, seed=3)
    assert [c["invoice_no"] for c in a] == [c["invoice_no"] for c in b]
    for c in a:
        d = PACK.derive(c)["inv"]
        assert d["category"] in ("equipment", "it_hardware", "service", "consumables", "software", "freight")


def test_demo_cases_have_the_story():
    demo = PACK.demo_cases()
    by_id = {c["id"]: c for c in demo["capture"] + demo["tutor"]}
    assert decide(by_id["inv-4471"]).fields["cost_center"] == "0400"
    assert decide(by_id["inv-4472"]).action == "hold"  # December double-billing
    assert decide(by_id["inv-4473"]).action == "second_approval"  # intercompany
    assert decide(by_id["inv-4474"]).fields["payment_timing"] == "skonto"
    tutor_case = by_id["inv-5120"]
    assert PACK.derive(tutor_case)["inv"]["net_eur"] > 7000
    assert decide(tutor_case).action == "hold"  # capex without asset number
    assert decide(by_id["inv-5121"]).action == "escalate"


def test_perturb_produces_probe_variants():
    case = PACK.demo_cases()["capture"][0]
    variants = PACK.perturb(case, random.Random(0))
    assert len(variants) > 20
    assert all("_probe" in v for v in variants)
    assert {decide(v).fields["cost_center"] for v in variants} >= {"0400", "4711"}


# ------------------------------------------------------------------ work map
def _map_with_capex(status_quote=True):
    wm = WorkMap(pack_id="ap_invoices", task="t", expert="Sabine", params={"T_capex": 5000})
    wm.rules.append(Rule(id="R1", title="Equipment over threshold is capex",
                         when="inv.category == 'equipment' and inv.net_eur > params.T_capex",
                         then={"cost_center": "0400"},
                         quote=Quote(text="Equipment over five thousand is always capex.") if status_quote else None))
    wm.guardrails.append(Guardrail(id="G1", title="No asset number, no capex booking", type="hard_limit",
                                   when="booking.cost_center in ['0400', '0410'] and not inv.asset_number_available",
                                   action="hold", quote=Quote(text="No asset number, no capex booking.")))
    for n in [*wm.rules, *wm.guardrails]:
        n.refresh_belief()
    return wm


def test_belief_words_propose_behavior_disposes():
    wm = _map_with_capex()
    r = wm.rules[0]
    assert r.belief.status == "stated"
    r.evidence.append(Evidence(episode_id="e1", kind="live", agrees=True))
    r.evidence.append(Evidence(episode_id="e2", kind="counterfactual", agrees=True))
    r.refresh_belief()
    assert r.belief.status == "confirmed"
    for i in range(4):
        r.evidence.append(Evidence(episode_id=f"x{i}", kind="live", agrees=False))
    r.refresh_belief()
    assert r.belief.status == "contested"


def test_run_map_and_tutor_check():
    wm = _map_with_capex()
    tutor_case = next(c for c in PACK.demo_cases()["tutor"] if c["id"] == "inv-5120")
    pred = run_map(wm, PACK, tutor_case)
    assert pred.fields["cost_center"].value == "0400"
    assert pred.action and pred.action.value == "hold"
    # trainee codes opex and posts -> two objections: rule + guardrail
    violations = check_proposal(wm, PACK, tutor_case, {"cost_center": "4711"}, "post")
    kinds = {v.kind for v in violations}
    assert "rule" in kinds and "guardrail" in kinds
    # trainee codes capex but still posts without asset number -> guardrail
    violations = check_proposal(wm, PACK, tutor_case, {"cost_center": "0400"}, "post")
    assert [v.node_id for v in violations] == ["G1"]
    # correct behaviour -> no objections
    assert check_proposal(wm, PACK, tutor_case, {"cost_center": "0400"}, "hold") == []


def test_block_guardrail_lets_the_case_be_stopped():
    """A compiled 'block' guardrail must not deadlock the tutor: 0400 + hold passes, 0400 + post is stopped."""
    wm = _map_with_capex()
    wm.guardrails[0].action = "block"
    tutor_case = next(c for c in PACK.demo_cases()["tutor"] if c["id"] == "inv-5120")
    assert [v.node_id for v in check_proposal(wm, PACK, tutor_case, {"cost_center": "0400"}, "post")] == ["G1"]
    assert check_proposal(wm, PACK, tutor_case, {"cost_center": "0400"}, "hold") == []


# ------------------------------------------------------------------ bayes
def test_threshold_posterior_learns_basis_and_cutoff_with_bald():
    """Oracle uses net > 5000. Start ignorant about net vs gross; BALD probes should resolve both."""
    # prior from the quote ("five thousand") but deliberately agnostic about net vs gross
    post = ThresholdPosterior.make("T_capex", 1000, 12000, 50, ["net", "gross"], prior_mean=5000, prior_sd=1500,
                                   scale=60)
    base = PACK.demo_cases()["capture"][0]
    pool = [v for v in PACK.perturb(base, random.Random(1)) if PACK.derive(v)["inv"]["category"] == "equipment"]

    def xb(case):
        d = PACK.derive(case)["inv"]
        return {"net": d["net_eur"], "gross": d["gross_eur"]}

    asked = []
    for _ in range(6):
        best = max(pool, key=lambda c: post.bald(xb(c)))
        if post.bald(xb(best)) < 0.05:
            break
        asked.append(best["id"])
        pool.remove(best)
        label = decide(best).fields["cost_center"] == "0400"
        post.observe(xb(best), label, weight=0.6)
    s = post.summary()
    assert s["basis"] == "net" and s["basis_probs"]["net"] > 0.8
    assert 4600 <= s["mean"] <= 5300
    assert len(asked) <= 6


def test_bald_discrete_prefers_discriminating_case():
    hyps = [Hypothesis("dec_only", 0.5, lambda c: "hold" if c["month"] == 12 and c["dup"] else "post"),
            Hypothesis("any_dup", 0.5, lambda c: "hold" if c["dup"] else "post")]
    same = {"month": 12, "dup": True}
    split = {"month": 3, "dup": True}
    assert bald_discrete(hyps, split) > 0.5 > bald_discrete(hyps, same)
    post = posterior_update(hyps, split, "hold")
    assert post["any_dup"] > 0.9


def test_oracle_confabulates_when_asked():
    case = PACK.demo_cases()["capture"][1]
    honest = OracleSabine(confabulation=0.0).explain(case, "action")
    assert "double" in honest
