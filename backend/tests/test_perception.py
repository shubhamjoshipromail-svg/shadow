"""VIS — vision frames → structured events (the brief's Module 1, literally).

All readings are fixed by hand: no LLM, no network. The chain under test is

    frame fields {label: value} → map_fields(pack) → diff_events →
        case_opened / field_changed / action

plus the hard privacy rule that no IBAN/card/e-mail value ever leaves.
"""

from __future__ import annotations

import json

from shadow.perception import (
    FrameReading,
    ScreenChange,
    VisibleField,
    diff_events,
    entity_key,
    map_fields,
    normalise_label,
)
from shadow.packs import get_pack

AP = get_pack("ap_invoices")
EXPENSE = get_pack("expense_approval")


def reading(*, entity_id: str | None = None, entity: str | None = None, fields: dict | None = None,
            visible_fields: list | None = None, changes: list | None = None) -> FrameReading:
    if entity is None and entity_id:
        entity = f"invoice {entity_id}"
    return FrameReading(app="Nordwerk ERP", entity=entity, entity_id=entity_id, summary="on screen",
                        fields=fields or {}, visible_fields=visible_fields or [], changes=changes or [])


# ------------------------------------------------------------------ the model
def test_field_views_mirror_each_other():
    a = reading(entity_id="inv-1", visible_fields=[VisibleField(name="Cost center", value="0400")])
    assert a.fields == {"Cost center": "0400"}
    assert [(f.name, f.value) for f in a.visible_fields] == [("Cost center", "0400")]

    b = reading(entity_id="inv-1", fields={"Cost center": "0400", "Tax code": "V19"})
    assert b.fields == {"Cost center": "0400", "Tax code": "V19"}
    assert [(f.name, f.value) for f in b.visible_fields] == [("Cost center", "0400"), ("Tax code", "V19")]


def test_non_string_values_are_coerced_to_text():
    r = FrameReading(app="ERP", summary="s", entity_id=4471, fields={"Amount": 5000})
    assert r.entity_id == "4471"
    assert r.fields == {"Amount": "5000"}


def test_normalise_label():
    assert normalise_label("Cost centre") == "cost_centre"
    assert normalise_label("Kostenstelle") == "kostenstelle"
    assert normalise_label("Amount (EUR)") == "amount_eur"
    assert normalise_label("") == ""


# --------------------------------------------------- the acceptance sequence
def test_open_change_change_back_new_case():
    f_open = reading(entity_id="inv-4471", fields={"Cost center": "0400", "Tax code": "V19"})
    f_change = reading(entity_id="inv-4471", fields={"Cost center": "4711", "Tax code": "V19"})
    f_back = reading(entity_id="inv-4471", fields={"Cost center": "0400", "Tax code": "V19"})
    f_new = reading(entity_id="inv-4472", fields={"Cost center": "4720"})

    assert diff_events(None, f_open, AP) == [
        {"type": "case_opened", "case_id": "inv-4471",
         "fields": {"cost_center": "0400", "tax_code": "V19"}}]
    assert diff_events(f_open, f_change, AP) == [
        {"type": "field_changed", "case_id": "inv-4471", "field": "cost_center",
         "before": "0400", "after": "4711"}]
    assert diff_events(f_change, f_back, AP) == [
        {"type": "field_changed", "case_id": "inv-4471", "field": "cost_center",
         "before": "4711", "after": "0400"}]
    assert diff_events(f_back, f_new, AP) == [
        {"type": "case_opened", "case_id": "inv-4472", "fields": {"cost_center": "4720"}}]


def test_open_then_same_frame_is_silent():
    f = reading(entity_id="inv-4471", fields={"Cost center": "0400"})
    assert diff_events(None, f, AP) == [
        {"type": "case_opened", "case_id": "inv-4471", "fields": {"cost_center": "0400"}}]
    assert diff_events(f, f, AP) == []


def test_appearing_and_vanishing_fields():
    f1 = reading(entity_id="inv-4471", fields={"Cost center": "0400"})
    f2 = reading(entity_id="inv-4471", fields={"Cost center": "0400", "Tax code": "V19"})
    f3 = reading(entity_id="inv-4471", fields={"Cost center": "0400"})
    assert diff_events(f1, f2, AP) == [
        {"type": "field_changed", "case_id": "inv-4471", "field": "tax_code", "before": None, "after": "V19"}]
    assert diff_events(f2, f3, AP) == [
        {"type": "field_changed", "case_id": "inv-4471", "field": "tax_code", "before": "V19", "after": None}]


def test_first_frame_without_entity_id_reports_its_fields():
    f = reading(fields={"Amount": "5.000 EUR"})  # no id: nothing can open
    assert diff_events(None, f, AP) == [
        {"type": "field_changed", "case_id": None, "field": "amount", "before": None, "after": "5.000 EUR"}]


def test_without_pack_keys_stay_normalised_labels():
    f = reading(entity_id="inv-1", fields={"Due date": "2026-01-01"})
    assert diff_events(None, f) == [
        {"type": "case_opened", "case_id": "inv-1", "fields": {"due_date": "2026-01-01"}}]


