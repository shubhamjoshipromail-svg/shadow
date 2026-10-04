# Film playback controls — report

Task: `design/tasks/DEEPSEEK_FILM_CONTROLS.md`. **Owned files written:**
`site/index.html` and this report, plus six screenshots `design/tasks/shots/film-controls-*.png`.
Nothing committed or pushed. No server on `:8000`/`:8001`. No other worker's file touched.

## What changed

The film's tiny `textbtn` links (`.textbtn`, `.film-tools`) are replaced by bordered controls with
honest, element-derived state. The warm paper/sage/ink register is unchanged: paper `#f4f1ea`, sheet
`#fbf9f4`, 1 px rules, radius 3 px, IBM Plex Mono for status text, the sage focus ring `#4e6b44`.
No gradients, glow, glass, emoji or decorative icons.

**Markup — one `.film-controls` group (revealed when the clip's metadata is known):**

| Control | Element | Accessible state |
|---|---|---|
| Language | `.seg` segmented pair `#film-lang-en` / `#film-lang-de` | `role="group" aria-labelledby` + `aria-pressed` ("true" on the current one) + `lang` |
| Sound status | `#film-sound-status` | `role="status" aria-live="polite"` |
| Sound action | `#film-sound` (`.btn`, `.primary` only while muted) | `aria-pressed` = sound on |
| Play | `#film-play` (`.btn.primary`, hidden while playing) | text is `Play with sound` / `Play muted` |

**CSS:** `.film-controls`, `.ctl`, `.ctl-label`, `.ctl-status`, `.seg`, `.seg-btn`, a scoped
`:focus-visible` (`outline:2px solid var(--confirmed)`), and `[hidden]{display:none!important}` so
`display:flex`/`inline-flex` never overrides the `hidden` attribute. Every film control has
`min-height:44px` (measured 44 CSS px for English, Deutsch, sound and Play). The `@media
(max-width:620px)` block stacks each `.ctl` into a column and makes the segmented pair and the sound
and Play buttons full-width.

**JS state machine (`site/index.html`, same IIFE):**

- **Unmuted first.** `requestPlay(true)` sets `volume=1`, `muted=false` and calls `video.play()`. If
  the promise rejects with `NotAllowedError` the code sets `muted=true`, retries muted autoplay, and
  keeps `blockedSound=true`; the status then reads *"Sound muted · browser blocked autoplay"* and
  **Enable sound** becomes the primary action. Rejections that are not `NotAllowedError` (e.g. a
  missing source) are not treated as a policy block.
- **Honest labels.** `soundIsOn()` is `!video.muted && video.volume > 0`; the button text
  (`Mute` / `Enable sound`), its `aria-pressed`, the status text and the Play label are recomputed
  from the element on `loadedmetadata`, `loadeddata`, `playing`, `pause` and `volumechange`. There is
  no path that prints "Sound on" while `muted` is true.
- **Play defaults to sound.** A Play click calls `requestPlay(true)` unless the viewer explicitly
  muted (`explicitMuted`), in which case it is `Play muted`. **Enable sound** is a real gesture, so it
  both unmutes and, if the clip is paused, starts it.
- **Language switch preserves state.** `setLang` saves `currentTime`, `paused`, `muted` and the
  blocked flag, swaps `film.mp4` ↔ `film.de.mp4` (and `film.vtt` ↔ `film.de.vtt`), then on the new
  `loadedmetadata` restores the timestamp (clamped to the new duration), the muted state, the blocked
  flag and resumes playback only if it was playing. `lang` moves with the clip.
- **Reduced motion never autoplays.** With `prefers-reduced-motion: reduce` the script does not call
  `play()`; the poster holds and **Play with sound** waits for a click.
- **Blocked player keeps its Play action.** The controls are revealed on `loadedmetadata` (not only
  `loadeddata`), so if even muted autoplay is refused the player is paused with no frame decoded but
  **Play with sound** is still visible. `loadeddata` never hides Play while paused.
- **Missing-film fallback.** `error` clears frame + metadata state, removes `has-video`, hides the
  caption and the whole `.film-controls` group; the poster stays and there are no dead buttons.
- The `/* VTT-PARSER-START */ … /* VTT-PARSER-END */` block is **byte-identical** to `HEAD`
  (1,087 bytes, verified by extraction).

Official behaviour referenced: Chrome autoplay policy —
<https://developer.chrome.com/blog/autoplay> (muted autoplay is always allowed; autoplay with sound
needs a user gesture / MEI / installed-app signal, otherwise `play()` rejects with `NotAllowedError`).

## Validation

