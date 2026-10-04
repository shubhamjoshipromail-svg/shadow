# T3 · SITE — landing page (report)

Task: `design/tasks/QUEUE_2026-10-03.md` § T3 · Owner: DeepSeek (headless) · Status: done, not committed.
Only new files were written; nothing existing was edited, nothing was committed or pushed, no server was started on
`:8000` (the page was checked over `file://` and CDP only — no HTTP server at all).

## Deliverables

| File | Size | Notes |
| --- | --- | --- |
| `site/index.html` | 31,529 B · 534 lines | The whole page: tokens, styles, markup, two small inline scripts. |
| `site/README.md` | 3,097 B | Preview, rename, video, screenshot and integration notes. |
| `site/assets/poster.svg` | 5,273 B | 16:9 video poster, authored as SVG (no stock imagery). |
| `site/assets/mira-sprite.png` | 1,036,661 B | Copy of `backend/shadow/static/intern.png` (2×2 sprite). |
| `site/shots/desktop-1440.png` | 712,365 B · 1440×5480 | Full-page acceptance screenshot. |
| `site/shots/mobile-390.png` | 502,065 B · 390×6746 | Full-page acceptance screenshot. |

No `site/assets/demo.mp4` (intentional — the poster holds; see *Video* below).

## What's on the page

One self-contained page in the `design/DESIGN.md` register (warm paper, ink, one sage accent; Newsreader for expert
words/titles, Geist for interface, IBM Plex Mono for evidence; provenance glyphs ▮ ◌ ✓ ■; radius ≤ 4px; no
gradients, glow, emoji or stock imagery; the only looping element is the 6 px capture tick).

1. **Masthead + hero** — wordmark (stacked sage/ink square), section nav, the tagline **“Learns the part of the job
   nobody wrote down.”**, a lede, CTAs and the **16:9 video slot**: `<video src="assets/demo.mp4"
   poster="assets/poster.svg">` over the poster `<img>`; the clip fades in only on `loadeddata`, so a missing file
   leaves the poster cleanly.
