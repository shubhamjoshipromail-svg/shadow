"""Task-agnostic learning core: a runtime TaskDefinition plus the bridge from
raw observations to a case the engine can reason over.

Where `packs/ap_invoices` hand-writes a workflow (invoice fields, an oracle, a
case generator), a `TaskDefinition` is *data*: a goal, the decision fields, the
actions with a severity order, features with a type and where they are observed
on screen, and — optionally — the written-process rules the learner starts from.

`GenericPack` (in `shadow.packs.generic`) turns that data into the same `Pack`
surface the engine already uses, with a generic rule-language namespace
(`task.`) instead of `inv.`. See
`advisory/product-engine-investigation-2026-10-03/NOVEL_TASK_LEARNING_PROPOSAL.md`
§3 for the object model and §9 for the integration sequence.

This module is pure: it reads one JSON file and never calls an LLM.
`propose_taskdef_prompt` *builds* the prompt for an LLM to propose a task
definition from a goal and a few observations; sending it is someone else's job.

Missingness is explicit. Every declared feature appears in `derive()`; a feature
that was never observed is `None`. The DSL evaluates ordering comparisons
against `None` as "does not hold" (`dsl.holds` -> False), so a rule that needs an
unobserved fact stays quiet instead of quietly inventing a value.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from shadow import dsl

# The rule-language prefix a generic task uses. Rules read `task.amount_eur`
# instead of `inv.net_eur`; the engine resolves the namespace from the pack.
GENERIC_NAMESPACE = "task"

FeatureType = Literal["num", "cat", "bool", "date"]
Availability = Literal["observed", "expert_supplied", "derived", "missing", "unreadable", "conflicting"]
AVAILABILITY_STATES: tuple[str, ...] = ("observed", "expert_supplied", "derived", "missing", "unreadable",
                                        "conflicting")

# How an observation's `source` field maps to an availability state.
_EXPERT_SOURCES = {"expert", "expert_supplied", "teacher", "human"}
_SOURCE_ALIASES: tuple[str, ...] = ("field", "label", "name", "key", "screen_label")

_NUM_JUNK = re.compile(r"[^0-9,.\-]")
_DATE_FORMATS = ("%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d")


# --------------------------------------------------------------------- schema
class FeatureDef(BaseModel):
    """One fact the decision can depend on, and where it comes from."""

    name: str
    label: str = ""
    type: FeatureType
    source: str | None = Field(None, description="Where it is observed on screen, e.g. 'Expense form · Amount'")
    unit: str | None = None
    options: list[str] = Field(default_factory=list)  # cat
    lo: float | None = None  # num range (also day offsets for date generation)
    hi: float | None = None
    step: float | None = None
    scale: float | None = None
    threshold_capable: bool = False
    threshold_param: str | None = Field(None, description="Rule-language param name; defaults to T_<name>")
    values: list[Any] = Field(default_factory=list, description="Explicit sample pool for generation / perturbation")
    weights: list[float] = Field(default_factory=list, description="Optional sampling weights for `values`")
    required: bool = False
    note: str | None = None

    @model_validator(mode="after")
    def _check_range(self) -> "FeatureDef":
        if self.type == "num" and self.lo is not None and self.hi is not None and self.lo > self.hi:
            raise ValueError(f"feature {self.name}: lo > hi")
        if self.weights and len(self.weights) != len(self.values):
            raise ValueError(f"feature {self.name}: weights must align with values")
        if self.threshold_capable and self.type != "num":
            raise ValueError(f"feature {self.name}: only num features can be threshold-capable")
        return self

    @property
    def param(self) -> str:
        return self.threshold_param or f"T_{self.name}"


class DecisionFieldDef(BaseModel):
    name: str
    label: str = ""
    options: list[str] = Field(default_factory=list)
    option_labels: dict[str, str] = Field(default_factory=dict)


class ActionDef(BaseModel):
    name: str
    label: str = ""
    severity: int = Field(0, description="Higher is more severe; most severe wins a conflict")


class ProcessStepDef(BaseModel):
    id: str
    order: int = 0
    name: str
    description: str = ""
    decision_field: str | None = None
    rule_ids: list[str] = Field(default_factory=list)


class ProcessRuleDef(BaseModel):
    """A written-process rule (origin='doc'): the deliberately incomplete start."""

    id: str
    title: str
    when: str
    then: dict[str, Any]
    step_id: str | None = None

    @field_validator("when")
    @classmethod
    def _valid_when(cls, v: str) -> str:
        dsl.validate(v)
        return v


class ProcessGuardrailDef(BaseModel):
    id: str
    title: str
    when: str
    type: Literal["hard_limit", "stop_and_ask", "hold", "second_approval"] = "hard_limit"
    action: str = "block"
    ask: str | None = None
    step_id: str | None = None

    @field_validator("when")
    @classmethod
    def _valid_when(cls, v: str) -> str:
        dsl.validate(v)
        return v


class TaskDefinition(BaseModel):
    """A versioned, data-only description of a workflow."""

    id: str
    name: str
    task: str
    goal: str
    expert_name: str = "expert"
    namespace: str = GENERIC_NAMESPACE
    version: int = 1
    reference_date: str = "2026-10-03"
    case_noun: str = Field("case", description="What one work item is called, e.g. 'claim' or 'invoice'")
    process_doc: str | None = None
    decision_fields: list[DecisionFieldDef] = Field(default_factory=list)
    actions: list[ActionDef] = Field(default_factory=list)
    features: list[FeatureDef] = Field(default_factory=list)
    steps: list[ProcessStepDef] = Field(default_factory=list)
    process_rules: list[ProcessRuleDef] = Field(default_factory=list)
    process_guardrails: list[ProcessGuardrailDef] = Field(default_factory=list)
    exploration_priors: list[list[str]] = Field(default_factory=list)
    describe_fields: list[str] = Field(default_factory=list)
    describe_template: str | None = None
    demo: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    demo_seed: int = 7

    @model_validator(mode="after")
    def _check_refs(self) -> "TaskDefinition":
        names = [f.name for f in self.features]
        if len(names) != len(set(names)):
            raise ValueError("duplicate feature names")
        dnames = [d.name for d in self.decision_fields]
        if len(dnames) != len(set(dnames)):
            raise ValueError("duplicate decision field names")
        for r in self.process_rules:
            for key in r.then:
                if key != "action" and key not in dnames:
                    raise ValueError(f"rule {r.id}: then.{key} is not a decision field")
        for g in self.process_guardrails:
            if g.action != "block" and g.action not in [a.name for a in self.actions]:
                raise ValueError(f"guardrail {g.id}: unknown action {g.action}")
        return self

    def feature(self, name: str) -> FeatureDef | None:
        return next((f for f in self.features if f.name == name), None)

    def action_names(self) -> list[str]:
        return [a.name for a in self.actions]

    def precedence(self) -> list[str]:
        """Actions, most severe first; ties keep declaration order."""
        order = {a.name: i for i, a in enumerate(self.actions)}
        return sorted(order, key=lambda n: (-next(a.severity for a in self.actions if a.name == n), order[n]))

    def threshold_features(self) -> list[FeatureDef]:
        return [f for f in self.features if f.threshold_capable and f.type == "num"]


# ---------------------------------------------------------------------- load
def parse_task_definition(data: dict[str, Any] | str) -> TaskDefinition:
    if isinstance(data, str):
        data = json.loads(data)
    return TaskDefinition.model_validate(data)


def load_task_definition(path: str | Path) -> TaskDefinition:
    return parse_task_definition(Path(path).read_text())


def examples_dir() -> Path:
    return Path(__file__).resolve().parent / "packs" / "examples"


def load_example(name: str) -> TaskDefinition:
    """Load a bundled example (`name` without the .json suffix)."""
    return load_task_definition(examples_dir() / f"{name}.json")


# -------------------------------------------------------------- observations
def _norm(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


def _obs_get(obs: Any, *keys: str) -> Any:
    for key in keys:
        if isinstance(obs, dict):
            if obs.get(key) is not None:
                return obs[key]
        else:
            val = getattr(obs, key, None)
            if val is not None:
                return val
    return None


def _obs_keys(obs: Any) -> list[str]:
    return [str(v) for v in (_obs_get(obs, k) for k in _SOURCE_ALIASES) if v]


def _feature_index(task: TaskDefinition) -> dict[str, FeatureDef]:
    idx: dict[str, FeatureDef] = {}
    for f in task.features:
        for raw in (f.name, f.label, f.source or ""):
            if not raw:
                continue
            for token in (raw, raw.split(".")[-1], raw.split("·")[-1], raw.replace("_", " ")):
                idx.setdefault(_norm(token), f)
    return idx


def match_feature(task: TaskDefinition, obs: Any, idx: dict[str, FeatureDef] | None = None) -> FeatureDef | None:
    """Best-effort map one DOM field event / vision reading onto a declared feature."""
    idx = idx if idx is not None else _feature_index(task)
    keys = _obs_keys(obs)
    for key in keys:
        if _norm(key) in idx:
            return idx[_norm(key)]
    for key in keys:
        kt = set(_norm(key).split())
        if not kt:
            continue
        for f in task.features:
            ft = set(_norm(f.name).split()) | set(_norm(f.label).split())
            if kt <= ft:
                return f
    return None


def _parse_number(raw: Any) -> float | None:
    s = _NUM_JUNK.sub("", str(raw).replace("\u00a0", " "))
    if not s or s in {"-", ".", ","}:
        return None
    if "," in s and "." in s:
        # Last separator is the decimal one (handles 1.234,50 and 1,234.50).
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # 1,234 -> thousands; 12,5 -> decimal
        s = s.replace(",", ".") if len(s.split(",")[-1]) <= 2 else s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _parse_bool(raw: Any) -> bool | None:
    token = _norm(raw)
    if token in {"true", "yes", "y", "1", "on", "checked", "attached", "present"}:
        return True
    if token in {"false", "no", "n", "0", "off", "unchecked", "missing", "absent"}:
        return False
    return None


def _parse_date(raw: Any) -> str | None:
    text = str(raw).strip()
    if isinstance(raw, (date, datetime)):
        return raw.date().isoformat() if isinstance(raw, datetime) else raw.isoformat()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def coerce_feature(f: FeatureDef, raw: Any) -> tuple[Any, Availability]:
    """Coerce one raw observation into the feature's type; unreadable values -> (None, 'unreadable')."""
    if raw is None:
        return None, "missing"
    token = _norm(raw)
    if token == "" or token in {"unreadable", "n a", "na", "unknown", "blurred", "redacted", "not visible"}:
        return None, "unreadable"
    if f.type == "num":
        value = _parse_number(raw)
        return (value, "observed") if value is not None else (None, "unreadable")
    if f.type == "bool":
        value = _parse_bool(raw)
        return (value, "observed") if value is not None else (None, "unreadable")
    if f.type == "date":
        value = _parse_date(raw)
        return (value, "observed") if value is not None else (None, "unreadable")
    # cat: canonicalise against the declared options, otherwise keep the raw token.
    for option in f.options:
        if _norm(option) == token:
            return option, "observed"
    return str(raw).strip(), "observed"


