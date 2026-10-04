"""The Work Map as an MCP server — the expert's judgment, loadable by any agent.

Shadow already runs a human through the same map the tutor uses. An MCP client
(ElevenLabs agent, Claude, Cursor, an automation) should be able to load that
judgment the same way: ask for the steps and guardrails, then ask "would the
expert object to this decision?" before it books anything.

Transport is MCP **Streamable HTTP**: one endpoint, JSON-RPC 2.0, plain
``application/json`` responses (SSE is optional and not needed here), methods
``initialize`` / ``tools/list`` / ``tools/call``. No external MCP library: the
wire format is small and stable, and stdlib + FastAPI is already a dependency.

Everything except :func:`make_router` is pure and works on a ``WorkMap`` plus a
pack; the tools are thin wrappers over :func:`shadow.workmap.run_map` and
:func:`shadow.workmap.check_proposal`, so an agent sees exactly what the tutor
sees — including belief status (an ``inferred`` hunch never blocks an agent
unless it asks for that) and the expert's own words as the quote.
"""

from __future__ import annotations

import inspect
import json
import uuid
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from shadow.packs import get_pack as _registry_get_pack
from shadow.packs.base import Pack
from shadow.workmap import ACTIVE, TRUSTED, Guardrail, Rule, WorkMap, check_proposal, run_map

NAME = "Shadow"  # the product name lives here and nowhere else
SERVER_VERSION = "1.0.0"
PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")

# JSON-RPC 2.0 error codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

_READ_ONLY = {"readOnlyHint": True, "destructiveHint": False, "openWorldHint": False, "idempotentHint": True}


class ToolError(Exception):
    """A tool ran but could not answer (bad map, unknown id). Reported as isError, not a crash."""


# ------------------------------------------------------------------ helpers
def _quote(q: Any) -> dict[str, Any] | None:
    if q is None:
        return None
    return {"text": q.text, "speaker": q.speaker, "lang": q.lang, "translation": q.translation, "ts": q.ts}


def _node_sentence(node: Rule | Guardrail) -> str:
    if isinstance(node, Guardrail):
        how = f"{node.type.replace('_', ' ')} → {node.action}" + (f" ({node.ask})" if node.ask else "")
    else:
        how = ", ".join(f"{k} = {v}" for k, v in node.then.items()) or "no outcome"
    quote = f" {node.quote.speaker}: “{node.quote.text}”" if node.quote else ""
    return f"When {node.when}, {how}.{quote}"


def _is_guardrail(node: Rule | Guardrail) -> bool:
    return isinstance(node, Guardrail)


# ------------------------------------------------------------- pure tools
def op_list_steps(wm: WorkMap, pack: Pack) -> dict[str, Any]:
    """The workflow as ordered steps, each linked to the rules/guardrails that decide it."""
    by_field = {f.name: f for f in getattr(pack, "decision_fields", [])}

    def _rule_ref(n: Rule | Guardrail) -> dict[str, Any]:
        return {"id": n.id, "title": n.title, "when": n.when, "status": n.belief.status, "p": n.belief.p}

    steps = []
    for s in sorted(wm.steps, key=lambda x: x.order):
        spec = by_field.get(s.decision_field) if s.decision_field else None
        linked_rules = {r.id for r in wm.rules if r.step_id == s.id or r.id in s.rule_ids}
        linked_guards = {g.id for g in wm.guardrails if g.step_id == s.id or g.id in s.guardrail_ids}
        steps.append({
            "id": s.id,
            "order": s.order,
            "name": s.name,
            "description": s.description,
            "decision_field": s.decision_field,
            "decision_field_label": spec.label if spec else None,
            "options": list(spec.options) if spec and spec.options else None,
            "discretion": s.discretion,
            "no_guardrail": s.no_guardrail,
            "rules": [_rule_ref(r) for r in wm.rules if r.id in linked_rules],
            "guardrails": [_rule_ref(g) for g in wm.guardrails if g.id in linked_guards],
        })
    return {
        "workflow": wm.pack_id,
        "task": wm.task,
        "expert": wm.expert,
        "map_version": wm.version,
        "actions": list(getattr(pack, "actions", [])),
        "action_precedence": list(getattr(pack, "action_precedence", [])),
        "steps": steps,
    }


