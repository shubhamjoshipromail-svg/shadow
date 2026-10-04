"""Tests for the proactive coach (T1).

Pure-logic tests only: no server, no LLM. The final test is the acceptance's
"full simulated trainee run" over the tutor demo cases plus 20 generated ones.
"""

from __future__ import annotations

import random

from shadow import coach
from shadow.coach import brief, fade, hint_ladder, next_case
from shadow.packs import get_pack
from shadow.workmap import (
    Belief,
    Guardrail,
    Quote,
    Rule,
    ScreenMoment,
    TRUSTED,
    WorkMap,
    check_proposal,
    run_map,
)

PACK = get_pack("ap_invoices")

# --------------------------------------------------------------------- fixtures
_CAPEX = {c["id"]: c for c in PACK.demo_cases()["tutor"]}["inv-5120"]   # equipment ~7.2k, no asset number
_FRAUD = {c["id"]: c for c in PACK.demo_cases()["tutor"]}["inv-5121"]   # new supplier + bank changed
_SKONTO = {c["id"]: c for c in PACK.demo_cases()["tutor"]}["inv-5122"]  # service, 2% Skonto


def _node_belief(node):
    node.belief = Belief(status="confirmed", p=0.9)
    return node


def _coach_map() -> WorkMap:
    """The doc map plus the kind of learned judgment the capture loop produces."""
    seed = PACK.seed_map()
    wm = WorkMap(pack_id=PACK.id, task=PACK.task, expert=PACK.expert_name,
                 steps=seed["steps"], rules=seed["rules"], guardrails=seed["guardrails"],
                 params=seed["params"])
    sm = lambda field, label: ScreenMoment(field=field, label=label)  # noqa: E731
    learned_rules = [
        Rule(id="RC", title="Equipment over 5,000 net is capex",
             when="inv.category == 'equipment' and inv.net_eur > 5000",
             then={"cost_center": "0400"},
             quote=Quote(text="Equipment over five thousand net is always capex."),
             screen_moment=sm("net", "Net amount")),
        Rule(id="RI", title="IT hardware over 5,000 net is IT capex",
             when="inv.category == 'it_hardware' and inv.net_eur > 5000",
             then={"cost_center": "0410"},
             quote=Quote(text="IT hardware over five thousand goes to 0410."),
             screen_moment=sm("category", "Category")),
        Rule(id="RIC", title="Intercompany goes to 9100",
             when="inv.intercompany",
             then={"cost_center": "9100"},
             quote=Quote(text="That's our Czech subsidiary; intercompany goes to 9100."),
             screen_moment=sm("supplier.country", "Supplier country")),
        Rule(id="RCON", title="Consumables go to 4720",
             when="inv.category == 'consumables'",
             then={"cost_center": "4720"},
             quote=Quote(text="Small parts and consumables go to 4720."),
             screen_moment=sm("category", "Category")),
        Rule(id="RRC", title="EU supplier means reverse charge",
             when="inv.eu_foreign",
             then={"tax_code": "RC"},
             quote=Quote(text="EU supplier outside Germany, so reverse charge."),
             screen_moment=sm("supplier.country", "Supplier country")),
        Rule(id="RSK", title="Two percent Skonto, pay within ten days",
             when="inv.skonto_pct >= 2",
             then={"payment_timing": "skonto"},
             quote=Quote(text="Two percent Skonto, so I pay within the ten days."),
             screen_moment=sm("payment_terms.skonto_pct", "Skonto")),
    ]
    learned_guardrails = [
        Guardrail(id="GA", title="No asset number, no capex booking", type="hard_limit",
                  when="booking.cost_center in ['0400', '0410'] and not inv.asset_number_available",
                  action="hold",
                  quote=Quote(text="No asset number, no capex booking."),
                  screen_moment=sm("po.asset_number", "Asset number")),
        Guardrail(id="GF", title="New supplier with changed bank details", type="stop_and_ask",
                  when="inv.supplier_status in ['new', 'unknown'] and inv.bank_changed",
                  action="escalate", ask="controller",
                  quote=Quote(text="New supplier and the bank changed? I stop and ask the controller."),
                  screen_moment=sm("supplier.bank_changed_recently", "Bank details")),
        Guardrail(id="GD", title="Duplicate amount within 30 days", type="hold",
                  when="inv.dup_amount_recent and inv.dup_days <= 30", action="hold",
                  quote=Quote(text="Same amount two weeks ago — I hold it and call them."),
                  screen_moment=sm("history", "Invoice history")),
        Guardrail(id="GV", title="Price variance over two percent", type="hold",
                  when="inv.price_variance_pct > 2.0", action="hold",
                  quote=Quote(text="Over two percent and I hold and ask purchasing."),
                  screen_moment=sm("po.price_variance_pct", "Price variance")),
    ]
    for node in [*learned_rules, *learned_guardrails]:
        wm.rules.append(node) if isinstance(node, Rule) else wm.guardrails.append(node)
        _node_belief(node)
    return wm


