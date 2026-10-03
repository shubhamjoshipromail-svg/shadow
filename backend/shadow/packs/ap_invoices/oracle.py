"""Oracle 'Sabine': a simulated expert with hidden rules.

Used for automated tests and the evaluation curves. Shadow never reads this
module — it only sees the oracle's actions and spoken answers. A
confabulation knob makes 'why' answers name a plausible but wrong reason.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any

from shadow.packs.ap_invoices import PACK

CAPEX_THRESHOLD_NET_EUR = 5000
VARIANCE_TOLERANCE_PCT = 2.0

REASONS = {
    "capex": "Equipment over five thousand euros net is always capex.",
    "capex_it": "IT hardware over five thousand net goes to IT capex, 0410.",
    "asset": "No asset number, no capex booking. I hold it until asset accounting gives me one.",
    "dup": "There's an invoice with the exact same amount a couple of weeks ago. Krämer double-bills, "
           "especially in December. I hold it and call them.",
    "ic": "That's our Czech subsidiary. Intercompany goes to 9100 and always needs Keller's second approval.",
    "fraud": "New supplier and the bank details just changed? That's the classic fraud pattern. "
             "I stop and ask the controller.",
    "variance": "The price is more than two percent over the PO. Anything over two percent I hold and ask purchasing.",
    "rc": "EU supplier outside Germany, so reverse charge.",
    "skonto": "Two percent Skonto, so I pay within the ten days. That's real money at year end.",
    "consumables": "Small parts and consumables go to 4720.",
    "default": "Nothing special, it matches the PO, so I just post it.",
}

CONFABULATIONS = [
    "I just have a feeling about this supplier, the quality has been going down.",
    "It's mostly about the delivery date, honestly.",
    "We try to keep the budget even across quarters.",
]


@dataclass
class Decision:
    fields: dict[str, Any]
    action: str
    reasons: list[str]
    asset_number: str | None = None


def decide(case: dict[str, Any]) -> Decision:
    d = PACK.derive(case)["inv"]
    reasons: list[str] = []
    capex = d["category"] in ("equipment", "it_hardware") and d["net_eur"] > CAPEX_THRESHOLD_NET_EUR
    if d["intercompany"]:
        cc = "9100"
        reasons.append("ic")
    elif capex:
        cc = "0400" if d["category"] == "equipment" else "0410"
        reasons.append("capex" if cc == "0400" else "capex_it")
    elif d["category"] == "consumables":
        cc = "4720"
        reasons.append("consumables")
    else:
        cc = "4711"
    tax = "RC" if d["eu_foreign"] else "V19"
    if tax == "RC":
        reasons.append("rc")
    timing = "skonto" if d["skonto_pct"] >= 2 else "due"
    if timing == "skonto":
        reasons.append("skonto")

    action = "post"
    if d["supplier_status"] in ("new", "unknown") and d["bank_changed"]:
        action = "escalate"
        reasons.insert(0, "fraud")
    elif d["dup_amount_recent"] and (d["dup_days"] or 99) <= 30:
        action = "hold"
        reasons.insert(0, "dup")
    elif d["price_variance_pct"] > VARIANCE_TOLERANCE_PCT:
        action = "hold"
        reasons.insert(0, "variance")
    elif capex and not d["asset_number_available"] and not d["intercompany"]:
        action = "hold"
        reasons.insert(0, "asset")
    elif d["intercompany"]:
        action = "second_approval"
    if not reasons:
        reasons.append("default")
    asset = (case.get("po") or {}).get("asset_number") if capex else None
    return Decision(fields={"cost_center": cc, "tax_code": tax, "payment_timing": timing},
                    action=action, reasons=reasons, asset_number=asset)


class OracleSabine:
    def __init__(self, confabulation: float = 0.0, seed: int = 0):
        self.confabulation = confabulation
        self.rng = random.Random(seed)

    def act(self, case: dict[str, Any]) -> Decision:
        return decide(case)

    def explain(self, case: dict[str, Any], focus_field: str | None = None) -> str:
        """Answer to an open 'why / what did you notice' question."""
        if self.rng.random() < self.confabulation:
            return self.rng.choice(CONFABULATIONS)
        dec = decide(case)
        keyed = {
            "cost_center": ["ic", "capex", "capex_it", "consumables"],
            "tax_code": ["rc"],
            "payment_timing": ["skonto"],
            "action": ["fraud", "dup", "variance", "asset", "ic"],
        }
        pool = [r for r in dec.reasons if focus_field is None or r in keyed.get(focus_field, [])] or dec.reasons
        return REASONS[pool[0]]

    def answer_probe(self, case: dict[str, Any], field: str) -> Any:
        """Answer to a counterfactual 'what would you do if…' question."""
        dec = decide(case)
        return dec.action if field == "action" else dec.fields.get(field)

    def confirm(self, case: dict[str, Any], rule_holds_on_case: bool) -> bool:
        return rule_holds_on_case
