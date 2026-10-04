"""Workflow identity: is this page the same job as one we already know, or a new one?

A workflow is a task definition plus a *signature*: where it is done (origin + path pattern), which fields
the page has, and which actions end it. Experts and learners are separate from workflows: many experts can
teach one workflow (each has their own Work Map), and a learner trains on a workflow, against the map of a
chosen expert (or the most recent one).

Matching a page to a workflow is a similarity on signatures, never a guess by the LLM:
    ≥ SAME   → the same workflow (continue learning / tutoring it)
    ≥ ASK    → plausible: the companion asks "is this <workflow> or something new?"
    below    → a new workflow ("watch me do this" onboarding)
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

SAME = 0.6
ASK = 0.35


def path_pattern(url: str) -> tuple[str, str]:
    """('https://erp.example.com', '/invoice/:id'): ids, numbers and long tokens collapse to :id."""
    u = urlparse(url or "")
    parts = []
    for seg in (u.path or "/").split("/"):
        if not seg:
            continue
        parts.append(":id" if re.search(r"\d", seg) or len(seg) > 24 else seg.lower())
    return (f"{u.scheme}://{u.netloc}" if u.netloc else ""), "/" + "/".join(parts)


def signature(url: str, fields: list[str], actions: list[str] | None = None) -> dict[str, Any]:
    origin, path = path_pattern(url)
    return {"origin": origin, "path": path, "fields": sorted({f for f in fields if f}),
            "actions": sorted({a for a in (actions or []) if a})}


def _jaccard(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    return len(sa & sb) / len(sa | sb) if sa | sb else 0.0


def similarity(a: dict[str, Any], b: dict[str, Any]) -> float:
    """Fields carry most of the identity; the same place and the same exits confirm it."""
    place = 0.0
    if a.get("origin") and a.get("origin") == b.get("origin"):
        place = 0.6 + (0.4 if a.get("path") == b.get("path") else 0.0)
    acts = _jaccard(a.get("actions", []), b.get("actions", [])) if a.get("actions") and b.get("actions") else 0.5
    return round(0.55 * _jaccard(a.get("fields", []), b.get("fields", [])) + 0.15 * acts + 0.30 * place, 3)


def match(sig: dict[str, Any], known: list[dict[str, Any]]) -> dict[str, Any]:
    """known: [{id, name, signature}] → best match and a verdict: same / ask / new."""
    scored = sorted(({"id": k["id"], "name": k.get("name", k["id"]), "score": similarity(sig, k["signature"])}
                     for k in known if k.get("signature")), key=lambda c: -c["score"])
    best = scored[0] if scored else None
    verdict = "new" if best is None or best["score"] < ASK else ("same" if best["score"] >= SAME else "ask")
    return {"verdict": verdict, "best": best if verdict != "new" else None, "candidates": scored[:3]}


def demos_signature(demos: list[Any]) -> dict[str, Any]:
    """Signature of an onboarded workflow, from the demonstrations it was learned from."""
    url = next((getattr(d, "url", "") for d in demos if getattr(d, "url", "")), "")
    fields = [f.name for d in demos for f in getattr(d, "fields", [])]
    actions = [d.action.name for d in demos if getattr(d, "action", None)]
    return signature(url, fields, actions)


def pack_signature(pack: Any, url: str = "") -> dict[str, Any]:
    """Signature of a built-in pack: its decision fields and actions (and where its app lives, if known)."""
    fields = [f.name for f in getattr(pack, "decision_fields", [])]
    return signature(url, fields, list(getattr(pack, "actions", [])))
