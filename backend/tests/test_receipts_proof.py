"""Learning receipts and sealed boundary tests.

The threshold scenario uses no oracle: a scripted evaluator picks a threshold Sabine's oracle doesn't
know (3,600 EUR, not 5,000), the expert *says* 3,000 (a misremembered number), and only the
evaluator's labels on sealed, unseen cases can correct it.
"""

import asyncio
import hashlib

from fastapi.testclient import TestClient

from shadow import main, proof as proof_mod
from shadow.compiler import Compiled, CompiledRule, ThresholdStatement
from shadow.engine import Session
from shadow.packs import get_pack
from shadow.store import Store
from shadow.workmap import WorkMap, run_map

PACK = get_pack("ap_invoices")
TRUE_T = 3600.0  # the evaluator's choice, made after the build
STATED_T = 3000.0  # what the expert says out loud


class SpokenCompiler:
    """Stands in for the LLM parse of one sentence: 'Equipment over three thousand net is capex.'"""
    provenance = "test stub (no oracle)"

    async def __call__(self, pack, wm, inquiry, transcript, case) -> Compiled:
        if inquiry.get("field") == "cost_center" and inquiry["type"] not in ("counterfactual", "exam"):
            return Compiled(answers_question=True, key_quote=transcript, strength="always",
                            rules=[CompiledRule(title="Equipment over 3,000 EUR net is capex",
                                                when="inv.category == 'equipment' and inv.net_eur > params.T_capex",
                                                field="cost_center", value="0400", quote=transcript)],
                            threshold=ThresholdStatement(param="T_capex", value=STATED_T, quantity="inv.net_eur"))
        return Compiled(answers_question=False, key_quote=transcript)


async def no_proposals(*_args, **_kw):
    return []


def evaluator_label(case) -> str:
    inv = PACK.derive(case)["inv"]
    if inv["category"] == "equipment" and inv["net_eur"] > TRUE_T:
        return "0400"
    return {"consumables": "4720"}.get(inv["category"], "4711")


def booking_for(case):
    return {"cost_center": evaluator_label(case), "tax_code": "V19"}


async def teach(s: Session) -> None:
    await s.open_case("inv-4471")  # €6,400 equipment: capex under the evaluator's threshold too
    await s.on_decision("inv-4471", booking_for(s.cases["inv-4471"]), "post")
    await s.drain()
    q = await s.tick(force=True)
    assert q is not None and q.field == "cost_center", q
    await s.on_utterance("Equipment over three thousand net is always capex.")
    await s.drain()


def new_session(sid="rp") -> Session:
    return Session(sid, PACK, mode="capture", use_llm=False, proposer=no_proposals, compiler=SpokenCompiler())


def test_receipt_records_before_after_diff_and_independent_test():
    async def run():
        s = new_session()
        await teach(s)
        rc = next(r for r in s.receipts if r["trigger"] == "answer" and r["field"] == "cost_center")
        assert rc["status"] == "learned"
        assert rc["before"]["value"] == "4711" and rc["before"]["committed"] == "4711"
        assert rc["after"]["value"] == "0400" and rc["after"]["explains_expert"]
        assert rc["teaching"]["quote"].startswith("Equipment over three thousand")
        assert any("T_capex" in n.get("params", {}) for n in rc["diff"]["added"])
        assert rc["diff"]["version"]["after"] == rc["diff"]["version"]["before"] + 1
        assert rc["provenance"]["compiler"] == "test stub (no oracle)"
        assert not rc["independent"], "re-predicting the taught case is not a test"

        # a later case the expert never explained, predicted with the new rule already in the map
        case = PACK.threshold_variant(s.cases["inv-4471"], "amount", "net", 4800)
        case.update(id="inv-9001")
        s.cases[case["id"]] = case
        await s.open_case("inv-9001")
        await s.on_decision("inv-9001", booking_for(case), "post")
        await s.drain()
        checks = rc["independent"]
        assert checks and checks[0]["case_id"] == "inv-9001" and checks[0]["agrees"]
        assert s.snapshot()["receipts"][0]["summary"]["verdict"] in ("held", "untested")

    asyncio.run(run())


