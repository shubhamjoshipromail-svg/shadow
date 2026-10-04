# DeepSeek report — clickable screen moments on the Work Map

**Status:** done. `tsc --noEmit -p .` and `npm run build` both pass. No commits.
**Files touched (ownership):** `console/src/pages/MapPage.tsx` (modified), `console/src/components/Moment.tsx` (new).
Nothing else was edited. (While this ran, other agents had `backend/shadow/*.py` dirty in `git status`; I only read those files.)

## What it does

Every step, judgment rule and guardrail that carries a `screen_moment` now shows its moment as a real
`<button>` (`▶ mmss`, plus the entity on steps) instead of a dead span. Clicking it opens an **inline moment
panel under that row**:

- timestamp, case/entity, field (label + raw code), and the moment label/frame id if present
- the **before → after change** with provenance glyphs
- **her words** at that moment (Newsreader via `<Testimony>`)
- the **attention path** (`screen_moment.path`) as an ordered `field/panel · time` sequence
- the frame slot

Keyboard/behavior: the button is a real button (Enter/Space), `aria-expanded` + `aria-controls` are set, and
`Enter` on a focused moment opens it (verified over CDP). Only **one panel is open at a time** (single
`openMoment` state) and **Escape closes** it (verified). Design system only: hairline rules (`border-t`/
`border-l`), Mono for time/codes, Newsreader for the quote, `<Mark/>` provenance glyphs, `.ink-in` 180 ms
motion, no cards/pills/shadows/gradients.

## Fields used, and where they come from

The panel is built from the session snapshot alone; the backend was not changed.

| Panel row | Primary source | Fallback / notes |
|---|---|---|
| timestamp | `map.steps[].screen_moment.ts`, `map.rules/guardrails[].screen_moment.ts` | `mmss()` → `--:--` if null |
| case / entity | `screen_moment.entity` resolved against `snapshot.cases` (`id`, or `invoice_no`, or `inv-<no>`) → `invoice 4471 · <supplier>` | raw entity string if no case matches |
| field | `screen_moment.field` → `fieldLabel(snap, field)` + the raw field code | omitted if null |
| `frame_id` / `label` | `screen_moment.frame_id`, `screen_moment.label` | shown in the meta line when present |
| **before → after** | matched `snapshot.receipts` row (`case_id` + `field`, preferring the receipt whose `diff.added[].id` is this node): `receipt.before.value` → `receipt.after.value ?? receipt.expert_value` | then (a) literal `screen_moment.before/after` if a future snapshot carries them; (b) episode `predicted[field]` → `expert[field]`; (c) rule `node.then[field]` as after-only |
| source of the change | `receipt.before.source_title` → `receipt.after.source_title` in muted mono | — |
| **her words** | the node's own `quote` (rules/guardrails) | `receipt.teaching.quote` (+ `translation`) rebuilt as a `Quote` with `snap.expert`; for a step, a sibling rule/guardrail that shares the same moment, else any quoting node on the step |
| **attention path** | `screen_moment.path[]` → `{kind: "field"｜"panel", name, t}` | omitted when absent |
| provenance glyphs | `<Mark/>`: before = `◌` inferred (Tacet's committed guess), `§` written when the receipt's before source is a 2019 doc rule, or `▮` when it is a literal screen before/after; after = `▮` observed, or `statusProv()` of the rule for the after-only rule case | — |

### The frame

There is **no GET endpoint that serves frames** — only `POST /api/sessions/{sid}/frames` ingests a frame, and
`capture.js` keeps replay frames in the browser. So no image is invented: the slot always renders the muted
mono line `frame not kept · frames stay in the browser for privacy`, and `frame_id` (when present) is shown as
a code in the meta line. If a serving endpoint is added later, that slot is the one place to fill in.

### Honest note on before/after

`ScreenMoment` in `backend/shadow/workmap.py` declares `ts/frame_id/entity/field/label/path`. The raw
`field_changed` before/after values (`DecisionPoint.field_moments`) are dropped when the moment is built into
the Pydantic model, so the snapshot does **not** carry the literal on-screen edit today. The report's
"before → after" is therefore the committed guess → her actual value / the new rule value, taken from the
receipt (preferred) or the episode. The code reads `screen_moment.before/after` first, so if the backend ever
exposes them the panel shows the literal edit with no change here. The shared `types.ts` `ScreenMoment` is not
edited; `Moment.tsx` widens the read-only view of those two extra JSON keys locally.

## Verification

- `cd console && npx tsc --noEmit -p .` → exit 0; `npm run build` → success.
- Rendered against a **local Rehearsal session** on port **8010** (never 8000), throwaway sqlite DB, then a
  Vite dev server on 5175 — because the deployed API had no live session (`/api/sessions` empty; dead session
  ids 404, `/api/history` only returns receipts across restarts). The local run produced a v2 map with a step
  moment, a rule moment and a guardrail moment, each with a receipt-backed change and a quote.
- CDP checks (headless Chrome): 4 moment buttons rendered; opening S5 then R1 leaves exactly one panel
  (`moment-node-R1`); clicking again toggles it closed; focusing G1 and pressing Enter opens it with
  `aria-expanded="true"`; Escape closes to zero panels.
- Screenshot: `design/tasks/DEEPSEEK_MOMENTS_shot.png` — the rule `R1` moment open inside step §3
  (Code the cost center), showing the change (`§ 4711 · Opex … → ▮ 0400 · CapEx …` with both source
  titles), her quote and the `panel po` attention path.

## How to reproduce

```bash
cd backend
DATABASE_URL="sqlite:////tmp/tacet_moment_demo.db" .venv/bin/uvicorn shadow.main:app --port 8010
# POST /api/sessions {"pack":"ap_invoices","mode":"capture","fresh":true,"simulate":true,"expert":"Sabine","lang":"en"}
# POST /api/sessions/<sid>/sim/step repeatedly
cd console && SHADOW_API=http://localhost:8010 npx vite --port 5175 --strictPort
# open http://127.0.0.1:5175/app/s/<sid>/map
```
