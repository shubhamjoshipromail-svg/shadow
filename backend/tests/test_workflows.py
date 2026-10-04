"""Workflow identity: the same job is recognised; a new one is offered onboarding; learned ones survive restarts."""

from shadow import workflows as wf
from shadow.packs import _REGISTRY, add_loader, get_pack
from shadow.store import Store
from shadow.taskdef import load_example

INVOICE = wf.signature("https://erp.example.com/invoice/inv-4471", ["cost_center", "tax_code", "payment_timing"],
                       ["post", "hold"])
KNOWN = [{"id": "ap_invoices", "name": "AP", "signature": INVOICE},
         {"id": "tickets", "name": "Tickets", "signature": wf.signature(
             "https://desk.example.com/ticket/88", ["priority", "team", "sla_breached"], ["escalate", "resolve"])}]


def test_path_pattern_collapses_ids():
    assert wf.path_pattern("https://erp.example.com/invoice/inv-5120?x=1") == ("https://erp.example.com", "/invoice/:id")


def test_same_page_other_case_is_the_same_workflow():
    page = wf.signature("https://erp.example.com/invoice/inv-9999", ["cost_center", "tax_code", "payment_timing"])
    assert wf.match(page, KNOWN)["verdict"] == "same"


def test_new_form_elsewhere_is_new_and_partial_overlap_asks():
    new = wf.signature("https://hr.example.com/leave/3", ["days", "manager", "reason"])
    assert wf.match(new, KNOWN)["verdict"] == "new"
    partial = wf.signature("https://erp.example.com/credit-note/7", ["cost_center", "tax_code", "reason_code"])
    assert wf.match(partial, KNOWN)["verdict"] == "ask"


def test_two_workflows_with_the_same_controls_need_the_human():
    known = [{"id": "one", "name": "Route tickets", "signature": INVOICE},
             {"id": "two", "name": "Audit tickets", "signature": INVOICE}]
    assert wf.match(INVOICE, known)["verdict"] == "ask"


def test_learned_workflow_survives_a_restart(tmp_path):
    store = Store(f"sqlite:///{tmp_path}/s.db")
    task = load_example("expense_approval").model_copy(update={"id": "expense_learned"})
    v1 = store.save_workflow(task.id, "nordwerk", task.name, task.model_dump(mode="json"), INVOICE)
    v2 = store.save_workflow(task.id, "nordwerk", task.name, task.model_dump(mode="json"), INVOICE)
    assert (v1, v2) == (1, 2)
    _REGISTRY.pop("expense_learned", None)  # a fresh process: nothing in memory
    add_loader(lambda pid: (store.workflow(pid) or {}).get("definition"))
    assert get_pack("expense_learned").id == "expense_learned"
