# Landing page (`site/`)

A standalone, self-contained marketing page for the apprentice product — warm paper, ink, one sage accent, the
`design/DESIGN.md` register. No build step, no dependencies, no server required.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The whole page: markup, tokens, styles and two small inline scripts. |
| `assets/mira-sprite.png` | The 2×2 pixel-art sprite (copied from `backend/shadow/static/intern.png`). Cropped to one frame with `background-position`. |
| `assets/poster.svg` | The 16:9 poster for the video slot — authored as SVG, no stock imagery. |
| `assets/demo.mp4` | **Not present.** The video slot falls back to the poster until you drop a real clip here. |
| `shots/desktop-1440.png`, `shots/mobile-390.png` | Acceptance screenshots (headless Chrome 154). |

## Preview

```bash
# either open the file directly
open site/index.html

# or serve it (a port other than :8000)
cd site && python3 -m http.server 8130
```

## Rename the product (one constant)

Open `site/index.html` and edit the single `BRAND` object near the bottom:

```js
const BRAND = { product: 'Tacet', character: 'Mira' };
```

Every occurrence in the wordmark, headings, nav, footer, `<title>` and meta description is rendered from it (each
slot is an empty `data-brand="product"` or `data-brand="character"` element filled at parse time), so the name
literal lives in exactly one place. Alt text and aria-labels are name-free. Without JavaScript the page still
renders, but the wordmark and the “Meet —” heading are blank.

## Add the demo video

Put the clip at `site/assets/demo.mp4`. It is `preload="metadata"`, `muted`, `playsinline`, with `controls`. The
inline script only fades the video in on `loadeddata`, so a missing file leaves the poster in place cleanly (no
broken player).

## Screenshots (acceptance check)

The committed shots are **full-page** captures (the page is ~5,480 px tall at 1440, ~6,746 px at 390), taken with
headless Chrome 154 through the DevTools Protocol so `captureBeyondViewport` can reach past the fold:

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

Static — deploy as-is (any static host, or a Railway static service rooted at `site/`). The two CTAs point at the
deployed core (`https://core-production-c5ac.up.railway.app`) and sandbox ERP
(`https://erp-production-e3b0.up.railway.app`). Nothing here imports from the app or `console/`.
