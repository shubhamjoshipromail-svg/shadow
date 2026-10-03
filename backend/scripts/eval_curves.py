#!/usr/bin/env python3
"""Offline, synthetic comparison; run from backend with .venv/bin/python.

This evaluates the shipped engine, not an LLM or real expert. FakeCompiler
and fake_propose are oracle-assisted test doubles. Only the explanation
corruption below is added locally; no production simulator is modified.
"""

from __future__ import annotations

import asyncio
from collections import Counter
import hashlib
from html import escape
import json
from pathlib import Path
import sys
import time
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shadow.compiler import Compiled, CompiledRule
from shadow.engine import Session
from shadow.packs import get_pack
from shadow.packs.ap_invoices.oracle import decide
from shadow.planner import Inquiry
from shadow.sim import FakeCompiler, fake_propose, oracle_booking, sim_answer
from shadow.workmap import Belief, Guardrail, Quote, Rule, ScreenMoment, WorkMap, run_map

PACK = get_pack("ap_invoices")
FIELDS = ("cost_center", "tax_code", "payment_timing", "action")
RATES = (0.0, 0.2, 0.4)
EVAL_SEED = 999
EVAL_SIZE = 60
NOISE_SEED = 17
OUT = Path(__file__).resolve().parents[1] / "eval_out"


def fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


class ExplanationCompiler(FakeCompiler):
    """Inject supplier-specific explanations which fit the originating decision.

    FakeCompiler's confabulation argument currently never affects __call__.
    We therefore corrupt *cue_probe/comparison* answers at probability c.
    The wrong rule repeats the observed expert value for that supplier; it
    does not inspect held-out truth. Counterfactual/exam answers and all
    other question types retain FakeCompiler's existing behavior.
    """

    def __init__(self, confabulation: float):
        super().__init__(confabulation=confabulation)
        self.rate = confabulation
        self.opportunities: Counter = Counter()
        self.answers: list[dict[str, Any]] = []
        self.corrupted: dict[str, CompiledRule] = {}

    def answer(self, session: Session, q: Inquiry) -> str:
        text = sim_answer(session, q)
        eligible = q.type in ("cue_probe", "comparison") and q.expert_value is not None
        case = session.cases.get(q.case_id or "")
        corrupt = False
        draw = None
        if eligible and case is not None:
            # Paired draws across c and strategies for the same case/field/occurrence.
            key = (q.case_id, q.field)
            occurrence = self.opportunities[key]
            self.opportunities[key] += 1
            digest = hashlib.sha256(f"{NOISE_SEED}:{key}:{occurrence}".encode()).digest()
            draw = int.from_bytes(digest[:8], "big") / 2**64
            corrupt = draw < self.rate
            if corrupt:
                supplier = PACK.derive(case)["inv"]["supplier_id"]
                text = f"For supplier {supplier}, I always set {q.field} to {q.expert_value}."
                self.corrupted[q.id] = CompiledRule(
                    title=text, when=f"inv.supplier_id == {supplier!r}",
                    field=q.field, value=str(q.expert_value),
                    kind="guardrail" if q.field == "action" else "rule",
                    guardrail_type="hold" if q.field == "action" else None,
                )
        self.answers.append(dict(id=q.id, type=q.type, phase=q.phase, case_id=q.case_id,
                                 field=q.field, eligible=eligible and case is not None,
                                 corrupted=corrupt, draw=draw, transcript=text))
        return text

    async def __call__(self, pack, wm, inquiry, transcript, case) -> Compiled:
        wrong = self.corrupted.get(inquiry["id"])
        if wrong is not None:
            self.calls.append(inquiry)
            return Compiled(answers_question=True, key_quote=transcript,
                            rules=[wrong], strength="always")
        return await super().__call__(pack, wm, inquiry, transcript, case)


def decision_values(wm: WorkMap, case: dict[str, Any]) -> dict[str, Any]:
    prediction = run_map(wm, PACK, case)
    return {**{f: prediction.fields[f].value if f in prediction.fields else None
               for f in FIELDS if f != "action"},
            "action": prediction.action.value if prediction.action else None}


