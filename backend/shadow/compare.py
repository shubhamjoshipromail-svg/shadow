"""Two experts, one task: where do two Work Maps agree, disagree, and differ?

Shadow's whole premise is that the *unwritten* judgment differs between people. Once
two experts have taught the same workflow, the interesting question is no longer
"what does the map say" but "where do Sabine and Uwe disagree, on which rule, and
what should we ask them?". This module runs both maps over the same case pool —
the union of both sessions' cases, fresh generated cases, and boundary variants
around every threshold either expert learned — and reports:

    agree             how many (case, decision field) pairs both maps resolve the same way
    disagree          one entry per *conflict*, i.e. per pair of deciding rules, with an
                      example case, the two values, the two rules and the two quotes
    only_a / only_b   rule titles one expert has and the other does not
    threshold_diffs   every learned numeric parameter the two experts set differently

`questions_for` turns a conflict into the one neutral question to put to each expert
("Sabine codes this to 0400, you code it to 4711 — what do you look at?"), never a
verdict about who is wrong.

Pure functions: no session, no store, no LLM. Everything the engine needs is the
`Pack`, two `WorkMap`s and the cases they were taught on.
"""

from __future__ import annotations

import json
from typing import Any, Iterable

from shadow import dsl, receipts
from shadow.packs.base import Pack
from shadow.workmap import ACTIVE, Guardrail, Rule, WorkMap, run_map

__all__ = ["compare_maps", "questions_for", "comparison_pool"]

DECISION_ACTION = "action"


# ------------------------------------------------------------------ map diffing
def _node_kind(node: Rule | Guardrail) -> str:
    return "guardrail" if isinstance(node, Guardrail) else "rule"


def _node_effect(node: Rule | Guardrail) -> Any:
    return node.action if isinstance(node, Guardrail) else node.then


def _node_signature(node: Rule | Guardrail) -> str:
    """What makes two rules *the same rule* across two maps: condition + effect.

    Ids are not used: two experts' maps are built independently, so the same judgment
    can easily carry different ids. `when` is whitespace-normalised because a compiler
    may format the same expression differently.
    """
    return json.dumps(
        {"kind": _node_kind(node), "when": " ".join(node.when.split()), "effect": _node_effect(node)},
        sort_keys=True, default=str,
    )


def _shared_and_unique(map_a: WorkMap, map_b: WorkMap) -> tuple[list[str], list[str]]:
    """(only_a titles, only_b titles) after matching nodes by condition + effect."""
    sig_a = {_node_signature(n): n for n in [*map_a.rules, *map_a.guardrails]}
    sig_b = {_node_signature(n): n for n in [*map_b.rules, *map_b.guardrails]}
    only_a = sorted({n.title for sig, n in sig_a.items() if sig not in sig_b})
    only_b = sorted({n.title for sig, n in sig_b.items() if sig not in sig_a})
    return only_a, only_b


def _threshold_diffs(map_a: WorkMap, map_b: WorkMap) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for param in sorted(set(map_a.params) | set(map_b.params)):
        a, b = map_a.params.get(param), map_b.params.get(param)
        if a == b:
            continue
        out.append({"param": param,
                    "a": None if a is None else round(a, 2),
                    "b": None if b is None else round(b, 2)})
    return out


