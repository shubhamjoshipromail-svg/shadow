"""Shadow Core API.

  /ws/panel/{sid}        Shadow side panel: snapshot + live model events
  /ws/capture            capture.js inside the observed app (ERP)
  /api/capture/before_save   save intercept (tutor catches mistakes here)
  /v1/chat/completions   ElevenLabs Custom LLM: Shadow decides what the agent says
"""

from __future__ import annotations

import asyncio
import json
import os
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from shadow import config, converse, exports, llm, perception, sim
from shadow import certify, compare, mcp_server, onboard
from shadow import proof as proof_mod
from shadow import workflows as wf
from shadow.packs import add_loader, register
from shadow.packs.generic import GenericPack
from shadow import engine as engine_mod
from shadow.engine import Session
from shadow.packs import get_pack
from shadow.store import Store
from shadow.workmap import WorkMap

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("shadow.api")

STATIC = Path(__file__).parent / "static"
store = Store()
add_loader(lambda pid: (store.workflow(pid) or {}).get("definition"))  # learned workflows survive restarts
sessions: dict[str, Session] = {}
latest: list[str] = []  # most recent session ids, newest last


async def _ticker() -> None:
    while True:
        for s in list(sessions.values()):
            try:
                await s.tick()
            except Exception:  # noqa: BLE001
                log.exception("tick failed")
        await asyncio.sleep(0.4)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_ticker())
    log.info("Tacet Core up. LLM %s. Public URL %s", "enabled" if llm.available() else "DISABLED", config.PUBLIC_URL)
    yield
    task.cancel()


