"""Simulated expert ('Oracle Sabine') for offline runs, tests, evaluation and rehearsal.

The proposer/compiler stand-ins are driven by the oracle's hidden rules, so
the whole Shadow loop runs deterministically without API calls and the tests
exercise Shadow's own logic (gaps, EVOI, BALD, belief, debrief, tutor) rather
than an LLM's parsing. `sim_answer` produces what simulated Sabine says out
loud, so a session can be driven end to end through the same voice path.
"""

from __future__ import annotations

from typing import Any

from shadow.compiler import Compiled, CompiledRule, ThresholdStatement
from shadow.hypotheses import ProposedRule
from shadow.packs.ap_invoices import PACK
from shadow.packs.ap_invoices.oracle import REASONS, OracleSabine, decide

TRUTH: dict[str, dict[str, Any]] = {
    "capex": dict(rule=CompiledRule(title="Equipment over 5,000 EUR net is capex",
                                    when="inv.category == 'equipment' and inv.net_eur > params.T_capex",
                                    field="cost_center", value="0400"),
                  threshold=ThresholdStatement(param="T_capex", value=5000, quantity="inv.net_eur")),
    "dup": dict(rule=CompiledRule(title="Same amount invoiced again within a month: hold and call the supplier",
                                  when="inv.dup_amount_recent", field="action", value="hold", kind="guardrail",
                                  guardrail_type="hold")),
    "ic": dict(rule=CompiledRule(title="Intercompany invoices go to 9100", when="inv.intercompany",
                                 field="cost_center", value="9100")),
    "ic_action": dict(rule=CompiledRule(title="Intercompany always needs Keller's second approval",
                                        when="inv.intercompany", field="action", value="second_approval",
                                        kind="guardrail", guardrail_type="second_approval", ask="M. Keller")),
    "skonto": dict(rule=CompiledRule(title="With 2% Skonto, pay inside the Skonto window",
                                     when="inv.skonto_pct >= 2", field="payment_timing", value="skonto")),
    "capex_it": dict(rule=CompiledRule(title="IT hardware over 5,000 EUR net is IT capex",
                                       when="inv.category == 'it_hardware' and inv.net_eur > params.T_capex",
                                       field="cost_center", value="0410"),
                      threshold=ThresholdStatement(param="T_capex", value=5000, quantity="inv.net_eur")),
    "rc": dict(rule=CompiledRule(title="EU supplier outside Germany: reverse charge", when="inv.eu_foreign",
                                 field="tax_code", value="RC")),
    "asset": dict(rule=CompiledRule(title="No asset number, no capex booking",
                                    when="booking.cost_center in ['0400', '0410'] and not inv.asset_number_available",
                                    field="action", value="hold", kind="guardrail", guardrail_type="hard_limit")),
}

FIELD_TRUTH = {
    ("cost_center", "0400"): "capex", ("cost_center", "0410"): "capex_it", ("cost_center", "9100"): "ic", ("action", "hold"): "dup",
    ("action", "second_approval"): "ic_action", ("payment_timing", "skonto"): "skonto", ("tax_code", "RC"): "rc",
}


async def fake_propose(pack, wm, case, field, expert_value, predicted_value, attention) -> list[ProposedRule]:
    key = FIELD_TRUTH.get((field, expert_value))
    out = []
    if key:
        r = TRUTH[key]["rule"]
        when = r.when.replace("params.T_capex", "5000")
        out.append(ProposedRule(title=r.title, when=when, kind="guardrail" if r.kind == "guardrail" else "rule",
                                plausibility=0.6))
    # distractors that also hold on this case
    d = pack.derive(case)["inv"]
    out.append(ProposedRule(title=f"Supplier {d['supplier_name']} is always treated this way",
                            when=f"inv.supplier_id == '{d['supplier_id']}'", plausibility=0.3))
    out.append(ProposedRule(title="Amounts above 1,000 EUR are handled this way", when="inv.net_eur > 1000",
                            plausibility=0.2) if d["net_eur"] > 1000 else
               ProposedRule(title="Small invoices are handled this way", when="inv.net_eur <= 1000", plausibility=0.2))
    return out


class FakeCompiler:
    def __init__(self, confabulation: float = 0.0):
        self.oracle = OracleSabine(confabulation=confabulation)
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, pack, wm, inquiry, transcript, case) -> Compiled:
        self.calls.append(inquiry)
        qtype, field = inquiry["type"], inquiry.get("field")
        if qtype in ("counterfactual", "exam"):
            answer = self.oracle.answer_probe(case, field or "action")
            return Compiled(answers_question=True, key_quote=transcript, probe_answer=str(answer))
        if qtype == "teachback":
            return Compiled(answers_question=True, key_quote=transcript, confirms=True)
        if qtype == "guardrail":
            t = TRUTH["asset"]
            return Compiled(answers_question=True, key_quote=REASONS["asset"], rules=[t["rule"]], strength="never")
        if qtype == "confirm":
            return Compiled(answers_question=True, key_quote=transcript, confirms=True)
        key = FIELD_TRUTH.get((field, inquiry.get("expert_value")))
        if not key:
            return Compiled(answers_question=True, key_quote=transcript)
        t = TRUTH[key]
        return Compiled(answers_question=True, key_quote=REASONS.get(key.split("_")[0], transcript),
                        rules=[t["rule"]], threshold=t.get("threshold"), strength="always")


def sim_answer(session, q) -> str:
    """What simulated Sabine says out loud when asked `q`."""
    from shadow import questions  # local import: avoid a cycle at module load
    if q.type == "teachback":
        return "Yes, that's how it works."
    if q.type == "guardrail":
        return REASONS["asset"]
    if q.type == "confirm":
        return "Yes, exactly."
    if q.type in ("counterfactual", "exam") and q.probe_case is not None:
        oracle = OracleSabine()
        ans = oracle.answer_probe(q.probe_case, q.field or "action")
        return f"In that case I'd {questions.value_phrase(PACK, q.field or 'action', ans)}."
    key = FIELD_TRUTH.get((q.field, q.expert_value))
    return REASONS.get(key.split("_")[0], "It's just how we do it.") if key else "It's just how we do it."


def oracle_booking(case: dict[str, Any]) -> tuple[dict[str, Any], str]:
    dec = decide(case)
    booking = PACK.booking_from_decision(case, {**dec.fields, "asset_number": dec.asset_number})
    return booking, dec.action