def op_list_guardrails(wm: WorkMap, pack: Pack) -> dict[str, Any]:
    """Every guardrail the expert's map holds, with its trigger, action and quote."""
    out = []
    for g in wm.guardrails:
        out.append({
            "id": g.id,
            "title": g.title,
            "type": g.type,
            "action": g.action,
            "ask": g.ask,
            "when": g.when,
            "step_id": g.step_id,
            "status": g.belief.status,
            "p": g.belief.p,
            "quote": _quote(g.quote),
            "screen_moment": g.screen_moment.model_dump() if g.screen_moment else None,
        })
    return {"workflow": wm.pack_id, "expert": wm.expert, "guardrails": out}


def _as_booking(pack: Pack, case: dict[str, Any], proposed: dict[str, Any]) -> dict[str, Any]:
    """Accept decision-field names (cost_center, payment_timing…) as well as raw booking fields."""
    booking = dict(proposed or {})
    names = {f.name for f in getattr(pack, "decision_fields", [])}
    decision_vals = {k: v for k, v in proposed.items() if k in names}
    if decision_vals and hasattr(pack, "booking_from_decision"):
        try:
            booking.update(pack.booking_from_decision(case, decision_vals))
        except Exception:  # noqa: BLE001 - a pack may not map every field; keep the raw form
            pass
    return booking


def op_check_decision(wm: WorkMap, pack: Pack, case_facts: dict[str, Any], proposed: dict[str, Any],
                      action: str, *, include_inferred: bool = False) -> dict[str, Any]:
    """Would the expert object to this proposal? Returns violations, each with the expert's quote."""
    if not isinstance(case_facts, dict):
        raise ToolError("case_facts must be the case object (the facts the engine sees), not a string.")
    statuses = ACTIVE if include_inferred else TRUSTED
    booking = _as_booking(pack, case_facts, proposed or {})
    violations = check_proposal(wm, pack, case_facts, booking, action, statuses=statuses)
    pred = run_map(wm, pack, case_facts, statuses)

    payload = []
    lines = []
    for v in violations:
        node = wm.node(v.node_id)
        speaker = v.quote.speaker if v.quote else "expert"
        if v.quote:
            lines.append(f"{v.field}: {v.expected} (not {v.got}) — {speaker}: “{v.quote.text}”")
        else:
            lines.append(f"{v.field}: {v.expected} (not {v.got}) — {v.title}")
        payload.append({
            "kind": v.kind,
            "node_id": v.node_id,
            "field": v.field,
            "expected": v.expected,
            "got": v.got,
            "title": v.title,
            "source": _node_sentence(node) if node else None,
            "quote": _quote(v.quote),
            "screen_moment": v.screen_moment.model_dump() if v.screen_moment else None,
        })

    action_pred = pred.action.value if pred.action else None
    return {
        "ok": not violations,
        "message": ("The expert's map would not object to this decision."
                    if not violations else "The expert's map objects: " + "; ".join(lines)),
        "violations": payload,
        "expert_would": {
            "fields": {k: {"value": fp.value, "source": fp.source, "p": fp.p} for k, fp in pred.fields.items()},
            "action": action_pred,
            "action_source": pred.action.source if pred.action else None,
        },
        "fired_rules": pred.fired_rules,
        "triggered_guardrails": pred.triggered_guardrails,
        "uncovered": pred.uncovered,
    }


def op_explain_rule(wm: WorkMap, pack: Pack, rule_id: str) -> dict[str, Any]:
    """One rule or guardrail: its condition, outcome, belief and the expert's exact words."""
    node = wm.node(rule_id)
    if node is None:
        raise ToolError(f"No rule or guardrail '{rule_id}' in this Work Map.")
    step = next((s for s in wm.steps
                 if s.id == node.step_id or node.id in s.rule_ids or node.id in s.guardrail_ids), None)
    return {
        "found": True,
        "id": node.id,
        "kind": "guardrail" if _is_guardrail(node) else "rule",
        "title": node.title,
        "when": node.when,
        "then": node.then if isinstance(node, Rule) else None,
        "guardrail_type": node.type if isinstance(node, Guardrail) else None,
        "action": node.action if isinstance(node, Guardrail) else None,
        "ask": node.ask if isinstance(node, Guardrail) else None,
        "origin": node.origin,
        "belief": {"status": node.belief.status, "p": node.belief.p},
        "evidence": [e.model_dump() for e in node.evidence],
        "quote": _quote(node.quote),
        "translation": node.quote.translation if node.quote else None,
        "screen_moment": node.screen_moment.model_dump() if node.screen_moment else None,
        "step": {"id": step.id, "name": step.name} if step else None,
        "explain": _node_sentence(node),
    }