def _mastered(ids, p=0.9) -> dict:
    return {nid: {"p": p, "opportunities": 3, "title": nid, "status": "mastered"} for nid in ids}


def _find(pred, *, n=300, seed=1):
    for c in PACK.generate_cases(n, seed=seed):
        if pred(PACK.derive(c)["inv"]):
            return c
    raise AssertionError("no matching generated case")


def _plain_consumables():
    return _find(lambda d: d["category"] == "consumables" and not d["intercompany"]
                 and not d["dup_amount_recent"] and d["skonto_pct"] < 2 and d["price_variance_pct"] <= 2.0)


def _intercompany_equipment():
    return PACK._make("ic-2", "nordwerk_cz", "equipment", 0, rng=random.Random(1), scale=1.2)


# ----------------------------------------------------------------- next_case
def test_next_case_returns_an_unseen_case():
    wm = _coach_map()
    pool = [_CAPEX, _plain_consumables()]
    picked = next_case(wm, PACK, {}, set(), pool)
    assert picked is not None and picked["id"] in {c["id"] for c in pool}


def test_next_case_skips_seen_ids():
    wm = _coach_map()
    plain = _plain_consumables()
    picked = next_case(wm, PACK, {}, {_CAPEX["id"]}, [_CAPEX, plain])
    assert picked is not None
    assert picked["id"] == plain["id"]


def test_next_case_returns_none_when_everything_seen():
    wm = _coach_map()
    pool = [_CAPEX, _plain_consumables()]
    assert next_case(wm, PACK, {}, {c["id"] for c in pool}, pool) is None


def test_next_case_returns_none_on_empty_pool():
    assert next_case(_coach_map(), PACK, {}, set(), []) is None


def test_next_case_prefers_the_weakest_rule():
    wm = _coach_map()
    mastery = _mastered(["RCON", "GA", "GF", "GD", "GV", "RI", "RIC", "RRC", "RSK"])
    mastery["RC"] = {"p": 0.1}
    plain = _plain_consumables()
    picked = next_case(wm, PACK, mastery, set(), [plain, _CAPEX])
    assert picked["id"] == _CAPEX["id"], "the case exercising the shaky capex rule must win"


def test_next_case_puts_shaky_guardrails_first():
    wm = _coach_map()
    mastery = _mastered(["RCON", "GF", "GD", "GV", "RI", "RIC", "RRC", "RSK"])
    mastery["RC"] = {"p": 0.05}
    mastery["GA"] = {"p": 0.45}  # guardrail below 0.5 -> promoted
    plain = _plain_consumables()
    picked = next_case(wm, PACK, mastery, set(), [plain, _CAPEX])
    assert picked["id"] == _CAPEX["id"]


def test_next_case_interleaves_weak_skills():
    wm = _coach_map()
    mastery = _mastered(["GA", "GF", "GD", "GV", "RI", "RRC", "RSK", "RCON"])
    mastery["RC"] = {"p": 0.2}
    mastery["RIC"] = {"p": 0.2}
    single = _plain_consumables()          # only RCON (high) in play
    multi = _intercompany_equipment()      # RC + RIC, both shaky
    picked = next_case(wm, PACK, mastery, set(), [single, multi])
    assert picked["id"] == multi["id"], "a case mixing two weak skills must be preferred"


def test_next_case_falls_back_when_map_has_no_trusted_nodes():
    seed = PACK.seed_map()
    wm = WorkMap(pack_id=PACK.id, task=PACK.task, expert=PACK.expert_name, **seed)
    plain = _plain_consumables()
    assert next_case(wm, PACK, {}, set(), [plain, _CAPEX])["id"] == plain["id"]


def test_next_case_ignores_untrusted_inferred_nodes():
    seed = PACK.seed_map()
    wm = WorkMap(pack_id=PACK.id, task=PACK.task, expert=PACK.expert_name, **seed)
    wm.rules.append(Rule(id="RX", title="Inferred only",
                         when="inv.category == 'equipment' and inv.net_eur > 5000",
                         then={"cost_center": "0400"}))  # belief stays 'inferred'
    plain = _plain_consumables()
    assert next_case(wm, PACK, {}, set(), [plain, _CAPEX])["id"] == plain["id"]