def score(wm: WorkMap, cases: list[dict[str, Any]]) -> dict[str, Any]:
    before = fingerprint(wm.model_dump())
    records = []
    counts: Counter = Counter()
    for case in cases:
        predicted = decision_values(wm, case)
        oracle = decide(case)
        truth = {**oracle.fields, "action": oracle.action}
        matched = {f: predicted[f] == truth[f] for f in FIELDS}
        counts.update(f for f, correct in matched.items() if correct)
        records.append(dict(case_id=case["id"], predicted=predicted, oracle=truth,
                            field_matches=matched, exact=all(matched.values())))
    assert fingerprint(wm.model_dump()) == before, "Evaluation changed the frozen map"
    exact = sum(r["exact"] for r in records)
    n = len(cases)
    return dict(correct_cases=exact, total_cases=n, whole_decision_agreement=exact / n,
                correct_fields=sum(counts.values()), total_fields=n * len(FIELDS),
                field_agreement=sum(counts.values()) / (n * len(FIELDS)),
                by_field={f: dict(correct=counts[f], total=n, agreement=counts[f] / n)
                          for f in FIELDS}, cases=records, map_sha256=before)


def adopt_without_verification(wm: WorkMap, compiled: Compiled, q: Inquiry) -> None:
    """Baseline approximation: use testimony as stated rules, never replay/probe it.

    Threshold statements are accepted literally; no Bayesian posterior, live
    evidence, retrospective validation, conflict probes, exam, or teach-back.
    run_map runs stated nodes, so no fabricated confirmation is necessary.
    """
    if compiled.threshold:
        wm.params[compiled.threshold.param] = compiled.threshold.value
    for cr in compiled.rules:
        step = wm.step_for_field(cr.field)
        common = dict(id=wm.next_id("G" if cr.kind == "guardrail" else "R"),
                      step_id=step.id if step else None, title=cr.title, when=cr.when,
                      origin="expert", quote=Quote(text=compiled.key_quote),
                      screen_moment=ScreenMoment(entity=q.case_id, field=q.field),
                      belief=Belief(status="stated", p=0.75))
        if cr.kind == "guardrail":
            node = Guardrail(**common, type=cr.guardrail_type or "hold",
                             action=cr.value, ask=cr.ask)
            wm.guardrails.append(node)
        else:
            node = Rule(**common, then={cr.field: cr.value},
                        kind="exception" if cr.kind == "exception" else "rule",
                        parent=cr.parent_id)
            wm.rules.append(node)
        if step:
            (step.guardrail_ids if isinstance(node, Guardrail) else step.rule_ids).append(node.id)
    wm.version += 1


async def train_shadow(rate: float) -> tuple[Session, ExplanationCompiler, dict[str, Any]]:
    compiler = ExplanationCompiler(rate)
    session = Session(f"eval-shadow-{rate}", PACK, mode="capture", use_llm=False,
                      proposer=fake_propose, compiler=compiler)
    for cid in session.case_order:
        await session.open_case(cid)
        booking, action = oracle_booking(session.cases[cid])
        await session.on_decision(cid, booking, action)
        await session.drain()
        # Same natural-boundary tick as test_engine.py; no forced extra budget.
        q = await session.tick()
        if q:
            await session.on_utterance(compiler.answer(session, q))
            await session.drain()
    await session.start_debrief()
    stopped = False
    for _ in range(80):
        await session.debrief_next()
        if session.awaiting is None:
            stopped = True
            break
        await session.on_utterance(compiler.answer(session, session.awaiting))
        await session.drain()
    return session, compiler, dict(debrief_limit=80, debrief_exhausted=not stopped,
                                   understood=session.understood())


async def train_why(rate: float) -> tuple[Session, ExplanationCompiler, dict[str, Any]]:
    compiler = ExplanationCompiler(rate)
    session = Session(f"eval-why-{rate}", PACK, mode="capture", use_llm=False,
                      proposer=fake_propose, compiler=compiler)
    divergences = 0
    for cid in session.case_order:
        case = session.cases[cid]
        predicted = decision_values(session.wm, case)
        # These are the same observed decisions used by Shadow, not held-out answers.
        booking, action = oracle_booking(case)
        observed = {**PACK.normalize(case, booking), "action": action}
        for field in FIELDS:
            if predicted[field] == observed[field]:
                continue
            divergences += 1
            q = Inquiry(id=f"why-{divergences}", type="cue_probe", case_id=cid, field=field,
                        text="Why did you choose that?", evoi=0.0,
                        expert_value=observed[field], predicted_value=predicted[field])
            text = compiler.answer(session, q)
            compiled = await compiler(PACK, session.wm, q.to_json(), text, case)
            adopt_without_verification(session.wm, compiled, q)
    return session, compiler, dict(observed_field_divergences=divergences,
                                   debrief=False, verification=False)


