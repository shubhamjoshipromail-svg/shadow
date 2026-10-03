"""The Shadow loop for one session: Observe → Predict → Compare → Ask → Learn → Test.

Modes:
  capture  – expert works live; Shadow predicts, finds gaps, asks at pauses.
  debrief  – closes open gaps, probes unseen cases, self-exam, teach-back.
  tutor    – new hire works unseen cases; Shadow intercepts guardrail breaks.
"""

from __future__ import annotations

import asyncio
import logging
import random
import re
import time
import uuid
import zlib
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import numpy as np

from shadow import compiler as compiler_mod
from shadow import dsl, hypotheses, llm, novice, questions, receipts
from shadow import proof as proof_mod
from shadow.activity import ActivityTracker
from shadow.bayes import ThresholdPosterior, bald_discrete, entropy, posterior_update
from shadow.packs.base import Pack
from shadow.planner import Inquiry, Planner, impact_on_pool, sample_pool
from shadow.store import Store
from shadow.workmap import (TRUSTED, Evidence, Guardrail, MapPrediction, Quote, Rule, ScreenMoment, WorkMap,
                            check_proposal, run_map)

log = logging.getLogger("shadow.engine")

OFF_RECORD = re.compile(r"\b(off the record|nicht aufnehmen|inoffiziell)\b", re.I)
ON_RECORD = re.compile(r"\b(back on the record|on the record again|wieder aufnehmen)\b", re.I)

Proposer = Callable[..., Awaitable[list[hypotheses.ProposedRule]]]
Compiler = Callable[..., Awaitable[compiler_mod.Compiled]]


