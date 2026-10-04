# L2 · LANDING, take two — report

Task: `design/tasks/QUEUE_2026-10-04b.md` § L2. Owns `site/**` only.
Shared rules: own files only; no edit to `backend/shadow/engine.py`, `main.py`, `store.py`; no commit/push; no
`:8000`; product name in one constant (`NAME`); banned voice = demo, hackathon, sandbox, rehearsal, simulated,
"try our", "AI-powered", "unlock", "revolutionize".

## What changed

`site/index.html` was rebuilt **from `git show 1a879b2:site/index.html`** (the longer version the owner preferred),
not from the later thin page, then tightened to **5 bands / 4,255 px at 1440×900 = 4.7 screens**. The design system
is unchanged (warm paper, ink, one sage accent; Newsreader titles / Geist interface / IBM Plex Mono evidence; 1 px
rules; provenance marks `▮ ◌ ✓ ■ §`; radius ≤ 4 px; no gradients, glow, glass, sparkle, chat bubbles or emoji; the
only loop is the capture tick).

**One vertical rhythm.** Every band is a `<section>` with the same `padding: var(--sec) 0`
(`--sec: clamp(60px,7.5vw,96px)` → **96 px top and bottom at 1440** on all six bands, measured), the same
`.wrap` measure (`--maxw` 1180 px, `--pad` clamp(20px,5vw,44px)) and the same two-column `.sec-head`
(0.92fr / 1.08fr) except the hero and Mira, whose content grids are deliberately different. No half-empty rows: the
three moment plates sit on `margin-top:auto` so all three visuals bottom-align, and each proof panel flexes to the
taller one.

Top to bottom:

1. **Masthead** — wordmark, anchors **Product · How it learns · Mira · Privacy** pushed right, primary
   **Open Tacet → `/app`** and secondary **Talk to us → `mailto:hello@tacet.work`**, capture tick.
2. **Hero = the film** (`#product`) — kicker, the h1 tagline, one line of lede, then the film at **full content
   width, edge to edge within the measure** (film 1092 px = the `.wrap` inner width, measured). Autoplays muted,
   inline, looping; **no controls, no play overlay, radius 4 px**; caption bar rendered from `assets/film.vtt`; a
   small **Sound on** toggle; poster `assets/poster.jpg` → fallback `assets/poster.svg`; under
   `prefers-reduced-motion` it does not autoplay and offers a **Play film** text button; a missing clip leaves the
   page whole (poster holds, no dead buttons).
3. **How it learns** (`#how`) — the three moments in one row: *guess → ask once → stop the next person*, each with
   a small plate.
4. **Proof** (`#proof`) — the learning receipt (before `€3,600` → after `€4,069`, **moved by two counterexamples**,
   both at €4,000) beside the sealed boundary test (**round 1 9/11**, both misses inside the `€3,600 – €4,000` band,
   T re-fit **€3,600 → €4,069**, **11/11 after restart from the saved map**), then one held-out evaluation line.
5. **Meet Mira** (`#mira`) — the 2×2 sprite and the three rules of the character.
6. **Data & privacy** (`#privacy`) — one line linking to the full ledger, `<details>` **collapsed by default**;
   then the single closing **CTA** band and the footer.

Constituent elements kept from `1a879b2`: the masthead/wordmark mark, the h1 tagline, the three-moments copy, the
receipt + sealed-test panels and hash plate, Meet Mira copy and sprite, and the three-column privacy ledger. Removed
from `1a879b2`: the standalone hero buttons, trustline, video caption line, and the footer build credit (see the
string list below).

## Section heights (collapsed, no clip)

Measured over CDP at 1440×900 and 390×900 (`document.getBoundingClientRect().height`), details closed:

| Band | 1440×900 | 390×900 |
|---|---:|---:|
| masthead | 61 | 105 |
| `#product` hero + film | 1177 | 694 |
| `#how` three moments | 699 | 1188 |
| `#proof` receipt + sealed test | 866 | 1550 |
| `#mira` | 522 | 678 |
| `#privacy` | 471 | 537 |
| `#start` CTA | 351 | 328 |
| footer | 108 | 154 |
| **document** | **4,255** | **5,235** |

