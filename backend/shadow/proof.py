"""Sealed boundary tests: does a learned threshold hold on cases nobody has seen?

An evaluator picks a threshold, the expert teaches it live, and then Shadow is tested on fresh cases
spread around what it learned (just below, just above, far away, net-vs-gross straddles, and
controls outside the rule's domain). Every prediction is frozen and committed to with a SHA-256
hash *before* anyone labels a case; predictions stay sealed until a case is labeled. Labels come
from the human (in the console or by working the case in the ERP), never from the simulator, and
each label is also a normal decision Shadow learns from, so a counterexample corrects the map and
the next round tests the correction on new cases.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import time
from typing import TYPE_CHECKING, Any

from shadow import dsl, receipts
from shadow.workmap import Rule, run_map

if TYPE_CHECKING:
    from shadow.engine import Session


class ProofError(ValueError):
    pass


def _relaxed_holds(rule: Rule, ctx: dict[str, Any], param: str) -> bool:
    for direction in (-1e12, 1e12):
        if dsl.holds(rule.when, {**ctx, "params": {**ctx["params"], param: direction}}):
            return True
    return False


def sealed_body(proof: dict[str, Any]) -> str:
    """The exact text the commitment hashes, for anyone who wants to recompute it."""
    body = {"proof": proof["id"], "map_version": proof["map_version"], "map_fp": proof["map_fp"],
            "items": [{"case_id": i["case_id"], "field": proof["field"], "predicted": i["predicted"]}
                      for i in proof["items"]]}
    return json.dumps(body, sort_keys=True, default=str)


def _commit(proof: dict[str, Any]) -> str:
    return hashlib.sha256(sealed_body(proof).encode()).hexdigest()


def _base_cases(s: Session) -> list[dict[str, Any]]:
    return [s.cases[c] for c in s.case_order if "_proof" not in s.cases[c] and "_probe" not in s.cases[c]]


def build(s: Session, param: str | None = None, seed: int | None = None) -> dict[str, Any]:
    """Generate fresh boundary cases, freeze the map's predictions on them, and commit to them."""
    if s.mode == "tutor":
        raise ProofError("boundary tests run in a capture or debrief session")
    pack = s.pack
    spec_for = {q: (kind, basis) for kind, sp in pack.threshold_params().items() for basis, q in sp["bases"].items()}
    seed = seed if seed is not None else int(time.time() * 1000) % 1_000_000
    rng = random.Random(seed)
    if param is None:
        param = next((p for p in s.wm.params if p in s.param_quantity), None)

    if param is not None:
        if param not in s.wm.params or param not in s.param_quantity:
            raise ProofError(f"unknown learned parameter {param}")
        rules = sorted((r for r in s.wm.rules if f"params.{param}" in r.when and r.origin != "doc"
                        and r.belief.status != "contested"), key=lambda r: -r.belief.p)
        if not rules:
            raise ProofError(f"no active rule uses {param}")
        rule = rules[0]
        f = receipts.target_field(rule)
        positive = rule.then[f]
        quantity = s.param_quantity[param]
        kind, basis = spec_for[quantity]
        T = float(s.wm.params[param])
        pool = _base_cases(s) + pack.generate_cases(80, seed=seed)

        def ctx(c):
            return {**pack.derive(c), "params": dict(s.wm.params), "booking": {}}
        domain = [c for c in pool if _relaxed_holds(rule, ctx(c), param)]
        controls = [c for c in pool if not _relaxed_holds(rule, ctx(c), param)]
        if not domain:
            raise ProofError(f"no case in {rule.id}'s domain to vary")
        mode = "threshold"
    else:
        # discovery: nothing learned yet; spread one decision over the whole supported range
        rule, f, positive, T = None, pack.decision_fields[0].name, None, None
        kind, sp = next(iter(pack.threshold_params().items()))
        basis, quantity = next(iter(sp["bases"].items()))
        domain, controls = _base_cases(s), []
        mode = "discovery"

    sp = pack.threshold_params()[kind]
    lo, hi = float(sp["lo"]), float(sp["hi"])
    vary = getattr(pack, "threshold_variant", None)
    if vary is None:
        raise ProofError(f"pack {pack.id} cannot generate threshold variants")

    plan: list[tuple[str, float, dict[str, Any]]] = []  # (bucket, value, variant kwargs)
    if T is not None:
        jitter = lambda m: T * m * rng.uniform(0.99, 1.01)  # noqa: E731
        for m in (0.6, 0.9, 0.97):
            plan.append(("below", jitter(m), {}))
        for m in (1.03, 1.1, 1.6):
            plan.append(("above", jitter(m), {}))
        for _ in range(2):  # far from what was learned: catches a threshold learned in the wrong place
            plan.append(("spread", math.exp(rng.uniform(math.log(lo + 1), math.log(hi))), {}))
        if kind == "amount" and len(sp["bases"]) > 1:
            plan.append(("straddle", T / 1.1, {"vat_rate": 0.19}))  # net below, gross above
    else:
        for _ in range(8):
            plan.append(("spread", math.exp(rng.uniform(math.log(lo + 1), math.log(hi))), {}))

    items_cases: list[tuple[str, dict[str, Any]]] = []
    for bucket, value, kw in plan:
        value = min(max(value, lo), hi)
        base = rng.choice(domain)
        b = "net" if bucket == "straddle" else basis
        v = vary(base, kind, b, value, **kw)
        if v is not None:
            items_cases.append((bucket, v))
    if T is not None and controls:
        for m in (1.6, 3.0):  # outside the rule's domain: the rule must stay quiet however large the amount
            v = vary(rng.choice(controls), kind, basis, min(T * m, hi))
            if v is not None:
                items_cases.append(("control", v))
    rng.shuffle(items_cases)

    s.proof_round += 1
    pid = f"P{s.proof_round}"
    proof: dict[str, Any] = {
        "id": pid, "round": s.proof_round, "mode": mode, "param": param, "field": f, "positive": positive,
        "rule": rule.id if rule else None, "rule_title": rule.title if rule else None,
        "learned": {"value": round(T, 2) if T is not None else None, "quantity": quantity},
        "map_version": s.wm.version, "map_fp": s._map_fp(), "map_source": dict(s.map_source),
        "frozen_at": s.now(), "frozen_at_epoch": time.time(), "seed": seed,
        "provenance": "rehearsal" if s.simulated else "live", "items": [],
    }
    for i, (bucket, v) in enumerate(items_cases, start=1):
        cid = f"prf{s.proof_round}-{i:02d}"
        v.pop("_probe", None)
        v.update(id=cid, status="Open", _proof=pid)
        if "invoice_no" in v:  # only packs whose cases carry a document number get a fresh one
            v["invoice_no"] = f"{rng.randint(6000, 9899)}"
        v["booking"] = {k: None for k in (v.get("booking") or {})} | {"note": ""}
        pred = run_map(s.wm, pack, v)
        value, source = receipts.field_value(pred, f)
        q = pack.derive(v)
        qty = {bn: dsl.evaluate(qn, q) for bn, qn in sp["bases"].items()}
        proof["items"].append({"case_id": cid, "bucket": bucket, "quantities": qty, "describe": pack.describe(v),
                               "predicted": value, "source": source, "label": None, "agrees": None,
                               "labeled_via": None, "labeled_at": None})
        s.add_frozen_case(v, pred)
    proof["commitment"] = _commit(proof)
    s.proofs[pid] = proof
    return proof


