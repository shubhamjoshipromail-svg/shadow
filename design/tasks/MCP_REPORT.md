# MCP_REPORT — Work Map as an MCP server

Task: **MCP** in `design/tasks/QUEUE_2026-10-04c.md`.
Status: **done** — `backend/shadow/mcp_server.py` + `backend/tests/test_mcp_server.py`, 18 tests passing, full suite green.
Rules respected: own files only; no edits to `engine.py` / `main.py` / `store.py` / `perception.py` / `capture.js` / `site/**` / `extension/**` / `design/video/**`; no commit or push; nothing bound to `:8000`.

## Files

| File | State |
|---|---|
| `backend/shadow/mcp_server.py` | new — FastAPI `APIRouter` factory + pure tool functions + JSON-RPC 2.0 dispatcher |
| `backend/tests/test_mcp_server.py` | new — 18 tests, all offline (TestClient + hand-built map, no LLM, no network) |
| `design/tasks/MCP_REPORT.md` | this report |

Nothing else was touched. `git status` shows only these as my additions (`mcp_server.py`, `test_mcp_server.py` untracked; other modified files in the tree belong to the concurrent VIS/SUM/TWO/LANG/L jobs).

## What it exposes

A minimal **MCP Streamable HTTP** server (JSON-RPC 2.0 over one `POST` endpoint, plain `application/json` responses). Protocol methods: `initialize` (with protocol-version negotiation and `Mcp-Session-Id`), `notifications/initialized` / any notification → `202` empty, `ping`, `tools/list`, `tools/call`, plus empty `resources/list` / `prompts/list` / `resourceTemplates/list` for clients that probe them. Parse / invalid-request / unknown-method / unknown-tool map to `-32700 / -32600 / -32601 / -32602`. `GET` returns `405` (spec-allowed: no server→client SSE stream needed for this server); `DELETE` returns `204`.

The four tools (all annotated `readOnlyHint: true`):

| Tool | Args | Returns |
|---|---|---|
| `list_steps` | `{workflow?}` | ordered steps with `decision_field`, `decision_field_label`, options, and the rules/guardrails bound to each step (id, title, when, belief status) |
| `list_guardrails` | `{workflow?}` | every guardrail: `type`, `action`, `ask`, `when`, belief, `screen_moment`, and the expert's `quote` (+ `translation`) |
| `check_decision` | `{case_facts, proposed, action, include_inferred?, workflow?}` | `ok`, a spoken-style `message`, `violations[]` (kind, node_id, field, expected, got, title, human `source`, expert `quote`), plus `expert_would` (fields + action + source), `fired_rules`, `triggered_guardrails`, `uncovered` |
| `explain_rule` | `{id, workflow?}` | one rule/guardrail: `when`, `then`/`action`/`ask`, `origin`, `belief`, `evidence`, `quote` + `translation`, `step`, and a ready `explain` sentence |

Belief is first-class: `check_decision` applies only `stated`/`confirmed` judgment by default, so an `inferred` hunch never blocks an agent; pass `"include_inferred": true` to also surface suspicions. `proposed` accepts decision-field names (`cost_center`, `payment_timing`, …) *and* raw booking fields — decision names are run through `pack.booking_from_decision` first.

Pure layer (directly testable, no HTTP): `op_list_steps(wm, pack)`, `op_list_guardrails(wm, pack)`, `op_check_decision(wm, pack, case_facts, proposed, action, *, include_inferred=False)`, `op_explain_rule(wm, pack, rule_id)` — all thin wrappers over `workmap.run_map` / `workmap.check_proposal`. `TOOL_DEFINITIONS` is the literal `tools/list` payload. `NAME = "Shadow"` is the single product-name constant.

Factory contract:

```python
def make_router(get_map: Callable[[str | None], Any], get_pack: Callable[[str | None], Any]) -> APIRouter
```

`get_map` / `get_pack` may take **one optional** `workflow` argument (session id or pack id, so one mount can serve several learned maps); callables with zero arguments also work. `get_map` may return a `WorkMap`, a `Session`, a saved row `{"map": {...}}`, or a raw map dict. Resolution failures surface as `isError: true` tool results, never a 500.

## Acceptance checks

