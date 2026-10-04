"""Certify an agent: sealed exam, human labels only, per-rule permission slips. Offline: the agent is a stub."""

import asyncio
import hashlib
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from shadow import certify, main, mcp_server, proof as proof_mod
from shadow.certify import ACT, STOP, SUGGEST, AgentAnswer, FieldDecision

from .test_receipts_proof import PACK, evaluator_label, new_session, teach


def _stub(threshold: float):
    """An agent that read the map and decides cost_center with its own idea of the capex line."""
    async def decide(map_text: str, facts: dict) -> AgentAnswer:
        inv = facts["facts"]["inv"]
        if inv["category"] == "equipment" and inv["net_eur"] > threshold:
            cc, rid = "0400", "R1"
        else:
            cc, rid = {"consumables": "4720"}.get(inv["category"], "4711"), "D1"
        return AgentAnswer(decisions=[
            FieldDecision(field="cost_center", value=cc, mode="act", rule_id=rid, why="stub"),
            FieldDecision(field="action", value="post", mode="act", rule_id="D6", why="stub")])
    return decide


async def _label_all(s, cert):
    for it in cert["items"]:
        await s.on_label(it["case_id"], {"cost_center": evaluator_label(s.cases[it["case_id"]])})
        await s.drain()
    certify.refresh(cert, s)


def _row(cert, node_id):
    return next(r for r in cert["result"]["rows"] if r["node"] == node_id)


def test_agent_answers_are_committed_before_any_label_and_use_only_the_map_tools():
    async def run():
        s = new_session("c1")
        await teach(s)
        cert = await certify.start(s, decider=_stub(3600), seed=11, routine=6)
        assert cert["labels"]["source"] == "fresh_sealed_exam" and cert["labels"]["at_commit"] == 0
        assert not cert["labels"]["weaker"] and cert["provenance"] == "live"
        assert all(not it["labels"] for it in cert["items"])
        assert cert["commitment"] == hashlib.sha256(certify.sealed_body(cert).encode()).hexdigest()
        assert {"list_steps", "list_guardrails"} <= set(cert["agent"]["tool_calls"])
        assert "check_decision" in cert["agent"]["withheld"] and "run_map" in cert["agent"]["withheld"]
        assert not any(c.startswith("check_decision") for c in cert["agent"]["tool_calls"])
        assert {"routine"} <= {i["bucket"] for i in cert["items"]}
        # editing an answer after the fact breaks the commitment
        sealed = certify.sealed_body(cert)
        cert["items"][0]["agent"]["cost_center"]["value"] = "9100"
        assert hashlib.sha256(certify.sealed_body(cert).encode()).hexdigest() != cert["commitment"]
        assert sealed != certify.sealed_body(cert)
        # nothing scored yet: every rule is untested, so stop and ask
        assert all(r["level"] == STOP for r in cert["result"]["rows"] if r["tested"] == 0)

    asyncio.run(run())


def test_rehearsal_session_is_refused():
    async def run():
        s = new_session("c2")
        s.simulated = True
        try:
            await certify.start(s, decider=_stub(3600))
        except certify.CertError as e:
            assert "Rehearsal" in str(e)
        else:
            raise AssertionError("a Rehearsal session must be refused")

    asyncio.run(run())
    s = new_session("c2b")
    s.simulated = True
    main.sessions["c2b"] = s
    try:
        assert TestClient(main.app).post("/api/sessions/c2b/certify", json={}).status_code == 409
    finally:
        main.sessions.pop("c2b", None)


def test_permission_is_earned_per_rule_from_human_labels():
    async def run():
        s = new_session("c3")
        await teach(s)
        good = await certify.start(s, decider=_stub(3600), seed=5, routine=8)
        await _label_all(s, good)
        r1 = _row(good, "R1")
        assert r1["tested"] >= certify.MIN_CASES and r1["wrong"] == 0
        assert r1["level"] == ACT and "right" in r1["reason"]
        assert good["result"]["complete"] and good["result"]["totals"]["agent_accuracy"] == 1.0

        # an agent that trusts the expert's spoken number (3,000) misses in the band up to the evaluator's 3,600
        s2 = new_session("c3b")
        await teach(s2)
        off = await certify.start(s2, decider=_stub(3000), seed=5, routine=8)
        await _label_all(s2, off)
        r = _row(off, "R1")
        assert r["wrong"] >= 1 and r["level"] == SUGGEST
        assert "miss" in r["reason"] and "between" in r["reason"] or "near" in r["reason"]
        # untested rules never act alone, and the doc's tax-code / payment rules were never put on trial
        assert all(x["level"] == STOP for x in off["result"]["rows"] if x["tested"] == 0)

    asyncio.run(run())