2. **The three moments** — a ruled ledger of `01/02/03`: *guesses before she acts* (a plate showing
   `◌ 0400`, written before the save), *asks one question at a pause* (ochre rule, Sabine's quote), *stops the new
   hire in her words* (brick rule, the guardrail).
3. **Receipt + sealed-test proof** — a learning receipt (`before €3,600 → after €4,000`, the quote, rule + provenance)
   and a sealed test (`sha256 … committed …`, round 1 `9/11`, the band `3,600–4,000`, `T → 4,069`, restart `11/11`),
   closed by the simulated held-out eval line (`38% / 73% / 98% at 0% confabulation`, labelled simulated).
4. **Meet Mira** — the sprite cropped to two frames (eyes open / eyes closed) with the character copy and three
   promises (invisible until wanted · one question at a pause · never guesses silently).
5. **Data & privacy** — three ruled columns: *Collected, per session* (decision, guess, answer transcript, ids,
   frozen predictions), *Scrubbed before storage* (`[IBAN] [EMAIL] [PHONE] [CARD] [TAX_ID] [URL_SECRET]`, and the
   amounts/cost-centres/invoice numbers that are deliberately kept), *Never collected* (passwords/keystrokes, screen
   frames, raw audio, other tabs, anything when capture is off).
6. **CTA band + footer** — the same two targets, then the mono colophon and provenance glyphs.

CTAs: product `https://core-production-c5ac.up.railway.app`, demo ERP
`https://erp-production-e3b0.up.railway.app` (both appear in the hero and in the closing band).

## The name is one constant

```js
const BRAND = { product: 'Tacet', character: 'Mira' };   // site/index.html:512
```

Every rendered occurrence is a `data-brand="product|character"` element (6 slots: wordmark, hero lede, nav, “Meet —”,
character copy, footer) plus `<title>` and the meta description, all written from `BRAND` at parse time. The literal
name appears **exactly once** in the file (`Tacet` ×1, the constant). Alt text and aria-labels are name-free, so a
future rename is a one-line edit. The head `<title>`/description carry a name-free tagline so crawlers see something
useful; the script overwrites both from `BRAND`.

## Acceptance — headless-Chrome screenshots at 1440 and 390

`site/shots/desktop-1440.png` and `site/shots/mobile-390.png` are **full-page** captures (1440×5480 and 390×6746),
taken with headless **Chrome 154.0.8037.93** through the DevTools Protocol (`Emulation.setDeviceMetricsOverride` →
`Page.navigate` → `document.fonts.ready` → `Page.captureScreenshot{captureBeyondViewport:true}`). Script in the
appendix. Output:

```
desktop-1440.png: {"h":5480,"w":1440}
mobile-390.png: {"h":6746,"w":390}
exit: 0

/Users/shubhamjoshi/Hacknation 2/site/shots/desktop-1440.png
  pixelWidth: 1440
  pixelHeight: 5480
/Users/shubhamjoshi/Hacknation 2/site/shots/mobile-390.png
  pixelWidth: 390
  pixelHeight: 6746
```

### Extra integrity check (same headless Chrome, widths 375/390/768/1440)

```
WIDTH 375  {"w":375, "scrollW":375, "fonts":"loaded",
            "title":"Tacet — learns the part of the job nobody wrote down", "wordmark":"Tacet", "mira":"Meet Mira.",
            "sections":5, "moments":3, "sprites":2,
            "video":true, "poster":"assets/poster.svg",
            "quoteSerif":"Newsreader", "h1Serif":"Newsreader", "bodySans":"Geist",
            "links":["https://core-production-c5ac.up.railway.app","https://erp-production-e3b0.up.railway.app",
                     "https://core-production-c5ac.up.railway.app","https://erp-production-e3b0.up.railway.app"],
            "overflow":["a.label right=-9889"]}
WIDTH 390  {… same, scrollW 390, scrollH 6746 …}
WIDTH 768  {… same, scrollW 768, scrollH 5952 …}
WIDTH 1440 {… same, scrollW 1440, scrollH 5480 …}
ERRORS []
```

Reading: `scrollWidth == innerWidth` at every width (**no horizontal overflow at 375px**); all three webfonts load;
6 name slots filled from the constant; 5 sections / 3 moments / 2 sprites present; the video and its correct
`assets/demo.mp4` src + `assets/poster.svg` poster exist; all four CTA hrefs are the two required URLs; no JS
exceptions. The lone `overflow` entry is the intentionally off-screen `left:-9999px` skip link.

### Static compliance checks

```
== forbidden CSS/visual patterns in site/index.html ==
none found        (no gradient / box-shadow / text-shadow / drop-shadow / blur / glow / shimmer / backdrop-filter)

== emoji scan ==
emoji/pictograph codepoints: ['0x2192', '0x2197', '0x2713']   # → and ↗ arrows, and ✓ the design-system mark
                                                              # (no emoji; ▮ ◌ ✓ ■ are the required provenance glyphs)

== brand constant ==
512:  const BRAND = { product: 'Tacet', character: 'Mira' };
data-brand slots: 6
Tacet literals in index.html: 1
```

## Judgment calls

- **Product name defaults to `Tacet`** (queue: “likely Tacet”; character “Mira”), isolated in `BRAND` so the
  undecided call stays one line. The old working title `Shadow` appears only in a code comment.
- **Full-page shots via CDP, not `--window-size`.** Chrome's plain `--screenshot` only captures the fold (and does
  not always exit in this sandbox); CDP's `captureBeyondViewport` gives the whole document at an exact CSS width,
  which is what “at 1440 and 390 wide” should mean. The viewport command is kept in the README as a fallback.
- **The `<video>` is present with a missing `assets/demo.mp4`.** The poster is a separate `<img>` behind it and the
  clip is `opacity:0` until `loadeddata`, so there is no broken-player chrome today and the real clip plays the
  moment it is dropped in.
- **Facts used are the checkpoint's.** Receipt/sealed-test numbers (`3,600 → 4,069`, `9/11 → 11/11`) and the
  simulated eval (`38 / 73 / 98`, `0%` confabulation) come from `CLAUDE.md`; the hash is truncated and the eval line
  is explicitly labelled *simulated*. Privacy wording follows the redaction spec (`[IBAN]` etc.) and the companion
  session report (frames stay on-device, dropped on stop).
