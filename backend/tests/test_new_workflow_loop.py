"""Unknown page -> observer events -> pause/answer -> map -> tutor/revisit.

Offline translation stubs only: the real API, planner, map and persistence run.
This invented service workflow has no domain pack or simulator/oracle.
"""
import time

import pytest
from fastapi.testclient import TestClient

from shadow import compiler, llm, main, onboard
from shadow.packs import _REGISTRY
from shadow.store import Store
from shadow.workmap import run_map


def page(hours=3, level="Premium", team="Support", url="https://desk.test/ticket/4"):
    return {"type": "observe", "url": url, "title": "Service desk routing", "fields": [
        {"name": "open_hours", "label": "Hours open", "kind": "number", "value_kind": "num", "value": hours},
        {"name": "service_level", "label": "Service level", "kind": "text", "value_kind": "text", "value": level},
        {"name": "assigned_team", "label": "Assigned team", "kind": "select", "value_kind": "cat",
         "options": ["Support", "Engineering", "Dispatch"], "value": team}]}


def demos():
    return [[page(h, l, url=f"https://desk.test/ticket/{i}"),
             {"type": "field_changed", "field": "assigned_team", "before": "Support", "after": t},
             {"type": "action", "name": "save_ticket", "label": "Save routing"}]
            for i, (h, l, t) in enumerate([(2, "Standard", "Engineering"), (30, "Premium", "Dispatch"),
                                           (6, "Standard", "Engineering")])]


async def no_proposals(*args, **kwargs):
    return []


async def translate(pack, wm, inquiry, transcript, case):
    """Translation, not a simulated expert: decisions/labels come from the test."""
    return compiler.Compiled(answers_question=True, key_quote=transcript, strength="always", rules=[
        compiler.CompiledRule(title="Premium tickets go to Dispatch", when="task.service_level == 'Premium'",
                              field="assigned_team", value="Dispatch", quote=transcript)])


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", Store(f"sqlite:///{tmp_path}/loop.db"))
    monkeypatch.setattr(main, "sessions", {})
    monkeypatch.setattr(main, "latest", [])
    monkeypatch.setattr(llm, "available", lambda: False)
    async def propose(goal, ds, **kw):
        return onboard.infer_without_llm(goal, ds, task_id=kw.get("task_id"))
    monkeypatch.setattr(onboard, "propose_task", propose)
    with TestClient(main.app) as c:
        yield c
    _REGISTRY.pop("test_service_loop", None)


def start(client):
    r = client.post("/api/onboard", json={"goal": "Route service tickets", "demos": demos(),
                                         "events": True, "pack_id": "test_service_loop", "expert": "Alex"})
    assert r.status_code == 200, r.text
    s = main.sessions[r.json()["session"]["id"]]
    s.proposer, s.compiler = no_proposals, translate
    return s


def event(client, s, e):
    r = client.post(f"/api/sessions/{s.id}/events", json=e)
    assert r.status_code == 200, r.text
    return r.json()


