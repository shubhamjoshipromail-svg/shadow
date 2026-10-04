"""Create or update Shadow's two ElevenLabs agents (Interviewer, Tutor).

Both use a Custom LLM pointing at Shadow Core, so Shadow decides what they say.

Docs used:
  create  POST  https://api.elevenlabs.io/v1/convai/agents/create   (elevenlabs.io/docs/api-reference/agents/create)
  update  PATCH https://api.elevenlabs.io/v1/convai/agents/{agent_id}
  custom LLM: elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm
  overrides:  elevenlabs.io/docs/agents-platform/customization/personalization/overrides

Usage:
  .venv/bin/python scripts/setup_elevenlabs.py --dry-run
  .venv/bin/python scripts/setup_elevenlabs.py                 # create, or update ids in .elevenlabs_agents.json
  .venv/bin/python scripts/setup_elevenlabs.py --public-url https://xyz.trycloudflare.com
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
IDS_FILE = ROOT / ".elevenlabs_agents.json"
API = "https://api.elevenlabs.io/v1/convai/agents"
# Jessica: young, bright, warm, conversational — matches the intern companion
VOICE_ID = os.getenv("SHADOW_VOICE_ID", "cgSgspJ2msm6clMCkdW9")

PROMPT = (
    "You are Mira, the quiet, curious apprentice inside Tacet. SHADOW_SESSION={{shadow_session}} MODE={{shadow_mode}}\n"
    "Keep every reply to one or two short sentences. Never lecture."
)

AGENTS = {
    "interviewer": dict(
        name="Tacet – Interviewer",
        first_message="Hi, I'm Mira. Just work as you normally would. I'll stay quiet and only ask when something isn't obvious.",
        language="en",
    ),
    "tutor": dict(
        name="Tacet – Tutor",
        first_message="Hi Lena, I'm your tutor. Work the invoice as you think is right. I'll jump in if Sabine would have done it differently.",
        language="en",
    ),
}


MCP_API = "https://api.elevenlabs.io/v1/convai/mcp-servers"
MCP_NAME = "Tacet Work Map"


def ensure_mcp_server(http: httpx.Client, headers: dict, public_url: str) -> str | None:
    """The Work Map as MCP tools (list_steps, list_guardrails, check_decision, explain_rule), registered once."""
    url = public_url.rstrip("/") + "/mcp"
    http.patch("https://api.elevenlabs.io/v1/convai/settings", headers=headers, json={"can_use_mcp_servers": True})
    r = http.get(MCP_API, headers=headers)
    if r.status_code < 400:
        for srv in r.json().get("mcp_servers", []):
            cfg = srv.get("config") or {}
            if cfg.get("name") == MCP_NAME and cfg.get("url") == url:
                return srv["id"]
    body = {"config": {"url": url, "name": MCP_NAME, "transport": "STREAMABLE_HTTP",
                       "approval_policy": "auto_approve_all",
                       "description": "The expert's learned Work Map: steps, guardrails, and check_decision, which "
                                      "returns the expert's objections in their own words."}}
    r = http.post(MCP_API, headers=headers, json=body)
    if r.status_code >= 400:
        print(f"mcp server: HTTP {r.status_code}: {r.text[:400]}", file=sys.stderr)
        return None
    return r.json().get("id")


def payload(role: str, public_url: str, mcp_id: str | None = None) -> dict:
    a = AGENTS[role]
    return {
        "name": a["name"],
        "tags": ["shadow", "hacknation"],
        "conversation_config": {
            "agent": {
                "first_message": a["first_message"],
                "language": a["language"],
                "prompt": {
                    "prompt": PROMPT,
                    "llm": "custom-llm",
                    "custom_llm": {"url": public_url.rstrip("/") + "/v1", "model_id": "shadow"},
                    **({"mcp_server_ids": [mcp_id]} if mcp_id else {}),
                    # lets Shadow stay silent properly (an empty reply makes ElevenLabs retry and stall)
                    "built_in_tools": {"skip_turn": {"type": "system", "name": "skip_turn", "description": "",
                                                     "params": {"system_tool_type": "skip_turn"}}},
                },
            },
            "tts": {"voice_id": VOICE_ID},
            # the expert is working, not chatting: don't prompt them after silence
            "turn": {"turn_eagerness": "patient", "turn_timeout": 30},
            "conversation": {"max_duration_seconds": 1800},
        },
        "platform_settings": {
            "overrides": {
                "conversation_config_override": {
                    "agent": {"first_message": True, "language": True, "prompt": {"prompt": True}},
                    "conversation": {"text_only": True},
                },
                "custom_llm_extra_body": True,
            }
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--mcp", action="store_true", help="register the Work Map MCP server and attach it to both agents")
    ap.add_argument("--public-url", default=os.getenv("SHADOW_PUBLIC_URL", "http://localhost:8000"))
    args = ap.parse_args()

    if args.dry_run:
        for role in AGENTS:
            print(f"--- {role}\n" + json.dumps(payload(role, args.public_url), indent=2))
        return 0
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        print("ELEVENLABS_API_KEY missing (backend/.env). Run scripts/set_keys.py.", file=sys.stderr)
        return 1
    if "localhost" in args.public_url or "127.0.0.1" in args.public_url:
        print(f"note: {args.public_url} isn't reachable from ElevenLabs. Re-run with --public-url once tunneled/deployed.")

    ids = json.loads(IDS_FILE.read_text()) if IDS_FILE.exists() else {}
    headers = {"xi-api-key": key, "Content-Type": "application/json"}
    with httpx.Client(timeout=30) as http:
        mcp_id = ensure_mcp_server(http, headers, args.public_url) if args.mcp else None
        if args.mcp:
            print(f"mcp server: {mcp_id or 'not registered'}")
        for role in AGENTS:
            body = payload(role, args.public_url, mcp_id)
            if ids.get(role):
                r = http.patch(f"{API}/{ids[role]}", headers=headers, json=body)
                verb = "updated"
            else:
                r = http.post(f"{API}/create", headers=headers, json=body)
                verb = "created"
            if r.status_code >= 400:
                print(f"{role}: HTTP {r.status_code}: {r.text[:800]}", file=sys.stderr)
                return 2
            ids[role] = ids.get(role) or r.json()["agent_id"]
            print(f"{role}: {verb} {ids[role]}")
    IDS_FILE.write_text(json.dumps(ids, indent=2))
    print(f"saved ids to {IDS_FILE.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
