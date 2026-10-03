# Shadow v3 — Three Interface Directions

**Art direction for Capture · Work Map · Debrief · Tutor**
Prepared as a product-design/none-of-your-code document. Scope: visual language, information architecture, component system, motion. No application architecture, no backend, no production files touched.

---

## 0. What I studied

- `SHADOW_ARCHITECTURE.md` (v3) — the AI Novice, the residual, EVOI/pause gate, the executable Work Map, belief states, the three modules, the demo script, the "never cut" list.
- `SABINE_ROLE_CARD.md` — the hidden rules, the demo invoices, the new-hire invoices.
- The two real surfaces:
  - **Nordwerk ERP** (`src/`, TanStack + shadcn): light, warm-grey paper, IBM Plex Sans/Mono/Serif, 4px radii, `--shell` header, status colors, `data-shadow-*` observer hooks, save intercept.
  - **Shadow console** (`console/`, Vite + Tailwind v4 + framer-motion): dark `#070a0e`, Inter Tight / JetBrains Mono / Instrument Serif, five neon-ish semantic accents, 14px-radius panels in a three-column grid, gradient logo dot, `breathe` keyframe, framer-motion layout animation on learned nodes.

There are **no screenshot files in the repo** — I derived the "current UI" reading from source, which is more precise anyway. If you have screenshots from the demo run, they should be checked against §1, but nothing in §1 depends on them.

**Nothing in this document is an instruction to modify `src/`, `console/`, `backend/`, or `AGENTS.md`/`CLAUDE.md`.** Everything lives under `design/shadow-v3/`.

---

## 1. Reading the current UI (the art-director critique)

What is genuinely good and must survive all three directions:

1. **Belief state is already first-class.** `confirmed / stated / inferred / contested` exists in the data model and is rendered. That is rare and it is the product's soul. Keep it.
2. **Provenance chips are already adjacent to claims.** `SourceChip` puts `AI novice` / `2019 doc` / `learned R7` next to the value. The instinct is right; the execution is too quiet and too small.
3. **The Silence Log is a great idea** and it is buried as one row type inside a scrolling feed.
4. **Pre-commit + lock icon** on the prediction card communicates temporal order. Good instinct, weak evidence.
5. **The Work Map timeline with belief badges and audio quotes** is the closest thing to the product thesis on screen today.

What is working against the brief:

| Problem | Where | Why it matters |
|---|---|---|
| **Panel soup.** Capture is a 3-column grid of 12 independent bordered cards, each with its own header, all scrolling independently. | `Console.tsx` | The eye has no entry point. Nothing is primary. The expert's work is a 340px thumbnail in column 1, on par with a "Learned parameters" panel. The brief says the expert's work is primary and Shadow is a sidecar; today Shadow is the whole screen and the work is a postage stamp. |
| **Color is doing all the provenance work.** predict cyan, ask amber, learn green, hyp violet, gap red, doc grey. | `index.css`, `ui.tsx` | Five competing hues means none of them reads as a *state*. It also fails grayscale, print, and the ~8% of male viewers with CVD. Provenance must be encoded in form as well as hue. |
| **Neon-on-black reads as "AI product 2023."** Saturated cyan/amber/violet on `#070a0e` plus a `breathe` pulse and a gradient logo dot. | `index.css` | It signals the exact aesthetic the brief rules out. Premium 2026 enterprise is quieter than the AI wrapper. |
| **The question is a hero card.** 26px serif in a rounded 2xl bordered box with a breathing top bar. | `Question.tsx` | A question is a *gap in knowledge*, not a banner. Hero-ing it makes Shadow the protagonist. |
| **The voice panel is a chat transcript.** `bg-ask/10` agent bubbles, `bg-panel-2` user bubbles, uppercase speaker names, a text input with a send button. | `Console.tsx` | This is the generic chatbot layout the brief forbids. It also contradicts "Shadow is a colleague at a pause" — the UI makes it a texting buddy. |
| **Guardrails are 13px shield icons inside the same card style as rules.** | `WorkMapView.tsx` | A guardrail is a *binding constraint*. Rendered as another list item, it cannot be told apart from knowledge. It must be structurally different, not chromatically different. |
| **Confidence is rendered as percentage text + a bar.** | `Prediction.tsx`, `Threshold.tsx`, `Mastery.tsx` | Uncertainty is the product's central quantity, and today it is three unrelated widgets (a number, a fill bar, an SVG bell). It needs one visual grammar. |
| **Everything animates with framer-motion `layout`,** which reflows the column whenever a rule lands. | `WorkMapView.tsx` | Motion that moves *other* content is the cheapest way to look unstable. In an audit tool, instability reads as untrustworthiness. |

The brief's real instruction is not "make it prettier." It is: **the expert's knowledge is the artifact, the machine's guesses are visibly provisional, and the moment one becomes the other must be the most legible thing on screen.** That is the whole design problem.

---

## 2. Foundations — shared by all three directions

### 2.1 The one metaphor, made operational

> **Uncertainty resolving into verified human knowledge.**

Three directions can share a metaphor but not its *mechanics*. The mechanics that every direction must implement:

- **A guess has a body and a location.** It is not a percentage floating in a card; it is a specific claim, at a specific place in the work, with a specific origin.
- **Resolving is a transition of that same object**, under the viewer's eye, in place. It is not one panel emptying while another fills.
- **Verified knowledge is durable in material**, not just greener. When something becomes confirmed, its *rendering material* changes: a dashed rule closes, an italic sets to roman, a dotted tick solidifies, a provisional block becomes an earned block.
- **A guardrail interrupts.** It is the only state allowed to change the geometry of the layout.

### 2.2 Provenance grammar

Four states, plus one regression modifier. This vocabulary is fixed across all three directions; only its *rendering* changes.

| State | Data source | Epistemic meaning | Authority | May it interrupt? |
|---|---|---|---|---|
| **Observed** | expert action, screen moment, verbatim quote, audio ref | This happened. Ground truth of behaviour, zero generality. | Highest factual, lowest predictive | No |
| **Inferred** | AI Novice prediction, generated hypotheses, `status: inferred` nodes | The machine thinks this. Unverified, revocable, cheap. | None | No |
| **Confirmed** | `belief.status: confirmed`; survived counterfactual + replay + teach-back | Earned. Executable. The product's output. | Earned, and revocable | No |
| **Binding** | `guardrails[]` — `hard_limit`, `stop_and_ask`, `hold`, `second_approval` | A constraint, not a claim. It forbids. | Prohibitive | **Yes** |
| *Contested* | confirmed node contradicted by later behaviour | Regression. Suspended authority. | Suspended | Yes (as an alert) |

**Fixed rule:** every renderer of a claim must carry its state in at least **two independent channels** — one of {glyph, line style, texture, typographic voice} plus one of {ink weight, hue, position}. Hue alone is never sufficient.

**Fixed rule:** "observed" and "confirmed" must never be confusable. Observed = *a human did this* (attributed, timestamped, quoted). Confirmed = *Shadow can now predict this* (a rule, executable, with evidence count). These are the two ends of the pipeline and the brief asks the viewer to see the distance between them.

### 2.3 The six design laws

