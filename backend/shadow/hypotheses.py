"""Hypothesis competition: before asking anything, Shadow proposes candidate
rules that would explain the expert's surprising decision, executes them on
the episode log, weights them by the expert's attention, and only then
decides whether a question is worth it.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field

from shadow import compiler, dsl, llm
from shadow.bayes import Hypothesis, entropy
from shadow.packs.base import Pack
from shadow.workmap import Guardrail, Rule, WorkMap, run_map, with_rule

UNKNOWN = "h0"


class ProposedRule(BaseModel):
    title: str = Field(description="Plain-English rule, as the expert might say it")
    when: str = Field(description="Condition in the rule language, using only the listed context names")
    kind: Literal["rule", "guardrail"] = "rule"
    plausibility: float = Field(description="0-1 prior plausibility for an experienced professional")
    fields_used: list[str] = Field(default_factory=list)


class Proposals(BaseModel):
    hypotheses: list[ProposedRule]


@dataclass
class ScoredHypothesis:
    id: str
    title: str
    when: str
    field: str
    value: Any
    kind: str
    prior: float
    attention_boost: float
    consistent: int
    inconsistent: int
    posterior: float = 0.0
    node: Rule | Guardrail | None = None

    def to_json(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if k != "node"}


@dataclass
class HypothesisSet:
    gap_id: str
    case_id: str
    field: str
    expert_value: Any
    predicted_value: Any
    items: list[ScoredHypothesis] = field(default_factory=list)
    p_unknown: float = 0.3

    def probs(self) -> dict[str, float]:
        out = {h.id: h.posterior for h in self.items}
        out[UNKNOWN] = self.p_unknown
        return out

    def entropy(self) -> float:
        return entropy(list(self.probs().values()))

    def top(self) -> ScoredHypothesis | None:
        return max(self.items, key=lambda h: h.posterior, default=None)

    def as_bald(self, wm: WorkMap, pack: Pack) -> list[Hypothesis]:
        """Each hypothesis = current map + that rule; h0 = current map unchanged."""
        def predictor(m: WorkMap):
            def f(case: dict[str, Any]) -> Any:
                p = run_map(m, pack, case)
                if self.field == "action":
                    return p.action.value if p.action else None
                fp = p.fields.get(self.field)
                return fp.value if fp else None
            return f
        out = [Hypothesis(h.id, h.posterior, predictor(with_rule(wm, h.node))) for h in self.items if h.node]
        out.append(Hypothesis(UNKNOWN, self.p_unknown, predictor(wm)))
        return out

    def to_json(self) -> dict[str, Any]:
        return {"gap_id": self.gap_id, "case_id": self.case_id, "field": self.field,
                "expert_value": self.expert_value, "predicted_value": self.predicted_value,
                "items": [h.to_json() for h in self.items], "p_unknown": self.p_unknown,
                "entropy": round(self.entropy(), 3)}


def _feature_catalog(pack: Pack, case: dict[str, Any]) -> str:
    ctx = pack.derive(case)
    lines = []
    for scope, values in ctx.items():
        for k, v in values.items():
            lines.append(f"{scope}.{k} = {json.dumps(v, default=str)}")
    return "\n".join(lines)


def _system(pack: Pack) -> str:
    """The proposal prompt, grounded in the pack's own namespace/features (invoice examples for invoices)."""
    example = compiler.example_expression(pack, as_param=False)
    ns = compiler.namespace(pack)
    return f"""You help an AI apprentice understand an expert's unwritten judgment.
The expert just made a decision that the written process (and the rules learned so far) did not predict.
Propose 3-5 DIFFERENT candidate explanations, each as a precise rule in a restricted Python-like
expression language over the listed context names (e.g. `{example}`). The current workflow's namespace
is `{ns}`; use only the context names listed below.
Allowed: and/or/not, comparisons, in, arithmetic, numbers, strings, lists, abs/min/max/len.
Each rule's condition MUST be true for the current case. Prefer simple, general rules an experienced
professional would plausibly hold, use round-number thresholds, and vary which facts each explanation relies on.
Use kind='guardrail' for limits, holds, escalations or 'stop and ask' behavior."""


