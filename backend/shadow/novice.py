"""The AI Novice: what a competent AI would do knowing only the written process.

It sees the process doc plus whatever rules Shadow has learned, never the
expert's hidden judgment. Its committed prediction is the baseline; the gap
between it and the expert is the residual knowledge Shadow is after.

Deterministic rules from the Work Map fill whatever they cover; the LLM only
fills uncovered fields and writes the human-readable rationale.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, Field, create_model

from shadow import llm
from shadow.packs.base import Pack
from shadow.workmap import ACTIVE, FieldPred, MapPrediction, WorkMap, run_map


class NoviceOutput(BaseModel):
    rationale: str = Field(description="One or two sentences, plain English")
    confidence: float = Field(description="0-1 confidence in the overall decision")
    fields_relied_on: list[str] = Field(default_factory=list)


def _schema_for(pack: Pack) -> type[BaseModel]:
    fields: dict[str, Any] = {}
    for f in pack.decision_fields:
        typ = Literal[tuple(f.options)] if f.options else str  # type: ignore[valid-type]
        fields[f.name] = (typ, ...)
    fields["action"] = (Literal[tuple(pack.actions)], ...)  # type: ignore[valid-type]
    return create_model(f"Novice_{pack.id}", __base__=NoviceOutput, **fields)


def _rules_text(wm: WorkMap) -> str:
    lines = []
    for r in wm.rules:
        if r.origin != "doc" and r.belief.status in ACTIVE:
            lines.append(f"- [{r.id}] {r.title}  (if {r.when} then {json.dumps(r.then)})")
    for g in wm.guardrails:
        if g.belief.status in ACTIVE:
            lines.append(f"- [{g.id}] GUARDRAIL {g.title}  (if {g.when} then {g.action})")
    return "\n".join(lines) or "(none yet)"


async def predict(wm: WorkMap, pack: Pack, case: dict[str, Any], use_llm: bool = True) -> MapPrediction:
    pred = run_map(wm, pack, case)
    if not use_llm or not llm.available():
        pred.rationale = "Following the written process and the rules learned so far."
        return pred
    schema = _schema_for(pack)
    system = (
        f"You are a careful new {pack.name} clerk. You know ONLY the company's written work instruction below "
        f"and the rules your mentor has confirmed. You do not know any unwritten habits.\n\n"
        f"WORK INSTRUCTION:\n{pack.process_doc}"
    )
    ctx = pack.derive(case)
    user = (
        f"Learned rules (apply them when their condition holds):\n{_rules_text(wm)}\n\n"
        f"Case facts:\n{json.dumps(ctx, default=str)}\n\n"
        f"Full case:\n{json.dumps({k: v for k, v in case.items() if not k.startswith('_')}, default=str)}\n\n"
        "Decide every field and the action. Prefer the learned rules over the work instruction when they conflict."
    )
    out = await llm.parse(schema, system, user, tier="fast", max_tokens=800)
    data = out.model_dump()
    for f in pack.decision_fields:
        if f.name not in pred.fields:
            pred.fields[f.name] = FieldPred(value=data[f.name], source="novice", p=float(out.confidence))
    if pred.action is None:
        pred.action = FieldPred(value=data["action"], source="novice", p=float(out.confidence))
    pred.rationale = out.rationale
    return pred