app = FastAPI(title="Tacet Core", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _mcp_map(workflow: str | None = None) -> WorkMap:
    """MCP tools read a live session's map, or a workflow's newest saved map (survives restarts)."""
    if workflow in sessions:
        return sessions[workflow].wm
    pid = workflow or (sessions[latest[-1]].pack.id if latest else config.DEFAULT_PACK)
    row = store.latest_map_any(pid)
    if not row:
        raise KeyError(f"no learned Work Map for '{pid}' yet")
    return WorkMap(**row["map"])


def _mcp_pack(workflow: str | None = None):
    return sessions[workflow].pack if workflow in sessions else get_pack(workflow or config.DEFAULT_PACK)


def _mcp_cert(workflow: str | None = None) -> dict[str, Any] | None:
    """The newest live certification for a session or workflow: what an agent may do on its own."""
    if workflow in sessions:
        rows = store.certifications_for(session_id=workflow, live_only=True)
    else:
        pid = workflow or (sessions[latest[-1]].pack.id if latest else config.DEFAULT_PACK)
        rows = store.certifications_for(pack_id=pid, live_only=True)
    return _cert_refresh(rows[0]) if rows else None


app.include_router(mcp_server.make_router(_mcp_map, _mcp_pack, _mcp_cert), prefix="/mcp")  # Work Map as agent tools


def _session(sid: str | None) -> Session:
    if sid and sid in sessions:
        return sessions[sid]
    if not sid and latest:
        return sessions[latest[-1]]
    raise HTTPException(404, "no such session")


# ---------------------------------------------------------------- sessions
class NewSession(BaseModel):
    mode: str = "capture"
    workspace: str = config.DEFAULT_WORKSPACE
    expert: str | None = None
    trainee: str | None = None
    lang: str = "en"
    pack: str = config.DEFAULT_PACK
    from_session: str | None = None
    fresh: bool = True  # capture: start from the written process only
    simulate: bool = False  # oracle-driven proposer/compiler: runs without API keys


@app.post("/api/sessions")
async def create_session(body: NewSession) -> dict[str, Any]:
    try:
        pack = get_pack(body.pack)
    except KeyError as e:
        raise HTTPException(404, f"Unknown workflow '{body.pack}'.") from e
    expert = body.expert or pack.expert_name
    wm = None
    source: dict[str, Any] = {"kind": "seed"}
    if body.from_session and body.from_session in sessions:
        if sessions[body.from_session].pack.id != pack.id:
            raise HTTPException(400, "The source Work Map belongs to a different workflow.")
        if sessions[body.from_session].simulated and not body.simulate:
            raise HTTPException(409, "A practice Work Map cannot seed a live session. Keep this a practice run.")
        wm = sessions[body.from_session].wm.model_copy(deep=True)
        source = {"kind": "session", "session": body.from_session, "version": wm.version}
    elif body.mode != "capture" or not body.fresh:
        saved = store.latest_map_row(expert, pack.id)
        if not saved and body.expert is None and (body.mode == "tutor" or not body.fresh):
            saved = store.latest_map_any(pack.id)  # teach from whichever expert taught this workflow last
        if saved:
            wm = WorkMap(**saved["map"])
            expert = wm.expert
            source = {"kind": "saved", "session": saved["session_id"], "version": saved["version"],
                      "saved_at": saved["created"]}
        elif not body.fresh:
            raise HTTPException(404, f"No saved Work Map for {expert} yet. Start a fresh capture first.")
    sid = uuid.uuid4().hex[:10]
    sim_kwargs = {}
    if body.simulate:
        sim_kwargs = dict(proposer=sim.fake_propose, compiler=sim.FakeCompiler())
    elif not llm.available():
        raise HTTPException(409, "No LLM provider configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to backend/.env, "
                                 "or start a Rehearsal session (simulated expert).")
    s = Session(sid, pack, mode=body.mode, expert=expert, wm=wm, store=store, lang=body.lang, trainee=body.trainee,
                use_llm=not body.simulate, **sim_kwargs)
    s.simulated = bool(sim_kwargs)
    s.map_source = source
    s.workspace = body.workspace
    if not s.simulated:
        s.load_policy()
    if body.mode == "tutor" and body.trainee and not s.simulated:
        s.mastery = store.load_mastery(body.workspace, pack.id, body.trainee)  # pick up where they left off
    sessions[sid] = s
    latest.append(sid)
    store.create_session(sid, body.mode, pack.id, expert, {"lang": body.lang, "trainee": body.trainee,
                                                            "simulated": s.simulated, "map_source": source,
                                                            "workspace": body.workspace, "workflow": pack.id,
                                                            "source": s.source})
    if body.mode == "debrief":
        await s.start_debrief()
    return s.snapshot()


@app.get("/api/sessions")
async def list_sessions() -> list[dict[str, Any]]:
    return [{"id": s.id, "mode": s.mode, "expert": s.expert, "pack": s.pack.id, "live": True, "metrics": s.metrics()}
            for s in sessions.values()]


@app.get("/api/sessions/{sid}")
async def get_session(sid: str) -> dict[str, Any]:
    return _session(sid).snapshot()


@app.post("/api/sessions/{sid}/end")
async def end_session(sid: str) -> dict[str, Any]:
    """The expert is done: stop observing. The session stays readable in the notebook; its map is saved."""
    s = _session(sid)
    s.ended = True
    s.awaiting = None
    s.planner.queue.clear()
    if sid in latest:
        latest.remove(sid)  # unpinned observers stop following it
    s._save_map()
    await s.emit("ended", {"session": sid})
    return {"ended": True}


@app.post("/api/sessions/{sid}/debrief")
async def start_debrief(sid: str) -> dict[str, Any]:
    return await _session(sid).start_debrief()


class RecordBody(BaseModel):
    off: bool


@app.post("/api/sessions/{sid}/record")
async def set_record(sid: str, body: RecordBody) -> dict[str, Any]:
    s = _session(sid)
    s.off_record = body.off
    await s.emit("record", {"off_record": body.off})
    return {"off_record": body.off}


@app.post("/api/sessions/{sid}/events")
async def post_event(sid: str, evt: dict[str, Any]) -> dict[str, Any]:
    out = await _session(sid).on_event(evt)
    return out or {"ok": True}


class Utterance(BaseModel):
    text: str
    who: str = "user"


@app.post("/api/sessions/{sid}/utterance")
async def post_utterance(sid: str, body: Utterance) -> dict[str, Any]:
    """Text fallback for the voice channel (and for scripted rehearsal)."""
    s = _session(sid)
    chunks = [c async for c in converse.reply(s, [{"role": "user", "content": body.text}])]
    return {"reply": "".join(chunks)}


class Frame(BaseModel):
    image: str  # base64 jpeg (PII already blurred client-side)
    media_type: str = "image/jpeg"
    ts: float | None = None


_last_reading: dict[str, perception.Reading] = {}


def _resolve_vision_case(s: Any, case_id: str | None) -> str | None:
    """Vision ids ('4471', 'INV-4471') → this session's case ids ('inv-4471')."""
    if not case_id:
        return None
    if case_id in s.cases:
        return case_id
    want = perception.normalise_label(case_id)
    for cid in s.cases:
        key = perception.normalise_label(cid)
        if key == want or key.endswith("_" + want) or want.endswith("_" + key):
            return cid
    return None


@app.post("/api/sessions/{sid}/frames")
async def post_frame(sid: str, frame: Frame) -> dict[str, Any]:
    """A screen frame becomes events (case opened, field changed), not video: the brief's Module 1 wiring."""
    s = _session(sid)
    s.activity.screen_changed()
    if s.off_record or not llm.available():
        return {"skipped": True}
    prev = _last_reading.get(sid)
    reading = await perception.read_frame(frame.image, prev.summary if prev else None, frame.media_type, pack=s.pack)
    _last_reading[sid] = reading
    await s.on_event({"type": "vision", "reading": reading.model_dump()})
    events: list[dict[str, Any]] = []
    for event in perception.diff_events(prev, reading, pack=s.pack):
        event = dict(event)
        cid = _resolve_vision_case(s, event.get("case_id"))
        if cid:
            event["case_id"] = cid
        else:
            event.pop("case_id", None)
        events.append(event)
        if event["type"] in ("case_opened", "field_changed"):
            await s.on_event(event)  # same path as DOM events: opens the case, records the attention trail
    return {**reading.model_dump(), "events": events}


@app.post("/api/sessions/{sid}/sim/step")
async def sim_step(sid: str) -> dict[str, Any]:
    """Advance a session by one move of simulated Sabine (or the trainee). For rehearsal and offline demos."""
    s = _session(sid)
    if not s.simulated:
        raise HTTPException(409, "This is a live session: it only learns from the real expert. "
                                 "Start a Rehearsal session to use the simulated expert.")
    if s.awaiting is not None:
        answer = sim.sim_answer(s, s.awaiting)
        chunks = [c async for c in converse.reply(s, [{"role": "user", "content": answer}])]
        return {"did": "answered", "said": answer, "reply": "".join(chunks)}
    if s.mode == "debrief":
        text = await s.debrief_next()
        return {"did": "asked", "reply": text}
    decided = {e.case_id for e in s.episodes if not e.synthetic}
    if s.mode == "tutor":
        attempted = getattr(s, "_sim_attempts", set())
        for cid in s.case_order:
            if cid in getattr(s, "_sim_done", set()):
                continue
            await s.open_case(cid)
            booking, action = sim.oracle_booking(s.cases[cid])
            if cid not in attempted:  # first try: the trainee follows the 2019 doc
                attempted.add(cid)
                s._sim_attempts = attempted  # type: ignore[attr-defined]
                wrong = {**booking, "cost_center": "4711" if booking.get("cost_center") in ("0400", "0410") else booking.get("cost_center")}
                verdict = await s.before_save(cid, wrong, "post")
                if not verdict["allow"]:
                    return {"did": "trainee_mistake", "case": cid, "verdict": verdict}
            verdict = await s.before_save(cid, booking, action)
            s._sim_done = getattr(s, "_sim_done", set()) | {cid}  # type: ignore[attr-defined]
            return {"did": "trainee_saved", "case": cid, "verdict": verdict}
        return {"did": "nothing"}
    for cid in s.case_order:
        if cid in decided:
            continue
        if s.current_case != cid:
            await s.open_case(cid)
            return {"did": "opened", "case": cid}
        booking, action = sim.oracle_booking(s.cases[cid])
        await s.on_event({"type": "panel_opened", "panel": "history" if action == "hold" else "po"})
        await s.on_event({"type": "decision", "case_id": cid, "booking": booking, "action": action})
        return {"did": "decided", "case": cid, "action": action}
    return {"did": "nothing"}


# ---------------------------------------------------------------- receipts + sealed boundary tests
@app.get("/api/sessions/{sid}/receipts")
async def session_receipts(sid: str) -> list[dict[str, Any]]:
    return _session(sid).snapshot()["receipts"]


class ProofRequest(BaseModel):
    param: str | None = None
    seed: int | None = None


@app.post("/api/sessions/{sid}/proofs")
async def freeze_proof(sid: str, body: ProofRequest) -> dict[str, Any]:
    """Freeze Shadow's predictions on fresh boundary cases and publish a hash commitment to them."""
    s = _session(sid)
    if s.simulated:
        raise HTTPException(409, "Boundary tests prove live learning, so they don't run on a Rehearsal "
                                 "(simulated expert) session.")
    try:
        p = proof_mod.build(s, body.param, body.seed)
    except proof_mod.ProofError as e:
        raise HTTPException(400, str(e)) from e
    view = proof_mod.view(p)
    await s.emit("proof", {"proof": view, "frozen": True})
    if s.store:  # the full frozen record, so the commitment can be audited later even after a restart
        s.store.append(s.id, "proof_frozen", {"proof": p})
    return view


@app.get("/api/sessions/{sid}/proofs/{pid}")
async def get_proof(sid: str, pid: str) -> dict[str, Any]:
    s = _session(sid)
    if pid not in s.proofs:
        raise HTTPException(404, "no such test")
    return proof_mod.view(s.proofs[pid])


class ProofLabel(BaseModel):
    case_id: str
    value: str


@app.post("/api/sessions/{sid}/proofs/{pid}/label")
async def label_proof(sid: str, pid: str, body: ProofLabel) -> dict[str, Any]:
    """A human's answer for one sealed case. It is scored against the frozen prediction, then learned from."""
    s = _session(sid)
    p = s.proofs.get(pid)
    if p is None or body.case_id not in {i["case_id"] for i in p["items"]}:
        raise HTTPException(404, "no such test case")
    await s.on_label(body.case_id, {p["field"]: body.value})
    return proof_mod.view(p)


# ---------------------------------------------------------------- certify an agent (permission slips)
def _cert_wm(cert: dict[str, Any]) -> WorkMap | None:
    """The map as it is now: the live session's, else the newest saved one (so staleness survives a restart)."""
    s = sessions.get(cert["session"])
    if s is not None:
        return s.wm
    row = store.latest_map_any(cert["pack"])
    return WorkMap(**row["map"]) if row else None


def _cert(cid: str) -> dict[str, Any]:
    cert = store.certification(cid)
    if cert is None:
        raise HTTPException(404, "no such certification")
    return cert


def _cert_refresh(cert: dict[str, Any]) -> dict[str, Any]:
    before = json.dumps(cert["result"], sort_keys=True, default=str)
    certify.refresh(cert, sessions.get(cert["session"]))
    if json.dumps(cert["result"], sort_keys=True, default=str) != before:
        store.save_certification(cert)
    return cert


class CertifyRequest(BaseModel):
    fresh: bool = False  # force a new sealed exam even if a human has already labelled cases
    param: str | None = None
    seed: int | None = None
    min_cases: int = certify.MIN_CASES


@app.post("/api/sessions/{sid}/certify")
async def start_certification(sid: str, body: CertifyRequest) -> dict[str, Any]:
    """Freeze an outside agent's answers on fresh cases and commit to them, before any label exists."""
    s = _session(sid)
    if s.simulated:
        raise HTTPException(409, "Certifying an agent needs human labels, so it doesn't run on a Rehearsal "
                                 "(simulated expert) session.")
    if not llm.available():
        raise HTTPException(503, "No LLM key is configured, so there is no agent to certify.")
    try:
        cert = await certify.start(s, fresh=body.fresh, param=body.param, seed=body.seed, min_cases=body.min_cases)
    except (certify.CertError, proof_mod.ProofError) as e:
        raise HTTPException(400, str(e)) from e
    store.save_certification(cert)
    return certify.view(cert, s.wm)


@app.get("/api/sessions/{sid}/certifications")
async def list_certifications(sid: str) -> list[dict[str, Any]]:
    return [certify.summary(_cert_refresh(c)) for c in store.certifications_for(session_id=sid)]


@app.get("/api/certifications/{cid}")
async def get_certification(cid: str) -> dict[str, Any]:
    cert = _cert_refresh(_cert(cid))
    return certify.view(cert, _cert_wm(cert))


class CertLabel(BaseModel):
    case_id: str
    field: str
    value: str


@app.post("/api/certifications/{cid}/label")
async def label_certification(cid: str, body: CertLabel) -> dict[str, Any]:
    """A human's answer for one exam case (the sealed-test field, or the action a guardrail governs)."""
    cert = _cert(cid)
    s = sessions.get(cert["session"])
    if s is None:
        raise HTTPException(409, "That session is not running any more; labelling needs it open.")
    if cert["provenance"] != "live" or s.simulated:
        raise HTTPException(409, "Only a live session takes human labels.")
    if body.case_id not in {i["case_id"] for i in cert["items"]}:
        raise HTTPException(404, "no such exam case")
    if body.field not in (cert["field"], "action"):
        raise HTTPException(400, f"label '{cert['field']}' or 'action'")
    if body.field == "action" and body.value not in s.pack.actions:
        raise HTTPException(400, f"action must be one of {', '.join(s.pack.actions)}")
    item = next(i for i in cert["items"] if i["case_id"] == body.case_id)
    if body.field in item["labels"]:
        raise HTTPException(409, "that case already has a label for this field")
    await s.on_label(body.case_id, {body.field: body.value})
    certify.refresh(cert, s)
    if body.field not in item["labels"]:  # an action label has no sealed-test twin, so record it here
        certify.add_label(cert, body.case_id, body.field, body.value, "label", s.now())
    store.save_certification(cert)
    return certify.view(cert, s.wm)


@app.get("/api/history")
async def history(expert: str | None = None, pack: str = config.DEFAULT_PACK) -> dict[str, Any]:
    """Receipts and sealed tests across sessions (including ones from before a restart)."""
    expert = expert or get_pack(pack).expert_name
    rows = [r for r in store.list_sessions() if r["expert"] == expert and r["pack_id"] == pack]
    ids = [r["id"] for r in rows]
    evs = store.events_for(ids, ["receipt", "proof", "proof_frozen"]) if ids else []
    receipts: dict[str, dict[str, Any]] = {}
    proofs: dict[str, dict[str, Any]] = {}
    for e in evs:
        p = e["payload"]
        if e["type"] == "receipt":
            receipts[f"{e['session_id']}:{p['receipt']['id']}"] = p["receipt"]
        elif e["type"] == "proof":
            proofs[f"{e['session_id']}:{p['proof']['id']}"] = {**p["proof"], "session": e["session_id"]}
    return {"expert": expert, "pack": pack,
            "sessions": [{"id": r["id"], "mode": r["mode"], "created": r["created"], "meta": r["meta"],
                          "live": r["id"] in sessions} for r in rows],
            "receipts": list(receipts.values()), "proofs": list(proofs.values())}


@app.get("/api/sessions/{sid}/export/{fmt}")
async def export(sid: str, fmt: str):
    wm = _session(sid).wm
    if fmt == "json":
        return JSONResponse(exports.to_json(wm))
    if fmt == "md":
        return PlainTextResponse(exports.to_markdown(wm), media_type="text/markdown")
    if fmt == "skill":
        return PlainTextResponse(exports.to_agent_skill(wm), media_type="text/markdown")
    raise HTTPException(404, "unknown format")


@app.get("/api/sessions/{sid}/tutor/report")
async def tutor_report(sid: str) -> dict[str, Any]:
    return _session(sid).tutor_report()


@app.get("/api/sessions/{sid}/events")
async def session_events(sid: str) -> list[dict[str, Any]]:
    return store.events(sid)


# ---------------------------------------------------------------- observed app (ERP)
@app.get("/capture.js")
async def capture_js() -> FileResponse:
    return FileResponse(STATIC / "capture.js", media_type="application/javascript",
                        headers={"Cache-Control": "no-store"})


@app.get("/observe.js")
async def observe_js() -> FileResponse:
    """Generic page observer: fields, values (safe ones only) and actions on any page, no app cooperation."""
    return FileResponse(STATIC / "observe.js", media_type="application/javascript",
                        headers={"Cache-Control": "no-store"})


class OnboardBody(BaseModel):
    goal: str
    demos: list[Any] = []  # Demo dicts, or (events=True) lists of observe.js events
    events: bool = False
    pack_id: str | None = None
    expert: str | None = None
    workspace: str = config.DEFAULT_WORKSPACE
    lang: str = "en"


@app.post("/api/onboard")
async def onboard_task(body: OnboardBody) -> dict[str, Any]:
    """'Watch me do this': a goal + a few demonstrations become a workflow, and a capture session starts on it."""
    if not body.demos:
        raise HTTPException(400, "Show at least one demonstration first.")
    demos = [onboard.Demo.from_events(d) for d in body.demos] if body.events else [onboard.as_demo(d) for d in body.demos]
    if not body.goal.strip() or any(not d.fields or not d.action or not d.action.name for d in demos):
        raise HTTPException(400, "Give a goal and finish each demonstration with a save or submit action.")
    # Choosing a new task on the same page must not overwrite another workflow.
    task_id = body.pack_id or "workflow_" + uuid.uuid4().hex[:10]
    task = await onboard.propose_task(body.goal, demos, task_id=task_id, save=False)
    version = store.save_workflow(task.id, body.workspace, task.name, task.model_dump(mode="json"),
                                  wf.demos_signature(demos))  # durable: survives restarts and redeploys
    pack = GenericPack(task)
    register(pack)
    sid = uuid.uuid4().hex[:10]
    expert = body.expert or getattr(pack, "expert_name", "expert")
    s = Session(sid, pack, mode="capture", expert=expert, store=store, lang=body.lang)
    s.workspace = body.workspace
    s.map_source = {"kind": "onboarded", "task": pack.id, "version": version}
    s.load_policy()
    sessions[sid] = s
    latest.append(sid)
    store.create_session(sid, "capture", pack.id, expert, {"onboarded": True, "goal": body.goal,
                                                           "workspace": body.workspace, "workflow": pack.id,
                                                           "source": s.source, "simulated": False})
    s._save_map()  # a revisit can continue even before the first post-onboarding save
    return {"task": task.model_dump(mode="json"), "pack_id": pack.id, "session": s.snapshot()}


def _known_workflows(workspace: str | None = None) -> list[dict[str, Any]]:
    builtin = get_pack(config.DEFAULT_PACK)
    out = [{"id": builtin.id, "name": builtin.name, "kind": "built-in", "version": 1,
            "signature": wf.pack_signature(builtin, config.ERP_URL + "/invoice/1")}]
    out += [{"id": r["id"], "name": r["name"], "goal": r.get("goal"), "kind": "learned", "version": r["version"], "signature": r["signature"],
             "workspace": r["workspace"]} for r in store.list_workflows(workspace)]
    return out


@app.get("/api/workflows")
async def list_workflows(workspace: str | None = None) -> list[dict[str, Any]]:
    """Every workflow this workspace knows, with who taught it and how many sessions it has."""
    rows = store.list_sessions()
    out = []
    for w in _known_workflows(workspace):
        mine = [r for r in rows if r["pack_id"] == w["id"] and not (r["meta"] or {}).get("simulated")]
        experts = sorted({r["expert"] for r in mine if r["mode"] != "tutor"})
        learners = sorted({(r["meta"] or {}).get("trainee") for r in mine if r["mode"] == "tutor"} - {None})
        out.append({**w, "experts": experts, "learners": learners, "sessions": len(mine)})
    return out


def _expert_map(pack_id: str, who: str) -> tuple[WorkMap, str, list[dict[str, Any]]]:
    """`who` is a live session id or an expert name (their newest saved, live-taught map)."""
    if who in sessions and sessions[who].pack.id == pack_id:
        s = sessions[who]
        return s.wm, s.expert, [s.cases[c] for c in s.case_order]
    row = store.latest_map_row(who, pack_id)
    if not row:
        raise HTTPException(404, f"No saved Work Map from {who} for this workflow yet.")
    return WorkMap(**row["map"]), who, []


@app.get("/api/workflows/{pack_id}/compare")
async def compare_experts(pack_id: str, a: str, b: str) -> dict[str, Any]:
    """Two experts, one task: where their maps agree, where they differ, and the question to ask each."""
    pack = get_pack(pack_id)
    wa, na, ca = _expert_map(pack_id, a)
    wb, nb, cb = _expert_map(pack_id, b)
    out = compare.compare_maps(pack, wa, wb, ca + cb)
    for c in out.get("disagree", []):
        c.setdefault("a_expert", na)
        c.setdefault("b_expert", nb)
        c["questions"] = compare.questions_for(c)
    return {"workflow": pack_id, "a": na, "b": nb, **out}


class MatchBody(BaseModel):
    url: str = ""
    fields: list[str] = []
    actions: list[str] = []
    workspace: str | None = None


@app.post("/api/workflows/match")
async def match_workflow(body: MatchBody) -> dict[str, Any]:
    """Is this page a workflow we know (same), maybe (ask the user), or a new one (offer 'watch me')?"""
    return wf.match(wf.signature(body.url, body.fields, body.actions), _known_workflows(body.workspace))


@app.get("/companion/intern.png")
async def companion_art() -> FileResponse:
    """Sprite sheet for the in-app companion (portrait + blink frame)."""
    return FileResponse(STATIC / "intern.png", media_type="image/png", headers={"Cache-Control": "max-age=3600"})


@app.get("/companion/teacher.png")
async def companion_teacher_art() -> FileResponse:
    """Mira in teaching mode (pointer), shown while she tutors a new hire."""
    return FileResponse(STATIC / "teacher.png", media_type="image/png", headers={"Cache-Control": "max-age=3600"})


@app.get("/api/erp/cases")
async def erp_cases(session: str | None = None) -> list[dict[str, Any]]:
    if not sessions:
        pack = get_pack(config.DEFAULT_PACK)
        return pack.demo_cases()["capture"]
    s = _session(session)
    return [s.cases[c] for c in s.case_order]


class ErpAction(BaseModel):
    action: str
    booking: dict[str, Any] = {}
    reason: str | None = None
    approver: str | None = None


@app.post("/api/erp/cases/{case_id}/action")
async def erp_action(case_id: str, body: ErpAction, session: str | None = None) -> dict[str, Any]:
    if not sessions:
        return {"ok": True}
    s = _session(session)
    case = s.cases.get(case_id)
    if case:
        case["booking"] = {**case.get("booking", {}), **body.booking}
        case["status"] = {"post": "Posted", "hold": "On hold", "second_approval": "Awaiting 2nd approval",
                          "escalate": "Escalated", "reject": "Rejected"}.get(body.action, body.action)
    return {"ok": True}


class BeforeSave(BaseModel):
    session: str | None = None
    action: str
    case_id: str
    booking: dict[str, Any] = {}
    reason: str | None = None
    approver: str | None = None


@app.post("/api/capture/before_save")
async def before_save(body: BeforeSave) -> dict[str, Any]:
    if not sessions:
        return {"allow": True}
    s = _session(body.session)
    if s.mode == "tutor":
        return await s.on_event({"type": "decision", "case_id": body.case_id, "booking": body.booking,
                                 "action": body.action}) or {"allow": True}
    if s.mode == "capture":
        await s.on_event({"type": "decision", "case_id": body.case_id, "booking": body.booking,
                          "action": body.action, "reason": body.reason})
    return {"allow": True}


COMPANION_EVENTS = {"ended", "tutor_case", "nudge", "tutor_summary", "intervene", "highlight", "record", "mode", "ask", "learned", "activity", "prediction",
                    "silence", "inquiry", "hypotheses", "episode", "replay", "tutor_ok", "teachback"}


def _companion_view(m: dict[str, Any]) -> dict[str, Any]:
    """Trim heavy payloads (full map, posteriors) before they reach the observed app."""
    t = m["type"]
    if t == "learned":
        added = [c for c in m.get("changes", []) if c.get("kind") == "node_added"]
        return {"type": t, "t": m["t"], "added": added, "quote": m.get("quote"), "metrics": m.get("metrics"),
                "receipt": m.get("receipt"),
                "retro": [r for r in m.get("retro", []) if r.get("now_explains")]}
    if t == "hypotheses":
        s = m["set"]
        return {"type": t, "t": m["t"], "field": s["field"], "entropy": s["entropy"], "resolved": m.get("resolved"),
                "top": max(s["items"], key=lambda h: h["posterior"], default=None)}
    if t == "tutor_case":
        return {"type": t, "t": m["t"], "case_id": m.get("case_id"), "prompt": m.get("prompt")}
    if t == "episode":
        return {"type": t, "t": m["t"], "gaps": m["episode"]["gaps"], "metrics": m.get("metrics")}
    return m


# ---------------------------------------------------------------- websockets
@app.websocket("/ws/capture")
async def ws_capture(ws: WebSocket, session: str | None = None, follow_latest: bool = True) -> None:
    await ws.accept()
    s: Session | None = None
    push = None
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            sid = msg.pop("session", None) or session
            if not sid and not follow_latest:
                if s is not None and push is not None:
                    s.listeners.discard(push)
                s = push = None
                continue
            # unpinned observers follow the latest session (e.g. capture -> tutor)
            if not sid and latest and (s is None or s.id != latest[-1]):
                sid = latest[-1]
            if s is None or (sid and s.id != sid):
                try:
                    nxt = _session(sid)
                except HTTPException:
                    if sid:
                        await ws.send_text(json.dumps({"type": "session_missing", "session": sid}))
                    continue
                if s is not None and push is not None:
                    s.listeners.discard(push)  # stop hearing the previous session
                s = nxt
                await ws.send_text(json.dumps({"type": "session", "session": s.id, "mode": s.mode}))

                async def push(m: dict[str, Any], _ws=ws) -> None:
                    # the in-app companion only needs a light stream of what Shadow is doing
                    if m["type"] in COMPANION_EVENTS:
                        await _ws.send_text(json.dumps(_companion_view(m), default=str))
                s.listeners.add(push)
            await s.on_event(msg)
    except WebSocketDisconnect:
        if s is not None and push is not None:
            s.listeners.discard(push)


@app.websocket("/ws/panel/{sid}")
async def ws_panel(ws: WebSocket, sid: str) -> None:
    await ws.accept()
    s = sessions.get(sid)
    if s is None:
        await ws.close(code=4404)
        return

    async def push(m: dict[str, Any]) -> None:
        await ws.send_text(json.dumps(m, default=str))

    s.listeners.add(push)
    await push({"type": "snapshot", "snapshot": s.snapshot()})
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg.get("type") == "snapshot":
                await push({"type": "snapshot", "snapshot": s.snapshot()})
            else:
                await s.on_event(msg)
    except WebSocketDisconnect:
        s.listeners.discard(push)


# ---------------------------------------------------------------- ElevenLabs Custom LLM
@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    extra = body.get("elevenlabs_extra_body") or body.get("custom_llm_extra_body") or {}
    sid = (request.headers.get("x-shadow-session") or (extra.get("shadow_session") if isinstance(extra, dict) else None)
           or body.get("shadow_session") or converse.session_hint(messages))
    try:
        s = _session(sid)
    except HTTPException:
        s = None
    model = body.get("model", "shadow")
    cid = f"chatcmpl-{uuid.uuid4().hex[:12]}"

    heard = next((converse._text(m) for m in reversed(messages) if m.get("role") == "user"), "")
    tool_names = [t.get("function", {}).get("name") for t in body.get("tools") or []]
    skip_tool = next((t for t in body.get("tools") or [] if t.get("function", {}).get("name") == "skip_turn"), None)
    if messages and messages[-1].get("role") == "tool":
        # ElevenLabs reporting a system tool result back to us: nothing to add
        heard = "[tool result]"

    async def chunks():
        if s is None:
            yield "I'm not connected to a session yet."
            return
        said = []
        async for c in converse.reply(s, messages):
            said.append(c)
            yield c
        log.info("voice turn [%s] heard=%r said=%r", s.id, heard[:120], "".join(said)[:160])

    if not body.get("stream"):
        text = "".join([c async for c in chunks()])
        return {"id": cid, "object": "chat.completion", "created": int(time.time()), "model": model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}]}

    async def sse():
        def frame(delta: dict[str, Any], finish: str | None = None) -> str:
            return "data: " + json.dumps({"id": cid, "object": "chat.completion.chunk", "created": int(time.time()),
                                          "model": model, "choices": [{"index": 0, "delta": delta,
                                                                       "finish_reason": finish}]}) + "\n\n"
        yield frame({"role": "assistant"})
        spoke = False
        if heard != "[tool result]":
            async for c in chunks():
                if c:
                    spoke = True
                    yield frame({"content": c})
        if not spoke and skip_tool is not None:
            # stay silent the way ElevenLabs expects: call its skip_turn system tool
            args = {k: "Tacet is staying quiet while the expert works." for k in
                    (skip_tool.get("function", {}).get("parameters", {}).get("required") or [])}
            yield frame({"tool_calls": [{"index": 0, "id": f"call_{uuid.uuid4().hex[:10]}", "type": "function",
                                         "function": {"name": "skip_turn", "arguments": json.dumps(args)}}]})
            yield frame({}, "tool_calls")
        else:
            yield frame({}, "stop")
        yield "data: [DONE]\n\n"
        if not spoke:
            log.info("voice turn [%s] silent (tools offered: %s; skip params: %s)", s.id if s else "-", tool_names,
                     json.dumps((skip_tool or {}).get("function", {}).get("parameters"))[:200])

    return StreamingResponse(sse(), media_type="text/event-stream")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "llm": llm.available(), "sessions": len(sessions), "spend": llm.meter.summary()}


