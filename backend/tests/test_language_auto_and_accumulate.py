"""Expert language is detected, never configured; the new hire's language is a real choice; maps only grow."""

import asyncio

from fastapi.testclient import TestClient

from shadow import lang as langlib, llm, main
from shadow.engine import Session
from shadow.packs import get_pack
from shadow.store import Store
from shadow.workmap import Rule

PACK = get_pack("ap_invoices")


def test_detects_language_per_answer():
    assert langlib.detect("Geräte über dreitausend netto sind immer Anlagevermögen.") == "de"
    assert langlib.detect("Equipment over three thousand net is always capex.") == "en"
    assert langlib.detect("") == "en"


def test_capture_lang_defaults_to_auto_and_follows_the_speaker():
    s = Session("a", PACK, mode="capture", use_llm=False)
    assert s.lang == "auto" and s.expert_lang is None
    assert Session("b", PACK, mode="capture", use_llm=False, lang="de").expert_lang == "de"  # old clients still work
    snap = s.snapshot()
    assert snap["expert_lang"] is None and snap["learner_lang"] == "en"


def test_tutor_lang_is_the_learners_and_coaching_is_localised():
    class Fake:
        calls: list[str] = []

    async def run():
        t = Session("t", PACK, mode="tutor", use_llm=False, lang="de", trainee="Lena")
        assert t.learner_lang == "de" and t.expert_lang is None
        assert t.snapshot()["learner_lang"] == "de"
        t.use_llm = True

        async def fake_text(system, content, **kw):
            assert "German" in system
            return "DE:" + content
        orig = llm.text
        llm.text = fake_text
        try:
            assert (await t.to_learner("Look at the bank details.")) == "DE:Look at the bank details."
        finally:
            llm.text = orig
    asyncio.run(run())


def test_maps_accumulate_and_new_expert_starts_from_the_doc(tmp_path, monkeypatch):
    store = Store(f"sqlite:///{tmp_path}/acc.db")
    monkeypatch.setattr(main, "store", store)
    monkeypatch.setattr(llm, "available", lambda: True)
    c = TestClient(main.app)
    first = c.post("/api/sessions", json={"mode": "capture", "expert": "Maya"}).json()
    assert first["map_source"]["kind"] == "seed"  # brand-new expert: the written process
    s = main.sessions[first["id"]]
    s.wm.rules.append(Rule(id="r-x", title="Learned thing", when="inv.net_eur > 1", then={"cost_center": "0400"}, origin="expert"))
    s.wm.version = 5
    s._save_map()
    again = c.post("/api/sessions", json={"mode": "capture", "expert": "Maya", "fresh": True}).json()
    assert again["map_source"]["kind"] == "saved" and again["map_source"]["version"] == 5
    assert any(r["id"] == "r-x" for r in again["map"]["rules"])
    other = c.post("/api/sessions", json={"mode": "capture", "expert": "Noor"}).json()
    assert other["map_source"]["kind"] == "seed" and not any(r["id"] == "r-x" for r in other["map"]["rules"])
    exp = c.get(f"/api/workflows/{PACK.id}/experts").json()
    assert [(e["expert"], e["version"], e["rules"]) for e in exp if e["expert"] == "Maya"] == [("Maya", 5, 1)]
