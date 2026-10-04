"""Cold start: demonstration -> TaskDefinition -> GenericPack -> Session gap.

The workflow is "support ticket escalation", invented here in the test and
nowhere in a pack or an oracle. Three demonstrations teach the pack; a fourth,
unseen demo is the acceptance probe: the engine predicts (from the written
nothing + learned nothing), the expert diverges, and the engine records a
structural gap it can ask about.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from shadow import onboard
from shadow.engine import Session
from shadow.onboard import OnboardProposal, _ProposalAction, _ProposalDecisionField, _ProposalFeature
from shadow.packs.generic import GenericPack
from shadow.taskdef import GENERIC_NAMESPACE

GOAL = "Escalate support tickets that breach their SLA and route every ticket to the right team."
OBSERVE_JS = Path(onboard.__file__).resolve().parent / "static" / "observe.js"


async def no_proposals(*_args, **_kwargs):
    return []


# ------------------------------------------------------------------- fixtures
def select(name: str, label: str, options: list[str], value: str) -> dict:
    return {"name": name, "label": label, "kind": "select", "value_kind": "cat",
            "options": list(options), "value": value}


def checkbox(name: str, label: str, value: bool) -> dict:
    return {"name": name, "label": label, "kind": "checkbox", "value_kind": "bool", "options": [], "value": value}


def number(name: str, label: str, value: float) -> dict:
    return {"name": name, "label": label, "kind": "number", "value_kind": "num", "options": [], "value": value}


def free_text(name: str, label: str, length: int) -> dict:
    return {"name": name, "label": label, "kind": "textarea", "value_kind": "text", "options": [],
            "value": None, "redacted": True}


def demo(case_id: str, *, sla: bool, tier: str, days: float, summary_len: int, priority: str, team: str,
         action: str) -> dict:
    """One recorded act of work: the page, the expert's edits, the final button."""
    return {
        "url": f"https://support.example.com/tickets/{case_id}",
        "title": "Support ticket escalation",
        "case_id": case_id,
        "fields": [
            select("priority", "Priority", ["Low", "Normal", "High", "Urgent"], "Normal"),
            select("customer_tier", "Customer tier", ["Standard", "Premium", "Enterprise"], tier),
            checkbox("sla_breached", "SLA breached", sla),
            number("open_days", "Open days", days),
            free_text("summary", "Summary", summary_len),
        ],
        "changes": [
            {"field": "priority", "label": "Priority", "kind": "select", "value_kind": "cat",
             "before": "Normal", "after": priority},
            {"field": "assigned_team", "label": "Assigned team", "kind": "select", "value_kind": "cat",
             "before": "Tier 1", "after": team},
        ],
        "action": {"name": action, "label": action},
    }


DEMO_1 = demo("T-1001", sla=True, tier="Enterprise", days=9.0, summary_len=140, priority="Urgent",
              team="Engineering", action="Escalate")
DEMO_2 = demo("T-1002", sla=False, tier="Standard", days=1.0, summary_len=20, priority="Low",
              team="Tier 1", action="Resolve")
DEMO_3 = demo("T-1003", sla=False, tier="Premium", days=3.0, summary_len=55, priority="Normal",
              team="Tier 2", action="Assign")
DEMOS = [DEMO_1, DEMO_2, DEMO_3]
PROBE = demo("T-1004", sla=True, tier="Premium", days=6.0, summary_len=90, priority="High",
             team="Engineering", action="Escalate")


def probe_session(task, probe: dict):
    """Build the pack, add the unseen demo, run predict -> divergence -> gap."""
    pack = GenericPack(task)
    session = Session(f"onb-{task.id}", pack, mode="capture", use_llm=False, proposer=no_proposals)
    case = onboard.demos_to_cases(task, [probe])[0]
    session.cases[case["id"]] = case
    if case["id"] not in session.case_order:
        session.case_order.append(case["id"])

    async def run():
        await session.open_case(case["id"])
        assert session.dps[case["id"]].prediction is not None  # the AI committed a guess first
        booking = {k: v for k, v in case["booking"].items() if v is not None}
        await session.on_decision(case["id"], booking, case["_action"])
        await session.drain()

    asyncio.run(run())
    return session, case


def structural_gap_fields(session: Session) -> set[str]:
    assert session.episodes, "no decision was recorded"
    gaps = session.episodes[-1].gaps
    return {g["field"] for g in gaps if g["type"] == "structural"}