def observation_to_case(
    task: TaskDefinition,
    observations: list[Any],
    case_id: str = "case-1",
    *,
    source: str | None = None,
) -> dict[str, Any]:
    """DOM field events / vision readings `{field,label,value}` -> a generic case.

    Every declared feature is materialised, so missingness is explicit (`None`
    plus an availability state). Conflicting readings keep the first value and
    are recorded in `_conflicts`; unmapped readings are recorded in `_unmapped`
    rather than guessed onto a feature. No rule is invented here.
    """
    idx = _feature_index(task)
    facts: dict[str, Any] = {f.name: None for f in task.features}
    availability: dict[str, Availability] = {f.name: "missing" for f in task.features}
    conflicts: list[dict[str, Any]] = []
    unmapped: list[str] = []
    mapped: list[dict[str, Any]] = []

    for obs in observations:
        feature = match_feature(task, obs, idx)
        keys = _obs_keys(obs)
        if feature is None:
            unmapped.extend(keys)
            continue
        raw = _obs_get(obs, "value", "after", "text")
        expert_state = False
        obs_source = _obs_get(obs, "source", "origin")
        if obs_source and _norm(obs_source) in _EXPERT_SOURCES:
            expert_state = True
        elif _norm(source) in _EXPERT_SOURCES:
            expert_state = True
        value, state = coerce_feature(feature, raw)
        if expert_state and state == "observed":
            state = "expert_supplied"
        mapped.append({"feature": feature.name, "keys": keys, "value": value, "availability": state})

        if value is not None and facts[feature.name] is not None and facts[feature.name] != value:
            conflicts.append({"feature": feature.name, "kept": facts[feature.name], "saw": value})
            availability[feature.name] = "conflicting"
            continue  # keep the first grounded reading, do not silently overwrite with a disagreement
        if value is not None and facts[feature.name] is None:
            facts[feature.name] = value
            availability[feature.name] = state
        elif availability[feature.name] == "missing":
            availability[feature.name] = state

    return {
        "id": case_id,
        "facts": facts,
        "booking": {d.name: None for d in task.decision_fields} | {"note": ""},
        "status": "observed",
        "_availability": availability,
        "_observations": mapped,
        "_unmapped": unmapped,
        "_conflicts": conflicts,
    }


