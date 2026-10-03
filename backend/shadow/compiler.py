"""Knowledge Compiler: the expert's spoken answer → structured knowledge.

The output is only a *proposal*. New rules enter the Work Map as `stated`
(testimony is a prior); behavior decides whether they become `confirmed`.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, Field

from shadow import dsl, llm
from shadow.packs.base import Pack
from shadow.workmap import WorkMap


class CompiledRule(BaseModel):
    title: str = Field(description="The rule in plain English, close to the expert's words")
    when: str = Field(description="Condition in the rule language; numeric thresholds as params.T_<name>")
    field: str = Field(description="Decision field it sets, or 'action'")
    value: str
    kind: Literal["rule", "exception", "guardrail"] = "rule"
    parent_id: str | None = Field(None, description="For exceptions: the rule id it overrides")
    guardrail_type: Literal["hard_limit", "stop_and_ask", "hold", "second_approval"] | None = None
    ask: str | None = Field(None, description="Who to ask, for stop_and_ask guardrails")
    quote: str | None = Field(None, description="The expert's sentence that states THIS rule, verbatim")


class ThresholdStatement(BaseModel):
    param: str = Field(description="e.g. T_capex")
    value: float
    quantity: str = Field(description="The context name it compares against, e.g. inv.net_eur")
    kind: Literal["amount", "pct", "days"] = "amount"


class Compiled(BaseModel):
    answers_question: bool = Field(description="False if the expert talked about something else or declined")
    off_the_record: bool = Field(False, description="Expert asked to go off the record / not record this")
    key_quote: str = Field(description="The most informative sentence, VERBATIM from the transcript")
    translation_en: str | None = Field(None, description="English translation if the quote is not English")
    selected_hypothesis_id: str | None = None
    rules: list[CompiledRule] = Field(default_factory=list)
    strength: Literal["always", "usually", "sometimes", "never", "unclear"] = "unclear"
    threshold: ThresholdStatement | None = None
    probe_answer: str | None = Field(None, description="For hypothetical/exam questions: the value the expert chose")
    confirms: bool | None = Field(None, description="For confirm / teach-back questions: did the expert agree?")
    correction: str | None = Field(None, description="What the expert corrected, if anything")
    needs_followup: str | None = Field(None, description="One short clarifying question, only if truly ambiguous")


SYSTEM = """You compile an expert's spoken answer into structured, executable knowledge for an AI apprentice.
Rules are written in a restricted Python-like expression language over the given context names
(e.g. `inv.category == 'equipment' and inv.net_eur > params.T_capex`). Write numeric thresholds as
`params.T_<short_name>` and report the stated number in `threshold`. Limits, holds, escalations and
"stop and ask someone" behaviors are guardrails (field 'action'). Exceptions to an existing rule use
kind='exception' with parent_id. Quote the expert verbatim. Do not invent rules the expert did not express;
if the answer is vague, return no rules and suggest one follow-up question."""


async def compile_answer(pack: Pack, wm: WorkMap, inquiry: dict[str, Any], transcript: str,
                         case: dict[str, Any] | None) -> Compiled:
    ctx_lines = []
    if case:
        for scope, values in pack.derive(case).items():
            ctx_lines += [f"{scope}.{k} = {json.dumps(v, default=str)}" for k, v in values.items()]
    field_opts = {f.name: f.options for f in pack.decision_fields}
    user = (
        f"Question type: {inquiry.get('type')}\nQuestion asked: {inquiry.get('text')}\n"
        f"About field: {inquiry.get('field')}  (expert's value: {inquiry.get('expert_value')!r}; "
        f"written process predicted: {inquiry.get('predicted_value')!r})\n"
        f"Competing hypotheses: {json.dumps(inquiry.get('hypotheses', []))}\n"
        f"Hypothetical case variant (if any): {inquiry.get('probe_delta') or '-'}\n\n"
        f"Expert's answer (transcript): \"{transcript}\"\n\n"
        f"Context names for the case:\n" + "\n".join(ctx_lines) + "\n\n"
        f"Decision fields and options: {json.dumps(field_opts)}; actions: {pack.actions}\n"
        f"Existing rules: " + json.dumps([{"id": r.id, "title": r.title, "when": r.when, "then": r.then}
                                           for r in wm.rules if r.origin != "doc"]) + "\n"
        f"Existing guardrails: " + json.dumps([{"id": g.id, "title": g.title, "when": g.when}
                                                for g in wm.guardrails])
    )
    out = await llm.parse(Compiled, SYSTEM, user, tier="reason", max_tokens=3000)
    valid = []
    for r in out.rules:
        try:
            dsl.validate(r.when)
            valid.append(r)
        except dsl.DSLError:
            continue
    out.rules = valid
    return out