# --------------------------------------------------------------------- brief
def test_brief_names_the_fields_that_matter_and_the_prompt():
    b = brief(_coach_map(), PACK, _CAPEX, {})
    assert b["case_id"] == "inv-5120"
    assert b["predict"] == coach.PREDICT_PROMPT
    assert "cost_center" in {f["field"] for f in b["fields"]}
    assert b["summary"]
    assert "GA" in b["guardrails"]


def test_brief_reports_fired_rule_as_mattering():
    b = brief(_coach_map(), PACK, _CAPEX, {})
    cc = next(f for f in b["fields"] if f["field"] == "cost_center")
    assert cc["node_id"] == "RC"
    assert cc["fires"] is True
    assert "applies here" in cc["why"]


def test_brief_lists_nearly_firing_rules_as_also():
    b = brief(_coach_map(), PACK, _plain_consumables(), _mastered(["RCON"]))
    cc = next(f for f in b["fields"] if f["field"] == "cost_center")
    assert cc["node_id"] == "RCON" and cc["fires"] is True
    assert "RC" in cc["also"], "the capex rule is close on this case and must be surfaced"


def test_brief_shows_a_worked_example_below_0_3_mastery():
    mastery = _mastered(["GA", "GF", "GD", "GV", "RI", "RIC", "RCON", "RRC", "RSK"])
    mastery["RC"] = {"p": 0.2}
    b = brief(_coach_map(), PACK, _CAPEX, mastery)
    we = b["worked_example"]
    assert we is not None
    assert we["node_id"] == "RC"
    assert "five thousand" in we["quote"]
    assert we["screen_moment"]["field"] == "net"


def test_brief_omits_worked_example_above_0_3_mastery():
    mastery = _mastered(["RC", "GA", "GF", "GD", "GV", "RI", "RIC", "RCON", "RRC", "RSK"])
    b = brief(_coach_map(), PACK, _CAPEX, mastery)
    assert b["worked_example"] is None


def test_brief_falls_back_to_doc_prediction_without_learned_nodes():
    seed = PACK.seed_map()
    wm = WorkMap(pack_id=PACK.id, task=PACK.task, expert=PACK.expert_name, **seed)
    b = brief(wm, PACK, _CAPEX, {})
    assert b["fields"], "the brief must still name fields when no node is learned"
    assert b["focus"]["node_id"] in {f["node_id"] for f in b["fields"]}


# --------------------------------------------------------------- hint ladder
def _ladder(level):
    return hint_ladder(_coach_map(), PACK, _CAPEX, {"cost_center": "4711"}, "post", level)


def test_hint_level_1_reveals_only_the_field():
    h = _ladder(1)
    assert h["field"] == "cost_center"
    assert h["title"] is None and h["quote"] is None and h["answer"] is None
    assert "Five thousand" not in h["text"]
    assert "0400" not in h["text"]


def test_hint_level_2_reveals_the_rule_title_not_the_words():
    h = _ladder(2)
    assert h["title"] == "Equipment over 5,000 net is capex"
    assert h["title"] in h["text"]
    assert h["quote"] is None and h["answer"] is None
    assert "0400" not in h["text"]


def test_hint_level_3_reveals_the_experts_words():
    h = _ladder(3)
    assert h["quote"] == "Equipment over five thousand net is always capex."
    assert h["quote"] in h["text"]
    assert h["answer"] is None
    assert "0400" not in h["text"]


def test_hint_level_4_reveals_the_answer():
    h = _ladder(4)
    assert h["answer"] == "0400"
    assert "0400" in h["text"]


def test_hint_ladder_escalates_monotonically():
    texts = [_ladder(lvl)["text"] for lvl in (1, 2, 3, 4)]
    assert texts[0] in texts[1] in texts[2] in texts[3] or all(
        texts[i] in texts[i + 1] for i in range(3)
    )
    assert len(set(texts)) == 4


def test_hint_ladder_clamps_levels():
    assert _ladder(0)["level"] == 1
    assert _ladder(99)["level"] == 4


def test_hint_ladder_uses_the_prediction_when_nothing_is_wrong():
    h = hint_ladder(_coach_map(), PACK, _CAPEX, {"cost_center": "0400"}, "hold", 4)
    assert h["node_id"] == "GA"
    assert h["answer"] == "hold"
    assert h["field"] == "action"