def test_unknown_workflow_learns_and_teaches_through_api(client, monkeypatch):
    s = start(client)
    assert s.source == "live" and not s.simulated
    event(client, s, page())
    first = s.current_case
    assert s.dps[first].prediction and s.dps[first].committed_at is not None
    # an open decision control is never a fact; its opening value lives in the booking
    assert "assigned_team" not in s.cases[first]["facts"]
    assert s.cases[first]["booking"]["assigned_team"] == "Support"
    event(client, s, {"type": "field_changed", "field": "assigned_team", "before": "Support", "after": "Dispatch"})
    # Reading the opening page again must not replace the frozen guess or leak the answer.
    event(client, s, page(team="Dispatch"))
    assert s.current_case == first and "assigned_team" not in s.cases[first]["facts"]
    assert event(client, s, {"type": "action", "name": "save_ticket"})["allow"]
    event(client, s, {"type": "action", "name": "save_ticket"})
    assert len(s.episodes) == 1 and s.episodes[0].scored
    assert s.episodes[0].expert["assigned_team"] == "Dispatch"
    assert s.episodes[0].gaps
    # Not while typing; then a genuine quiet-state release (not force=True).
    s.activity.last_input = time.time()
    assert client.portal.call(s.tick) is None
    s.activity.last_input = s.activity.last_screen_change = time.time() - 3
    client.portal.call(s.tick)
    assert s.awaiting is not None
    r = client.post(f"/api/sessions/{s.id}/utterance", json={"text": "Premium tickets always go to Dispatch."})
    assert r.status_code == 200
    client.portal.call(s.drain)
    assert any(r.then == {"assigned_team": "Dispatch"} for r in s.wm.rules)
    event(client, s, page(hours=4, url="https://desk.test/ticket/5"))
    later = s.current_case
    assert s.dps[later].prediction.fields["assigned_team"].value == "Dispatch"
    assert s.dps[later].prediction.fields["assigned_team"].source != "novice"
    event(client, s, {"type": "field_changed", "field": "assigned_team", "after": "Dispatch"})
    event(client, s, {"type": "action", "name": "save_ticket"})
    assert s.receipts and s.receipts[0]["independent"]
    debrief = client.post(f"/api/sessions/{s.id}/debrief")
    assert debrief.status_code == 200 and debrief.json()["mode"] == "debrief"
    assert client.portal.call(s.debrief_next)
    for fmt in ("json", "md", "skill"):
        r = client.get(f"/api/sessions/{s.id}/export/{fmt}")
        assert r.status_code == 200 and "Dispatch" in r.text
    monkeypatch.setattr(llm, "available", lambda: True)  # API guard only; no model calls below
    tutor = client.post("/api/sessions", json={"mode": "tutor", "pack": s.pack.id, "from_session": s.id})
    assert tutor.status_code == 200, tutor.text
    t = main.sessions[tutor.json()["id"]]
    t.use_llm = False
    event(client, t, page(hours=5, url="https://desk.test/ticket/6"))
    assert run_map(t.wm, t.pack, t.cases[t.current_case]).fields["assigned_team"].value == "Dispatch"
    blocked = client.post("/api/capture/before_save", json={"session": t.id, "case_id": t.current_case,
                         "booking": {"assigned_team": "Support"}, "action": "save_ticket"})
    assert blocked.status_code == 200 and not blocked.json()["allow"]
    assert client.post("/api/capture/before_save", json={"session": t.id, "case_id": t.current_case,
                         "booking": {"assigned_team": "Dispatch"}, "action": "save_ticket"}).json()["allow"]
    matched = client.post("/api/workflows/match", json={"url": "https://desk.test/ticket/99",
                           "fields": [f["name"] for f in page()["fields"]], "actions": ["save_ticket"]}).json()
    assert matched["verdict"] == "same" and matched["best"]["id"] == s.pack.id
    continued = client.post("/api/sessions", json={"pack": s.pack.id, "fresh": False})
    assert continued.status_code == 200 and continued.json()["expert"] == "Alex"
    assert continued.json()["map_source"]["kind"] == "saved"


def test_generic_input_changes_private_events_helpers_and_end(client):
    s = start(client)
    event(client, s, page())
    first = s.current_case
    event(client, s, {"type": "field_changed", "field": "open_hours", "after": 9})
    assert s.current_case != first and s.cases[s.current_case]["facts"]["open_hours"] == 9
    event(client, s, {"type": "action", "name": "open_help"})
    assert not s.episodes
    client.post(f"/api/sessions/{s.id}/record", json={"off": True})
    event(client, s, page(hours=100, url="https://desk.test/ticket/private"))
    event(client, s, {"type": "action", "name": "save_ticket"})
    assert not s.episodes and s.cases[s.current_case]["facts"]["open_hours"] == 9
    client.post(f"/api/sessions/{s.id}/end")
    event(client, s, page(hours=200))
    assert not s.episodes


def test_unassigned_socket_does_not_follow_another_page(client):
    s = start(client)
    with client.websocket_connect("/ws/capture?follow_latest=false") as ws:
        ws.send_json(page())
        ws.send_json({"type": "hello", "session": s.id})
        assert ws.receive_json()["type"] == "session"
    assert s.current_case is None
    with client.websocket_connect("/ws/capture?session=missing") as ws:
        ws.send_json({"type": "hello"})
        assert ws.receive_json() == {"type": "session_missing", "session": "missing"}


