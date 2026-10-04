# Landing page (`site/`)

A standalone, self-contained marketing page for Tacet — warm paper, ink, one sage accent, the
`design/DESIGN.md` register. No build step, no dependencies, no server required.

The page is **five bands at 1440×900** (4,255 px tall, ≈ 4.7 screens) with one vertical measure: every band uses the
same top/bottom spacing (`--sec`) and the same content grid (`--maxw` 1180 px, `--pad`).

1. **Hero — the film.** The tagline, one line of copy, then the product film at full content width (1092 px, edge to
   edge within the measure). It autoplays muted, inline and looping; a caption bar rendered from `assets/film.vtt`
   tracks the active cue; a small **Sound on** button unmutes. A missing clip leaves the poster holding cleanly.
2. **How it learns** — the three moments in one row: *guess → ask once → stop the next person*, each with a tiny
   visual built from the rules and marks.
3. **Proof** — the learning receipt (before `€3,600` → after `€4,069`, moved by two counterexamples) beside the sealed
   boundary test (round 1 `9 / 11`, both misses in the `€3,600 – €4,000` band, restart `11 / 11`), then one held-out
   evaluation line.
4. **Meet Mira** — the pixel-art sprite and the three rules of the character.
5. **Data & privacy** — one line linking to the full ledger, collapsed by default. A single closing CTA follows.

Navigation: wordmark, anchors **Product · How it learns · Mira · Privacy**, a primary **Open Tacet → `/app`** and a
secondary **Talk to us → `mailto:hello@tacet.work`**.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The whole page: markup, tokens, styles and the small inline scripts. |
| `assets/mira-sprite.png` | The 2×2 pixel-art sprite (copied from `backend/shadow/static/intern.png`). |
| `assets/poster.svg` | The 16:9 poster — authored as SVG, no stock imagery. Used for the `<video poster>` and as the `<img>` fallback. |
| `assets/poster.jpg` | **Optional.** The film build drops a still here; the `<img>` tries it first and falls back to `poster.svg` on error. |
| `assets/film.mp4` | **Not present.** The film build (`design/video/`) writes the real clip; without it the poster holds. |
| `assets/film.vtt` | The film captions. Authored here from `design/video/voiceover.txt`; `design/video/make_vtt.mjs` regenerates the authoritative copy. |
| `shots/desktop-1440.png`, `shots/mobile-390.png` | Acceptance screenshots (headless Chrome 154, full page). |

## The film

The player has **no controls bar, no play overlay and no radius beyond 4 px** — it reads as part of the page, not an
embedded player. It is started from JavaScript (so `prefers-reduced-motion: reduce` can hold the poster and offer a
**Play film** text button instead of autoplaying). Captions are parsed from `assets/film.vtt` (~30 lines of vanilla JS,
extracted verbatim by the acceptance check in `design/tasks/L2_REPORT.md`) and rendered into the styled caption bar;
the browser's native track styling is never used. A missing `film.mp4` (or `film.vtt`) simply leaves the poster and
hides the caption bar — no broken player, no dead buttons.

## Rename the product (one constant)

Open `site/index.html` and edit the single `NAME` object near the bottom:

```js
const NAME = { product: 'Tacet', character: 'Mira' };
```

Every occurrence in the wordmark, nav button, headings, footer, `<title>` and meta description is rendered from it
(each slot is an empty `data-brand="product"` element filled at parse time), so the name literal lives in exactly one
place. `character` drives the Mira heading and copy. Alt text and aria-labels are name-free.

> Note for the rename tool (`scripts/rename_product.py`): point the `site/*` prefix at this `NAME` object when the
> landing page is integrated. The `mailto:` address is a placeholder (`hello@tacet.work`) and is the one string the
> constant does not cover.

Without JavaScript the page still renders, but the brand slots would be blank.

## Preview

```bash
# either open the file directly (the film.vtt fetch needs a server for captions)
open site/index.html

# or serve it on any port other than :8000
cd site && python3 -m http.server 8130
```

## Screenshots (acceptance check)

The committed shots are **full-page** captures (4,255 px tall at 1440, 5,235 px at 390), taken with headless
Chrome 154 through the DevTools Protocol so `captureBeyondViewport` can reach past the fold:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir=/tmp/chrome-site --remote-debugging-port=9335 \
  --remote-allow-origins='*' about:blank
# then, over CDP: Emulation.setDeviceMetricsOverride {width:1440|390},
# Page.navigate to http://localhost:8131/, await document.fonts.ready,
# Page.captureScreenshot {format:'png', fromSurface:true, captureBeyondViewport:true}
```

## Integration note

Static — deploy as-is (any static host, or a Railway static service rooted at `site/`). Brand slots stay name-free;
the CTAs render from `NAME` and point at `/app` (the product's home) and `mailto:hello@tacet.work`. Nothing here
imports from the app or `console/`.