# ---------------------------------------------------------------------- infer
def test_infer_without_llm_builds_support_ticket_task():
    task = onboard.infer_without_llm(GOAL, DEMOS)
    assert task.namespace == GENERIC_NAMESPACE
    assert task.case_noun == "ticket"
    feature_names = {f.name for f in task.features}
    assert {"priority", "customer_tier", "sla_breached", "open_days", "summary"} <= feature_names
    assert {d.name for d in task.decision_fields} == {"priority", "assigned_team"}
    assert {a.name for a in task.actions} == {"escalate", "resolve", "assign"}
    assert {a.label for a in task.actions} == {"Escalate", "Resolve", "Assign"}
    assert task.feature("sla_breached").type == "bool"
    assert task.feature("open_days").threshold_capable
    assert task.feature("priority").options == ["Low", "Normal", "High", "Urgent"]
    # the demos ride along, so a Session built on the pack replays them
    assert [c["id"] for c in task.demo["capture"]] == ["T-1001", "T-1002", "T-1003"]


def test_infer_single_demo_still_finds_a_decision_field():
    task = onboard.infer_without_llm(GOAL, [DEMO_1])
    assert {d.name for d in task.decision_fields} == {"priority", "assigned_team"}


def test_infer_definition_loads_in_generic_pack():
    task = onboard.infer_without_llm(GOAL, DEMOS)
    pack = GenericPack(task)
    assert pack.id == task.id and pack.namespace == "task"
    assert [d.name for d in pack.decision_fields] == [d.name for d in task.decision_fields]
    case = onboard.demos_to_cases(task, [DEMO_1])[0]
    assert case["facts"]["sla_breached"] is True
    assert case["booking"]["assigned_team"] == "Engineering"
    assert case["_action"] == "Escalate"
    assert pack.derive(case)["task"]["priority"] == "Normal"  # the snapshot, not the answer


def test_infer_session_runs_predict_gap_on_unseen_demo():
    task = onboard.infer_without_llm(GOAL, DEMOS)
    session, case = probe_session(task, PROBE)
    assert case["id"] == "T-1004"
    fields = structural_gap_fields(session)
    assert {"priority", "assigned_team", "action"} <= fields, fields
    # the gap produced a question the engine can ask at the next pause
    assert any(q.gap_id for q in [*session.planner.queue, *session.planner.history])
    assert session.metrics()["gaps"] >= 3


# ------------------------------------------------------------------ fake LLM
class FakeParse:
    """Stands in for `llm.parse`: returns one canned proposal, records the call."""

    def __init__(self, proposal):
        self.proposal = proposal
        self.calls = 0
        self.prompt = ""

    async def __call__(self, schema, system, content, **_kwargs):
        assert schema is OnboardProposal
        self.calls += 1
        self.prompt = content
        return self.proposal


def fake_proposal() -> OnboardProposal:
    return OnboardProposal(
        id="support_escalation",
        name="Support ticket escalation",
        task="escalate_ticket",
        goal=GOAL,
        case_noun="ticket",
        namespace="inv",  # hostile: must be forced back to the generic namespace
        decision_fields=[
            _ProposalDecisionField(name="assigned_team", label="Assigned team"),
            _ProposalDecisionField(name="priority", label="Priority"),
            _ProposalDecisionField(name="ghost_field", label="Ghost field"),  # never observed -> dropped
        ],
        actions=[_ProposalAction(name="Escalate"), _ProposalAction(name="Resolve"),
                 _ProposalAction(name="Assign")],  # severities omitted -> defaulted
        features=[
            _ProposalFeature(name="priority", label="Priority", type="cat"),
            _ProposalFeature(name="sla_breached", label="SLA breached", type="bool"),
            _ProposalFeature(name="open_days", label="Open days", type="num"),
            _ProposalFeature(name="nonexistent_widget", label="Nonexistent widget", type="cat"),  # dropped
        ],
        process_rules=[
            {"id": "D1", "title": "SLA breach escalates", "when": "task.sla_breached == True",
             "then": [{"field": "assigned_team", "value": "Engineering"}]},
            {"id": "D2", "title": "References a dropped fact", "when": "task.nonexistent_widget == 'x'",
             "then": [{"field": "ghost_field", "value": "x"}]},
        ],
    )


def test_propose_task_with_fake_llm_repairs_and_grounds():
    fake = FakeParse(fake_proposal())
    task = asyncio.run(onboard.propose_task(GOAL, DEMOS, parse_fn=fake, task_id="support_escalation"))
    assert fake.calls == 1
    assert "Support ticket escalation" in fake.prompt and "Demonstrations" in fake.prompt

    assert task.namespace == "task"  # never trust the model's namespace
    assert task.id == "support_escalation" and task.case_noun == "ticket"
    feature_names = {f.name for f in task.features}
    assert "nonexistent_widget" not in feature_names  # unknown field dropped
    assert {"priority", "sla_breached", "open_days"} <= feature_names
    # options merged from what was actually observed
    assert set(task.feature("priority").options) >= {"Low", "Normal", "High", "Urgent"}
    assert {d.name for d in task.decision_fields} == {"assigned_team", "priority"}  # ghost dropped
    team = next(d for d in task.decision_fields if d.name == "assigned_team")
    assert set(team.options) >= {"Engineering", "Tier 1", "Tier 2"}
    # unknown-target and unknown-fact rules dropped; the grounded one kept
    assert [r.id for r in task.process_rules] == ["D1"]
    assert task.process_rules[0].then == {"assigned_team": "Engineering"}
    # severities defaulted from the action words
    severity = {a.name: a.severity for a in task.actions}
    assert severity["escalate"] > severity["resolve"]
    labels = {a.label for a in task.actions}
    assert {"Escalate", "Resolve", "Assign"} <= labels
    assert task.model_dump(mode="json")  # JSON-safe for the custom-pack file


