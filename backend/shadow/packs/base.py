"""Workflow packs make the engine domain-agnostic.

A pack supplies everything domain-specific: the (deliberately incomplete)
written process doc the AI Novice starts from, the decision fields and
actions, a case generator, derived features for the rule language, and a
perturbation function used to synthesize unseen probe cases.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class FieldSpec:
    name: str
    label: str
    options: list[str] | None = None  # None = free value
    option_labels: dict[str, str] = field(default_factory=dict)


class Pack(Protocol):
    id: str
    name: str
    task: str
    expert_name: str
    process_doc: str
    decision_fields: list[FieldSpec]
    actions: list[str]
    action_precedence: list[str]  # most severe first

    def generate_cases(self, n: int, seed: int = 0) -> list[dict[str, Any]]: ...

    def demo_cases(self) -> dict[str, list[dict[str, Any]]]: ...

    def derive(self, case: dict[str, Any]) -> dict[str, Any]:
        """Rule-language context for a case: {'inv': {...}, ...}."""
        ...

    def perturb(self, case: dict[str, Any], rng: random.Random) -> list[dict[str, Any]]:
        """Small hypothetical variants of a case, used for BALD probes."""
        ...

    def describe(self, case: dict[str, Any]) -> str:
        """One-line human description, used in spoken questions."""
        ...

    def describe_delta(self, base: dict[str, Any], variant: dict[str, Any]) -> str:
        """How a probe variant differs from the case the expert saw."""
        ...
