"""LANG — any language: the expert speaks German, the tutor teaches in English.

The compiler is the only place language is allowed to enter the system: it must
keep the expert's sentence VERBATIM (`key_quote`, in German) and attach an
English `translation_en`. Everything downstream — the tutor's coaching line,
the hint ladder, the save-intercept explanation, the Work Map export — must
speak to the *trainee* in English while never losing the original.

This file is also an executable audit of the leaks. Tests that currently fail
are marked ``xfail(strict=False)`` with the exact call site and fix; when Claude
fixes one, pytest reports it as ``xpassed`` (not a failure) and the marker can
be dropped. Findings and fixes: ``design/tasks/LANG_REPORT.md``.
"""

from __future__ import annotations

import asyncio

import pytest

from shadow import coach, exports
from shadow.compiler import Compiled, CompiledRule, ThresholdStatement
from shadow.engine import Session
from shadow.packs import get_pack

PACK = get_pack("ap_invoices")

# The expert's words (German, verbatim) and the compiler's English translation.
DE = "Geräte über dreitausend netto sind immer Anlagevermögen."
EN = "Equipment over three thousand net is always capex."

# Tokens that only appear in the German original; used to prove no German reached
# a trainee-facing string. Kept narrow on purpose so stray English words don't trip it.
GERMAN_MARKERS = ("gerät", "über", "netto", "sind", "immer", "anlagevermögen", "dreitausend")


class GermanCompiler:
    """Stands in for the real `compile_answer`: German quote + `translation_en`."""

    provenance = "test stub (German expert)"

    async def __call__(self, pack, wm, inquiry, transcript, case) -> Compiled:
        if inquiry.get("field") == "cost_center" and inquiry["type"] not in ("counterfactual", "exam"):
            return Compiled(
                answers_question=True,
                key_quote=transcript,
                translation_en=EN,
                strength="always",
                rules=[CompiledRule(
                    title="Equipment over 3,000 EUR net is capex",
                    when="inv.category == 'equipment' and inv.net_eur > params.T_capex",
                    field="cost_center", value="0400", quote=transcript)],
                threshold=ThresholdStatement(param="T_capex", value=3000.0, quantity="inv.net_eur"),
            )
        return Compiled(answers_question=False, key_quote=transcript)


async def no_proposals(*_args, **_kw):
    return []


def expert_booking(s: Session, case: dict) -> dict:
    inv = PACK.derive(case)["inv"]
    center = "0400" if inv["category"] == "equipment" and inv["net_eur"] > 3600 else "4711"
    return {"cost_center": center, "tax_code": "V19"}


def german_leaks(text: str | None) -> list[str]:
    low = (text or "").lower()
    return [m for m in GERMAN_MARKERS if m in low]


async def taught_capture(sid: str = "de-capture") -> Session:
    """A German capture session that teaches one rule, the way the real loop would."""
    s = Session(sid, PACK, mode="capture", use_llm=False, proposer=no_proposals,
                compiler=GermanCompiler(), lang="de")
    await s.open_case("inv-4471")
    await s.on_decision("inv-4471", expert_booking(s, s.cases["inv-4471"]), "post")
    await s.drain()
    q = await s.tick(force=True)
    assert q is not None and q.field == "cost_center", q
    await s.on_utterance(DE)
    await s.drain()
    return s


def learned_rule(s: Session):
    return next(r for r in s.wm.rules if r.origin != "doc")


async def collect(session: Session) -> list[dict]:
    got: list[dict] = []

    async def _listener(m):
        got.append(m)

    session.listeners.add(_listener)
    return got


# --------------------------------------------------------------------------
# 1. The quote keeps BOTH the German original and the English translation.
# --------------------------------------------------------------------------
def test_capture_quote_keeps_german_original_and_english_translation():
    async def run():
        s = await taught_capture()
        rule = learned_rule(s)
        # the Work Map stores the verbatim original, its language, and the translation
        assert rule.quote.text == DE
        assert rule.quote.lang == "de"
        assert rule.quote.translation == EN
        # the snapshot the clients receive round-trips both
        snap_rule = next(r for r in s.snapshot()["map"]["rules"] if r["id"] == rule.id)
        assert snap_rule["quote"]["text"] == DE
        assert snap_rule["quote"]["translation"] == EN
        # and the learning receipt shows both, so nothing is lost in the audit trail
        rc = next(r for r in s.receipts if r["trigger"] == "answer")
        assert rc["teaching"]["quote"] == DE
        assert rc["teaching"]["translation"] == EN

    asyncio.run(run())


# --------------------------------------------------------------------------
# 2. The tutor's own voice is English: coaching line, hints, stop explanation.
# --------------------------------------------------------------------------
def test_tutor_coaching_and_intervention_speak_english():
    async def run():
        s = await taught_capture("de-for-tutor")
        t = Session("en-tutor", PACK, mode="tutor", use_llm=False, wm=s.wm, lang="en", trainee="Lena")
        got = await collect(t)

        await t.open_case("inv-5120")
        # first exposure: no worked example yet, just the coaching line
        brief = t.briefs["inv-5120"]
        prompt = t._coach_line(brief)
        assert not german_leaks(prompt), prompt

        v = await t.before_save("inv-5120", {"cost_center": "4711"}, "post")
        iv = v["intervention"]
        assert EN in iv["explain"], iv["explain"]            # uses the translation
        assert not german_leaks(iv["explain"]), iv["explain"]
        assert not german_leaks(iv["say"]), iv["say"]
        assert not german_leaks(iv["hint"]["text"]), iv["hint"]["text"]
        assert iv["hint"]["quote"] is None                    # level 1 reveals no words

        # level 3 is where the expert's words are quoted: they must be English
        hint3 = coach.hint_ladder(t.wm, PACK, t.cases["inv-5120"], {"cost_center": "4711"}, "post", 3)
        assert hint3["quote"] == EN
        assert not german_leaks(hint3["text"]), hint3["text"]

        # every trainee-facing string the tutor emitted is English (the raw payload
        # may carry the German original as data beside the translation — that is wanted)
        assert [m for m in got if m["type"] == "tutor_case"]
        assert [m for m in got if m["type"] == "intervene"]
        for m in got:
            if m["type"] == "tutor_case":
                assert not german_leaks(m["prompt"]), m["prompt"]
                assert not german_leaks((m["brief"].get("focus") or {}).get("title")), m["brief"]
            elif m["type"] == "intervene":
                iv2 = m["intervention"]
                for field in ("say", "explain", "hint"):
                    assert not german_leaks(str(iv2[field])), iv2[field]
            elif m["type"] == "nudge":
                assert not german_leaks(m["text"]), m["text"]

    asyncio.run(run())