# --------------------------------------------------------------- MCP tools
_CASE_FACTS = {
    "type": "object",
    "description": "The case exactly as the workflow engine sees it (the pack's case object: ids, amounts, "
                   "supplier/PO facts, etc.). Pass the whole object, not a case id.",
    "additionalProperties": True,
}
_PROPOSED = {
    "type": "object",
    "description": "Proposed decision values: decision-field names (e.g. cost_center, tax_code, payment_timing) "
                   "and/or raw booking fields. Values are compared against the expert's map.",
    "additionalProperties": True,
}
_WORKFLOW = {"type": "string", "description": "Optional workflow/session id when several maps are mounted."}

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "list_steps",
        "title": "List workflow steps",
        "description": "The expert's Work Map as ordered steps, each with its decision field, options and the "
                       "rules/guardrails that decide it.",
        "inputSchema": {"type": "object", "properties": {"workflow": _WORKFLOW},
                        "required": [], "additionalProperties": False},
        "annotations": _READ_ONLY,
    },
    {
        "name": "list_guardrails",
        "title": "List guardrails",
        "description": "Every guardrail the expert's map holds: trigger condition, the action it forces "
                       "(hold / stop_and_ask / second_approval / hard_limit / block), belief status and the "
                       "expert's quote.",
        "inputSchema": {"type": "object", "properties": {"workflow": _WORKFLOW},
                        "required": [], "additionalProperties": False},
        "annotations": _READ_ONLY,
    },
    {
        "name": "check_decision",
        "title": "Check a decision against the expert",
        "description": "Before acting: give the case facts, the values you propose and the action you intend; "
                       "get back the expert's objections, each with the quote it comes from, plus what the map "
                       "would have decided.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "case_facts": _CASE_FACTS,
                "proposed": _PROPOSED,
                "action": {"type": "string", "description": "The action you intend, from the workflow's actions."},
                "include_inferred": {
                    "type": "boolean",
                    "description": "Also apply rules the map only suspects (status 'inferred'). Default false: "
                                   "only stated/confirmed judgment is allowed to block.",
                },
                "workflow": _WORKFLOW,
            },
            "required": ["case_facts", "action"],
            "additionalProperties": False,
        },
        "annotations": _READ_ONLY,
    },
    {
        "name": "explain_rule",
        "title": "Explain a rule or guardrail",
        "description": "The full text of one rule/guardrail: condition, outcome, the expert's quote (with "
                       "English translation when the expert spoke another language) and how confident the map is.",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string", "description": "Rule or guardrail id (e.g. 'R3', 'G1')."},
                           "workflow": _WORKFLOW},
            "required": ["id"],
            "additionalProperties": False,
        },
        "annotations": _READ_ONLY,
    },
]

# Added after the original four, which are unchanged: may an agent act alone on this case?
TOOL_DEFINITIONS.append({
    "name": "get_permissions",
    "title": "May I act on this case?",
    "description": "Before acting: give the case facts. Returns the permission an agent has earned from the expert's "
                   "sealed exam for the rule(s) that decide this case: act (alone), suggest (a human confirms) or "
                   "stop (ask a human), with the rule, the reason and the expert's own words. Optionally pass the "
                   "decision you intend to also get the expert's objections.",
    "inputSchema": {
        "type": "object",
        "properties": {"case_facts": _CASE_FACTS,
                       "proposed": _PROPOSED,
                       "action": {"type": "string", "description": "Optional: the action you intend."},
                       "workflow": _WORKFLOW},
        "required": ["case_facts"],
        "additionalProperties": False,
    },
    "annotations": _READ_ONLY,
})