@app.get("/api/config")
async def public_config() -> dict[str, Any]:
    """Non-secret settings the console needs: the ElevenLabs agent ids created by setup_elevenlabs.py."""
    ids_file = config.ROOT / ".elevenlabs_agents.json"
    agents = json.loads(ids_file.read_text()) if ids_file.exists() else json.loads(
        os.getenv("SHADOW_ELEVENLABS_AGENTS") or "{}")  # deployed: agent ids come from the environment
    return {"agents": agents, "public_url": config.PUBLIC_URL, "console_url": config.CONSOLE_URL,
            "erp_url": config.ERP_URL}


@app.get("/api/data/inventory")
async def data_inventory(session: str | None = None) -> dict[str, Any]:
    """What the product has collected, where it lives, and who else sees it. Shown to users, not just admins."""
    db = "PostgreSQL" if store.engine.dialect.name.startswith("postgres") else f"SQLite file ({Path(store.engine.url.database or 'shadow.db').name})"
    return {
        "database": db, "counts": store.ledger_counts(session),
        "samples": {t: store.ledger_rows(t, session, limit=5) for t in ("decisions", "explanations", "learner_attempts")},
        "locations": [
            {"where": f"Tacet server · {db}", "what": "Decisions (case facts, the guess written down before, the expert's "
             "choice), questions and scrubbed answers, rules and every Work Map version, receipts, sealed tests, "
             "new-hire attempts. Tagged live or rehearsal, with workspace, workflow and expert."},
            {"where": "This browser only", "what": "Screen frames for replays (in memory, at most a few minutes, gone on "
             "reload). Never uploaded unless vision reading is switched on."},
            {"where": "ElevenLabs", "what": "Voice audio and its transcript for voice sessions (their retention settings "
             "apply; zero-retention is available)."},
            {"where": "Anthropic / OpenAI APIs", "what": "Case facts and scrubbed answers per request, to compile rules "
             "and phrase questions. API data is not used for training by default."},
        ],
        "never": ["keystroke contents", "anything said or done while off the record", "screens of other applications",
                  "IBANs, emails, phone and card numbers, tax ids in answers (replaced with placeholders)"],
        "redaction": "on" if engine_mod._redact else "not installed",
    }