def test_propose_task_with_fake_llm_session_runs_predict_gap():
    fake = FakeParse(fake_proposal())
    task = asyncio.run(onboard.propose_task(GOAL, DEMOS, parse_fn=fake, task_id="support_escalation"))
    session, _case = probe_session(task, PROBE)
    fields = structural_gap_fields(session)
    assert "priority" in fields, fields


def test_propose_task_falls_back_when_the_model_is_broken():
    async def broken(*_args, **_kwargs):
        raise RuntimeError("provider down")

    task = asyncio.run(onboard.propose_task(GOAL, DEMOS, parse_fn=broken, task_id="support_escalation"))
    assert task.id == "support_escalation"
    assert {d.name for d in task.decision_fields} == {"priority", "assigned_team"}


def test_repair_proposal_accepts_dict_shaped_then():
    """The prompt's skeleton shows `then` as an object; the repair must take either shape."""
    data = fake_proposal().model_dump()
    data["process_rules"] = [{"id": "D9", "title": "object shape", "when": "task.sla_breached == True",
                              "then": {"assigned_team": "Engineering"}}]
    task = onboard.repair_proposal(data, GOAL, DEMOS, task_id="support_escalation")
    assert [(r.id, r.then) for r in task.process_rules] == [("D9", {"assigned_team": "Engineering"})]


# -------------------------------------------------------------------- storage
def test_save_and_load_custom_pack_roundtrip(tmp_path):
    task = onboard.infer_without_llm(GOAL, DEMOS, task_id="support_escalation")
    path = onboard.save_task_definition(task, directory=tmp_path)
    assert path.name == "support_escalation.json"
    again = onboard.save_task_definition(task, directory=tmp_path)
    assert again == path
    loaded = json.loads(path.read_text())
    assert loaded["id"] == "support_escalation" and loaded["version"] == 2  # bumped on re-save
    assert loaded["demo"]["capture"][0]["id"] == "T-1001"
    pack = GenericPack(onboard.load_task_definition(path))
    assert pack.id == "support_escalation"


# ---------------------------------------------------------------- demo folding
def test_demo_from_events_folds_observe_stream():
    events = [
        {"type": "observe", "url": "https://x/y", "title": "Ticket", "fields": [{"name": "priority"}]},
        {"type": "field_changed", "field": "priority", "before": "Normal", "after": "High"},
        {"type": "action", "name": "Escalate", "label": "Escalate"},
    ]
    folded = onboard.Demo.from_events(events)
    assert folded.title == "Ticket" and folded.action.name == "Escalate"
    assert folded.final_values() == {"priority": "High"}


def test_observe_js_contract_is_present():
    src = OBSERVE_JS.read_text()
    for token in ("window.shadowObserve", "snapshot", "field_changed", "action", "password",
                  "label[for=", "aria-label", "MutationObserver"):
        assert token in src, token
    assert "node --check" not in src  # no shell-out, ever


def test_onboard_api_starts_a_capture_session_on_a_new_task(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from shadow import llm, main
    monkeypatch.setattr(llm, "available", lambda: False)  # offline: heuristics, no model call
    monkeypatch.setattr(main.onboard, "propose_task", _offline_propose(tmp_path))
    client = TestClient(main.app)
    r = client.post("/api/onboard", json={"goal": "Escalate support tickets to the right team", "demos": DEMOS})
    assert r.status_code == 200, r.text
    body = r.json()
    sid = body["session"]["id"]
    try:
        assert body["session"]["mode"] == "capture" and body["pack_id"]
        fields = {f["name"] for f in body["session"]["pack"]["fields"]}
        assert fields, "decision fields were inferred from the demonstrations"
        assert client.get("/observe.js").status_code == 200
    finally:
        main.sessions.pop(sid, None)


def _offline_propose(tmp_path):
    from shadow import onboard as ob

    async def propose(goal, demos, **kw):
        return ob.infer_without_llm(goal, demos, task_id=kw.get("task_id"))
    return propose