```
$ cd backend && .venv/bin/python -m py_compile shadow/mcp_server.py tests/test_mcp_server.py
py_compile OK

$ cd backend && .venv/bin/python -m pytest tests/test_mcp_server.py -v
...
tests/test_mcp_server.py::test_initialize_negotiates_protocol_and_returns_session PASSED
tests/test_mcp_server.py::test_initialize_falls_back_to_current_protocol PASSED
tests/test_mcp_server.py::test_protocol_version_header_echoes_the_clients_choice PASSED
tests/test_mcp_server.py::test_notification_gets_202_with_no_body PASSED
tests/test_mcp_server.py::test_tools_list_exposes_the_four_read_only_tools PASSED
tests/test_mcp_server.py::test_unknown_method_and_tool_are_protocol_errors PASSED
tests/test_mcp_server.py::test_parse_error_is_a_400 PASSED
tests/test_mcp_server.py::test_get_is_405_and_delete_is_204 PASSED
tests/test_mcp_server.py::test_list_steps_tool_links_rules_and_fields PASSED
tests/test_mcp_server.py::test_list_guardrails_tool_carries_the_expert_words PASSED
tests/test_mcp_server.py::test_check_decision_returns_the_violation_and_quote PASSED
tests/test_mcp_server.py::test_check_decision_guardrail_blocks_a_wrong_action PASSED
tests/test_mcp_server.py::test_check_decision_accepts_the_experts_choice PASSED
tests/test_mcp_server.py::test_explain_rule_and_unknown_id PASSED
tests/test_mcp_server.py::test_unknown_workflow_is_a_tool_error_not_a_crash PASSED
tests/test_mcp_server.py::test_workflow_argument_selects_between_mounted_maps PASSED
tests/test_mcp_server.py::test_router_mounts_with_no_argument_callables_and_dict_maps PASSED
tests/test_mcp_server.py::test_inferred_rules_do_not_block_unless_asked PASSED
18 passed in 0.36s

$ cd backend && .venv/bin/python -m pytest -q
260 passed, 4 xfailed in 5.74s
```

(The full-suite count moves as the concurrent VIS/SUM/TWO/LANG/L jobs add tests; the observed green run above includes their new files, and none of them regressed mine.)

I did **not** bind a live port for a curl demo: `:8001` was already occupied by another harness process (a `BaseHTTP/0.6` server answering `501` to POST), and the queue forbids `:8000`. The wire is proven in-process with FastAPI `TestClient` (an ASGI client, no socket) — the same call Claude's router gets after mounting. Representative transcript:

```
> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"elevenlabs-agent","version":"1"}}}
< 200 {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},
      "serverInfo":{"name":"Shadow","title":"Shadow Work Map","version":"1.0.0"},"instructions":"Load the expert's Work Map before acting: ..."}}

> {"jsonrpc":"2.0","id":2,"method":"tools/list"}
< 200 {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"list_steps","title":"List workflow steps", ...
      {"name":"check_decision", ... "required":["case_facts","action"] ...}, {"name":"explain_rule", ...}]}}

> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"check_decision","arguments":{
      "case_facts": <inv-5120>, "proposed":{"cost_center":"0400"}, "action":"post"}}}
< 200 {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{ \"ok\": false,
      \"message\": \"The expert's map objects: action: hold (not post) — Sabine: “Kein Asset, keine Capex-Buchung.”\",
      \"violations\": [{ \"kind\": \"guardrail\", \"node_id\": \"G1\", \"expected\": \"hold\", \"got\": \"post\", ...}]}"}],
      "structuredContent": {...}, "isError": false}}
```

## Exact integration call sites for Claude (`backend/shadow/main.py`)

`WorkMap` and `get_pack` are already imported (lines 35–37); `sessions`, `latest`, `store`, `config` already exist.

**1. Import (add to the block at lines 27–33):**

```python
from shadow import mcp_server
```

**2. Mount the router — insert immediately after the CORS middleware, i.e. after line 68:**

