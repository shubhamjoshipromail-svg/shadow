"""Conversation layer behind the ElevenLabs agents (Custom LLM endpoint).

Shadow owns cognition, ElevenLabs owns conversation. Every agent turn comes
here; control tags sent by the browser via `sendUserMessage` tell Shadow
what to say (a queued question, the next debrief item, a tutor
intervention). Everything else is the human talking.
"""

from __future__ import annotations

import json
import re
from typing import Any, AsyncIterator

from shadow import llm
from shadow.engine import Session
from shadow.workmap import TRUSTED

TAG = re.compile(r"\[\[shadow:(\w+)(?:\s+([^\]]*))?\]\]")
SESSION_HINT = re.compile(r"SHADOW_SESSION=([\w-]+)")


def session_hint(messages: list[dict[str, Any]]) -> str | None:
    for m in messages:
        if m.get("role") == "system":
            found = SESSION_HINT.search(_text(m))
            if found:
                return found.group(1)
    return None


def _text(m: dict[str, Any]) -> str:
    c = m.get("content")
    if isinstance(c, list):
        return " ".join(p.get("text", "") for p in c if isinstance(p, dict))
    return c or ""


async def reply(session: Session, messages: list[dict[str, Any]]) -> AsyncIterator[str]:
    last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
    text = _text(last_user).strip() if last_user else ""
    tag = TAG.search(text)
    if tag:
        async for chunk in _control(session, tag.group(1), (tag.group(2) or "").strip()):
            yield chunk
        return
    if not text:
        return
    immediate = await session.on_utterance(text)
    if session.mode == "capture":
        if immediate is not None:
            yield immediate
            return
        async for chunk in _small_talk(session, messages):
            yield chunk
    elif session.mode == "debrief":
        if immediate is not None:  # off/on the record
            yield immediate
            return
        # speak an acknowledgement now; the next question waits until this answer is in the map
        yield session.rng.choice(["Thanks.", "Got it.", "Okay, that helps."]) + " "
        await session.wait_learning()
        yield await session.debrief_next()
    else:
        async for chunk in _tutor_turn(session, messages, text):
            yield chunk


async def _control(session: Session, kind: str, arg: str) -> AsyncIterator[str]:
    if kind == "ask":
        q = session.planner.find(arg)
        if q:
            yield q.text
    elif kind == "debrief":
        if session.mode != "debrief":
            await session.start_debrief()
        yield await session.debrief_next()
    elif kind == "intervene":
        iv = session.pending_interventions.get(arg)
        if iv:
            yield iv["say"]
    elif kind == "prompt":
        yield "What do you think happens to this one next?"
    elif kind == "say":
        yield arg


async def _small_talk(session: Session, messages: list[dict[str, Any]]) -> AsyncIterator[str]:
    """The expert spoke to the agent unprompted during capture: be brief, never interrogate."""
    if not llm.available():
        yield "Mm-hm."
        return
    system = (f"You are Shadow, a quiet, curious apprentice watching {session.expert} work. They just said "
              "something to you. Reply in at most one short sentence. Do not ask questions now; you'll ask at "
              "natural pauses. If they ask what you've learned, summarize in one sentence."
              f" Rules learned so far: {[r.title for r in session.wm.rules if r.origin != 'doc']}")
    history = _history(messages)
    async for chunk in llm.stream_text(system, history, max_tokens=80):
        yield chunk


async def _tutor_turn(session: Session, messages: list[dict[str, Any]], text: str) -> AsyncIterator[str]:
    pending = next(reversed(session.pending_interventions.values()), None) if session.pending_interventions else None
    if pending and not pending.get("explained"):
        pending["explained"] = True
        await session.emit("replay", {"screen_moment": pending.get("screen_moment"), "intervention_id": pending["id"],
                                      "quote": (pending.get("violation") or {}).get("quote")})
        lead = ""
        if llm.available():
            try:
                lead = await llm.text(
                    "You are a warm, Socratic tutor. The trainee just guessed why the expert would stop. In ONE "
                    "short sentence, acknowledge what is right or gently correct it. Do not explain the rule yet.",
                    f"Rule: {pending['violation']['title']}\nTrainee said: {text}", max_tokens=60)
            except Exception:  # noqa: BLE001
                lead = ""
        yield (lead + " " if lead else "") + pending["explain"] + " Let me show you the moment she did it."
        return
    if not llm.available():
        yield "Good. Keep going, and tell me what you'd check before saving."
        return
    rules = [{"title": n.title, "quote": n.quote.translation or n.quote.text if n.quote else None}
             for n in [*session.wm.rules, *session.wm.guardrails] if n.origin != "doc" and n.belief.status in TRUSTED]
    case = session.cases.get(session.current_case or "")
    system = (f"You are Shadow, a patient tutor teaching {session.trainee or 'a new hire'} how {session.expert} "
              f"processes invoices. Use Socratic questions first, then explain using {session.expert}'s own words "
              "(quote them). Max two short sentences per turn. Never invent rules beyond these:\n"
              f"{json.dumps(rules, ensure_ascii=False)}\n"
              f"Current case: {session.pack.describe(case) if case else 'none open'}")
    async for chunk in llm.stream_text(system, _history(messages), max_tokens=160):
        yield chunk


def _history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for m in messages:
        if m.get("role") not in ("user", "assistant"):
            continue
        t = TAG.sub("", _text(m)).strip()
        if t:
            if out and out[-1]["role"] == m["role"]:
                out[-1]["content"] += "\n" + t
            else:
                out.append({"role": m["role"], "content": t})
    if not out or out[0]["role"] != "user":
        out.insert(0, {"role": "user", "content": "(conversation start)"})
    return out
