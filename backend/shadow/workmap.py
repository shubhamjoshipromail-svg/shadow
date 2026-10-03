"""The Executable Work Map — Shadow's central artifact.

Steps, rules and guardrails, each with the expert's own words, a screen
moment and a belief state. The map can be *run* on a case (`run_map`), which
is how Shadow knows when it has understood, how the tutor knows the right
answer before the trainee acts, and how agents load the same judgment.

Belief follows "words propose, behavior disposes": a quote only makes a rule
`stated`; it becomes `confirmed` once behavior (live decisions, replayed
episodes, counterfactual answers) agrees with it.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from shadow import dsl
from shadow.packs.base import Pack

Status = Literal["inferred", "stated", "confirmed", "contested"]
ACTIVE: tuple[Status, ...] = ("inferred", "stated", "confirmed")
TRUSTED: tuple[Status, ...] = ("stated", "confirmed")

EVIDENCE_WEIGHT = {"live": 1.0, "retro": 1.0, "counterfactual": 0.6, "teachback": 1.5, "contradiction": 1.0}


class Quote(BaseModel):
    text: str
    speaker: str = "expert"
    ts: float | None = None  # seconds since session start
    lang: str = "en"
    translation: str | None = None
    audio_ref: str | None = None
    inquiry_id: str | None = None


class ScreenMoment(BaseModel):
    ts: float | None = None
    frame_id: str | None = None
    entity: str | None = None
    field: str | None = None
    label: str | None = None


class Evidence(BaseModel):
    episode_id: str
    kind: Literal["live", "retro", "counterfactual", "teachback", "contradiction"]
    agrees: bool
    note: str | None = None


class Belief(BaseModel):
    status: Status = "inferred"
    p: float = 0.5


class _Node(BaseModel):
    id: str
    step_id: str | None = None
    title: str
    when: str
    origin: Literal["doc", "expert", "inferred"] = "expert"
    quote: Quote | None = None
    screen_moment: ScreenMoment | None = None
    belief: Belief = Field(default_factory=Belief)
    evidence: list[Evidence] = Field(default_factory=list)

    @field_validator("when")
    @classmethod
    def _valid_expr(cls, v: str) -> str:
        dsl.validate(v)
        return v

    def refresh_belief(self) -> None:
        agree = sum(EVIDENCE_WEIGHT[e.kind] for e in self.evidence if e.agrees)
        disagree = sum(EVIDENCE_WEIGHT[e.kind] for e in self.evidence if not e.agrees)
        prior_a = 3.0 if self.quote else 1.0  # testimony is a prior, not proof
        p = (prior_a + agree) / (prior_a + 1.0 + agree + disagree)
        behavioral = any(e.agrees and e.kind in ("live", "retro", "counterfactual", "teachback") for e in self.evidence)
        if disagree > 0 and p < 0.6:
            status: Status = "contested"
        elif p >= 0.8 and behavioral:
            status = "confirmed"
        elif self.quote:
            status = "stated"
        else:
            status = "inferred"
        self.belief = Belief(status=status, p=round(p, 3))


class Rule(_Node):
    kind: Literal["rule", "heuristic", "preference", "exception"] = "rule"
    then: dict[str, Any]  # e.g. {"cost_center": "0400"} or {"action": "hold"}
    parent: str | None = None  # for exceptions
    priority: int = 0  # raised when the expert resolves a conflict in this rule's favour


class Guardrail(_Node):
    type: Literal["hard_limit", "stop_and_ask", "hold", "second_approval"]
    action: str  # an action of the pack (hold / escalate / second_approval / reject) or "block"
    ask: str | None = None  # who to ask, for stop_and_ask


class Step(BaseModel):
    id: str
    order: int
    name: str
    description: str = ""
    screen_moment: ScreenMoment | None = None
    decision_field: str | None = None
    rule_ids: list[str] = Field(default_factory=list)
    guardrail_ids: list[str] = Field(default_factory=list)
    discretion: bool = False  # explicitly left to the expert's judgment
    no_guardrail: bool = False  # expert confirmed there is none


class FieldPred(BaseModel):
    value: Any
    source: str  # rule/guardrail id, "novice", or "default"
    p: float


class MapPrediction(BaseModel):
    fields: dict[str, FieldPred] = Field(default_factory=dict)
    action: FieldPred | None = None
    fired_rules: list[str] = Field(default_factory=list)
    triggered_guardrails: list[str] = Field(default_factory=list)
    uncovered: list[str] = Field(default_factory=list)
    rationale: str | None = None


class Violation(BaseModel):
    kind: Literal["rule", "guardrail"]
    node_id: str
    field: str
    expected: Any
    got: Any
    title: str
    quote: Quote | None = None
    screen_moment: ScreenMoment | None = None


class WorkMap(BaseModel):
    pack_id: str
    task: str
    expert: str
    version: int = 0
    steps: list[Step] = Field(default_factory=list)
    rules: list[Rule] = Field(default_factory=list)
    guardrails: list[Guardrail] = Field(default_factory=list)
    params: dict[str, float] = Field(default_factory=dict)

    def node(self, node_id: str) -> Rule | Guardrail | None:
        for n in [*self.rules, *self.guardrails]:
            if n.id == node_id:
                return n
        return None

    def next_id(self, prefix: str) -> str:
        existing = {n.id for n in [*self.rules, *self.guardrails]} | {s.id for s in self.steps}
        i = 1
        while f"{prefix}{i}" in existing:
            i += 1
        return f"{prefix}{i}"

    def step_for_field(self, field: str) -> Step | None:
        return next((s for s in self.steps if s.decision_field == field), None)


# ------------------------------------------------------------------ runtime
def _specificity(rule: Rule) -> int:
    try:
        return len(dsl.fields_referenced(rule.when))
    except dsl.DSLError:
        return 0


def context(wm: WorkMap, pack: Pack, case: dict[str, Any], booking: dict[str, Any] | None = None) -> dict[str, Any]:
    ctx = pack.derive(case)
    ctx["params"] = dict(wm.params)
    if booking is not None:
        ctx["booking"] = booking
    return ctx


def _severity(pack: Pack, action: str | None) -> int:
    """Higher = more severe. Unknown/None = least severe."""
    if action is None or action not in pack.action_precedence:
        return -1
    return len(pack.action_precedence) - pack.action_precedence.index(action)


def run_map(wm: WorkMap, pack: Pack, case: dict[str, Any], statuses: tuple[Status, ...] = ACTIVE) -> MapPrediction:
    ctx = context(wm, pack, case)
    pred = MapPrediction()
    # doc rules are the fallback and always run; their belief shows whether the 2019 doc still holds
    rules = [r for r in wm.rules if r.origin == "doc" or r.belief.status in statuses]
    # ascending priority: later writes win (exceptions last, then specificity, then belief)
    rules.sort(key=lambda r: (r.origin != "doc", r.priority, r.parent is not None, _specificity(r), r.belief.p))
    action_candidates: list[FieldPred] = []
    for r in rules:
        if r.parent and not any(p == r.parent for p in pred.fired_rules):
            parent = wm.node(r.parent)
            if parent is None or not dsl.holds(parent.when, ctx):
                continue
        if not dsl.holds(r.when, ctx):
            continue
        pred.fired_rules.append(r.id)
        for k, v in r.then.items():
            fp = FieldPred(value=v, source=r.id, p=r.belief.p)
            if k == "action":
                action_candidates.append(fp)
            else:
                pred.fields[k] = fp
    booking = {k: fp.value for k, fp in pred.fields.items()}
    gctx = {**ctx, "booking": booking}
    for g in wm.guardrails:
        if g.belief.status in statuses and dsl.holds(g.when, gctx):
            pred.triggered_guardrails.append(g.id)
            if g.action != "block":
                action_candidates.append(FieldPred(value=g.action, source=g.id, p=g.belief.p))
    if action_candidates:
        pred.action = max(action_candidates, key=lambda fp: (_severity(pack, fp.value), fp.p))
    pred.uncovered = [f.name for f in pack.decision_fields if f.name not in pred.fields]
    if pred.action is None:
        pred.uncovered.append("action")
    return pred


def with_rule(wm: WorkMap, rule: Rule | Guardrail) -> WorkMap:
    """A copy of the map with one extra (hypothetical) node, for scoring hypotheses."""
    clone = wm.model_copy(deep=True)
    if isinstance(rule, Guardrail):
        clone.guardrails.append(rule)
    else:
        clone.rules.append(rule)
    return clone


def check_proposal(wm: WorkMap, pack: Pack, case: dict[str, Any], booking: dict[str, Any], action: str,
                   statuses: tuple[Status, ...] = TRUSTED) -> list[Violation]:
    """What would the expert object to in this proposed booking + action?"""
    normalized = pack.normalize(case, booking)
    proposed = {**normalized, "asset_number": booking.get("asset_number")}
    pred = run_map(wm, pack, case, statuses)
    out: list[Violation] = []
    for field, fp in pred.fields.items():
        if field in normalized and normalized[field] is not None and normalized[field] != fp.value:
            node = wm.node(fp.source)
            out.append(Violation(kind="rule", node_id=fp.source, field=field, expected=fp.value,
                                 got=normalized[field], title=node.title if node else fp.source,
                                 quote=node.quote if node else None,
                                 screen_moment=node.screen_moment if node else None))
    gctx = {**context(wm, pack, case), "booking": proposed}
    for g in wm.guardrails:
        if g.belief.status not in statuses or not dsl.holds(g.when, gctx):
            continue
        if g.action == "block" or _severity(pack, g.action) > _severity(pack, action):
            out.append(Violation(kind="guardrail", node_id=g.id, field="action", expected=g.action, got=action,
                                 title=g.title, quote=g.quote, screen_moment=g.screen_moment))
    reported = {v.node_id for v in out if v.field == "action"}
    if (pred.action and pred.action.source not in reported
            and _severity(pack, pred.action.value) > _severity(pack, action)):
        node = wm.node(pred.action.source)
        out.append(Violation(kind="guardrail" if isinstance(node, Guardrail) else "rule",
                             node_id=pred.action.source, field="action", expected=pred.action.value,
                             got=action, title=node.title if node else "",
                             quote=node.quote if node else None,
                             screen_moment=node.screen_moment if node else None))
    return out