def test_evaluator_threshold_sealed_test_and_counterexample_correction():
    async def run():
        s = new_session()
        await teach(s)
        assert abs(s.wm.params["T_capex"] - STATED_T) < 1

        p1 = proof_mod.build(s, "T_capex", seed=7)
        assert p1["commitment"] == hashlib.sha256(proof_mod.sealed_body(p1).encode()).hexdigest()
        sealed = proof_mod.view(p1)
        assert all(i["sealed"] and "predicted" not in i for i in sealed["items"])
        buckets = {i["bucket"] for i in p1["items"]}
        assert {"below", "above", "straddle", "control"} <= buckets
        frozen = {i["case_id"]: i["predicted"] for i in p1["items"]}

        for item in p1["items"]:
            await s.on_label(item["case_id"], {"cost_center": evaluator_label(s.cases[item["case_id"]])})
            await s.drain()
        sm = proof_mod.summary(p1)
        assert sm["complete"] and sm["labeled"] == sm["n"]
        # predictions were scored as frozen, even though the map changed while labels came in
        assert all(i["predicted"] == frozen[i["case_id"]] for i in p1["items"])
        # every miss is exactly the band between what was said and what the evaluator meant
        for miss in sm["failures"]:
            assert STATED_T < miss["quantities"]["net"] <= TRUE_T, miss
        assert proof_mod.view(p1)["sealed_body"]

        # counterexamples move the threshold toward the evaluator's (behavior disposes)
        if sm["failures"]:
            assert s.wm.params["T_capex"] > max(f["quantities"]["net"] for f in sm["failures"]) - 50
            assert any(r["trigger"] == "decision" for r in s.receipts), "the correction gets its own receipt"

        # fresh cases, new commitment: the correction holds on cases nobody has seen
        for seed in (8, 9):
            p = proof_mod.build(s, "T_capex", seed=seed)
            for item in p["items"]:
                await s.on_label(item["case_id"], {"cost_center": evaluator_label(s.cases[item["case_id"]])})
                await s.drain()
        last = proof_mod.summary(p)
        assert last["accuracy"] >= sm["accuracy"]
        assert abs(s.wm.params["T_capex"] - TRUE_T) < 300, s.wm.params

    asyncio.run(run())


def test_restarted_session_uses_saved_map(tmp_path):
    async def run():
        store = Store(f"sqlite:///{tmp_path}/shadow.db")
        s = Session("orig", PACK, mode="capture", use_llm=False, proposer=no_proposals, compiler=SpokenCompiler(),
                    store=store)
        await teach(s)
        row = store.latest_map_row(s.expert, PACK.id)
        assert row and row["session_id"] == "orig" and row["version"] == s.wm.version
        s2 = Session("restarted", PACK, mode="capture", use_llm=False, wm=WorkMap(**row["map"]))
        assert s2.wm.params == s.wm.params and s2.param_quantity == s.param_quantity
        for c in PACK.generate_cases(30, seed=3):
            assert run_map(s2.wm, PACK, c).fields["cost_center"].value == run_map(s.wm, PACK, c).fields["cost_center"].value
        p = proof_mod.build(s2, None, seed=1)
        assert p["param"] == "T_capex" and p["map_version"] == s.wm.version

    asyncio.run(run())


def test_rehearsal_maps_are_never_continued_from(tmp_path):
    async def run():
        store = Store(f"sqlite:///{tmp_path}/shadow.db")
        live = Session("live", PACK, mode="capture", use_llm=False, proposer=no_proposals, compiler=SpokenCompiler(),
                       store=store)
        await teach(live)
        store.create_session("reh", "capture", PACK.id, live.expert, {"simulated": True})
        reh = Session("reh", PACK, mode="capture", use_llm=False, store=store)
        reh.simulated = True
        reh._save_map()
        store.save_map(live.expert, PACK.id, "reh", 99, reh.wm.model_dump())  # a stale row from before the guard
        row = store.latest_map_row(live.expert, PACK.id)
        assert row["session_id"] == "live"

    asyncio.run(run())


