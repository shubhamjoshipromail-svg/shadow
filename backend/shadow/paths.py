"""Path constraints: what the expert always looks at before a decision, learned from behaviour.

Decisions are learned as rules; the *way* to a decision is a partial order. For every decided value
(e.g. action = hold, cost_center = 0400), collect the attention trail of each expert episode that reached
it. A step that appears before the decision in every such trail (and at least `min_support` of them) is a
candidate "always look here first" constraint. Steps that appear in only some trails are personal
workflow, not a constraint; orderings between steps are not imposed (valid alternative paths stay valid).
Like rules, these are behaviour-first and earn trust by support; the expert can confirm or reject them.
"""

from __future__ import annotations

from typing import Any


def mine(episodes: list[tuple[dict[str, Any], list[dict[str, Any]]]], min_support: int = 2
         ) -> list[dict[str, Any]]:
    """episodes: (decided fields, attention trail) per expert decision. Returns constraints, strongest first."""
    by_outcome: dict[tuple[str, Any], list[set[tuple[str, str]]]] = {}
    for decided, trail in episodes:
        steps = {(s["kind"], s["name"]) for s in trail if s.get("name")}
        for f, v in decided.items():
            if v is not None:
                by_outcome.setdefault((f, v), []).append(steps)
    out = []
    for (f, v), runs in by_outcome.items():
        if len(runs) < min_support:
            continue
        always = set.intersection(*runs)
        for kind, name in sorted(always):
            if kind == "field" and name == f:
                continue  # setting the field itself is the decision, not a precondition
            out.append({"field": f, "value": v, "kind": kind, "name": name, "support": len(runs),
                        "title": f"Before {f} = {v}, {('open the ' + name + ' panel') if kind == 'panel' else 'check ' + name}"})
    return sorted(out, key=lambda c: -c["support"])


def missing(constraints: list[dict[str, Any]], decided: dict[str, Any], trail: list[dict[str, Any]]
            ) -> list[dict[str, Any]]:
    """Constraints the learner skipped on the way to this decision."""
    seen = {(s["kind"], s["name"]) for s in trail}
    return [c for c in constraints if decided.get(c["field"]) == c["value"] and (c["kind"], c["name"]) not in seen]