# --------------------------------------------------------------------------
# 3. The raw intervention payload keeps the original beside the translation.
# --------------------------------------------------------------------------
def test_intervention_payload_keeps_original_beside_translation():
    async def run():
        s = await taught_capture("de-payload")
        t = Session("en-tutor-2", PACK, mode="tutor", use_llm=False, wm=s.wm, lang="en", trainee="Lena")
        await t.open_case("inv-5120")
        v = await t.before_save("inv-5120", {"cost_center": "4711"}, "post")
        quote = v["intervention"]["violation"]["quote"]
        assert quote["text"] == DE and quote["translation"] == EN
        # the companion renders translation || text (capture.js:941) — so the UI is safe

    asyncio.run(run())


# --------------------------------------------------------------------------
# LEAK A — Work Map export drops the German original when a translation exists.
# --------------------------------------------------------------------------
@pytest.mark.xfail(strict=False, reason=(
    "exports._quote returns `translation or text` only; the export must carry the "
    "original beside the translation. Fix in backend/shadow/exports.py::_quote."))
def test_work_map_export_shows_translation_with_original():
    async def run():
        s = await taught_capture("de-export")
        md = exports.to_markdown(s.wm)
        skill = exports.to_agent_skill(s.wm)
        assert EN in md and DE in md, md
        assert EN in skill and DE in skill, skill

    asyncio.run(run())


# --------------------------------------------------------------------------
# LEAK B — coach line crashes on a worked example: `brief["worked_example"]["quote"]`
# is already a string, but engine._coach_line treats it as a Quote dict.
# --------------------------------------------------------------------------
@pytest.mark.xfail(strict=False, reason=(
    "engine._coach_line does q.get('translation') on a string -> AttributeError as soon "
    "as a worked example is due. Fix in backend/shadow/engine.py::_coach_line."))
def test_tutor_worked_example_coach_line_uses_english():
    async def run():
        s = await taught_capture("de-worked")
        rule = learned_rule(s)
        t = Session("en-tutor-3", PACK, mode="tutor", use_llm=False, wm=s.wm, lang="en", trainee="Lena")
        # low mastery + prior exposure => a worked example is due
        t.mastery[rule.id] = {"p": 0.2, "opportunities": 1, "status": "practice", "title": rule.title}
        await t.open_case("inv-5120")
        brief = t.briefs["inv-5120"]
        assert brief["worked_example"] and brief["worked_example"]["quote"] == EN
        line = t._coach_line(brief)
        assert EN in line and not german_leaks(line), line

    asyncio.run(run())


# --------------------------------------------------------------------------
# LEAK C — a missing translation silently leaks German into the English tutor.
# `translation or text` everywhere means an untranslated quote is shown as-is.
# --------------------------------------------------------------------------
@pytest.mark.xfail(strict=False, reason=(
    "When translation_en is absent (compiler returned None), every `translation or text` "
    "site falls back to German. Fix: engine/compiler must guarantee a translation for a "
    "non-English quote, or mark the quote untranslated and have the tutor surface ask for it."))
def test_missing_translation_does_not_leak_german_into_tutor():
    async def run():
        s = await taught_capture("de-missing")
        rule = learned_rule(s)
        rule.quote.translation = None  # what a weak/failed compile produces today
        t = Session("en-tutor-4", PACK, mode="tutor", use_llm=False, wm=s.wm, lang="en", trainee="Lena")
        await t.open_case("inv-5120")
        v = await t.before_save("inv-5120", {"cost_center": "4711"}, "post")
        assert not german_leaks(v["intervention"]["explain"]), v["intervention"]["explain"]

    asyncio.run(run())


# --------------------------------------------------------------------------
# REVERSE LEAK — the German expert is asked an English question in live capture.
# engine line 811 skips `questions.polish` while phase == "live", and converse
# `_control("ask")` speaks `q.text` verbatim.
# --------------------------------------------------------------------------
@pytest.mark.xfail(strict=False, reason=(
    "Live capture questions are never put into the expert's `lang`: engine.plan_inquiry "
    "only calls questions.polish when phase != 'live', and debrief_next hard-codes English. "
    "Fix: polish/generate the question in `self.lang` for live asks too."))
def test_live_capture_question_reaches_the_german_expert_in_german():
    async def run():
        s = await taught_capture("de-ask")
        # the very question Shadow asked the German expert (capture, phase='live')
        asked = next(q for q in [*s.planner.history, *s.planner.queue] if q.status in ("asked", "answered"))
        assert german_leaks(asked.text), asked.text  # currently English

    asyncio.run(run())