def test_live_session_refuses_simulated_steps_and_rehearsal_refuses_proofs():
    live = Session("live1", PACK, mode="capture", use_llm=False, proposer=no_proposals, compiler=SpokenCompiler())
    rehearsal = Session("reh1", PACK, mode="capture", use_llm=False)
    rehearsal.simulated = True
    main.sessions.update({"live1": live, "reh1": rehearsal})
    try:
        client = TestClient(main.app)
        assert client.post("/api/sessions/live1/sim/step").status_code == 409
        assert client.post("/api/sessions/reh1/proofs", json={}).status_code == 409
        r = client.post("/api/sessions/live1/proofs", json={})  # nothing learned yet: discovery spread
        assert r.status_code == 200 and r.json()["mode"] == "discovery"
        item = r.json()["items"][0]
        assert item["sealed"]
        r = client.post(f"/api/sessions/live1/proofs/{r.json()['id']}/label",
                        json={"case_id": item["case_id"], "value": "4711"})
        labeled = next(i for i in r.json()["items"] if i["case_id"] == item["case_id"])
        assert not labeled["sealed"] and labeled["label"] == "4711" and labeled["predicted"] is not None
    finally:
        main.sessions.pop("live1", None)
        main.sessions.pop("reh1", None)


def test_ledger_rows_are_typed_and_tagged(tmp_path):
    async def run():
        store = Store(f"sqlite:///{tmp_path}/shadow.db")
        s = Session("led", PACK, mode="capture", use_llm=False, proposer=no_proposals, compiler=SpokenCompiler(),
                    store=store)
        s.workspace = "nordwerk"
        await teach(s)
        d = store.ledger_rows("decisions", "led")
        assert d and d[0]["case_id"] == "inv-4471" and d[0]["source"] == "live" and d[0]["workspace"] == "nordwerk"
        assert d[0]["prospective"] and "cost_center" in d[0]["surprises"]
        assert d[0]["predicted"]["cost_center"] == "4711" and d[0]["actual"]["cost_center"] == "0400"
        e = store.ledger_rows("explanations", "led")
        assert e and e[0]["status"] == "learned" and e[0]["quote"].startswith("Equipment over")
        assert e[0]["map_version_after"] == e[0]["map_version_before"] + 1
        t = Session("tut", PACK, mode="tutor", use_llm=False, wm=s.wm, store=store, trainee="Lena")
        await t.open_case("inv-5120")
        await t.before_save("inv-5120", {"cost_center": "4711"}, "post")
        a = store.ledger_rows("learner_attempts", "tut")
        assert a and a[0]["learner"] == "Lena" and a[0]["independent"] and not a[0]["allowed"]
        counts = store.ledger_counts()
        assert counts["decisions"]["live"] >= 1 and counts["learner_attempts"]["live"] == 1

    asyncio.run(run())


def test_end_session_and_inventory():
    s = Session("end1", PACK, mode="capture", use_llm=False, proposer=no_proposals, compiler=SpokenCompiler())
    main.sessions["end1"] = s
    main.latest.append("end1")
    try:
        client = TestClient(main.app)
        assert client.post("/api/sessions/end1/end").json() == {"ended": True}
        assert s.ended and "end1" not in main.latest
        inv = client.get("/api/data/inventory?session=end1").json()
        assert {"database", "counts", "samples", "locations", "never", "redaction"} <= set(inv)
        cfg = client.get("/api/config").json()
        assert "erp_url" in cfg and "console_url" in cfg
    finally:
        main.sessions.pop("end1", None)


def test_show_me_path_and_mastery_persist(tmp_path):
    async def run():
        store = Store(f"sqlite:///{tmp_path}/shadow.db")
        s = new_session("sm")
        await s.open_case("inv-4471")
        await s.on_event({"type": "panel_opened", "panel": "po"})
        await s.on_event({"type": "field_changed", "case_id": "inv-4471", "field": "cost_center", "after": "0400"})
        await s.on_decision("inv-4471", booking_for(s.cases["inv-4471"]), "post")
        await s.drain()
        await s.tick(force=True)
        await s.on_utterance("Equipment over three thousand net is always capex.")
        await s.drain()
        rule = next(r for r in s.wm.rules if r.origin != "doc")
        assert [p["name"] for p in rule.screen_moment.path] == ["po", "cost_center"]
        t = Session("tu1", PACK, mode="tutor", use_llm=False, wm=s.wm, store=store, trainee="Lena")
        await t.open_case("inv-5120")
        v = await t.before_save("inv-5120", {"cost_center": "4711"}, "post")
        assert [p["name"] for p in v["intervention"]["show_me"]] == ["po", "cost_center"]
        saved = store.load_mastery(t.workspace, PACK.id, "Lena")
        assert rule.id in saved and saved[rule.id]["opportunities"] == 1

    asyncio.run(run())


