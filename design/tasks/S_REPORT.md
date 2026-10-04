# Task S — STUCK + SHOW ME (learner guide mode) — report

Status: **done**. Owned files only; nothing committed or pushed; `:8000` never touched.
All acceptance checks run (below). One temporary helper harness lived in `/tmp`; the repo harness was
deliberately **not** edited (it is not in this task's ownership list) — see *Caveats*.

## Files

| file | change |
| --- | --- |
| `backend/shadow/stuck.py` | **new** — pure `StuckDetector` (336 lines) |
| `backend/tests/test_stuck.py` | **new** — 29 tests (300 lines) |
| `backend/shadow/static/capture.js` | UI section + the `onServer` wrapper only (+162 / −2; 971 lines) |
| `design/tasks/shots/stuck-*.png` | **new** — 7 screenshots |
| `design/tasks/S_REPORT.md` | this file |

No other repo file was touched. `git diff --stat` on `capture.js` is `+162 −2`; the do-not-touch list
from `DEEPSEEK_COMPANION_SESSION.md` (`send()` semantics, the `onServer` switch, `window.shadow.beforeSave`,
PII rects, activity events, `startVoice`/`voiceStatus`/`EL_CDN`/agent ids, `ask_now`/`ask_later`/record) is
byte-identical.

## 1. `stuck.py` — behavioural stuck detection

`StuckDetector` is fed events with a `type` and `t` (`observe(event)` → `None`), keyed per case by
`case_id`; `case_opened` resets that case. `score(now, case_id=None)` returns

```python
{"stuck": bool, "level": 0..4, "level_name": str, "reasons": [...],
 "case_id": str, "elapsed": float, "since_field_change": float, "counts": {...}}
```

`level` is the **strongest rung any one signal reached**, so each signal is independently testable and a
single miss can never jump the ladder. `reasons` names the signals that fired in a fixed order.

Signals → rungs (thresholds are module constants, overridable per instance):

| signal | detection | rung |
| --- | --- | --- |
| long hesitation, no field change | `now − last_field ≥ 20s` **and** no key/scroll/mouse for `8s` | 1 (cue) |
| | `≥ 45s` | 2 (question) |
| | `≥ 90s` | 4 (show me) |
| oscillation | same field returns to its value two changes ago, ≥ 2 times (`A→B→A→B`) | 2 |
| reopening a panel | same panel opened ≥ 3 times | 2 |
| undo | `after == an earlier before` on that field | 1 |
| blocked saves | 1 / ≥ 2 / ≥ 4 | 1 / 3 (highlight) / 4 |
| explicit help (`{type:"help"}`) | sticky until the case changes | 4 |

Nothing else is read: no booking, no answer grading. The `since_input` guard is deliberate — a trainee
typing or scrolling is working, not stuck, even if no `change` event has landed yet.

`backend/tests/test_stuck.py` (29 tests) pins every signal, the level boundaries, reason order, per-case
isolation, `reset()`, unknown/missing-timestamp events, and two anti-over-trigger runs (a fast expert and a
slow-but-typing one) that stay silent throughout.

## 2. Client contract (engine already emits part of it)

The engine already has the contract in place (Claude's work): `engine.py:1620-1624` emits

```python
await self.emit("nudge", {"case_id":…, "level": 3, "look": [names…], "text": …})
```

and `engine.py:1655` puts `show_me` on the intervention (`ScreenMoment.path`, i.e. the expert's attention
trail as `[{"kind":"panel"|"field","name":str,"t":float}]`). `main.py:420` already lists `"nudge"` in
`COMPANION_EVENTS`, so it reaches the capture socket. The companion now renders that exact contract:

- **level 0** clears; **level 1** is only a soft paper dot on the portrait (`.nbadge`, `#w.nudged`);
- **level 2** a quiet paper card with the engine's question and one dismiss button;
- **level 3** the card plus "Look at: …" and `window.shadowERP.highlight(name)` for each `look` item
  (falling back to clicking `[data-shadow-panel="<name>"]` to open a panel);
- **level 4** the card headed "Let's walk through it".

`overlay()` adds a **Show me** button whenever `intervention.show_me` is a non-empty list. It calls
`replayPath()`, which walks the steps in order ~900 ms apart, highlighting a field or opening a panel in
the trainee's own screen, with a caption `"<expert> looked at the <label>…"` (`lowerFirst` keeps acronyms
intact). **No value is ever filled in** — only highlight and panel-open. The engine's other intervention
button ("Show me how Sabine did it", the server-side `replay_request`) is unchanged.

A quiet **"I'm stuck"** link sits at the bottom of the panel (`#b-stuck`) and sends `{type:"help"}` — the
one signal the trainee can give explicitly.

Harness hook additions (no server needed): `setNudge(level, text, look)`, `setIntervention(iv)`,
`showMe(steps)`.

## 3. Engine hook Claude should add (not implemented here — `engine.py` is not mine)

```python
# engine.py, imports
from shadow.stuck import StuckDetector

# Session.__init__, next to self.activity = ActivityTracker()
self.stuck = StuckDetector()

# Session.on_event, at the top (beside the existing input/speech branches)
if kind in ("case_opened", "field_changed", "panel_opened", "input", "help"):
    self.stuck.observe({**evt, "t": self.now()})

# Session.before_save, when it returns {"allow": False, ...}
self.stuck.observe({"type": "save_blocked", "case_id": case_id, "t": self.now()})

# wherever the loop already polls a pause/idle cadence (or on each event)
s = self.stuck.score(self.now(), self.current_case)
if s["stuck"] and s["level"] > self.stuck.last_nudged:
    await self.emit("nudge", {"case_id": s["case_id"], "level": s["level"],
                              "text": <engine words for reasons + Work Map>,
                              "look": <field/panel names, e.g. from the map's screen moments>})
    self.stuck.last_nudged = s["level"]
```

`self.stuck.last_nudged` is reset by `case_opened`, and `StuckDetector.reset()` is available for session
teardown. The words stay the engine's job (the existing level-3 nudge text is a good template).

## 4. Acceptance checks (pasted)

```
$ cd backend && .venv/bin/python -m pytest tests/test_stuck.py -q
.............................                                            [100%]
29 passed in 0.04s

$ cd backend && .venv/bin/python -m pytest -q
........................................................................ [ 36%]
........................................................................ [ 73%]
.....................................................                    [100%]
197 passed in 3.29s

$ node -e "new (require('vm').Script)(require('fs').readFileSync('backend/shadow/static/capture.js','utf8'))"
# ok
$ node --check backend/shadow/static/capture.js
# ok
```

Real-browser assertions (headless Chrome 154, the served `capture.js`, shadow DOM inspected, `--dump-dom`):

```
TITLE: ALL PASS
PASS hook present
PASS shadow root present
PASS cue adds the nudged class
PASS cue has no card
PASS question renders a card
PASS question text is shown
PASS question is not a cue badge
PASS highlight calls the ERP
PASS highlight outlines the field
PASS look line names the field
PASS explain renders
PASS level 0 clears the card
PASS stop card has a Show me button
PASS stop card keeps Got it
PASS show me opens the first panel
PASS show me writes a caption
PASS I'm stuck sends help
PASS no value is auto-filled
```

The browser run caught a real bug the unit tests could not: `humanName("po")` returned the raw slug
`po` instead of the panel's visible label, so the caption read "looked at the po…". Fixed to prefer the
panel's text (and the field's `aria-label`/`<label>`) — that is the one follow-up edit after the first
screenshot pass.