1. **The expert's work is the stage.** At every moment, the largest, brightest, most stable surface belongs to the human's actual task. Shadow annotates it; Shadow never replaces it.
2. **Shadow has a body, not a bubble.** One fixed locus per mode (gutter, margin, spine, inspector). No chat shapes, no avatar, no typing indicator, no message list.
3. **Provenance travels with the claim.** Within 8px and on the same baseline as the claim, always, in a fixed slot. A tooltip is an admission of failure.
4. **Uncertainty is a quantity with a shape.** An interval, a bracket, an area, a density. Never a shimmer, never "thinking."
5. **Guardrails are structural.** They own a row, a band, a plate, or a stop. They are never a chip.
6. **Motion terminates.** Never exceeds 240ms (except one sanctioned zoom at 320ms in Direction C). No bounce, no scale above 1.02, no looping animation anywhere except a single 1px capture indicator that is designed to be ignored.

### 2.4 The three moments as state transitions

These are the demo's spine. Each direction is judged on how it renders these three, in this order.

**M1 — prediction → divergence**
```
Inferred (committed, p)  ──expert acts──▶  Observed (attributed)
                    ↘ divergence is a differential: both values coexist in one place
```
Design job: make the *pre-commitment* visually undeniable (its timestamp is earlier and its position proves it), and make the divergence a **spatial** event — two values occupying one field/one moment — never a toast, never a red flash.

**M2 — question → knowledge crystallization**
```
gap (Inferred) ─▶ question ─▶ answer (Observed, verbatim) ─▶ compiled claim (Inferred) ─▶ probes (Confirmed)
```
Design job: **one object changes state in place**, four times, gaining evidence marks as it goes. No new card appears. The viewer should be able to *watch* it harden.

**M3 — learned guardrail → trainee intervention**
```
Binding rule ─▶ trainee's action (Observed, wrong) ─▶ enforced stop ─▶ expert evidence replayed (Observed) ─▶ mastery moves (Confirmed)
```
Design job: the interface must **physically stop**. The stop must read as the retiring expert's authority — attributed, quoted, replayed — not as a validation error and not as a modal dialog.

### 2.5 The anti-pattern contract (all directions sign this)

| Refused | How it is refused |
|---|---|
| Gradients | Zero, in all three. Anywhere a gradient is tempting (progress, confidence, state), use a rule, a bracket, or a texture. |
| Glow / bloom / outer shadows on dark | Zero. Separation comes from 1px rules and surface *value*. |
| Glassmorphism / backdrop-filter | Zero. No translucency except a single 4% ink wash for "current row." |
| Generic chatbot layout | No message bubbles, no avatar, no transcript styling. Shadow's speech is **quoted, attributed editorial text** or **a spine mark**. |
| Floating-card soup | Surfaces are contiguous, separated by rules; or they are genuinely separate documents (Direction B). Max one bordered plate on screen at a time in A and C. |
| Brain / network / neuron / particle imagery | Zero. The only graphic element permitted is the interval/density/texture grammar. |
| Decoration | Every icon must encode a function or a provenance state. If an icon can be deleted without information loss, it is deleted. |
| Continuous animation | Exactly one permitted looping element per direction: the capture indicator. It is 1px and low-contrast, and it is information (capture is on), not mood. |
| Neon | No hue above ~78% saturation, except a single prohibition hue at ≤70%, used only for the Binding state and only inside a structural mark. |

### 2.6 Shared content model and naming

All three directions render the same objects. Naming is fixed so the three are comparable:

- `Work` — the ERP's own UI (invoice, fields, actions). Never restyled by Shadow.
- `Claim` — a rule or preference. Has state, `when → then`, evidence list, quote.
- `Guardrail` — a binding constraint. Has type, `when`, action, quote.
- `Evidence` — a quote + screen moment + timestamp + audio ref. Always Observed.
- `Probe` — a synthetic case with the map's prediction and the expert's answer.
- `Measure` — a number with an interval and a basis (`net` vs `gross`).
- `Silence` — a decision Shadow chose not to ask about, with the reason. **Promoted to a first-class object in all three directions** (today it is a feed row).
- `Session` — a capture, debrief, or tutor run.

### 2.7 The fifth surface: receipts and the sealed test

The engine now produces two objects the brief did not name but that are the sharpest expression of the whole thesis. They need a place in all three directions; they are not extras.

- **Learning receipt** — after every answer and every correcting decision: the prediction *before*, the teaching quote, the rule/parameter diff, and the *later independent checks* that agreed or disagreed. This is the finest-grained "uncertainty resolving into verified knowledge" object in the product.
- **Sealed proof** — a frozen commitment (SHA-256 over the prediction body) evaluated on unseen cases, labelled by a human.

Today (`console/src/components/Receipts.tsx`, `pages/ProofPage.tsx`) the receipt is a `rounded-xl` card with `text-learn` / `text-gap` / `text-ask` / `text-hyp` pills, and the sealed proof's hash is hidden inside a 10.5px `<details>` disclosure. Both are backwards: the **before→after diff is a diff**, and the **hash is the point**, not fine print.

Art direction per direction:

- **A — Instrument.** A receipt is a *receipt*: a fixed-form ruled slip, serial-numbered, with four labelled bands — `BEFORE · TAUGHT · AFTER · TESTED`. `before → after` is a two-track diff exactly like `FieldDiff`, never colored pills; the verdict is a **stamp** (bordered, small caps, drawn not rotated); the independent checks are a mono grid of `✓/✗ <case_id>`. The sealed proof is a **ledger of frozen predictions**: the full hash set in 4-char mono groups at the head of the plate (not behind a disclosure), and the proof table as `case · net/gross · human label · frozen prediction · agree` where the frozen cell carries `◌` + a lock glyph.
- **B — Codex.** A receipt is a **dated entry in the apparatus**: the quote as Testimony, `before → after` as a ruled line with the old value struck and the new value in the clause voice, and the verdict as a **siglum + a marginal date** (`✓ held on later cases · 4/4`). Independent checks are a **collation** in the margin: `✓ 5120 · ✓ 5121 · ✗ 5122`. The sealed proof becomes a **notarised page**: hash printed in full at the foot, frozen predictions set in mono inside one ruled plate, and the evaluator does their labelling by *writing into the document*. This is the strongest home for the proof page.
- **C — The Shift.** A receipt is a **span on the spine**: `before` tick, `taught` tick (quote in the Inspector), `after` tick, then `tested` ticks as short marks. The verdict is the ratio of solid to hatched marks. The sealed proof is a **frozen band**: at freeze time a hatched vertical *seal* is drawn across the spine at that timestamp; every prediction committed after it renders with a lock glyph and resolves dotted→solid as labels land. The hash is the seal's identity, printed in the Inspector.

In all three, the hash must be **legible at rest, in monospace, in full**, with verification as a secondary ruled affordance — a commitment nobody can read is theatre.

---

## 3. Direction A — **INSTRUMENT**

*The audit instrument. Light, dense, tabular, hairline-ruled. Shadow is a diff gutter.*

### 3.1 Thesis

The expert's screen is a **specimen plate**; Shadow is a **calibration gutter** bolted to its right edge, row-for-row aligned to the fields it concerns. Nothing floats, nothing is rounded, nothing glows. Confidence is a monospaced interval. Rules are set in monospace because a rule *is* an executable predicate. This is the direction that a compliance officer, an auditor, or a CFO would sign off on, and it is the least "AI-looking" of the three.

### 3.2 Why this is right for Shadow

Shadow's claim to a 2026 enterprise buyer is not that it is clever; it is that **every belief it holds is traceable to a timestamped observation and survives an adversarial probe**. The visual language should therefore be the language of evidence: workpapers, chain-of-custody labels, instrument readouts. It should feel boring in the way that a lab result is boring.

It also solves the "work is primary" problem structurally rather than by emphasis: the ERP occupies the majority of the canvas and Shadow's entire presence is a 176px gutter that is *registered to the work's own rows*. There is no room for panel soup because there is only one panel, and it is the work.

