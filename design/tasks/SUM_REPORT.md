# Task SUM — end-of-session tutor summary in the companion — report

Status: **done**. Owned file only; nothing committed or pushed; `:8000` never touched (the temp harness ran on
`:8001`). The server side is **not** implemented here (`engine.py` / `main.py` are Claude's) — §5 gives the exact
paste-ready hook.

## 1. Files

| file | change |
| --- | --- |
| `backend/shadow/static/capture.js` | **edited** — UI section + `onServer` wrapper only (+122 / −0; 1091 lines) |
| `design/tasks/shots/sum-finish-button.png` | **new** — the panel in tutor mode with the **Finish practice** button |
| `design/tasks/shots/sum-card.png` | **new** — the report card, with **Next case** |
| `design/tasks/shots/sum-card-no-next.png` | **new** — `next_case:null`, no Next-case button |
| `design/tasks/shots/sum-card-empty.png` | **new** — empty mastered/practice lists |
| `design/tasks/SUM_REPORT.md` | this file |

Nothing else in the repo was touched. `git diff --stat backend/shadow/static/capture.js` = **+122 −0** (additions
only). The do-not-touch list from `DEEPSEEK_COMPANION_SESSION.md` is byte-identical: `send()` semantics, the inner
`onServer()` switch, `window.shadow.beforeSave`, PII rects, activity events, `startVoice` / `voiceStatus` /
`EL_CDN` / agent ids, `ask_now` / `ask_later` / record. `tutor_summary` is handled in the **wrapper** at the bottom
(§3), not in the switch.

## 2. Client behaviour

### Finish button
A new button in the companion panel's action row (`capture.js:513`):

```html
<button class="btn accent" id="b-finish" type="button" hidden>Finish practice</button>
```

- Visible **only** for the trainee: `$("b-finish").hidden = !(SID && MODE === "tutor")` (`capture.js:614`,
  inside `renderVoice`). The expert (capture / debrief) never sees it.
- Clicking it (`capture.js:542` → `finishPractice`, `capture.js:849`) sends the contract message on the capture
  socket: `send({type:"finish_practice"})`, turns the button into "Finishing…" and shows the thinking state.
  An 8 s fallback restores the button if the socket is offline, so it can never be left stuck.
- The engine may also send the summary **on its own after the last case**; the client just renders it either way.

### The paper card
`onServer` wrapper (`capture.js:993`) routes `{"type":"tutor_summary"}` to `tutorSummary()` (`capture.js:860`):

```
Practice summary
  Lena · first try, on your own: 6 of 8
  ─────────────────────────────
  WHAT YOU'VE MASTERED
  ✓ Equipment over 3,600 net is capital expenditure        94%
  ✓ New supplier with changed bank details needs a second approval  88%
  ─────────────────────────────
  PRACTISE NEXT
  ◌ Asset number required for capex above the threshold   still shaky  47%
  ◌ Consumables under 800 net go straight to the cost center  needs practice  31%
  ◌ Foreign-currency invoices: check the ECB rate        not tried yet
  [ Next case ]  [ Close ]
```

- **"What you've mastered"** — `mastered:[{title,p}]`, rendered with `✓` and the probability as a percentage.
- **"Practise next"** — `practice:[{title,p,status}]`, rendered with `◌` and a humanised reason from `status`
  (`shaky → "still shaky"`, `practice → "needs practice"`, `not seen yet → "not tried yet"`; any other status is
  shown verbatim). `p` is optional.
- **Independent first-try score** — `independent:{ok,of}` → "first try, on your own: **6 of 8**"; when `of` is 0 it
  says "no independent tries yet".
- **Next case** — only rendered when `next_case` is non-null. It calls `window.shadowERP.open(id)` when that exists;
  otherwise it replaces the current case id inside `location.pathname` **only if the path actually contains it**,
  and never guesses a route (`openNextCase`, `capture.js:838`). If neither applies it does nothing.
- Empty lists render quiet fallback lines ("Nothing confirmed yet — keep going." / "Nothing queued — nice.").
- All titles/learner names are inserted with `textContent`, never `innerHTML` (asserted below: a title containing
  `<img onerror=…>` stays text).
- Harness hook: `window.__shadowCompanion.setSummary(m)` (`capture.js:586`), mirroring the existing `setNudge` /
  `setIntervention` / `showMe` hooks.

Design follows `design/DESIGN.md`: warm paper card, sage labels, 1px rules, `✓`/`◌` provenance marks, mono numbers,
no chart, no emoji.

## 3. Line map (capture.js)

| region | lines |
| --- | --- |
| summary-card CSS (UI section) | 463–476 |
| Finish button markup (UI section) | 513 |
| Finish click listener (UI section) | 542 |
| `setSummary` harness hook (UI section) | 586 |
| Finish visibility in `renderVoice` (UI section) | 614 |
| `pctOf` / `reasonFor` / `summaryList` / `openNextCase` / `finishPractice` / `tutorSummary` | 793–895 |
| `onServer` wrapper — `tutor_summary` route | 993 |

## 4. Acceptance checks (pasted)

Syntax (both required forms):

```
$ node --check backend/shadow/static/capture.js
$ node -e "new (require('vm').Script)(require('fs').readFileSync('backend/shadow/static/capture.js','utf8'))"
node --check OK
vm.Script OK
```

Headless-Chrome behaviour test (Chrome 154, 1200×800, real `capture.js`, real shadow DOM; temp pages in `/tmp`,
served on **:8001**). The test drives the actual socket wrapper (`window.__ws.onmessage`), not just `setSummary`:

```
TITLE: ALL PASS
PASS hook present
PASS ws captured
PASS finish hidden for the expert (capture)
PASS finish visible for the trainee (tutor)
PASS finish is a button with a label
PASS click sends finish_practice
PASS summary card rendered
PASS card titled Practice summary
PASS has both sections
PASS mastered shows ticks
PASS practice shows rings
PASS tick glyph is check
PASS ring glyph is dotted circle
PASS independent first-try score
PASS percent rendered
PASS reasons humanised
PASS finish re-enabled after summary
PASS Next case button present
PASS Next case calls shadowERP.open
PASS Close removes the card
PASS no Next case when next_case is null
PASS empty state explains itself
PASS no independent tries message
PASS title is inserted as text
PASS fallback never throws and never guesses a route
PASS nudge card replaces summary cleanly

ALL PASS
```

Generic path fallback, verified in a same-origin iframe at `/invoice/inv-1` with `shadowERP.open` removed:

```
FALLBACK PASS: path replaced /invoice/inv-9
```

No regression in the Python suite (nothing Python was changed):

```
$ cd backend && .venv/bin/python -m pytest -q
260 passed, 4 xfailed in 4.14s
```

## 5. Server side for Claude (exact integration call sites)

The contract the client already renders:

```json
{"type":"tutor_summary","t":1699999999.0,"learner":"Lena",
 "mastered":[{"title":"…","p":0.94}],
 "practice":[{"title":"…","p":0.47,"status":"shaky"}],
 "next_case":"inv-9",
 "independent":{"ok":6,"of":8}}
```

### 5.1 `backend/shadow/main.py` — let the event reach the socket (required)

`COMPANION_EVENTS` at **line 505** gates every event the capture socket sees (`push`, line 553). Add
`"tutor_summary"`:

```python
COMPANION_EVENTS = {"ended", "tutor_case", "nudge", "intervene", "highlight", "record", "mode", "ask", "learned",
                    "activity", "prediction", "silence", "inquiry", "hypotheses", "episode", "replay", "tutor_ok",
                    "teachback", "tutor_summary"}
```

`_companion_view` (line 509) already returns unknown types unchanged, and this payload is tiny — no trim branch
needed. Without this one-word change the engine can emit the summary and it will silently never arrive.

### 5.2 `backend/shadow/engine.py` — track the independent first-try score

`Session.__init__`, beside `self.tutor_attempted` at **line 137**:

```python
self.tutor_attempted: set[str] = set()
self.tutor_independent: dict[str, int] = {"ok": 0, "of": 0}   # first-try score, per session
```

`Session.before_save`, right after **line 1658** (`self.tutor_attempted.add(case_id)`; `violations` is already
computed on line 1653):

```python
first_attempt = case_id not in self.tutor_attempted
self.tutor_attempted.add(case_id)
if first_attempt:                       # only the first try is independent evidence
    self.tutor_independent["of"] += 1
    if not violations:
        self.tutor_independent["ok"] += 1
```

### 5.3 `backend/shadow/engine.py` — build and emit the summary

Add one method next to `tutor_report` (**line 1740**). It reuses the report Claude already has, so the Work Map's
`fade`/status logic stays the single source of truth:

```python
def tutor_summary(self) -> dict[str, Any]:
    """The trainee's end-of-practice report card: what is solid, what to practise next, first-try score."""
    rep = self.tutor_report()
    rules = rep["rules"]
    mastered = [{"title": r["title"], "p": r["p"]} for r in rules if r["status"] == "mastered"]
    rest = [r for r in rules if r["status"] != "mastered"]
    rest.sort(key=lambda r: (r["p"] is not None, r["p"] if r["p"] is not None else 0.0))  # unseen/weakest first
    practice = [{"title": r["title"], "p": r["p"], "status": r["status"]} for r in rest[:3]]
    return {"learner": self.trainee or self.expert,
            "mastered": mastered[:6],
            "practice": practice,
            "next_case": rep["next_case"],
            "independent": dict(self.tutor_independent)}
```

Emit on the Finish click — `Session.on_event`, insert **after the `pii_rects` branch (line 272), before the
`off_record` guard at line 273** so finishing still works off the record:

```python
if kind == "finish_practice" and self.mode == "tutor":
    await self.emit("tutor_summary", self.tutor_summary())
    return None
```

Emit after the last case — `Session.before_save`, in the `if not violations:` block (**line 1669**), right after the
`tutor_ok` emit (line 1675):

```python
await self.emit("tutor_ok", {...})                       # existing
if self.tutor_report()["next_case"] is None:             # nothing left to practise: wrap up
    await self.emit("tutor_summary", self.tutor_summary())
return {"allow": True}
```

`self.tutor_report()` already computes `unseen` from `self.tutor_attempted`, which now includes the case just saved,
so `next_case is None` means the trainee has attempted every case in the session.

## 6. Do-not-touch verification

```
$ git diff --stat backend/shadow/static/capture.js
 backend/shadow/static/capture.js | 122 +++++++++++++++++++++++++++++++++++++++
 1 file changed, 122 insertions(+)
```

All 122 lines are additions:
- summary-card CSS after `'.card q{…}'` (line 463);
- the `b-finish` button in the panel markup (line 513) and its click listener (line 542);
- `setSummary` in the `__shadowCompanion` hook (line 586);
- one line in `renderVoice` (line 614);
- the new summary block (lines 793–895);
- one line in the `onServer` wrapper (line 993).

`send()`, the inner `onServer` switch, `beforeSave`, PII rects, activity listeners, voice and record code are
untouched (`git diff` shows no deletions in those regions).

## 7. Caveats

- **The repo harness was not edited.** Task SUM owns only `capture.js`; `design/tasks/companion-harness.html` is not
  in the ownership list, so the screenshots were driven by a temporary harness in `/tmp/sum-harness.html` served
  from a temporary static server on **:8001** (never :8000; stopped after). If the canonical harness should gain the
  control, it is one line next to the existing session buttons:
  `hook.setSummary(q.get("summary") ? SAMPLE : null)` — or use the existing hook directly:
  `window.__shadowCompanion.setSummary(m)`, `setSession(sid, "tutor")`, `setPanel(true)`.
- **No Python test file was added** (the task owns only `capture.js`). §5 is the paste-ready server side; the client
  is already exercised against the real socket wrapper with the exact contract above.
- The Finish button deliberately lives in the panel, not on the card: the card appears only *after* finishing, and
  the panel is the one surface the trainee always has. `setPanel(true)` is what the screenshots show.
- No commits, no pushes, no server on :8000.
