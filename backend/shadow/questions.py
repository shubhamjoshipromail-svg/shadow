"""Turning planner decisions into short spoken questions about what's on screen.

Everything user-visible here comes from the pack: its `case_noun`, the labels on
its decision fields, its action labels and `describe()` / `describe_delta()`. No
workflow nouns or actions are hard-coded, so the same templates read naturally
for supplier invoices ("invoice 4471") and for any other workflow ("claim
exp-9001"). The invoice phrasings are preserved verbatim because the invoice
pack's own data reproduces them.
"""

from __future__ import annotations

from typing import Any

from shadow import llm
from shadow.packs.base import Pack

# Action verbs are domain data. These are the invoice pack's; other packs fall
# back to their own action labels from `pack.action_labels` (see GenericPack).
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


def _lower(label: str) -> str:
    return label[0].lower() + label[1:] if label else label


def case_noun(pack: Pack) -> str:
    """What one work item is called in this workflow."""
    return getattr(pack, "case_noun", None) or "invoice"


def _article(noun: str) -> str:
    return "an" if noun[:1].lower() in "aeiou" else "a"


def field_spec(pack: Pack, field: str):
    return next((f for f in pack.decision_fields if f.name == field), None)


def _value_label(pack: Pack, field: str, value: Any) -> str:
    spec = field_spec(pack, field)
    if spec and spec.option_labels:
        return spec.option_labels.get(str(value), str(value))
    return str(value)


def _action_label(pack: Pack, value: Any) -> str:
    labels = getattr(pack, "action_labels", None) or {}
    return labels.get(str(value), str(value))


def _decide_verb(pack: Pack) -> str:
    """A neutral verb for the guardrail question, read off the pack's own actions."""
    actions = set(getattr(pack, "actions", None) or [])
    if "post" in actions:
        return "post"
    if actions & {"approve", "auto_approve", "manager_approve", "finance_review", "second_approval"}:
        return "approve"
    return "do"


def value_phrase(pack: Pack, field: str, value: Any) -> str:
    if field == "action":
        if value in ACTION_PHRASES:
            return ACTION_PHRASES[value]
        return _lower(_action_label(pack, value))
    if field == "payment_timing":
        return "pay inside the Skonto window" if value == "skonto" else "pay on the due date"
    spec = field_spec(pack, field)
    label = spec.option_labels.get(str(value)) if spec else None
    if field == "cost_center":
        return f"code it to {value}" + (f" ({label})" if label else "")
    return f"use {value}" + (f" ({label})" if label and label != str(value) else "")


def did_phrase(pack: Pack, field: str, expert: Any, predicted: Any, case_ref: str) -> str:
    if field == "action":
        if expert in PAST:
            return PAST[expert].format(x=case_ref)
        return f"set {case_ref} to {_lower(_action_label(pack, expert))}"
    # The invoice pack's own field phrasings; other workflows get the generic form.
    if field == "cost_center":
        return f"coded {case_ref} to {expert} instead of {predicted}"
    if field == "tax_code":
        return f"used tax code {expert} on {case_ref} instead of {predicted}"
    if field == "payment_timing":
        return f"set {case_ref} to be paid {'within the Skonto window' if expert == 'skonto' else 'on the due date'}"
    spec = field_spec(pack, field)
    label = _lower(spec.label) if spec and spec.label else field
    return f"set {case_ref}'s {label} to {_lower(_value_label(pack, field, expert))} instead of " \
           f"{_lower(_value_label(pack, field, predicted))}"


def case_ref(pack: Pack, case: dict[str, Any] | None) -> str:
    noun = case_noun(pack)
    if not case:
        return "that one"
    if "invoice_no" in case:
        return f"{noun} {case.get('invoice_no')}"
    if noun == "invoice":
        return str(case.get("id"))  # keep the invoice pack's original fallback
    return f"{noun} {case.get('id')}"


def template(pack: Pack, qtype: str, *, case: dict[str, Any] | None, field: str | None, expert_value: Any = None,
             predicted_value: Any = None, hypotheses: list[dict[str, Any]] | None = None,
             probe_delta: str | None = None, node_title: str | None = None) -> str:
    noun = case_noun(pack)
    ref = case_ref(pack, case)
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
        if expert_value is None:
            return f"Imagine the same {noun}, but {probe_delta}. What would you do?"
        return (f"Imagine the same {noun}, but {probe_delta}. Would you still "
                f"{value_phrase(pack, field or '', expert_value)}?")
    if qtype == "boundary":
        return f"Where exactly is the line for that? Is there an amount or a case where it flips?"
    if qtype == "guardrail":
        return (f"On {_article(noun)} {noun} like {ref}, is there anything you would never "
                f"{_decide_verb(pack)} without, or a moment where you'd stop and ask someone?")
    if qtype == "deviation":
        # Neutral, never "you're wrong": the expert contradicts a confirmed rule.
        settled = _lower(node_title) if node_title else "what I had as the settled rule"
        return (f"On {ref} that looked different from {settled}. Is this an exception, a change in how it's "
                f"done now, or a one-off?")
    if qtype == "exam":
        return f"Quick one: same kind of {noun}, but {probe_delta}. What would you do?"
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
