"""GenericPack \u2014 a `TaskDefinition` behind the same `Pack` surface as the
hand-written invoice pack.

The engine never imports a domain module; it only calls the `Pack` protocol
(`derive`, `normalize`, `perturb`, `describe`, `describe_delta`, `generate_cases`,
`seed_map`, `threshold_params`, `threshold_variant`, `demo_cases`). `GenericPack`
implements that protocol from data, so a second workflow (here: employee expense
approval) is a JSON file, not code. See
`advisory/product-engine-investigation-2026-10-03/NOVEL_TASK_LEARNING_PROPOSAL.md`
\u00a7\u00a73 and 9.
"""

from __future__ import annotations

import copy
import random
from datetime import date, timedelta
from typing import Any, Iterator

from shadow.packs.base import FieldSpec
from shadow.taskdef import FeatureDef, TaskDefinition, load_task_definition

_MISSING = object()


def _facts(case: dict[str, Any]) -> dict[str, Any]:
    """Read a generic case's facts, tolerating a flat layout for hand-written fixtures."""
    facts = case.get("facts")
    return dict(facts) if isinstance(facts, dict) else {}


class GenericPack:
    """Turn a `TaskDefinition` into the agent's workflow adapter."""

    def __init__(self, task: TaskDefinition, *, pack_id: str | None = None):
        self.task_def = task
        self.namespace = task.namespace or "task"
        self.id = pack_id or task.id
        self.name = task.name
        self.task = task.task
        self.goal = task.goal
        self.expert_name = task.expert_name
        self.case_noun = task.case_noun
        self.process_doc = task.process_doc or ""
        self.decision_fields = [FieldSpec(d.name, d.label or d.name, list(d.options) or None, dict(d.option_labels))
                                for d in task.decision_fields]
        self.actions = task.action_names()
        self.action_labels = {a.name: (a.label or a.name) for a in task.actions}
        self.action_precedence = task.precedence()
        self.exploration_priors = [set(p) for p in task.exploration_priors]
        # Derived helper keys that move with every perturbation but carry no decision
        # meaning; the engine subtracts these before judging "novel facts".
        self.derive_noise = {"id"} | {f"{f.name}_{part}" for f in task.features if f.type == "date"
                                      for part in ("month", "day")}

    # ------------------------------------------------------------- cases
    def _materialize(self, case: dict[str, Any]) -> dict[str, Any]:
        out = copy.deepcopy(case)
        facts = _facts(out)
        for f in self.task_def.features:
            facts.setdefault(f.name, None)
        out["facts"] = facts
        base = dict(out.get("booking") or {})
        for d in self.task_def.decision_fields:
            base.setdefault(d.name, None)
        base.setdefault("note", "")
        out["booking"] = base
        out.setdefault("id", "case-?")
        out.setdefault("status", "submitted")
        return out

    def _reference_date(self) -> date:
        try:
            return date.fromisoformat(self.task_def.reference_date)
        except ValueError:
            return date(2026, 10, 3)

    def _sample(self, f: FeatureDef, rng: random.Random) -> Any:
        pool = f.values or (f.options if f.type == "cat" else [])
        if pool:
            if f.weights and len(f.weights) == len(pool):
                return rng.choices(pool, weights=f.weights, k=1)[0]
            return rng.choice(pool)
        if f.type == "num":
            lo = 0.0 if f.lo is None else float(f.lo)
            hi = 100.0 if f.hi is None else float(f.hi)
            value = rng.uniform(lo, hi)
            return self._round(value, f)
        if f.type == "bool":
            return rng.random() < 0.5
        if f.type == "date":
            return (self._reference_date() + timedelta(days=rng.randint(-45, 45))).isoformat()
        return None

    @staticmethod
    def _round(value: float, f: FeatureDef) -> float:
        if f.step:
            value = round(round(value / f.step) * f.step, 6)
        return round(value, 2)

    def generate_cases(self, n: int, seed: int = 0) -> list[dict[str, Any]]:
        rng = random.Random(seed)
        out: list[dict[str, Any]] = []
        for i in range(n):
            facts = {f.name: self._sample(f, rng) for f in self.task_def.features}
            out.append(self._materialize({"id": f"gen-{seed}-{i}", "facts": facts, "status": "submitted"}))
        return out

    def demo_cases(self) -> dict[str, list[dict[str, Any]]]:
        demo = self.task_def.demo or {}
        out: dict[str, list[dict[str, Any]]] = {k: [self._materialize(c) for c in v] for k, v in demo.items()}
        if not out.get("capture"):
            out["capture"] = self.generate_cases(4, seed=self.task_def.demo_seed)
        if not out.get("tutor"):
            out["tutor"] = self.generate_cases(3, seed=self.task_def.demo_seed + 1)
        return out

    # ------------------------------------------------------- rule language ctx
    def derive(self, case: dict[str, Any]) -> dict[str, Any]:
        """Rule-language context: every declared feature (None when unobserved) under `self.namespace`."""
        facts = _facts(case)
        ns: dict[str, Any] = {"id": case.get("id")}
        for f in self.task_def.features:
            value = facts.get(f.name)
            ns[f.name] = value
            if f.type == "date" and value:
                try:
                    d = date.fromisoformat(str(value))
                except ValueError:
                    continue
                ns[f"{f.name}_month"] = d.month
                ns[f"{f.name}_day"] = d.day
                ns[f"{f.name}_days_ago"] = (self._reference_date() - d).days
        # date helpers are present-only; declare nothing else so missingness stays explicit.
        for f in self.task_def.features:
            if f.type == "date":
                ns.setdefault(f"{f.name}_month", None)
                ns.setdefault(f"{f.name}_day", None)
                ns.setdefault(f"{f.name}_days_ago", None)
        return {self.namespace: ns}

    def normalize(self, case: dict[str, Any], booking: dict[str, Any] | None) -> dict[str, Any]:
        booking = booking or {}
        out: dict[str, Any] = {}
        for d in self.task_def.decision_fields:
            value = booking.get(d.name)
            if d.name in booking and value is not None and not isinstance(value, str):
                value = str(value)
            out[d.name] = value
        return out

    def booking_from_decision(self, case: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any]:
        b = dict(case.get("booking") or {})
        names = {d.name for d in self.task_def.decision_fields}
        b.update({k: v for k, v in fields.items() if k in names})
        return b

    # ------------------------------------------------------------- probes
    def perturb(self, case: dict[str, Any], rng: random.Random) -> list[dict[str, Any]]:
        base = self._materialize(case)
        variants: list[dict[str, Any]] = []

        def variant(f: FeatureDef, value: Any, delta: str) -> None:
            v = copy.deepcopy(base)
            v["facts"][f.name] = value
            v["id"] = f"{base['id']}~{len(variants)}"
            v["_probe"] = {"base": base["id"], "delta": delta, "feature": f.name,
                           "from": base["facts"].get(f.name), "to": value}
            variants.append(v)

        for f in self.task_def.features:
            current = base["facts"].get(f.name)
            for value, delta in self._variants_for(f, current, rng):
                if value == current:
                    continue
                variant(f, value, delta.format(label=f.label or f.name, new=self._fmt(f, value),
                                               old=self._fmt(f, current)))
        rng.shuffle(variants)
        return variants

    def _variants_for(self, f: FeatureDef, current: Any, rng: random.Random) -> Iterator[tuple[Any, str]]:
        if f.type == "num":
            lo = f.lo if f.lo is not None else (0.0 if current is None else min(0.0, float(current) * 0.5))
            hi = f.hi if f.hi is not None else (100.0 if current is None else max(100.0, float(current) * 2))
            if f.threshold_capable:
                for q in (0.1, 0.35, 0.5, 0.65, 0.9):
                    yield self._round(lo + (hi - lo) * q, f), "{label} is {new} instead of {old}"
            for factor in (0.5, 0.75, 1.25, 1.75):
                if current is not None:
                    yield self._round(min(hi, max(lo, float(current) * factor)), f), \
                        "{label} is {new} instead of {old}"
            for value in f.values:
                yield value, "{label} is {new} instead of {old}"
        elif f.type == "cat":
            for option in (f.options or f.values):
                yield option, "{label} is {new} instead of {old}"
        elif f.type == "bool":
            yield (not current if isinstance(current, bool) else True), "{label} is {new} instead of {old}"
        elif f.type == "date":
            if current:
                try:
                    d = date.fromisoformat(str(current))
                except ValueError:
                    d = self._reference_date()
                for days in (-30, -7, 7, 30):
                    yield (d + timedelta(days=days)).isoformat(), "{label} is {new} instead of {old}"
            for value in f.values:
                yield value, "{label} is {new} instead of {old}"

    def threshold_params(self) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for f in self.task_def.threshold_features():
            lo = 0.0 if f.lo is None else float(f.lo)
            hi = 100.0 if f.hi is None else float(f.hi)
            step = float(f.step or max((hi - lo) / 40.0, 0.1))
            scale = float(f.scale or max((hi - lo) / 20.0, 1.0))
            out[f.name] = dict(lo=lo, hi=hi, step=step, scale=scale,
                               bases={f.name: f"{self.namespace}.{f.name}"}, param=f.param)
        return out

    def threshold_variant(self, case: dict[str, Any], kind: str, basis: str, value: float, *,
                          vat_rate: float | None = None, **kwargs: Any) -> dict[str, Any] | None:
        """A copy whose threshold quantity `basis` equals `value`; None if unsupported.
        `vat_rate` is accepted for Pack compatibility and ignored (generic tasks do not model VAT)."""
        feature = self.task_def.feature(kind) if kind in {f.name for f in self.task_def.features} else None
        feature = feature or self.task_def.feature(basis)
        if feature is None or not feature.threshold_capable or feature.type != "num":
            return None
        lo = 0.0 if feature.lo is None else float(feature.lo)
        hi = 100.0 if feature.hi is None else float(feature.hi)
        # Exact boundaries matter to a sealed test, so clip but do not snap to `step`.
        value = round(min(max(float(value), lo), hi), 2)
        v = copy.deepcopy(self._materialize(case))
        old = v["facts"].get(feature.name)
        v["facts"][feature.name] = value
        v["id"] = f"{case.get('id', 'case')}~t{value:g}"
        v["_probe"] = {"base": case.get("id"), "delta": f"{feature.label or feature.name} at {self._fmt(feature, value)}",
                       "feature": feature.name, "from": old, "to": value}
        return v

    # ------------------------------------------------------------- seed map
    def seed_map(self) -> dict[str, Any]:
        """The written process (if any) as the starting Work Map; an empty map otherwise."""
        steps = [dict(id=s.id, order=s.order, name=s.name, description=s.description,
                      decision_field=s.decision_field, rule_ids=list(s.rule_ids)) for s in self.task_def.steps]
        rules = [dict(id=r.id, step_id=r.step_id, title=r.title, when=r.when, then=dict(r.then), origin="doc")
                 for r in self.task_def.process_rules]
        guardrails = [dict(id=g.id, step_id=g.step_id, title=g.title, when=g.when, type=g.type,
                           action=g.action, ask=g.ask, origin="doc")
                      for g in self.task_def.process_guardrails]
        for s in steps:
            if not s["rule_ids"]:
                s["rule_ids"] = [r["id"] for r in rules if r.get("step_id") == s["id"]]
        return {"steps": steps, "rules": rules, "guardrails": guardrails, "params": {}}

    # ---------------------------------------------------------- language
    def _fmt(self, f: FeatureDef, value: Any) -> str:
        if value is None:
            return "unreadable"
        if isinstance(value, bool):
            return "yes" if value else "no"
        if f.type == "num":
            text = f"{float(value):g}"
            return f"{text} {f.unit}" if f.unit else text
        return str(value)

    def describe(self, case: dict[str, Any]) -> str:
        facts = _facts(case)
        if self.task_def.describe_template:
            try:
                return self.task_def.describe_template.format(id=case.get("id"), **facts)
            except (KeyError, IndexError):
                pass
        names = self.task_def.describe_fields or [f.name for f in self.task_def.features]
        parts = []
        for name in names:
            f = self.task_def.feature(name)
            if f is None:
                continue
            parts.append(f"{f.label or f.name}: {self._fmt(f, facts.get(name))}")
        head = f"{self.name} {case.get('id', '')}".strip()
        return f"{head} \u2014 " + ", ".join(parts) if parts else head

    def describe_delta(self, base: dict[str, Any], variant: dict[str, Any]) -> str:
        return (variant.get("_probe") or {}).get("delta", "a slightly different case")


def load_generic_pack(path: str, *, pack_id: str | None = None) -> GenericPack:
    return GenericPack(load_task_definition(path), pack_id=pack_id)


__all__ = ["GenericPack", "load_generic_pack"]