- **No-`vh` layout.** The hero uses padding, never `100vh`, which keeps tall-window full-page capture exact.

## Integration — exact call sites

Nothing imports from the app or `console/`; deploy `site/` as a static root.

1. **Static host / Railway**: point a static service at `site/` (the README documents `python3 -m http.server 8130`
   for local preview). No build step.
2. **Video**: drop the T4 film at `site/assets/demo.mp4`; no markup change needed.
3. **Rename**: edit `BRAND` at `site/index.html:512` only.
4. **Routing (only if merged into the app)**: the page is standalone, so Claude can either serve it as static or
   port the sections into the ERP/console; the two CTA URLs are the only external links to keep in sync.

## Open questions

1. **Name.** `Tacet` is a placeholder pending the user's decision; flipping it is one line. If “Shadow” wins, change
   `BRAND.product` (the wordmark, hero, nav, footer, title and description follow automatically).
2. **Video.** The slot ships with a poster only. Is `demo.mp4` the T4 output, and should the page host a second
   short clip for the sealed-test moment?
3. **Eval framing.** The `38/73/98` line is honest but bold for a landing page; keep, soften, or move behind a
   “Method” disclosure?
4. **Privacy wording.** “Raw microphone audio … only the transcript is kept” is true for our storage but the voice
   path passes audio to ElevenLabs; if the page goes public, that third party should be named.
5. **Deploy target.** If the user wants `tacet.work` (the only clean domain in the names report), the favicon/OG
   tags are ready but there is no OG image yet.

## Appendix — the CDP screenshot script (temporary, kept out of the repo)

`/tmp/t3-shots.mjs`, invoked as `node /tmp/t3-shots.mjs "$PWD/site/index.html" "$PWD/site/shots"`:

```js
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333
const URL = 'file://' + process.argv[2]
const OUT = process.argv[3]
const shots = [{ name: 'desktop-1440.png', width: 1440 }, { name: 'mobile-390.png', width: 390 }]
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-breakpad','--disable-crash-reporter','--no-first-run','--no-default-browser-check','--disable-dev-shm-usage','--hide-scrollbars','--user-data-dir=/tmp/chrome-t3-cdp','--crash-dumps-dir=/tmp/chrome-t3-cdp/crash',`--remote-debugging-port=${PORT}`,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'})
for (let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok)break}catch{}await sleep(150)}
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find(t=>t.type==='page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej})
let id=0;const pending=new Map();const listeners=[]
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){const{res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}else if(m.method)listeners.forEach(l=>l(m))}
const send=(method,params={})=>{const mid=++id;return new Promise((res,rej)=>{pending.set(mid,{res,rej});ws.send(JSON.stringify({id:mid,method,params}))})}
const once=(method,timeout=20000)=>new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('timeout '+method)),timeout);const l=(m)=>{if(m.method===method){clearTimeout(t);listeners.splice(listeners.indexOf(l),1);res(m.params)}};listeners.push(l)})
await send('Page.enable');await send('Runtime.enable')
for (const shot of shots) {
  await send('Emulation.setDeviceMetricsOverride',{width:shot.width,height:900,deviceScaleFactor:1,mobile:false})
  const loaded=once('Page.loadEventFired')
  await send('Page.navigate',{url:URL});await loaded
  await send('Runtime.evaluate',{expression:'document.fonts.ready.then(()=>true)',awaitPromise:true,returnByValue:true})
  await sleep(700)
  const {data}=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true})
  writeFileSync(`${OUT}/${shot.name}`,Buffer.from(data,'base64'))
  const {result}=await send('Runtime.evaluate',{expression:'JSON.stringify({h:document.documentElement.scrollHeight,w:document.documentElement.scrollWidth})',returnByValue:true})
  console.log(`${shot.name}: ${result.value}`)
}
await send('Browser.close').catch(()=>{});chrome.kill('SIGKILL');process.exit(0)
```
