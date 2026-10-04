"""GENERALITY — the second-workflow truth test.

The SAME engine learns a non-invoice workflow (`expense_approval`) with no
workflow-specific engine code. The hidden rules live *here*, in the test — not
in the pack, not in an oracle — and a stub compiler turns the expert's own
sentence into the rule an LLM would compile.

Chain under test (task G):
  AI prediction (from the written process only) → expert divergence (gap) →
  a question is asked → the answer compiles to a rule in the pack's namespace →
  the map predicts UNSEEN generated claims → a sealed `proof.build` round around
  the learned threshold scores ≥ 90%.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib

from shadow import hypotheses, proof as proof_mod
from shadow.compiler import Compiled, CompiledRule, ThresholdStatement, example_expression, namespace, system
from shadow.engine import Session
from shadow.packs import get_pack
from shadow.questions import template
from shadow.workmap import run_map

PACK = get_pack("expense_approval")  # a GenericPack: a TaskDefinition, not code
NS = PACK.namespace  # "task"

# ---------------------------------------------------------------------------
# The hidden judgment. Two rules the 2021 process doc does not contain. These
# are deliberately defined only in this test (no pack, no oracle).
# ---------------------------------------------------------------------------
TRUE_T = 750.0  # "over seven hundred and fifty, without a receipt, goes to finance"

DOC_ACCOUNT = {"travel": "6200", "software": "6300", "equipment": "6300", "meals": "6400"}


def expert_decision(case: dict) -> dict:
    """What the experienced human actually does (the thing Shadow must learn)."""
    facts = PACK.derive(case)[NS]
    amount = facts.get("amount_eur") or 0.0
    receipt = facts.get("receipt_attached")
    route = "manager_approve" if amount > 500 else "auto_approve"  # the written rule
    if receipt is False and amount > TRUE_T:  # hidden rule 1 (a threshold)
        route = "finance_review"
    if facts.get("category") == "meals" and facts.get("customer_billable"):  # hidden rule 2
        route = "finance_review"
    action = "request_receipt" if (receipt is False and amount >= 100) else "auto_approve"
    return {"approval_route": route,
            "gl_account": DOC_ACCOUNT.get(facts.get("category"), "6500"),
            "action": action}


# What the expert says when Shadow asks why. It states both hidden rules at once.
ANSWER = ("Without a receipt, seven hundred and fifty euros or more always goes to finance review. "
          "And client entertainment — meals that are billable to a customer — needs finance review too.")


class ExpenseCompiler:
    """A stub for the LLM compile: one sentence → the rules it expresses (task namespace)."""

    provenance = "test stub (expense approval, no oracle)"

    async def __call__(self, pack, wm, inquiry, transcript, case) -> Compiled:
        if inquiry.get("field") == "approval_route" and inquiry.get("type") not in ("counterfactual", "exam"):
            ns = namespace(pack)
            return Compiled(
                answers_question=True, key_quote=transcript, strength="always",
                rules=[
                    CompiledRule(title="No receipt above 750 EUR goes to finance review",
                                 when=f"{ns}.receipt_attached == False and {ns}.amount_eur > params.T_amount",
                                 field="approval_route", value="finance_review", quote=transcript),
                    CompiledRule(title="Client entertainment always gets finance review",
                                 when=f"{ns}.category == 'meals' and {ns}.customer_billable == True",
                                 field="approval_route", value="finance_review", quote=transcript),
                ],
                threshold=ThresholdStatement(param="T_amount", value=TRUE_T, quantity=f"{ns}.amount_eur"),
            )
        return Compiled(answers_question=False, key_quote=transcript)


async def no_proposals(*_args, **_kw):
    return []


def expensive_untouched_case() -> dict:
    """A claim whose decision the written doc gets wrong: 900 EUR, no receipt."""
    case = copy.deepcopy(PACK.demo_cases()["capture"][2])  # exp-7003 (meals, no receipt)
    case["id"] = "exp-9001"
    case["facts"].update({"amount_eur": 900.0, "category": "training", "receipt_attached": False,
                          "customer_billable": False, "preapproved": False})
    return case


def new_session(sid: str = "gen") -> Session:
    return Session(sid, PACK, mode="capture", use_llm=False, proposer=no_proposals,
                   compiler=ExpenseCompiler())


async def teach_the_threshold(s: Session) -> tuple:
    """One live episode: predict → diverge → ask → answer → compile."""
    case = expensive_untouched_case()
    s.cases[case["id"]] = case
    s.case_order.append(case["id"])
    await s.open_case(case["id"])
    predicted = s.dps[case["id"]].prediction.fields["approval_route"].value
    decision = expert_decision(case)
    booking = {k: v for k, v in decision.items() if k != "action"}
    await s.on_decision(case["id"], booking, decision["action"])
    await s.drain()
    note = await s.tick(force=True)
    return case, predicted, decision, note


# ------------------------------------------------------------------- the chain
def test_second_workflow_full_chain_and_sealed_proof():
    async def run():
        s = new_session()
        case, predicted, decision, q = await teach_the_threshold(s)

        # 1. the AI (written process only) predicted the doc answer
        assert predicted == "manager_approve", predicted
        # 2. the expert diverged: a structural gap, not a parameter move
        ep = s.episodes[-1]
        gap = next(g for g in ep.gaps if g["field"] == "approval_route")
        assert gap["type"] == "structural" and gap["expert"] == "finance_review"
        assert decision["approval_route"] == "finance_review"
        # 3. a question is asked, phrased with the pack's own noun and labels
        assert q is not None and q.field == "approval_route", q
        assert "claim" in q.text.lower() and "invoice" not in q.text.lower() and "post" not in q.text.lower()
        assert "finance review" in q.text.lower() and "manager" in q.text.lower()
        # 4. the answer compiles into rules in the pack's namespace + a threshold
        await s.on_utterance(ANSWER)
        await s.drain()
        learned = [r for r in s.wm.rules if r.origin != "doc"]
        assert learned, "no rule learned"
        assert any(f"params.T_amount" in r.when for r in learned), [r.when for r in learned]
        assert all(f"{NS}." in r.when and "inv." not in r.when for r in learned), [r.when for r in learned]
        assert 700 < s.wm.params["T_amount"] < 800, s.wm.params["T_amount"]
        rc = next(r for r in s.receipts if r["trigger"] == "answer")
        assert rc["status"] == "learned" and rc["after"]["value"] == "finance_review"

        # 5. the map predicts UNSEEN generated claims (never shown to the expert)
        unseen = PACK.generate_cases(80, seed=11)
        agree = sum(run_map(s.wm, PACK, c).fields["approval_route"].value == expert_decision(c)["approval_route"]
                    for c in unseen)
        assert agree / len(unseen) >= 0.95, f"{agree}/{len(unseen)}"
        high_no_receipt = next(c for c in unseen if c["facts"]["receipt_attached"] is False
                               and c["facts"]["amount_eur"] > 1200)
        assert run_map(s.wm, PACK, high_no_receipt).fields["approval_route"].value == "finance_review"
        entertainment = next(c for c in unseen if c["facts"]["category"] == "meals"
                             and c["facts"]["customer_billable"])
        assert run_map(s.wm, PACK, entertainment).fields["approval_route"].value == "finance_review"

        # 6. a sealed boundary test around the learned threshold, labelled by the hidden expert
        p = proof_mod.build(s, "T_amount", seed=7)
        assert p["param"] == "T_amount" and p["mode"] == "threshold"
        assert p["commitment"] == hashlib.sha256(proof_mod.sealed_body(p).encode()).hexdigest()
        assert all(i["sealed"] and "predicted" not in i for i in proof_mod.view(p)["items"])
        for item in p["items"]:
            label = expert_decision(s.cases[item["case_id"]])["approval_route"]
            await s.on_label(item["case_id"], {"approval_route": label})
            await s.drain()
        sm = proof_mod.summary(p)
        assert sm["complete"] and sm["labeled"] == sm["n"]
        assert sm["accuracy"] >= 0.9, sm
        assert proof_mod.view(p)["sealed_body"]

    asyncio.run(run())


# ------------------------------------------------------------------- no leaks
def _invoice_pack():
    return get_pack("ap_invoices")


def test_generic_questions_use_pack_nouns_and_labels():
    assert template(PACK, "counterfactual", case=expensive_untouched_case(), field="approval_route",
                    expert_value="finance_review", probe_delta="the amount is 200 EUR") == \
        "Imagine the same claim, but the amount is 200 EUR. Would you still use finance_review (Finance review)?"
    guard = template(PACK, "guardrail", case=expensive_untouched_case(), field="action")
    assert "claim" in guard and "approve" in guard and "invoice" not in guard and "post" not in guard


def test_invoice_question_phrasing_is_unchanged():
    invoice = _invoice_pack()
    case = invoice.demo_cases()["capture"][0]
    ref = f"invoice {case.get('invoice_no', case.get('id'))}"
    assert template(invoice, "counterfactual", case=case, field="cost_center", expert_value="0400",
                    probe_delta="net is 6,000 EUR") == (
        f"Imagine the same invoice, but net is 6,000 EUR. Would you still code it to 0400 "
        f"(Capex – Machinery & Equipment)?")
    assert template(invoice, "cue_probe", case=case, field="action", expert_value="post",
                    predicted_value="hold") == f"You posted. What made you do that?"
    assert template(invoice, "guardrail", case=case, field="action").startswith(f"On an invoice like {ref},")
    assert "post" in template(invoice, "guardrail", case=case, field="action")


def test_deviation_template_is_neutral():
    text = template(PACK, "deviation", case=expensive_untouched_case(), field="approval_route",
                    node_title="Claims over 500 EUR go to the line manager")
    low = text.lower()
    assert "exception" in low and "change in how it's done" in low and "one-off" in low
    assert "wrong" not in low and "mistake" not in low
    assert "claim exp-9001" in low and "invoice" not in low


def test_compiler_and_hypotheses_prompts_take_the_pack_namespace():
    generic = system(PACK)
    assert f"{NS}.category" in generic or f"{NS}.amount_eur" in generic
    assert "inv." not in generic
    assert namespace(PACK) == NS
    assert example_expression(PACK).startswith(f"{NS}.")
    invoice = _invoice_pack()
    assert namespace(invoice) == "inv"
    assert "inv.category == 'equipment' and inv.net_eur > params.T_capex" == example_expression(invoice)
    assert "inv.category" in system(invoice)
    assert "task." not in system(invoice)
    assert f"{NS}." in hypotheses._system(PACK)
    assert "inv." not in hypotheses._system(PACK)
    assert "params.T_amount" in hypotheses._system(PACK)
    assert "inv.net_eur > 5000" in hypotheses._system(invoice)  # invoice example preserved
    assert "inv." in hypotheses._system(invoice)


def test_generic_pack_exposes_goal_and_action_labels():
    assert PACK.goal and "reimbursed" in PACK.goal
    assert PACK.case_noun == "claim"
    assert PACK.action_labels["finance_review"] == "Send to finance"
    assert PACK.process_doc and "500 EUR" in PACK.process_doc