Its risk is emotional flatness — it will not make a judge *feel* the retiring-expert story. That is a real cost, addressed in §7.

### 3.3 Screen hierarchy

**Capture** (the mode where the expert's work must dominate):

```
 ┌─ 1  session bar (36px, hairline bottom) ────────────────────────────────────────────┐
 │ Nordwerk · Capture · Sabine A. · 03:12 elapsed ● recording        [off the record]  │
 ├─ 2  STAGE — the live ERP (flex, min 720px) ──────────────┬─ 3  GUTTER (176px) ───────┤
 │                                                          │                          │
 │   ┌ Invoice HM-2026-0412 · Hessler Maschinentechnik ─┐   │  ◌ pred 4711  03:11:47    │
 │   │ ...net/gross, PO, history, booking fields...     │   │  │                        │
 │   │ cost_center   [ 0400 ▾ ]  ← expert acts here     │   │  ├ ▮ act 0400  03:12:09   │
 │   │ asset_number  [        ]                         │   │  │  unexplained           │
 │   └──────────────────────────────────────────────────┘   │  ▼                        │
 │                                                          │  ? "You moved 4471 to     │
 │   ┌ Post ────────────────────────────────┐               │    capex. What made you   │
 │   │  held · guardrail G2 not satisfied   │               │    do that?"              │
 │   └──────────────────────────────────────┘               │    — asked at pause 03:12 │
 ├─ 4  STATUS STRIP (28px, hairline top) ───────────────────────────────────────────────┤
 │ pause 0.91 · asked 2/5 · silent 3 · confirmed 2/6 · capture hairline ▓▓▓▓▓░░░░░░░░░  │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

**Hierarchy:** (1) Stage — the largest region, the only one with content the user *owns*. (2) Gutter — vertically aligned to stage rows via 1px leader lines; it is an annotation layer, not a column of cards. (3) Status strip — a single line of mono measurements; the Silence Log and the ask budget live here, collapsed, and expand upward on demand. (4) Session bar — meta only.

**Work Map** — the gutter widens to 480px; the stage shrinks to a replay pane (the recorded frame with a locked overlay). The Map itself is a **ledger table**, and the gutter becomes its provenance column:

```
 # │ step                     │ 2019 doc          │ learned rule              │ guardrail │ evidence │ state
───┼──────────────────────────┼───────────────────┼───────────────────────────┼───────────┼──────────┼───────
 1 │ Open invoice             │ —                 │ —                         │ —         │ ▮03:04   │ —
 2 │ Match PO                 │ ✓ price, qty      │ —                         │ —         │ ▮03:06   │ obs
 3 │ Check supplier status    │ —                 │ —                         │ ▮ G3      │ ▮03:07   │ bind
 4 │ Code to cost center      │ 4711 opex  ~~strike~~ │ net>5000 ∧ equip → 0400 │ ▮ G2      │ ▮03:12 ✓ │ conf
 ...
```

**Debrief** — the stage is replaced by a two-region sheet: left = the ranked agenda (numbered, mono EVOI values); right = the **probe sheet** and the **posterior strip**. The teach-back is a read-back of the ledger with per-row confirm/correct controls.

**Tutor** — stage = the trainee's ERP; gutter = the *expected* values for each row (from `run_map`), each carrying its provenance. The Post control becomes a **held control**.

### 3.4 Exact layout

Reference width 1440, 24px outer margin, 8px baseline grid, all rows on a 28px rhythm.

| Region | Width | Behavior |
|---|---|---|
| Session bar | full × 36 | fixed |
| Stage | `flex: 1 1 auto`, `min-width: 720px` | the ERP, unstyled by Shadow except the locator row |
| Gutter | `176px` fixed (Capture), `480px` (Map/Debrief) | scrolls in lockstep with the stage, row-aligned |
| Status strip | full × 28 | fixed at bottom; expands to 240px overlay |
| Inspector (Tutor only) | `320px` right rail | present only in Tutor |

Row registration is the key mechanic: the gutter renders one annotation row **per stage field row**, at the stage row's exact `y`, and a 1px `--rule` leader line joins them. Implement with a shared CSS grid (`grid-template-rows: subgrid`) or a `ResizeObserver` mapping. If the stage row is not visible, the annotation collapses to a 2px tick in a vertical "offscreen index" at the gutter's edge.

Radii: `0` everywhere in Shadow's layer. The ERP keeps its own 4px (`--radius: 0.25rem`). The contrast between the work's softness and Shadow's crispness is deliberate.

### 3.5 Typography

| Role | Face | Size / leading | Notes |
|---|---|---|---|
| Work | ERP's own (IBM Plex Sans) | ERP's own | Shadow never touches it |
| Claim | `Berkeley Mono` → `ui-monospace` | 12.5 / 18 | **The signature decision: rules are code, so rules are set in code.** `net > 5000 ∧ cat=equipment → 0400` |
| Measure | same mono, `font-variant-numeric: tabular-nums` | 12 / 16 | every number in the product |
| Evidence (quote) | `Inter` (sans) | 13 / 19, hanging `“` | human speech is sans here; it is testimony, not headline |
| Label | `Inter`, uppercase | 10 / 14, `+0.08em`, 600 | state words, column heads |
| Step name | `Inter` | 14 / 20, 600 | the only non-mono prose in the Shadow layer |

Anti-hero rule: **no display type anywhere.** The largest text in the product is 15px. Drama comes from alignment and hairlines, not size.

### 3.6 Provenance rendering in A

The **ProvBlock** is a fixed 3-cell unit, mounted at the left edge of every claim, 44×16:

| State | Glyph | Left rule | Ink | Label slot | Motion on arrival |
|---|---|---|---|---|---|
| Observed | `▮` solid 6×6 | 2px solid | 100% | `observed · 03:12` | ink-in 140ms |
| Inferred | `◌` 6px open ring | 1px dashed | 62% | `inferred · p .41` | ink-in 140ms, 1-frame dip |
| Confirmed | `✓` in a 10px square | 1px solid + full-width 1px underline under the claim | 100% | `confirmed · 3 probes` | underline **wipes left→right** 180ms |
| Binding | `■` 6×6 filled | **4px solid** + 1px hairlines above and below (a band) | 100% | `guardrail · block` | band draws top→bottom 120ms |
| Contested | `✗` | 1px dashed + strike through claim | 55% | `contested · 03:41` | strike wipes 140ms |

Grayscale test: all five remain distinguishable by glyph + rule weight + line style. This is the most rigorous of the three directions and it is why A is the "enterprise-safe" choice.

### 3.7 The three moments in A

**M1 — prediction → divergence.** The stage's `cost_center` row gets a **two-track value cell** in the gutter:

```
cost_center   ▏◌ predicted   4711 · opex-maint     03:11:47   p .41
              ▏▮ actual      0400 · capex-machinery 03:12:09
                             └────────── unexplained ─────────┘
```
Composition: predicted and actual occupy **the same column, adjacent lines**, so the comparison is vertical and instantaneous. A 1px vertical bracket spans them with the word `unexplained`. The prediction line never vanishes — its state freezes as `pre-commit 03:11:47` and its underline closes from dashed to solid, meaning *this guess is now history*. The actual line inks in below it. There is no animation between them; the divergence is a **fact of the layout**, not an event.

**M2 — question → crystallization.** The question is a **marginal note** in the gutter at that row's `y`, connected by a leader line, opening with `?` and closing with `— asked at pause 03:12, e .73`. The stage dims to 60% **except the field under question**, which keeps a 4% ink wash. On answer, in place and in this order:
1. the question text collapses to a 1-line reference `? q_17 ▸` (120ms),
2. the compiled claim appears at `◌ inferred` in mono,
3. an **evidence strip** accumulates under it — one mark per piece: `▮ 03:12` `◌ cf-04` `◌ cf-05` — each stamping in at 90ms,
4. when the probes agree, the glyph swaps `◌ → ✓` and the 1px underline wipes across at 180ms.

Throughout, the object's x/y never changes. Only its material does.

**M3 — guardrail → intervention.** The trainee sets `4711`. The gutter's expected row transforms: `◌ predicted` → `■ guardrail G2`, and the **guardrail band** expands to span the full gutter width and one hairline into the stage, enclosing `cost_center = 0400 and not asset_number` in mono, with the expert's quote beneath in sans. The stage's Post control becomes a **HeldControl**: `Post — held`, with a 1px hatched left edge, and beneath it a required reason field labelled `to override, state why`. No modal. No red. The authority is the band and the quote. A `▶ 03:12` inline mark seeks the replay pane in place. Mastery renders in the right rail as `Lena · 0.42 → 0.61` with the delta written as text, and the per-rule meter is a **3-segment interval**, not a fill bar.

### 3.8 Component system A

| Component | Contract |
|---|---|
| `Grid` | 8px baseline, 28px row rhythm, exposes row `y` registry |
| `Stage` | slot for the ERP; provides locator row + optional replay frame |
| `Gutter` | row-locked annotation layer; leader-line renderer; offscreen index |
| `ProvBlock` | `{state, p?, evidenceCount?, ts?}` → glyph + rule + label |
| `ClaimMono` | `{when, then, priority}` monospace predicate with syntax weight |
| `Measure` | `{value, unit?, interval?, basis?}` mono with bracket |
| `EvidenceMark` | `{state, ts, kind: quote\|probe\|replay\|counterfactual}` |
| `FieldDiff` | `{predicted, actual, committedAt, observedAt}` two-track vertical |
| `GuardrailBand` | `{type, when, action, quote}` — the only interrupting component |
| `LedgerTable` / `LedgerRow` | Work Map; expandable inline; provenance column pinned left |
| `ProbeSheet` | synthetic cases: map prediction vs expert answer, adjacency + glyph |
| `PosteriorStrip` | SVG density + interval bracket + observation count, mono axis |
| `HeldControl` | replaces a primary action; requires reason; hatched edge |
| `SilenceStrip` | the ask budget + silent decisions, expandable upward |
| `CaptureHairline` | 1px, advances 1px/s. The only looping motion. |

Refused in A: any "card," any radius > 2px, any shadow, any color-filled button.

### 3.9 Motion in A

- Durations: `120 / 140 / 180 / 200ms`. Easing: `cubic-bezier(.2,0,0,1)`.
- Three motions only: **ink-in** (opacity 0→1 + a 1px underline wipe), **state swap** (glyph exchange with a 1-frame 50% opacity dip; layout never moves), **number tick** (linear, tabular so width is stable).
- **Rows are never re-flowed.** New claims are inserted into grid space reserved at row creation, so nothing below jumps. This is the direct answer to the current console's `layout` animations.
- No scale, no spring, no stagger longer than 3 items.

### 3.10 Anti-pattern compliance A

Zero gradients (progress is a wipe or a bracket) · zero blur · zero glow · no chat (Shadow's speech is a marginal note or a mono claim) · no floating cards (one stage + one gutter) · guardrails are bands, not chips · the only looping element is the 1px capture hairline · icons limited to `▮ ◌ ✓ ■ ✗ ? ▶`.

### 3.11 Risks A

- Dense mono at 12px can read as "developer tool" rather than "enterprise." Mitigate with generous row height (28px) and a warm paper `#F7F5F1`, not a cold grey.
- The gutter is 176px; long German rule text will wrap badly. Rules must be *abbreviated in the gutter and expanded in the ledger*.
- Lowest emotional temperature of the three. Best paired with B or C for the story beats.

---

## 4. Direction B — **CODEX**

*The knowledge document. Warm paper, one measure, serif voice. Shadow is marginalia.*

### 4.1 Thesis

The Work Map is not a dashboard; it is **a document that a retiring expert signs**. So the product is designed as a document: a warm paper page, a single text measure, a wide outer margin for Shadow, and **four typographic voices standing in for the four provenance states**. Uncertainty resolves by *rewriting the page* — a question mark in the margin becomes a quoted sentence in the text, which becomes a clause in roman once behaviour confirms it.

### 4.2 Why this is right for Shadow

This is the only direction where the **artifact itself** is the interface, which matches the brief's "every step and guardrail links to a screen moment and the expert's words." It makes the expert's *words* the primary content — which is exactly the product's claim: the residual lives in language plus behaviour, not in telemetry.

It is also the most defensible as a *differentiated* 2026 aesthetic. Every other AI product is dark glass. A quiet, warm, typographically serious knowledge document is instantly memorable and photographs beautifully in a pitch deck. And the four-typographic-voice idea is a genuine information-design invention: it renders provenance in a channel that survives grayscale, projection, and printing *and* encodes the epistemic hierarchy (testimony > machine aside > earned clause > binding stop) directly in the reading experience.

Its risk is density: a document UI has no place for the live "watcher" feeling during Capture, and a judge may not notice Shadow working unless the margin is well-choreographed. The motion spec in §4.9 exists to solve exactly that.

### 4.3 Screen hierarchy

**Capture** — the page is the session record being written; the ERP is an inset *exhibit* on the left of the text block, and Shadow writes in the outer margin.

```
        ┌─ folio: Shadow · Capture · Sabine Albrecht · 18 Sep 2026 · v0 · 03:12 ─┐
        │                                                                        │
  96px  │   ╔ Exhibit A ══════════════╗   ‖  the measure (640px)  ‖   320px margin
 margin │   ║  live ERP, 520px wide    ║   ‖  the document being    ‖   ◌ per 2019 doc,
        │   ║  the expert's work        ║   ‖  written in the        ‖     opex 4711
        │   ║  ← PRIMARY               ║   ‖  expert's voice         ‖     03:11:47
        │   ╚══════════════════════════╝   ‖                        ‖   ─────────────
        │                                  ‖  “Equipment over five   ‖   ? margin query
        │                                  ‖   thousand net is       ‖   ─────────────
        │                                  ‖   always capex.”        ‖   ▮ 03:12 frame
        │                                  ‖   — Sabine, 03:12       ‖
        │                                  ‖                        ‖
        │                                  ‖  [ compiled claim,      ‖
        │                                  ‖    sans italic, 62% ]   ‖
        └─ rules: hairline above folio, hairline above footer ─────────────────────┘
```

**Hierarchy:** (1) the measure — the document text and the expert's words; (2) the exhibit — the expert's live work, primary in *function*, retained at 520px so the page keeps its reading rhythm; (3) the margin — Shadow's entire presence; (4) folio — meta.

**Work Map** — the exhibit is dropped; the page *is* the artifact. Clauses are numbered `§1…§7`, each with: clause text (roman), the expert's quote above it (roman, quoted, attributed), exceptions indented under it, and any guardrail as a **Stop Plate** (bordered, small caps). A running **Evidence Ledger** closes the document: every observation, probe, and replay with timestamps.

**Debrief** — the page is being *written*. Left column: standing questions `Q1…Qn` as ranked marginal queries. Center: the manuscript growing live. Each probe is a **Probe Plate** — a small bordered figure with the case numbers, the map's prediction, the expert's answer. Inline: a **Ruler Interval** for the posterior — a drawn ruler with ticks and a bracket. The teach-back is the act of reading the document; each clause gets a confirm/correct affordance that writes an initial and a date into the margin, legal-instrument style.

**Tutor** — a two-page spread. Left page: Exhibit B, the trainee's work. Right page: the clause they are working under, plus, at a mistake, the raised **Objection** — the guardrail Stop Plate and the expert's quote promoted to a pull-quote with a `▶` inline clip. The save action becomes a ruled HeldControl with a required reason.

### 4.4 Exact layout

Reference: viewport ≥ 1280. Page content box **1100px**, centred: `96px` left margin · `640px` measure · `44px` gutter gap · `320px` right margin. Baseline grid **24px**; all text sits on the baseline; rules sit on the baseline, never between.

| Mode | Left 96px | Measure 640 | Margin 320 |
|---|---|---|---|
| Capture | fold mark | document text (growing) | annotations, queries, evidence marks |
| Work Map | clause numbers | clauses + quotes | sigla, evidence ledger refs |
| Debrief | `Q1…` | manuscript | probe answers, inline ruler |
| Tutor | Exhibit B (spans measure in 2-col) | — | Objection + quote |

Paper: `#FBF8F3` page, `#201E1B` ink, `#8A8378` margin ink, `#C9C2B6` rules. A single hairline frame around the page; **no border-radius anywhere** on Shadow's layer (the exhibit keeps the ERP's own 4px, which reads as "a window into another system").

