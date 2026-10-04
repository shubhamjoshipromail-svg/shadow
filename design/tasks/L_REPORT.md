# L · LANDING — shorter, video first — report

Task: `design/tasks/QUEUE_2026-10-04.md` § L. Owns `site/**` only.
Product name lives in one constant, now `NAME` (shared rule), not `BRAND`.

## What changed

`site/index.html` was rewritten from a ~5,480 px document into a **video-first page of three 1440×900 screens**
(2,496 px total, 2.77 screens) with the same design system (warm paper, ink, one sage accent; Newsreader titles /
Geist interface / IBM Plex Mono evidence; 1 px rules; provenance marks `▮ ◌ ✓ ■ §`; radius ≤ 4 px; no gradients,
glow, glass, sparkle, chat bubbles or emoji; the only loop is the capture tick).

Structure, top to bottom:

1. **Hero** — masthead + one-line kicker, the h1 tagline, exactly **one line** of lede (measured 29 px high at
   18 px type = a single rendered line), then the 16:9 **video centrepiece** (`assets/demo.mp4`, `assets/poster.svg`
   poster fallback — the placeholder holds until the clip exists), then the **two buttons**:
   * **“Try it” → `/app`** (the product’s future home),
   * **“Watch the demo” → `#demo`** (scrolls to the video; starts it when the clip is present).
2. **The three moments** — a single compact 3-column row: *guess → ask once → stop the new hire*, each with a tiny
   visual built from the existing plates/marks.
3. **Proof strip + CTA** — one strip with the learning receipt (before `€3,600` → after `€4,000`, quote, case id)
   beside the sealed boundary test (**11 / 11**, with the honest round-1 `9 / 11` and the T re-fit visible) and the
   honest label *“labels come from humans only · each label also teaches”*. Below it, one line of **simulated**
   held-out eval (doc-only 38% / always-ask-why 73% / apprentice 98% / 0% confabulation), then a single closing CTA.
4. **Privacy** — one line (`§ Bank accounts, cards and emails are scrubbed…`), whose link opens the `#data`
   `<details>` section, **collapsed by default**; the full three-column ledger lives inside it.

`site/README.md` updated: three-screen description, `NAME` rename instructions, video behaviour, new full-page
heights, `/app` CTA note.

No engine/main/store file touched; nothing committed.

## Acceptance checks

### 1. Screenshots at 1440 and 390 → `site/shots/`

Captured full-page with headless Chrome 154 over CDP (port **9334**, not :8000), `captureBeyondViewport`:

```
desktop-1440 1440 contentHeight 2496
wrote site/shots/desktop-1440.png
mobile-390 390 contentHeight 3057
wrote site/shots/mobile-390.png
```

```
site/shots/desktop-1440.png (1440, 2496)
site/shots/mobile-390.png    (390, 3057)
```

2,496 px at 1440×900 = **2.77 screens** → “at most ~3 screens” satisfied. Viewport reads at exactly 1440×900 show
the hero video **and both buttons** inside screen 1.

### 2. DOM / behaviour checks (CDP `Runtime.evaluate`)

```json
{
  "title": "Tacet — learns the part of the job nobody wrote down",
  "brand": "Tacet",
  "tryHrefs": ["/app", "/app"],
  "watchIds": ["nav-watch", "watch-demo", "watch-demo-2"],
  "detailsOpenBefore": false,
  "detailsOpenAfter": true,
  "h1": "Learns the part of the job nobody wrote down.",
  "ledeHeight": 29,
  "ledeFontSize": "18px",
  "momentCols": 3,
  "sections": 3,
  "hasVideoSrc": "assets/demo.mp4",
  "slotClass": "video-slot",
  "detailsText": "Data & privacy The whole ledger, in plain language.",
  "gridTemplate": "345.328px 345.328px 345.344px"
}
```

Readings: the product name still renders from the single `NAME` constant; both “Try it” buttons point at `/app`;
three watch-demo triggers exist; the privacy `<details>` is closed on load and opens when the privacy link is
clicked; the hero lede is one line; the moments row is three columns; there are exactly three `<main>` sections
(moments, proof, CTA); the video uses `assets/demo.mp4` and the slot stays on the poster (`class="video-slot"`, no
`has-video`) because the clip is absent — the intended fallback, not a broken player.

### 3. Full-suite regression

Not applicable — task L touches only static `site/**`; no Python/TS code changed, so `pytest` is unaffected. (The
repo was mid-flight with other queue tasks G/C/S editing `backend/**` in the same working tree; I did not run the
suite to avoid reporting on their in-progress state.)

## Notes for Claude

- **Rename tool:** `scripts/rename_product.py` still has the `site/*` prefix unwired (“wire into RENAME_PREFIXES on
  integration”). The single constant is now `NAME` (`site/index.html`, near the bottom), so point that prefix there.
- **Video:** `site/assets/demo.mp4` does not exist yet (task T4 produced the kit, not the clip). Drop the file in and
  the player fades in and “Watch the demo” starts it; no markup change required.
- **`/app`:** both “Try it” buttons are plain relative links to `/app`; when the product moves there, serve `site/`
  at the root (or add a redirect) so the link resolves.
