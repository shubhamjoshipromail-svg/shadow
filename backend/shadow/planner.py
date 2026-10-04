"""Inquiry Planner: whether, when and how to ask.

  value(q) = EVOI(q) · impact + γ · guardrail_gap − λ · cost(type) · fatigue

Ask only if value > 0, the expert is at a natural pause, and the live budget
allows it (the brief: 3–5 live questions per 10 minutes; the rest waits for
the debrief). A bandit picks among question types that clear the bar.
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np

from shadow import config

QType = Literal["cue_probe", "confirm", "comparison", "counterfactual", "boundary", "guardrail", "exam", "teachback",
                "deviation"]

BASE_COST: dict[str, float] = {
    "deviation": 0.15,
    "confirm": 0.12, "counterfactual": 0.2, "comparison": 0.25, "boundary": 0.2, "guardrail": 0.22,
    "cue_probe": 0.3, "exam": 0.08, "teachback": 0.0,
}
GAMMA_GUARDRAIL = 0.35


@dataclass
class Inquiry:
    id: str
    type: QType
    case_id: str | None
    field: str | None
    text: str
    evoi: float
    impact: float = 1.0
    guardrail_gap: float = 0.0
    cost: float = 0.0
    value: float = 0.0
    phase: Literal["live", "debrief", "tutor"] = "live"
    status: Literal["queued", "asked", "answered", "deferred", "dropped", "silent"] = "queued"
    created_at: float = field(default_factory=time.time)
    asked_at: float | None = None
    gap_id: str | None = None
    expert_value: Any = None
    predicted_value: Any = None
    hypotheses: list[dict[str, Any]] = field(default_factory=list)
    probe_case: dict[str, Any] | None = None
    probe_delta: str | None = None
    target_node: str | None = None
    screen_moment: dict[str, Any] | None = None
    reason: str = ""

    def to_json(self) -> dict[str, Any]:
        d = {k: v for k, v in self.__dict__.items() if k != "probe_case"}
        d["has_probe"] = self.probe_case is not None
        return d


class TypeBandit:
    """Linear Thompson Sampling over question types.

    Context: [1, hypothesis entropy, p_unknown, top posterior, fatigue].
    Reward: realized information gain per expert-second.
    """

    def __init__(self, arms: list[str], dim: int = 5, prior_var: float = 1.0, seed: int = 0):
        self.arms = arms
        self.A = {a: np.eye(dim) / prior_var for a in arms}
        self.b = {a: np.zeros(dim) for a in arms}
        self.rng = np.random.default_rng(seed)
        # sensible priors: counterfactuals when hypotheses exist, cue probes when nothing explains it
        self.b["counterfactual"] += np.array([0.1, 0.3, -0.3, 0.0, 0.0])
        self.b["cue_probe"] += np.array([0.1, 0.0, 0.6, -0.2, 0.0])
        self.b["confirm"] += np.array([0.1, -0.1, -0.2, 0.5, 0.0])

    def sample_scores(self, x: np.ndarray, allowed: list[str]) -> dict[str, float]:
        out = {}
        for a in allowed:
            if a not in self.A:
                continue
            cov = np.linalg.inv(self.A[a])
            theta = self.rng.multivariate_normal(cov @ self.b[a], 0.05 * cov)
            out[a] = float(theta @ x)
        return out

    def state(self) -> dict:
        return {"A": {a: m.tolist() for a, m in self.A.items()}, "b": {a: v.tolist() for a, v in self.b.items()}}

    def load(self, state: dict) -> None:
        """Resume what earlier sessions learned about which question types pay off."""
        for a in self.arms:
            if a in state.get("A", {}):
                self.A[a] = np.array(state["A"][a])
                self.b[a] = np.array(state["b"][a])

    def update(self, arm: str, x: np.ndarray, reward: float) -> None:
        if arm in self.A:
            self.A[arm] += np.outer(x, x)
            self.b[arm] += reward * x


class Planner:
    def __init__(self, lam: float | None = None):
        self.lam = config.INTERRUPTION_LAMBDA if lam is None else lam
        self.queue: list[Inquiry] = []
        self.history: list[Inquiry] = []
        self.asked_times: list[float] = []
        self.bandit = TypeBandit(["cue_probe", "confirm", "comparison", "counterfactual"])
        self._ids = 0

    def new_id(self) -> str:
        self._ids += 1
        return f"q{self._ids}"

    # ------------------------------------------------------------ costs
    def fatigue(self, now: float | None = None) -> float:
        now = now or time.time()
        recent = [t for t in self.asked_times if now - t < 600]
        last = max(self.asked_times, default=None)
        spike = 2.0 * math.exp(-(now - last) / 45.0) if last else 0.0
        return 1.0 + 0.35 * len(recent) + spike

    def live_budget_left(self, now: float | None = None) -> int:
        now = now or time.time()
        recent = [t for t in self.asked_times if now - t < 600]
        return config.LIVE_QUESTION_BUDGET_PER_10MIN - len(recent)

    def price(self, q: Inquiry, now: float | None = None) -> Inquiry:
        q.cost = round(BASE_COST.get(q.type, 0.25) * self.fatigue(now), 3)
        q.value = round(q.evoi * q.impact + GAMMA_GUARDRAIL * q.guardrail_gap - self.lam * q.cost, 3)
        return q

    def bandit_context(self, entropy: float, p_unknown: float, top: float, now: float | None = None) -> np.ndarray:
        return np.array([1.0, entropy, p_unknown, top, self.fatigue(now) - 1.0])

    def choose_type(self, candidates: list[Inquiry], ctx: np.ndarray) -> Inquiry | None:
        """EVOI decides *whether*; the bandit picks *how* among candidates that clear the bar."""
        viable = [c for c in candidates if c.value > 0]
        if not viable:
            return None
        scores = self.bandit.sample_scores(ctx, [c.type for c in viable])
        return max(viable, key=lambda c: c.value + 0.15 * scores.get(c.type, 0.0))

    # ------------------------------------------------------------ queue
    def enqueue(self, q: Inquiry) -> Inquiry:
        self.price(q)
        if q.value <= 0:
            q.status = "silent"
            q.reason = q.reason or f"value {q.value:.2f} ≤ 0 (EVOI {q.evoi:.2f}·impact {q.impact:.2f} vs cost {q.cost:.2f})"
            self.history.append(q)
        else:
            self.queue.append(q)
        return q

    def decay(self, current_case_id: str | None, now: float | None = None) -> list[Inquiry]:
        """When the expert moves on, live questions about old cases lose value and move to the debrief."""
        moved = []
        for q in list(self.queue):
            if q.phase == "live" and q.case_id and q.case_id != current_case_id:
                q.phase = "debrief"
                q.evoi = round(q.evoi * 0.8, 3)
                moved.append(q)
        return moved

    def release(self, paused: bool, current_case_id: str | None, now: float | None = None,
                ignore_budget: bool = False) -> Inquiry | None:
        if not paused or (self.live_budget_left(now) <= 0 and not ignore_budget):
            return None
        live = [self.price(q, now) for q in self.queue if q.phase == "live" and q.status == "queued"]
        live = [q for q in live if q.value > 0]
        if not live:
            return None
        best = max(live, key=lambda q: q.value)
        return self.mark_asked(best, now)

    def mark_asked(self, q: Inquiry, now: float | None = None) -> Inquiry:
        now = now or time.time()
        q.status = "asked"
        q.asked_at = now
        if q.phase == "live":
            self.asked_times.append(now)
        if q in self.queue:
            self.queue.remove(q)
        self.history.append(q)
        return q

    def debrief_agenda(self) -> list[Inquiry]:
        items = [self.price(q) for q in self.queue if q.status == "queued"]
        return sorted(items, key=lambda q: q.evoi * q.impact + GAMMA_GUARDRAIL * q.guardrail_gap, reverse=True)

    def find(self, qid: str) -> Inquiry | None:
        return next((q for q in [*self.queue, *self.history] if q.id == qid), None)


def impact_on_pool(predictors: list[tuple[float, Any]], baseline: Any, pool: list[dict[str, Any]]) -> float:
    """Decision-relevant uncertainty: how often would the hypotheses change a future decision?"""
    if not pool:
        return 1.0
    total = 0.0
    for prob, f in predictors:
        diff = sum(1 for c in pool if f(c) != baseline(c))
        total += prob * diff / len(pool)
    return round(min(1.0, 0.3 + 2.0 * total), 3)  # floor: unseen case types exist


def sample_pool(pack, n: int = 40, seed: int = 7) -> list[dict[str, Any]]:
    return pack.generate_cases(n, seed=seed)


def shuffle_seed() -> random.Random:
    return random.Random(11)
