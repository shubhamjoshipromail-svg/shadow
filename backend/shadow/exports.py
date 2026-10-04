"""Work Map exports: JSON, a readable SOP, and agent-ready guardrails."""

from __future__ import annotations

import json
from typing import Any

from shadow.workmap import TRUSTED, Guardrail, WorkMap


def _quote(n) -> str:
    if not n.quote:
        return ""
    q = n.quote.english()
    ts = f" at {_mmss(n.quote.ts)}" if n.quote.ts is not None else ""
    if n.quote.translation and n.quote.translation != n.quote.text:
        return f' — “{q}” (original: “{n.quote.text}”, {n.quote.speaker}{ts})'
    return f' — “{q}” ({n.quote.speaker}{ts})'


def _mmss(t: float | None) -> str:
    if t is None:
        return "--:--"
    return f"{int(t // 60):02d}:{int(t % 60):02d}"


def evidence_label(n) -> str:
    """Calibrated wording: what kind of evidence stands behind a node, never just a score."""
    def count(kind: str) -> tuple[int, int]:
        ev = [e for e in n.evidence if e.kind == kind]
        return len(ev), sum(1 for e in ev if e.agrees)
    live, live_ok = count("live")
    retro, retro_ok = count("retro")
    cf, cf_ok = count("counterfactual")
    parts = []
    if live:
        parts.append(f"tested on {live} later decision{'s' if live != 1 else ''} ({live_ok} agree)")
    if retro:
        parts.append(f"fits {retro_ok}/{retro} earlier cases")
    if cf:
        parts.append(f"{cf_ok}/{cf} hypothetical answers agree")
    if not parts:
        return "stated by the expert, not yet tested" if n.quote else "inferred from behavior, not yet tested"
    return ("stated; " if n.quote else "observed; ") + ", ".join(parts)


def _params(text: str, wm: WorkMap) -> str:
    for p, v in wm.params.items():
        text = text.replace(f"params.{p}", f"{v:,.0f}")
    return text


def to_markdown(wm: WorkMap) -> str:
    lines = [f"# Work Map — {wm.task.replace('_', ' ')}", "",
             f"Captured from **{wm.expert}** · map version {wm.version}", ""]
    for s in sorted(wm.steps, key=lambda s: s.order):
        sm = f" · screen moment {_mmss(s.screen_moment.ts)}" if s.screen_moment and s.screen_moment.ts else ""
        lines.append(f"## Step {s.order}: {s.name}{sm}")
        if s.description:
            lines.append(s.description)
        nodes = [wm.node(i) for i in s.rule_ids + s.guardrail_ids]
        learned = [n for n in nodes if n and n.origin != "doc" and n.belief.status != "contested"]
        doc = [n for n in nodes if n and n.origin == "doc"]
        if learned:
            lines.append("")
            for n in learned:
                kind = "Guardrail" if isinstance(n, Guardrail) else "Judgment"
                lines.append(f"- **{kind}:** {_params(n.title, wm)}{_quote(n)}  "
                             f"`[{n.belief.status}: {evidence_label(n)}]`")
        elif doc:
            lines.append(f"\n- As documented: {doc[0].title.replace('Doc: ', '')}")
        lines.append("")
    return "\n".join(lines)


def to_agent_skill(wm: WorkMap) -> str:
    """Instructions an AI agent can load to follow the same steps and stop where the expert would."""
    trusted = [n for n in [*wm.rules, *wm.guardrails] if n.origin != "doc" and n.belief.status in TRUSTED]
    rules = [n for n in trusted if not isinstance(n, Guardrail)]
    guards = [n for n in trusted if isinstance(n, Guardrail)]
    out = [
        "---",
        f"name: {wm.task}",
        f"description: How {wm.expert} performs '{wm.task.replace('_', ' ')}', including unwritten judgment and "
        "the points where a human must decide. Captured and verified by Tacet.",
        "---",
        "",
        f"# {wm.task.replace('_', ' ').title()}",
        "",
        "## Hard stops (never proceed past these; hand back to a human)",
    ]
    for g in guards:
        who = f" Ask: {g.ask}." if g.ask else ""
        out.append(f"- IF `{_params(g.when, wm)}` THEN **{g.action.upper()}**.{who} Reason{_quote(g)} "
                   f"(evidence: {evidence_label(g)})")
    out += ["", "## Judgment rules (apply in this order of precedence)"]
    for r in sorted(rules, key=lambda r: -r.priority):
        out.append(f"- IF `{_params(r.when, wm)}` THEN set {json.dumps(r.then)}. Reason{_quote(r)} "
                   f"(evidence: {evidence_label(r)})")
    out += ["", "## Steps"]
    for s in sorted(wm.steps, key=lambda s: s.order):
        out.append(f"{s.order}. {s.name}")
    out += ["", "If no rule above applies, follow the written work instruction. If a case looks unlike anything "
                 "here, stop and ask a human — do not guess."]
    return "\n".join(out)


def to_json(wm: WorkMap) -> dict[str, Any]:
    out = wm.model_dump()
    for kind in ("rules", "guardrails"):
        for node, n in zip(out[kind], getattr(wm, kind)):
            node["evidence_label"] = evidence_label(n) if n.origin != "doc" else "written process"
    return out