_REQUIRED_ARGS = {"list_steps": (), "list_guardrails": (), "check_decision": ("case_facts", "action"),
                  "explain_rule": ("id",), "get_permissions": ("case_facts",)}


# ------------------------------------------------------------ JSON-RPC wire
def _ok(rid: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def _error(rid: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": rid, "error": err}


def _tool_ok(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}],
        "structuredContent": result,
        "isError": False,
    }


def _tool_error(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def _accepts_workflow(fn: Callable[..., Any]) -> bool:
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False
    if any(p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD) for p in params.values()):
        return True
    return any(p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY) for p in params.values())


def _coerce_map(value: Any) -> WorkMap:
    if isinstance(value, WorkMap):
        return value
    if hasattr(value, "wm"):
        return _coerce_map(value.wm)
    if isinstance(value, dict):
        if isinstance(value.get("map"), dict):
            return _coerce_map(value["map"])
        return WorkMap(**value)
    raise ToolError("No Work Map is available for this workflow yet.")


def _coerce_pack(value: Any) -> Pack:
    if value is None:
        raise ToolError("No workflow pack is available for this workflow.")
    if isinstance(value, str):
        try:
            return _registry_get_pack(value)
        except KeyError as e:
            raise ToolError(f"Unknown workflow pack '{value}'.") from e
    return value


def _call_source(fn: Callable[..., Any], workflow: str | None) -> Any:
    return fn(workflow) if _accepts_workflow(fn) else fn()


def op_get_permissions(wm: WorkMap, pack: Pack, cert: dict[str, Any] | None, case_facts: dict[str, Any],
                       proposed: dict[str, Any], action: str | None) -> dict[str, Any]:
    from shadow import certify  # late: certify imports this module
    if not isinstance(case_facts, dict):
        raise ToolError("case_facts must be the case object (the facts the engine sees), not a string.")
    if cert is None:
        return {"permission": "stop", "certification": None, "rules": [],
                "message": "No agent has been certified on this map yet, so stop and ask a human."}
    out = certify.permissions_for(cert, wm, pack, case_facts)
    if action or proposed:
        chk = op_check_decision(wm, pack, case_facts, proposed or {}, action or "post")
        out["objections"] = chk["violations"]
        if not chk["ok"]:
            out["permission"] = "stop"
    worst = min(out["rules"], key=lambda r: certify.RANK[r["level"]], default=None)
    words = {"act": "You may act on this alone.", "suggest": "Propose it, and let a human confirm.",
             "stop": "Stop and ask a human."}[out["permission"]]
    held = [f"{r['id']} requires '{r['requires_action']}'" for r in out["rules"] if r.get("requires_action")]
    out["message"] = (words + (f" Guardrail: {'; '.join(held)}." if held else "")
                      + (f" Weakest rule: {worst['id']}: {worst['reason']}" if worst else ""))
    return out


