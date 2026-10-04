# VIS · vision frames → structured events — report

Task: turn a frame reading into the page's own fields (`{entity, entity_id, fields:{name:value}}`) and two
consecutive readings into engine events (`case_opened`, `field_changed`, `action`), with workflow-aware field
mapping and no raw PII. Owned files: `backend/shadow/perception.py`, new `backend/tests/test_perception.py`.
Report: this file. Nothing committed or pushed; nothing run on `:8000`.

## What I built

| File | Status | What it does |
|---|---|---|
| `backend/shadow/perception.py` | rewritten | `FrameReading` now carries `entity_id` and `fields` (mirrored with `visible_fields`); new `Reading` alias, `map_fields`, `diff_events`, `entity_key`, `safe_value`, `normalise_label`; `read_frame` takes an optional `pack` hint; every emitted value goes through `shadow.redact`. |
| `backend/tests/test_perception.py` | **new** | 22 tests, all with hand-fixed readings and packs — **no LLM, no network**: model mirroring/coercion, the full open → change → change back → new case sequence, appearing/vanishing fields, AP + generic-pack mapping (labels, option labels, spellings/synonyms), PII redaction, click/status actions, entity-key resolution. |

### Public surface (`shadow.perception`)

- `FrameReading` (alias `Reading`) — adds `entity_id: str | None` and `fields: dict[str, str]`. A
  `model_validator` keeps `fields` and `visible_fields` consistent in both directions, and before-validators
  stringify non-text values (a vision model may return `"Amount": 5000`). `visible_fields` is retained, so
  existing readers are unaffected.
- `map_fields(reading, pack=None) -> dict[str, str]` — exact name/label matches win, then a similarity score
  over labels, **option labels**, option values and a small synonym table (`centre→center`, `vat→tax`,
  `kostenstelle→cost·center`, `rechnung→invoice`, …); below the threshold the normalised label is kept.
  Collisions get a stable `_2` suffix. Values are redacted.
- `diff_events(prev, cur, pack=None) -> list[dict]` — emits `case_opened{case_id, fields}`, then, on the same
  case, `field_changed{field, before, after}` (appeared = `before:None`, vanished = `after:None`), plus
  `action{name, label, ...}` for a `ScreenChange(type="clicked")` or a status/outcome field transition. A
  status seen for the first time is not an action (actions are transitions). A first frame with no id reports
  its fields with `case_id:None`.
- `entity_key(reading)` — `entity_id`, else the id-like token in `entity` (`"Rechnung 4471"` → `"4471"`,
  `"PO-26-9002"` stays whole), else the normalised entity name.
- `safe_value(v)` — `redact()` and return the scrubbed text. Every value in `map_fields` / `diff_events`
  passes through it, so IBANs, cards, e-mails (and phones/tax ids/secret URLs, a superset) leave as
  `[IBAN]`/`[CARD]`/`[EMAIL]`/… and business numerals (`5.000 EUR`, `V19`, `PO-26-9002`) are untouched.
- `read_frame(image_b64, previous_summary, media_type="image/jpeg", *, pack=None)` — unchanged for existing
  callers; with a pack it adds the workflow's field labels to the prompt and asks for `entity_id`/`fields`.

## Acceptance — pasted output

```text
=== 1. targeted ===
......................                                                   [100%]
22 passed in 0.97s

=== 2. fixed-reading demo (open → change → change back → new case) ===
map_fields(f_open) = {'cost_center': '0400', 'tax_code': 'V19'}
frame 1 (open)           -> [{'type': 'case_opened', 'case_id': 'inv-4471', 'fields': {'cost_center': '0400', 'tax_code': 'V19'}}]
frame 2 (change)         -> [{'type': 'field_changed', 'case_id': 'inv-4471', 'field': 'cost_center', 'before': '0400', 'after': '4711'}]
frame 3 (change back)    -> [{'type': 'field_changed', 'case_id': 'inv-4471', 'field': 'cost_center', 'before': '4711', 'after': '0400'}]
frame 4 (new case)       -> [{'type': 'case_opened', 'case_id': 'inv-4472', 'fields': {'cost_center': '4720'}}]
PII frame             -> [{'type': 'case_opened', 'case_id': 'inv-9', 'fields': {'supplier_iban': '[IBAN]', 'contact': '[EMAIL]', 'card': '[CARD]', 'amount': '5.000 EUR'}}]

=== 3. full suite ===
259 passed, 4 xfailed in 4.14s
```

`python -c "import shadow.main"` and `ast.parse` on both files are clean. The full suite is unchanged apart
from the 22 new tests (previously 237 passed, 4 xfailed).

## Exact engine hook for Claude — `backend/shadow/main.py`

Replace the module-level `_last_summary` (line 208) and the `post_frame` body (lines 211–220) with the
following. It keeps the previous *reading* (not just its summary), forwards `case_opened`/`field_changed`
into `Session.on_event`, resolves vision ids to the session's real case ids, and returns the events for the
client/replay. Nothing else in `main.py` changes.