Harness: `design/tasks/film-controls-check.cjs` (preserved by the primary agent from the worker's temporary `/tmp/film-controls-playwright.cjs`). It serves `site/` on **:8137** with
HTTP Range support and drives **real Google Chrome 154.0.8037.93** (`/Applications/Google Chrome.app`)
through Playwright (the existing `design/tasks/sol_fixture/truth.cjs` pattern). No `--autoplay-policy`
flag is passed; the installed `playwright-core` default args contain no `autoplay` string. Raw
TCP-CDP renderer commands hang in this sandbox, so Playwright's own client was used — the page is the
real `site/index.html`, not a fixture.

**Result: 45 / 45 checks pass**, exact JSON preserved in `design/tasks/film-controls-verification.json`.

| # | Scenario | Exact evidence |
|---|---|---|
| A | desktop 1440×900, **default autoplay policy** | initial `muted:true, paused:false, status:"Sound muted · browser blocked autoplay", sound:"Enable sound", playHidden:true` — the browser refused unmuted autoplay, the muted fallback played. A trusted click on **Enable sound** → `muted:false, volume:1, status:"Sound on", sound:"Mute", aria-pressed:true`. English `aria-pressed:true`, Deutsch `false`. |
| A | hit targets | English 44, Deutsch 44, sound 44, Play 44 (when shown) CSS px |
| B | EN→DE paused | `currentTime 6.00 → 6.00`, `paused:true → true`, `muted:false → false`, `src assets/film.de.mp4`, `lang de` |
| B | DE→EN playing | `paused:false → false`, `currentTime 6.57 → 7.06` (kept its place, did not restart) |
| B | explicit mute across a swap | `muted:true`, status "Sound muted"; **Enable sound** restores `Mute` |
| C | forced rejected play promise (harness wrapper; simulation) | `paused:true, muted:true`, `playHidden:false`, `playText:"Play with sound"`, height 44; after the block is lifted a real Play click → `paused:false, muted:false` |
| D | reduced motion | `paused:true`, `playHidden:false`, `playText:"Play with sound"`; a click → `paused:false, muted:false` |
| D | keyboard focus | Tab reaches `#film-lang-en`; `outline-style:solid; outline-width:2px; outline-color:rgb(78,107,68)` |
| E | mobile 390×844 @2× | `docScrollW 390 = innerW 390` (no overflow), EN/DE/sound 44 px, sound button 350 px wide |
| F | missing `film.mp4` (request aborted) | `readyState 0`, `hasVideo:false`, `controlsHidden:true`, all control heights 0, poster visible |
| G | page integrity | brand "Tacet", privacy `<details>` closed→open, 0 `.textbtn`, 2 ARIA groups / 3 `aria-pressed`, 0 uncaught page errors |

The real default-policy run is the accepted evidence for the muted fallback. Scenario C is an
injected `HTMLMediaElement.play` wrapper that rejects with `NotAllowedError` (needed to reach the
"even muted autoplay refused" branch deterministically); it is a simulation of the rejection and is
labelled as such. This was validated once, in headless Chrome 154 on macOS — not a claim about every
browser or about live user traffic.

## Screenshots (`design/tasks/shots/`)

| File | Size | Shows |
|---|---|---|
| `film-controls-muted-fallback.png` | 1092×78 | the real default-policy fallback: English selected, "Sound muted · browser blocked autoplay", primary **Enable sound** |
| `film-controls-sound-on.png` | 1092×47 | after a trusted click: "Sound on", **Mute** |
| `film-controls-deutsch.png` | 1092×47 | Deutsch `aria-pressed`, paused at 6.00 s, "Sound on"/**Mute**, **Play with sound** |
| `film-controls-blocked.png` | 1092×705 | forced-rejection path: poster holds, no frame, controls visible with **Play with sound** and primary **Enable sound** |
| `film-controls-reduced-motion.png` | 1092×674 | reduced motion: paused poster, **Play with sound** |
| `film-controls-mobile-390.png` | 700×814 (390×844 @2×) | stacked controls, 44 px targets, full-width segmented pair and actions |

The three wide `.film-bar` strips are element captures of the controls; the blocked/reduced-motion and
mobile shots are `.film-block` captures. Two pre-existing `film-controls-review*.png` files (JPEG data
under a `.png` name, timestamps 20:40–20:41) were already in the directory from another process and
were left untouched.

## Reproduce

```bash
cd "/Users/shubhamjoshi/Hacknation 2"
npm install --prefix /private/tmp/tacet-sol-tools playwright
node design/tasks/film-controls-check.cjs    # :8137, real Chrome, writes /tmp/film-controls-result.json
```

## Notes for the owner (not edited — outside task ownership)

- `site/README.md` still describes the old **Sound on** text button / **Play film** button; update it
  when the controls are accepted.
- `site/shots/desktop-1440.png` and `site/shots/mobile-390.png` are the L2 full-page shots and are now
  slightly stale (control rows are ~44 px tall). Regenerate them with the site README command if the
  committed page shots should match the new height.
- No engine/main/store/test file was touched; no commit/push/deploy.

## Primary-agent integration review
Codex accepted the final source and all 45 final checks, preserved their exact JSON as film-controls-verification.json, and committed the six reviewed screenshots. Updated site/README.md to describe the final English/German film and controls; corrected the landing privacy ledger to distinguish local replays from optional vision transmission and ending a session from deletion requests. No audio/video content was changed. Backend/extension docs and known store limitations remain explicit.

The preserved harness resolves repository/site/screenshot paths relative to itself. Set TACET_PLAYWRIGHT_MODULE to another installed Playwright module path if needed. Its Chrome executable default is macOS-specific; adapt CHROME for another platform.
