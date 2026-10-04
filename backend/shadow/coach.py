"""Proactive tutor / coach logic — pure functions, no I/O, no LLM.

The reactive tutor in :mod:`shadow.engine` blocks a bad save. This module is
the other half: it decides what to practice next, what to say *before* the
trainee acts, how much help to give when they are stuck, and when to get out
of the way.

Everything here is a pure function of the Work Map, the pack, the learner's
mastery table (the same ``{node_id: {"p": ...}}`` dict the engine keeps) and
plain case dicts. Nothing is wired into the engine yet; call sites are listed
in ``design/tasks/T1_REPORT.md``.

Design notes
------------
* "Trusted" mirrors :func:`shadow.engine.Session.tutor_report`:
  non-doc nodes whose belief status is in :data:`shadow.workmap.TRUSTED`.
* Mastery ``p`` for a node never seen is ``None``; for ordering we treat
  ``None`` as ``0.0`` so unseen material is practiced first.
* A case "exercises" a node when :func:`shadow.workmap.run_map` (trusted
  statuses) fires the rule or triggers the guardrail on that case. Using the
  map's own prediction means guardrails whose condition mentions the booking
  are still attributed to the case that would provoke them.
"""

from __future__ import annotations

from typing import Any, Iterable

from shadow import dsl
from shadow.packs.base import Pack
from shadow.workmap import (
    TRUSTED,
    Guardrail,
    Rule,
    WorkMap,
    check_proposal,
    context,
    run_map,
)

__all__ = ["next_case", "brief", "hint_ladder", "fade"]

PREDICT_PROMPT = "What would you code this to, and why?"
WORKED_EXAMPLE_BELOW = 0.3
FADE_SILENT_AT = 0.85
FADE_CHECK_AT = 0.5


# --------------------------------------------------------------------- helpers
def _id(case: Any) -> str | None:
    if case is None:
        return None
    if isinstance(case, str):
        return case
    if isinstance(case, dict):
        return case.get("id")
    return getattr(case, "id", None)


def _seen_set(seen_ids: Iterable[Any]) -> set[str]:
    out: set[str] = set()
    for item in seen_ids or ():
        cid = _id(item)
        if cid is not None:
            out.add(cid)
    return out


def _trusted_nodes(wm: WorkMap) -> list[Rule | Guardrail]:
    return [n for n in [*wm.rules, *wm.guardrails]
            if n.origin != "doc" and n.belief.status in TRUSTED]


def _node_p(mastery: dict[str, Any], node_id: str | None) -> float | None:
    if node_id is None:
        return None
    entry = (mastery or {}).get(node_id)
    if not entry:
        return None
    p = entry.get("p")
    return None if p is None else float(p)


def _p_or(p: float | None, default: float = 0.0) -> float:
    return default if p is None else float(p)


def _node_fields(node: Rule | Guardrail | None) -> list[str]:
    """Decision fields this node decides (never empty for a real node)."""
    if node is None:
        return []
    if isinstance(node, Guardrail):
        return ["action"]
    fields = [k for k in node.then if k != "action"]
    if fields:
        return fields
    return ["action"] if "action" in node.then else []


def _label(pack: Pack, field: str) -> str:
    for spec in pack.decision_fields:
        if spec.name == field:
            return spec.label
    return "Action" if field == "action" else field


def _available(ctx: dict[str, Any], path: str) -> bool:
    cur: Any = ctx
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return False
        cur = cur[part]
    return cur is not None


def _nearly_fires(node: Rule | Guardrail, ctx: dict[str, Any]) -> bool:
    """A learned node that could apply if one value moved: all its facts exist."""
    try:
        refs = [r for r in dsl.fields_referenced(node.when) if not r.startswith("params.")]
    except dsl.DSLError:
        return False
    return bool(refs) and all(_available(ctx, r) for r in refs)


# ----------------------------------------------------------------- curriculum
def next_case(
    map: WorkMap,
    pack: Pack,
    mastery: dict[str, Any],
    seen_ids: Iterable[Any],
    candidates: Iterable[dict[str, Any]],
) -> dict[str, Any] | None:
    """Pick the unseen case that exercises the weakest-mastery trusted node.

    Interleaving: among cases that exercise the weakest node, prefer the one
    that exercises the most *other* weak nodes, so a session mixes related
    judgment instead of drilling one rule. Guardrails whose mastery is below
    ``0.5`` are promoted ahead of everything else, because an unmastered
    guardrail is exactly the mistake the coach exists to prevent.

    Returns ``None`` when there is nothing left to practice (empty candidate
    list or every candidate already seen).
    """
    wm = map
    seen = _seen_set(seen_ids)
    pool = [c for c in candidates if _id(c) not in seen]
    if not pool:
        return None

    trusted = _trusted_nodes(wm)
    if not trusted:
        return pool[0]
    trusted_by_id = {n.id: n for n in trusted}

    def score(item: tuple[int, dict[str, Any]]) -> tuple:
        index, case = item
        pred = run_map(wm, pack, case, TRUSTED)
        exercised = [nid for nid in (*pred.triggered_guardrails, *pred.fired_rules) if nid in trusted_by_id]
        if not exercised:
            return (2, 1.0, 0, index)
        ps = {nid: _p_or(_node_p(mastery, nid)) for nid in exercised}
        weak_guard = any(isinstance(trusted_by_id[nid], Guardrail) and ps[nid] < FADE_CHECK_AT
                         for nid in exercised)
        return (
            0 if weak_guard else 1,       # guardrails first while shaky
            min(ps.values()),             # then the weakest node exercised
            -sum(1 for p in ps.values() if p < FADE_SILENT_AT),  # interleave: more weak skills
            index,                        # deterministic tie-break
        )

    ranked = min(enumerate(pool), key=score)
    return ranked[1]


