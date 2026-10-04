# LANG report — any language: German expert, English tutor

**Task:** LANG (stretch) in `design/tasks/QUEUE_2026-10-04c.md`.
**Owned file written:** `backend/tests/test_language.py` (new). No other file touched.
`engine.py`, `main.py`, `store.py` were read only. Nothing committed or pushed. Nothing run on `:8000`.

## What the test does

`backend/tests/test_language.py` builds a real capture `Session(lang="de")` with a stub compiler
(`GermanCompiler`) that returns the expert's sentence verbatim (`key_quote`, German) plus
`translation_en` (English), exactly the shape `compiler.Compiled` defines. It then opens a
`mode="tutor"` session on the learned map, drives a wrong save, and checks every trainee-facing
surface.

German original used in the test (a realistic compiler output):

```
DE = "Geräte über dreitausend netto sind immer Anlagevermögen."
EN = "Equipment over three thousand net is always capex."
```

## Acceptance check

```
$ cd backend && .venv/bin/pytest tests/test_language.py -v
tests/test_language.py::test_capture_quote_keeps_german_original_and_english_translation PASSED
tests/test_language.py::test_tutor_coaching_and_intervention_speak_english PASSED
tests/test_language.py::test_intervention_payload_keeps_original_beside_translation PASSED
tests/test_language.py::test_work_map_export_shows_translation_with_original XFAIL
tests/test_language.py::test_tutor_worked_example_coach_line_uses_english XFAIL
tests/test_language.py::test_missing_translation_does_not_leak_german_into_tutor XFAIL
tests/test_language.py::test_live_capture_question_reaches_the_german_expert_in_german XFAIL
========================= 3 passed, 4 xfailed in 3.46s =========================
```