@app.post("/api/llm/check")
async def llm_check() -> dict[str, Any]:
    """Tiny live call per provider, so 'key present' is never mistaken for 'works'."""
    return {"providers": await llm.check(), "spend": llm.meter.summary()}


# ---------------------------------------------------------------- the notebook (console), same origin
SITE = config.ROOT.parent / "site"  # the public landing page (static), served at /


@app.get("/s/{rest:path}", include_in_schema=False)
async def old_notebook_link(rest: str):
    """Notebook links from before the product moved under /app keep working."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(f"/app/s/{rest}", status_code=307)


if config.CONSOLE_DIST.exists():
    app.mount("/app/assets", StaticFiles(directory=config.CONSOLE_DIST / "assets"), name="console-assets")

    @app.get("/app", include_in_schema=False)
    @app.get("/app/{path:path}", include_in_schema=False)
    async def console_app(path: str = ""):
        f = config.CONSOLE_DIST / path
        if path and f.is_file() and config.CONSOLE_DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(config.CONSOLE_DIST / "index.html", headers={"Cache-Control": "no-cache"})

if SITE.exists():
    app.mount("/site", StaticFiles(directory=SITE, html=True), name="site-legacy")
    app.mount("/", StaticFiles(directory=SITE, html=True), name="site")  # last: API routes above win
