"""MCP server: the Work Map as agent-facing tools over JSON-RPC Streamable HTTP.

Everything here runs offline against a hand-built map — no LLM, no network.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from shadow import mcp_server
from shadow.packs import get_pack
from shadow.workmap import Guardrail, Quote, Rule, Step, WorkMap

PACK = get_pack("ap_invoices")
CASES = {c["id"]: c for c in sum(PACK.demo_cases().values(), [])}


# ------------------------------------------------------------------ fixtures
def _map() -> WorkMap:
    wm = WorkMap(pack_id="ap_invoices", task="process_supplier_invoice", expert="Sabine",
                 params={"T_capex": 5000})
    wm.steps = [
        Step(id="S1", order=1, name="Open and check the invoice"),
        Step(id="S2", order=2, name="Compare with purchase order"),
        Step(id="S3", order=3, name="Code the cost center", decision_field="cost_center", rule_ids=["R1"]),
        Step(id="S6", order=6, name="Post, hold or route", decision_field="action",
             rule_ids=["D1"], guardrail_ids=["G1"]),
    ]
    wm.rules = [
        Rule(id="D1", step_id="S6", title="Doc: post when checked", when="True", then={"action": "post"},
             origin="doc"),
        Rule(id="R1", step_id="S3", title="Equipment over threshold is capex",
             when="inv.category == 'equipment' and inv.net_eur > params.T_capex",
             then={"cost_center": "0400"},
             quote=Quote(text="Über fünftausend ist immer Capex.", speaker="Sabine", lang="de",
                         translation="Over five thousand is always capex.")),
    ]
    wm.guardrails = [
        Guardrail(id="G1", step_id="S6", title="No asset number, no capex booking", type="hard_limit",
                  when="booking.cost_center in ['0400', '0410'] and not inv.asset_number_available",
                  action="hold", quote=Quote(text="Kein Asset, keine Capex-Buchung.", speaker="Sabine", lang="de",
                                             translation="No asset number, no capex booking.")),
    ]
    for n in [*wm.rules, *wm.guardrails]:
        n.refresh_belief()
    return wm


def _client(with_workflow_arg: bool = True) -> TestClient:
    wm = _map()
    app = FastAPI()
    if with_workflow_arg:
        app.include_router(mcp_server.make_router(lambda workflow=None: wm, lambda workflow=None: PACK),
                           prefix="/mcp")
    else:
        app.include_router(mcp_server.make_router(lambda: wm, lambda: PACK), prefix="/mcp")
    return TestClient(app)


def _rpc(client: TestClient, method: str, params: dict | None = None, rid: int = 1, **kw):
    body: dict = {"jsonrpc": "2.0", "id": rid, "method": method}
    if params is not None:
        body["params"] = params
    return client.post("/mcp", json=body, **kw)


def _call(client: TestClient, name: str, arguments: dict | None = None):
    return _rpc(client, "tools/call", {"name": name, "arguments": arguments or {}})


# ------------------------------------------------------------------- wire
def test_initialize_negotiates_protocol_and_returns_session():
    client = _client()
    r = _rpc(client, "initialize", {"protocolVersion": "2025-03-26", "clientInfo": {"name": "t", "version": "1"}})
    assert r.status_code == 200
    body = r.json()
    assert body["jsonrpc"] == "2.0" and body["id"] == 1
    assert body["result"]["protocolVersion"] == "2025-03-26"
    assert body["result"]["capabilities"]["tools"] == {"listChanged": False}
    assert body["result"]["serverInfo"]["name"] == mcp_server.NAME
    assert r.headers["mcp-session-id"]
    assert r.headers["MCP-Protocol-Version"] == mcp_server.PROTOCOL_VERSION


def test_initialize_falls_back_to_current_protocol():
    client = _client()
    r = _rpc(client, "initialize", {"protocolVersion": "1999-01-01"})
    assert r.json()["result"]["protocolVersion"] == mcp_server.PROTOCOL_VERSION


def test_protocol_version_header_echoes_the_clients_choice():
    client = _client()
    r = _rpc(client, "tools/list", headers={"MCP-Protocol-Version": "2025-03-26"})
    assert r.headers["MCP-Protocol-Version"] == "2025-03-26"
    assert _rpc(client, "tools/list").headers["MCP-Protocol-Version"] == mcp_server.PROTOCOL_VERSION


def test_notification_gets_202_with_no_body():
    client = _client()
    r = client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert r.status_code == 202 and r.content == b""


def test_tools_list_exposes_the_four_read_only_tools():
    client = _client()
    tools = _rpc(client, "tools/list").json()["result"]["tools"]
    assert {t["name"] for t in tools} == {"list_steps", "list_guardrails", "check_decision", "explain_rule"}
    for t in tools:
        assert t["inputSchema"]["type"] == "object"
        assert t["annotations"]["readOnlyHint"] is True
    check = next(t for t in tools if t["name"] == "check_decision")
    assert set(check["inputSchema"]["required"]) == {"case_facts", "action"}


def test_unknown_method_and_tool_are_protocol_errors():
    client = _client()
    assert _rpc(client, "does/not/exist").json()["error"]["code"] == mcp_server.METHOD_NOT_FOUND
    assert _call(client, "nope").json()["error"]["code"] == mcp_server.INVALID_PARAMS
    missing = _call(client, "check_decision", {"case_facts": {}}).json()
    assert missing["error"]["code"] == mcp_server.INVALID_PARAMS and "action" in missing["error"]["message"]


def test_parse_error_is_a_400():
    client = _client()
    r = client.post("/mcp", content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 400 and r.json()["error"]["code"] == mcp_server.PARSE_ERROR


def test_get_is_405_and_delete_is_204():
    client = _client()
    r = client.get("/mcp")
    assert r.status_code == 405 and "POST" in r.headers["allow"]
    assert client.delete("/mcp").status_code == 204


# ------------------------------------------------------------------- tools
def test_list_steps_tool_links_rules_and_fields():
    client = _client()
    out = _call(client, "list_steps").json()["result"]
    assert out["isError"] is False
    data = out["structuredContent"]
    assert data["workflow"] == "ap_invoices" and data["expert"] == "Sabine"
    step = next(s for s in data["steps"] if s["id"] == "S3")
    assert step["decision_field"] == "cost_center" and step["decision_field_label"] == "Cost center"
    assert [r["id"] for r in step["rules"]] == ["R1"]
    assert data["actions"][0] == "post"
    s6 = next(s for s in data["steps"] if s["id"] == "S6")
    assert [g["id"] for g in s6["guardrails"]] == ["G1"]


def test_list_guardrails_tool_carries_the_expert_words():
    client = _client()
    data = _call(client, "list_guardrails").json()["result"]["structuredContent"]
    g = data["guardrails"][0]
    assert g["id"] == "G1" and g["action"] == "hold" and g["type"] == "hard_limit"
    assert g["quote"]["text"] == "Kein Asset, keine Capex-Buchung."
    assert g["quote"]["translation"] == "No asset number, no capex booking."
    assert g["status"] == "stated"


def test_check_decision_returns_the_violation_and_quote():
    client = _client()
    out = _call(client, "check_decision", {
        "case_facts": CASES["inv-5120"], "proposed": {"cost_center": "4711"}, "action": "post",
    }).json()["result"]
    assert out["isError"] is False
    data = out["structuredContent"]
    assert data["ok"] is False
    v = data["violations"][0]
    assert v["kind"] == "rule" and v["node_id"] == "R1" and v["field"] == "cost_center"
    assert v["expected"] == "0400" and v["got"] == "4711"
    assert v["quote"]["text"] == "Über fünftausend ist immer Capex."
    assert data["expert_would"]["fields"]["cost_center"]["value"] == "0400"
    assert "Sabine" in data["message"]


def test_check_decision_guardrail_blocks_a_wrong_action():
    client = _client()
    data = _call(client, "check_decision", {
        "case_facts": CASES["inv-5120"], "proposed": {"cost_center": "0400"}, "action": "post",
    }).json()["result"]["structuredContent"]
    assert [v["node_id"] for v in data["violations"]] == ["G1"]
    assert data["violations"][0]["kind"] == "guardrail" and data["violations"][0]["expected"] == "hold"


def test_check_decision_accepts_the_experts_choice():
    client = _client()
    data = _call(client, "check_decision", {
        "case_facts": CASES["inv-5120"], "proposed": {"cost_center": "0400"}, "action": "hold",
    }).json()["result"]["structuredContent"]
    assert data["ok"] is True and data["violations"] == []
    assert "would not object" in data["message"]


def test_explain_rule_and_unknown_id():
    client = _client()
    out = _call(client, "explain_rule", {"id": "R1"}).json()["result"]
    rule = out["structuredContent"]
    assert rule["kind"] == "rule" and rule["when"].startswith("inv.category")
    assert rule["then"] == {"cost_center": "0400"}
    assert rule["translation"] == "Over five thousand is always capex."
    assert rule["step"]["id"] == "S3" and "Sabine" in rule["explain"]
    bad = _call(client, "explain_rule", {"id": "R99"}).json()["result"]
    assert bad["isError"] is True and "R99" in bad["content"][0]["text"] and "structuredContent" not in bad


def test_unknown_workflow_is_a_tool_error_not_a_crash():
    def get_map(workflow=None):
        raise KeyError(workflow)

    app = FastAPI()
    app.include_router(mcp_server.make_router(get_map, lambda workflow=None: PACK), prefix="/mcp")
    out = _call(TestClient(app), "list_steps").json()["result"]
    assert out["isError"] is True


def test_workflow_argument_selects_between_mounted_maps():
    a, b = _map(), _map().model_copy(deep=True)
    b.task = "process_credit_note"
    app = FastAPI()
    app.include_router(mcp_server.make_router(lambda workflow=None: b if workflow == "b" else a,
                                              lambda workflow=None: PACK), prefix="/mcp")
    client = TestClient(app)
    assert _call(client, "list_steps", {"workflow": "a"}).json()["result"]["structuredContent"]["task"] \
        == "process_supplier_invoice"
    assert _call(client, "list_steps", {"workflow": "b"}).json()["result"]["structuredContent"]["task"] \
        == "process_credit_note"


def test_router_mounts_with_no_argument_callables_and_dict_maps():
    wm = _map()
    app = FastAPI()
    app.include_router(mcp_server.make_router(lambda: {"map": wm.model_dump(mode="json")}, lambda: PACK),
                       prefix="/mcp")
    data = _call(TestClient(app), "list_guardrails").json()["result"]["structuredContent"]
    assert data["guardrails"][0]["id"] == "G1"


# ------------------------------------------------------------- pure layer
def test_inferred_rules_do_not_block_unless_asked():
    wm = _map()
    hunch = wm.rules[1].model_copy(deep=True)
    hunch.quote = None
    hunch.refresh_belief()
    wm.rules = [wm.rules[0], hunch]
    case = CASES["inv-5120"]
    assert mcp_server.op_check_decision(wm, PACK, case, {"cost_center": "4711"}, "post")["ok"] is True
    strict = mcp_server.op_check_decision(wm, PACK, case, {"cost_center": "4711"}, "post",
                                          include_inferred=True)
    assert strict["ok"] is False and strict["violations"][0]["node_id"] == "R1"
