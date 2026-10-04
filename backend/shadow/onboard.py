"""Cold start — "watch me do this".

Learn a workflow from a goal sentence plus a few demonstrations on *any* web
page, with no hand-written pack in the loop:

    goal + [Demo, Demo, Demo]  ->  TaskDefinition  ->  GenericPack  ->  Session

A `Demo` is what `static/observe.js` reports for one act of work: the field
snapshot the page showed, the changes the expert made, and the button they
pressed last. `infer_without_llm` turns those into a task definition with no
model at all (used offline, in tests, and as the repair floor); `propose_task`
asks an LLM to name the fields and actions, then *repairs* the answer against
what was actually observed (unknown fields dropped, options merged, severities
defaulted, rules that reference unseen facts dropped). Anything the LLM gets
wrong degrades to the heuristic, never to an invalid pack.

Generated task definitions are written to `packs/custom/<slug>.json` with a
version. Loading one is `GenericPack(load_custom_taskdef(slug))`; the engine
needs no change at all, because it only ever talks to the `Pack` protocol.

This module is pure data translation. It calls an LLM only in `propose_task`
(and the caller may inject `parse_fn`), never in `infer_without_llm`,
`demos_to_cases`, or the savers.
"""

from __future__ import annotations

import json
import logging
import math
import re
import unicodedata
from collections import OrderedDict
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterable

from pydantic import BaseModel, Field

from shadow import dsl, llm
from shadow.taskdef import (
    GENERIC_NAMESPACE,
    ActionDef,
    DecisionFieldDef,
    FeatureDef,
    ProcessGuardrailDef,
    ProcessRuleDef,
    ProcessStepDef,
    TaskDefinition,
    load_task_definition,
    match_feature,
    observation_to_case,
    propose_taskdef_prompt,
)

log = logging.getLogger("shadow.onboard")

NAME = "Shadow"  # the product name lives here and nowhere else
CUSTOM_PACK_DIR = Path(__file__).resolve().parent / "packs" / "custom"

_IDENT_BAD = re.compile(r"[^a-z0-9]+")
_STOPWORDS = {
    "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "with", "each", "new", "this", "that", "by",
    "from", "my", "our", "all", "any", "when", "how", "what", "which", "into", "at", "is", "are", "do", "does",
}
_PROCESS_WORD = re.compile(r".*(ing|tion|sion|ment|ance|ence|al|ed)$")


# --------------------------------------------------------------------- demo
class ObservedField(BaseModel):
    """One control as `observe.js` reports it (values are already privacy-filtered)."""

    name: str
    label: str = ""
    kind: str = "text"  # html control: text/select/checkbox/number/date/...
    value_kind: str = "text"  # num/cat/bool/date/text
    options: list[str] = Field(default_factory=list)
    value: Any = None
    redacted: bool = False


class ObservedAction(BaseModel):
    name: str
    label: str = ""


class Demo(BaseModel):
    """One act of work: what the page showed, what changed, and the final button."""

    url: str = ""
    title: str = ""
    case_id: str | None = None
    fields: list[ObservedField] = Field(default_factory=list)
    changes: list[dict[str, Any]] = Field(default_factory=list)
    action: ObservedAction | None = None

    @classmethod
    def from_events(cls, events: Iterable[Any]) -> "Demo":
        """Fold an observe.js event stream (observe + field_changed + action) into one Demo."""
        fields: list[dict[str, Any]] = []
        changes: list[dict[str, Any]] = []
        action: dict[str, Any] | None = None
        url = ""
        title = ""
        for raw in events or []:
            e = _as_dict(raw)
            kind = e.get("type")
            if kind == "observe":
                fields = [f for f in (e.get("fields") or [])]
                url = e.get("url") or url
                title = e.get("title") or title
            elif kind == "field_changed":
                change = {k: e[k] for k in ("field", "label", "before", "after", "kind", "value_kind", "redacted")
                          if k in e}
                changes.append(change)
            elif kind == "action":
                action = {"name": e.get("name") or "", "label": e.get("label") or ""}
        return cls(url=url, title=title, fields=fields, changes=changes, action=action)

    def final_values(self) -> dict[str, Any]:
        """The expert's last value per observed field (redacted fields stay out)."""
        out: dict[str, Any] = {}
        for ch in self.changes:
            if ch.get("redacted"):
                continue
            key = _norm(ch.get("field"))
            if key and ch.get("after") is not None:
                out[key] = ch["after"]
        return out


