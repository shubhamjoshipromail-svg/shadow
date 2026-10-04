"""Two experts, one task: the comparison endpoint, the question queue, and the debrief that picks it up.

Offline: no LLM. Two hand-built maps stand in for two experts (Sabine: capex over 5,000; Klaus: over 4,000 and an
extra guardrail), saved in a scratch store. A stub compiler plays the compile step of the debrief answer.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from shadow import compare, main
from shadow.compiler import Compiled, CompiledRule
from shadow.engine import Session
from shadow.packs import get_pack
from shadow.store import Store
from tests.test_compare import _map

PACK = get_pack("ap_invoices")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    store = Store(f"sqlite:///{tmp_path}/two.db")
    monkeypatch.setattr(main, "store", store)
    store.create_session("s-sabine", "capture", PACK.id, "Sabine", {"workflow": PACK.id})
    store.save_map("Sabine", PACK.id, "s-sabine", 3, _map("Sabine", 5000).model_dump())
    store.create_session("s-klaus", "capture", PACK.id, "Klaus", {"simulated": True, "workflow": PACK.id})
    store.save_map("Klaus", PACK.id, "s-klaus", 2, _map("Klaus", 4000, with_guardrail=True).model_dump())
    return TestClient(main.app), store


def test_simulated_expert_is_hidden_unless_asked_for_and_then_labelled(client):
    c, store = client
    assert store.latest_map_row("Klaus", PACK.id) is None  # "latest map" still ignores the simulator
    assert [m["expert"] for m in store.expert_maps(PACK.id, include_simulated=False)] == ["Sabine"]
    r = c.get(f"/api/workflows/{PACK.id}/compare", params={"a": "Sabine", "b": "Klaus"})
    assert r.status_code == 409 and "simulator" in r.json()["detail"]
    r = c.get(f"/api/workflows/{PACK.id}/compare", params={"a": "Sabine", "b": "Klaus", "simulated": True})
    assert r.status_code == 200
    out = r.json()
    assert out["simulated"] == {"a": False, "b": True}
    experts = c.get(f"/api/workflows/{PACK.id}/experts").json()
    assert {(e["expert"], e["simulated"]) for e in experts} == {("Sabine", False), ("Klaus", True)}
    wf = next(w for w in c.get("/api/workflows").json() if w["id"] == PACK.id)
    assert wf["experts"] == ["Sabine"] and len(wf["compare_experts"]) == 2  # Klaus is rehearsal: not in "experts"


def test_comparison_shows_differences_with_each_experts_words(client):
    c, _ = client
    out = c.get(f"/api/workflows/{PACK.id}/compare", params={"a": "Sabine", "b": "Klaus", "simulated": True}).json()
    assert out["threshold_diffs"] == [{"param": "T_capex", "a": 5000.0, "b": 4000.0}]
    th = out["thresholds"][0]
    assert th["a_node"]["quote"]["text"] and th["b_node"]["quote"]["text"]
    assert any(u["title"] == "No asset number, no capex booking" for u in out["unique"]["b"])
    band = [g for g in out["disagree"] if g["field"] == "cost_center" and g["b_value"] == "0400"]
    assert band and band[0]["a_value"] is None  # the band between 4,000 and 5,000: Klaus codes it, Sabine's map does not
    g = band[0]
    assert g["key"] and g["b_quote"] and g["case"] and g["a_quote"] is None
    assert g["a_node"] is None and g["b_node"]["title"]
    # one neutral question per expert, naming the case and the other's choice
    assert "Klaus would code it to 0400" in g["questions"]["a"] and "Sabine would leave" in g["questions"]["b"]
    assert g["case_ref"] in g["questions"]["a"]
    assert out["shared"], "rules both experts hold are listed as agreement"


def test_asking_queues_once_per_expert_and_shows_in_the_comparison(client):
    c, store = client
    body = {"a": "Sabine", "b": "Klaus", "simulated": True}
    first = c.post(f"/api/workflows/{PACK.id}/compare/ask", json=body).json()
    n = len(first["compare"]["disagree"])
    assert len(first["queued"]) == 2 * n and {q["status"] for q in first["queued"]} == {"queued"}
    again = c.post(f"/api/workflows/{PACK.id}/compare/ask", json=body).json()
    assert {q["id"] for q in again["queued"]} == {q["id"] for q in first["queued"]}  # idempotent
    assert len(store.peer_questions_for(PACK.id)) == 2 * n
    for g in again["compare"]["disagree"]:
        assert g["asked"]["a"]["status"] == "queued" and g["asked"]["b"]["status"] == "queued"
        assert g["asked"]["a"]["expert"] == "Sabine" and g["asked"]["b"]["expert"] == "Klaus"
    # only one side, one difference
    one = c.post(f"/api/workflows/{PACK.id}/compare/ask",
                 json={**body, "keys": ["nope"], "sides": ["a"]}).json()
    assert one["queued"] == []
    # a live-taught expert's queue is separate from a simulated one with the same name
    assert store.peer_questions_for(PACK.id, "Klaus", simulated=False) == []


class StubCompiler:
    async def __call__(self, pack, wm, inquiry, transcript, case):
        self.last = inquiry
        return Compiled(answers_question=True, key_quote=transcript, strength="always", rules=[CompiledRule(
            title="Equipment over 4,000 is capex", when="inv.category == 'equipment' and inv.net_eur > params.T_capex",
            field="cost_center", value="0400", quote=transcript)],
            threshold=None)


def test_debrief_asks_the_queued_question_first_and_the_answer_gets_a_receipt(client):
    c, store = client
    body = {"a": "Sabine", "b": "Klaus", "simulated": True}
    c.post(f"/api/workflows/{PACK.id}/compare/ask", json={**body, "sides": ["a"]})
    mine = store.peer_questions_for(PACK.id, "Sabine")
    assert mine and all(q["expert"] == "Sabine" for q in mine)

    async def run():
        comp = StubCompiler()
        s = Session("deb", PACK, mode="capture", expert="Sabine", use_llm=False, compiler=comp, store=store)
        await s.start_debrief()
        peers = [q for q in s.planner.debrief_agenda() if q.peer]
        assert len(peers) == len(mine)
        assert s.planner.debrief_agenda()[0].peer, "a difference between two experts outranks the generic probes"
        text = await s.debrief_next()
        asked = s.awaiting
        assert asked.peer and text == asked.text and asked.text in {q["text"] for q in mine}
        assert store.peer_question(asked.peer["id"])["status"] == "asked"
        await s.on_utterance("Equipment above four thousand five hundred is capex; below that it is running cost.")
        await s.wait_learning()
        await s.drain()
        row = store.peer_question(asked.peer["id"])
        assert row["status"] == "answered" and row["receipt_id"] and row["session_id"] == "deb"
        assert "four thousand five hundred" in row["answer"]["quote"]
        receipt = next(r for r in s.receipts if r["id"] == row["receipt_id"])
        assert receipt["peer"]["other_expert"] == "Klaus"
        assert comp.last["text"] == asked.text and comp.last["type"] == "cue_probe"
        # the answered question is not asked again, and the next debrief does not re-queue it
        s2 = Session("deb2", PACK, mode="capture", expert="Sabine", use_llm=False, store=store)
        await s2.start_debrief()
        assert asked.peer["id"] not in {q.peer["id"] for q in s2.planner.queue if q.peer}
        # Klaus (the other expert) has nothing queued, and a live Sabine never picks up a simulated expert's questions
        s3 = Session("deb3", PACK, mode="capture", expert="Klaus", use_llm=False, store=store)
        s3.simulated = True
        await s3.start_debrief()
        assert not [q for q in s3.planner.queue if q.peer]

    asyncio.run(run())

    out = c.get(f"/api/workflows/{PACK.id}/compare", params=body | {"simulated": True}).json()
    answered = [r for r in out["earlier"] if r["status"] == "answered"] + [
        g["asked"]["a"] for g in out["disagree"] if g["asked"]["a"] and g["asked"]["a"]["status"] == "answered"]
    assert answered and answered[0]["answer"]["quote"]


def test_peer_questions_for_a_simulated_expert_wait_for_a_simulated_session(client):
    c, store = client
    c.post(f"/api/workflows/{PACK.id}/compare/ask", json={"a": "Sabine", "b": "Klaus", "simulated": True, "sides": ["b"]})
    assert store.peer_questions_for(PACK.id, "Klaus", simulated=True)

    async def run():
        live = Session("l", PACK, mode="capture", expert="Klaus", use_llm=False, store=store)
        await live.start_debrief()
        assert not [q for q in live.planner.queue if q.peer]
        reh = Session("r", PACK, mode="capture", expert="Klaus", use_llm=False, store=store)
        reh.simulated = True
        await reh.start_debrief()
        assert [q for q in reh.planner.queue if q.peer]

    asyncio.run(run())


def test_peer_question_wording_is_neutral_and_generic():
    pack = get_pack("ap_invoices")
    conflict = {"a_expert": "Sabine", "b_expert": "Klaus", "field": "cost_center", "field_label": "Cost center",
                "a_value": "4711", "b_value": "0400", "case_ref": "invoice 4471", "case": "inv-4471"}
    qa, qb = compare.peer_question(pack, conflict, "a"), compare.peer_question(pack, conflict, "b")
    assert qa.startswith("On invoice 4471") and "Klaus would code it to 0400" in qa and qa.endswith("What tells you to code it to 4711?")
    assert "Sabine would code it to 4711" in qb
    assert "wrong" not in qa and "should" not in qa
    unset = {**conflict, "field": "action", "field_label": "Action", "a_value": None, "b_value": "hold"}
    assert "carry on as normal" in compare.peer_question(pack, unset, "a")