@dataclass
class Episode:
    id: str
    case_id: str
    ts: float
    expert: dict[str, Any]
    predicted: dict[str, Any]
    gaps: list[dict[str, Any]] = field(default_factory=list)
    synthetic: bool = False
    weight: float = 1.0
    source_inquiry: str | None = None
    scored: bool = True  # False if the prediction wasn't committed before the decision arrived
    evaluation: bool = False  # self-exam answer: scored, never learned from

    def to_json(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class DecisionPoint:
    case_id: str
    opened_at: float
    prediction: MapPrediction | None = None
    attention: list[str] = field(default_factory=list)
    field_moments: dict[str, dict[str, Any]] = field(default_factory=dict)
    task: asyncio.Task | None = None
    committed_at: float | None = None
    map_version: int | None = None  # the map the committed prediction came from


class Session:
    def __init__(self, sid: str, pack: Pack, mode: str = "capture", expert: str | None = None,
                 wm: WorkMap | None = None, store: Store | None = None, use_llm: bool = True,
                 proposer: Proposer | None = None, compiler: Compiler | None = None, lang: str = "en",
                 trainee: str | None = None):
        self.id = sid
        self.pack = pack
        self.mode = mode
        self.expert = expert or pack.expert_name
        self.trainee = trainee
        self.lang = lang
        self.store = store
        self.use_llm = use_llm and llm.available()
        self.proposer = proposer or hypotheses.propose
        self.compiler = compiler or compiler_mod.compile_answer
        self.t0 = time.time()
        self.wm = wm or WorkMap(pack_id=pack.id, task=pack.task, expert=self.expert, **pack.seed_map())
        demo = pack.demo_cases()
        self.cases: dict[str, dict[str, Any]] = {c["id"]: c for c in demo["capture"] + demo["tutor"]}
        self.case_order = [c["id"] for c in (demo["tutor"] if mode == "tutor" else demo["capture"])]
        self.planner = Planner()
        self.activity = ActivityTracker()
        self.posteriors: dict[str, ThresholdPosterior] = {}
        self.param_quantity: dict[str, str] = {}
        self.episodes: list[Episode] = []
        self.dps: dict[str, DecisionPoint] = {}
        self.hsets: dict[str, hypotheses.HypothesisSet] = {}
        self.current_case: str | None = None
        self.awaiting: Inquiry | None = None
        self.off_record = False
        self.transcript: list[dict[str, Any]] = []
        self.listeners: set[Callable[[dict[str, Any]], Awaitable[None]]] = set()
        self.pool = sample_pool(pack)
        self.tasks: set[asyncio.Task] = set()
        self.silence_log: list[dict[str, Any]] = []
        self.exam: list[dict[str, Any]] = []
        self.exam_results: list[bool] = []
        self.exam_cursor = 0
        self.exam_round = 0
        self.exam_retries = 0
        self.exam_fp: str | None = None
        self.exam_used: set[str] = set()
        self.exam_failures: list[tuple[Episode, dict[str, Any], str, Any]] = []
        self.teachback_pending = False
        self.last_learn: asyncio.Task | None = None
        self.tutor_attempted: set[str] = set()
        self.teachback_text: str | None = None
        self.teachback_confirmed = False
        self.mastery: dict[str, dict[str, Any]] = {}
        self.pending_interventions: dict[str, dict[str, Any]] = {}
        self.rng = random.Random(5)
        self.simulated = False  # oracle-driven proposer/compiler (Rehearsal); set by the API
        self.map_source: dict[str, Any] = {"kind": "seed" if wm is None else "given", "version": self.wm.version}
        self.receipts: list[dict[str, Any]] = []
        self.proofs: dict[str, dict[str, Any]] = {}
        self.proof_round = 0
        for node in [*self.wm.rules, *self.wm.guardrails]:
            if node.origin != "doc":
                node.refresh_belief()
        self._restore_params()

    # ------------------------------------------------------------ plumbing
    def now(self) -> float:
        return round(time.time() - self.t0, 2)

    async def emit(self, type_: str, payload: dict[str, Any]) -> None:
        msg = {"type": type_, "t": self.now(), **payload}
        if self.store and type_ not in ("activity", "pii_rects"):
            try:
                self.store.append(self.id, type_, msg)
            except Exception:  # noqa: BLE001
                log.exception("store append failed")
        for fn in list(self.listeners):
            try:
                await fn(msg)
            except Exception:  # noqa: BLE001
                self.listeners.discard(fn)

    def spawn(self, coro: Awaitable[Any]) -> asyncio.Task:
        task = asyncio.ensure_future(coro)
        self.tasks.add(task)
        task.add_done_callback(self._task_done)
        return task

    def _task_done(self, task: asyncio.Task) -> None:
        self.tasks.discard(task)
        if not task.cancelled() and task.exception():
            log.error("background task failed", exc_info=task.exception())

    async def drain(self) -> None:
        while self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id, "mode": self.mode, "expert": self.expert, "trainee": self.trainee, "lang": self.lang,
            "pack": {"id": self.pack.id, "name": self.pack.name,
                     "fields": [f.__dict__ for f in self.pack.decision_fields], "actions": self.pack.actions},
            "map": self.wm.model_dump(), "current_case": self.current_case,
            "cases": [self.cases[c] for c in self.case_order],
            "predictions": {cid: dp.prediction.model_dump() for cid, dp in self.dps.items() if dp.prediction},
            "episodes": [e.to_json() for e in self.episodes],
            "hypotheses": {k: v.to_json() for k, v in self.hsets.items()},
            "inquiries": [q.to_json() for q in [*self.planner.history, *self.planner.queue]],
            "posteriors": {k: p.summary() for k, p in self.posteriors.items()},
            "silence_log": self.silence_log[-50:], "off_record": self.off_record,
            "understood": self.understood(), "mastery": self.mastery, "metrics": self.metrics(),
            "activity": self.activity.state(), "simulated": self.simulated, "map_source": self.map_source,
            "receipts": [{**r, "summary": receipts.summarize(r)} for r in self.receipts],
            "proofs": {k: proof_mod.view(p) for k, p in self.proofs.items()},
            "pending": self.pending(),
        }

    def pending(self) -> dict[str, Any]:
        """Work in flight, so nobody mistakes 'still compiling' for 'learned nothing'."""
        return {"awaiting": self.awaiting.id if self.awaiting else None,
                "compiling": bool(self.last_learn and not self.last_learn.done()),
                "background_tasks": len(self.tasks)}

    def metrics(self) -> dict[str, Any]:
        real = [e for e in self.episodes if not e.synthetic]
        scored = [e for e in real if e.scored]
        decisions = sum(len([f for f in e.expert if e.expert[f] is not None]) for e in scored)
        correct = sum(1 for e in scored for f, v in e.expert.items() if v is not None and e.predicted.get(f) == v)
        asked = [q for q in self.planner.history if q.status in ("asked", "answered")]
        return {
            "episodes": len(real), "decisions": decisions,
            "prospective_accuracy": round(correct / decisions, 3) if decisions else None,
            "gaps": sum(len(e.gaps) for e in real),
            "questions_live": sum(1 for q in asked if q.phase == "live"),
            "questions_debrief": sum(1 for q in asked if q.phase == "debrief"),
            "silent_decisions": len(self.silence_log),
            "rules_learned": sum(1 for r in [*self.wm.rules, *self.wm.guardrails] if r.origin != "doc"),
            "rules_confirmed": sum(1 for r in [*self.wm.rules, *self.wm.guardrails]
                                   if r.origin != "doc" and r.belief.status == "confirmed"),
        }

    # ------------------------------------------------------------ capture events
    async def on_event(self, evt: dict[str, Any]) -> dict[str, Any] | None:
        kind = evt.get("type")
        if kind in ("input", "key", "mouse", "scroll"):
            self.activity.input(evt.get("kind", kind))
            return None
        if kind == "speech":
            self.activity.speech(bool(evt.get("speaking")), evt.get("who", "user"))
            return None
        if kind == "screen_changed":
            self.activity.screen_changed()
            return None
        if kind == "ask_now":
            # the expert tapped Shadow's raised hand: they chose the moment, so no pause is needed
            return {"asked": bool(await self.tick(force=True))}
        if kind == "ask_later":
            for q in self.planner.queue:
                if q.phase == "live":
                    q.phase = "debrief"
            self.planner.lam *= 1.3  # this expert wants fewer live questions
            await self.emit("inquiry_deferred", {"lambda": round(self.planner.lam, 3)})
            return None
        if kind == "replay_request":
            iv = self.pending_interventions.get(evt.get("intervention_id", ""))
            if iv:
                await self.emit("replay", {"screen_moment": iv.get("screen_moment"), "intervention_id": iv["id"],
                                          "quote": (iv.get("violation") or {}).get("quote")})
            return None
        if kind == "pii_rects":
            await self.emit("pii_rects", {"rects": evt.get("rects", []), "vw": evt.get("vw"), "vh": evt.get("vh")})
            return None
        if self.off_record and kind not in ("record",):
            return None
        if kind == "case_opened":
            await self.open_case(evt["case_id"])
        elif kind == "field_changed":
            self.activity.input("key")
            dp = self.dps.get(evt.get("case_id") or self.current_case or "")
            if dp:
                dp.field_moments[evt["field"]] = {"ts": self.now(), "before": evt.get("before"),
                                                  "after": evt.get("after"), "frame_id": evt.get("frame_id")}
                dp.attention.append(f"booking.{evt['field']}")
            await self.emit("screen_event", {"event": evt})
        elif kind == "panel_opened":
            dp = self.dps.get(self.current_case or "")
            if dp:
                dp.attention.append(f"panel.{evt.get('panel')}")
            await self.emit("screen_event", {"event": evt})
        elif kind == "decision":
            if self.mode == "tutor":
                return await self.tutor_decision(evt["case_id"], evt.get("booking") or {}, evt["action"])
            await self.on_decision(evt["case_id"], evt.get("booking") or {}, evt["action"])
        elif kind == "vision":
            await self.emit("screen_event", {"event": evt})
        return None

    async def open_case(self, case_id: str) -> None:
        if case_id not in self.cases:
            return
        self.current_case = case_id
        moved = self.planner.decay(case_id)
        for q in moved:
            await self.emit("inquiry", {"inquiry": q.to_json(), "note": "moved to debrief (expert moved on)"})
        if case_id in self.dps and self.dps[case_id].prediction:
            return
        dp = DecisionPoint(case_id=case_id, opened_at=self.now())
        self.dps[case_id] = dp
        if self.mode == "tutor":
            await self.tutor_open(case_id)
            return
        dp.task = asyncio.ensure_future(self._commit_prediction(dp))
        await dp.task

    async def _commit_prediction(self, dp: DecisionPoint) -> None:
        pred = await novice.predict(self.wm, self.pack, self.cases[dp.case_id], use_llm=self.use_llm)
        dp.prediction = pred
        dp.committed_at = self.now()
        dp.map_version = self.wm.version
        await self.emit("prediction", {"case_id": dp.case_id, "prediction": pred.model_dump(),
                                       "committed_at": dp.committed_at, "map_version": self.wm.version,
                                       "case": self.pack.describe(self.cases[dp.case_id])})

    # ------------------------------------------------------------ compare + learn
    def add_frozen_case(self, case: dict[str, Any], pred: MapPrediction) -> None:
        """A test case whose prediction is committed now, before anyone has seen it."""
        self.cases[case["id"]] = case
        if case["id"] not in self.case_order:
            self.case_order.append(case["id"])
        self.dps[case["id"]] = DecisionPoint(case_id=case["id"], opened_at=self.now(), prediction=pred,
                                             committed_at=self.now(), map_version=self.wm.version)

    async def on_decision(self, case_id: str, booking: dict[str, Any], action: str) -> None:
        case = self.cases[case_id]
        await self.on_judgment(case_id, {**self.pack.normalize(case, booking), "action": action}, via="erp")

    async def on_label(self, case_id: str, fields: dict[str, Any]) -> None:
        """A judgment given directly (e.g. an evaluator labelling a sealed test case): a partial decision."""
        if case_id not in self.cases:
            raise KeyError(case_id)
        await self.on_judgment(case_id, dict(fields), via="label")

    async def on_judgment(self, case_id: str, expert: dict[str, Any], via: str = "erp") -> None:
        case = self.cases[case_id]
        dp = self.dps.get(case_id)
        # only predictions committed before the decision arrived count as prospective
        scored = dp is not None and dp.prediction is not None
        if dp is None:
            await self.open_case(case_id)
            dp = self.dps[case_id]
        elif dp.prediction is None and dp.task is not None:
            await dp.task
        pred = dp.prediction
        predicted = {k: fp.value for k, fp in pred.fields.items()}
        predicted["action"] = pred.action.value if pred.action else None
        ep = Episode(id=f"ep{len(self.episodes) + 1}", case_id=case_id, ts=self.now(), expert=expert,
                     predicted=predicted, scored=scored)
        self.episodes.append(ep)
        self.activity.boundary()
        proof = proof_mod.record_label(self, case_id, expert, via)
        if proof:
            await self.emit("proof", {"proof": proof_mod.view(proof)})
        if scored:
            await self._independent_checks(ep, case, dp)
        before, bases_before = self.wm.model_copy(deep=True), dict(self.param_quantity)
        self._record_evidence(ep, case)
        self._observe_thresholds(case, expert, weight=1.0)
        await self._behavior_receipt(ep, case, before, bases_before)
        for f, val in expert.items():
            if val is None:
                continue
            source = pred.action.source if f == "action" and pred.action else (
                pred.fields[f].source if f in pred.fields else "novice")
            if predicted.get(f) == val:
                entry = {"case_id": case_id, "field": f, "value": val, "why_silent": f"predicted correctly ({source})"}
                self.silence_log.append(entry)
                await self.emit("silence", entry)
                continue
            gap = await self._classify_gap(ep, case, f, val, predicted.get(f))
            ep.gaps.append(gap)
        extra = {"posteriors": {k: p.summary() for k, p in self.posteriors.items()},
                 "map": self.wm.model_dump()} if self.posteriors else {}
        await self.emit("episode", {"episode": ep.to_json(), "metrics": self.metrics(), **extra})
        for gap in ep.gaps:
            if gap["type"] == "structural":
                self._quick_question(case, gap)  # ask now; don't wait for the LLM's explanations
                self.spawn(self.analyze_gap(ep, case, gap))
        self._maybe_guardrail_question(case, ep)
        if self.store:
            self.store.save_map(self.expert, self.pack.id, self.id, self.wm.version, self.wm.model_dump())

    # ------------------------------------------------------------ receipts
    def _provenance(self) -> dict[str, Any]:
        live_compiler = self.compiler is compiler_mod.compile_answer
        return {"mode": "rehearsal" if self.simulated else "live",
                "compiler": (llm.last_model or "llm") if live_compiler else getattr(
                    self.compiler, "provenance", "simulated (oracle)"),
                "map_source": dict(self.map_source)}

    async def _publish_receipt(self, receipt: dict[str, Any], update: bool = False) -> None:
        if not update:
            self.receipts.append(receipt)
        await self.emit("receipt", {"receipt": {**receipt, "summary": receipts.summarize(receipt)}, "update": update})

    def _new_receipt(self, trigger: str, **kw: Any) -> dict[str, Any]:
        return {"id": f"rc{len(self.receipts) + 1}", "trigger": trigger, "t": self.now(), "session": self.id,
                "provenance": self._provenance(), "status": "learned", "independent": [], **kw}

    async def _independent_checks(self, ep: Episode, case: dict[str, Any], dp: DecisionPoint) -> None:
        """A decision on a case nobody taught about, predicted with the new knowledge already in the map."""
        if dp.prediction is None or dp.map_version is None:
            return
        ctx = {**self.pack.derive(case), "params": self.wm.params, "booking": ep.expert}
        for rc in self.receipts:
            after_v = (rc.get("diff") or {}).get("version", {}).get("after")
            if rc["status"] != "learned" or after_v is None or dp.map_version < after_v:
                continue
            if case["id"] in (rc.get("case_id"), rc.get("probe_case_id")):
                continue  # the case it was taught on can't test it
            touched = False
            for node in receipts.nodes_under_test(rc, self.wm):
                f = receipts.target_field(node)
                if ep.expert.get(f) is None or not receipts.relevant(node, dp.prediction, ctx):
                    continue
                if any(c["episode"] == ep.id and c["field"] == f for c in rc["independent"]):
                    continue
                predicted, source = receipts.field_value(dp.prediction, f)
                rc["independent"].append({"episode": ep.id, "case_id": case["id"], "field": f, "node": node.id,
                                          "predicted": predicted, "decided_by": source, "expert": ep.expert[f],
                                          "agrees": predicted == ep.expert[f], "map_version": dp.map_version,
                                          "proof": case.get("_proof"), "t": self.now()})
                touched = True
            if touched:
                await self._publish_receipt(rc, update=True)

    async def _behavior_receipt(self, ep: Episode, case: dict[str, Any], before: WorkMap,
                                bases_before: dict[str, str]) -> None:
        """A decision that moved a learned threshold: behavior correcting words, with its own receipt."""
        moved = []
        for p, old in before.params.items():
            new, q_old, q_new = self.wm.params.get(p), bases_before.get(p), self.param_quantity.get(p)
            if new is None:
                continue
            if q_old != q_new or abs(new - old) >= max(0.02 * abs(old), 1e-6):
                moved.append(p)
        rules = [r for r in self.wm.rules if any(f"params.{p}" in r.when for p in moved) and r.origin != "doc"]
        fields = {receipts.target_field(r) for r in rules}
        changed = [f for f in fields if ep.expert.get(f) is not None and ep.predicted.get(f) != ep.expert.get(f)]
        if not changed and not any(bases_before.get(p) != self.param_quantity.get(p) for p in moved):
            return  # only a counterexample (or a basis flip) earns a receipt; agreeing cases just firm it up
        self.wm.version += 1
        f = changed[0] if changed else next(iter(fields), None)
        if f is None:
            return
        rc = self._new_receipt(
            "decision", case_id=case["id"], field=f, inquiry_id=None,
            question=None, teaching={"behavior": f"{self.expert} chose {f} = {ep.expert.get(f)!r}",
                                     "case": self.pack.describe(case)},
            expert_value=ep.expert.get(f),
            before=receipts.predict_field(before, self.pack, case, f),
            after=receipts.predict_field(self.wm, self.pack, case, f),
            diff=receipts.diff_maps(before, self.wm, bases_before, dict(self.param_quantity)))
        rc["before"]["committed"] = ep.predicted.get(f)
        rc["provenance"]["compiler"] = "none: learned from the decision itself"
        await self._publish_receipt(rc)

    def _record_evidence(self, ep: Episode, case: dict[str, Any]) -> None:
        self._judge(case, ep.expert, ep.id, "live")

    def _judge(self, case: dict[str, Any], expert: dict[str, Any], episode_id: str, kind: str,
               skip: set[str] | None = None) -> None:
        """Record evidence for the rules this decision actually tests.

        A rule is on trial for a field only if it decided that field in the current map (a rule that lost
        to a higher-priority one isn't contradicted), or if it fired and agreed with the expert.
        """
        ctx = {**self.pack.derive(case), "params": self.wm.params, "booking": expert}
        pred = run_map(self.wm, self.pack, case)
        deciding = {f: fp.source for f, fp in pred.fields.items()}
        if pred.action:
            deciding["action"] = pred.action.source
        for node in [*self.wm.rules, *self.wm.guardrails]:
            if (skip and node.id in skip) or not dsl.holds(node.when, ctx):
                continue
            targets = node.then if isinstance(node, Rule) else {"action": node.action}
            touched = False
            for f, v in targets.items():
                if expert.get(f) is None:
                    continue
                agrees = expert[f] == v or v == "block"
                if agrees or deciding.get(f) == node.id:
                    node.evidence.append(Evidence(episode_id=episode_id, kind=kind, agrees=agrees))
                    touched = True
            if touched:
                node.refresh_belief()

    async def _classify_gap(self, ep: Episode, case: dict[str, Any], f: str, val: Any, predicted: Any) -> dict[str, Any]:
        gap = {"id": f"{ep.id}.{f}", "field": f, "expert": val, "predicted": predicted, "case_id": case["id"]}
        # (1) parametric: a learned threshold moved and now explains it
        now_pred = run_map(self.wm, self.pack, case)
        now_val = (now_pred.action.value if now_pred.action else None) if f == "action" else (
            now_pred.fields[f].value if f in now_pred.fields else None)
        if now_val == val:
            gap.update(type="parametric", why="absorbed by updated parameters — no question needed",
                       params={k: round(v, 1) for k, v in self.wm.params.items()})
            self.silence_log.append({"case_id": case["id"], "field": f, "value": val, "why_silent": gap["why"]})
            await self.emit("silence", self.silence_log[-1])
            return gap
        gap.update(type="structural", why="nothing in the current model explains it")
        return gap

    # ------------------------------------------------------------ thresholds
    def _restore_params(self) -> None:
        known = {q for spec in self.pack.threshold_params().values() for q in spec["bases"].values()}
        for name, value in self.wm.params.items():
            # the quantity the parameter is compared against (a set of referenced names has no useful order)
            quantity = next((q for r in self.wm.rules if f"params.{name}" in r.when
                             for q in sorted(dsl.fields_referenced(r.when)) if q in known), None)
            if quantity:
                self._ensure_posterior(name, value, quantity)

    def _ensure_posterior(self, param: str, value: float, quantity: str) -> ThresholdPosterior | None:
        if param in self.posteriors:
            return self.posteriors[param]
        spec_kind = next((k for k, s in self.pack.threshold_params().items() if quantity in s["bases"].values()), None)
        if spec_kind is None:
            return None
        spec = self.pack.threshold_params()[spec_kind]
        bases = list(spec["bases"])
        sd = max(abs(value) * 0.08, spec["step"] * 4)
        post = ThresholdPosterior.make(param, spec["lo"], spec["hi"], spec["step"], bases, prior_mean=value,
                                       prior_sd=sd, scale=spec["scale"])
        # testimony names a basis; give it a modest head start, not certainty
        stated = next((b for b, q in spec["bases"].items() if q == quantity), bases[0])
        post.log_post[bases.index(stated)] += np.log(2.0)
        self.posteriors[param] = post
        self.param_quantity[param] = quantity
        self.wm.params[param] = value
        return post

    def _quantities(self, param: str, case: dict[str, Any]) -> dict[str, float] | None:
        post = self.posteriors[param]
        spec = next(s for s in self.pack.threshold_params().values() if set(post.bases) == set(s["bases"]))
        ctx = self.pack.derive(case)
        out = {}
        for basis, q in spec["bases"].items():
            v = dsl.evaluate(q, ctx)
            if v is None:
                return None
            out[basis] = float(v)
        return out

    def _observe_thresholds(self, case: dict[str, Any], expert: dict[str, Any], weight: float) -> bool:
        """Every decision on a case a threshold rule could apply to is evidence about the threshold."""
        changed = False
        for param in self.posteriors:
            if self._observe_thresholds_single(param, case, expert, weight):
                changed = True
                self._apply_posterior(param)
        return changed

    def _threshold_label(self, r: Rule, param: str, case: dict[str, Any], expert: dict[str, Any]) -> bool | None:
        """Was this case above the expert's threshold? None if the case says nothing about it.

        Only attributable outcomes count: the expert chose the rule's value (above), or chose what the map
        would do without the rule (below). If another learned rule decides the field, or the expert chose
        something else entirely, the case is about a different rule and is skipped.
        """
        f, v = next(iter(r.then.items()))
        if expert.get(f) is None:
            return None
        ctx = {**self.pack.derive(case), "params": {**self.wm.params, param: -1e12}}
        if not dsl.holds(r.when, ctx):
            return None  # the rest of the condition fails: the threshold isn't what decides this case
        others = [o for o in self.wm.rules if o is not r and o.origin != "doc" and o.belief.status != "contested"
                  and f in o.then and dsl.holds(o.when, {**self.pack.derive(case), "params": self.wm.params})]
        if others:
            return None
        if expert[f] == v:
            return True
        without = self.wm.model_copy(deep=True)
        without.rules = [o for o in without.rules if o.id != r.id]
        alt = run_map(without, self.pack, case).fields.get(f)
        return False if alt is not None and alt.value == expert[f] else None

    def _observe_thresholds_single(self, param: str, case: dict[str, Any], expert: dict[str, Any],
                                   weight: float) -> bool:
        post = self.posteriors[param]
        observed = False
        for r in [r for r in self.wm.rules if f"params.{param}" in r.when and r.belief.status != "contested"]:
            label = self._threshold_label(r, param, case, expert)
            xs = self._quantities(param, case)
            if label is None or xs is None:
                continue
            post.observe(xs, label=label, weight=weight)
            observed = True
        return observed

    def _apply_posterior(self, param: str) -> None:
        post = self.posteriors[param]
        s = post.summary()
        self.wm.params[param] = s["mean"]
        spec = next(sp for sp in self.pack.threshold_params().values() if set(post.bases) == set(sp["bases"]))
        best_q = spec["bases"][s["basis"]]
        old_q = self.param_quantity.get(param)
        if old_q and best_q != old_q:
            # the evidence says the expert's threshold applies to a different quantity (e.g. gross, not net)
            for r in self.wm.rules:
                if f"params.{param}" in r.when:
                    r.when = r.when.replace(old_q, best_q)
            self.param_quantity[param] = best_q

    # ------------------------------------------------------------ hypotheses + inquiry
    def _quick_question(self, case: dict[str, Any], gap: dict[str, Any]) -> None:
        """An open cue probe needs no hypotheses, so it can go out at the very next pause.

        Hypothesis generation (an LLM call, several seconds) continues in the background; if it
        finishes before the question is spoken, the planner may replace it with a sharper one.
        """
        if self.mode != "capture":
            return
        f = gap["field"]
        dp = self.dps.get(case["id"])
        moment = (dp.field_moments.get(f) if dp else None) or {"ts": dp.opened_at if dp else self.now()}
        q = Inquiry(id=self.planner.new_id(), type="cue_probe", case_id=case["id"], field=f, text="",
                    evoi=1.0, impact=0.8, guardrail_gap=1.0 if f == "action" else 0.0, phase="live",
                    gap_id=gap["id"], expert_value=gap["expert"], predicted_value=gap["predicted"],
                    screen_moment=moment, reason="open question asked right away; explanations still forming")
        q.text = questions.template(self.pack, "cue_probe", case=case, field=f, expert_value=gap["expert"],
                                    predicted_value=gap["predicted"])
        self.planner.enqueue(q)
        self.spawn(self.emit("inquiry", {"inquiry": q.to_json()}))

    async def analyze_gap(self, ep: Episode, case: dict[str, Any], gap: dict[str, Any]) -> None:
        f, val, predicted = gap["field"], gap["expert"], gap["predicted"]
        dp = self.dps.get(case["id"])
        attention = dp.attention if dp else []
        proposals: list[hypotheses.ProposedRule] = []
        if self.use_llm or self.proposer is not hypotheses.propose:
            try:
                proposals = await self.proposer(self.pack, self.wm, case, f, val, predicted, attention)
            except Exception:  # noqa: BLE001
                log.exception("hypothesis proposal failed")
        history = [(self.cases[e.case_id] if e.case_id in self.cases else None, e.expert)
                   for e in self.episodes if e.id != ep.id and not e.synthetic]
        history = [(c, v) for c, v in history if c is not None]
        attention_fields = {a.split(".", 1)[-1] for a in attention}
        hs = hypotheses.score(self.pack, self.wm, case, f, val, predicted, proposals, history, attention_fields,
                              gap["id"])
        self.hsets[gap["id"]] = hs
        await self.emit("hypotheses", {"set": hs.to_json()})
        await self.plan_inquiry(hs, case, phase="live" if self.mode == "capture" else "debrief")

    async def plan_inquiry(self, hs: hypotheses.HypothesisSet, case: dict[str, Any], phase: str = "live") -> None:
        f = hs.field
        prior = [q for q in [*self.planner.queue, *self.planner.history] if q.gap_id == hs.gap_id]
        if any(q.status in ("asked", "answered") for q in prior):
            return  # already asked; its answer will collapse these hypotheses
        for q in prior:
            if q in self.planner.queue:
                self.planner.queue.remove(q)  # replace the provisional open question with a planned one
        dp = self.dps.get(case["id"])
        moment = (dp.field_moments.get(f) if dp else None) or {"ts": dp.opened_at if dp else self.now()}
        H = hs.entropy()
        top = hs.top()
        ranked = sorted(hs.items, key=lambda h: -h.posterior)
        hyp_json = [{"id": h.id, "title": h.title, "p": h.posterior} for h in ranked[:3]]
        bald_h = hs.as_bald(self.wm, self.pack)
        baseline = bald_h[-1].predict
        impact = impact_on_pool([(h.prob, h.predict) for h in bald_h[:-1]], baseline, self.pool) if hs.items else 0.8
        guardrail_gap = 1.0 if f == "action" and not [g for g in self.wm.guardrails if g.origin != "doc"] else (
            0.4 if f == "action" else 0.0)
        base = dict(case_id=case["id"], field=f, gap_id=hs.gap_id, expert_value=hs.expert_value,
                    predicted_value=hs.predicted_value, hypotheses=hyp_json, phase=phase,
                    impact=impact, guardrail_gap=guardrail_gap, screen_moment=moment)
        cands: list[Inquiry] = []
        # discovery: open cue probe (only way to find features nobody proposed)
        cands.append(Inquiry(id=self.planner.new_id(), type="cue_probe", evoi=round(H + hs.p_unknown, 3),
                             text="", **base))
        if top and top.posterior >= 0.35:
            p = top.posterior
            be = -(p * np.log2(p) + (1 - p) * np.log2(1 - p)) if 0 < p < 1 else 0.0
            cands.append(Inquiry(id=self.planner.new_id(), type="confirm", evoi=round(float(be) * 0.95, 3),
                                 text="", **{**base, "hypotheses": hyp_json[:1]}))
        if len(ranked) >= 2 and ranked[1].posterior > 0.12:
            cands.append(Inquiry(id=self.planner.new_id(), type="comparison",
                                 evoi=round(entropy([ranked[0].posterior, ranked[1].posterior]) * 0.9, 3),
                                 text="", **base))
        if len(bald_h) >= 2:
            probes = self.pack.perturb(case, random.Random(len(self.episodes)))
            scored = [(bald_discrete(bald_h, v), v) for v in probes]
            best_mi, best_case = max(scored, key=lambda t: t[0], default=(0.0, None))
            if best_case is not None and best_mi > 0.05:
                cands.append(Inquiry(id=self.planner.new_id(), type="counterfactual", evoi=round(best_mi, 3),
                                     text="", probe_case=best_case,
                                     probe_delta=self.pack.describe_delta(case, best_case), **base))
        for c in cands:
            self.planner.price(c)
        ctx = self.planner.bandit_context(H, hs.p_unknown, top.posterior if top else 0.0)
        chosen = self.planner.choose_type(cands, ctx)
        if chosen is None:
            best = max(cands, key=lambda c: c.value)
            best.status = "silent"
            best.reason = f"best value {best.value:.2f} ≤ 0 — not worth interrupting"
            best.text = questions.template(self.pack, best.type, case=case, field=f, expert_value=hs.expert_value,
                                           predicted_value=hs.predicted_value, hypotheses=best.hypotheses,
                                           probe_delta=best.probe_delta)
            self.planner.history.append(best)
            entry = {"case_id": case["id"], "field": f, "value": hs.expert_value, "why_silent": best.reason}
            self.silence_log.append(entry)
            await self.emit("silence", entry)
            return
        chosen.bandit_ctx = ctx.tolist()  # type: ignore[attr-defined]
        if "_probe" in case and chosen.type == "cue_probe":
            # the gap came from a hypothetical: the expert *said* it, they didn't *do* it
            chosen.text = (f"You said that if {case['_probe']['delta'].rstrip('. ')}, you'd "
                           f"{questions.value_phrase(self.pack, f, hs.expert_value)}. What's the rule there?")
        else:
            chosen.text = questions.template(self.pack, chosen.type, case=case, field=f,
                                             expert_value=hs.expert_value, predicted_value=hs.predicted_value,
                                             hypotheses=chosen.hypotheses, probe_delta=chosen.probe_delta)
        if self.use_llm and phase != "live":
            chosen.text = await questions.polish(chosen.text, self.lang)
        chosen.reason = (f"EVOI {chosen.evoi:.2f} bits × impact {chosen.impact:.2f} + guardrail {chosen.guardrail_gap:.1f} "
                         f"− cost {chosen.cost:.2f} = {chosen.value:.2f}")
        self.planner.enqueue(chosen)
        await self.emit("inquiry", {"inquiry": chosen.to_json(),
                                    "alternatives": [{"type": c.type, "evoi": c.evoi, "value": c.value} for c in cands]})

    def _maybe_guardrail_question(self, case: dict[str, Any], ep: Episode) -> None:
        """Steps with no known limit get a guardrail question — by design, not by script."""
        has_guardrail = any(g.origin != "doc" for g in self.wm.guardrails)
        already = any(q.type == "guardrail" for q in [*self.planner.queue, *self.planner.history])
        if has_guardrail or already or len([e for e in self.episodes if not e.synthetic]) < 2:
            return  # specific gap questions first; the general guardrail question once a pattern is visible
        q = Inquiry(id=self.planner.new_id(), type="guardrail", case_id=case["id"], field="action",
                    text=questions.template(self.pack, "guardrail", case=case, field="action"),
                    evoi=0.45, impact=1.0, guardrail_gap=1.0,
                    phase="live" if self.mode == "capture" else "debrief",
                    screen_moment={"ts": ep.ts}, reason="no guardrail known for the posting step yet")
        self.planner.enqueue(q)
        self.spawn(self.emit("inquiry", {"inquiry": q.to_json()}))

    async def tick(self, force: bool = False) -> Inquiry | None:
        """Called frequently; releases a queued question at a natural pause (or now, if the expert asked)."""
        state = self.activity.state()
        sig = (state["paused"], tuple(state["blocking"]))
        if sig != getattr(self, "_last_activity", None):
            self._last_activity = sig
            await self.emit("activity", {"activity": state})
        if self.mode != "capture" or self.awaiting or self.off_record:
            return None
        q = self.planner.release(state["paused"] or force, self.current_case, ignore_budget=force)
        if q:
            self.awaiting = q
            await self.emit("ask", {"inquiry": q.to_json(), "activity": state, "expert_initiated": force})
        return q

    # ------------------------------------------------------------ answers
    async def on_utterance(self, text: str, who: str = "user") -> str | None:
        """Expert/trainee speech. Returns an immediate short reply for the voice agent, if any."""
        self.transcript.append({"t": self.now(), "who": who, "text": text})
        if ON_RECORD.search(text) and self.off_record:
            self.off_record = False
            await self.emit("record", {"off_record": False})
            return "Okay, we're back on the record."
        if OFF_RECORD.search(text):
            self.off_record = True
            await self.emit("record", {"off_record": True})
            return "Understood, I'm not recording this. Say 'back on the record' when you're ready."
        if self.off_record:
            return ""
        await self.emit("utterance", {"who": who, "text": text})
        if self.mode == "tutor":
            return None  # tutor replies are generated by the conversation layer
        q = self.awaiting
        if q is None:
            return None
        self.awaiting = None
        q.status = "answered"
        self.last_learn = self.spawn(self.learn_from_answer(q, text))
        if self.mode == "debrief":
            return None
        return self.rng.choice(["Got it, thanks.", "That helps, thank you.", "Makes sense. Thanks."])

    async def wait_learning(self, timeout: float = 15.0) -> None:
        """Turn barrier: the next debrief question waits until the last answer is in the map."""
        task = self.last_learn
        if task and not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout)
            except asyncio.TimeoutError:
                log.warning("answer compilation still running after %ss", timeout)

    def _map_fp(self) -> str:
        """Fingerprint of everything that changes predictions; an exam is only valid for the map it tested."""
        parts = [(n.id, n.when, getattr(n, "then", None) or getattr(n, "action", None), getattr(n, "priority", 0),
                  n.belief.status == "contested") for n in [*self.wm.rules, *self.wm.guardrails]]
        params = {k: round(v, -1) for k, v in self.wm.params.items()}
        return str(zlib.crc32(repr((parts, sorted(params.items()))).encode()))

    async def learn_from_answer(self, q: Inquiry, transcript: str) -> None:
        case = self.cases.get(q.case_id or "") if q.case_id else None
        if q.probe_case is not None:
            case_for_compile = q.probe_case
        else:
            case_for_compile = case
        hs = self.hsets.get(q.gap_id or "")
        h_before = hs.entropy() if hs else None
        before, bases_before = self.wm.model_copy(deep=True), dict(self.param_quantity)
        f = q.field
        rc = self._new_receipt(
            "answer", inquiry_id=q.id, case_id=q.case_id,
            probe_case_id=q.probe_case["id"] if q.probe_case is not None else None, field=f,
            question={"type": q.type, "text": q.text, "probe_delta": q.probe_delta},
            teaching={"transcript": transcript}, expert_value=q.expert_value,
            before={**(receipts.predict_field(before, self.pack, case_for_compile, f) or {}),
                    "committed": q.predicted_value},
            evaluation=q.type == "exam")
        try:
            compiled = await self.compiler(self.pack, self.wm, q.to_json(), transcript, case_for_compile)
            rc["provenance"] = self._provenance()  # the model that actually compiled this answer
        except Exception as e:  # noqa: BLE001
            log.exception("compile failed")
            await self.emit("compile_failed", {"inquiry_id": q.id, "error": str(e)[:300]})
            rc.update(status="compile_failed", error=str(e)[:300])
            await self._publish_receipt(rc)
            return
        if compiled.off_the_record:
            self.off_record = True
            await self.emit("record", {"off_record": True})
            return
        if not compiled.answers_question and q.type != "teachback":
            # "sorry, say that again" or unrelated speech must not consume the question
            q.status = "queued"
            if q.type == "exam" and getattr(q, "exam_index", None) is not None:
                self.exam.append(self.exam[q.exam_index])
            else:
                if q in self.planner.history:
                    self.planner.history.remove(q)
                q.phase = "debrief" if self.mode == "debrief" else q.phase
                self.planner.queue.insert(0, q)
            await self.emit("inquiry", {"inquiry": q.to_json(), "note": "not answered yet — kept open"})
            rc.update(status="kept_open", error="the compiler judged this did not answer the question")
            await self._publish_receipt(rc)
            return
        quote = Quote(text=compiled.key_quote, speaker=self.expert, ts=self.now(), lang=self.lang,
                      translation=compiled.translation_en, inquiry_id=q.id)
        moment = ScreenMoment(**{k: v for k, v in (q.screen_moment or {}).items() if k in ("ts", "frame_id")},
                              entity=q.case_id, field=q.field)
        changes: list[dict[str, Any]] = []

        # counterfactual / exam answers are synthetic episodes
        if q.type in ("counterfactual", "exam") and compiled.probe_answer and q.probe_case is not None:
            changes += await self._learn_probe(q, compiled.probe_answer, hs)

        if compiled.threshold:
            t = compiled.threshold
            post = self._ensure_posterior(t.param, t.value, t.quantity)
            if post is not None:
                changes.append({"kind": "threshold", "param": t.param, "value": t.value, "quantity": t.quantity})

        new_nodes = []
        for cr in compiled.rules:
            own = quote.model_copy(update={"text": cr.quote}) if cr.quote and cr.quote.strip() else quote
            node = self._node_from_compiled(cr, own, moment, q)
            if node is None:
                continue
            new_nodes.append(node)
            changes.append({"kind": "node_added", "id": node.id, "title": node.title})

        if q.type in ("confirm", "teachback") and compiled.confirms is not None:
            target = q.target_node or (hs.top().id if hs and hs.top() else None)
            if hs and hs.top() and q.type == "confirm" and compiled.confirms and not new_nodes:
                node = self._adopt_hypothesis(hs.top(), quote, moment)
                new_nodes.append(node)
                changes.append({"kind": "node_added", "id": node.id, "title": node.title, "from_hypothesis": True})
            elif target and self.wm.node(target):
                n = self.wm.node(target)
                n.evidence.append(Evidence(episode_id=q.id, kind="teachback", agrees=bool(compiled.confirms)))
                n.refresh_belief()
            elif hs and hs.top() and not compiled.confirms:
                hs.top().posterior = round(hs.top().posterior * 0.1, 4)  # rejected; keep the rest alive
                z = sum(h.posterior for h in hs.items) + hs.p_unknown
                for h in hs.items:
                    h.posterior = round(h.posterior / z, 4)
                hs.p_unknown = round(hs.p_unknown / z, 4)

        if hs and new_nodes and q.type in ("cue_probe", "confirm", "comparison"):
            await self._collapse(hs, new_nodes[0], compiled.selected_hypothesis_id)

        if q.type == "teachback":
            await self._handle_teachback_answer(compiled, changes)

        # retroactive validation over the whole episode log
        retro = self._retro_replay(new_nodes)
        for p in list(self.posteriors):
            self._replay_posterior(p)
        self.wm.version += 1
        rc["teaching"].update(quote=quote.text, translation=quote.translation, strength=compiled.strength,
                              threshold=compiled.threshold.model_dump() if compiled.threshold else None)
        rc["after"] = receipts.predict_field(self.wm, self.pack, case_for_compile, f)
        rc["diff"] = receipts.diff_maps(before, self.wm, bases_before, dict(self.param_quantity))
        rc["retro"] = retro
        if rc["after"] is not None and q.expert_value is not None:
            rc["after"]["explains_expert"] = rc["after"]["value"] == q.expert_value
        if receipts.is_empty(rc["diff"]):
            rc["status"] = "no_change"
        await self._publish_receipt(rc)
        info_gain = (h_before - hs.entropy()) if (hs and h_before is not None) else (0.8 if new_nodes else 0.1)
        if hasattr(q, "bandit_ctx") and q.type in self.planner.bandit.arms:
            secs = max(3.0, len(transcript.split()) / 2.5)
            self.planner.bandit.update(q.type, np.array(q.bandit_ctx), float(info_gain) / secs * 10)
        await self.emit("learned", {
            "inquiry_id": q.id, "quote": quote.model_dump(), "changes": changes, "retro": retro,
            "info_gain_bits": round(float(info_gain), 3), "map": self.wm.model_dump(),
            "posteriors": {k: p.summary() for k, p in self.posteriors.items()}, "metrics": self.metrics(),
            "understood": self.understood(), "receipt": {k: rc.get(k) for k in ("id", "before", "after", "status")},
        })
        if self.store:
            self.store.save_map(self.expert, self.pack.id, self.id, self.wm.version, self.wm.model_dump())
        if compiled.needs_followup and not new_nodes:
            fq = Inquiry(id=self.planner.new_id(), type="confirm", case_id=q.case_id, field=q.field,
                         text=compiled.needs_followup, evoi=0.5, impact=q.impact, phase="debrief",
                         gap_id=q.gap_id, expert_value=q.expert_value, predicted_value=q.predicted_value,
                         screen_moment=q.screen_moment, reason="answer was ambiguous")
            self.planner.enqueue(fq)
            await self.emit("inquiry", {"inquiry": fq.to_json()})

    async def _learn_probe(self, q: Inquiry, answer: str, hs: hypotheses.HypothesisSet | None) -> list[dict[str, Any]]:
        probe = q.probe_case
        assert probe is not None
        self.cases[probe["id"]] = probe
        f = q.field or "action"
        expert = {f: answer}
        pred = run_map(self.wm, self.pack, probe)
        predicted = {f: (pred.action.value if pred.action else None) if f == "action" else (
            pred.fields[f].value if f in pred.fields else None)}
        ep = Episode(id=f"cf{len(self.episodes) + 1}", case_id=probe["id"], ts=self.now(), expert=expert,
                     predicted=predicted, synthetic=True, weight=0.6, source_inquiry=q.id)
        self.episodes.append(ep)
        changes: list[dict[str, Any]] = [{"kind": "probe", "delta": q.probe_delta, "answer": answer,
                                          "map_predicted": predicted[f]}]
        if q.type == "exam":
            # evaluation pass: scored against the prediction frozen when the exam was built; never learned from
            ok = q.expert_value == answer
            ep.evaluation, ep.weight, ep.predicted = True, 0.0, {f: q.expert_value}
            self.exam_results.append(ok)
            if not ok:
                self.exam_failures.append((ep, probe, f, answer))
            changes[0]["map_predicted"] = q.expert_value
            changes.append({"kind": "exam", "correct": ok, "round": self.exam_round})
            return changes
        resolved_conflict = False
        if q.target_node and "|" in q.target_node:
            a, b = (self.wm.node(i) for i in q.target_node.split("|"))
            winner = next((r for r in (a, b) if isinstance(r, Rule) and r.then.get(f) == answer), None)
            if winner:
                loser = b if winner is a else a
                winner.priority = max(winner.priority, loser.priority + 1)
                resolved_conflict = True
                changes.append({"kind": "priority", "winner": winner.id, "over": loser.id})
                predicted[f] = answer
        if predicted[f] != answer and not resolved_conflict:
            # the map got an unseen case wrong: that's a new structural gap, keep asking until it's clear
            gap = {"id": f"{ep.id}.{f}", "field": f, "expert": answer, "predicted": predicted[f],
                   "case_id": probe["id"], "type": "structural", "why": "map failed on an unseen case"}
            ep.gaps.append(gap)
            self.spawn(self.analyze_gap(ep, probe, gap))
            changes.append({"kind": "new_gap", "field": f, "answer": answer, "map_predicted": predicted[f]})
        if hs:
            post = posterior_update(hs.as_bald(self.wm, self.pack), probe, answer, weight=0.6)
            for h in hs.items:
                h.posterior = round(post.get(h.id, h.posterior), 4)
            hs.p_unknown = round(post.get(hypotheses.UNKNOWN, hs.p_unknown), 4)
            await self.emit("hypotheses", {"set": hs.to_json()})
            top = hs.top()
            if top and top.posterior > 0.85 and not self.wm.node(top.id):
                self._adopt_hypothesis(top, None, None)
                changes.append({"kind": "node_added", "id": top.id, "title": top.title, "from_hypothesis": True})
        self._observe_thresholds(probe, expert, weight=0.6)
        doc_ids = {r.id for r in self.wm.rules if r.origin == "doc"}
        self._judge(probe, expert, ep.id, "counterfactual", skip=doc_ids)
        return changes

    async def _collapse(self, hs: hypotheses.HypothesisSet, node: Rule | Guardrail, selected: str | None) -> None:
        """The answer resolved the gap: the matching explanation takes the mass (or a new one is discovered)."""
        def truth(expr: str) -> list[bool]:
            return [dsl.holds(expr, {**self.pack.derive(c), "params": self.wm.params, "booking": {}}) for c in self.pool]

        target = truth(node.when)
        match = next((h for h in hs.items if h.id == selected), None)
        if match is None:
            scored = [(sum(a == b for a, b in zip(truth(h.when), target)) / max(len(target), 1), h) for h in hs.items]
            best = max(scored, key=lambda t: t[0], default=(0.0, None))
            match = best[1] if best[0] >= 0.95 else None
        if match is None:
            match = hypotheses.ScoredHypothesis(id=f"{hs.gap_id}.new", title=f"{node.title} (discovered)", when=node.when,
                                                field=hs.field, value=hs.expert_value, kind="rule", prior=0.5,
                                                attention_boost=1.0, consistent=0, inconsistent=0, node=node)
            hs.items.append(match)
        rest = [h for h in hs.items if h is not match]
        for h in rest:
            h.posterior = round(0.04 / max(len(rest), 1), 4)
        match.posterior = 0.95
        hs.p_unknown = 0.01
        await self.emit("hypotheses", {"set": hs.to_json(), "resolved": match.id})

    def _adopt_hypothesis(self, h: hypotheses.ScoredHypothesis, quote: Quote | None,
                          moment: ScreenMoment | None) -> Rule | Guardrail:
        node = h.node.model_copy(deep=True)
        node.id = self.wm.next_id("G" if isinstance(node, Guardrail) else "R")
        node.origin = "expert" if quote else "inferred"
        node.quote = quote
        node.screen_moment = moment
        node.evidence.append(Evidence(episode_id=h.id.split(".")[0], kind="origin", agrees=True))
        node.refresh_belief()
        self._attach(node)
        return node

    def _node_from_compiled(self, cr: compiler_mod.CompiledRule, quote: Quote, moment: ScreenMoment,
                            q: Inquiry) -> Rule | Guardrail | None:
        step = self.wm.step_for_field(cr.field)
        if cr.kind == "guardrail" or (cr.field == "action" and cr.value in ("hold", "escalate", "second_approval",
                                                                         "reject", "block")):
            gtype = cr.guardrail_type or {"hold": "hold", "escalate": "stop_and_ask",
                                          "second_approval": "second_approval"}.get(cr.value, "hard_limit")
            node: Rule | Guardrail = Guardrail(id=self.wm.next_id("G"), step_id=step.id if step else None,
                                               title=cr.title, when=cr.when, type=gtype, action=cr.value,
                                               ask=cr.ask, quote=quote, screen_moment=moment)
        else:
            node = Rule(id=self.wm.next_id("R"), step_id=step.id if step else None, title=cr.title, when=cr.when,
                        then={cr.field: cr.value}, kind="exception" if cr.kind == "exception" else "rule",
                        parent=cr.parent_id, quote=quote, screen_moment=moment)
        # the live case this answer was about counts as behavioral evidence if the rule explains it
        case = self.cases.get(q.case_id or "")
        if case and q.type not in ("counterfactual", "exam"):
            ep = next((e for e in reversed(self.episodes) if e.case_id == case["id"] and not e.synthetic), None)
            if ep:
                ctx = {**self.pack.derive(case), "params": self.wm.params, "booking": ep.expert}
                if dsl.holds(node.when, ctx):
                    if isinstance(node, Guardrail):
                        agrees = ep.expert.get("action") == node.action or node.action == "block"
                    else:
                        agrees = ep.expert.get(cr.field) == node.then.get(cr.field)
                    node.evidence.append(Evidence(episode_id=ep.id, kind="origin", agrees=agrees))
        node.refresh_belief()
        self._attach(node)
        return node

    def _attach(self, node: Rule | Guardrail) -> None:
        if isinstance(node, Guardrail):
            self.wm.guardrails.append(node)
        else:
            self.wm.rules.append(node)
        step = next((s for s in self.wm.steps if s.id == node.step_id), None)
        if step:
            (step.guardrail_ids if isinstance(node, Guardrail) else step.rule_ids).append(node.id)
            if node.screen_moment and not step.screen_moment:
                step.screen_moment = node.screen_moment

    def _retro_replay(self, nodes: list[Rule | Guardrail]) -> list[dict[str, Any]]:
        """Replay new rules over past episodes: 'this also explains cases 3 and 6'."""
        out = []
        for node in nodes:
            for ep in self.episodes:
                if ep.synthetic or ep.case_id not in self.cases:
                    continue
                if any(e.episode_id == ep.id for e in node.evidence):
                    continue
                case = self.cases[ep.case_id]
                ctx = {**self.pack.derive(case), "params": self.wm.params, "booking": ep.expert}
                if not dsl.holds(node.when, ctx):
                    continue
                if isinstance(node, Rule):
                    (f, v), = list(node.then.items())[:1]
                    agrees = ep.expert.get(f) == v
                else:
                    f, agrees = "action", ep.expert.get("action") == node.action or node.action == "block"
                node.evidence.append(Evidence(episode_id=ep.id, kind="retro", agrees=agrees))
                was_wrong = ep.predicted.get(f) != ep.expert.get(f)
                out.append({"node": node.id, "episode": ep.id, "case_id": ep.case_id, "field": f, "agrees": agrees,
                            "now_explains": agrees and was_wrong})
            node.refresh_belief()
        return out

    def _replay_posterior(self, param: str) -> None:
        """Rebuild a threshold posterior from the full log (event sourcing: no stale state)."""
        old = self.posteriors[param]
        fresh = ThresholdPosterior.make(param, float(old.grid[0]), float(old.grid[-1]),
                                        float(old.grid[1] - old.grid[0]), old.bases, old.prior_mean, old.prior_sd,
                                        old.scale)
        stated_q = self.param_quantity.get(param)
        spec = next(sp for sp in self.pack.threshold_params().values() if set(old.bases) == set(sp["bases"]))
        stated_basis = next((b for b, q in spec["bases"].items() if q == stated_q), old.bases[0])
        fresh.log_post[old.bases.index(stated_basis)] += np.log(2.0)
        self.posteriors[param] = fresh
        for ep in self.episodes:
            if ep.case_id in self.cases:
                self._observe_thresholds_single(param, self.cases[ep.case_id], ep.expert, ep.weight)
        self._apply_posterior(param)

    # ------------------------------------------------------------ debrief
    async def start_debrief(self) -> dict[str, Any]:
        self.mode = "debrief"
        self.awaiting = None
        for q in self.planner.queue:
            q.phase = "debrief"
        await self._add_unverified_confirms()
        self._add_conflict_probes()
        self._add_coverage_probes()
        self._add_exploration_probes()
        self._build_exam()
        await self.emit("mode", {"mode": "debrief", "agenda": [q.to_json() for q in self.planner.debrief_agenda()],
                                 "understood": self.understood()})
        return self.snapshot()

    async def _add_unverified_confirms(self) -> None:
        for node in [*self.wm.rules, *self.wm.guardrails]:
            if node.origin == "doc" or node.belief.status == "confirmed":
                continue
            if any(q.target_node == node.id for q in [*self.planner.queue, *self.planner.history]):
                continue
            # BALD-chosen unseen case that tests this rule
            base = self.cases.get(node.screen_moment.entity) if node.screen_moment and node.screen_moment.entity else None
            base = base or self.cases[self.case_order[0]]
            variants = self.pack.perturb(base, random.Random(zlib.crc32(node.id.encode())))
            field_ = next(iter(node.then)) if isinstance(node, Rule) else "action"
            ctx_ok = [v for v in variants if dsl.holds(node.when, {**self.pack.derive(v), "params": self.wm.params,
                                                                    "booking": {}})]
            probe = ctx_ok[0] if ctx_ok else None
            expected = node.then.get(field_) if isinstance(node, Rule) else node.action
            q = Inquiry(id=self.planner.new_id(), type="counterfactual" if probe else "confirm",
                        case_id=base["id"], field=field_, text="", evoi=0.5, impact=0.8, phase="debrief",
                        expert_value=expected, target_node=node.id, probe_case=probe,
                        probe_delta=self.pack.describe_delta(base, probe) if probe else None,
                        hypotheses=[{"id": node.id, "title": node.title, "p": node.belief.p}],
                        reason=f"verify {node.id} ({node.belief.status}) on an unseen case")
            q.text = questions.template(self.pack, q.type, case=base, field=field_, expert_value=expected,
                                        hypotheses=q.hypotheses, probe_delta=q.probe_delta, node_title=node.title)
            self.planner.enqueue(q)

    def _probe_space(self) -> list[dict[str, Any]]:
        out = []
        for cid in self.case_order:
            out += self.pack.perturb(self.cases[cid], random.Random(zlib.crc32(cid.encode())))
        return out

    def _add_conflict_probes(self) -> None:
        """Two learned rules that set the same field differently on some case: which wins?"""
        learned = [r for r in self.wm.rules if r.origin != "doc" and r.belief.status != "contested"]
        space = self._probe_space()
        for i, a in enumerate(learned):
            for b in learned[i + 1:]:
                fa, fb = next(iter(a.then)), next(iter(b.then))
                if fa != fb or a.then[fa] == b.then[fb]:
                    continue
                probe = next((v for v in space if all(dsl.holds(r.when, {**self.pack.derive(v), "params": self.wm.params})
                                                      for r in (a, b))), None)
                if probe is None:
                    continue
                base = self.cases.get(probe["_probe"]["base"])
                va, vb = a.then[fa], b.then[fb]
                q = Inquiry(id=self.planner.new_id(), type="counterfactual", case_id=base["id"] if base else None,
                            field=fa, evoi=0.9, impact=0.8, phase="debrief", probe_case=probe,
                            probe_delta=self.pack.describe_delta(base or probe, probe), target_node=f"{a.id}|{b.id}",
                            hypotheses=[{"id": a.id, "title": a.title, "p": 0.5}, {"id": b.id, "title": b.title, "p": 0.5}],
                            reason=f"conflict: {a.id} says {va}, {b.id} says {vb}", text="")
                q.text = (f"Two of your rules collide on one case: same invoice, but {q.probe_delta.rstrip('. ')}. "
                          f"'{a.title}' says {va}, '{b.title}' says {vb}. Which one wins?")
                self.planner.enqueue(q)

    def _add_coverage_probes(self) -> None:
        """Cases next to a learned rule that it doesn't cover: does the expert's judgment extend there?"""
        space = self._probe_space()
        for r in [r for r in self.wm.rules if r.origin != "doc" and r.belief.status != "contested"]:
            f, v = next(iter(r.then.items()))
            near = []
            for c in space:
                ctx = {**self.pack.derive(c), "params": self.wm.params}
                if dsl.holds(r.when, ctx):
                    continue
                pred = run_map(self.wm, self.pack, c)
                got = pred.fields[f].value if f in pred.fields else None
                if got == v:
                    continue
                # same neighbourhood: a single change away from a case the rule covers
                base = self.cases.get(c["_probe"]["base"])
                if base and dsl.holds(r.when, {**self.pack.derive(base), "params": self.wm.params}):
                    near.append(("items are" not in c["_probe"]["delta"], c, base))
            if not near:
                continue
            # most informative first: where the fallback rule has already been contradicted by the expert
            def doubt(item: tuple[bool, dict[str, Any], dict[str, Any]]) -> tuple[float, bool]:
                pred = run_map(self.wm, self.pack, item[1])
                src = self.wm.node(pred.fields[f].source) if f in pred.fields else None
                return (src.belief.p if src else 0.5, item[0])
            near.sort(key=doubt)
            _, probe, base = near[0]
            q = Inquiry(id=self.planner.new_id(), type="counterfactual", case_id=base["id"], field=f, evoi=0.6,
                        impact=0.7, phase="debrief", probe_case=probe,
                        probe_delta=self.pack.describe_delta(base, probe), expert_value=v, target_node=r.id,
                        hypotheses=[{"id": r.id, "title": r.title, "p": r.belief.p}],
                        reason=f"coverage: does {r.id} extend to a case it doesn't cover?", text="")
            q.text = questions.template(self.pack, "counterfactual", case=base, field=f, expert_value=v,
                                        probe_delta=q.probe_delta)
            self.planner.enqueue(q)

    def _add_exploration_probes(self, budget: int = 3) -> None:
        """Unknown unknowns: facts on the case that no learned rule mentions yet.

        Divergence-driven questions only cover what the expert happened to do. A hidden guardrail
        (e.g. a new supplier whose bank details just changed) never shows up if no such case came by,
        and guardrails are often conjunctions. So Shadow changes one or two unreferenced facts on a
        case it saw and asks whether its decision would still hold. Pairs come first: a "no" there
        still gets narrowed down by the follow-up question.
        """
        referenced: set[str] = set()
        for n in [*self.wm.rules, *self.wm.guardrails]:
            if n.origin != "doc":
                try:
                    referenced |= {r.split(".", 1)[1] for r in dsl.fields_referenced(n.when) if r.startswith("inv.")}
                except dsl.DSLError:
                    continue
        noise = {"id", "supplier_id", "supplier_name", "day", "month", "dup_days", "days_to_skonto", "n_lines",
                 "categories", "net", "gross", "net_eur", "gross_eur", "vat_rate", "supplier_country", "domestic"}

        def novel_change(base: dict[str, Any], v: dict[str, Any]) -> tuple[set[str], set[str]]:
            b, x = self.pack.derive(base)["inv"], self.pack.derive(v)["inv"]
            changed = {k for k in x if x[k] != b.get(k)} - noise
            return changed, changed - referenced

        singles: list[tuple[dict[str, Any], dict[str, Any], set[str]]] = []
        for v in self._probe_space():
            base = self.cases.get(v["_probe"]["base"] or "")
            if base is None:
                continue
            changed, novel = novel_change(base, v)
            if novel and len(changed) <= 2:
                singles.append((base, v, novel))
        pairs, seen = [], set()
        rng = random.Random(77)
        for base, v1, n1 in singles:
            for v2 in self.pack.perturb(v1, rng):
                changed, novel = novel_change(base, v2)
                key = ",".join(sorted(novel))
                if len(novel) >= 2 and len(changed) <= 3 and key not in seen and not novel <= n1:
                    seen.add(key)
                    v2["_probe"] = {"base": base["id"], "delta": f"{v1['_probe']['delta']}, and {v2['_probe']['delta']}"}
                    pairs.append((base, v2, novel))
        priors = getattr(self.pack, "exploration_priors", [])

        def prior_score(novel: set[str]) -> int:
            # 2: covers a known guardrail family exactly; 1: touches one; 0: blind exploration
            if any(p <= novel and novel <= p | {"eu_foreign", "intercompany"} for p in priors):
                return 2
            return 1 if any(p & novel for p in priors) else 0

        candidates = sorted(pairs + singles, key=lambda t: -prior_score(t[2]))
        picked, covered = 0, set()
        for base, v, novel in candidates:
            if picked >= budget:
                break
            if novel & covered:
                continue  # spread probes across different facts so one rule can't mask the rest
            covered |= novel
            pred = run_map(self.wm, self.pack, v)
            expected = pred.action.value if pred.action else None
            q = Inquiry(id=self.planner.new_id(), type="counterfactual", case_id=base["id"], field="action",
                        evoi=0.55, impact=0.6, guardrail_gap=0.5, phase="debrief", probe_case=v,
                        probe_delta=self.pack.describe_delta(base, v), expert_value=expected, text="",
                        reason=f"exploration: no rule mentions {', '.join(sorted(novel))} yet")
            q.text = questions.template(self.pack, "counterfactual", case=base, field="action",
                                        expert_value=expected, probe_delta=q.probe_delta)
            self.planner.enqueue(q)
            picked += 1

    def _build_exam(self, k: int = 5) -> None:
        """Unseen cases spanning the rule boundaries. Predictions are frozen now, before any answer."""
        candidates = []
        for cid in self.case_order:
            candidates += self.pack.perturb(self.cases[cid], random.Random(len(cid) + 31 * self.exam_round))
        asked_probes = {q.probe_case["id"] for q in self.planner.history if q.probe_case is not None}
        candidates = [c for c in candidates if c["id"] not in self.exam_used and c["id"] not in asked_probes]
        chosen, used_nodes = [], set()
        for v in candidates:
            pred = run_map(self.wm, self.pack, v, TRUSTED + ("inferred",))
            fired = [n for n in pred.fired_rules + pred.triggered_guardrails if self.wm.node(n) and
                     self.wm.node(n).origin != "doc"]
            new = [n for n in fired if n not in used_nodes]
            if new or (not fired and len(chosen) < 1):
                field_ = "action"
                node = self.wm.node(new[0]) if new else None
                if isinstance(node, Rule):
                    field_ = next(iter(node.then))
                expected = (pred.action.value if pred.action else None) if field_ == "action" else (
                    pred.fields[field_].value if field_ in pred.fields else None)
                chosen.append({"case": v, "field": field_, "expected": expected, "node": new[0] if new else None})
                used_nodes.update(new)
            if len(chosen) >= k:
                break
        # top up with fresh generated cases the expert has never seen
        for c in self.pack.generate_cases(40, seed=1000 + self.exam_round):
            if len(chosen) >= k:
                break
            if c["id"] in self.exam_used:
                continue
            pred = run_map(self.wm, self.pack, c)
            learned_field = next((f for f, fp in pred.fields.items() if (n := self.wm.node(fp.source)) and n.origin != "doc"), None)
            field_ = learned_field or "action"
            expected = (pred.action.value if pred.action else None) if field_ == "action" else pred.fields[field_].value
            c = {**c, "_probe": {"base": None, "delta": self.pack.describe(c)}}
            chosen.append({"case": c, "field": field_, "expected": expected, "node": None})
        self.exam = chosen
        self.exam_results = []
        self.exam_failures = []
        self.exam_cursor = 0
        self.exam_fp = self._map_fp()
        self.exam_round += 1
        self.exam_used.update(item["case"]["id"] for item in chosen)

    async def debrief_next(self) -> str:
        """The next thing the interviewer should say in the debrief."""
        agenda = [q for q in self.planner.debrief_agenda() if q.status == "queued"]
        asked_debrief = sum(1 for q in self.planner.history if q.phase == "debrief" and q.status in ("asked", "answered"))
        if agenda and (asked_debrief < 3 or agenda[0].value > 0):
            q = self.planner.mark_asked(agenda[0])
            if not q.text:
                q.text = questions.template(self.pack, q.type, case=self.cases.get(q.case_id or ""), field=q.field,
                                            expert_value=q.expert_value, predicted_value=q.predicted_value,
                                            hypotheses=q.hypotheses, probe_delta=q.probe_delta)
            self.awaiting = q
            await self.emit("ask", {"inquiry": q.to_json()})
            return q.text
        if self.exam_cursor == 0 and self.exam_fp != self._map_fp():
            self._build_exam()  # the map changed since the exam was drawn: freeze a fresh one
        done_exam = self.exam_cursor
        if done_exam < len(self.exam):
            self.exam_cursor += 1
            item = self.exam[done_exam]
            base = self.cases.get(item["case"]["_probe"]["base"] or "") if "_probe" in item["case"] else None
            q = Inquiry(id=self.planner.new_id(), type="exam", case_id=base["id"] if base else None,
                        field=item["field"], text="", evoi=0.3, phase="debrief", probe_case=item["case"],
                        probe_delta=self.pack.describe_delta(base or item["case"], item["case"]),
                        expert_value=item["expected"], target_node=item["node"],
                        reason=f"self-exam {done_exam + 1}/{len(self.exam)}")
            q.exam_index = done_exam  # type: ignore[attr-defined]
            if base is None:  # a fresh generated case, not a variant of something the expert saw
                q.text = ("Now let me test myself on a case you haven't seen. " if done_exam == 0 else "") + \
                    f"Say you get {q.probe_delta}. What would you do?"
            else:
                q.text = ("Now let me test myself. " if done_exam == 0 else "") + questions.template(
                    self.pack, "exam", case=base, field=item["field"], probe_delta=q.probe_delta)
            self.planner.mark_asked(q)
            self.awaiting = q
            await self.emit("ask", {"inquiry": q.to_json(), "exam": {"index": done_exam, "of": len(self.exam),
                                                                    "expected": item["expected"]}})
            return q.text
        if self.exam and self.exam_cursor >= len(self.exam):
            await self.drain()  # every exam answer scored before judging the exam
            fresh_exam_needed = self.exam_failures or self.exam_fp != self._map_fp()
            if fresh_exam_needed and self.exam_retries < 2:
                self.exam_retries += 1
                for ep, probe, f, answer in self.exam_failures:  # a failed exam item becomes a lesson
                    lesson = Episode(id=f"lesson{len(self.episodes) + 1}", case_id=probe["id"], ts=self.now(),
                                     expert={f: answer}, predicted=dict(ep.predicted), synthetic=True, weight=0.6)
                    self.episodes.append(lesson)
                    self._observe_thresholds(probe, lesson.expert, weight=0.6)
                    gap = {"id": f"{lesson.id}.{f}", "field": f, "expert": answer, "predicted": ep.predicted.get(f),
                           "case_id": probe["id"], "type": "structural", "why": "failed its own exam"}
                    lesson.gaps.append(gap)
                    self.spawn(self.analyze_gap(lesson, probe, gap))
                await self.drain()
                self._build_exam()
                return await self.debrief_next()
        if self.teachback_pending:
            await self.drain()  # the teach-back verdict decides what comes next
            if self.teachback_pending:
                return "Take your time. Is that how it works?"
        if not self.teachback_confirmed:
            self.teachback_pending = True
            text = await self.build_teachback()
            q = Inquiry(id=self.planner.new_id(), type="teachback", case_id=None, field=None, text=text, evoi=0.0,
                        phase="debrief", reason="teach-back")
            self.planner.mark_asked(q)
            self.awaiting = q
            await self.emit("ask", {"inquiry": q.to_json(), "teachback": True})
            return text
        u = self.understood()
        if u["done"]:
            return "Thank you. I have everything I need, and the Work Map is ready."
        missing = [k.replace("_", " ") for k, v in u.items() if isinstance(v, dict) and not v["passed"]]
        return f"Thank you. I'm not done yet: {', '.join(missing)} still open. Let's pick those up next time."

    async def build_teachback(self) -> str:
        """Walk the executable map, step by step. The LLM only smooths the wording."""
        parts = []
        for s in sorted(self.wm.steps, key=lambda s: s.order):
            nodes = [self.wm.node(i) for i in s.rule_ids + s.guardrail_ids]
            learned = [n for n in nodes if n and n.origin != "doc" and n.belief.status != "contested"]
            if not learned and not s.decision_field:
                parts.append(f"Step {s.order}: {s.name}.")
                continue
            if not learned:
                doc = [n for n in nodes if n]
                parts.append(f"Step {s.order}: {s.name} — as the work instruction says"
                             + (f": {doc[0].title.replace('Doc: ', '')}." if doc else "."))
                continue
            bullets = "; ".join(self._node_sentence(n) for n in learned)
            parts.append(f"Step {s.order}: {s.name}. {bullets}.")
        raw = " ".join(parts)
        self.teachback_text = raw
        if self.use_llm:
            try:
                raw = await llm.text(
                    "You are an apprentice explaining a process back to the expert who taught you, to check you "
                    "understood. Speak in first person ('So, first I...'). Keep EVERY rule, number, code and "
                    "exception exactly; do not add anything. Under 140 words. End by asking: 'Is that how it works?'",
                    raw, max_tokens=400)
            except Exception:  # noqa: BLE001
                pass
        return raw if raw.rstrip().endswith("?") else raw + " Is that how it works?"

    def _node_sentence(self, n: Rule | Guardrail) -> str:
        title = n.title
        for p, v in self.wm.params.items():
            title = title.replace(f"params.{p}", f"{v:,.0f}")
        if isinstance(n, Guardrail):
            return f"guardrail: {title}" + (f" (ask {n.ask})" if n.ask else "")
        return title

    async def _handle_teachback_answer(self, compiled: compiler_mod.Compiled, changes: list[dict[str, Any]]) -> None:
        self.teachback_pending = False
        if compiled.confirms and not compiled.correction:
            self.teachback_confirmed = True
            for n in [*self.wm.rules, *self.wm.guardrails]:
                if n.origin != "doc" and n.belief.status != "contested":
                    n.evidence.append(Evidence(episode_id="teachback", kind="teachback", agrees=True))
                    n.refresh_belief()
            changes.append({"kind": "teachback_confirmed"})
            await self.emit("teachback", {"confirmed": True, "text": self.teachback_text})
        else:
            changes.append({"kind": "teachback_correction", "correction": compiled.correction})
            if compiled.threshold and compiled.threshold.param in self.wm.params:
                t = compiled.threshold
                old_q = self.param_quantity.get(t.param)
                if old_q and t.quantity != old_q:
                    for r in self.wm.rules:
                        if f"params.{t.param}" in r.when:
                            r.when = r.when.replace(old_q, t.quantity)
                    self.param_quantity[t.param] = t.quantity
                self.wm.params[t.param] = t.value
                changes.append({"kind": "threshold_patched", "param": t.param, "value": t.value,
                                "quantity": t.quantity})
            await self.emit("teachback", {"confirmed": False, "correction": compiled.correction})

    def understood(self) -> dict[str, Any]:
        """Apprentice Test 3: when has Shadow understood?"""
        decision_steps = [s for s in self.wm.steps if s.decision_field]
        covered = []
        for s in decision_steps:
            ids = s.rule_ids + s.guardrail_ids
            learned = [self.wm.node(i) for i in ids if self.wm.node(i) and self.wm.node(i).origin != "doc"]
            covered.append(bool(learned) or s.discretion or self._doc_rule_validated(s))
        exam_n = len(self.exam_results)
        exam_ok = sum(self.exam_results)
        exam_valid = bool(self.exam) and exam_n >= len(self.exam) >= 5 and self.exam_fp == self._map_fp()
        agenda_value = max((q.value for q in self.planner.debrief_agenda()), default=0.0)
        checks = {
            "exam": {"passed": exam_valid and exam_ok >= 0.8 * exam_n, "round": self.exam_round,
                     "score": f"{exam_ok}/{exam_n}" if exam_n else "not run",
                     "stale": bool(exam_n) and self.exam_fp != self._map_fp()},
            "steps_covered": {"passed": all(covered), "covered": sum(covered), "of": len(decision_steps)},
            "guardrails": {"passed": any(g.origin != "doc" for g in self.wm.guardrails),
                           "count": sum(1 for g in self.wm.guardrails if g.origin != "doc")},
            "agenda_exhausted": {"passed": agenda_value <= 0, "best_remaining_value": round(agenda_value, 3)},
            "teachback_confirmed": {"passed": self.teachback_confirmed},
        }
        checks["done"] = all(c["passed"] for c in checks.values() if isinstance(c, dict))
        return checks

    def _doc_rule_validated(self, step) -> bool:
        """A doc rule the expert keeps following (never contradicted) counts as covered."""
        f = step.decision_field
        eps = [e for e in self.episodes if not e.synthetic and e.expert.get(f) is not None]
        return bool(eps) and all(e.predicted.get(f) == e.expert.get(f) for e in eps)

    # ------------------------------------------------------------ tutor
    async def tutor_open(self, case_id: str) -> None:
        pred = run_map(self.wm, self.pack, self.cases[case_id], TRUSTED)
        self.dps[case_id].prediction = pred
        self.dps[case_id].map_version = self.wm.version
        await self.emit("tutor_case", {"case_id": case_id, "expected": pred.model_dump(),
                                       "prompt": "What do you think happens to this one?"})

    async def before_save(self, case_id: str, booking: dict[str, Any], action: str) -> dict[str, Any]:
        """Save intercept. In tutor mode, catch guardrail breaks before they're saved."""
        if self.mode != "tutor" or case_id not in self.cases:
            return {"allow": True}
        case = self.cases[case_id]
        violations = check_proposal(self.wm, self.pack, case, booking, action)
        pred = run_map(self.wm, self.pack, case, TRUSTED)
        relevant = pred.fired_rules + pred.triggered_guardrails
        # only the first attempt on a case is independent evidence; a fix after Shadow stepped in is assisted
        first_attempt = case_id not in self.tutor_attempted
        self.tutor_attempted.add(case_id)
        if not violations:
            for nid in relevant:
                if first_attempt:
                    self._bkt(nid, correct=True)
                else:
                    self._note_assisted(nid)
            await self.emit("tutor_ok", {"case_id": case_id, "action": action, "mastery": self.mastery,
                                         "independent": first_attempt})
            return {"allow": True}
        v = violations[0]
        if first_attempt:
            for viol in violations:
                self._bkt(viol.node_id, correct=False)
        iid = uuid.uuid4().hex[:8]
        node = self.wm.node(v.node_id)
        parts = []
        for viol in violations[:2]:
            q = (viol.quote.translation or viol.quote.text) if viol.quote else None
            parts.append((f"{self.expert} said: “{q}” " if q else "") + f"So: {viol.title}.")
        intervention = {
            "id": iid, "case_id": case_id, "violation": v.model_dump(), "field": v.field,
            "all": [x.model_dump() for x in violations],
            "say": f"{self.expert} would stop here. Why do you think?",
            "explain": " And ".join(parts),
            "screen_moment": v.screen_moment.model_dump() if v.screen_moment else None,
            "node": node.model_dump() if node else None,
        }
        self.pending_interventions[iid] = intervention
        await self.emit("intervene", {"intervention": intervention, "mastery": self.mastery})
        return {"allow": False, "intervention": intervention}

    async def tutor_decision(self, case_id: str, booking: dict[str, Any], action: str) -> dict[str, Any]:
        verdict = await self.before_save(case_id, booking, action)
        if verdict["allow"]:
            await self.emit("tutor_saved", {"case_id": case_id, "action": action})
        return verdict

    def _bkt(self, node_id: str, correct: bool, p_t: float = 0.3, p_s: float = 0.1, p_g: float = 0.2) -> None:
        """Bayesian Knowledge Tracing per rule (Corbett & Anderson 1994)."""
        node = self.wm.node(node_id)
        m = self.mastery.setdefault(node_id, {"p": 0.2, "opportunities": 0, "title": node.title if node else node_id})
        p = m["p"]
        if correct:
            cond = p * (1 - p_s) / (p * (1 - p_s) + (1 - p) * p_g)
        else:
            cond = p * p_s / (p * p_s + (1 - p) * (1 - p_g))
        m["p"] = round(cond + (1 - cond) * p_t, 3)
        m["opportunities"] += 1
        m["status"] = "mastered" if m["p"] >= 0.85 else ("shaky" if m["p"] >= 0.5 else "practice")

    def _note_assisted(self, node_id: str) -> None:
        node = self.wm.node(node_id)
        m = self.mastery.setdefault(node_id, {"p": 0.2, "opportunities": 0, "status": "practice",
                                              "title": node.title if node else node_id})
        m["assisted"] = m.get("assisted", 0) + 1

    def tutor_report(self) -> dict[str, Any]:
        trusted = [n for n in [*self.wm.rules, *self.wm.guardrails] if n.origin != "doc" and n.belief.status in TRUSTED]
        report = []
        for n in trusted:
            m = self.mastery.get(n.id)
            report.append({"id": n.id, "title": n.title, "status": m["status"] if m else "not seen yet",
                           "p": m["p"] if m else None})
        weakest = min((r for r in report if r["p"] is not None), key=lambda r: r["p"], default=None)
        return {"rules": report, "practice_next": weakest}