Page mechanics: folio ruled top and bottom; the document scrolls as one continuous sheet — no internal scrollers, ever. This is a hard rule and it is what prevents panel soup.

### 4.5 Typography

This is B's whole system. Four voices = four states.

| Role | Voice | Spec | State it carries |
|---|---|---|---|
| **Testimony** | serif roman, quoted | `Iowan Old Style / Charter`, 19 / 28, hanging `“`, attribution in small caps 10/14 `+0.1em` | **Observed** (human evidence) |
| **Conjecture** | sans italic | `Inter` italic, 14 / 21, ink 62%, preceded by `◌` and set inside an unclosed bracket feel | **Inferred** (machine) |
| **Clause** | serif roman, solid | 16 / 26, with a 1px full-measure rule above and a `✓` siglum in the margin | **Confirmed** (earned) |
| **Stop** | serif small caps | 13 / 20, `+0.14em`, inside a 3px-left-ruled bordered plate | **Binding** (guardrail) |
| Apparatus | sans | 12 / 18, ink 55% | folio, timestamps, apparatus |
| Measure | sans, tabular | 12.5 / 18 | numbers inside plates and rulers |

The crystallization moment is literally a **type change in place**: `Conjecture → Clause`, same words, sans-italic-62% becomes serif-roman-100% with a rule drawn above it. No color is involved. This is the single most important detail in B.

