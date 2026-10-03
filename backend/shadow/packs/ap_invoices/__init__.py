"""Accounts-payable invoice processing (the brief's 'Sabine' example)."""

from __future__ import annotations

import copy
import random
import zlib
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from shadow.packs import register
from shadow.packs.base import FieldSpec

DEMO_TODAY = date(2026, 12, 29)  # two days before month-end close
EU = {"AT", "CZ", "SE", "FR", "NL", "PL", "IT", "ES", "DK", "BE"}
CZK_PER_EUR = 25.0
USD_PER_EUR = 1.08

SUPPLIERS: dict[str, dict[str, Any]] = {
    "schmidt": dict(name="Schmidt Antriebstechnik GmbH", country="DE", status="known", intercompany=False),
    "weber": dict(name="Weber Elektro KG", country="DE", status="known", intercompany=False),
    "kraemer": dict(name="Krämer Industriebedarf GmbH", country="DE", status="known", intercompany=False,
                    notes="Long-standing supplier of fasteners and small parts."),
    "officeplus": dict(name="Officeplus Bürobedarf GmbH", country="DE", status="known", intercompany=False),
    "datawerk": dict(name="Datawerk IT-Systeme GmbH", country="DE", status="known", intercompany=False),
    "alpentech": dict(name="Alpentech Maschinenhandel GmbH", country="AT", status="known", intercompany=False),
    "lindqvist": dict(name="Lindqvist Automation AB", country="SE", status="known", intercompany=False),
    "nordwerk_cz": dict(name="Nordwerk CZ s.r.o.", country="CZ", status="known", intercompany=True,
                        notes="Group company – intercompany."),
    "quickparts": dict(name="QuickParts Trading Ltd", country="DE", status="new", intercompany=False),
    "hansa": dict(name="Hansa Industrieservice GmbH", country="DE", status="known", intercompany=False),
}

LINE_CATALOG = {
    "equipment": [("CNC rotary table RT-320", 6400), ("Hydraulic press HP-40", 8900), ("Bench grinder BG-200", 1450),
                  ("Welding unit MIG-350", 3900), ("Spindle motor SM-7.5kW", 5600), ("Air compressor AK-500", 4750)],
    "it_hardware": [("Laptop ProBook 450 (x4)", 4800), ("Engineering workstation Z6 (x3)", 7650),
                    ("Network switch 48p", 2300), ("Laptop ProBook 450 (x6)", 7200)],
    "service": [("Maintenance contract Q4", 2400), ("Repair spindle drive", 1800), ("Calibration service", 950),
                ("Machine relocation", 3200)],
    "consumables": [("Fasteners assortment", 640), ("Cutting fluid 200l", 890), ("Welding wire", 420),
                    ("Office supplies", 310)],
    "software": [("CAD licence renewal", 3100)],
    "freight": [("Freight charges", 180)],
}


def _eur(x: float) -> str:
    """German-style amount: 5.700 EUR."""
    return f"{x:,.0f}".replace(",", ".") + " EUR"


def _iban(seed: int, country: str) -> str:
    rng = random.Random(seed)
    return f"{country}{rng.randint(10, 99)} " + " ".join(f"{rng.randint(0, 9999):04d}" for _ in range(4))


def _vat_id(seed: int, country: str) -> str:
    return f"{country}{random.Random(seed + 7).randint(100000000, 999999999)}"