def _hand_cert(guard_agent, labels, n=5):
    items = []
    for i in range(n):
        items.append({"case_id": f"k{i}", "proof": "P1", "bucket": "routine", "describe": "x", "quantities": {},
                      "q": None, "attributed": ["G1"], "mira": None,
                      "agent": {"action": {"value": guard_agent[i], "mode": "act", "rule_id": "G1", "why": ""}},
                      "labels": {"action": {"value": labels[i], "via": "label", "at": "0"}} if labels[i] else {}})
    return {"id": "Ch", "field": "cost_center", "min_cases": 5, "action_precedence": PACK.action_precedence,
            "items": items,
            "nodes": [{"id": "G1", "kind": "guardrail", "title": "Hold on bank change", "when": "True", "then": None,
                       "action": "hold", "type": "hold", "origin": "expert", "status": "stated",
                       "field": "action", "quote": None, "fp": {}}]}


def test_guardrail_floor_never_acts_alone_on_few_tests_or_any_miss():
    five = _hand_cert(["hold"] * 5, ["hold"] * 5)
    assert certify.evaluate(five)["rows"][0]["level"] == ACT
    few = _hand_cert(["hold"] * 4, ["hold"] * 4, n=4)
    few["min_cases"] = 5
    assert certify.evaluate(few)["rows"][0]["level"] == SUGGEST  # 4 clean tests are not enough
    miss = _hand_cert(["hold"] * 4 + ["post"], ["hold"] * 5)
    row = certify.evaluate(miss)["rows"][0]
    assert row["level"] == STOP and "less than 'hold'" in row["reason"]
    # no label at all, but the agent undercut the expert's own stated guardrail: still a violation
    unlabelled = _hand_cert(["post"] * 5, [None] * 5)
    assert certify.evaluate(unlabelled)["rows"][0]["level"] == STOP
    # an agent that declines (stop_and_ask) where the guardrail applies is not violating it
    declined = _hand_cert(["post"] * 5, [None] * 5)
    for it in declined["items"]:
        it["agent"]["action"]["mode"] = "stop_and_ask"
    assert certify.evaluate(declined)["rows"][0]["violations"] == 0


def test_a_changed_rule_makes_its_slip_stale_but_nudges_do_not():
    async def run():
        s = new_session("c4")
        await teach(s)
        cert = await certify.start(s, decider=_stub(3600), seed=5, routine=8)
        await _label_all(s, cert)
        wm = s.wm.model_copy(deep=True)
        fresh = certify.view(cert, wm)
        assert not fresh["stale_nodes"]
        # the map moves on: a different threshold for the same rule
        wm.params["T_capex"] = wm.params["T_capex"] * 1.5
        stale = certify.view(cert, wm)
        row = next(r for r in stale["result"]["rows"] if r["node"] == "R1")
        assert row["stale"] and row["effective"] == STOP and "re-certify" in row["effective_reason"]
        assert all(not r["stale"] for r in stale["result"]["rows"] if r["node"] not in stale["stale_nodes"])
        # a 1% wobble is the same rule
        wm.params["T_capex"] = s.wm.params["T_capex"] * 1.01
        assert "R1" not in certify.view(cert, wm)["stale_nodes"]
        # removing the rule outright also invalidates it
        gone = s.wm.model_copy(deep=True)
        gone.rules = [r for r in gone.rules if r.id != "R1"]
        assert "R1" in certify.view(cert, gone)["stale_nodes"]

    asyncio.run(run())


def test_existing_human_labels_are_reused_as_the_fast_path_and_say_so():
    async def run():
        s = new_session("c5")
        await teach(s)
        p = proof_mod.build(s, "T_capex", seed=3)
        for it in p["items"]:
            await s.on_label(it["case_id"], {"cost_center": evaluator_label(s.cases[it["case_id"]])})
            await s.drain()
        rounds = s.proof_round
        cert = await certify.start(s, decider=_stub(3600))
        assert s.proof_round == rounds, "no new sealed test is built when a human already labelled one"
        assert cert["labels"]["source"] == "reused_human_labels" and cert["labels"]["weaker"]
        assert cert["labels"]["proofs"] == [p["id"]] and cert["labels"]["at_commit"] == len(p["items"])
        assert "weaker" in cert["labels"]["note"]
        assert cert["result"]["complete"]
        forced = await certify.start(s, decider=_stub(3600), fresh=True, seed=4)
        assert forced["labels"]["source"] == "fresh_sealed_exam" and s.proof_round == rounds + 1

    asyncio.run(run())