def handle_rpc(body: Any, resolve: Callable[[str | None], tuple[WorkMap, Pack]],
               perms: Callable[[str | None], dict[str, Any] | None] | None = None) -> tuple[Any | None, str | None]:
    """One JSON-RPC message (or batch) → ``(response_or_None, session_id_or_None)``.

    ``None`` as the response means "notification": the HTTP layer answers 202.
    """
    if isinstance(body, list):
        if not body:
            return _error(None, INVALID_REQUEST, "Invalid Request"), None
        out: list[dict[str, Any]] = []
        sid: str | None = None
        for item in body:
            resp, s = handle_rpc(item, resolve, perms)
            sid = s or sid
            if resp is not None:
                out.append(resp)
        return (out or None), sid
    if not isinstance(body, dict):
        return _error(None, INVALID_REQUEST, "Invalid Request"), None

    rid = body.get("id")
    method = body.get("method")
    params = body.get("params") or {}
    is_notification = "id" not in body

    if not isinstance(method, str) or not isinstance(params, dict):
        return _error(rid, INVALID_REQUEST, "Invalid Request"), None
    if is_notification:
        return None, None  # notifications/initialized, notifications/cancelled, …: no reply, ever

    if method == "initialize":
        requested = params.get("protocolVersion")
        version = requested if requested in SUPPORTED_PROTOCOLS else PROTOCOL_VERSION
        return _ok(rid, {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": NAME, "title": f"{NAME} Work Map", "version": SERVER_VERSION},
            "instructions": ("Load the expert's Work Map before acting: list_steps and list_guardrails show the "
                             "judgment; check_decision(case_facts, proposed, action) returns the expert's "
                             "objections with their own words; explain_rule(id) gives the full rule."),
        }), uuid.uuid4().hex
    if method == "ping":
        return _ok(rid, {}), None
    if method == "tools/list":
        return _ok(rid, {"tools": TOOL_DEFINITIONS}), None
    if method in ("resources/list", "resourceTemplates/list"):
        return _ok(rid, {"resources": []} if method == "resources/list" else {"resourceTemplates": []}), None
    if method == "prompts/list":
        return _ok(rid, {"prompts": []}), None
    if method != "tools/call":
        return _error(rid, METHOD_NOT_FOUND, f"Method not found: {method}"), None

    name = params.get("name")
    args = params.get("arguments") or {}
    if name not in _REQUIRED_ARGS:
        return _error(rid, INVALID_PARAMS, f"Unknown tool: {name}"), None
    if not isinstance(args, dict):
        return _error(rid, INVALID_PARAMS, "Tool arguments must be an object."), None
    missing = [k for k in _REQUIRED_ARGS[name] if k not in args]
    if missing:
        return _error(rid, INVALID_PARAMS, "Missing required argument(s): " + ", ".join(missing)), None

    try:
        wm, pack = resolve(args.get("workflow"))
        wm, pack = _coerce_map(wm), _coerce_pack(pack)
        if name == "list_steps":
            result = op_list_steps(wm, pack)
        elif name == "list_guardrails":
            result = op_list_guardrails(wm, pack)
        elif name == "get_permissions":
            result = op_get_permissions(wm, pack, perms(args.get("workflow")) if perms else None,
                                        args["case_facts"], args.get("proposed") or {}, args.get("action"))
        elif name == "check_decision":
            result = op_check_decision(wm, pack, args["case_facts"], args.get("proposed") or {}, args["action"],
                                       include_inferred=bool(args.get("include_inferred")))
        else:
            result = op_explain_rule(wm, pack, args["id"])
    except ToolError as e:
        return _ok(rid, _tool_error(str(e))), None
    except Exception as e:  # noqa: BLE001 - a bad map/case must not kill the agent's run
        return _ok(rid, _tool_error(f"{type(e).__name__}: {e}")), None
    return _ok(rid, _tool_ok(result)), None


# --------------------------------------------------------------- FastAPI
def make_router(get_map: Callable[[str | None], Any], get_pack: Callable[[str | None], Any],
                get_cert: Callable[[str | None], dict[str, Any] | None] | None = None) -> APIRouter:
    """Mount the Work Map as an MCP Streamable HTTP server.

    ``get_map()`` / ``get_pack()`` return the Work Map and pack to expose. They may
    take one optional ``workflow`` argument (a pack/session id) so a single mount can
    serve several learned maps; without it they follow the current/latest one.
    """
    router = APIRouter()

    def resolve(workflow: str | None) -> tuple[Any, Any]:
        return _call_source(get_map, workflow), _call_source(get_pack, workflow)

    @router.post("")
    async def mcp_post(request: Request) -> Response:
        raw = await request.body()
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return JSONResponse(_error(None, PARSE_ERROR, "Parse error"), status_code=400)
        response, sid = handle_rpc(body, resolve, get_cert)
        requested = request.headers.get("mcp-protocol-version")
        headers = {"MCP-Protocol-Version": requested if requested in SUPPORTED_PROTOCOLS else PROTOCOL_VERSION,
                   "Cache-Control": "no-store"}
        if sid:
            headers["Mcp-Session-Id"] = sid
        if response is None:
            return Response(status_code=202, headers=headers)
        return JSONResponse(response, headers=headers)

    @router.get("")
    async def mcp_get() -> Response:
        # No server→client SSE stream: the spec allows 405 here. All traffic is POST.
        return Response(status_code=405, headers={"Allow": "POST, DELETE"})

    @router.delete("")
    async def mcp_delete() -> Response:
        return Response(status_code=204)

    return router