def summarize(strategy, rate, session, compiler, details, cases):
    training_ids = set(session.case_order)
    evaluation_ids = {c["id"] for c in cases}
    assert not training_ids & evaluation_ids
    assert not set(session.cases) & evaluation_ids, "Held-out case entered learning session"
    if strategy == "shadow":
        assert not any(e.case_id in evaluation_ids for e in session.episodes)
        assert not any(q.probe_case and q.probe_case["id"] in evaluation_ids
                       for q in session.planner.history)
    answers = compiler.answers if compiler else []
    result = dict(strategy=strategy, confabulation=rate,
                  questions_asked=len(answers),
                  questions_by_type=dict(Counter(a["type"] for a in answers)),
                  questions_by_phase=dict(Counter(a["phase"] for a in answers)),
                  corruption_eligible_answers=sum(a["eligible"] for a in answers),
                  corrupted_answers=sum(a["corrupted"] for a in answers),
                  answers=answers, training_case_ids=session.case_order,
                  learned_rules=sum(n.origin != "doc" for n in [*session.wm.rules, *session.wm.guardrails]),
                  training_details=details)
    result.update(score(session.wm, cases))
    assert result["questions_asked"] == sum(result["questions_by_type"].values())
    if strategy == "shadow":
        asked = [q for q in session.planner.history if q.status in ("asked", "answered")]
        assert len(asked) == len(answers), "Question count differs from planner history"
    return result


