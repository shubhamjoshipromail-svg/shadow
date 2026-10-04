# STORYBOARD — 75-second demo film

**TL;DR.** One 75-second film. Hook (Sabine retiring, the 2019 doc covers half) → Capture (guess written
before she acts → she books capex → Mira asks at the pause → answer → receipt before/after) → Sealed test
(frozen hash, labels, correction) → Tutor (new hire blocked in Sabine's words) → Close (Work Map signed,
tagline). The capture and tutor beats are recorded in **Rehearsal (simulated expert)** against the deployed
build by `record.mjs`; the sealed-test beats are inserts from the **verified live run of 2026-10-03** (a
Rehearsal session refuses sealed tests by design, so they cannot be faked). Every frame is the product.

## Names (one place)

Product name is undecided. These four strings are the only place names change, and `record.mjs` mirrors them
in its `NAMES` constant (`--product`, `--character`, `--expert`, `--trainee` override on the command line):

| Token | Value today | Where it appears |
|---|---|---|
| `PRODUCT_NAME` | **Tacet** (repo still says "Shadow") | wordmark, S5.3 tagline card, agent export |
| `CHARACTER_NAME` | **Mira** | companion, tutor blocks, captions |
| expert | **Sabine** | ERP, expert voice, quotes |
| trainee | **Lena** | tutor beat |

Captions below are written with those values. If the name changes, re-render captions from the same constant —
do not hand-edit twenty caption strings.

## Format

- Master 1920×1080, 16:9, 25 fps. Recorder frames: 1600×900 at device scale 1.5 (2400×1350 PNG).
- Warm-paper design system (`design/DESIGN.md`): Newsreader for testimony, Geist for interface, IBM Plex Mono
  for codes/amounts/hashes. No gradients, glow, emoji or stock-AI imagery. Motion terminates; one loop only.
- Calm. Long holds on real screens, no whip-pans, no zoom punches. Captions sit bottom-left in IBM Plex Mono,
  11 px master, on the paper value, never over the amount being read.
- No cursor is drawn; the recorder hides scrollbars and moves the pointer off-screen before each capture.

## Shot list

