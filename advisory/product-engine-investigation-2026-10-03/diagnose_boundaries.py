"""Read-only diagnostics; no live service writes, provider calls, or production DB.

Run with backend/.venv/bin/python -B <this file> from the repository root.
Only writes verification.json beside this script. This is not a learning benchmark.
"""
import asyncio
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from shadow.engine import Session
from shadow.packs import get_pack
from shadow.workmap import Rule, WorkMap, run_map
from shadow import dsl


async def main():
    pack = get_pack("ap_invoices")
    session = Session("isolated-readonly-audit", pack, use_llm=False, store=None)
    events = []

    async def receive(evt):
        events.append(evt["type"])

    session.listeners.add(receive)
    before = len(session.cases)
    await session.open_case("new-support-ticket-1")
    unknown_case = {"case_count_before": before, "case_count_after": len(session.cases),
                    "current_case": session.current_case, "prediction_count": len(session.dps)}
    await session.on_event({"type": "vision", "reading": {
        "app": "Unfamiliar support tool", "entity": "new-support-ticket-1",
        "summary": "Expert routes a critical ticket to engineering",
        "visible_fields": [{"name": "severity", "value": "critical"}],
        "changes": [{"type": "field_changed", "field": "owner", "after": "engineering"}],
        "user_activity": "typing"}})
    vision = {"events_emitted": events, "case_count_after": len(session.cases),
              "prediction_count": len(session.dps), "map_version": session.wm.version}
    case = copy.deepcopy(pack.demo_cases()["capture"][0])
    wm = WorkMap(pack_id=pack.id, task=pack.task, expert="Audit", **pack.seed_map())
    arbitrary = Rule(id="R_AUDIT", step_id="S3", title="Audit-only threshold 7300",
                     when="inv.category == 'equipment' and inv.net_eur > 7300",
                     then={"cost_center": "0400"})
    wm.rules.append(arbitrary)
    checks = []
    for amount in [7299, 7300, 7301, 9000]:
        c = copy.deepcopy(case)
        c["net"] = amount
        c["gross"] = round(amount * (1 + c["vat_rate"] / 100), 2)
        p = run_map(wm, pack, c)
        checks.append({"net": amount, "value": p.fields["cost_center"].value,
                       "source": p.fields["cost_center"].source})
    expression = "inv.customer_risk_tier == 'critical'"
    dsl.validate(expression)
    missing = {"expression": expression, "syntax_accepted": True,
               "context_contains_field": "customer_risk_tier" in pack.derive(case)["inv"],
               "evaluates_to": dsl.holds(expression, pack.derive(case))}
    files = ["backend/shadow/engine.py", "backend/shadow/main.py", "backend/shadow/compiler.py",
             "backend/shadow/workmap.py", "backend/shadow/packs/ap_invoices/__init__.py",
             "backend/shadow/static/capture.js", "console/src/pages/Home.tsx",
             "console/src/pages/MapPage.tsx", "console/src/components/WorkMapView.tsx"]
    result = {"utc": datetime.now(timezone.utc).isoformat(),
              "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "scope": "offline component diagnostics; no LLM, voice, browser capture, or live learning tested",
              "unknown_case": unknown_case, "vision_only": vision,
              "manually_inserted_rule_execution_NOT_learning": checks,
              "unsupported_feature": missing,
              "source_sha256": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in files}}
    out = Path(__file__).with_name("verification.json")
    out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: v for k, v in result.items() if k != "source_sha256"}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