# ---------------------------------------------------------------- pre-case brief
def brief(map: WorkMap, pack: Pack, case: dict[str, Any], mastery: dict[str, Any]) -> dict[str, Any]:
    """Coaching *before* the trainee decides: what matters, predict first, maybe an example."""
    wm = map
    ctx = context(wm, pack, case)
    pred = run_map(wm, pack, case, TRUSTED)
    trusted = _trusted_nodes(wm)
    fired_ids = [nid for nid in (*pred.triggered_guardrails, *pred.fired_rules)
                 if wm.node(nid) is not None and wm.node(nid).origin != "doc"]

    entries: list[dict[str, Any]] = []

    def add(node: Rule | Guardrail, field: str, fires: bool) -> None:
        entries.append({
            "field": field,
            "node_id": node.id,
            "title": node.title,
            "fires": fires,
            "p": _node_p(mastery, node.id),
            "guardrail": isinstance(node, Guardrail),
        })

    seen_nodes: set[str] = set()
    for nid in fired_ids:
        node = wm.node(nid)
        if node is None or node.id in seen_nodes:
            continue
        seen_nodes.add(node.id)
        for field in _node_fields(node):
            add(node, field, True)
    for node in trusted:
        if node.id in seen_nodes:
            continue
        if _nearly_fires(node, ctx):
            seen_nodes.add(node.id)
            for field in _node_fields(node):
                add(node, field, False)

    # Fall back to the map's own prediction (doc rules / defaults) when nothing
    # learned is in play, so the brief still names the fields.
    if not entries:
        for field, fp in pred.fields.items():
            node = wm.node(fp.source)
            entries.append({
                "field": field,
                "node_id": fp.source,
                "title": node.title if node else fp.source,
                "fires": True,
                "p": fp.p,
                "guardrail": isinstance(node, Guardrail),
            })
    if not entries:
        for spec in pack.decision_fields:
            entries.append({"field": spec.name, "node_id": None, "title": None, "fires": False,
                            "p": None, "guardrail": False})

    by_field: dict[str, list[dict[str, Any]]] = {}
    for e in entries:
        by_field.setdefault(e["field"], []).append(e)

    fields: list[dict[str, Any]] = []
    for field, group in by_field.items():
        primary = min(group, key=lambda e: (not e["fires"], _p_or(e["p"])))
        fields.append({
            "field": field,
            "label": _label(pack, field),
            "node_id": primary["node_id"],
            "title": primary["title"],
            "fires": primary["fires"],
            "p": primary["p"],
            "guardrail": primary["guardrail"],
            "why": _why(wm, primary),
            "also": sorted({e["node_id"] for e in group
                            if e["node_id"] and e["node_id"] != primary["node_id"]}),
        })
    fields.sort(key=lambda f: (not f["fires"], _p_or(f["p"]), f["field"]))

    focus_entry = min(entries, key=lambda e: (not e["fires"], _p_or(e["p"]), e["field"]))
    focus = {
        "node_id": focus_entry["node_id"],
        "title": focus_entry["title"],
        "field": focus_entry["field"],
        "p": focus_entry["p"],
        "guardrail": focus_entry["guardrail"],
        "fires": focus_entry["fires"],
    }

    worked = _worked_example(wm, entries, focus_entry, mastery)
    focus_p = _p_or(focus["p"])
    return {
        "case_id": _id(case),
        "summary": pack.describe(case),
        "fields": fields,
        "focus": focus,
        "predict": PREDICT_PROMPT,
        "worked_example": worked,
        "guardrails": list(pred.triggered_guardrails),
        "intervention": fade(focus_p, guardrail=focus["guardrail"]),
    }


def _why(wm: WorkMap, entry: dict[str, Any]) -> str:
    title = entry.get("title")
    if not title:
        return "No rule claims this field yet — decide it yourself."
    if entry["fires"]:
        return f"{wm.expert}'s rule “{title}” applies here."
    return f"“{title}” is close but does not trigger yet — check it."


