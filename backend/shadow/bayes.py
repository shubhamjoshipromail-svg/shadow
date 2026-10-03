"""Bayesian pieces: threshold posteriors and BALD probe selection.

With one expert and a handful of cases there is little data, so Shadow
learns parameters (e.g. the capex threshold, and whether it applies to net
or gross) by asking about synthesized cases that are maximally informative
(BALD, Houlsby et al. 2011). Counterfactual answers enter the likelihood
with a reduced weight because hypothetical choices are less reliable than
real ones.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

import numpy as np


def _entropy_bern(p: np.ndarray | float) -> np.ndarray:
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return -(p * np.log2(p) + (1 - p) * np.log2(1 - p))


def entropy(probs: Sequence[float]) -> float:
    p = np.asarray([x for x in probs if x > 0], dtype=float)
    if p.size == 0:
        return 0.0
    p = p / p.sum()
    return float(-(p * np.log2(p)).sum())


@dataclass
class ThresholdPosterior:
    """P(label=1 | x) = sigmoid((x_basis - t) / scale), unknown t and basis.

    `bases` are alternative quantities the threshold might apply to (e.g. net
    vs gross amount). A grid posterior over t is kept per basis, plus a
    posterior over which basis is right.
    """

    name: str
    grid: np.ndarray
    bases: list[str]
    scale: float
    prior_mean: float
    prior_sd: float
    log_post: np.ndarray = field(init=False)
    n_obs: float = 0.0

    def __post_init__(self) -> None:
        lp = -0.5 * ((self.grid - self.prior_mean) / self.prior_sd) ** 2
        self.log_post = np.tile(lp, (len(self.bases), 1))

    @classmethod
    def make(cls, name: str, lo: float, hi: float, step: float, bases: list[str], prior_mean: float,
             prior_sd: float, scale: float) -> ThresholdPosterior:
        return cls(name=name, grid=np.arange(lo, hi + step, step), bases=bases, scale=scale,
                   prior_mean=prior_mean, prior_sd=prior_sd)

    def _p1(self, x: float) -> np.ndarray:
        return 1.0 / (1.0 + np.exp(-(x - self.grid) / self.scale))

    def observe(self, x_by_basis: dict[str, float], label: bool, weight: float = 1.0) -> None:
        for b, basis in enumerate(self.bases):
            p1 = np.clip(self._p1(x_by_basis[basis]), 1e-9, 1 - 1e-9)
            self.log_post[b] += weight * (np.log(p1) if label else np.log(1 - p1))
        self.n_obs += weight

    def _joint(self) -> np.ndarray:
        lp = self.log_post - self.log_post.max()
        w = np.exp(lp)
        return w / w.sum()

    def basis_probs(self) -> dict[str, float]:
        j = self._joint().sum(axis=1)
        return {b: float(j[i]) for i, b in enumerate(self.bases)}

    def summary(self) -> dict[str, Any]:
        j = self._joint()
        bp = j.sum(axis=1)
        best = int(np.argmax(bp))
        cond = j[best] / max(j[best].sum(), 1e-12)
        mean = float((cond * self.grid).sum())
        sd = float(np.sqrt((cond * (self.grid - mean) ** 2).sum()))
        return {"name": self.name, "basis": self.bases[best], "basis_probs": self.basis_probs(),
                "mean": round(mean, 2), "sd": round(sd, 2), "n_obs": self.n_obs,
                "curve": {"grid": self.grid[:: max(1, len(self.grid) // 120)].tolist(),
                          "density": (cond[:: max(1, len(self.grid) // 120)]).round(5).tolist()}}

    def predictive(self, x_by_basis: dict[str, float]) -> float:
        j = self._joint()
        return float(sum((j[b] * self._p1(x_by_basis[basis])).sum() for b, basis in enumerate(self.bases)))

    def bald(self, x_by_basis: dict[str, float]) -> float:
        """Mutual information (bits) between the answer at x and (t, basis)."""
        j = self._joint()
        mixture = 0.0
        expected_h = 0.0
        for b, basis in enumerate(self.bases):
            p1 = self._p1(x_by_basis[basis])
            mixture += float((j[b] * p1).sum())
            expected_h += float((j[b] * _entropy_bern(p1)).sum())
        return float(_entropy_bern(mixture) - expected_h)


@dataclass
class Hypothesis:
    id: str
    prob: float
    predict: Callable[[dict[str, Any]], Any]  # case -> predicted value (None = no opinion)


def bald_discrete(hyps: Sequence[Hypothesis], case: dict[str, Any], noise: float = 0.05) -> float:
    """Expected information (bits) from asking the expert about `case`.

    Each hypothesis predicts a value; the expert answers per the true
    hypothesis, with probability `noise` of answering something else.
    """
    total = sum(h.prob for h in hyps) or 1.0
    preds = [(h.prob / total, h.predict(case)) for h in hyps]
    values = sorted({repr(v) for _, v in preds})
    k = max(len(values), 2)

    def answer_dist(v: Any) -> np.ndarray:
        d = np.full(len(values), noise / max(k - 1, 1))
        if repr(v) in values:
            d[values.index(repr(v))] = 1 - noise
        else:
            d[:] = 1.0 / len(values)
        return d / d.sum()

    dists = [(p, answer_dist(v)) for p, v in preds]
    mixture = sum(p * d for p, d in dists)
    h_mix = entropy(mixture.tolist())
    h_cond = sum(p * entropy(d.tolist()) for p, d in dists)
    return max(0.0, h_mix - h_cond)


def posterior_update(hyps: Sequence[Hypothesis], case: dict[str, Any], answer: Any, noise: float = 0.05,
                     weight: float = 1.0) -> dict[str, float]:
    """Bayes update of hypothesis probabilities after the expert's answer on `case`."""
    out = {}
    for h in hyps:
        v = h.predict(case)
        like = 0.5 if v is None else ((1 - noise) if v == answer else noise)
        out[h.id] = h.prob * like ** weight
    z = sum(out.values()) or 1.0
    return {k: v / z for k, v in out.items()}
