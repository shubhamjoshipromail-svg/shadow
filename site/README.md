# Landing page (`site/`)

A standalone, self-contained marketing page for the apprentice product — warm paper, ink, one sage accent, the
`design/DESIGN.md` register. No build step, no dependencies, no server required.

The page is **three screens at 1440×900** (2,496 px tall) and video-first:

1. **Hero** — tagline, one line of copy, and the 16:9 demo as the centrepiece, then two buttons:
   **“Try it” → `/app`** and **“Watch the demo” → scrolls to `#demo`**.
2. **The three moments** — guess → ask once → stop the new hire, in one compact row with tiny visuals.
3. **Proof strip + CTA** — a learning receipt (before → after) beside the sealed boundary test (11 / 11, honest
   labels) and one line of simulated eval; then a single closing CTA.

Privacy is a single line that opens the `#data` details section, **collapsed by default**.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The whole page: markup, tokens, styles and the small inline scripts. |
| `assets/mira-sprite.png` | The 2×2 pixel-art sprite (copied from `backend/shadow/static/intern.png`). Retained for the app/console; the shortened page no longer shows the character. |
| `assets/poster.svg` | The 16:9 poster for the video slot — authored as SVG, no stock imagery. |
| `assets/demo.mp4` | **Not present.** The video slot falls back to the poster until you drop a real clip here. |
| `shots/desktop-1440.png`, `shots/mobile-390.png` | Acceptance screenshots (headless Chrome 154, full page). |

## Preview

```bash
# either open the file directly
open site/index.html

# or serve it (a port other than :8000)
cd site && python3 -m http.server 8130
```

## Rename the product (one constant)

Open `site/index.html` and edit the single `NAME` object near the bottom:

```js
const NAME = { product: 'Tacet', character: 'Mira' };
```

Every occurrence in the wordmark, footer, `<title>` and meta description is rendered from it (each slot is an empty
`data-brand="product"` element filled at parse time), so the name literal lives in exactly one place. `character`
is kept in the constant for the rename tool even though the shortened page no longer shows the character. Alt text
and aria-labels are name-free. Without JavaScript the page still renders, but the wordmark and footer product slot
would be blank.

> Note for the rename tool (`scripts/rename_product.py`): the `site/*` prefix is still unwired there; point it at
> this `NAME` object when the landing page is integrated.

## Add the demo video

Put the clip at `site/assets/demo.mp4`. The player is `preload="metadata"`, `muted`, `playsinline`, with `controls`.
The inline script only fades the video in on `loadeddata`, so a missing file leaves the poster in place cleanly (no
broken player). Clicking any **“Watch the demo”** link scrolls to `#demo` and, when the clip is present, starts it.

## Screenshots (acceptance check)

The committed shots are **full-page** captures (2,496 px tall at 1440, 3,057 px at 390), taken with headless
Chrome 154 through the DevTools Protocol so `captureBeyondViewport` can reach past the fold:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --user-data-dir=/tmp/chrome-site --remote-debugging-port=9333 \
  --remote-allow-origins='*' about:blank
# then, over CDP: Emulation.setDeviceMetricsOverride {width:1440|390},
# Page.navigate, await document.fonts.ready,
# Page.captureScreenshot {format:'png', fromSurface:true, captureBeyondViewport:true}
```

A quick viewport-only alternative (no CDP) is:

```bash
"$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
  --window-size=1440,900 --screenshot=site/shots/desktop-1440.png "file://$PWD/site/index.html"
```

Chrome writes the file but does not always exit cleanly in this sandbox; kill it afterwards if it hangs.

## Integration note

Static — deploy as-is (any static host, or a Railway static service rooted at `site/`). `<span>`/`<a>` brand slots
stay name-free; the two CTAs render from `NAME` and point at `/app` (the product’s future home) and `#demo`.
Nothing here imports from the app or `console/`.