async def propose(pack: Pack, wm: WorkMap, case: dict[str, Any], field: str, expert_value: Any,
                  predicted_value: Any, attention: list[str]) -> list[ProposedRule]:
    user = (
        f"Decision field: {field}\nExpert chose: {expert_value!r}\nThe written process predicted: {predicted_value!r}\n\n"
        f"Context names and values for this case:\n{_feature_catalog(pack, case)}\n\n"
        f"What the expert looked at before deciding (in order): {', '.join(attention) or 'nothing recorded'}\n\n"
        f"Rules already known:\n" + "\n".join(f"- {r.title}: {r.when}" for r in wm.rules) + "\n\n"
        f"Write each rule so that it explains why `{field}` should be {expert_value!r} here."
    )
    out = await llm.parse(Proposals, _system(pack), user, tier="reason", max_tokens=2500)
    return out.hypotheses


def _node_for(p: ProposedRule, hid: str, field: str, value: Any, step_id: str | None) -> Rule | Guardrail:
    if field == "action" and (p.kind == "guardrail" or value in ("hold", "escalate", "second_approval", "reject")):
        gtype = {"hold": "hold", "escalate": "stop_and_ask", "second_approval": "second_approval"}.get(value, "hard_limit")
        return Guardrail(id=hid, step_id=step_id, title=p.title, when=p.when, type=gtype, action=value,
                         origin="inferred")
    return Rule(id=hid, step_id=step_id, title=p.title, when=p.when, then={field: value}, origin="inferred")


def score(pack: Pack, wm: WorkMap, case: dict[str, Any], field: str, expert_value: Any, predicted_value: Any,
          proposals: list[ProposedRule], history: list[tuple[dict[str, Any], dict[str, Any]]],
          attention_fields: set[str], gap_id: str) -> HypothesisSet:
    """Score proposals against this case and the episode log.

    history: [(case, expert_decision_values)] for past episodes, where
    expert_decision_values maps field -> value (including 'action').
    """
    hs = HypothesisSet(gap_id=gap_id, case_id=case["id"], field=field, expert_value=expert_value,
                       predicted_value=predicted_value)
    step = wm.step_for_field(field)
    for i, p in enumerate(proposals):
        try:
            dsl.validate(p.when)
        except dsl.DSLError:
            continue
        ctx = {**pack.derive(case), "params": wm.params}
        if not dsl.holds(p.when, ctx):
            continue
        hid = f"{gap_id}.h{i + 1}"
        node = _node_for(p, hid, field, expert_value, step.id if step else None)
        cand = with_rule(wm, node)
        consistent = inconsistent = 0
        for past_case, past_vals in history:
            if field not in past_vals:
                continue
            pc = {**pack.derive(past_case), "params": wm.params}
            if not dsl.holds(p.when, pc):
                continue
            pred = run_map(cand, pack, past_case)
            got = (pred.action.value if pred.action else None) if field == "action" else (
                pred.fields[field].value if field in pred.fields else None)
            if got == past_vals[field]:
                consistent += 1
            else:
                inconsistent += 1
        used = dsl.fields_referenced(p.when)
        overlap = sum(1 for u in used if any(u.endswith(a) or a in u for a in attention_fields))
        boost = 1.0 + 0.6 * overlap
        hs.items.append(ScoredHypothesis(id=hid, title=p.title, when=p.when, field=field, value=expert_value,
                                         kind=p.kind, prior=max(0.05, min(0.95, p.plausibility)),
                                         attention_boost=round(boost, 2), consistent=consistent,
                                         inconsistent=inconsistent, node=node))
    # unnormalized posterior: prior x attention x likelihood on history (noise 0.1)
    raw = {h.id: h.prior * h.attention_boost * math.pow(1.2, h.consistent) * math.pow(0.1, h.inconsistent)
           for h in hs.items}
    p_unknown_raw = 0.35 if hs.items else 1.0
    z = sum(raw.values()) + p_unknown_raw
    for h in hs.items:
        h.posterior = round(raw[h.id] / z, 4)
    hs.p_unknown = round(p_unknown_raw / z, 4)
    return hs