def missing_features(task: TaskDefinition, case: dict[str, Any]) -> list[str]:
    facts = case.get("facts") or {}
    return [f.name for f in task.features if facts.get(f.name) is None]


# -------------------------------------------------------------------- prompt
def taskdef_skeleton() -> dict[str, Any]:
    """A minimal shape an LLM should fill in; used by the prompt and the tests."""
    return {
        "id": "snake_case_id",
        "name": "Human name",
        "task": "verb_noun",
        "goal": "what done correctly means",
        "namespace": GENERIC_NAMESPACE,
        "decision_fields": [{"name": "field", "label": "Label", "options": ["a", "b"],
                             "option_labels": {"a": "A"}}],
        "actions": [{"name": "approve", "severity": 0}, {"name": "reject", "severity": 2}],
        "features": [{"name": "amount", "label": "Amount", "type": "num", "source": "App · Amount",
                      "lo": 0, "hi": 1000, "threshold_capable": True, "required": True,
                      "note": "where it is observed"}],
        "steps": [{"id": "S1", "order": 1, "name": "Check the claim"}],
        "process_rules": [{"id": "D1", "title": "written rule", "when": "task.amount > 0",
                           "then": {"field": "a"}, "step_id": "S1"}],
        "exploration_priors": [["amount"]],
    }