```python
_last_reading: dict[str, perception.Reading] = {}


def _resolve_vision_case(s: Any, case_id: str | None) -> str | None:
    """Vision ids ('4471', 'INV-4471') → this session's case ids ('inv-4471')."""
    if not case_id:
        return None
    if case_id in s.cases:
        return case_id
    want = perception.normalise_label(case_id)
    for cid in s.cases:
        key = perception.normalise_label(cid)
        if key == want or key.endswith("_" + want) or want.endswith("_" + key):
            return cid
    return None


@app.post("/api/sessions/{sid}/frames")
async def post_frame(sid: str, frame: Frame) -> dict[str, Any]:
    s = _session(sid)
    s.activity.screen_changed()
    if s.off_record or not llm.available():
        return {"skipped": True}
    prev = _last_reading.get(sid)
    reading = await perception.read_frame(frame.image, prev.summary if prev else None,
                                          frame.media_type, pack=s.pack)
    _last_reading[sid] = reading
    await s.on_event({"type": "vision", "reading": reading.model_dump()})

    events: list[dict[str, Any]] = []
    for event in perception.diff_events(prev, reading, pack=s.pack):
        event = dict(event)
        cid = _resolve_vision_case(s, event.get("case_id"))
        if cid:
            event["case_id"] = cid
        else:
            event.pop("case_id", None)
        events.append(event)
        if event["type"] in ("case_opened", "field_changed"):
            await s.on_event(event)   # open the case + record the field moment/trail
        # `action` is carried for the companion/replay; live learning still keys on
        # the ERP's DOM `decision` event (see the follow-up below).
    return {**reading.model_dump(), "events": events}
```

Why this shape:

- `case_opened` / `field_changed` already exist in `Session.on_event` (`engine.py:275` / `:277`), which calls
  `open_case` and appends to `dp.field_moments` + `dp.attention`/`dp.trail`. `open_case` is idempotent for a
  case whose prediction is already committed, so a DOM event and a vision event cannot double-open a case.
- `_resolve_vision_case` is the vision→engine-id bridge. Vision reads "4471" from the page; the session knows
  `inv-4471`. Unresolvable ids are dropped rather than opening a phantom case (`open_case` no-ops on unknown
  ids anyway, but dropping keeps the returned events honest).
- `read_frame(..., pack=s.pack)` is keyword-only and backward compatible; the existing call site style is
  preserved.
- The response gains an `events` key. The browser client
  (`console/src/lib/screen.ts:104`) reads only `.summary`, so this is additive.

### Optional follow-up: let a vision-only page drive learning

When there is no DOM cooperation (the "watch me do this" cold-start path), an `action` event can become a
`decision`. Inside the loop, instead of the `action` comment:

```python
if event["type"] == "action" and cid in s.cases:
    action = _match_action(s.pack.actions, event.get("name") or event.get("label") or "")
    if action:
        booking = {k: v for k, v in perception.map_fields(reading, s.pack).items()
                   if k in {f.name for f in s.pack.decision_fields}}
        await s.on_event({"type": "decision", "case_id": cid, "booking": booking, "action": action})
```

```python
def _match_action(actions: list[str], name: str) -> str | None:
    want = perception.normalise_label(name)          # 'posted' → 'posted'
    if not want:
        return None
    for action in actions:
        key = perception.normalise_label(action)     # 'post'
        if key == want or want.startswith(key) or key.startswith(want):
            return action
    return None
```

I left this out of the shipping hook deliberately: with DOM capture present it would double-count every
decision. Recommend gating it on "this session has no recent DOM decision" (or a per-session
`vision_only` flag) and only then wiring it in. Also add `_last_reading.pop(sid, None)` beside the existing
`_last_summary` cleanup at session end, since both maps are per-session and otherwise grow forever.

## Design decisions

- **Pack-aware mapping, pack-optional diffing.** `map_fields` is usable on its own (a companion could label a
  field); `diff_events(prev, cur)` without a pack still emits normalised-label events, so vision is useful
  before a workflow is known.
- **Option values/labels are the strongest generic signal.** A field titled "Posting key" showing
  "Opex – Maintenance" maps to `cost_center` because the value is one of that field's option labels — no
  domain table needed. The synonym table only widens single tokens and is deliberately small.
- **Status handling.** A status field is only an `action` when it *changes*; a first sighting of "Posted" is
  not an action. This keeps replay/companion noise down and leaves the real action to the transition.
- **Privacy is structural.** Redaction happens inside `map_fields`, so no caller can accidentally emit a raw
  value; a value that redacts to a placeholder and doesn't otherwise change emits no `field_changed`.

## Deviations / limits (honest)

1. **`action` is not fed to `Session.on_event` by the shipped hook** — the engine has no `action` event type
   (it has `decision{case_id, booking, action}`), and vision cannot yet build a trustworthy booking for every
   case. The event is emitted/returned and the exact `action→decision` bridge is documented above for Claude
   to gate.
2. **The synonym table is small and hand-written.** It covers spelling variants and the German terms most
   likely to appear in this demo; it is not a general thesaurus. A pack-level `synonyms`/`source` field on
   `DecisionFieldDef` would be the clean extension (Claude-owned `taskdef.py`).
3. **Vision id resolution is heuristic** (`_resolve_vision_case`): it matches exact ids and `_`-suffixes. A
   page that shows only a supplier name has no stable case key until the DOM event supplies one.
4. **`map_fields` may map two similarly-labelled fields to the same decision field**, producing
   `cost_center` + `cost_center_2`. That is visible and non-destructive, but the engine will only ever use
   the exact decision-field name; the `_2` variant is informational.
5. No live vision call was made (no LLM in the acceptance path and no budget spent). The `FrameReading`
   schema/prompt change is validated by construction/model tests only; a real frame read is Claude's to
   smoke-test with `pack=` once keys are set.

## Not touched

`backend/shadow/engine.py`, `backend/shadow/main.py`, `backend/shadow/store.py`, every other
`backend/shadow/**` module, `backend/shadow/static/capture.js`, `console/**`, `site/**`, `extension/**`,
`design/video/**`. Nothing committed or pushed; nothing run on `:8000`.