def test_path_constraints_learned_from_expert_and_nudged_in_tutor():
    from shadow import paths
    eps = [({"action": "hold"}, [{"kind": "panel", "name": "history"}, {"kind": "field", "name": "cost_center"}]),
           ({"action": "hold"}, [{"kind": "panel", "name": "po"}, {"kind": "panel", "name": "history"}]),
           ({"action": "post"}, [{"kind": "panel", "name": "po"}])]
    cons = paths.mine(eps)
    assert [(c["value"], c["name"]) for c in cons] == [("hold", "history")], "only what she ALWAYS did, with support ≥ 2"
    assert paths.missing(cons, {"action": "hold"}, [{"kind": "panel", "name": "po"}])
    assert not paths.missing(cons, {"action": "post"}, [])

    async def run():
        s = new_session("pc")
        for cid in ("inv-4471", "inv-4473"):
            await s.open_case(cid)
            await s.on_event({"type": "panel_opened", "panel": "po"})
            await s.on_decision(cid, booking_for(s.cases[cid]), "post")
        assert any(c["name"] == "po" and c["value"] == "post" for c in s.wm.paths)
        t = Session("pt", PACK, mode="tutor", use_llm=False, wm=s.wm, trainee="Lena")
        got = []
        t.listeners.add(lambda m: _append(got, m))
        await t.open_case("inv-5122")
        await t.before_save("inv-5122", {"cost_center": "4711"}, "post")
        assert any(m["type"] == "nudge" and "po" in m["look"] for m in got)

    asyncio.run(run())


async def _append(out, m):
    out.append(m)


class SlipCompiler(SpokenCompiler):
    async def __call__(self, pack, wm, inquiry, transcript, case):
        if inquiry["type"] == "deviation":
            return Compiled(answers_question=True, key_quote=transcript)  # "that was a slip": no new rule
        return await super().__call__(pack, wm, inquiry, transcript, case)


def test_contradicting_a_confirmed_rule_asks_exception_change_or_slip():
    async def run():
        s = Session("dv", PACK, mode="capture", use_llm=False, proposer=no_proposals, compiler=SlipCompiler())
        await teach(s)
        base = s.cases["inv-4471"]
        for i, net in enumerate((5200, 6100), start=1):  # behaviour agrees twice: the rule becomes confirmed
            c = PACK.threshold_variant(base, "amount", "net", net)
            c.update(id=f"inv-80{i}")
            s.cases[c["id"]] = c
            await s.open_case(c["id"])
            await s.on_decision(c["id"], {"cost_center": "0400", "tax_code": "V19"}, "post")
        rule = next(r for r in s.wm.rules if r.origin != "doc")
        assert rule.belief.status == "confirmed", rule.belief
        c = PACK.threshold_variant(base, "amount", "net", 5800)
        c.update(id="inv-899")
        s.cases["inv-899"] = c
        await s.open_case("inv-899")
        await s.on_decision("inv-899", {"cost_center": "4711", "tax_code": "V19"}, "post")
        await s.drain()
        q = next(q for q in s.planner.queue if q.case_id == "inv-899")
        assert q.type == "deviation" and q.target_node == rule.id
        assert "wrong" not in q.text.lower() and "mistake" not in q.text.lower()
        s.awaiting = s.planner.mark_asked(q)
        await s.on_utterance("Oh, that was just a slip, it should be capex.")
        await s.drain()
        assert rule.belief.status == "confirmed", "a slip must not erode the rule"

    asyncio.run(run())
