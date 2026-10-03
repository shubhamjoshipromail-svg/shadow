"""Learning receipts: what exactly changed when Shadow learned something, and whether it held up.

A receipt pairs the expert's words with the map before and after: what Shadow predicted for the
case before the answer, the rule diff, what it predicts now, and (later) every independent case
on which the new knowledge was put to the test. Re-predicting the case an answer was about is
retrodiction, so it is shown but never counted as a test. Only predictions committed *after* the
receipt, on cases the answer was not about, count as independent.
"""

from __future__ import annotations

from typing import Any

from shadow import dsl
from shadow.packs.base import Pack
from shadow.workmap import Guardrail, MapPrediction, Rule, WorkMap, run_map


def field_value(pred: MapPrediction, f: str) -> tuple[Any, str | None]:
    if f == "action":
        return (pred.action.value, pred.action.source) if pred.action else (None, None)
    fp = pred.fields.get(f)
    return (fp.value, fp.source) if fp else (None, None)


def predict_field(wm: WorkMap, pack: Pack, case: dict[str, Any] | None, f: str | None) -> dict[str, Any] | None:
    if case is None or not f:
        return None
    value, source = field_value(run_map(wm, pack, case), f)
    node = wm.node(source) if source else None
    return {"value": value, "source": source, "source_title": node.title if node else None,
            "map_version": wm.version}


def _node_json(n: Rule | Guardrail, params: dict[str, float]) -> dict[str, Any]:
    out = {"id": n.id, "title": n.title, "when": n.when, "status": n.belief.status, "p": n.belief.p,
           "kind": "guardrail" if isinstance(n, Guardrail) else "rule"}
    out["then"] = {"action": n.action} if isinstance(n, Guardrail) else n.then
    used = {p: round(v, 2) for p, v in params.items() if f"params.{p}" in n.when}
    if used:
        out["params"] = used
    return out


def diff_maps(before: WorkMap, after: WorkMap, before_bases: dict[str, str] | None = None,
              after_bases: dict[str, str] | None = None) -> dict[str, Any]:
    """Node- and parameter-level diff between two versions of a map."""
    old = {n.id: n for n in [*before.rules, *before.guardrails]}
    new = {n.id: n for n in [*after.rules, *after.guardrails]}
    added = [_node_json(n, after.params) for i, n in new.items() if i not in old]
    removed = [{"id": i, "title": n.title} for i, n in old.items() if i not in new]
    changed = []
    for i, n in new.items():
        o = old.get(i)
        if o is None:
            continue
        fields = {}
        for attr in ("when", "then", "action", "priority"):
            a, b = getattr(o, attr, None), getattr(n, attr, None)
            if a != b:
                fields[attr] = {"before": a, "after": b}
        if o.belief.status != n.belief.status:
            fields["status"] = {"before": o.belief.status, "after": n.belief.status}
        if fields:
            changed.append({"id": i, "title": n.title, "changes": fields})
    params = []
    before_bases, after_bases = before_bases or {}, after_bases or {}
    for p in sorted(set(before.params) | set(after.params)):
        a, b = before.params.get(p), after.params.get(p)
        qa, qb = before_bases.get(p), after_bases.get(p)
        if a is None or b is None or abs(a - b) > 1e-6 or qa != qb:
            params.append({"param": p, "before": None if a is None else round(a, 2),
                           "after": None if b is None else round(b, 2), "quantity_before": qa, "quantity_after": qb})
    return {"added": added, "removed": removed, "changed": changed, "params": params,
            "version": {"before": before.version, "after": after.version}}


def is_empty(diff: dict[str, Any]) -> bool:
    return not (diff["added"] or diff["removed"] or diff["params"]
                or any(set(c["changes"]) - {"status"} for c in diff["changed"]))


def nodes_under_test(receipt: dict[str, Any], wm: WorkMap) -> list[Rule | Guardrail]:
    """The knowledge a receipt introduced: new nodes, edited nodes, and rules using a moved parameter."""
    d = receipt.get("diff") or {}
    ids = {n["id"] for n in d.get("added", [])}
    ids |= {c["id"] for c in d.get("changed", []) if set(c["changes"]) - {"status"}}
    moved = {p["param"] for p in d.get("params", [])}
    out = [n for n in [*wm.rules, *wm.guardrails] if n.id in ids
           or (isinstance(n, Rule) and any(f"params.{p}" in n.when for p in moved))]
    return [n for n in out if n.origin != "doc"]


def relevant(node: Rule | Guardrail, pred: MapPrediction, ctx: dict[str, Any]) -> bool:
    """Did this case put the node on trial? It fired, or it would have but for its threshold."""
    if node.id in pred.fired_rules or node.id in pred.triggered_guardrails:
        return True
    if "params." not in node.when:
        return False
    params = ctx.get("params") or {}
    for direction in (-1e12, 1e12):  # threshold relaxed either way: the rest of the condition holds
        relaxed = {**ctx, "params": {k: direction for k in params}}
        if dsl.holds(node.when, relaxed):
            return True
    return False


def target_field(node: Rule | Guardrail) -> str:
    return "action" if isinstance(node, Guardrail) else next(iter(node.then))


def summarize(receipt: dict[str, Any]) -> dict[str, Any]:
    checks = receipt.get("independent") or []
    agree = sum(1 for c in checks if c["agrees"])
    if receipt.get("status") in ("compile_failed", "kept_open", "no_change"):
        verdict = receipt["status"]
    elif not checks:
        verdict = "untested"
    elif agree == len(checks):
        verdict = "held"
    else:
        verdict = "contradicted"
    return {"tests": len(checks), "agree": agree, "verdict": verdict}