# --------------------------------------------------------- field mapping: AP
def test_map_fields_ap_exact_name_and_label():
    assert map_fields(reading(fields={"Cost center": "0400"}), AP) == {"cost_center": "0400"}
    assert map_fields(reading(fields={"Tax code": "V19"}), AP) == {"tax_code": "V19"}


def test_map_fields_ap_spelling_and_synonym():
    assert map_fields(reading(fields={"Cost centre": "0400"}), AP) == {"cost_center": "0400"}
    assert map_fields(reading(fields={"VAT code": "V19"}), AP) == {"tax_code": "V19"}


def test_map_fields_ap_option_values_and_labels():
    # option *value* evidence, unrelated label
    assert map_fields(reading(fields={"Terms": "skonto"}), AP) == {"payment_timing": "skonto"}
    assert map_fields(reading(fields={"Terms": "due"}), AP) == {"payment_timing": "due"}
    # option *label* evidence, unrelated label
    assert map_fields(reading(fields={"Posting key": "Opex – Maintenance"}), AP) == {
        "cost_center": "Opex – Maintenance"}


def test_map_fields_unmatched_keeps_normalised_label():
    mapped = map_fields(reading(fields={"Supplier": "Schmidt", "PO number": "PO-26-9002"}), AP)
    assert mapped == {"supplier": "Schmidt", "po_number": "PO-26-9002"}


def test_map_fields_collisions_get_a_stable_suffix():
    mapped = map_fields(reading(fields={"Cost center": "0400", "Cost centre": "0410"}), AP)
    assert mapped == {"cost_center": "0400", "cost_center_2": "0410"}


def test_map_fields_no_pack_normalises_every_key():
    mapped = map_fields(reading(fields={"Supplier Name": "Schmidt", "Amount (EUR)": "5.000"}))
    assert mapped == {"supplier_name": "Schmidt", "amount_eur": "5.000"}


# ------------------------------------------------ field mapping: generic pack
def test_map_fields_generic_pack_labels_and_option_labels():
    mapped = map_fields(reading(fields={"Approval route": "Line manager", "GL account": "Travel"}), EXPENSE)
    assert mapped == {"approval_route": "Line manager", "gl_account": "Travel"}


def test_map_fields_generic_pack_value_only_evidence():
    mapped = map_fields(reading(fields={"Route": "Finance review", "Account": "6300"}), EXPENSE)
    assert mapped == {"approval_route": "Finance review", "gl_account": "6300"}


# ------------------------------------------------------------------- privacy
def test_sensitive_values_are_redacted_not_emitted():
    r = reading(entity_id="inv-9", fields={
        "Supplier IBAN": "DE89 3704 0044 0532 0130 00",
        "Contact": "sabine@example.de",
        "Card": "4111 1111 1111 1111",
        "Amount": "5.000 EUR",
    })
    events = diff_events(None, r, AP)
    blob = json.dumps(events)
    for secret in ("DE89", "sabine@", "4111", "0532"):
        assert secret not in blob
    assert "[IBAN]" in blob and "[EMAIL]" in blob and "[CARD]" in blob
    assert "5.000 EUR" in blob  # a business numeral survives


def test_map_fields_redacts_every_value():
    mapped = map_fields(reading(fields={"IBAN": "DE89 3704 0044 0532 0130 00"}), AP)
    assert mapped == {"iban": "[IBAN]"}


# ------------------------------------------------------------------- actions
def test_action_from_a_click():
    prev = reading(entity_id="inv-4471", fields={"Status": "Open"})
    cur = reading(entity_id="inv-4471", fields={"Status": "Open"},
                  changes=[ScreenChange(type="clicked", description="Post invoice", field="Post")])
    events = diff_events(prev, cur, AP)
    assert {"type": "action", "name": "post", "label": "Post invoice", "case_id": "inv-4471"} in events
    assert not [e for e in events if e["type"] == "field_changed"]


def test_action_from_a_status_transition():
    prev = reading(entity_id="inv-4471", fields={"Status": "Open"})
    cur = reading(entity_id="inv-4471", fields={"Status": "Posted"})
    events = diff_events(prev, cur, AP)
    assert {"type": "field_changed", "case_id": "inv-4471", "field": "status",
            "before": "Open", "after": "Posted"} in events
    assert [e for e in events if e["type"] == "action"] == [
        {"type": "action", "name": "posted", "label": "Posted", "field": "status",
         "before": "Open", "after": "Posted", "case_id": "inv-4471"}]


def test_status_on_first_sight_is_not_an_action():
    events = diff_events(None, reading(entity_id="inv-4471", fields={"Status": "Posted"}), AP)
    assert [e for e in events if e["type"] == "action"] == []


# ------------------------------------------------------------------- identity
def test_entity_key_prefers_entity_id_then_id_token():
    assert entity_key(FrameReading(app="x", entity="invoice 4471", entity_id="INV-4471", summary="s")) == "INV-4471"
    assert entity_key(FrameReading(app="x", entity="invoice 4471", summary="s")) == "4471"
    assert entity_key(FrameReading(app="x", entity="PO-26-9002", summary="s")) == "PO-26-9002"
    assert entity_key(FrameReading(app="x", entity="Rechnung 4471", summary="s")) == "4471"
    assert entity_key(None) is None
    assert entity_key(FrameReading(app="x", summary="s")) is None