Full suite (no regressions, the 4 xfails are this file's documented leaks):

```
$ cd backend && .venv/bin/pytest -q
237 passed, 4 xfailed in 17.12s
```

The four `xfail(strict=False)` markers are the leaks below. When Claude fixes one it turns into
`xpassed` (not a failure), and the marker can be deleted.

## Already correct (asserted, passing)

| Surface | Where | Behaviour |
|---|---|---|
| Storage | `engine.py:942` `Quote(text=…, lang=self.lang, translation=compiled.translation_en)` | German original + language + English translation all kept |
| Snapshot/API | `engine.snapshot()` → `wm.model_dump()`; `main.py` `_companion_view` passes `quote` through | both fields reach the client |
| Receipt | `engine.py:1006` `rc["teaching"].update(quote=…, translation=…)` | audit trail keeps both |
| Coach line / worked example | `coach.py:315` `quote.translation or quote.text` | English |
| Hint ladder | `coach.py:351`, `coach.py:366` | English |
| Save intercept | `engine.py:1693` `viol.quote.translation or viol.quote.text` | explanation is English |
| Tutor conversation | `converse.py:154` `n.quote.translation or n.quote.text` | English rules for the tutor LLM |
| Companion | `static/capture.js:941` `translation || text` | renders English, original kept in payload |

## Leaks and missing translations — exact fix for Claude

### A. Work Map export throws the German original away — `backend/shadow/exports.py:11`

`_quote()` returns `translation or text` only, so `to_markdown` and `to_agent_skill` (both use
`_quote`) show the English line and drop the verbatim German. The requirement is *translation with
the original*.

Fix:

```python
def _quote(n) -> str:
    if not n.quote:
        return ""
    q = n.quote.translation or n.quote.text
    ts = f" at {_mmss(n.quote.ts)}" if n.quote.ts is not None else ""
    if n.quote.translation and n.quote.translation != n.quote.text:
        return f' — “{q}” (original: “{n.quote.text}”, {n.quote.speaker}{ts})'
    return f' — “{q}” ({n.quote.speaker}{ts})'
```

(`to_json` already carries both through `model_dump()`.) Test:
`test_work_map_export_shows_translation_with_original`.

### B. `_coach_line` crashes when a worked example is due — `backend/shadow/engine.py:1643`

`coach._worked_example()` returns `"quote"` as an already-resolved **string**
(`coach.py:315`), but `_coach_line` treats it as a `Quote` dict:

```python
ex = brief.get("worked_example")
if ex and ex.get("quote"):
    q = ex["quote"]
    line += f" Remember, {self.expert} said: “{q.get('translation') or q.get('text')}”"  # AttributeError
```

Today this raises `AttributeError: 'str' object has no attribute 'get'` the first time a worked
example is shown (low mastery + one prior miss), i.e. exactly the German-expert case the test
drives.

Fix:

```python
ex = brief.get("worked_example")
if ex and ex.get("quote"):
    line += f" Remember, {self.expert} said: “{ex['quote']}”"
```

The string is already `translation or text` (English). Test:
`test_tutor_worked_example_coach_line_uses_english`.

### C. Missing `translation_en` silently leaks German into the English tutor

Every display site uses `translation or text`, so a compile that returns `translation_en=None`
(the model forgot, or the answer was vague) makes the English tutor quote German. Sites:
`engine.py:1645`, `engine.py:1693`, `coach.py:315`, `coach.py:351`, `coach.py:366`,
`converse.py:154`, `exports.py:14`.

Two-part fix (engine owns it, `workmap.py`/`compiler.py` are free to change):

1. Centralise the fallback so the behaviour is one decision, not seven. Add to `Quote`
   (`backend/shadow/workmap.py:33`):

   ```python
   def english(self) -> str | None:
       """The line a trainee/agent sees, or None when we must not show the original."""
       return self.translation or (self.text if self.lang in ("en", None) else None)
   ```

   then replace each `quote.translation or quote.text` with `quote.english()`.

2. Guarantee a translation at compile time. In `backend/shadow/compiler.py`,
   `Compiled.translation_en` should be required whenever the quote is not English. Cheapest exact
   change is in `engine.learn_from_answer` right after `compiled = await self.compiler(...)`
   (`engine.py:916`):

   ```python
   if compiled.key_quote and compiled.translation_en is None and self.lang not in ("en", None):
       try:
           compiled.translation_en = (await llm.text(
               f"Translate this {self.lang} sentence to English. Reply with the translation only.",
               compiled.key_quote, max_tokens=200)).strip() or None
       except Exception:
           log.warning("quote translation failed; leaving the original")
   ```

   and have the tutor surfaces use `quote.english()`; when it is `None` they show the original
   *labelled as untranslated* rather than pretending it is English.

Test: `test_missing_translation_does_not_leak_german_into_tutor`.

### D. Per-rule quote loses its translation (mismatch) — `backend/shadow/engine.py:962`

```python
own = quote.model_copy(update={"text": cr.quote}) if cr.quote and cr.quote.strip() else quote
```

When the compiler emits a per-rule `CompiledRule.quote`, the node's `text` becomes that sentence
but `translation` stays the **key_quote's** English line — so the "translation" no longer
translates the text beside it. Fix one of:

- add `quote_translation_en: str | None` to `CompiledRule` (`compiler.py:28`) and set both:
  `own = Quote(text=cr.quote, translation=cr.quote_translation_en, lang=self.lang, speaker=self.expert, ts=self.now(), inquiry_id=q.id)`;
  or
- if there is no per-rule translation, clear the inherited one:
  `own = quote.model_copy(update={"text": cr.quote, "translation": None})` and let fix C fill it in.

### E. Live capture questions are English even for a German expert — `backend/shadow/engine.py:811`

`questions.template()` builds English; `questions.polish(text, self.lang)` is the only translation
step and the engine skips it in live capture:

```python
if self.use_llm and phase != "live":
    chosen.text = await questions.polish(chosen.text, self.lang)
```

`converse._control("ask")` then speaks `q.text` verbatim (`converse.py:104`). So the German expert
is interviewed in English. Also fixed English strings the expert hears: debrief acknowledgements
(`converse.py:92`), `debrief_next` transitions (`engine.py:1488`, `1500`, `1502`), and the
teach-back prompt/ending (`engine.py:1527`, `1531`).

Fix: drop the `phase != "live"` restriction (or generate the template directly in `self.lang`),
and route the fixed strings through a small `_say(key, lang)` table / `questions.polish`.

Also in `questions.polish` (`questions.py:159`):

```python
target = "German" if lang == "de" else "English"
```

only knows German. Make it generic, e.g. `target = {"de": "German", "fr": "French", "es": "Spanish"}.get(lang, "English")` or pass the language name straight into the prompt.

Test: `test_live_capture_question_reaches_the_german_expert_in_german`.

### F. Rule titles have no translation field — `backend/shadow/compiler.py:19`

The compiler prompt asks for `CompiledRule.title` "in plain English", but nothing enforces it, and
the title is used verbatim by the English tutor (`coach.brief` titles, `_why`, `hint_ladder`
`title`, `_maybe_nudge` focus). A German-answering model can put German in `title`. Fix: add
`title_en: str | None` (or reject non-English titles in `compile_answer`'s validation loop,
`compiler.py:124-133`) and have `coach`/`exports` prefer `title_en`.

### G. Ledger stores the German quote with no translation — `backend/shadow/engine.py:455` + `backend/shadow/store.py:63`

`_publish_receipt` writes `"quote": receipt["teaching"].get("quote")` into the `explanations` table;
the table has no `translation` column, so `/api/history`, analytics and any re-export from the
ledger lose the English line. Fix: add `Column("translation", Text)` to the `explanations` table in
`store.py` and include `"translation": receipt["teaching"].get("translation")` in the row dict.

### H. Onboarded sessions are pinned to English — `backend/shadow/main.py:401`

`POST /api/onboard` creates `Session(..., lang="en")`. An onboarded German expert cannot set their
language. Fix: add `lang: str = "en"` to the onboard request model and pass it through.

## Integration call sites (all on Claude; LANG owns only the test)

1. `backend/tests/test_language.py` — add to the suite; remove each `xfail` marker as the matching
   fix lands (they are `strict=False`, so an early fix reports `xpassed`, never a red suite).
2. `backend/shadow/exports.py::_quote` (fix A).
3. `backend/shadow/engine.py::_coach_line` (fix B).
4. `backend/shadow/workmap.py::Quote.english` + `backend/shadow/engine.py::learn_from_answer`
   translation guard (fix C).
5. `backend/shadow/compiler.py::CompiledRule` / `engine.py:962` (fix D).
6. `backend/shadow/engine.py:811` + `debrief_next` / `build_teachback` + `questions.polish`
   (fix E).
7. `backend/shadow/compiler.py::CompiledRule` title translation (fix F).
8. `backend/shadow/store.py` `explanations.translation` + `engine._publish_receipt` (fix G).
9. `backend/shadow/main.py` onboard `lang` (fix H).

The first three (A, B, C) are the ones that break the German-expert-to-English-tutor promise; B is
also a plain crash on the worked-example path. D–H are data-fidelity / reverse-direction gaps.