Anti-hero rule: the only large type in the product is the **Testimony set as a pull-quote at 26/36** during M3 — because the expert's words are the authority in that moment, and nothing else on screen has earned that size.

### 4.6 Provenance rendering in B

| State | Voice | Siglum (always in the margin, at the line's baseline) | Material change on confirm |
|---|---|---|---|
| Observed | serif roman, quoted | `▮` + `03:12` | — |
| Inferred | sans italic 62% | `◌` + `p .41` | — |
| Confirmed | serif roman, solid | `✓` in a small square + evidence count | rule drawn above · italic→roman · ink 62→100% |
| Binding | small caps in a Stop Plate | `■` | plate draws its 3px left rule |
| Contested | serif with a strike rule | `✗` + new timestamp | strike wipes across; a margin note points to the contradicting observation |

Siglum set is fixed and deliberately primitive — it reads as a scholarly apparatus, not as UI chrome: `▮ ◌ ✓ ■ ✗` plus `§` and `?`.

### 4.7 The three moments in B

**M1 — prediction → divergence.** The AI Novice's guess is already in the margin, in sans italic, *before* the act, timestamped: `◌ 03:11:47 — per 2019 doc: opex 4711`. When Sabine acts, that line gets a **1px strike-through wiped left→right over 140ms** and the expert's action is *set into the text* as Testimony: `→ capex 0400` with her quote. Divergence is therefore rendered as **margin struck vs. text set** — the machine's guess is literally crossed out by the human's act, and the human's act becomes literature. Nothing turns red.

**M2 — question → crystallization.** The question enters the margin as a query: a `?` with a 1px vertical rule drawn *downward* to the line it concerns (120ms). When Sabine answers:
1. her words are **set as Testimony** in the text (serif roman, quoted, attributed, 180ms ink-bleed from 0.7→1 opacity and 0.4px blur→0),
2. immediately below, a **Conjecture** line sets in sans italic (the compiled claim),
3. as probes land, one `◌` siglum per probe accumulates in the margin, each stamping at 90ms,
4. on agreement, the Conjecture **re-sets to a Clause** — the type change — and a 1px rule draws above it (120ms), with a single `✓` siglum replacing the `◌`s.

The page grows downward only. Nothing moves horizontally. Nothing is ever removed.

**M3 — guardrail → intervention.** The trainee's exhibit shows `4711` in `cost_center`. The right page **raises**: the guardrail **Stop Plate** sets in at the top of the page in small caps, and above it Sabine's words are promoted to a **26/36 pull-quote** with `▶ 03:12` that plays the clip inline in the margin (the frame replaces the folio's lower rule area — no new window). The save control becomes ruled: `Post — held`, with `state why to override` set beneath in apparatus type. The intervention sentence is set as an **Objection**: attributed, dated, in the document's own voice — not an error message.

### 4.8 Component system B

| Component | Contract |
|---|---|
| `Page` | baseline grid, paper, folio, single continuous scroll |
| `Measure` | 640px text column; refuses any bordered child except plates |
| `Margin` | 320px annotation field; renders notes at the baseline of their anchor |
| `MarginNote` | `{kind: prediction \| query \| probeAnswer \| correction, ts, state}` |
| `Siglum` | `{state, ts?, p?, count?}` — the fixed primitive set |
| `Testimony` | `{quote, speaker, ts, audioRef, lang, translation?}` serif quoted |
| `Conjecture` | `{when, then, p}` sans italic |
| `Clause` | `{n, when, then, exceptions, evidence[], confirmedAt}` serif roman + rule |
| `StopPlate` | `{type, when, action, quote}` the only bordered box in the system |
| `ProbePlate` | `{caseFields[], mapPrediction, expertAnswer, agreed}` |
| `RulerInterval` | `{mean, sd, basis, basisProb, nObs}` drawn ruler, mono numerals |
| `EvidenceLedger` | running table at document end, one row per observation/probe/replay |
| `Exhibit` | ERP inset; the only rounded rectangle on the page |
| `FoldMark` | 96px left margin element showing document position |
| `HeldControl` | ruled held action + reason field |

Refused in B: cards, chips, badges, fill bars, dark surfaces, icon buttons, sidebars, drawers, modals.

### 4.9 Motion in B

- Durations: `90 / 120 / 140 / 180 / 240ms`. Easing: `cubic-bezier(.16,1,.3,1)` — a soft settle, no overshoot.
- Four motions only:
  1. **Ink-bleed** — new text arrives with opacity `.7→1` and `blur(.4px)→0` over 180ms. This is the "writing" gesture and it is the signature motion of B.
  2. **Strike-wipe** — a 1px rule drawn left→right at 140ms over struck content.
  3. **Rule-draw** — a 1px full-measure rule drawing left→right at 120ms above a newly confirmed Clause.
  4. **Siglum stamp** — `scale(1.06) → scale(1)` over 120ms on the glyph only.
- **Nothing is ever removed or moved.** Growth is downward. Scroll position is preserved by anchoring to the last-stable line, so the page never jumps under the reader.
- No looping motion except a single hairline in the folio's right corner indicating capture is on, advancing 1px/s.

### 4.10 Anti-pattern compliance B

Zero gradients · zero blur (the ink-bleed is a *text* blur of 0.4px over 180ms, not a backdrop filter) · zero glow · zero shadows (the page is paper: separation is rules) · no chat (quotes are editorial, not bubbles) · no cards (the only bordered objects are Stop Plates and Probe Plates, both content-bearing) · guardrails are the *only* boxes, which is exactly the semantic hierarchy · one looping indicator · decorative icons: none.

### 4.11 Risks B

- Great on a 1440 laptop; weak on a 1024 projector. The 320px margin must be allowed to fold under the measure at <1180px (margin notes re-anchor as inline sidenotes) — spec this before building.
- Serif + four voices requires type discipline; if someone adds a fifth voice the system collapses. Freeze the four.
- Capture mode is the hardest: the document must feel *alive* while the expert works. The ink-bleed and the margin-rule-draw carry that; budget engineering time for them.

---

## 5. Direction C — **THE SHIFT**

*Time is the spine. One timeline at four scales; uncertainty is an area between two lines.*

### 5.1 Thesis

The product's entire claim is a **temporal** claim: *Shadow predicted before the expert acted, and the residual between those two is the asset*. So make time the substrate of the whole interface. One horizontal spine runs the width of the window, always. The four modes are four **scales of that spine**, not four pages. Uncertainty is drawn as the **area between the prediction tick and the act tick** — a quantity you can literally watch shrink as the shift proceeds.

### 5.2 Why this is right for Shadow

It solves the honesty problem visually. A judge can glance at the spine and *see* that the prediction tick sits to the left of the act tick — earlier in time — which is exactly the claim no one else can make. It makes the pause gate legible (the question mark is connected to the moment it *could* have been asked by a dotted "restraint" segment). It makes crystallization legible (a rule is a dotted bar that becomes solid across its coverage). And it makes the tutor's intervention legible (a hatched band dropping from the expert's spine to the trainee's).

It is also the only direction where **all four modes share one data-driven structure**, which means the demo's transitions between Capture → Debrief → Tutor are zooms rather than page loads. That reads as a real product, not four screens.

Its risk is exactly its strength: a timeline-first UI can feel like monitoring/observability rather than knowledge capture, and it can bury the expert's words. Both are addressed by making the Inspector deliberately the only place with serif type — the human voice is the one warm thing in the room.

### 5.3 Screen hierarchy

```
 ┌─ 1  command bar (40px) ───────────────────────────────────────────────────────────────┐
 │ SHADOW  Nordwerk · Sabine A.   [ capture │ debrief │ tutor ]   ● on record   ⟦scale⟧  │
 ├─ 2  STAGE (flex) ──────────────────────────────────────┬─ 3  INSPECTOR (320px) ────────┤
 │                                                        │  selected mark only          │
 │   the ERP, live or replayed, with a 1px locator        │  state · ts · p · evidence   │
 │   band on the row the spine's playhead is on           │  “Equipment over five        │
 │                                                        │   thousand net is always     │
 │                                                        │   capex.” — Sabine, 03:12 ▶  │
 │                                                        │  ──────────────────────      │
 │                                                        │  when  net > 5000 ∧ equip    │
 │                                                        │  then  cost_center = 0400    │
 │                                                        │  evidence  ▮03:12 ◌cf04 ✓    │
 ├─ 4  ── THE SPINE (drag to resize: 200 / 320 / 480) ────────────────────────────────────┤
 │       00:00      00:30      01:00      01:30      02:00      02:30      03:00   03:12 │
 │  pred ┄┄┄┄┄┄┄┄┄◌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄◌┄┄┄┄┄┄┄┄┄┄┄┄┄┄◌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄◌┄┄┄┄┄┄┄┄┄┄┄┄┄ │
 │  expert ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮ │
 │  gap     ╱▔▔▔▔▔▔▔▔╲        ╱▔▔▔▔╲                                    ╱▔▔▔▔▔▔╲     │
 │  rules      ░░░░░░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
 │  q's        ┊q_14  ┊        ┊  q_17         ┊        ┊q_21                          ▲│
 │  guardrails ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨  │
 └───────────────────────────────────────────────────────────────────────────────────────┘
   ░ inferred · dotted   ▓ confirmed · solid   ▨ binding · hatched   ◌ pre-commit tick
```

**Hierarchy:** (1) the **Spine** is the product's identity and second-largest region; (2) the **Stage** is the expert's work, largest in area and highest in contrast; (3) the **Inspector** shows exactly one selected object — it is a property sheet, never a feed; (4) the command bar's mode selector is really a **scale selector**.

**Capture** = spine zoomed to a 10-second window around a live playhead; marks stream in at the right edge; the Stage is the live ERP.
**Work Map** = spine zoomed to the whole shift, expanded into **swimlanes per decision step** (a ruled piano-roll, monochrome). This *is* the Work Map: rows are steps, marks are rules/guardrails, the horizontal extent is the evidence coverage.
**Debrief** = spine **filtered to unresolved**: only marks whose state ≠ Confirmed remain; the residual areas are outlined and ranked left→right by EVOI; the posterior is a band that narrows as probes land.
**Tutor** = a **second spine** appears 64px below, phase-locked to the same ruler, showing the trainee's run; mismatches hatch vertically between the two spines.

### 5.4 Exact layout

Reference 1512×945 (16:10 laptop) and 1920×1080. Outer margin 16px. Hairline rules 1px `--rule`.

| Region | Size | Notes |
|---|---|---|
| Command bar | full × 40 | fixed |
| Stage | `flex`, min 520 × 340 | ERP or replay frame; 1px locator band |
| Inspector | 320 fixed | one object; property rows on a 26px rhythm |
| Spine | 200 (Capture) / 320 (Map) / 480 (Debrief, Tutor) | **draggable divider**; the drag is the primary navigation gesture |
| Ruler | 24px band at spine top | mm:ss every 30s, 2s minor ticks, mono 10px |
| Lane | 28px (Capture) / 40px (Map) | - |

The spine is a single shared `transform: translateX()` surface — all four modes are the *same DOM*, re-scaled, so transitions are continuous and no lane is ever rebuilt. This is the architectural requirement that makes C feel like one instrument.

Surface values (dark, warm graphite — deliberately **not** blue-black and **not** neon):
`--stage #0B0C0D` · `--spine #121314` · `--inspector #0B0C0D` · `--rule #222426` · `--rule-strong #33363A` · `--ink #E8E6E2` · `--ink-2 #9A9691` · `--ink-3 #6A6663` · `--confirmed #7FA88C` · `--binding #B4705F` · `--attention #C9A227` (used only for the currently selected mark).

### 5.5 Typography

| Role | Face | Size | Notes |
|---|---|---|---|
| Instrument | `Inter` / system grotesque | 12 / 16 | UI, labels, mode names |
| Spine | `ui-monospace` / SF Mono | 10 / 14 tabular | every lane label, every clock, every timestamp |
| Measure | same mono, tabular | 11–12 | gap areas, probabilities, mastery |
| **Human** | `Iowan Old Style` / Charter serif | 16 / 24 | **only inside the Inspector, only for expert quotes** |
| Step name | `Inter` 600 | 13 / 18 | lane/step labels |

The signature decision: **the machine is monospace, the human is serif.** Everything the system computes or measures is mono; the only serif in the entire product is a verbatim human quote. Once a judge sees that rule, every screen becomes readable at a glance.

### 5.6 Provenance rendering in C — texture over hue

| State | Mark | Texture | Axis |
|---|---|---|---|
| Observed | tick, 2×10, full ink | solid | on the `expert` lane, at its true ts |
| Inferred | tick, 2×10, 50% ink | **dotted** | on the `pred` lane (or a dotted rule bar) |
| Confirmed | tick, 2×10, full ink + a second tick offset 3px | **solid, doubled** | on the `rules` lane, bar extends across coverage |
| Binding | a lane-wide band | **hatched 45°, 1px, 6px pitch** | its own `guardrails` lane — the only band, the only interruption |
| Contested | tick + a 1px vertical line back to the contradicting act | dashed vertical | on both lanes |

Textures are grayscale-legible at 3m on a projector, which is the actual demo condition. Hue is used only for "selected" (amber) and nothing else.

### 5.7 The three moments in C

**M1 — prediction → divergence (the residual has area).**
The prediction renders as a `◌` tick on the `pred` lane at its **commit** timestamp. The act renders as a `▮` tick on the `expert` lane at its **act** timestamp. Because both are placed by time, the prediction is always to the left — the "before" is a geometric fact, not a claim. On divergence:
1. a 1px connector draws from the prediction tick down to the act tick (120ms),
2. a **hatched/toned trapezoid fills between the two lanes** across the interval — the residual — with its area labelled in mono: `Δ 0.71 · structural`,
3. the trapezoid's right edge is the live leading edge: it animates while the next context arrives (1px, 40% ink), then seals solid.
Over the session these trapezoids are the record of what Shadow didn't know. **The Debrief's headline is the sum of their area**, drawn as a narrowing band along the whole spine. "Uncertainty resolving into verified human knowledge" is literally the area under that curve going down. This is the single most important graphic in the product.

**M2 — question → crystallization.**
The question is a `┊` mark on the `q's` lane. Critically, a **dotted "restraint" segment** is drawn from the moment the gap was detected to the moment the question was actually asked at a pause — labelled in the Inspector as `waited 4.2s for a pause`. Silence becomes visible as a design feature, not an absence.
On answer:
1. the `┊` mark opens into a bracket spanning the answer's timestamp (`mark → interval`, 140ms),
2. a **dotted rule bar** appears on the `rules` lane covering the range of cases the rule claims,
3. each probe lands as a short dotted extension of that bar, offset 3px (90ms each),
4. on agreement the bar **solidifies and doubles** — dotted→solid across its whole length (240ms), and the residual trapezoids inside its coverage are **re-measured and shrink** (the areas physically contract toward their act ticks).

The viewer watches knowledge crystallize *and watches the uncertainty it removed disappear*. That is the demo.

**M3 — learned guardrail → trainee intervention.**
In Tutor, the trainee spine appears below. The expert's expected action is already a tick on the `expert` lane (from `run_map`, and it is *offset to the left* of the trainee's act because it was computed first). When the trainee acts wrongly:
1. a **hatched vertical band** drops from the expert's tick, through the gap, to the trainee's tick — spanning both spines (120ms),
2. the Stage dims to 30% and the locator band locks on the offending field,
3. the Inspector switches to the binding object: `■ guardrail G2 · block`, the rule in mono, and Sabine's quote in **serif with a `▶ 03:12`** that seeks the Stage's replay,
4. the Stage's save control becomes `HELD` with a hatched left edge and a required reason,
5. on correction, the hatch clears, a **solid line connects the expected and actual ticks** (the trainee's act is now *aligned with* the expert's), and mastery is written as a delta beside the lane: `0.42 → 0.61`.

The intervention is not an error dialog. It is a **temporal realignment**: the trainee's line moves to meet the expert's.

### 5.8 Component system C

| Component | Contract |
|---|---|
| `CommandBar` | workspace, session, mode, record switch |
| `ScaleSwitcher` | the four modes as scales: `now · shift · unresolved · trainee` |
| `Spine` | ruler + lanes + playhead; single shared transform; draggable height |
| `Lane` | `{id, label, texture, marks[]}` |
| `Mark` | `{kind, state, ts, x, label, target?}` — tick / interval / bracket / band |
| `GapArea` | `{fromTs, toTs, surprise, kind: parametric\|structural, open}` |
| `WaitSegment` | `{detectedTs, askedTs}` dotted restraint indicator |
| `RuleBar` | `{claimId, coverageFrom, coverageTo, state}` dotted→solid |
| `TraineeSpine` | phase-locked second spine; mismatch bands |
| `Stage` | ERP or replay + locator band + held control |
| `Inspector` | one object; `PropertyRow` list; serif `QuoteBlock` |
| `PropertyRow` | `{label, value, mono?, state?}` 26px rhythm |
| `HeldControl` | hatched held save + reason |
| `PosteriorBand` | posterior as a band along the spine, narrowing |
| `Legend` | the texture legend, collapsible, shown once per session |

Refused in C: cards, badges, chips, avatars, chat, nested scroll areas, any element that is not anchored to a time.

### 5.9 Motion in C

- Durations: `90 / 120 / 140 / 180 / 240 / 320ms`. Easing: `cubic-bezier(.22,1,.36,1)` for scale changes, `cubic-bezier(.2,0,0,1)` for marks.
- The **playhead is the only continuously moving element** (1px, 40% ink, 1× real time in Capture). Everything else is discrete.
- **Marks stamp** — the glyph only scales `1.0 → 1.15 → 1.0` over 90ms. Lanes never move for a mark.
- **Gap areas grow from the act tick leftward** (180ms) so the causal direction is legible: the expert acted, then the residual was measured back to the prediction.
- **Scale transitions** (Capture↔Map) are a single 320ms transform on the spine, with lanes expanding from their timestamps. There is no cross-fade between modes; it is genuinely a zoom.
- **Confirmation** is the only "reward" motion: a 240ms left→right solidification of a rule bar, followed by the residual areas inside it contracting over 180ms. No color flash.

### 5.10 Anti-pattern compliance C

Zero gradients (the posterior is a band with tick marks) · zero blur · zero glow · dark but warm graphite, no neon · no chat (Shadow's speech is a quoted serif block in the Inspector or a mark on a lane) · no cards (regions are separated by rules and surface value) · guardrails are the only hatched elements and the only interrupting band · one looping element (the playhead) · no decoration (every mark is a timestamp).

### 5.11 Risks C

- Most engineering of the three: requires a real spine abstraction, a lane registry, and shared-transform zoom. Do not build this in the last six hours.
- A timeline-first UI can be read as "monitoring." The Inspector's serif human voice and the Inspector's emptiness (one object at a time) are what prevent that. Protect them.
- Requires rehearsal discipline: the demo must be *driven* at the spine. If the judge never drags the spine, the whole idea is invisible. Script one drag.

---

## 6. Comparison

| | **A — Instrument** | **B — Codex** | **C — The Shift** |
|---|---|---|---|
| One-line | Audit workpaper with a diff gutter | Signed knowledge document | Time as the substrate |
| Primary surface | the ERP (stage) | the document text | the spine |
| Shadow's body | gutter, row-locked | outer margin | spine lanes + inspector |
| Provenance channel | glyph + rule weight + mono/sans | **typographic voice** | **texture** + axis |
| Uncertainty shape | interval bracket, mono | drawn ruler, unclosed bracket | **area between two ticks** |
| Crystallization | `◌ → ✓` in place + underline wipe | sans-italic → serif-roman in place | dotted bar → solid, doubled |
| Guardrail | band that spans the gutter | Stop Plate (the only box) | hatched lane band |
| Tone | precise, cool, light-grey | warm, editorial, human | cinematic, instrumented |
| Audience reaction | "I'd trust this with compliance" | "This is the artifact I'd sign" | "I can *see* it predicted first" |
| Strongest for | Capture, Work Map rigor | Work Map, Debrief, story | Debrief math, Tutor intervention, demo |
| Weakest at | emotion | Capture liveness | words/knowledge as content |
| Build cost | low–medium | medium | high |
| Risk | reads as dev tool | folds poorly on a projector | reads as monitoring |

**All three satisfy:** prediction-before-act visible; four provenance states distinguishable in grayscale; guardrails structural; no gradient/glass/glow/chat/card-soup; Silence Log promoted to first-class; the three moments each have a dedicated, non-modal rendering.

---

## 7. Recommendation

Do not pick one as a skin. They are three **registers** and the product needs more than one of them. My recommendation, in priority order:

1. **Ship B's provenance system as the product's identity.** The four typographic voices are the most original and most *true* answer to "human evidence, Shadow inference, behavior-confirmed knowledge, and guardrails must have visibly different provenance states." Nothing else in enterprise software renders epistemic status in type. It also makes the Work Map a thing an expert would actually sign, which is the business story.

2. **Adopt A's rigor patterns inside B rather than instead of it:** the `ProvBlock` slot discipline (provenance within 8px, fixed slot), the guardrail band, `HeldControl` with a required reason, the `LedgerTable` as the Work Map's rigorous view, and A's "rows never reflow" motion law. A is what makes B defensible to a buyer.

3. **Use C's spine for the Debrief and the Tutor, and for the demo's opening.** The residual-as-area graphic is the single best 10 seconds of this whole document — it makes the product's abstract claim physically visible and it is the moment a judge will remember. Keep it inside a B/A shell rather than rebuilding the app around it: a **spine panel** in the Debrief and Tutor modes, not the whole architecture.

4. **If you must ship exactly one for the demo, ship C's spine + B's manuscript for the Work Map.** That pairing gives you the strongest demo (time, math, drama) and the strongest artifact (a document), and it avoids the flatness of A.

**Fusion to avoid:** do not average them. Pick the register per mode deliberately and write the choice down, e.g.: Capture = B (document + exhibit) with A's gutter rigor; Debrief = C's spine + B's probe plates; Work Map = B's clauses with A's ledger as a "rigor" toggle; Tutor = C's dual spine + B's objection. Three deliberate registers is coherent; three averaged ones is mush.

---

## 8. Evaluation rubric — how to choose in 30 minutes

Put all three on the projector at the real demo resolution and run these six tests. Score each pass/fail; a fail is a redesign, not a tweak.

1. **Grayscale test.** Screenshot every mode, desaturate. Can you still name the state of every claim? (All three are designed to pass; verify.)
2. **Three-second test.** Show a screenshot for 3s. Can the viewer say what the expert is doing? If Shadow is the answer, the direction has failed Law 1.
3. **Provable-before test.** Point at the prediction and the act. Can you tell, without reading, which came first? (A: yes by the frozen timestamp + track order. B: yes by margin vs text. C: yes by tick x-position + the restraint dot.)
4. **Two-metre test.** Stand 2m from the projected screen. Are Observed / Inferred / Confirmed / Binding still four distinct things? (Texture, glyph, and type survive; hue does not.)
5. **Stop test.** Does the guardrail read as *prohibitive* before you read its text? If it looks like a warning chip, fail.
6. **Continuity-in-place test.** Trigger M2 end to end. Did any existing row, line, or page position move? If yes, fail — that is the current console's disease.

---

## 9. Handoff notes

### 9.1 Tokens

Each direction's palette is in its mockup as CSS custom properties (`design/shadow-v3/mockups/*.html`, top of `<style>`). They are written as plain custom properties so they can be dropped into the console's `@theme` block in `console/src/index.css` or mapped to `--color-*` tokens without touching component logic. **No production file has been modified.**

The one non-negotiable token is the **state set**, shared across directions:

```
--state-observed     --state-inferred     --state-confirmed     --state-binding     --state-contested
```

Any future component that renders a claim must accept a `state` and route it through a single renderer per direction. If a component colors a claim directly, the system is broken.

### 9.2 Mapping from today's components

| Today (`console/src/components/`) | A | B | C |
|---|---|---|---|
| `Prediction.tsx` (card) | `FieldDiff` two-track | margin `Conjecture` + text `Testimony` | `pred` lane ticks + `GapArea` |
| `Question.tsx` (hero card) | `MarginNote` at row `y` | margin `query` + `?` | `q` lane mark + `WaitSegment` |
| `Hypotheses.tsx` (bars in a card) | `ClaimMono` rows at `◌` | stacked `Conjecture` lines | dotted `RuleBar` candidates on the `rules` lane |
| `WorkMapView.tsx` (timeline of cards) | `LedgerTable` | `Clause` + `StopPlate` | swimlanes on the zoomed spine |
| `Threshold.tsx` (SVG bell) | `PosteriorStrip` with interval bracket | `RulerInterval` | `PosteriorBand` along the spine |
| `Mastery.tsx` (fill bars) | 3-segment interval + text delta | margin tally `0.42 → 0.61` | delta beside the lane |
| `Checklist.tsx` (understood rows) | status strip + expanded checklist | a `✓` siglum set on the last clause | "unresolved" filter count on the spine |
| `Feed.tsx` (learning log) | `SilenceStrip` + ledger events | `EvidenceLedger` at document end | the spine itself |
| `Receipts.tsx` (rounded card, colored pills) | serial-numbered ruled slip, two-track diff, verdict stamp | dated apparatus entry + collation sigla | span on the spine; verdict = solid:hatched ratio |
| `ProofPage.tsx` (hash in `<details>`, colored bucket chips) | frozen-prediction ledger, hash legible at rest | notarised page, evaluator writes into it | hatched seal band across the spine |
| `Console.tsx` 3-col grid | stage + gutter + strip | page + exhibit + margin | stage + inspector + spine |
| voice transcript panel | remove; questions are notes | remove; questions are margin queries | remove; questions are lane marks |

The voice transcript panel should be **deleted as a UI surface** in every direction. Shadow's speech is always already represented as a claim, a question, or a mark with its provenance; a chat log is redundant, off-brand, and the single strongest "generic AI product" signal in the current build. Keep the *audio*; drop the *bubbles*.

### 9.3 Build order if adopted

1. The state token set + one `ClaimRenderer` per direction. Everything else depends on it.
2. The provenance primitive (`ProvBlock` in A, `Siglum` in B, `Mark` in C).
3. The three moments, one at a time, in the order M1 → M3 → M2 (M2 is the hardest).
4. The guardrail's structural component (band / plate / lane) — this is the "never cut" requirement.
5. The Work Map artifact view.
6. Motion last, and only the four to five motions each direction lists. Anything else is a bug.

---

## 10. Mockups

`design/shadow-v3/mockups/` contains one self-contained HTML file per direction:

- `a-instrument.html`
- `b-codex.html`
- `c-shift.html`

Each is dependency-free (no CDN, no build, no network), opens directly in a browser, and has a state switcher for **Capture · Work Map · Debrief · Tutor** so the four modes and the three moments can be reviewed side by side. They render the real demo content — invoice 4471 Hessler, €6,400 net, no asset number, Sabine's quote, Krämer, Nordwerk CZ — so the comparison is honest.

To view: open the files directly, or `python3 -m http.server` from `design/shadow-v3/mockups/`.