| Shot | Time | On screen | URL / state | Caption (burned in) | How the recorder gets it |
|---|---|---|---|---|---|
| **S1.1** | 0:00–0:03 (3s) | The 2019 work instruction, quoted: "Equipment and IT hardware: cost center **4711**". A brick rule marks the line. | Local card (no server) | *The written process is from 2019.* | `titleCard('2019-doc')` → `frames/S1.1-2019-doc.png` |
| **S1.2** | 0:03–0:08 (5s) | Nordwerk ERP, AP inbox: month-end banner, "4 invoices open", Sabine's queue. | `{{ERP}}/?shadow={sid}` | *Sabine has done this for 24 years. She retires Friday.* | navigate ERP pinned to `sid`, wait for `[data-shadow-entity]` |
| **S2.1** | 0:08–0:12 (4s) | Invoice 4471 (Schmidt Antriebstechnik, machine) open; the companion in the corner writes its guess. | `{{ERP}}/invoice/inv-4471?shadow={sid}` | *Before she touches it, Mira writes its guess down.* | `simStep()` → `{did:"opened"}`; wait for companion `prediction` state |
| **S2.2** | 0:12–0:16 (4s) | Booking panel, cost center changed to **0400** (Capex – Machinery). | same ERP tab | *She books it to 0400 — capex. The doc said 4711.* | set `[data-shadow-field=cost_center]` to `0400`, dispatch `change`+`blur`; `simStep()` → `{did:"decided"}` |
| **S2.3** | 0:16–0:20 (4s) | Notebook, left column: **Natural pause. Shadow may speak.** (the companion's raised hand is on the ERP tab — B-roll). | `{{CONSOLE}}/s/{sid}` | *It doesn't interrupt. It waits for a pause.* | wait until snapshot `pending.awaiting` is set; capture console |
| **S2.4** | 0:20–0:26 (6s) | Question panel: **"You coded invoice 4471 to 0400 instead of 4711. What made you do that?"**, with the hypothesis bars behind it (capex 0.95). | `{{CONSOLE}}/s/{sid}` | *Then it asks one question: what made her do that?* | `simStep()` → `{did:"answered", said, reply}`; capture console |
| **S2.5** | 0:26–0:31 (5s) | Learning receipts: before **4711** → after **0400**, her quote, the rule and the new net threshold. | `{{CONSOLE}}/s/{sid}` | *Her answer becomes a rule. Before: 4711. Now: 0400.* | wait for snapshot `receipts[0]` with a non-empty diff; capture |
| **S2.6** | 0:31–0:34 (3s) | Companion toast in the ERP: "Noted: Equipment over 5,000 EUR net is capex · I'd have said 4711, now 0400". | ERP tab | *The before and the after, written down.* | capture same ERP tab after the receipt |
| **S3.1** | 0:34–0:39 (5s) | Sealed-test page: the learned threshold posterior, wide interval, hairline curve. | `{{CONSOLE}}/s/{proofSid}/proof` | *Independent test. Pick the threshold she just taught.* | navigate proof page for `--proof-session` (live insert) |
| **S3.2** | 0:39–0:44 (5s) | Frozen commitment: SHA-256 groups, "published before any label", 11 unseen invoices. | `{{CONSOLE}}/s/{proofSid}/proof` | *11 unseen invoices, committed with a hash before any label.* | same page, scroll to the commitment plate |
| **S3.3** | 0:44–0:47 (3s) | Labelling: two rows marked ✗, both in the 3,600–4,000 band. | `{{CONSOLE}}/s/{proofSid}/proof` | *Two are wrong. Both just under the line.* | live-insert frame (pre-labelled proof) |
| **S3.4** | 0:47–0:50 (3s) | Next round: 11/11, map v2, "Each miss teaches." | `{{CONSOLE}}/s/{proofSid}/proof` | *Each miss corrects the map. Next round: 11 for 11.* | live-insert frame (second round proof) |
| **S4.1** | 0:50–0:54 (4s) | Notebook header flips to **Tutor · Lena learning from Sabine**; ERP opens invoice 5120 (machine €7,200, no asset number). | `{{CONSOLE}}/s/{tutorSid}` then `{{ERP}}/invoice/inv-5120?shadow={tutorSid}` | *Monday. A new hire gets the same invoices.* | create tutor session `{mode:"tutor", from_session:captureSid, simulate:true}` |
| **S4.2** | 0:54–0:59 (5s) | Lena follows the 2019 doc: cost center **4711** (Opex – Maintenance). | ERP tutor tab | *She codes it 4711 — exactly what the 2019 doc says.* | set `cost_center=4711` (no save yet) |
| **S4.3** | 0:59–1:03 (4s) | The stop plate, brick left rule, over the form: **"Sabine would stop here. Why do you think?"** plus her quote underneath. | ERP tutor tab + notebook "Stops" | *Mira stops the save — in Sabine's words.* | `simStep()` → `{did:"trainee_mistake"}`; the `intervene` plate in the ERP (the notebook "Stops" panel is B-roll for the same beat) |
| **S4.4** | 1:03–1:06 (3s) | Lena's mastery panel: the rule drops to *practice*, the rest stay *shaky / mastered*. | `{{CONSOLE}}/s/{tutorSid}` | *Then it steps back and lets her work.* | capture mastery after the blocked attempt |
| **S5.1** | 1:06–1:10 (4s) | The Work Map v1: "How Sabine processes a supplier invoice", the 2019-doc clauses in grey, §3 carrying her rule and quote. The signature block sits just below the fold — pan down in the edit. | `{{CONSOLE}}/s/{sid}/map` | *The Work Map. Every line links to the moment and her words.* | navigate map page |
| **S5.2** | 1:10–1:13 (3s) | Agent export, plain markdown: guardrails with `when` conditions. | `{{CORE}}/api/sessions/{sid}/export/skill` | *Exportable to agents — as guardrails, not advice.* | navigate export URL, capture text page |
| **S5.3** | 1:13–1:15 (2s) | Tagline card on paper: **"Learns the part of the job nobody wrote down."** Wordmark `{{PRODUCT_NAME}}`. | Local card | *(tagline)* | `titleCard('tagline')` |

Total: 75 s (3+5 · 4+4+4+6+5+3 · 5+5+3+3 · 4+5+4+3 · 4+3+2).

## Beat notes

### Hook (0:00–0:08)

Open on the document, not a logo. The 2019 instruction really does say equipment goes to 4711; the film's whole
claim is that the written process covers half of the job. Sabine's line is never "I'm retiring and worried" —
she is matter-of-fact. The banner in the ERP ("Month-end close in 2 days") is real product copy and does the
urgency work for us.

### Capture (0:08–0:34)

The order matters: **guess first, action second, question third, receipt fourth.** S2.1 is the only frame where
the companion is the subject. S2.2 keeps the expert the subject (her hand, her 0400). S2.3 holds a beat on
"Natural pause" so the viewer feels the *not* asking. S2.4 is one question, not a chat. S2.5 shows the receipt,
which is the product's honesty: it prints what it believed before and after, and attributes the rule to her
quote. S2.6 is the in-app payoff for someone who never opens the notebook.

### Sealed test (0:34–0:50)

Recorded from a **live** session: `POST /api/sessions/{sid}/proofs` refuses Rehearsal sessions on purpose. The
numbers are the verified run from `CLAUDE.md`: evaluator taught 3,600; round 1 scored 9/11 with both misses in
the 3,600–4,000 band; the counterexample moved the threshold to 4,069; after "Restart from saved map" round 2
was 11/11. Use the real proof page (`/s/{sid}/proof`), including the "recompute the hash" details block if the
edit needs two more seconds. Never stage a fake hash: the page prints the exact hashed text.

### Tutor (0:50–1:06)

Same four-invoice world, different role. The tutor session is created from the capture session's map
(`from_session`), so the block is genuinely the rule Sabine just taught, not a script. Lena codes the machine
to 4711 because that is what the 2019 doc says; the learned capex rule expects 0400 at €5,000 net and stops
her. The block plate quotes her; the notebook's "Stops" panel is the second half of the same beat. S4.4 is the
anti-nanny beat: mastery drops on the broken rule only, then Shadow goes quiet again.

### Close (1:06–1:15)

The signed Work Map is the deliverable and the last thing a judge should remember. Hold on the signature block
for a full second. S5.2 exists to answer "can agents use this?" without a feature list. S5.3 is two seconds,
paper and ink, tagline only — no product UI.

## Honesty rules for the edit

1. Label the mode on screen for any rehearsal frame if a frame could be mistaken for live (a small mono
   "rehearsal" mark, as the product itself shows in the header). The product already prints
   "rehearsal · simulated Sabine" in the console folio; keep that legible in S2.x and S4.x.
2. Do not animate a prediction the product did not make. The receipt's before/after is the only montage.
3. If the sealed-test inserts are from an older build, say so in the description; do not blend them with the
   rehearsal frames without a cut.
4. The 2019 doc card must quote the file (`backend/shadow/packs/ap_invoices/process_doc_2019.md`), not a cleaned
   paraphrase.

## Assembly

`record.mjs` writes one PNG per shot plus `frames/manifest.json` (shot id, in/out, caption, VO line, file). Add
captions and the ElevenLabs read in the editor, then mux per `design/video/README.md` (ffmpeg command). The
storyboard's timings are the cut list; the manifest is the source of truth for file names.