def record_label(s: Session, case_id: str, expert: dict[str, Any], via: str) -> dict[str, Any] | None:
    """First human judgment on a proof case is its label. Returns the updated proof, if any."""
    pid = (s.cases.get(case_id) or {}).get("_proof")
    proof = s.proofs.get(pid or "")
    if proof is None:
        return None
    item = next((i for i in proof["items"] if i["case_id"] == case_id), None)
    value = expert.get(proof["field"])
    if item is None or value is None or item["label"] is not None:
        return None
    item.update(label=value, agrees=value == item["predicted"], labeled_via=via, labeled_at=s.now())
    return proof


def summary(proof: dict[str, Any]) -> dict[str, Any]:
    labeled = [i for i in proof["items"] if i["label"] is not None]
    by: dict[str, dict[str, int]] = {}
    for i in labeled:
        b = by.setdefault(i["bucket"], {"n": 0, "agree": 0})
        b["n"] += 1
        b["agree"] += int(bool(i["agrees"]))
    agree = sum(1 for i in labeled if i["agrees"])
    return {"n": len(proof["items"]), "labeled": len(labeled), "agree": agree,
            "accuracy": round(agree / len(labeled), 3) if labeled else None, "by_bucket": by,
            "complete": len(labeled) == len(proof["items"]),
            "failures": [{k: i[k] for k in ("case_id", "bucket", "quantities", "predicted", "label", "describe")}
                         for i in labeled if not i["agrees"]]}


def view(proof: dict[str, Any]) -> dict[str, Any]:
    """Public view: a case's prediction stays sealed until it has been labeled (all revealed when complete)."""
    out = {k: v for k, v in proof.items() if k != "items"}
    sm = summary(proof)
    out["summary"] = sm
    items = []
    for i in proof["items"]:
        if i["label"] is None and not sm["complete"]:
            items.append({"case_id": i["case_id"], "describe": i["describe"], "quantities": i["quantities"],
                          "sealed": True, "label": None})
        else:
            items.append({**i, "sealed": False})
    out["items"] = items
    if sm["complete"]:
        out["sealed_body"] = sealed_body(proof)
    return out