def test_invalid_onboarding_and_cross_workflow_map_are_rejected(client, monkeypatch):
    assert client.post("/api/onboard", json={"goal": "", "demos": demos(), "events": True}).status_code == 400
    assert client.post("/api/onboard", json={"goal": "Route", "demos": [[page()]], "events": True}).status_code == 400
    s = start(client)
    monkeypatch.setattr(llm, "available", lambda: True)
    assert client.post("/api/sessions", json={"pack": "ap_invoices", "from_session": s.id}).status_code == 400


def test_short_codes_and_counterfactuals_keep_inputs_separate_from_outputs():
    ds = [onboard.Demo.from_events(d) for d in demos()]
    task = onboard.infer_without_llm("Route service tickets", ds)
    assert task.feature("service_level").options == ["Standard", "Premium"]
    assert "Support" in task.decision_fields[0].options
    from shadow.packs.generic import GenericPack
    import random
    pack = GenericPack(task)
    base = pack.demo_cases()["capture"][0]
    variants = pack.perturb(base, random.Random(7))
    assert any(c["facts"]["service_level"] == "Premium" for c in variants)
    assert all(c["facts"]["assigned_team"] == base["facts"]["assigned_team"] for c in variants)
    from shadow import questions
    assert "none" not in questions.template(pack, "counterfactual", case=base, field="action",
                                             expert_value=None, probe_delta="Hours open is 10").lower()


def test_learning_a_new_task_on_the_same_page_does_not_replace_the_old_one(client):
    body = {"goal": "Route service tickets", "events": True, "demos": demos()}
    first = client.post("/api/onboard", json=body).json()
    second = client.post("/api/onboard", json=body).json()
    try:
        assert first["pack_id"] != second["pack_id"]
        assert main.store.workflow(first["pack_id"]) and main.store.workflow(second["pack_id"])
        from shadow.packs import get_pack
        _REGISTRY.pop(first["pack_id"], None)
        assert get_pack(first["pack_id"]).id == first["pack_id"]  # durable loader after memory is cleared
    finally:
        _REGISTRY.pop(first["pack_id"], None)
        _REGISTRY.pop(second["pack_id"], None)


def test_questions_name_the_item_by_its_own_id_and_read_like_speech():
    from shadow.questions import _lower, case_ref
    assert _lower("PRIORITY") == "priority" and _lower("Cost center") == "cost center"
    class P:  # minimal pack: a ticket workflow
        id, name = "tickets", "Support tickets"
    import shadow.questions as q
    noun = q.case_noun
    q.case_noun = lambda pack: "support ticket"
    try:
        assert case_ref(P(), {"id": "page-0cca7ca35fbb", "ref": "SR-4106"}) == "support ticket SR-4106"
    finally:
        q.case_noun = noun


def test_tutor_never_silent_on_a_learned_workflow_save(client, monkeypatch):
    """The page's own save hook (Support desk) names the app's ticket id, not Tacet's page case.

    Regression: that hook was never wired, unknown ids were allowed in silence, and a save no
    learned rule covers only flashed a sparkle. Every tutored save now blocks or says something.
    """
    s = start(client)
    event(client, s, page())
    event(client, s, {"type": "field_changed", "field": "assigned_team", "before": "Support", "after": "Dispatch"})
    event(client, s, {"type": "action", "name": "save_ticket"})
    s.activity.last_input = s.activity.last_screen_change = time.time() - 3
    client.portal.call(s.tick)
    client.post(f"/api/sessions/{s.id}/utterance", json={"text": "Premium tickets always go to Dispatch."})
    client.portal.call(s.drain)
    client.post(f"/api/sessions/{s.id}/end")
    monkeypatch.setattr(llm, "available", lambda: True)  # API guard only; no model calls below
    t = main.sessions[client.post("/api/sessions", json={"mode": "tutor", "pack": s.pack.id,
                                                         "from_session": s.id}).json()["id"]]
    t.use_llm = False
    said = []
    real_emit = t.emit
    async def emit(kind, payload):
        said.append((kind, payload))
        return await real_emit(kind, payload)
    t.emit = emit

    def hook(ticket, team, level="Premium", url="https://desk.test/ticket/7"):
        snap = page(hours=5, level=level, team=team, url=url)
        return client.post("/api/capture/before_save", json={
            "session": t.id, "case_id": ticket, "action": "save_ticket",
            "booking": {"assigned_team": team}, "url": snap["url"], "fields": snap["fields"]}).json()

    # a deviation from a learned rule is blocked, in the expert's words, even with the app's own id
    blocked = hook("SR-7", "Support")
    assert not blocked["allow"] and "Alex" in blocked["intervention"]["explain"]
    # the observer's click reports the same save a moment later: judged once, not a second stop
    event(client, t, {"type": "action", "name": "save_ticket", "fields": page(hours=5, team="Support")["fields"]})
    assert sum(k == "intervene" for k, _ in said) == 1
    # following the rule is confirmed out loud
    ok = hook("SR-7", "Dispatch")
    assert ok["allow"] and ok["checked"] and "Alex" in ok["text"]
    # a case nothing learned covers: allowed, but never in silence
    said.clear()
    other = hook("SR-8", "Engineering", level="Standard", url="https://desk.test/ticket/8")
    assert other["allow"] and not other["checked"] and "never showed me" in other["text"]
    assert any(k == "tutor_ok" and p.get("text") for k, p in said)
    # an id the tutor cannot place is reported too
    said.clear()
    lost = client.post("/api/capture/before_save", json={"session": t.id, "case_id": "nope",
                                                          "booking": {}, "action": "save_ticket"}).json()
    assert lost["allow"] and lost.get("text")


