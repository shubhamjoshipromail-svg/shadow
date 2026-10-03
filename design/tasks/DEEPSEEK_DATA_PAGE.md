# Task: "What was collected" page in the notebook (console)

Owner: DeepSeek (headless). Reviewer/integrator: Claude. Do not commit or push.
Read first: `design/DESIGN.md`, `console/src/index.css`, `console/src/components/ui.tsx` (use these primitives:
`Section`, `Mark`, `Wordmark`, `Btn`, `Testimony`), and `console/src/pages/MapPage.tsx` for the page pattern.

## File you may create
`console/src/pages/DataPage.tsx` (default export `DataPage`). Nothing else: Claude adds the route `/s/:sid/data` and
the links. Do not edit `ui.tsx`, `index.css`, `types.ts`, or other pages.

## Data
`GET /api/data/inventory?session=<sid>` (use `api()` from `../lib/api`). Shape:
```ts
{ database: string,
  counts: { decisions: Record<'live'|'rehearsal', number>, explanations: {...}, learner_attempts: {...},
            events: Record<string, number>, maps: { versions: number } },
  samples: { decisions: Row[], explanations: Row[], learner_attempts: Row[] },   // newest 5 each, for this session
  locations: { where: string, what: string }[],
  never: string[],
  redaction: 'on' | 'not installed' }
```
Rows carry `session_id, workspace, workflow, expert, source ('live'|'rehearsal'), created (epoch s)` plus:
- decisions: `case_id, via, predicted{field:value}, actual{field:value}, prospective (bool), surprises string[], predicted_map_version`
- explanations: `question_type, question, field, transcript, quote, redactions string[]|null, status, map_version_before, map_version_after`
- learner_attempts: `learner, case_id, action, allowed (bool), independent (bool), violations []`

## Page (a plain, honest document — not a dashboard)
1. Header bar like MapPage (← session, Wordmark). Title in serif: "What was collected".
2. Lead paragraph: one or two sentences: everything below is what this product has stored about this session, where it
   lives, and who else sees it.
3. "Where it lives": the `locations` as a ruled list (where in medium weight, what in ink-2).
4. "Never collected": the `never` list with `✗`-free wording (plain bullets with `—`).
5. "The ledger": three ruled tables (decisions, explanations, new-hire attempts) showing the samples. Each row shows the
   source as a mark (`▮ live` / `◌ rehearsal`), and the labelled fields in mono. For decisions show
   `guess → actual` per surprising field, struck guess when wrong. For explanations show the question, then the
   transcript as Testimony-like serif (it is already scrubbed), and redaction kinds as small mono tags like `[IBAN]`.
6. Counts strip: totals per table split live/rehearsal; events by type in a compact mono list.
7. Empty states that explain, e.g. "No decisions yet. Each one appears here as soon as the expert saves a case."
Use only design tokens (`text-ink-1/2/3`, `border-rule`, `text-confirmed`, `text-binding`, `text-inferred`…). Radius ≤ 4px.
No icons from lucide, no cards-in-cards, no colored pills.

## Acceptance
- `cd console && npx tsc -b --noEmit` passes.
- Write `design/tasks/DEEPSEEK_DATA_PAGE_REPORT.md`.