def _as_dict(obj: Any) -> dict[str, Any]:
    if isinstance(obj, dict):
        return dict(obj)
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    return dict(obj)


def as_demo(obj: Any) -> Demo:
    """Accept a Demo, a dict, or a pydantic model that looks like one."""
    if isinstance(obj, Demo):
        return obj
    return Demo.model_validate(_as_dict(obj))


# ------------------------------------------------------------------- utils
def _norm(text: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


def _unique(seq: Iterable[Any]) -> list[Any]:
    out: list[Any] = []
    for x in seq:
        if x is None or x == "":
            continue
        if x not in out:
            out.append(x)
    return out


def _unique_str(seq: Iterable[Any]) -> list[str]:
    return [str(x) for x in _unique(seq)]


def _hashable(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


def slug(text: Any, fallback: str = "custom_task") -> str:
    raw = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    s = _IDENT_BAD.sub("_", raw.lower()).strip("_")
    return s or fallback


def _identifier(text: Any, fallback: str = "field") -> str:
    s = slug(text, fallback=fallback)
    if s and s[0].isdigit():
        s = "f_" + s
    return s or fallback


def _id_text(text: Any, fallback: str) -> str:
    """Keep rule/step ids readable (D1, G1, S1) instead of forcing snake_case."""
    s = re.sub(r"[^A-Za-z0-9_]+", "_", str(text or "")).strip("_")
    return s or fallback


def _nice_step(lo: float, hi: float) -> float:
    span = max(float(hi) - float(lo), 1e-9)
    raw = span / 40.0
    mag = 10 ** math.floor(math.log10(raw))
    for mult in (1, 2, 5, 10):
        if raw <= mult * mag:
            return round(mult * mag, 6)
    return round(10 * mag, 6)


def _type_from_value_kind(value_kind: str) -> str:
    vk = (value_kind or "text").lower()
    if vk in ("num", "number", "int", "float", "currency"):
        return "num"
    if vk in ("bool", "boolean", "checkbox"):
        return "bool"
    if vk in ("date", "datetime", "time"):
        return "date"
    return "cat"


def _guess_case_noun(goal: str, title: str) -> str:
    """Pick the thing being worked on from the page title, e.g. 'Support ticket escalation' -> ticket."""
    tokens = re.findall(r"[a-z]+", (title or goal or "").lower())
    for i in range(len(tokens) - 2, -1, -1):
        if _PROCESS_WORD.match(tokens[i + 1]) and tokens[i] not in _STOPWORDS:
            return tokens[i]
    for token in tokens:
        if token not in _STOPWORDS and not _PROCESS_WORD.match(token):
            return token
    return "case"


_SEVERITY_HINTS: tuple[tuple[str, int], ...] = (
    (r"reject|deny|decline|delete|discard|cancel|close|block|fail", 4),
    (r"escalat|urgent|priority|hold|send.?back|return|reopen|reassign|assign|route", 3),
    (r"review|approve|second|forward|manager|finance", 2),
    (r"resolve|complete|submit|send|save|apply|confirm|accept|done|publish", 1),
)


def _default_severity(action_name: str) -> int:
    hay = _norm(action_name)
    for pattern, severity in _SEVERITY_HINTS:
        if re.search(pattern, hay):
            return severity
    return 0


# ------------------------------------------------------------------ observe
def _observed_records(demos: list[Demo]) -> "OrderedDict[str, dict[str, Any]]":
    """Merge the field snapshots and changes of every demo into one record per field."""
    obs: "OrderedDict[str, dict[str, Any]]" = OrderedDict()

    def get(key: str, *, name: str = "", label: str = "", kind: str = "", value_kind: str = "",
            title: str = "") -> dict[str, Any]:
        if key not in obs:
            obs[key] = {"name": name or key.replace(" ", "_"), "label": label, "kind": kind,
                        "value_kind": value_kind or "text", "options": [], "values": [],
                        "changed": False, "title": title}
        rec = obs[key]
        if name and not rec["name"]:
            rec["name"] = name
        if label and not rec["label"]:
            rec["label"] = label
        if kind and not rec["kind"]:
            rec["kind"] = kind
        if value_kind and (not rec["value_kind"] or rec["value_kind"] == "text"):
            rec["value_kind"] = value_kind
        if title and not rec["title"]:
            rec["title"] = title
        return rec

    for demo in demos:
        for field in demo.fields:
            key = _norm(field.name) or _norm(field.label)
            if not key:
                continue
            rec = get(key, name=field.name, label=field.label, kind=field.kind,
                      value_kind=field.value_kind, title=demo.title)
            for option in field.options:
                if option is not None and str(option) not in rec["options"]:
                    rec["options"].append(str(option))
            if field.value is not None and field.value_kind != "text" and field.value not in rec["values"]:
                rec["values"].append(field.value)
        for change in demo.changes:
            key = _norm(change.get("field"))
            if not key:
                continue
            rec = get(key, name=str(change.get("field") or ""), label=str(change.get("label") or ""),
                      kind=str(change.get("kind") or ""), value_kind=str(change.get("value_kind") or ""),
                      title=demo.title)
            rec["changed"] = True
            if change.get("redacted"):
                rec["value_kind"] = "text" if rec["value_kind"] == "text" else rec["value_kind"]
                continue
            after = change.get("after")
            if after is None:
                continue
            vk = str(change.get("value_kind") or "")
            if vk and (not rec["value_kind"] or rec["value_kind"] == "text"):
                rec["value_kind"] = vk
            if after not in rec["values"]:
                rec["values"].append(after)
    return obs


def _feature_from_record(rec: dict[str, Any]) -> FeatureDef:
    value_kind = rec.get("value_kind") or "text"
    ftype = _type_from_value_kind(value_kind)
    label = rec.get("label") or rec.get("name") or "field"
    source = f"{rec.get('title') or 'Observed page'} · {label}"
    values = [v for v in rec.get("values", []) if v is not None]
    options: list[str] = []
    lo = hi = step = scale = None
    threshold_capable = False
    pool: list[Any] = []
    if ftype == "num":
        nums = [float(v) for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
        lo = min(nums) if nums else 0.0
        hi = max(nums) if nums else 100.0
        if hi <= lo:
            hi = lo + max(100.0, abs(lo) * 1.5)
        step = _nice_step(lo, hi)
        scale = max((hi - lo) / 20.0, 1.0)
        threshold_capable = True
        pool = nums
    elif ftype == "cat":
        options = _unique_str([*rec.get("options", []), *values])
        pool = options
    elif ftype == "date":
        pool = _unique_str(values)
    note = (f"Observed in {len(values)} demonstration value(s)." if values
            else "Declared by the goal; not observed yet.")
    return FeatureDef(name=_identifier(rec.get("name"), "field"), label=label, type=ftype, source=source,
                      options=options, lo=lo, hi=hi, step=step, scale=scale, values=pool,
                      threshold_capable=threshold_capable, note=note)


def _features_from_records(records: "OrderedDict[str, dict[str, Any]]") -> list[FeatureDef]:
    return [_feature_from_record(rec) for rec in records.values()]


# --------------------------------------------------------------- decisions
def _decision_values(demos: list[Demo]) -> "OrderedDict[str, list[Any]]":
    """field -> the expert's values, in demo order (redacted changes count as a distinct empty value)."""
    finals: "OrderedDict[str, list[Any]]" = OrderedDict()
    for demo in demos:
        for change in demo.changes:
            key = _norm(change.get("field"))
            if not key:
                continue
            value = "" if change.get("redacted") else change.get("after")
            finals.setdefault(key, []).append("" if value is None else value)
    return finals


def _decision_field_defs(demos: list[Demo], features: list[FeatureDef]) -> list[DecisionFieldDef]:
    by_norm: dict[str, FeatureDef] = {}
    for feature in features:
        by_norm.setdefault(_norm(feature.name), feature)
        if feature.label:
            by_norm.setdefault(_norm(feature.label), feature)
    finals = _decision_values(demos)
    varying = [key for key, values in finals.items()
               if len({_hashable(v) for v in values}) >= 2]
    chosen = varying or list(finals)
    out: list[DecisionFieldDef] = []
    for key in chosen:
        feature = by_norm.get(key)
        values = [v for v in finals[key] if v not in (None, "")]
        options = _unique_str(values) if values else []
        out.append(DecisionFieldDef(
            name=feature.name if feature else _identifier(key),
            label=(feature.label if feature else "") or key,
            options=options,
            option_labels={o: o for o in options},
        ))
    return out


def _actions_from_demos(demos: list[Demo]) -> list[ActionDef]:
    seen: "OrderedDict[str, str]" = OrderedDict()
    for demo in demos:
        if demo.action and demo.action.name:
            seen.setdefault(_identifier(demo.action.name, "action"), demo.action.label or demo.action.name)
    out = [ActionDef(name=name, label=label, severity=_default_severity(name)) for name, label in seen.items()]
    if out and all(a.severity == 0 for a in out):
        for i, action in enumerate(out):
            action.severity = max(0, len(out) - 1 - i)
    return out


def _infer_priors(decisions: list[DecisionFieldDef], features: list[FeatureDef]) -> list[list[str]]:
    feature_names = {f.name for f in features}
    priors = [[d.name] for d in decisions if d.name in feature_names]
    if not priors:
        priors = [[f.name] for f in features[:3]]
    return priors


def _steps_for(decisions: list[DecisionFieldDef]) -> list[ProcessStepDef]:
    if decisions:
        return [ProcessStepDef(id=f"S{i + 1}", order=i + 1, name=f"Decide {d.label or d.name}",
                               decision_field=d.name) for i, d in enumerate(decisions)]
    return [ProcessStepDef(id="S1", order=1, name="Work the case")]


# ------------------------------------------------------------------ infer
def infer_without_llm(goal: str, demos: list[Any], *, task_id: str | None = None,
                      name: str | None = None) -> TaskDefinition:
    """Heuristic task definition: no model, no network, deterministic.

    Decision fields are the fields the expert changed whose final value varies
    across demos (a single-demo run falls back to every changed field). Actions
    are the buttons pressed last. Every observed field becomes a feature.
    """
    demos = [as_demo(d) for d in demos]
    records = _observed_records(demos)
    features = _features_from_records(records)
    decisions = _decision_field_defs(demos, features)
    actions = _actions_from_demos(demos)
    title = demos[0].title if demos else ""
    resolved_goal = goal or (f"Handle each {_guess_case_noun('', title)} the way the expert does.")
    tid = _identifier(task_id or title or resolved_goal, "custom_task")
    task = TaskDefinition(
        id=tid,
        name=name or title or resolved_goal[:60],
        task=tid,
        goal=resolved_goal,
        case_noun=_guess_case_noun(resolved_goal, title),
        namespace=GENERIC_NAMESPACE,
        version=1,
        decision_fields=decisions,
        actions=actions,
        features=features,
        steps=_steps_for(decisions),
        exploration_priors=_infer_priors(decisions, features),
        describe_fields=[f.name for f in features[:4]],
    )
    return _attach_demos(task, demos)


def _attach_demos(task: TaskDefinition, demos: list[Demo]) -> TaskDefinition:
    """Keep the demonstrations with the task, so a Session built on the pack replays them."""
    if not demos:
        return task
    task.demo = {"capture": demos_to_cases(task, demos)}
    return task


# ------------------------------------------------------------------- LLM path
class _ProposalFeature(BaseModel):
    name: str = ""
    label: str = ""
    type: str = "cat"
    source: str | None = None
    unit: str | None = None
    options: list[str] = Field(default_factory=list)
    lo: float | None = None
    hi: float | None = None
    step: float | None = None
    scale: float | None = None
    threshold_capable: bool = False
    threshold_param: str | None = None
    required: bool = False
    note: str | None = None


class _ProposalDecisionField(BaseModel):
    name: str = ""
    label: str = ""
    options: list[str] = Field(default_factory=list)
    option_labels: dict[str, str] = Field(default_factory=dict)


class _ProposalAction(BaseModel):
    name: str = ""
    label: str = ""
    severity: int = 0


class _ProposalStep(BaseModel):
    id: str = ""
    order: int = 0
    name: str = ""
    description: str = ""
    decision_field: str | None = None
    rule_ids: list[str] = Field(default_factory=list)


class _ThenPair(BaseModel):
    field: str = ""
    value: str = ""


class _ProposalRule(BaseModel):
    id: str = ""
    title: str = ""
    when: str = "True"
    then: list[_ThenPair] = Field(default_factory=list)
    step_id: str | None = None


class _ProposalGuardrail(BaseModel):
    id: str = ""
    title: str = ""
    when: str = "True"
    type: str = "hard_limit"
    action: str = "block"
    ask: str | None = None
    step_id: str | None = None


class OnboardProposal(BaseModel):
    """A permissive, LLM-shaped task definition. Validated and repaired before it becomes a TaskDefinition."""

    id: str = ""
    name: str = ""
    task: str = ""
    goal: str = ""
    case_noun: str = "case"
    expert_name: str = "expert"
    namespace: str = GENERIC_NAMESPACE
    process_doc: str | None = None
    decision_fields: list[_ProposalDecisionField] = Field(default_factory=list)
    actions: list[_ProposalAction] = Field(default_factory=list)
    features: list[_ProposalFeature] = Field(default_factory=list)
    steps: list[_ProposalStep] = Field(default_factory=list)
    process_rules: list[_ProposalRule] = Field(default_factory=list)
    process_guardrails: list[_ProposalGuardrail] = Field(default_factory=list)
    exploration_priors: list[list[str]] = Field(default_factory=list)
    describe_fields: list[str] = Field(default_factory=list)


SYSTEM = (f"You are {NAME}'s onboarding compiler. From a goal sentence and a few recorded demonstrations of a "
          "human working a web form, you describe the workflow as data: the facts on screen, the decisions the "
          "expert made, and the actions they took. Ground every field in an observed control. Never invent a fact "
          "or a policy that the demonstrations or the goal do not support; leave a threshold unstated rather "
          "than guessing it. If nothing shows a rule, return no rules.")

_PAIR_NOTE = (
    "Machine note for THIS call: express each process rule's `then` as a JSON array of objects "
    "`[{\"field\": \"<decision field name>\", \"value\": \"<value>\"}]`. Use exactly the namespace `task` in "
    "`when` expressions and write thresholds as `params.T_<name>`. Keep action and decision-field names to "
    "lowercase snake_case."
)

ParseFn = Callable[..., Awaitable[Any]]


async def propose_task(goal: str, demos: list[Any], *, parse_fn: ParseFn | None = None,
                       task_id: str | None = None, app: str | None = None, save: bool = False,
                       directory: str | Path | None = None) -> TaskDefinition:
    """Goal + demonstrations -> validated TaskDefinition (LLM-named, then repaired).

    `parse_fn` defaults to `llm.parse`; inject a fake in tests or to force the offline path.
    Any failure falls back to `infer_without_llm`, so a bad model answer never produces a bad pack.
    """
    demos = [as_demo(d) for d in demos]
    if not demos:
        task = infer_without_llm(goal, demos, task_id=task_id)
        if save:
            save_task_definition(task, directory=directory)
        return task
    parse_fn = parse_fn or llm.parse
    observations = [{"field": f.name, "label": f.label, "value": f.value}
                    for demo in demos for f in demo.fields if f.value is not None]
    prompt = propose_taskdef_prompt(goal, observations, app=app)
    prompt += ("\n\n" + _PAIR_NOTE + "\n\nDemonstrations (the expert's own changes and final action):\n"
               + json.dumps([_demo_summary(d) for d in demos], indent=2, default=str))
    try:
        proposal = await parse_fn(OnboardProposal, SYSTEM, prompt, tier="reason", max_tokens=4000)
        task = repair_proposal(_as_dict(proposal), goal, demos, task_id=task_id)
    except Exception:  # noqa: BLE001 - onboarding must work without a provider
        log.exception("onboard proposal failed; falling back to heuristics")
        task = infer_without_llm(goal, demos, task_id=task_id)
    if save:
        save_task_definition(task, directory=directory)
    return task


def _demo_summary(demo: Demo) -> dict[str, Any]:
    finals: dict[str, Any] = {}
    for change in demo.changes:
        if change.get("redacted"):
            continue
        key = change.get("field")
        if key and change.get("after") is not None:
            finals[str(key)] = change["after"]
    return {"url": demo.url, "title": demo.title, "final": finals,
            "action": (demo.action.label or demo.action.name) if demo.action else None}


# --------------------------------------------------------------------- repair
def repair_proposal(proposal: Any, goal: str, demos: list[Any], *,
                    task_id: str | None = None) -> TaskDefinition:
    """Turn an LLM proposal into a valid TaskDefinition, or fall back to the heuristics."""
    demos = [as_demo(d) for d in demos]
    data = _as_dict(proposal)
    try:
        return _build_from_proposal(data, goal, demos, task_id=task_id)
    except Exception:  # noqa: BLE001 - a hallucinated pack must never reach the engine
        log.exception("onboard proposal could not be repaired; using heuristics")
        return infer_without_llm(goal, demos, task_id=task_id)


def _token_index(records: "OrderedDict[str, dict[str, Any]]") -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for rec in records.values():
        for raw in (rec.get("name"), rec.get("label")):
            if not raw:
                continue
            key = _norm(raw)
            index.setdefault(key, rec)
            tail = key.split()[-1] if key else ""
            if tail:
                index.setdefault(tail, rec)
    return index


def _find_record(index: dict[str, dict[str, Any]], *tokens: Any) -> dict[str, Any] | None:
    for token in tokens:
        if not token:
            continue
        key = _norm(token)
        if key in index:
            return index[key]
        tail = key.split()[-1] if key else ""
        if tail and tail in index:
            return index[tail]
    for token in tokens:  # last resort: fuzzy containment
        key = _norm(token)
        if len(key) < 3:
            continue
        for candidate, rec in index.items():
            if key in candidate or candidate in key:
                return rec
    return None


def _refs_known(expr: str, feature_names: set[str], namespace: str = GENERIC_NAMESPACE) -> bool:
    try:
        referenced = dsl.fields_referenced(expr)
    except dsl.DSLError:
        return False
    for dotted in referenced:
        parts = dotted.split(".")
        if parts[0] == "params":
            continue
        name = parts[1] if parts[0] == namespace and len(parts) > 1 else parts[0]
        if name not in feature_names:
            return False
    return True


def _build_from_proposal(data: dict[str, Any], goal: str, demos: list[Demo], *,
                         task_id: str | None) -> TaskDefinition:
    records = _observed_records(demos)
    index = _token_index(records)
    inferred_features = _features_from_records(records)

    # -------- features: keep only those grounded in an observed control; merge options
    features: list[FeatureDef] = []
    seen_names: set[str] = set()
    for pf in data.get("features") or []:
        pf = _as_dict(pf)
        rec = _find_record(index, pf.get("name"), pf.get("label"), pf.get("source"))
        if rec is None:
            continue
        base = _feature_from_record(rec)
        name = _identifier(pf.get("name") or base.name, base.name)
        if name in seen_names:
            continue
        seen_names.add(name)
        ftype = str(pf.get("type") or "").lower()
        if ftype not in ("num", "cat", "bool", "date"):
            ftype = base.type
        options = _unique_str([*(pf.get("options") or []), *rec.get("options", []), *rec.get("values", [])]) \
            if ftype == "cat" else []
        features.append(FeatureDef(
            name=name,
            label=pf.get("label") or base.label or name,
            type=ftype,
            source=pf.get("source") or base.source,
            unit=pf.get("unit") or base.unit,
            options=options,
            lo=pf.get("lo") if pf.get("lo") is not None else base.lo,
            hi=pf.get("hi") if pf.get("hi") is not None else base.hi,
            step=pf.get("step") if pf.get("step") is not None else base.step,
            scale=pf.get("scale") if pf.get("scale") is not None else base.scale,
            threshold_capable=bool(pf.get("threshold_capable") or base.threshold_capable),
            threshold_param=pf.get("threshold_param"),
            required=bool(pf.get("required")),
            note=pf.get("note") or base.note,
            values=options if ftype == "cat" else base.values,
        ))
    if not features:
        features = inferred_features
    feature_names = {f.name for f in features}

    # -------- decision fields: grounded, options merged from what was observed
    decisions: list[DecisionFieldDef] = []
    for pd in data.get("decision_fields") or []:
        pd = _as_dict(pd)
        rec = _find_record(index, pd.get("name"), pd.get("label"))
        feature = next((f for f in features if _norm(f.name) == _norm(pd.get("name"))
                        or (pd.get("label") and _norm(f.label) == _norm(pd.get("label")))), None)
        if rec is None and feature is None:
            continue
        name = _identifier(pd.get("name") or (feature.name if feature else rec["name"]),
                           feature.name if feature else "field")
        if any(d.name == name for d in decisions):
            continue
        label = pd.get("label") or (feature.label if feature else rec.get("label")) or name
        observed = [*rec.get("options", []), *rec.get("values", [])] if rec else []
        declared = dict(pd.get("option_labels") or {})
        options = _unique_str([*(pd.get("options") or []), *declared.keys(), *observed])
        decisions.append(DecisionFieldDef(name=name, label=label, options=options,
                                          option_labels={**{o: o for o in options}, **declared}))
    if not decisions:
        decisions = _decision_field_defs(demos, features)
    decision_names = {d.name for d in decisions}

    # -------- actions: defaulted severity
    actions: list[ActionDef] = []
    for pa in data.get("actions") or []:
        pa = _as_dict(pa)
        if not pa.get("name"):
            continue
        name = _identifier(pa["name"], "action")
        if any(a.name == name for a in actions):
            continue
        actions.append(ActionDef(name=name, label=pa.get("label") or str(pa["name"]),
                                 severity=int(pa.get("severity") or 0)))
    if not actions:
        actions = _actions_from_demos(demos)
    if actions and all(a.severity == 0 for a in actions):
        for action in actions:
            action.severity = _default_severity(action.name)
    if actions and all(a.severity == 0 for a in actions):
        for i, action in enumerate(actions):
            action.severity = max(0, len(actions) - 1 - i)
    action_names = {a.name for a in actions}

    # -------- rules: drop unknown fields, unparseable conditions, unknown targets
    rules: list[ProcessRuleDef] = []
    for pr in data.get("process_rules") or []:
        pr = _as_dict(pr)
        when = str(pr.get("when") or "True")
        try:
            dsl.validate(when)
        except dsl.DSLError:
            continue
        then: dict[str, Any] = {}
        raw_then = pr.get("then") or []
        pairs = ([{"field": k, "value": v} for k, v in raw_then.items()] if isinstance(raw_then, dict)
                 else [_as_dict(p) for p in raw_then])
        for pair in pairs:
            field, value = pair.get("field"), pair.get("value")
            if field in decision_names and value is not None:
                then[str(field)] = value
        if not then or not _refs_known(when, feature_names):
            continue
        rules.append(ProcessRuleDef(id=_id_text(pr.get("id") or f"D{len(rules) + 1}", "D"),
                                    title=pr.get("title") or when, when=when, then=then,
                                    step_id=pr.get("step_id")))

    guardrails: list[ProcessGuardrailDef] = []
    for pg in data.get("process_guardrails") or []:
        pg = _as_dict(pg)
        when = str(pg.get("when") or "True")
        try:
            dsl.validate(when)
        except dsl.DSLError:
            continue
        action = str(pg.get("action") or "block")
        if action != "block" and action not in action_names:
            continue
        if not _refs_known(when, feature_names):
            continue
        gtype = str(pg.get("type") or "hard_limit")
        if gtype not in ("hard_limit", "stop_and_ask", "hold", "second_approval"):
            gtype = "hard_limit"
        guardrails.append(ProcessGuardrailDef(id=_id_text(pg.get("id") or f"G{len(guardrails) + 1}", "G"),
                                              title=pg.get("title") or when, when=when, type=gtype, action=action,
                                              ask=pg.get("ask"), step_id=pg.get("step_id")))

    steps: list[ProcessStepDef] = []
    for ps in data.get("steps") or []:
        ps = _as_dict(ps)
        decision_field = ps.get("decision_field")
        if decision_field and decision_field not in decision_names:
            decision_field = None
        steps.append(ProcessStepDef(id=_id_text(ps.get("id") or f"S{len(steps) + 1}", "S"),
                                    order=int(ps.get("order") or len(steps) + 1),
                                    name=ps.get("name") or (f"Decide {decision_field}" if decision_field else "Step"),
                                    description=ps.get("description") or "",
                                    decision_field=decision_field,
                                    rule_ids=[r for r in (ps.get("rule_ids") or [])]))
    if not steps:
        steps = _steps_for(decisions)

    title = demos[0].title if demos else ""
    resolved_goal = data.get("goal") or goal or f"Handle each {_guess_case_noun('', title)} the way the expert does."
    tid = _identifier(task_id or data.get("id") or data.get("task") or data.get("name") or title or resolved_goal,
                      "custom_task")
    priors = [[str(n) for n in (p or []) if str(n) in feature_names]
              for p in (data.get("exploration_priors") or [])]
    priors = [p for p in priors if p] or _infer_priors(decisions, features)
    describe = [str(n) for n in (data.get("describe_fields") or []) if str(n) in feature_names]
    task = TaskDefinition(
        id=tid,
        name=data.get("name") or title or resolved_goal[:60],
        task=_identifier(data.get("task") or tid, tid),
        goal=resolved_goal,
        case_noun=str(data.get("case_noun") or _guess_case_noun(resolved_goal, title)),
        expert_name=str(data.get("expert_name") or "expert"),
        namespace=GENERIC_NAMESPACE,  # never trust the model's namespace
        version=1,
        process_doc=data.get("process_doc"),
        decision_fields=decisions,
        actions=actions,
        features=features,
        steps=steps,
        process_rules=rules,
        process_guardrails=guardrails,
        exploration_priors=priors,
        describe_fields=describe or [f.name for f in features[:4]],
    )
    return _attach_demos(task, demos)


# ------------------------------------------------------------------- cases
def _final_by_decision(task: TaskDefinition, demo: Demo, case: dict[str, Any]) -> dict[str, Any]:
    finals: dict[str, Any] = {}
    for change in demo.changes:
        if change.get("redacted") or change.get("after") is None:
            continue
        key = _norm(change.get("field"))
        decision = next((d for d in task.decision_fields
                         if _norm(d.name) == key or (d.label and _norm(d.label) == key)), None)
        if decision is None:
            feature = match_feature(task, {"field": change.get("field")})
            if feature is not None:
                decision = next((d for d in task.decision_fields
                                 if d.name == feature.name or _norm(d.label) == _norm(feature.label)), None)
        if decision is not None:
            finals[decision.name] = change["after"]
    for decision in task.decision_fields:  # the expert left it as the page had it
        if decision.name in finals:
            continue
        feature = match_feature(task, {"field": decision.name, "label": decision.label})
        if feature is not None and case.get("facts", {}).get(feature.name) is not None:
            finals[decision.name] = case["facts"][feature.name]
    return finals


def demos_to_cases(task: TaskDefinition, demos: list[Any]) -> list[dict[str, Any]]:
    """Map demonstrations onto engine-ready cases.

    Facts are the snapshot values the page showed (what the AI sees); `booking`
    carries the expert's final decision values (what behavior will dispose), and
    `_action` the button they pressed.
    """
    out: list[dict[str, Any]] = []
    for i, demo in enumerate([as_demo(d) for d in demos]):
        observations = [{"field": f.name, "label": f.label, "value": f.value, "source": "field"}
                        for f in demo.fields if f.value is not None]
        case_id = demo.case_id or f"{task.id}-demo-{i + 1}"
        case = observation_to_case(task, observations, case_id=case_id)
        case["booking"] = {**case.get("booking", {}), **_final_by_decision(task, demo, case)}
        case["_demo"] = True
        case["_action"] = demo.action.name if demo.action else None
        case["_source_url"] = demo.url
        out.append(case)
    return out


# ------------------------------------------------------------------- storage
def custom_dir() -> Path:
    CUSTOM_PACK_DIR.mkdir(parents=True, exist_ok=True)
    return CUSTOM_PACK_DIR


def save_task_definition(task: TaskDefinition, *, directory: str | Path | None = None,
                         overwrite: bool = True) -> Path:
    """Write `packs/custom/<slug>.json`, bumping the version when the file already exists."""
    target = Path(directory) if directory else custom_dir()
    target.mkdir(parents=True, exist_ok=True)
    slug_name = _identifier(task.id or task.name, "custom_task")
    path = target / f"{slug_name}.json"
    saved = task.model_copy(deep=True)
    if path.exists():
        try:
            prior = load_task_definition(path)
            saved.version = max(prior.version, saved.version) + 1
        except Exception:  # noqa: BLE001 - a broken old file must not block a new save
            saved.version = saved.version + 1
    if not overwrite and path.exists():
        path = target / f"{slug_name}-v{saved.version}.json"
    path.write_text(json.dumps(saved.model_dump(mode="json"), indent=2, sort_keys=True, ensure_ascii=False) + "\n")
    return path


def load_custom_taskdef(task_id: str) -> TaskDefinition:
    return load_task_definition(custom_dir() / f"{_identifier(task_id, 'custom_task')}.json")


def list_custom() -> list[str]:
    return sorted(p.stem for p in custom_dir().glob("*.json"))


__all__ = [
    "NAME",
    "Demo",
    "ObservedAction",
    "ObservedField",
    "OnboardProposal",
    "as_demo",
    "custom_dir",
    "demos_to_cases",
    "infer_without_llm",
    "list_custom",
    "load_custom_taskdef",
    "propose_task",
    "repair_proposal",
    "save_task_definition",
    "slug",
]
