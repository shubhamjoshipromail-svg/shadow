#!/usr/bin/env python3
"""Seed a SIMULATED second expert so the "Two experts, one task" page has something to show locally.

    cd backend && .venv/bin/python scripts/seed_second_expert.py [--expert Klaus] [--db sqlite:///...]

This is Rehearsal, not learning. A simulated expert (the oracle-driven stand-in the tests use) is taught the AP invoice
workflow end to end; then Klaus's two personal habits are written onto his map by hand:

    capex line      4,000 EUR net      (the oracle's Sabine uses 5,000)
    guardrail       no "asset number" hard limit; instead anything over 25,000 EUR net goes to the controller first

His session and map are stored with `simulated: true`, so they never feed "latest map", the tutor, the MCP tools or
any live proof; only the comparison page, when asked to include simulated experts, shows them, labelled. If the
database has no map for "Sabine" at all, a simulated Sabine (the unmodified oracle) is seeded the same way.
Live sessions remain the honest path: teach the same workflow as two real people and compare those.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shadow import config, sim  # noqa: E402
from shadow.engine import Session  # noqa: E402
from shadow.packs import get_pack  # noqa: E402
from shadow.store import Store  # noqa: E402
from shadow.workmap import Evidence, Guardrail, Quote, ScreenMoment, WorkMap  # noqa: E402

PACK_ID = "ap_invoices"


async def rehearse(expert: str) -> Session:
    """One full simulated session: capture the demo invoices, answer what is asked, then the debrief."""
    pack = get_pack(PACK_ID)
    s = Session(f"seed-{uuid.uuid4().hex[:6]}", pack, mode="capture", expert=expert, use_llm=False,
                proposer=sim.fake_propose, compiler=sim.FakeCompiler())
    s.simulated = True
    for cid in s.case_order:
        await s.open_case(cid)
        booking, action = sim.oracle_booking(s.cases[cid])
        await s.on_decision(cid, booking, action)
        await s.drain()
        q = await s.tick()
        if q:
            await s.on_utterance(sim.sim_answer(s, q))
            await s.drain()
    await s.start_debrief()
    for _ in range(60):
        await s.debrief_next()
        if s.awaiting is None:
            break
        await s.on_utterance(sim.sim_answer(s, s.awaiting))
        await s.drain()
    return s


def klaus_habits(wm: WorkMap) -> list[str]:
    """Write Klaus's two personal habits onto the map. Returns what changed, for the printout."""
    changed = []
    if wm.params.get("T_capex") is not None:
        wm.params["T_capex"] = 4000.0
        changed.append("T_capex 5,000 -> 4,000")
        for r in wm.rules:
            if "params.T_capex" in r.when and r.origin != "doc":
                r.title = r.title.replace("5,000", "4,000")
            if "params.T_capex" in r.when and r.origin != "doc" and r.quote:
                r.quote = Quote(text="Equipment over four thousand I book as capex. That's where I draw it.",
                                speaker="Klaus", ts=r.quote.ts, lang="en")
    gone = [g for g in wm.guardrails if "asset number" in g.title.lower() and g.origin != "doc"]
    for g in gone:
        wm.guardrails.remove(g)
        for step in wm.steps:
            if g.id in step.guardrail_ids:
                step.guardrail_ids.remove(g.id)
        changed.append(f"removed guardrail '{g.title}'")
    step = wm.step_for_field("action")
    g = Guardrail(id=wm.next_id("G"), step_id=step.id if step else None, type="stop_and_ask", action="escalate",
                  title="Anything over 25,000 EUR net goes to the controller first",
                  when="inv.net_eur > 25000", ask="Controller T. Brandt",
                  quote=Quote(text="Above twenty-five thousand I don't decide alone. The controller sees it first.",
                              speaker="Klaus", ts=None, lang="en"),
                  screen_moment=ScreenMoment(ts=None, entity=None, field="action"))
    g.evidence.append(Evidence(episode_id="seed", kind="origin", agrees=True))
    g.refresh_belief()
    wm.guardrails.append(g)
    if step:
        step.guardrail_ids.append(g.id)
    changed.append(f"added guardrail '{g.title}'")
    return changed


def save_simulated(store: Store, s: Session, note: str) -> str:
    """Store the map under a session flagged simulated, so every live-only path keeps ignoring it."""
    sid = s.id
    store.create_session(sid, "capture", PACK_ID, s.expert,
                         {"simulated": True, "workflow": PACK_ID, "source": "rehearsal", "workspace": config.DEFAULT_WORKSPACE,
                          "note": note, "seeded_by": "scripts/seed_second_expert.py"})
    store.save_map(s.expert, PACK_ID, sid, s.wm.version, s.wm.model_dump())
    return sid


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expert", default="Klaus")
    ap.add_argument("--first", default="Sabine", help="seeded (simulated) only if nobody by this name has a map yet")
    ap.add_argument("--db", default=None, help="database URL (default: the backend's)")
    args = ap.parse_args()
    store = Store(args.db or config.DATABASE_URL)
    known = {m["expert"] for m in store.expert_maps(PACK_ID, include_simulated=True)}

    if args.first not in known:
        s = await rehearse(args.first)
        sid = save_simulated(store, s, "unmodified oracle expert")
        print(f"seeded simulated {args.first}: session {sid}, map v{s.wm.version}, T_capex {s.wm.params.get('T_capex')}")
    s = await rehearse(args.expert)
    changes = klaus_habits(s.wm)
    sid = save_simulated(store, s, "; ".join(changes))
    print(f"seeded simulated {args.expert}: session {sid}, map v{s.wm.version}")
    for c in changes:
        print("  -", c)
    print("Both are labelled simulated (Rehearsal). Open /app/w/ap_invoices/compare and tick 'include rehearsal experts'.")


if __name__ == "__main__":
    asyncio.run(main())
