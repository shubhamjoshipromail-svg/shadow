import asyncio

from shadow.engine import Session
from shadow.packs import get_pack
from shadow.workmap import TRUSTED, run_map
from shadow.sim import FakeCompiler, fake_propose, oracle_booking

PACK = get_pack("ap_invoices")


async def _capture(session: Session) -> list:
    asked = []
    for cid in session.case_order:
        await session.open_case(cid)
        booking, action = oracle_booking(session.cases[cid])
        await session.on_decision(cid, booking, action)
        await session.drain()
        # at the natural pause, Shadow may ask (possibly more than once across cases)
        q = await session.tick()
        if q:
            asked.append(q)
            await session.on_utterance("spoken answer")
            await session.drain()
    return asked


def test_full_loop_capture_debrief_tutor():
    async def run():
        comp = FakeCompiler()
        s = Session("t1", PACK, mode="capture", use_llm=False, proposer=fake_propose, compiler=comp)
        asked = await _capture(s)
        m = s.metrics()
        assert m["episodes"] == 4
        assert m["gaps"] >= 4  # capex, double-billing hold, intercompany, skonto...
        assert len(asked) >= 3, [q.type for q in asked]
        assert all(q.phase == "live" for q in asked)
        learned = [n for n in [*s.wm.rules, *s.wm.guardrails] if n.origin != "doc"]
        assert learned, "Shadow should have learned rules from live answers"
        # every learned node links to the expert's words and a screen moment
        for n in learned:
            if n.quote:
                assert n.screen_moment is not None
        assert s.silence_log, "some decisions must be explained without asking"

        # ---- debrief: close gaps, self-exam, teach-back
        await s.start_debrief()
        for _ in range(40):
            await s.debrief_next()
            if s.awaiting is None:
                break
            await s.on_utterance("yes" if s.awaiting.type == "teachback" else "spoken answer")
            await s.drain()
        u = s.understood()
        debrief_qs = [q for q in s.planner.history if q.phase == "debrief" and q.type not in ("exam", "teachback")]
        assert len(debrief_qs) >= 3
        assert u["teachback_confirmed"]["passed"]
        assert u["guardrails"]["passed"]
        assert u["exam"]["passed"], u["exam"]
        assert u["done"], u
        # evaluation answers are never learned from
        assert all(e.weight == 0.0 for e in s.episodes if e.evaluation)

        # learned map must predict the oracle on cases it never saw
        unseen = PACK.generate_cases(40, seed=99)
        from shadow.packs.ap_invoices.oracle import decide as oracle_decide
        correct = total = 0
        for c in unseen:
            pred = run_map(s.wm, PACK, c)
            truth = oracle_decide(c)
            if "cost_center" in pred.fields:
                total += 1
                correct += pred.fields["cost_center"].value == truth.fields["cost_center"]
        # capture alone gets ~80% (IT hardware never seen, intercompany-vs-capex conflict);
        # the debrief's coverage + conflict probes must close those gaps
        assert correct / total >= 0.95, f"{correct}/{total}"

        # ---- tutor: unseen case, trainee reaches for opex and posts
        t = Session("t2", PACK, mode="tutor", wm=s.wm, use_llm=False, trainee="Lena")
        await t.open_case("inv-5120")
        verdict = await t.before_save("inv-5120", {"cost_center": "4711"}, "post")
        assert verdict["allow"] is False
        assert "would stop here" in verdict["intervention"]["say"]
        assert verdict["intervention"]["violation"]["quote"] is not None
        ok = await t.before_save("inv-5120", {"cost_center": "0400"}, "hold")
        assert ok["allow"] is True
        assert t.tutor_report()["rules"]

    asyncio.run(run())


def test_parametric_gap_is_silent():
    """Once the capex rule exists, an invoice just above/below a moved threshold doesn't trigger a question."""
    async def run():
        s = Session("t3", PACK, mode="capture", use_llm=False, proposer=fake_propose, compiler=FakeCompiler())
        await _capture(s)
        n_before = len([q for q in s.planner.history if q.status in ("asked", "answered")])
        # a fresh equipment invoice at 6,000 net: map should already predict capex => silent
        case = PACK.generate_cases(60, seed=5)
        eq = next(c for c in case if PACK.derive(c)["inv"]["category"] == "equipment"
                  and PACK.derive(c)["inv"]["net_eur"] > 5600 and PACK.derive(c)["inv"]["asset_number_available"])
        s.cases[eq["id"]] = eq
        await s.open_case(eq["id"])
        booking, action = oracle_booking(eq)
        await s.on_decision(eq["id"], booking, action)
        await s.drain()
        ep = s.episodes[-1]
        assert not [g for g in ep.gaps if g["field"] == "cost_center"]
        q = await s.tick()
        assert q is None or q.case_id != eq["id"] or q.field != "cost_center"
        assert len([q for q in s.planner.history if q.status in ("asked", "answered")]) <= n_before + 1

    asyncio.run(run())


def test_tutor_coaches_before_and_escalates_hints():
    async def run():
        s = Session("cap", PACK, mode="capture", use_llm=False, proposer=fake_propose, compiler=FakeCompiler())
        await _capture(s)
        t = Session("tut", PACK, mode="tutor", use_llm=False, wm=s.wm, trainee="Lena")
        seen = []
        t.listeners.add(lambda m: _collect(seen, m))
        await t.open_case("inv-5120")
        brief = next(m for m in seen if m["type"] == "tutor_case")
        assert "Before you book this one" in brief["prompt"] and "cost center" in brief["prompt"]
        assert "5,000" not in brief["prompt"], "first exposure must not give the rule away"
        v1 = await t.before_save("inv-5120", {"cost_center": "4711"}, "post")
        v2 = await t.before_save("inv-5120", {"cost_center": "4711"}, "post")
        v3 = await t.before_save("inv-5120", {"cost_center": "4711"}, "post")
        levels = [v["intervention"]["hint"]["level"] for v in (v1, v2, v3)]
        assert levels == sorted(levels) and levels[0] < levels[-1], levels
        assert v1["intervention"]["hint"]["quote"] is None and v3["intervention"]["hint"]["quote"] is not None
        assert "next_case" in t.tutor_report()

    asyncio.run(run())


async def _collect(out, m):
    out.append(m)