## 5. Screenshots (headless Chrome 154, 1200×800)

| state | file |
| --- | --- |
| level 1 — soft badge only | `design/tasks/shots/stuck-cue.png` |
| level 2 — Socratic question card | `design/tasks/shots/stuck-question.png` |
| level 3 — question + "Look at: Cost center" + highlighted field | `design/tasks/shots/stuck-highlight.png` |
| level 4 — "Let's walk through it" | `design/tasks/shots/stuck-explain.png` |
| panel with the "I'm stuck" link | `design/tasks/shots/stuck-panel.png` |
| stop card with the **Show me** button | `design/tasks/shots/stuck-showme-card.png` |
| replay mid-path — PO panel open, asset number highlighted, caption | `design/tasks/shots/stuck-showme-replay.png` |

## Caveats

- **The repo harness was not edited.** Task S owns only the three files above; `design/tasks/companion-harness.html`
  is not among them, so the screenshots were driven by a temporary harness in `/tmp/stuck-harness.html` served
  from a temporary static server on **:8001** (never :8000; stopped after). It loads the real
  `backend/shadow/static/capture.js`, defines `window.shadowERP.highlight`, and calls
  `window.__shadowCompanion.setNudge/setIntervention/showMe`. If a reviewer wants the canonical harness to gain
  the controls, the three hook calls are `setNudge(level, text, look)`, `setIntervention(iv)` and
  `showMe(steps)` — a two-line addition per state next to the existing session buttons.
- The one engine change needed (wire `StuckDetector` into `Session.on_event` / `before_save` and emit the
  levels) is described exactly in §3; I did not edit `engine.py`/`main.py`/`store.py`.
- The engine already emits a level-3 `nudge` and `show_me` on interventions; the companion is compatible
  with that today. The detector adds levels 1/2/4 and the blocked-save / help / oscillation / panel-reopen
  signals on top.
- No commits, no pushes, no server on :8000.
