# Shadow v3 — Interface Directions (design deliverable)

Art direction for the four product states — **Capture · Work Map · Debrief · Tutor** — for the HackNation × ElevenLabs "AI Apprentice" submission.

**Nothing in this folder touches production code.** No file under `src/`, `console/`, `backend/`, or any config was modified. This is a design document plus three standalone visual mockups.

## Read this first

| File | What it is |
|---|---|
| [`DIRECTIONS.md`](DIRECTIONS.md) | The full art-direction document. Start with §2 Foundations, then §7 Recommendation. |
| [`mockups/a-instrument.html`](mockups/a-instrument.html) | **Direction A — INSTRUMENT.** Light, dense, hairline-ruled audit instrument. Shadow is a diff gutter row-locked to the expert's own fields. Rules are set in monospace because a rule is code. |
| [`mockups/b-codex.html`](mockups/b-codex.html) | **Direction B — CODEX.** Warm paper, one measure, Shadow as marginalia. The four provenance states are the four *typographic voices*; uncertainty resolves by rewriting the page. |
| [`mockups/c-shift.html`](mockups/c-shift.html) | **Direction C — THE SHIFT.** Time is the spine. Four modes are four scales of one timeline; uncertainty is the *area between the prediction tick and the act tick*. |

## Viewing the mockups

Each mockup is a single dependency-free HTML file — no CDN, no build, no network. Open directly:

```bash
open design/shadow-v3/mockups/a-instrument.html
```

or serve them:

```bash
cd design/shadow-v3/mockups && python3 -m http.server 8090
```

Each has a switcher for **Capture / Work Map / Debrief / Tutor**.

## The shared spine of the argument

All three directions render the same four provenance states, and all three are built so that state survives **grayscale, projection, and print** — never hue alone:

| State | Meaning | A — Instrument | B — Codex | C — The Shift |
|---|---|---|---|---|
| **Observed** | the expert did this; quote, moment, timestamp | `▮` + 2px solid rule | serif roman, **quoted** | solid tick |
| **Inferred** | the machine guesses this; revocable | `◌` + dashed rule, 62% ink | sans italic, 62% ink | dotted tick / dotted bar |
| **Confirmed** | survived counterfactual, replay, teach-back | `✓` + closed underline | serif roman, solid, ruled | solid + doubled bar |
| **Binding** | a guardrail; it forbids | `■` band, 4px rule | Stop Plate (small caps, the only box) | hatched 45° band |

And all three give a dedicated, non-modal rendering to the three moments the brief prioritises:

1. **prediction → divergence** — the pre-commitment must be provably earlier, and the divergence must be *spatial* (two values in one place), never a toast.
2. **question → knowledge crystallization** — one object changes state in place: dashed closes, italic sets to roman, dotted solidifies. No new card ever appears.
3. **learned guardrail → trainee intervention** — the interface physically *stops*, and the stop is attributed to the retiring expert's words, not to a validation error or a modal.

## Recommendation in one line

Ship **B's provenance system** as the product's identity, borrow **A's rigor patterns** (fixed provenance slot, held control with required reason, ledger view, rows never reflow), and use **C's spine** for Debrief, Tutor, and the demo's opening — the residual-as-area graphic is the strongest ten seconds in this document. Do not average the three; pick a register per mode deliberately.

Full reasoning and a 30-minute evaluation rubric: [`DIRECTIONS.md` §7–§8](DIRECTIONS.md).
