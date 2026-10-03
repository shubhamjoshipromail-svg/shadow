"""Shadow Core API.

  /ws/panel/{sid}        Shadow side panel: snapshot + live model events
  /ws/capture            capture.js inside the observed app (ERP)
  /api/capture/before_save   save intercept (tutor catches mistakes here)
  /v1/chat/completions   ElevenLabs Custom LLM: Shadow decides what the agent says
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from shadow import config, converse, exports, llm, perception, sim
from shadow.engine import Session
from shadow.packs import get_pack
from shadow.store import Store
from shadow.workmap import WorkMap

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("shadow.api")

STATIC = Path(__file__).parent / "static"
store = Store()
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
    log.info("Shadow Core up. LLM %s. Public URL %s", "enabled" if llm.available() else "DISABLED", config.PUBLIC_URL)
    yield
    task.cancel()


app = FastAPI(title="Shadow Core", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _session(sid: str | None) -> Session:
    if sid and sid in sessions:
        return sessions[sid]
    if not sid and latest:
        return sessions[latest[-1]]
    raise HTTPException(404, "no such session")


# ---------------------------------------------------------------- sessions
class NewSession(BaseModel):
    mode: str = "capture"
    expert: str | None = None
    trainee: str | None = None
    lang: str = "en"
    pack: str = config.DEFAULT_PACK
    from_session: str | None = None
    fresh: bool = True  # capture: start from the written process only
    simulate: bool = False  # oracle-driven proposer/compiler: runs without API keys


@app.post("/api/sessions")
async def create_session(body: NewSession) -> dict[str, Any]:
    pack = get_pack(body.pack)
    expert = body.expert or pack.expert_name
    wm = None
    if body.from_session and body.from_session in sessions:
        wm = sessions[body.from_session].wm.model_copy(deep=True)
    elif body.mode != "capture" or not body.fresh:
        saved = store.latest_map(expert, pack.id)
        wm = WorkMap(**saved) if saved else None
    sid = uuid.uuid4().hex[:10]
    sim_kwargs = {}
    if body.simulate:
        sim_kwargs = dict(proposer=sim.fake_propose, compiler=sim.FakeCompiler())
    elif not llm.available():
        raise HTTPException(409, "No LLM provider configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to backend/.env, "
                                 "or start a Rehearsal session (simulated expert).")
    s = Session(sid, pack, mode=body.mode, expert=expert, wm=wm, store=store, lang=body.lang, trainee=body.trainee,
                use_llm=not body.simulate, **sim_kwargs)
    s.simulated = bool(sim_kwargs)  # type: ignore[attr-defined]
    sessions[sid] = s
    latest.append(sid)
    store.create_session(sid, body.mode, pack.id, expert, {"lang": body.lang, "trainee": body.trainee})
    if body.mode == "debrief":
        await s.start_debrief()
    return s.snapshot()


@app.get("/api/sessions")
async def list_sessions() -> list[dict[str, Any]]:
    return [{"id": s.id, "mode": s.mode, "expert": s.expert, "live": True, "metrics": s.metrics()}
            for s in sessions.values()]


@app.get("/api/sessions/{sid}")
async def get_session(sid: str) -> dict[str, Any]:
    return _session(sid).snapshot()


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


_last_summary: dict[str, str] = {}


@app.post("/api/sessions/{sid}/frames")
async def post_frame(sid: str, frame: Frame) -> dict[str, Any]:
    s = _session(sid)
    s.activity.screen_changed()
    if s.off_record or not llm.available():
        return {"skipped": True}
    reading = await perception.read_frame(frame.image, _last_summary.get(sid), frame.media_type)
    _last_summary[sid] = reading.summary
    await s.on_event({"type": "vision", "reading": reading.model_dump()})
    return reading.model_dump()


@app.post("/api/sessions/{sid}/sim/step")
async def sim_step(sid: str) -> dict[str, Any]:
    """Advance a session by one move of simulated Sabine (or the trainee). For rehearsal and offline demos."""
    s = _session(sid)
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


COMPANION_EVENTS = {"intervene", "highlight", "record", "mode", "ask", "learned", "activity", "prediction",
                    "silence", "inquiry", "hypotheses", "episode", "replay", "tutor_ok", "teachback"}


def _companion_view(m: dict[str, Any]) -> dict[str, Any]:
    """Trim heavy payloads (full map, posteriors) before they reach the observed app."""
    t = m["type"]
    if t == "learned":
        added = [c for c in m.get("changes", []) if c.get("kind") == "node_added"]
        return {"type": t, "t": m["t"], "added": added, "quote": m.get("quote"), "metrics": m.get("metrics"),
                "retro": [r for r in m.get("retro", []) if r.get("now_explains")]}
    if t == "hypotheses":
        s = m["set"]
        return {"type": t, "t": m["t"], "field": s["field"], "entropy": s["entropy"], "resolved": m.get("resolved"),
                "top": max(s["items"], key=lambda h: h["posterior"], default=None)}
    if t == "episode":
        return {"type": t, "t": m["t"], "gaps": m["episode"]["gaps"], "metrics": m.get("metrics")}
    return m


# ---------------------------------------------------------------- websockets
@app.websocket("/ws/capture")
async def ws_capture(ws: WebSocket, session: str | None = None) -> None:
    await ws.accept()
    s: Session | None = None
    push = None
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            sid = msg.pop("session", None) or session
            # unpinned observers follow the latest session (e.g. capture -> tutor)
            if not sid and latest and (s is None or s.id != latest[-1]):
                sid = latest[-1]
            if s is None or (sid and s.id != sid):
                try:
                    nxt = _session(sid)
                except HTTPException:
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

    async def chunks():
        if s is None:
            yield "I'm not connected to a session yet."
            return
        async for c in converse.reply(s, messages):
            yield c

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
        async for c in chunks():
            if c:
                yield frame({"content": c})
        yield frame({}, "stop")
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "llm": llm.available(), "sessions": len(sessions), "spend": llm.meter.summary()}


@app.get("/api/config")
async def public_config() -> dict[str, Any]:
    """Non-secret settings the console needs: the ElevenLabs agent ids created by setup_elevenlabs.py."""
    ids_file = config.ROOT / ".elevenlabs_agents.json"
    agents = json.loads(ids_file.read_text()) if ids_file.exists() else {}
    return {"agents": agents, "public_url": config.PUBLIC_URL}


@app.post("/api/llm/check")
async def llm_check() -> dict[str, Any]:
    """Tiny live call per provider, so 'key present' is never mistaken for 'works'."""
    return {"providers": await llm.check(), "spend": llm.meter.summary()}