# ------------------------------------------------------------------ case pool
def _dedup(cases: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for c in cases:
        cid = str(c.get("id"))
        if cid in seen:
            continue
        seen.add(cid)
        out.append(c)
    return out


def _threshold_specs(pack: Pack) -> tuple[dict[str, tuple[str, str]], dict[str, dict[str, Any]]]:
    """quantity expression -> (kind, basis) and kind -> spec, as `proof` builds them."""
    try:
        specs = pack.threshold_params()
    except Exception:  # a pack with no numeric thresholds
        return {}, {}
    spec_for: dict[str, tuple[str, str]] = {}
    for kind, sp in specs.items():
        for basis, quantity in (sp.get("bases") or {}).items():
            spec_for[quantity] = (kind, basis)
    return spec_for, specs


def _quantities_for(wm: WorkMap, param: str, spec_for: dict[str, tuple[str, str]]) -> list[str]:
    """Which quantity a rule using `params.<param>` compares against (from the rule text)."""
    quantities: set[str] = set()
    for node in [*wm.rules, *wm.guardrails]:
        if f"params.{param}" not in node.when:
            continue
        quantities |= {q for q in spec_for if q in node.when}
    return sorted(quantities) or sorted(spec_for)


def _relaxed_holds(node: Rule | Guardrail, ctx: dict[str, Any], param: str) -> bool:
    for direction in (-1e12, 1e12):
        if dsl.holds(node.when, {**ctx, "params": {**ctx.get("params", {}), param: direction}}):
            return True
    return False


def _domain_bases(wm: WorkMap, pack: Pack, param: str, bases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cases that put `params.<param>` on trial: the rest of the rule's condition holds."""
    nodes = [n for n in [*wm.rules, *wm.guardrails] if f"params.{param}" in n.when]
    if not nodes:
        return bases
    out = []
    for c in bases:
        ctx = {**pack.derive(c), "params": dict(wm.params)}
        if any(_relaxed_holds(n, ctx, param) for n in nodes):
            out.append(c)
    return out or bases


def comparison_pool(pack: Pack, map_a: WorkMap, map_b: WorkMap, cases: list[dict[str, Any]] | None = None, *,
                    generated: int = 60, seed: int = 0, boundaries: bool = True) -> list[dict[str, Any]]:
    """The shared case pool both maps are run on.

    = the cases the caller supplies (the union of both sessions' cases)
    + `pack.generate_cases(generated, seed=seed)`
    + boundary variants around every threshold either map learned.
    """
    pool = _dedup([*(cases or []), *pack.generate_cases(generated, seed=seed)])
    if not boundaries:
        return pool
    params: dict[str, list[float]] = {}
    for wm in (map_a, map_b):
        for p, v in wm.params.items():
            if v is not None:
                params.setdefault(p, [])
                if float(v) not in params[p]:
                    params[p].append(float(v))
    variants: list[dict[str, Any]] = []
    spec_for, specs = _threshold_specs(pack)
    vary = getattr(pack, "threshold_variant", None)
    if vary is None or not specs:
        return pool
    idx = 0
    for param in sorted(params):
        # one reference map per parameter: whichever map actually uses it
        wm = map_a if f"params.{param}" in _rules_text(map_a) else map_b
        domain = _domain_bases(wm, pack, param, pool)
        for value in params[param]:
            for quantity in _quantities_for(wm, param, spec_for):
                kind, basis = spec_for[quantity]
                spec = specs.get(kind, {})
                lo, hi = float(spec.get("lo", value)), float(spec.get("hi", value))
                for mult in (0.9, 0.97, 1.03, 1.1):
                    target = min(max(value * mult, lo), hi)
                    base = domain[idx % len(domain)]
                    idx += 1
                    v = vary(base, kind, basis, target)
                    if v is None:
                        continue
                    v = dict(v)
                    v.pop("_probe", None)
                    v["id"] = f"cmp-{param}-{mult:g}-{idx}"
                    v["_compare"] = {"param": param, "target": round(target, 2)}
                    variants.append(v)
    return _dedup([*pool, *variants])


def _rules_text(wm: WorkMap) -> str:
    return " ".join(n.when for n in [*wm.rules, *wm.guardrails])


# ------------------------------------------------------------------ compare
def _field_label(pack: Pack, field: str) -> str:
    if field == DECISION_ACTION:
        return "Action"
    for spec in getattr(pack, "decision_fields", []):
        if spec.name == field:
            return spec.label or spec.name
    return field


def _node_view(wm: WorkMap, source: str | None) -> tuple[str | None, str | None, str | None]:
    """(id, title, quote text) for the rule/guardrail that produced a value."""
    if not source:
        return None, None, None
    node = wm.node(source)
    if node is None:
        return source, None, None
    return source, node.title, (node.quote.text if node.quote else None)


def _values(pack: Pack, map_a: WorkMap, map_b: WorkMap, case: dict[str, Any]) -> list[dict[str, Any]]:
    pred_a = run_map(map_a, pack, case, ACTIVE)
    pred_b = run_map(map_b, pack, case, ACTIVE)
    fields = [spec.name for spec in getattr(pack, "decision_fields", [])] + [DECISION_ACTION]
    rows: list[dict[str, Any]] = []
    for field in fields:
        a_value, a_source = receipts.field_value(pred_a, field)
        b_value, b_source = receipts.field_value(pred_b, field)
        if a_value is None and b_value is None:
            continue
        if a_value == b_value:
            rows.append({"field": field, "agree": True})
            continue
        a_id, a_title, a_quote = _node_view(map_a, a_source)
        b_id, b_title, b_quote = _node_view(map_b, b_source)
        rows.append({
            "field": field, "agree": False,
            "a_value": a_value, "a_rule": a_id, "a_rule_title": a_title, "a_quote": a_quote,
            "b_value": b_value, "b_rule": b_id, "b_rule_title": b_title, "b_quote": b_quote,
        })
    return rows


def compare_maps(pack: Pack, map_a: WorkMap, map_b: WorkMap, cases: list[dict[str, Any]] | None = None, *,
                 generated: int = 60, seed: int = 0, boundaries: bool = True) -> dict[str, Any]:
    """Run both Work Maps on the same pool and report every meaningful difference.

    Disagreements are grouped by the *pair of deciding rules* (plus the field), so one
    entry means one conflict — which is exactly what a single question should resolve —
    with an example case and the number of cases it covers. `only_a`/`only_b` are the
    rules one expert has and the other does not; `threshold_diffs` are the learned
    numeric parameters set differently.
    """
    pool = comparison_pool(pack, map_a, map_b, cases, generated=generated, seed=seed, boundaries=boundaries)
    expert_a = map_a.expert or "Expert A"
    expert_b = map_b.expert or "Expert B"

    agree = 0
    groups: dict[tuple[str, str | None, str | None], dict[str, Any]] = {}
    for case in pool:
        for row in _values(pack, map_a, map_b, case):
            if row.get("agree"):
                agree += 1
                continue
            key = (row["field"], row["a_rule"], row["b_rule"])
            g = groups.get(key)
            if g is None:
                g = {
                    "case": case.get("id"),
                    "case_describe": pack.describe(case),
                    "field": row["field"],
                    "field_label": _field_label(pack, row["field"]),
                    "a_value": row["a_value"], "a_rule": row["a_rule"],
                    "a_rule_title": row["a_rule_title"], "a_quote": row["a_quote"],
                    "b_value": row["b_value"], "b_rule": row["b_rule"],
                    "b_rule_title": row["b_rule_title"], "b_quote": row["b_quote"],
                    "a_expert": expert_a, "b_expert": expert_b,
                    "count": 0,
                }
                groups[key] = g
            g["count"] += 1

    disagree = sorted(groups.values(),
                      key=lambda g: (-g["count"], g["field"], g["a_rule"] or "", g["b_rule"] or ""))
    only_a, only_b = _shared_and_unique(map_a, map_b)
    return {
        "agree": agree,
        "disagree": disagree,
        "only_a": only_a,
        "only_b": only_b,
        "threshold_diffs": _threshold_diffs(map_a, map_b),
        "experts": {"a": expert_a, "b": expert_b},
        "n_cases": len(pool),
        "n_comparisons": agree + sum(g["count"] for g in disagree),
    }


# ------------------------------------------------------------------ questions
def _fmt_value(value: Any) -> str:
    if value is None:
        return "nothing"
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)


def _question(field: str, label: str, other_name: str, other_value: Any, own_value: Any) -> str:
    other, own = _fmt_value(other_value), _fmt_value(own_value)
    if field == "cost_center":  # the observed ERP wording
        clause = f"{other_name} codes this to {other}, you code it to {own}"
    elif own_value is None:
        clause = f"{other_name} chooses {other} for {label}, you leave it unset"
    elif other_value is None:
        clause = f"{other_name} leaves {label} unset, you choose {own}"
    else:
        clause = f"{other_name} sets {label} to {other}, you set it to {own}"
    return f"{clause} — what do you look at?"


def questions_for(conflict: dict[str, Any], expert: str | None = None) -> Any:
    """A neutral question for each side of a conflict.

    `conflict` is one entry of `compare_maps(...)["disagree"]`. With no `expert`, returns
    `{expert_a: q_for_a, expert_b: q_for_b}`; with an expert name (or "a"/"b"), returns just
    that expert's question. The question states the *other* expert's choice and asks this
    one what they look at — it never says who is right.
    """
    a_name = conflict.get("a_expert") or "Expert A"
    b_name = conflict.get("b_expert") or "Expert B"
    field = conflict.get("field") or ""
    label = conflict.get("field_label") or field
    a_value, b_value = conflict.get("a_value"), conflict.get("b_value")
    q_a = _question(field, label, other_name=b_name, other_value=b_value, own_value=a_value)
    q_b = _question(field, label, other_name=a_name, other_value=a_value, own_value=b_value)
    by_side = {a_name: q_a, b_name: q_b, "a": q_a, "b": q_b}
    if expert is None:
        return {a_name: q_a, b_name: q_b}
    if expert in by_side:
        return by_side[expert]
    raise KeyError(f"unknown expert {expert!r}; expected one of {sorted(set(by_side))}")