class APInvoicesPack:
    id = "ap_invoices"
    name = "Accounts payable – supplier invoices"
    task = "process_supplier_invoice"
    expert_name = "Sabine"
    process_doc = (Path(__file__).parent / "process_doc_2019.md").read_text()
    decision_fields = [
        FieldSpec("cost_center", "Cost center", ["4711", "4720", "0400", "0410", "9100"],
                  {"4711": "Opex – Maintenance", "4720": "Opex – Consumables",
                   "0400": "Capex – Machinery & Equipment", "0410": "Capex – IT Hardware",
                   "9100": "Intercompany Clearing"}),
        FieldSpec("tax_code", "Tax code", ["V19", "V7", "RC", "V0"]),
        FieldSpec("payment_timing", "Payment timing", ["skonto", "due"]),
    ]
    actions = ["post", "hold", "second_approval", "escalate", "reject"]
    # Role-level priors (the cross-customer predicate library): fact combinations that AP experts
    # commonly guard on. Shadow explores these first when no learned rule mentions them yet.
    exploration_priors = [
        {"supplier_status", "bank_changed"},  # supplier verification / payment fraud
        {"price_variance_pct"},               # PO price tolerance
        {"qty_ratio"},                        # goods-receipt quantity tolerance
        {"dup_amount_recent"},                # duplicate billing
        {"asset_number_available"},           # capitalisation prerequisites
    ]
    action_precedence = ["escalate", "reject", "hold", "second_approval", "post"]

    # ------------------------------------------------------------------ cases
    def _make(self, cid: str, supplier_key: str, category: str, line_idx: int, *, rng: random.Random,
              inv_date: date | None = None, scale: float = 1.0, currency: str = "EUR",
              skonto: bool = False, variance: float = 0.0, qty_ratio: float = 1.0,
              po: bool = True, asset_number: str | None = None, bank_changed: bool = False,
              dup_history: bool = False, status_override: str | None = None) -> dict[str, Any]:
        sup = dict(SUPPLIERS[supplier_key])
        if status_override:
            sup["status"] = status_override
        seed = zlib.crc32(cid.encode()) % 10_000
        desc, base = LINE_CATALOG[category][line_idx % len(LINE_CATALOG[category])]
        net = round(base * scale, 2)
        if currency == "CZK":
            net = round(net * CZK_PER_EUR, 0)
        lines = [dict(description=desc, qty=1, unit_price=net, category=category)]
        if category in ("equipment", "it_hardware") and rng.random() < 0.4:
            lines.append(dict(description="Freight charges", qty=1, unit_price=0.0, category="freight"))
        foreign_eu = sup["country"] in EU
        vat_rate = 0.0 if foreign_eu else 0.19
        vat = round(net * vat_rate, 2)
        inv_date = inv_date or (DEMO_TODAY - timedelta(days=rng.randint(2, 12)))
        gross = round(net + vat, 2)
        history = []
        for k in range(8):
            d = inv_date - timedelta(days=30 * (k + 1) + rng.randint(-6, 6))
            history.append(dict(invoice_no=f"{seed % 900 + 100}-{2026 - k // 12}-{k:02d}", date=d.isoformat(),
                                amount=round(gross * rng.uniform(0.4, 1.6), 2), status="posted"))
        if dup_history:
            d = inv_date - timedelta(days=rng.randint(6, 16))
            history.insert(0, dict(invoice_no=f"{seed % 900 + 100}-2026-D", date=d.isoformat(), amount=gross,
                                   status="posted"))
        po_obj = None
        if po:
            po_obj = dict(po_no=f"PO-26-{seed:04d}", ordered_total=round(net / (1 + variance / 100), 2),
                          received_qty_ratio=qty_ratio, price_variance_pct=round(variance, 2))
            if asset_number:
                po_obj["asset_number"] = asset_number
        return dict(
            id=cid,
            invoice_no=cid.split("-")[-1] if cid.startswith("inv-") else f"{seed % 9000 + 1000}",
            invoice_date=inv_date.isoformat(),
            due_date=(inv_date + timedelta(days=30)).isoformat(),
            currency=currency,
            supplier=dict(id=supplier_key, name=sup["name"], country=sup["country"], status=sup["status"],
                          intercompany=sup["intercompany"], bank_changed_recently=bank_changed,
                          vat_id=_vat_id(seed, sup["country"]), iban=_iban(seed, sup["country"]),
                          notes=sup.get("notes")),
            lines=lines,
            net=net, vat_rate=vat_rate, vat=vat, gross=gross,
            payment_terms=dict(skonto_pct=2.0 if skonto else 0.0, skonto_days=10 if skonto else 0, net_days=30),
            po=po_obj,
            history=history,
            booking=dict(cost_center=None, gl_account=None, asset_number=None, tax_code=None,
                         payment_date=None, note=""),
            status="Open",  # ERP status vocabulary: Open / On hold / Awaiting 2nd approval / Posted / ...
        )

    def demo_cases(self) -> dict[str, list[dict[str, Any]]]:
        """Seeded sets: what the expert works live, and the unseen case for the tutor."""
        rng = random.Random(42)
        capture = [
            self._make("inv-4471", "schmidt", "equipment", 0, rng=rng, asset_number="AN-2026-0142"),
            self._make("inv-4472", "kraemer", "consumables", 0, rng=rng, dup_history=True,
                       inv_date=date(2026, 12, 18)),
            self._make("inv-4473", "nordwerk_cz", "service", 3, rng=rng, currency="CZK"),
            self._make("inv-4474", "officeplus", "consumables", 3, rng=rng, skonto=True),
        ]
        tutor = [
            self._make("inv-5120", "hansa", "equipment", 1, rng=rng, scale=0.81),  # €7.2k, no asset no.
            self._make("inv-5121", "quickparts", "consumables", 1, rng=rng, bank_changed=True),
            self._make("inv-5122", "alpentech", "service", 0, rng=rng, skonto=True),
        ]
        return {"capture": capture, "tutor": tutor}

    def generate_cases(self, n: int, seed: int = 0) -> list[dict[str, Any]]:
        rng = random.Random(seed)
        out = []
        scenarios = ["service", "consumables", "capex", "small_equipment", "it", "double_bill", "intercompany",
                     "eu_rc", "unknown_bank", "variance", "skonto"]
        for i in range(n):
            s = rng.choice(scenarios)
            cid = f"gen-{seed}-{i}"
            li = rng.randint(0, 5)
            if s == "service":
                c = self._make(cid, rng.choice(["weber", "hansa", "schmidt"]), "service", li, rng=rng)
            elif s == "consumables":
                c = self._make(cid, rng.choice(["kraemer", "officeplus"]), "consumables", li, rng=rng)
            elif s == "capex":
                c = self._make(cid, rng.choice(["schmidt", "hansa", "alpentech"]), "equipment", rng.choice([0, 1, 4]),
                               rng=rng, scale=rng.uniform(0.9, 1.4),
                               asset_number=f"AN-2026-{rng.randint(100, 999)}" if rng.random() < 0.6 else None)
            elif s == "small_equipment":
                c = self._make(cid, rng.choice(["schmidt", "weber"]), "equipment", rng.choice([2, 3, 5]), rng=rng)
            elif s == "it":
                c = self._make(cid, "datawerk", "it_hardware", li, rng=rng, scale=rng.uniform(0.8, 1.3),
                               asset_number=f"AN-2026-{rng.randint(100, 999)}" if rng.random() < 0.6 else None)
            elif s == "double_bill":
                c = self._make(cid, "kraemer", "consumables", li, rng=rng, dup_history=True,
                               inv_date=date(2026, rng.choice([3, 7, 12]), rng.randint(5, 25)))
            elif s == "intercompany":
                c = self._make(cid, "nordwerk_cz", rng.choice(["service", "equipment"]), li, rng=rng, currency="CZK")
            elif s == "eu_rc":
                c = self._make(cid, rng.choice(["alpentech", "lindqvist"]), rng.choice(["service", "consumables"]),
                               li, rng=rng)
            elif s == "unknown_bank":
                c = self._make(cid, "quickparts", "consumables", li, rng=rng, bank_changed=rng.random() < 0.7,
                               status_override=rng.choice(["new", "unknown"]))
            elif s == "variance":
                c = self._make(cid, rng.choice(["schmidt", "weber"]), "service", li, rng=rng,
                               variance=rng.choice([0.5, 1.2, 1.8, 2.5, 3.5, 4.0, 6.0]))
            else:
                c = self._make(cid, rng.choice(["officeplus", "weber"]), "consumables", li, rng=rng, skonto=True)
            out.append(c)
        return out

    # ------------------------------------------------------- rule language ctx
    def derive(self, case: dict[str, Any]) -> dict[str, Any]:
        sup = case["supplier"]
        fx = {"EUR": 1.0, "CZK": CZK_PER_EUR, "USD": USD_PER_EUR}.get(case["currency"], 1.0)
        lines = case["lines"]
        by_cat: dict[str, float] = {}
        for ln in lines:
            by_cat[ln["category"]] = by_cat.get(ln["category"], 0) + ln["qty"] * ln["unit_price"]
        category = max(by_cat, key=by_cat.get) if by_cat else None
        inv_date = date.fromisoformat(case["invoice_date"])
        dup_days = None
        for h in case.get("history", []):
            if abs(h["amount"] - case["gross"]) <= 0.005 * max(case["gross"], 1):
                delta = (inv_date - date.fromisoformat(h["date"])).days
                if 0 <= delta and (dup_days is None or delta < dup_days):
                    dup_days = delta
        po = case.get("po") or {}
        terms = case.get("payment_terms") or {}
        skonto_deadline = inv_date + timedelta(days=terms.get("skonto_days", 0) or 0)
        inv = dict(
            id=case["id"],
            net=case["net"], gross=case["gross"], vat_rate=case["vat_rate"],
            net_eur=round(case["net"] / fx, 2), gross_eur=round(case["gross"] / fx, 2),
            currency=case["currency"],
            month=inv_date.month, day=inv_date.day,
            category=category, categories=sorted(by_cat),
            n_lines=len(lines),
            supplier_id=sup["id"], supplier_name=sup["name"], supplier_country=sup["country"],
            supplier_status=sup["status"], intercompany=sup["intercompany"],
            bank_changed=sup.get("bank_changed_recently", False),
            domestic=sup["country"] == "DE", eu_foreign=sup["country"] in EU,
            dup_amount_recent=dup_days is not None and dup_days <= 45,
            dup_days=dup_days,
            has_po=bool(po),
            price_variance_pct=po.get("price_variance_pct", 0.0),
            qty_ratio=po.get("received_qty_ratio", 1.0),
            asset_number_available=bool(po.get("asset_number")),
            skonto_pct=terms.get("skonto_pct", 0.0),
            days_to_skonto=(skonto_deadline - DEMO_TODAY).days if terms.get("skonto_days") else None,
        )
        return {"inv": inv}

    def normalize(self, case: dict[str, Any], booking: dict[str, Any] | None) -> dict[str, Any]:
        """Booking form → the decision fields Shadow predicts and compares."""
        booking = booking or {}
        timing = None
        pd = booking.get("payment_date")
        if pd:
            terms = case.get("payment_terms") or {}
            inv_date = date.fromisoformat(case["invoice_date"])
            if terms.get("skonto_days") and date.fromisoformat(pd) <= inv_date + timedelta(days=terms["skonto_days"]):
                timing = "skonto"
            else:
                timing = "due"
        return {"cost_center": booking.get("cost_center"), "tax_code": booking.get("tax_code"),
                "payment_timing": timing}

    def booking_from_decision(self, case: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any]:
        b = dict(case.get("booking") or {})
        b.update({k: v for k, v in fields.items() if k in ("cost_center", "tax_code", "asset_number")})
        timing = fields.get("payment_timing")
        if timing:
            inv_date = date.fromisoformat(case["invoice_date"])
            terms = case.get("payment_terms") or {}
            days = terms.get("skonto_days") if timing == "skonto" and terms.get("skonto_days") else terms.get("net_days", 30)
            b["payment_date"] = (inv_date + timedelta(days=days)).isoformat()
        return b

    def seed_map(self) -> dict[str, Any]:
        """The 2019 work instruction, translated into starting rules (origin='doc').

        This is what an AI that only read the documentation would do. Every
        deviation from it is a candidate piece of unwritten judgment.
        """
        steps = [
            dict(id="S1", order=1, name="Open and check the invoice", description="Supplier, number, date, amounts."),
            dict(id="S2", order=2, name="Compare with purchase order", description="PO and goods receipt."),
            dict(id="S3", order=3, name="Code the cost center", decision_field="cost_center"),
            dict(id="S4", order=4, name="Set the tax code", decision_field="tax_code"),
            dict(id="S5", order=5, name="Set the payment date", decision_field="payment_timing"),
            dict(id="S6", order=6, name="Post, hold or route the invoice", decision_field="action"),
        ]
        doc = lambda i, step, title, when, then: dict(  # noqa: E731
            id=f"D{i}", step_id=step, title=title, when=when, then=then, origin="doc")
        rules = [
            doc(1, "S3", "Doc: services and maintenance → 4711", "inv.category in ['service', 'software', 'freight']",
                {"cost_center": "4711"}),
            doc(2, "S3", "Doc: consumables → 4720", "inv.category == 'consumables'", {"cost_center": "4720"}),
            doc(3, "S3", "Doc: equipment and IT hardware → 4711", "inv.category in ['equipment', 'it_hardware']",
                {"cost_center": "4711"}),
            doc(4, "S4", "Doc: tax code V19", "True", {"tax_code": "V19"}),
            doc(5, "S5", "Doc: pay on the due date", "True", {"payment_timing": "due"}),
            doc(6, "S6", "Doc: post when checked", "True", {"action": "post"}),
        ]
        for i, s in enumerate(steps):
            s["rule_ids"] = [r["id"] for r in rules if r["step_id"] == s["id"]]
        return {"steps": steps, "rules": rules, "guardrails": [], "params": {}}

    def threshold_params(self) -> dict[str, dict[str, Any]]:
        """Numeric parameters Shadow may learn, with the quantities they could apply to."""
        return {
            "amount": dict(lo=500, hi=20000, step=50, scale=60,
                           bases={"net": "inv.net_eur", "gross": "inv.gross_eur"}),
            "pct": dict(lo=0, hi=10, step=0.1, scale=0.15, bases={"pct": "inv.price_variance_pct"}),
            "days": dict(lo=0, hi=90, step=1, scale=1.5, bases={"days": "inv.dup_days"}),
        }

    # ------------------------------------------------------------ probes
    def perturb(self, case: dict[str, Any], rng: random.Random) -> list[dict[str, Any]]:
        variants: list[dict[str, Any]] = []

        def variant(delta: str, mutate) -> None:
            v = copy.deepcopy(case)
            mutate(v)
            v["id"] = f"{case['id']}~{len(variants)}"
            v["_probe"] = {"base": case["id"], "delta": delta}
            variants.append(v)

        def set_net(v: dict[str, Any], net: float) -> None:
            ratio = net / max(v["net"], 0.01)
            v["net"] = round(net, 2)
            v["vat"] = round(net * v["vat_rate"], 2)
            v["gross"] = round(v["net"] + v["vat"], 2)
            for ln in v["lines"]:
                ln["unit_price"] = round(ln["unit_price"] * ratio, 2)

        fx = CZK_PER_EUR if case["currency"] == "CZK" else 1.0
        for eur in (1500, 3000, 4200, 4600, 4800, 4900, 5100, 5300, 5600, 6400, 8000, 12000):
            variant(f"a net amount of {_eur(eur)} instead of {_eur(case['net'] / fx)}",
                    lambda v, e=eur: set_net(v, e * fx))
        for gross_target in (5300, 5600, 5900):  # net under 5k, gross over 5k (separates net vs gross)
            net = gross_target / 1.19
            if net < 5000:
                variant(f"{_eur(net)} net but {_eur(gross_target)} gross",
                        lambda v, n=net: (v.update(vat_rate=0.19), set_net(v, n)))
        for eur in (5300, 5700):  # zero-VAT reverse-charge variants: gross == net
            variant(f"from Alpentech in Austria, reverse charge with no VAT, {_eur(eur)} net",
                    lambda v, e=eur: (self._swap_supplier(v, "alpentech"), set_net(v, e * fx)))
        for cat in ("equipment", "it_hardware", "service", "consumables"):
            if cat != self.derive(case)["inv"]["category"]:
                variant(f"the line items are {cat.replace('_', ' ')} instead",
                        lambda v, c=cat: [ln.update(category=c) for ln in v["lines"]])
        has_asset = bool((case.get("po") or {}).get("asset_number"))
        variant("no asset number on the PO" if has_asset else "the PO carries asset number AN-2026-0999",
                lambda v: (v.setdefault("po", {"po_no": "PO-26-9999", "ordered_total": v["net"],
                                                "received_qty_ratio": 1.0, "price_variance_pct": 0.0}),
                           v["po"].pop("asset_number", None) if has_asset
                           else v["po"].update(asset_number="AN-2026-0999")))
        for month in (3, 7, 12):
            d = date.fromisoformat(case["invoice_date"])
            if d.month != month:
                variant(f"dated {date(2026, month, min(d.day, 28)).strftime('%B')} instead",
                        lambda v, m=month, dd=d: v.update(invoice_date=date(2026, m, min(dd.day, 28)).isoformat()))
        variant("the earlier invoice with the same amount was not there" if self.derive(case)["inv"]["dup_amount_recent"]
                else "an invoice with the identical amount was booked two weeks earlier",
                lambda v: self._toggle_dup(v))
        for key in ("kraemer", "schmidt", "nordwerk_cz", "alpentech", "quickparts"):
            if key != case["supplier"]["id"]:
                variant(f"it came from {SUPPLIERS[key]['name']}", lambda v, k=key: self._swap_supplier(v, k))
        variant("the supplier's bank details changed last week" if not case["supplier"].get("bank_changed_recently")
                else "the bank details had not changed",
                lambda v: v["supplier"].update(bank_changed_recently=not v["supplier"].get("bank_changed_recently")))
        for var in (1.5, 2.5, 4.0):
            variant(f"a {var}% price variance against the PO",
                    lambda v, x=var: v.setdefault("po", {"po_no": "PO-26-9998", "ordered_total": v["net"],
                                                         "received_qty_ratio": 1.0}).update(price_variance_pct=x))
        variant("2% Skonto within 10 days" if not case["payment_terms"].get("skonto_pct") else "no Skonto offered",
                lambda v: v["payment_terms"].update(
                    skonto_pct=0.0 if v["payment_terms"].get("skonto_pct") else 2.0,
                    skonto_days=0 if v["payment_terms"].get("skonto_days") else 10))
        rng.shuffle(variants)
        return variants

    def threshold_variant(self, case: dict[str, Any], kind: str, basis: str, value: float, *,
                          vat_rate: float | None = None) -> dict[str, Any] | None:
        """A copy of `case` whose threshold quantity (`basis` of `kind`) equals `value`; None if unsupported."""
        v = copy.deepcopy(case)
        fx = {"EUR": 1.0, "CZK": CZK_PER_EUR, "USD": USD_PER_EUR}.get(v["currency"], 1.0)
        if kind == "amount":
            rate = v["vat_rate"] if vat_rate is None else vat_rate
            net_eur = value if basis == "net" else value / (1 + rate)
            net = round(net_eur * fx, 2)
            ratio = net / max(v["net"], 0.01)
            v.update(vat_rate=rate, net=net, vat=round(net * rate, 2))
            v["gross"] = round(v["net"] + v["vat"], 2)
            for ln in v["lines"]:
                ln["unit_price"] = round(ln["unit_price"] * ratio, 2)
            v["history"] = [h for h in v.get("history", []) if abs(h["amount"] - v["gross"]) > 0.005 * v["gross"]]
            if self.derive(case)["inv"]["dup_amount_recent"]:
                self._toggle_dup(v)  # keep the base case's duplicate signal, if it had one
            return v
        if kind == "pct":
            po = v.setdefault("po", {"po_no": "PO-26-9997", "ordered_total": v["net"], "received_qty_ratio": 1.0})
            po["price_variance_pct"] = round(value, 2)
            po["ordered_total"] = round(v["net"] / (1 + value / 100), 2)
            return v
        return None

    def _toggle_dup(self, v: dict[str, Any]) -> None:
        if self.derive(v)["inv"]["dup_amount_recent"]:
            v["history"] = [h for h in v["history"] if abs(h["amount"] - v["gross"]) > 0.005 * v["gross"]]
        else:
            d = date.fromisoformat(v["invoice_date"]) - timedelta(days=14)
            v["history"].insert(0, dict(invoice_no="DUP-1", date=d.isoformat(), amount=v["gross"], status="posted"))

    def _swap_supplier(self, v: dict[str, Any], key: str) -> None:
        sup = SUPPLIERS[key]
        v["supplier"].update(id=key, name=sup["name"], country=sup["country"], status=sup["status"],
                             intercompany=sup["intercompany"])
        v["vat_rate"] = 0.0 if sup["country"] in EU else 0.19
        v["vat"] = round(v["net"] * v["vat_rate"], 2)
        v["gross"] = round(v["net"] + v["vat"], 2)

    # ---------------------------------------------------------- language
    def describe(self, case: dict[str, Any]) -> str:
        d = self.derive(case)["inv"]
        amt = f"{case['net']:,.0f}".replace(",", ".") + f" {case['currency']}"
        return f"invoice {case['invoice_no']} from {d['supplier_name']}, {d['category'] or 'mixed'} for {amt} net"

    def describe_delta(self, base: dict[str, Any], variant: dict[str, Any]) -> str:
        return (variant.get("_probe") or {}).get("delta", "a slightly different case")


PACK = register(APInvoicesPack())