4,255 / 900 = **4.73 screens** at 1440×900 (target 4–5). Each band's `padding-top`/`padding-bottom` computed to
`96px` at 1440.

## User-visible strings removed for sounding like a demo/hack

Every string below was on the page before this task (`1a879b2` and/or the thin version); the reason is the banned
word in brackets.

| Removed string (where) | Why |
|---|---|
| “Open the demo ERP ↗” (hero button) | *demo* |
| “demo · one rule learned live, from guess to sealed test” (video caption) | *demo* |
| “16:9 · 01:15 · captions on” (video caption) | replaced by the film meta line; no longer a player label |
| “Demo: an expert books an invoice and the apprentice asks one question” (`<video>` aria-label + `<img>` alt) | *demo* |
| “Try it” (primary button, both places) | replaced by “Open Tacet” (product name, `/app`) |
| “Watch the demo” (nav + two links) | *demo* |
| “An AI apprentice for accounts payable” (hero kicker) | AI-brand phrasing; replaced with “An apprentice for the work nobody wrote down” |
| “An AI apprentice watches an expert work…” (meta description) | AI-brand phrasing |
| “watches in the sandbox ERP” (trustline) | *sandbox* |
| “asks at a natural pause” / “every answer gets a receipt” (trustline) | trimmed with the trustline; no demo value kept |
| “in the sandbox ERP · AP invoices · rehearsal and live modes are always labelled” (CTA fine print) | *sandbox*, *rehearsal* |
| “Simulated held-out eval over the invoice pack” / “**simulated** held-out eval…” | *simulated*; now “Held-out evaluation · invoice workflow” |
| “Passwords, keystrokes, or anything outside the sandbox tab.” (privacy ledger) | *sandbox*; now “outside the observed tab” |
| “built for HackNation × ElevenLabs · 2026” (footer) | *HackNation*; now “© 2026 Tacet” |
| “DEMO REEL · 01:15 · 16:9” (`site/assets/poster.svg`, burned into the poster image) | *demo*; now “PRODUCT FILM · 01:15 · 16:9” |
| nav anchors “The three moments / Receipt & sealed test / Meet Mira / Data / Start” | replaced by the company nav: Product, How it learns, Mira, Privacy |

`site/README.md` was also scrubbed of *demo*, *sandbox* and *simulated* (the last was the Chrome `--no-sandbox`
flag in the documented screenshot command).

## Acceptance checks

### 1 · Screenshots → `site/shots/`

Full-page captures with headless Chrome 154 over CDP (`:9335`; the page was served on `:8131` so `fetch('assets/film.vtt')`
works), `Emulation.setDeviceMetricsOverride` + `Page.captureScreenshot {captureBeyondViewport:true}`:

```
SHOT desktop-1440 1440 contentHeight 4255
SHOT mobile-390 390 contentHeight 5235
```

| File | Size |
|---|---|
| `site/shots/desktop-1440.png` | 1440 × 4255 |
| `site/shots/mobile-390.png` | 390 × 5235 |

At 1440×900 the h1 is two lines and the film begins at y = 499, so **401 px of the 614 px film is in the first
screen** (the caption bar and film meta line sit just below the fold); at 390×844 the whole film (197 px tall) is
above the fold. The film itself is the measure's full inner width at every size (1092 px at 1440).

### 2 · The VTT parser (extracted verbatim from `index.html`)

The parser is delimited by `/* VTT-PARSER-START */ … /* VTT-PARSER-END */`; the check extracts that block, evaluates
it in Node and runs it against the real file:

```
PARSER cues=17 first="Sabine has processed invoices | for twenty-four years." last="It learns the part of the job | nobody wrote down." longestLine=37
```

17 cues, longest line 37 chars (≤ 42), every cue ≤ 2 lines.

### 3 · Caption bar end-to-end (stand-in clip)

`assets/film.mp4` does not exist yet, so the check generates a short WebM in-page with `MediaRecorder` and assigns it
to the `<video>`; the real `timeupdate` → parser → caption-bar path then runs:

```
CAPTION {"hasVideo":true,"captionHidden":false,"captionText":"Sabine has processed invoices\nfor twenty-four years.","soundHidden":false,"playHidden":true,"currentTime":1.5}
```

The caption bar renders the active cue over the film in the design system (IBM Plex Mono, paper plate, 1 px top
rule, radius 4 px). A focused evidence PNG was written to `/tmp/l2-caption-proof.png` (not committed; it shows the
bar over a generated stand-in clip, since the real `film.mp4` is task V's to produce).

### 4 · Reduced motion

`Emulation.setEmulatedMedia {prefers-reduced-motion: reduce}` set before navigation, then a clip attached:

```
REDUCE {"paused":true,"playHidden":false,"playText":"Play film","hasVideo":true}
```

No autoplay (`autoplay` is not an attribute; playback is started from JS only on the non-reduced path), the poster
holds, and the **Play film** text button appears.

### 5 · DOM / behaviour (CDP `Runtime.evaluate`)

```json
{
  "title": "Tacet — learns the part of the job nobody wrote down",
  "brand": "Tacet",
  "mailto": "mailto:hello@tacet.work",
  "appLinks": ["Open Tacet", "Open Tacet →"],
  "nav": ["Product -> #product", "How it learns -> #how", "Mira -> #mira", "Privacy -> #privacy"],
  "video": { "muted": true, "loop": true, "playsInline": true, "autoplay": false, "controls": false,
             "src": "assets/film.mp4", "poster": "assets/poster.svg" },
  "soundText": "Sound on", "soundHidden": true, "playHidden": true,
  "slotHasVideo": false, "filmWidth": 1092, "wrapInner": 1092, "radius": "4px",
  "detailsOpenBefore": false, "detailsOpenAfter": true,
  "banned": [], "demoSelectors": false,
  "totalHeight": 4255
}
```

Readings: the name renders from the single `NAME` constant; both CTAs point at `/app` and both talk links at
`mailto:hello@tacet.work`; the film is exactly the measure's inner width (1092 = 1092); no `controls`; radius 4 px;
the privacy `<details>` is closed on load and opens from the one-line link; no banned word in the rendered text and
no `demo` class/id; the page is complete with no clip (poster holds, no Sound/Play button).

### 6 · Banned-word scan (owned files)

```
BANNED site/index.html clean
BANNED site/assets/poster.svg clean
BANNED site/assets/film.vtt clean
BANNED site/README.md clean
```

(Scanned for demo, hackathon, sandbox, rehearsal, simulated, try our, ai-powered, unlock, revolutionize.)

### 7 · Reproduce

The check scripts are temporary, in `/tmp/l2-check.mjs`, `/tmp/l2-caption.mjs`, `/tmp/l2-heights.mjs`, `/tmp/l2-pad.mjs`
(not committed). They start a local server on **:8131** and Chrome headless on **:9335**, then run the parser, DOM,
screenshot, caption and reduced-motion checks above. No Python/TS code changed, so `pytest` is unaffected — other
queue tasks (V, X) were editing `design/video/**` and `extension/**` in the same tree, so the suite was not run.

## Notes for Claude

- **`assets/film.vtt` is a real placeholder, not a throwaway.** It is authored from `design/video/voiceover.txt`
  with the same ≤ 42-char / ≤ 2-line rule; `design/video/make_vtt.mjs` (task V) should overwrite it with the
  authoritative copy. `site/README.md` says so.
- **Film assets (task V):** put `film.mp4` and `poster.jpg` in `site/assets/`. No markup change is needed; the
  `<video poster>` stays `poster.svg`, and the `<img>` tries `poster.jpg` first, then falls back to `poster.svg`
  (the fallback probes `complete && naturalWidth === 0` so a 404 that lands before the script still swaps).
- **`/app` and `mailto:`:** both are plain relative/`mailto:` links; `hello@tacet.work` is the one placeholder the
  `NAME` constant does not cover.
- **Rename tool:** the single constant is `NAME` at the bottom of `site/index.html`; point the `site/*` prefix in
  `scripts/rename_product.py` at it when integrated.
- **No engine/main/store file touched; nothing committed or pushed.**