def test_hint_ladder_matches_check_proposal_target():
    wm = _coach_map()
    violations = check_proposal(wm, PACK, _CAPEX, {"cost_center": "4711"}, "post", TRUSTED)
    h = hint_ladder(wm, PACK, _CAPEX, {"cost_center": "4711"}, "post", 2)
    assert h["node_id"] == violations[0].node_id
    assert h["field"] == violations[0].field


# ---------------------------------------------------------------------- fade
def test_fade_thresholds():
    assert fade(None) == "coach"
    assert fade(0.0) == "coach"
    assert fade(0.49) == "coach"
    assert fade(0.5) == "check"
    assert fade(0.84) == "check"
    assert fade(0.85) == "silent"
    assert fade(1.0) == "silent"


def test_fade_never_silences_a_guardrail():
    assert fade(0.2, guardrail=True) == "coach"
    assert fade(0.7, guardrail=True) == "check"
    assert fade(0.9, guardrail=True) == "check"
    assert fade(1.0, guardrail=True) == "check"


# ------------------------------------------------- full simulated trainee run
def _bkt(mastery: dict, node_id: str, title: str, correct: bool) -> None:
    """The engine's BKT update, replicated so the run needs no Session."""
    m = mastery.setdefault(node_id, {"p": 0.2, "opportunities": 0, "title": title})
    p = m["p"]
    p_t, p_s, p_g = 0.3, 0.1, 0.2
    if correct:
        cond = p * (1 - p_s) / (p * (1 - p_s) + (1 - p) * p_g)
    else:
        cond = p * p_s / (p * p_s + (1 - p) * (1 - p_g))
    m["p"] = round(cond + (1 - cond) * p_t, 3)
    m["opportunities"] += 1
    m["status"] = "mastered" if m["p"] >= 0.85 else ("shaky" if m["p"] >= 0.5 else "practice")


def test_full_simulated_trainee_run_escalates_and_fades():
    wm = _coach_map()
    candidates = PACK.demo_cases()["tutor"] + PACK.generate_cases(20, seed=7)
    seen: set[str] = set()
    mastery: dict = {}
    exposures: dict[str, int] = {}
    fade_by_node: dict[str, list[str]] = {}
    guardrail_fades: list[str] = []
    escalations = 0

    for _ in range(len(candidates)):
        case = next_case(wm, PACK, mastery, seen, candidates)
        assert case is not None, "curriculum exhausted before the candidate pool was used up"
        assert case["id"] not in seen
        seen.add(case["id"])

        b = brief(wm, PACK, case, mastery)
        assert b["predict"] == coach.PREDICT_PROMPT
        focus = b["focus"]

        # The simulated trainee misses the first exposure of a skill, then improves.
        n = exposures.get(focus["node_id"], 0)
        exposures[focus["node_id"]] = n + 1
        correct = n != 0

        state = fade(focus["p"], guardrail=focus["guardrail"])
        fade_by_node.setdefault(focus["node_id"], []).append(state)
        if focus["guardrail"]:
            guardrail_fades.append(state)

        if not correct:
            pred = run_map(wm, PACK, case, TRUSTED)
            expected_cc = pred.fields["cost_center"].value if "cost_center" in pred.fields else None
            wrong_cc = "4720" if expected_cc != "4720" else "4711"
            booking = {"cost_center": wrong_cc}
            hints = [hint_ladder(wm, PACK, case, booking, "post", lvl) for lvl in (1, 2, 3, 4)]
            # hints escalate, and each level hides what the next one reveals
            for lower, higher in zip(hints, hints[1:]):
                assert lower["text"] in higher["text"]
            assert hints[0]["reveals"] == {"field": True, "rule": False, "quote": False, "answer": False}
            assert hints[3]["reveals"]["answer"] is True
            assert hints[0]["answer"] is None and hints[0]["title"] is None
            assert hints[3]["answer"] is not None
            escalations += 1

        _bkt(mastery, focus["node_id"], focus["title"], correct)

    assert seen == {c["id"] for c in candidates}
    assert escalations >= 3, "several first attempts should need hints"
    assert any("coach" in states for states in fade_by_node.values())
    assert any(any(s in ("check", "silent") for s in states) for states in fade_by_node.values()), fade_by_node
    # a skill that was coached must later be checked or silent (fade, not static)
    assert any(states[0] == "coach" and any(s != "coach" for s in states[1:])
               for states in fade_by_node.values()), fade_by_node
    # guardrails are never allowed to fade to silence
    assert guardrail_fades and all(s != "silent" for s in guardrail_fades), guardrail_fades
