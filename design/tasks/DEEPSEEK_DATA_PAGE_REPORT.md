# Report: "What was collected" page (console)

Task: `design/tasks/DEEPSEEK_DATA_PAGE.md` · Owner: DeepSeek (headless) · Status: done, not committed.

## Deliverable
- `console/src/pages/DataPage.tsx` (360 lines, default export `DataPage`). Nothing else was created or edited.
- Acceptance: `cd console && npx tsc -b --noEmit` → **exit 0**. `npx oxlint src/pages/DataPage.tsx` → clean.
- Route and links are Claude's to add (see integration note). The console already links to `/s/:sid/data` in
  `Console.tsx`; the route is not registered yet.

## What the page does
A single document column (`max-w-[900px]`, `.panel` sheet, flush `Section`s inside it — no cards-in-cards),
header bar like `MapPage` (`← session`, `Wordmark`, plus `database · redaction <state>` on the right).

1. **Title** — serif `.testimony` "What was collected", labelled `Data inventory · session <sid>`.
2. **Lead** — two sentences: what is stored for this session, where it lives, who else can reach it.
3. **Where it lives** — `locations` as a ruled `divide-y` grid; `where` in medium ink-1, `what` in ink-2.
4. **Never collected** — `never` as plain `—` bullets (no `✗`, no icons).
5. **The ledger** — three ruled `<table>`s (Decisions / Explanations / New-hire attempts), newest five each:
   - Decisions: source mark, `case_id`, one mono line per surprising field `field  guess → actual` with the
     guess struck through when it differs from the answer, then `via · map vN · written before|scored after`.
   - Explanations: `question_type · field`, the question, the transcript rendered through `Testimony`
     (serif, attributed to the row's `expert`), and redaction kinds as small mono tags `[IBAN]`. The row's map
     versions and `status` sit in the last column.
   - New-hire attempts: `learner`, `case_id`, `action` with `✓ allowed` / `■ blocked`, `independent attempt`
     vs `assisted`, and any violation titles.
6. **Counts** — per-table `live / rehearsal` split (via `Split`), `maps` version count, and events by type as a
   compact mono list sorted by count.
7. **Empty states** — each table falls back to an explanatory line (e.g. "No decisions yet. Each one appears
   here as soon as the expert saves a case."), and the placeholder line covers the pre-fetch state.

## Data mapping and defensiveness
Types are local to the file (`Inventory`, `DecisionRow`, `ExplanationRow`, `AttemptRow`) since `types.ts` is
off-limits; every column the endpoint may omit is optional, so a sparse row degrades to `—` rather than throwing.
`source` is shown as a `<Mark>` (`observed` `▮ live` / `inferred` `◌ rehearsal`) plus a UTC stamp derived from
`created` (`title="UTC"`). `predicted`, `actual`, `surprises`, `redactions` and `violations` are all treated as
possibly missing. Redaction tags uppercase the kind (`iban → [IBAN]`).

## Design-token compliance
Only `index.css` tokens/classes: `text-ink-1/2/3`, `border-rule`, `border-rule-strong`, `text-confirmed`,
`text-binding`, `text-ink-3`, `bg-paper`, `bg-sheet`, `.panel`, `.label`, `.num`, `.testimony` (via `Testimony`),
`divide-rule`. Radius only from `.panel` (4px). No lucide icons, no pills, no gradients, no colored claims.
Primitives used: `Section` (flush), `Mark`, `Wordmark`, `Testimony`. `Btn` is not used — the page is read-only
and has no actions.

## Judgment calls
- **Counts after the ledger**, in the order the task lists its items (3 → 6). Nothing is a dashboard strip at
  the top; the document reads top to bottom and totals close it.
- **Transcript, not `quote`.** The endpoint rows carry both; the task says the transcript is the serif answer, so
  the row's `quote` field is intentionally unused. `Testimony` gets a minimal synthetic `Quote` (`ts: null`,
  no translation) because the ledger has no `inquiry_id`/lang on the row.
- **Redaction shown in the header**, not repeated per row; tags appear only when a row has redactions.
- Violations are shown as titles when the JSON objects carry them, otherwise the count is omitted (the endpoint
  shape is unspecified beyond `violations []`).

## Integration note for Claude
Register `DataPage` in `src/main.tsx` (`<Route path="/s/:sid/data" element={<DataPage />} />`) and add whatever
links you want; `Console.tsx` already points at `/s/:sid/data`. Nothing else is needed — the page fetches
`/api/data/inventory?session=<sid>` on mount and on `sid` change. File ownership respected: only
`console/src/pages/DataPage.tsx` and this report were written; no commits, pushes, servers, or other edits.
