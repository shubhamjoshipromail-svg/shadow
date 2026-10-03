"""Turning planner decisions into short spoken questions about what's on screen."""

from __future__ import annotations

from typing import Any

from shadow import llm
from shadow.packs.base import Pack

ACTION_PHRASES = {
    "post": "post it",
    "hold": "put it on hold",
    "second_approval": "send it for a second approval",
    "escalate": "stop and ask the controller",
    "reject": "reject it",
}
PAST = {
    "post": "posted",
    "hold": "put {x} on hold",
    "second_approval": "sent {x} for a second approval",
    "escalate": "escalated {x} to the controller",
    "reject": "rejected {x}",
}


def value_phrase(pack: Pack, field: str, value: Any) -> str:
    if field == "action":
        return ACTION_PHRASES.get(value, str(value))
    spec = next((f for f in pack.decision_fields if f.name == field), None)
    if field == "payment_timing":
        return "pay inside the Skonto window" if value == "skonto" else "pay on the due date"
    label = spec.option_labels.get(str(value)) if spec else None
    return f"code it to {value}" + (f" ({label})" if label else "") if field == "cost_center" else f"use {value}"


def did_phrase(pack: Pack, field: str, expert: Any, predicted: Any, case_ref: str) -> str:
    if field == "action":
        return PAST.get(expert, "handled {x} that way").format(x=case_ref)
    if field == "cost_center":
        return f"coded {case_ref} to {expert} instead of {predicted}"
    if field == "tax_code":
        return f"used tax code {expert} on {case_ref} instead of {predicted}"
    if field == "payment_timing":
        return f"set {case_ref} to be paid {'within the Skonto window' if expert == 'skonto' else 'on the due date'}"
    return f"set {field} to {expert} on {case_ref}"


def case_ref(case: dict[str, Any] | None) -> str:
    if not case:
        return "that one"
    return f"invoice {case.get('invoice_no', case.get('id'))}" if "invoice_no" in case else str(case.get("id"))


def template(pack: Pack, qtype: str, *, case: dict[str, Any] | None, field: str | None, expert_value: Any = None,
             predicted_value: Any = None, hypotheses: list[dict[str, Any]] | None = None,
             probe_delta: str | None = None, node_title: str | None = None) -> str:
    ref = case_ref(case)
    probe_delta = (probe_delta or "").rstrip(". ")
    hyps = hypotheses or []
    if qtype == "cue_probe":
        return f"You {did_phrase(pack, field or '', expert_value, predicted_value, ref)}. What made you do that?"
    if qtype == "confirm":
        top = hyps[0]["title"] if hyps else node_title or "that"
        return f"Quick check on {ref}: was it because {top[0].lower() + top[1:]}?"
    if qtype == "comparison" and len(hyps) >= 2:
        a, b = hyps[0]["title"], hyps[1]["title"]
        return f"On {ref}, what decided it: {a[0].lower() + a[1:]}, or {b[0].lower() + b[1:]}?"
    if qtype == "counterfactual":
        return (f"Imagine the same invoice, but {probe_delta}. Would you still "
                f"{value_phrase(pack, field or '', expert_value)}?")
    if qtype == "boundary":
        return f"Where exactly is the line for that? Is there an amount or a case where it flips?"
    if qtype == "guardrail":
        return (f"On an invoice like {ref}, is there anything you would never post without, "
                f"or a moment where you'd stop and ask someone?")
    if qtype == "exam":
        return f"Quick one: same kind of invoice, but {probe_delta}. What would you do?"
    return f"Can you tell me more about {ref}?"


POLISH_SYSTEM = ("Rewrite the apprentice's question so it sounds natural when spoken by a curious, patient colleague. "
                 "Max 28 words. Keep every identifier, number and code exactly. One question only. No preamble.")


async def polish(text: str, lang: str = "en") -> str:
    if not llm.available():
        return text
    try:
        target = "German" if lang == "de" else "English"
        out = await llm.text(POLISH_SYSTEM + f" Answer in {target}.", text, max_tokens=120)
        return out.strip().strip('"') or text
    except Exception:  # noqa: BLE001 - phrasing must never block the loop
        return text
