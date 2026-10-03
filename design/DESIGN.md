# Shadow design system

One register across the console, Work Map, sealed test, landing page and the in-app companion: **the knowledge
document**. Warm paper, ink, one sage accent. Derived from DeepSeek's Direction B (`design/shadow-v3/DIRECTIONS.md`)
with A's rigor and Codex's companion palette (`advisory/companion-design-2026-10-03/`). Tokens live in
`console/src/index.css`; primitives in `console/src/components/ui.tsx`.

## Type
| Voice | Font | Used for |
|---|---|---|
| Testimony | Newsreader (serif) | the expert's words, page titles. Nothing else is serif. |
| Interface | Geist | labels, buttons, body |
| Evidence | IBM Plex Mono | codes, amounts, ids, timestamps, hashes, section labels |

## Color
Paper `#f4f1ea`, sheet `#fbf9f4`, rules `#e2ddd2` / `#cbc4b5`, ink `#22201c` / `#6b665d` / `#9a9488`.
Provenance inks: observed = ink, inferred `#56677c`, confirmed `#4e6b44` (sage), binding/contested `#a2412e` (brick),
query `#8f6420` (ochre), candidate `#6f5a7e`, written process `#8a8378`.

## Provenance (never hue alone)
`▮` observed · `◌` inferred · `✓` confirmed · `■` binding · `✗` contested · `?` query · `§` written process.
Use `<Mark state>` / `<BeliefBadge>`; a component never colors a claim by itself.

## Laws
1. The expert's work is the stage; Shadow annotates.
2. Separation by 1px rules and surface value. Radius ≤ 4px (the companion and ERP keep their own).
3. Guardrails are structural: a plate with a 3px brick left rule, never a chip.
4. Uncertainty is an interval or a curve drawn in hairline, never a shimmer.
5. Motion terminates (≤ 240ms): ink-in, rule-draw, stamp. One loop only: the capture indicator.
6. Refused: gradients, glow, glass, neon, sparkles, brain imagery, chat bubbles, emoji, decorative icons,
   card soup, fill bars, "AI" badges.