def test_capture_save_hook_on_a_learned_workflow_never_breaks_the_save(client):
    s = start(client)
    event(client, s, page())
    r = client.post("/api/capture/before_save", json={"session": s.id, "case_id": "SR-1",
                                                      "booking": {"assigned_team": "Dispatch"}, "action": "save_ticket"})
    assert r.status_code == 200 and r.json()["allow"]


def test_one_voice_per_session_handoff_reaches_the_companion(client):
    """Companion and notebook each open an ElevenLabs conversation; the latest claim wins, the other hangs up."""
    s = start(client)
    with client.websocket_connect(f"/ws/capture?session={s.id}") as ws:
        ws.send_json({"type": "hello", "session": s.id})
        assert ws.receive_json()["type"] == "session"
        r = client.post(f"/api/sessions/{s.id}/voice", json={"client": "console", "token": "abc"})
        assert r.status_code == 200 and s.voice_owner == {"client": "console", "token": "abc"}
        for _ in range(20):
            m = ws.receive_json()
            if m["type"] == "voice_owner":
                break
        assert m["type"] == "voice_owner" and m["token"] == "abc"


def test_tutor_refuses_a_work_map_with_nothing_learned(client, monkeypatch):
    """Recorded live: tutoring from 'v0, 0 rules, 0 guardrails' let every save through without a word."""
    s = start(client)
    assert not s.wm.rules and not s.wm.guardrails
    monkeypatch.setattr(llm, "available", lambda: True)  # API guard only
    r = client.post("/api/sessions", json={"mode": "tutor", "pack": s.pack.id, "from_session": s.id})
    assert r.status_code == 409 and "no rules yet" in r.text


def test_provider_outage_never_closes_the_observer(client, monkeypatch):
    """Live: one failed model call raised inside the capture socket, closed it, and every later save was lost."""
    s = start(client)
    s.use_llm = True
    monkeypatch.setattr(llm, "available", lambda: True)
    async def down(*a, **k):
        raise RuntimeError("provider down")
    monkeypatch.setattr(llm, "parse", down)
    with client.websocket_connect(f"/ws/capture?session={s.id}") as ws:
        ws.send_json({"type": "hello", "session": s.id})
        assert ws.receive_json()["type"] == "session"
        ws.send_json({**page(), "session": s.id})
        ws.send_json({"type": "field_changed", "field": "assigned_team", "before": "Support", "after": "Dispatch",
                      "session": s.id})
        ws.send_json({"type": "action", "name": "save_ticket", "session": s.id})
        ws.send_json({"type": "hello", "session": s.id})  # still open: the server answers
        for _ in range(50):
            if ws.receive_json()["type"] == "session":
                break
    assert s.current_case and s.dps[s.current_case].prediction is not None
    assert len(s.episodes) == 1