```python
def _mcp_map(workflow: str | None = None):
    """`workflow` may be a live session id or a pack id; without it, follow the latest live session."""
    if workflow in sessions:
        return sessions[workflow].wm
    pid = workflow or (sessions[latest[-1]].pack.id if latest else config.DEFAULT_PACK)
    row = store.latest_map_any(pid)
    if not row:
        raise KeyError(f"no learned Work Map for '{pid}' yet")
    return WorkMap(**row["map"])


def _mcp_pack(workflow: str | None = None):
    if workflow in sessions:
        return sessions[workflow].pack
    return get_pack(workflow or config.DEFAULT_PACK)


app.include_router(mcp_server.make_router(_mcp_map, _mcp_pack), prefix="/mcp")
```

This yields `POST /mcp` (verified: an empty route path plus `prefix="/mcp"` produces exactly `/mcp`, no trailing-slash redirect). `latest` is the same unpinned-observer pointer the rest of the app uses, so an MCP client without a `workflow` arg reads whatever map the live observers are currently on — and with a pack id it reads the last saved map from the store, so it works after restart. No lifespan/ticker change needed.

**Optional hardening** (only if `/mcp` is public and the map is sensitive): the tools are read-only but reveal learned rules, thresholds and quotes. Add a tiny dependency in `make_router` or in main.py that checks `Authorization: Bearer ${MCP_TOKEN}` before dispatch, and pass the token to ElevenLabs as `secret_token`. Not implemented — flagging the decision for Claude.

## ElevenLabs agent tool config

MCP is a workspace-level opt-in (`can_use_mcp_servers=True` on the workspace) and the server URL must be **https and public** — `localhost`/ngrok-less dev will not be reachable.

- **Server URL:** `${SHADOW_PUBLIC_URL}/mcp`, i.e. `https://core-production-c5ac.up.railway.app/mcp`
- **Transport:** `STREAMABLE_HTTP` (the API enum; ElevenLabs supports SSE and Streamable HTTP)
- **Tool names the agent will see:** `list_steps`, `list_guardrails`, `check_decision`, `explain_rule`
- **Approval policy:** `auto_approve_all` is fine — all four are read-only (`readOnlyHint: true`)

Create the server, then attach it to the agent (`conversation_config.agent.prompt.mcp_server_ids`):

```python
# POST https://api.elevenlabs.io/v1/convai/mcp-servers
server = elevenlabs.conversational_ai.mcp_servers.create(
    config={
        "url": "https://core-production-c5ac.up.railway.app/mcp",
        "name": "Shadow Work Map",
        "description": "The expert's learned Work Map: steps, guardrails and a check_decision tool that "
                       "returns the expert's objections in their own words.",
        "transport": "STREAMABLE_HTTP",
        "approval_policy": "auto_approve_all",
        "pre_tool_speech": "off",          # tool reads should not make the agent talk
        "response_timeout_secs": 15,
    },
)

elevenlabs.conversational_ai.agents.update(
    agent_id=...,
    conversation_config={"agent": {"prompt": {"mcp_server_ids": [server.id]}}},
)
```

For a scripted version, the same two calls belong in `backend/scripts/setup_elevenlabs.py` (Claude owns it): after creating/updating each agent, `mcp_servers.create(...)` once, then include `mcp_server_ids` in the agent payload — note the current payload has no tool/MCP block, and ElevenLabs exposes MCP servers only via dashboard or SDK/API, not the CLI.

Sources: [Model Context Protocol (ElevenLabs docs)](https://elevenlabs.io/docs/eleven-agents/customization/tools/mcp) and [Create MCP server (API reference)](https://elevenlabs.io/docs/api-reference/mcp/create).

## Notes / known limits

- `GET /mcp` is `405` by design (no SSE stream). Streamable-HTTP clients may probe it once and continue; the body is served on POST. If a client refuses to proceed without SSE, the 20-line fix is a `StreamingResponse` keep-alive on GET — say so and I'll add it.
- No auth on the router itself (client tools are read-only; see optional hardening above).
- `check_decision` needs the **full case object** the pack sees (`pack.derive(case)` must work), not a case id. The case shape in a docs example is `inv-5120` from `PACK.demo_cases()`.
- `explain_rule` returns `isError: true` for an unknown id rather than a protocol error, so an agent gets a readable answer.
- `workflow` is an optional per-call selector; omit it for the "current" map.