def test_a_rule_cannot_act_alone_if_the_agent_broke_a_guardrail_on_its_cases():
    cert = _hand_cert(["post"] * 5, ["hold"] * 5)
    cert["nodes"].append({"id": "R9", "kind": "rule", "title": "Some rule", "when": "True", "then": {"cost_center": "4711"},
                          "action": None, "type": None, "origin": "expert", "status": "stated", "field": "cost_center",
                          "quote": None, "fp": {}})
    for it in cert["items"]:
        it["attributed"] = ["R9", "G1"]
        it["agent"]["cost_center"] = {"value": "4711", "mode": "act", "rule_id": "R9", "why": ""}
        it["labels"]["cost_center"] = {"value": "4711", "via": "label", "at": "0"}
    rows = {r["node"]: r for r in certify.evaluate(cert)["rows"]}
    assert rows["G1"]["level"] == STOP
    assert rows["R9"]["right"] == 5 and rows["R9"]["level"] == SUGGEST and "guardrail" in rows["R9"]["reason"]
    for it in cert["items"]:  # the agent complied with the guardrail: now the rule earns its slip
        it["agent"]["action"]["value"] = "hold"
    assert {r["node"]: r for r in certify.evaluate(cert)["rows"]}["R9"]["level"] == ACT


def test_get_permissions_tool_answers_act_suggest_stop_with_the_experts_words():
    async def run():
        s = new_session("c6")
        await teach(s)
        cert = await certify.start(s, decider=_stub(3600), seed=5, routine=8)
        await _label_all(s, cert)
        return s, cert

    s, cert = asyncio.run(run())
    app = FastAPI()
    app.include_router(mcp_server.make_router(lambda w=None: s.wm, lambda w=None: PACK, lambda w=None: cert),
                       prefix="/mcp")
    c = TestClient(app)

    def call(args):
        r = c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                 "params": {"name": "get_permissions", "arguments": args}})
        return r.json()["result"]["structuredContent"]

    tools = c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).json()["result"]["tools"]
    assert "get_permissions" in {t["name"] for t in tools}
    big = PACK.threshold_variant(s.cases["inv-4471"], "amount", "net", 9000)  # clearly capex
    out = call({"case_facts": big})
    assert out["certification"] == cert["id"] and out["agent"] == certify.AGENT_ID
    ids = [r["id"] for r in out["rules"]]
    assert "R1" in ids
    r1 = next(r for r in out["rules"] if r["id"] == "R1")
    assert r1["level"] == ACT and r1["quote"] and "three thousand" in r1["quote"]["text"]
    # a case decided by an untested rule has the weakest slip, and the answer is the minimum
    assert out["permission"] in (ACT, SUGGEST, STOP)
    assert certify.RANK[out["permission"]] == min(certify.RANK[r["level"]] for r in out["rules"])
    # an objection from the map (here: a wrong cost center) forces stop
    wrong = call({"case_facts": big, "proposed": {"cost_center": "4711"}, "action": "post"})
    assert wrong["permission"] == "stop" and wrong["objections"]
    # no certification: stop and ask
    app2 = FastAPI()
    app2.include_router(mcp_server.make_router(lambda w=None: s.wm, lambda w=None: PACK), prefix="/mcp")
    r = TestClient(app2).post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                            "params": {"name": "get_permissions", "arguments": {"case_facts": big}}})
    assert r.json()["result"]["structuredContent"]["permission"] == "stop"


def test_api_flow_persists_and_labels_through_the_endpoint(tmp_path, monkeypatch):
    from shadow.store import Store
    monkeypatch.setattr(main, "store", Store(f"sqlite:///{tmp_path}/c.db"))
    monkeypatch.setattr(main.llm, "available", lambda: True)

    async def fake(text, facts, pack):
        return await _stub(3600)(text, facts)
    monkeypatch.setattr(certify, "llm_decider", fake)
    s = new_session("c7")
    main.sessions["c7"] = s
    try:
        client = TestClient(main.app)
        asyncio.run(teach(s))
        r = client.post("/api/sessions/c7/certify", json={"seed": 5})
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        listed = client.get("/api/sessions/c7/certifications").json()
        assert listed and listed[0]["id"] == cid and listed[0]["labelled"] == 0
        item = r.json()["items"][0]
        # the endpoint label for the sealed field is a normal proof label (and teaches), once only
        lab = client.post(f"/api/certifications/{cid}/label",
                          json={"case_id": item["case_id"], "field": "cost_center", "value": "4711"})
        assert lab.status_code == 200
        got = client.get(f"/api/certifications/{cid}").json()
        assert got["result"]["totals"]["labelled"] == 1
        assert client.post(f"/api/certifications/{cid}/label",
                           json={"case_id": item["case_id"], "field": "cost_center", "value": "4711"}).status_code == 409
        assert client.post(f"/api/certifications/{cid}/label",
                           json={"case_id": item["case_id"], "field": "action", "value": "nonsense"}).status_code == 400
        assert main.store.certification(cid)["result"]["totals"]["labelled"] == 1  # persisted
        assert json.loads(json.dumps(got))["commitment"] == r.json()["commitment"]
    finally:
        main.sessions.pop("c7", None)