def render_svg(results: list[dict[str, Any]]) -> str:
    colors = {"doc-only": "#8290a5", "shadow": "#49dfb4", "ask-always-why": "#f6b65c"}
    labels = {"doc-only": "Doc only", "shadow": "Shadow + debrief", "ask-always-why": "Always why (approx.)"}
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="790" viewBox="0 0 1120 790">',
             '<rect width="1120" height="790" fill="#101924"/>',
             '<style>text{font-family:Arial,sans-serif;fill:#e4edf8}.muted{fill:#a4b2c6}.tick{font-size:13px}</style>']

    def text(x, y, value, size=15, css="", color=None):
        parts.append(f'<text x="{x}" y="{y}" font-size="{size}" class="{css}"'
                     + (f' fill="{color}"' if color else '') + f'>{escape(str(value))}</text>')

    text(40, 44, "Learning simulated Sabine’s invoice decisions", 26)
    text(40, 72, "Synthetic, oracle-assisted stand-ins · 4 observed capture cases · 60 held-out cases (seed 999)", 15, "muted")
    max_q = max(r["questions_asked"] for r in results)
    q_top = max(5, ((max_q + 4) // 5) * 5)
    for panel, (left, title, top) in enumerate(((85, "Whole-decision agreement", 100), (645, "Expert questions asked", q_top))):
        text(left - 35, 123, title, 19)
        width, height, bottom = 360, 260, 427
        for t in range(6):
            value = top * t / 5
            yy = bottom - height * t / 5
            parts.append(f'<path d="M{left},{yy}h{width}" stroke="#2a394c"/>')
            text(left - 40, yy + 5, f"{value:.0f}" + ("%" if panel == 0 else ""), 13, "tick")
        for rate in RATES:
            xx = left + width * rate / max(RATES)
            text(xx - 10, bottom + 27, f"{rate:g}", 13, "tick")
        text(left - 15, bottom + 56, "Injected explanation corruption probability c", 14, "muted")
        for strategy in colors:
            rows = [r for r in results if r["strategy"] == strategy]
            if strategy == "doc-only":
                rows = [{**rows[0], "confabulation": c} for c in RATES]
            points = []
            for row in rows:
                value = row["whole_decision_agreement"] * 100 if panel == 0 else row["questions_asked"]
                xx = left + width * row["confabulation"] / max(RATES)
                yy = bottom - height * value / top
                points.append((xx, yy))
            parts.append('<polyline fill="none" stroke="' + colors[strategy] + '" stroke-width="3" points="'
                         + ' '.join(f"{x:.2f},{y:.2f}" for x, y in points) + '"/>')
            for xx, yy in points:
                parts.append(f'<circle cx="{xx:.2f}" cy="{yy:.2f}" r="5" fill="{colors[strategy]}"/>')
    for i, strategy in enumerate(colors):
        xx = 75 + i * 340
        parts.append(f'<path d="M{xx},530h26" stroke="{colors[strategy]}" stroke-width="4"/>')
        text(xx + 36, 535, labels[strategy], 15)
    text(40, 573, "Computed results: exact cases / 60 · field agreement · questions · corrupted / eligible why answers", 14, "muted")
    for i, row in enumerate(results):
        line = (f"{labels[row['strategy']]:24}  c={row['confabulation']:g}   "
                f"{row['correct_cases']}/60   fields {row['field_agreement']:.1%}   "
                f"Q={row['questions_asked']}   corrupt={row['corrupted_answers']}/{row['corruption_eligible_answers']}")
        text(40, 599 + i * 20, line, 13)
    text(40, 750, "Unequal budgets: Shadow includes counterfactuals, self-exam and teach-back; Always why skips verification.", 13, "muted")
    text(40, 772, "Single noise seed, three rates: descriptive simulation, not an estimate of real-world accuracy or robustness.", 13, "muted")
    parts.append('</svg>')
    return '\n'.join(parts) + '\n'


async def main() -> None:
    started = time.perf_counter()
    cases = PACK.generate_cases(EVAL_SIZE, seed=EVAL_SEED)
    frozen_cases = fingerprint(cases)
    doc = Session("eval-doc", PACK, use_llm=False)
    results = [summarize("doc-only", 0.0, doc, None, dict(learning=False), cases)]
    for rate in RATES:
        for strategy, train in (("shadow", train_shadow), ("ask-always-why", train_why)):
            session, compiler, details = await train(rate)
            results.append(summarize(strategy, rate, session, compiler, details, cases))
            print(f"{strategy:16} c={rate:g}: {results[-1]['correct_cases']}/60 exact, "
                  f"{results[-1]['questions_asked']} questions, "
                  f"{results[-1]['corrupted_answers']} corrupted")
    assert fingerprint(cases) == frozen_cases, "Held-out cases were mutated"
    elapsed = time.perf_counter() - started
    payload = dict(
        schema_version=1, pack=PACK.id, evaluation_seed=EVAL_SEED, evaluation_size=EVAL_SIZE,
        evaluation_cases_sha256=frozen_cases, evaluation_case_ids=[c["id"] for c in cases],
        decision_fields=list(FIELDS), noise_seed=NOISE_SEED, confabulation_rates=list(RATES),
        elapsed_seconds=round(elapsed, 3), offline=True,
        assumptions=[
            "Synthetic simulation only: FakeCompiler and fake_propose encode oracle-informed rules; no LLM parsing is evaluated.",
            "All conditions start from the identical seed map and observe the same four demo capture decisions in order.",
            "Shadow alone uses oracle-informed fake_propose for candidate hypotheses, and spends additional questions on full debrief.",
            "Always why is an approximation: one cue probe per mismatching field in each pre-observation decision; compiled testimony is accepted as stated rules with literal thresholds, no evidence replay or debrief.",
            "c is injected explanation corruption probability, not decision noise: cue_probe/comparison answers may substitute a supplier-specific rule matching the observed outcome. The original FakeCompiler knob does not affect compilation.",
            "Question types other than cue_probe/comparison retain FakeCompiler behavior, including accurate probe answers and unconditional confirm/teach-back affirmation.",
            "Single deterministic noise seed and three rates are descriptive, not a statistical robustness estimate or a comparison at equal question budgets.",
            "Evaluation cases are never added to the session, queried during training, or used for map updates. Scoring requires all four fields to agree; missing predictions count as wrong.",
            "Doc-only has no explanations; its unchanged score is shown across c for reference.",
        ], results=results,
    )
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n')
    (OUT / "curves.svg").write_text(render_svg(results))
    print(f"Wrote {OUT / 'results.json'} and {OUT / 'curves.svg'} in {elapsed:.2f}s")


if __name__ == "__main__":
    asyncio.run(main())