def _worked_example(
    wm: WorkMap,
    entries: list[dict[str, Any]],
    focus: dict[str, Any],
    mastery: dict[str, Any],
) -> dict[str, Any] | None:
    """The expert's own words for the rule in play, only below 0.3 mastery.

    Only rules that actually fire (or the focus rule, which may be nearly
    firing) can supply the example — a case full of distant rules must not
    flood the brief.
    """
    weak: list[tuple[float, dict[str, Any], Rule | Guardrail]] = []
    for e in entries:
        if not e["fires"] and e is not focus:
            continue
        node = wm.node(e["node_id"]) if e["node_id"] else None
        if node is None or node.quote is None:
            continue
        p = _p_or(_node_p(mastery, node.id))
        if p < WORKED_EXAMPLE_BELOW:
            weak.append((p, e, node))
    if not weak:
        return None
    _, entry, node = min(weak, key=lambda t: (t[0], t[1]["field"]))
    quote = node.quote
    return {
        "node_id": node.id,
        "title": node.title,
        "field": entry["field"],
        "quote": quote.english(),
        "speaker": quote.speaker,
        "screen_moment": node.screen_moment.model_dump() if node.screen_moment else None,
    }


# ------------------------------------------------------------------- hinting
def hint_ladder(
    map: WorkMap,
    pack: Pack,
    case: dict[str, Any],
    booking: dict[str, Any] | None,
    action: str,
    level: int,
) -> dict[str, Any]:
    """A graduated hint. Level 1 field, 2 rule title, 3 the expert's words, 4 the answer.

    Never reveals more than the level asks: ``title``/``quote``/``answer`` are
    ``None`` until their level, and the text grows by one clause per level.
    """
    wm = map
    level = max(1, min(4, int(level)))
    violations = check_proposal(wm, pack, case, booking or {}, action, TRUSTED)

    node: Rule | Guardrail | None = None
    field: str | None = None
    expected: Any = None
    title: str | None = None
    quote_text: str | None = None

    if violations:
        v = violations[0]
        node = wm.node(v.node_id)
        field = v.field
        expected = v.expected
        title = v.title
        quote_text = v.quote.english() if v.quote else None
    else:
        pred = run_map(wm, pack, case, TRUSTED)
        node = _fallback_node(wm, pred)
        field = next(iter(_node_fields(node)), None) if node else None
        if field is None:
            field = "action" if pred.action else (pack.decision_fields[0].name if pack.decision_fields else "action")
        if field == "action":
            expected = pred.action.value if pred.action else action
        else:
            fp = pred.fields.get(field)
            expected = fp.value if fp else None
        title = node.title if node else None
        quote_text = None
        if node is not None and node.quote is not None:
            quote_text = node.quote.english()

    label = _label(pack, field)
    text = f"Look at the {label} field. What do you think it should be, and why?"
    if level >= 2:
        text += f" The rule in play here is “{title}”." if title else " There is a rule in play here."
    if level >= 3 and quote_text:
        text += f" {wm.expert} put it this way: “{quote_text}”."
    if level >= 4:
        text += f" That means {label} should be {expected}."

    return {
        "level": level,
        "case_id": _id(case),
        "field": field,
        "label": label,
        "node_id": node.id if node else None,
        "title": title if level >= 2 else None,
        "quote": quote_text if level >= 3 else None,
        "answer": expected if level >= 4 else None,
        "text": text,
        "reveals": {
            "field": True,
            "rule": level >= 2 and title is not None,
            "quote": level >= 3 and quote_text is not None,
            "answer": level >= 4,
        },
    }


def _fallback_node(wm: WorkMap, pred: Any) -> Rule | Guardrail | None:
    """Prefer a learned node when the trainee was right and no objection fired."""
    order: list[str] = [*pred.triggered_guardrails]
    for nid in pred.fired_rules:
        node = wm.node(nid)
        if node is not None and node.origin != "doc":
            order.append(nid)
    order.extend(pred.fired_rules)
    seen: set[str] = set()
    for nid in order:
        if nid in seen:
            continue
        seen.add(nid)
        node = wm.node(nid)
        if node is not None:
            return node
    return None


# --------------------------------------------------------------------- fading
def fade(mastery_p: float | None, *, guardrail: bool = False) -> str:
    """How much to intervene for a node at mastery ``p``.

    ``coach`` below 0.5, ``check`` from 0.5, ``silent`` only for non-guardrails
    at 0.85 and above — a guardrail is never allowed to fade to silence,
    because forgetting one is the failure mode that matters.
    """
    p = _p_or(mastery_p)
    if p >= FADE_SILENT_AT and not guardrail:
        return "silent"
    if p >= FADE_CHECK_AT:
        return "check"
    return "coach"