def propose_taskdef_prompt(goal: str, sample_observations: list[Any], *, app: str | None = None) -> str:
    """Build (do not send) the LLM prompt that turns a goal + observations into a TaskDefinition."""
    obs = []
    for o in sample_observations:
        if isinstance(o, dict):
            obs.append({k: o[k] for k in ("field", "label", "value") if o.get(k) is not None})
        else:
            obs.append({k: getattr(o, k, None) for k in ("field", "label", "value")
                        if getattr(o, k, None) is not None})
    schema = json.dumps(taskdef_skeleton(), indent=2, sort_keys=True)
    observations = json.dumps(obs, indent=2, sort_keys=True, default=str)
    app_line = f"Application: {app}\n" if app else ""
    return f"""You are helping an AI apprentice learn an unfamiliar workflow from a human demonstration.
Propose a task definition as JSON only. Do not wrap it in commentary or fences.
{app_line}Goal (the human's words, authoritative): {goal}

Observations recorded so far (visible facts and values, with their on-screen labels):
{observations}

Return one JSON object with exactly this shape (types and keys must match; extra keys are allowed):
{schema}

Requirements:
1. Use only feature names and values grounded in the observations or the goal. If the goal implies a fact
   that has not been observed yet, still declare the feature but state in `note` that it is currently
   unobserved; do not invent its value.
2. `type` is one of num, cat, bool, date. A cat feature must list its `options`. A num feature should list
   `lo`/`hi` when the observations bound it.
3. Mark `threshold_capable: true` only for numeric features a boundary decision could depend on, and give
   `lo`/`hi`. Use `threshold_param` only if a specific param name is required; otherwise it defaults to
   `T_<name>`.
4. `source` says where the fact is read on screen, e.g. "Expense form \u00b7 Amount". Preserve the human's
   on-screen labels.
5. `actions` carry an integer `severity` (higher = more severe). `process_rules` are only rules the human
   or a written process actually stated; leave them out rather than guessing policy. `when` uses the
   restricted rule language over the namespace `{GENERIC_NAMESPACE}` and `params` (e.g.
   `{GENERIC_NAMESPACE}.amount > params.T_amount`).
6. Separate observed facts from interpretation. Never encode "what usually happens" as a rule.
7. `exploration_priors` lists small sets of feature names worth probing together when no learned rule
   mentions them yet.
"""


__all__ = [
    "GENERIC_NAMESPACE",
    "AVAILABILITY_STATES",
    "FeatureType",
    "Availability",
    "FeatureDef",
    "DecisionFieldDef",
    "ActionDef",
    "ProcessStepDef",
    "ProcessRuleDef",
    "ProcessGuardrailDef",
    "TaskDefinition",
    "parse_task_definition",
    "load_task_definition",
    "load_example",
    "examples_dir",
    "match_feature",
    "coerce_feature",
    "observation_to_case",
    "missing_features",
    "taskdef_skeleton",
    "propose_taskdef_prompt",
]
