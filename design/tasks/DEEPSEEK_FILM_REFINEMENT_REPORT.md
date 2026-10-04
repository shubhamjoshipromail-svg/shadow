# Film controls refinement — report

Task: `design/tasks/DEEPSEEK_FILM_REFINEMENT.md`. **Owned files written:** `site/index.html`
and this report. Nothing committed, pushed or deployed. No other repository file changed
(`git status`: only `site/index.html` modified; this report is new). The VTT parser block is
byte-identical to `HEAD` (verified by extraction and `diff`).

## Design

The chunky film bar is replaced by one slim editorial row: metadata left, controls right
aligned under the film, `flex-wrap:nowrap` with the metadata ellipsised so the row never
wraps.

| Before | After |
|---|---|
| Visible uppercase `Language` label + `Sound muted`/`Sound on` status | No label and no redundant status; English / Deutsch are self-evident text tabs |
| Filled segmented control in a bordered box, dark fill on the selected language | Transparent `.lang-tab` text buttons, 13px, thin 1px underline only on the **confirmed** language |
| `Enable sound` / `Mute` `.btn` with a dark primary fill when muted | Quiet `.sound-btn`: 15px inline speaker SVG (waves on / small × off) + `Sound on` / `Sound off`, sage `#4e6b44` when on, no fill |
| `Play with sound` dark primary button | Quiet `.play-btn` with an 11px triangle and `Play` |
| 44px stacked boxes, full-width on mobile | 36px visual row; each control carries an invisible 44px `::after` touch area; mobile keeps one row with no full-width buttons |
| `#film-sound-status` printed `Sound muted · browser blocked autoplay` | Same ID is now a polite live region used **only** for `Loading Deutsch/English` or `Couldn’t load the film`; visually hidden (`.sr`, `clip-path:inset(50%)`) when empty |

Cream/ink/sage tokens, 1px rules and the sage `:focus-visible` ring are unchanged. No pills,
cards, gradients or dark primary fills were introduced. DOM IDs are retained
(`film-slot`, `film`, `film-poster`, `film-caption`, `film-controls`, `film-sound`,
`film-sound-status`, `film-play`, `film-lang-en/de`); new helper IDs `film-sound-label` and
`film-play-label` hold text beside the SVGs, and `film-lang-tabs` carries the group's
`aria-label="Film language"`.

## Behaviour

State is element-derived (`soundIsOn()` = `!muted && volume > 0`) and generation-tokened
(`srcGen` for loads, `cueGen` for captions).

- **Sound on requested, honestly.** `tryPlay(true)` unmutes and plays; a `NotAllowedError`
  falls back to muted playback, keeps `Sound off` and never shows `Sound on` while muted. On
  a first (non-gesture) load the browser's own decision is left untouched, so the fallback is
  never silently undone by a later `loadedmetadata`.
- **Sound starts during the gesture, even mid-buffer/mid-swap.** The Sound click always sets
  `muted=false`, `volume=1`, records `soundGesture`, and calls `play()` immediately — no wait
  for metadata, no finish, no restart. Verified with the source delayed: `readyState 0`,
  click → `muted:false`, then plays with sound once data arrives.
- **Latest language wins.** `chooseLang` no longer bails while `switching`. The confirmed tab
  keeps `aria-pressed`, the in-flight tab gets `data-pending`/`aria-busy`, and status reads
  `Loading Deutsch/English`. Clicking another language re-assigns `src` under a new `srcGen`;
  a stale response cannot overwrite the latest (verified DE→EN under a 1.8s delay, then stable).
  Confirmed language is only set in `loadedmetadata`, and `video[lang]` follows it.
- **Position / playback / sound choice carried across a swap.** `resumeAt`, `wantPlaying`
  (from `intendPlay`) and `preferSound` are restored under the new `srcGen`. Resume waits for
  `seeked` (authoritative when a seek is pending) or `canplay`/`loadeddata`, with a 1.5s
  timeout, so a switch cannot hang. Paused switches stay paused at the exact position
  (reduced-motion check: 9.00 → 9.00s); playing switches continue without restarting.
- **Captions clear then re-render.** On swap the caption text is emptied and hidden, `cues`
  is reset and a token-guarded fetch loads the new `.vtt`; the new language renders when the
  frame is available. Verified: English cue → cleared (empty/hidden) → German cue.
- **Reduced motion and explicit mute preserved.** `prefers-reduced-motion` never autoplays
  and leaves a quiet `Play`; an explicit mute survives EN↔DE and the Play label becomes
  `Play muted` for assistive tech.
- **Failures stay recoverable.** `error` clears switching/seek state, shows a concise visible
  `Couldn’t load the film`, and leaves the language tabs (retry) and sound control in place;
  clicking a language retries under a fresh generation and recovers.

Chrome autoplay policy is respected throughout — no `--autoplay-policy` flags, no
unmute-after-muted-autoplay trick; the only unmute path is a real click or language gesture.

## Verification

Focused harness `/tmp/film-refine-check.cjs` (not committed — the task owns only the two
files): static server on **:8141** with HTTP Range, real Google Chrome via Playwright,
headless, **default** browser autoplay policy, no policy flags. **54 / 54 checks pass**;
exact JSON at `/tmp/film-refine-result.json`. The preserved 45-check
`design/tasks/film-controls-check.cjs` was deliberately **not** reused unmodified, because it
asserts the old labels/styles (`Mute`/`Enable sound`, a visible `Sound on` status, the
`.primary` class, 44px boxes) that this task replaces.

| Scenario | Evidence |
|---|---|
| A design | row 36px, `::after` touch 44px, tabs/sound 13px, transparent backgrounds, pressed `English` underline `rgb(34,32,28)` vs `Deutsch` `rgba(0,0,0,0)`, zero legacy `.seg/.ctl/.btn` inside the controls |
| A sound | default policy → `muted:true`, `Sound off`; click → `muted:false, volume:1`, `Sound on`, color `rgb(78,107,68)`, no fill; status stays sr-only/empty when idle |
| B buffering | `readyState:0, muted:true` → click → `muted:false` at `readyState:0` → later `paused:false, muted:false` |
| C latest-wins | `Loading Deutsch` with `dePressed:false/dePending:true`; second click → `Loading English`; settles `src film.mp4, lang en, enPressed:true`, pending cleared, no stale overwrite |
| D swap | explicit mute + playing carry over EN→DE (`7.28→7.80`, `muted:true`), sound-on survives DE→EN (`8.10→8.57`, `muted:false`) |
| E captions | EN `"Mira writes its guess before she decides."` → immediately hidden/empty → DE `"Der schriftliche Prozess …"` |
| F reduced motion | paused, quiet `Play`, no autoplay; paused switch keeps 9.00s exactly |
| G error | visible `Couldn’t load the film`, controls kept; retry recovers and clears status |
| H keyboard | Tab reaches `film-lang-en`, `outline:2px solid rgb(78,107,68)` |
| I mobile 390 | `scrollWidth 390 = innerWidth`, one 36px row, sound 82px (not full width), 44px touch areas |
| J integrity | brand `Tacet`, privacy ledger still opens, 0 uncaught page errors |

Screenshots for review (in `/tmp/film-refine-shots/`, not committed): `refine-muted.png`,
`refine-sound-on.png`, `refine-loading.png` (pending Deutsch + `Loading Deutsch`),
`refine-error.png`, `refine-mobile.png`. This was validated once, in headless Chrome on
macOS — not a claim about every browser or live traffic.

## Notes for the owner (outside task ownership)

- `design/tasks/film-controls-check.cjs` and `film-controls-verification.json` describe the
  superseded controls; refresh or retire them if the 45-check record should match the UI.
- `site/README.md` still mentions old control wording; update when convenient.
- `site/shots/desktop-1440.png` / `mobile-390.png` are now slightly stale (the control row is
  shorter). No engine/backend/console file was touched.

## Primary integration and deployment

Reviewed local controls in user Chrome using the supported browser tool. The new
underline renders correctly and the audio source changes during playback. Deployed
Core using `deploy/core.Dockerfile`, deployment
`d7f16e48-36ac-4d5f-8c6f-7a1afc6c5ba0` (SUCCESS). Live homepage byte-equals
`site/index.html`; health, notebook and config return 200. Live Chrome checks:
Deutsch switches to film.de.mp4, lang de, unmuted and playing; mute/unmute works;
selected-language border style is solid. Screenshot: shots/live-film-controls-refined.jpg.

The German dub changes narration/captions, while the designed invoice graphics are
shared with the English film. Chrome may still require one sound gesture for a fresh
visitor. A language change does not wait for the film to finish.

Preserved the worker's 54-check result and harness in film-refinement-verification.json
and film-refinement-check.cjs. The harness was run from /private/tmp and retains that
environment's root/output defaults; inspect its paths before rerunning elsewhere.
The earlier 45-check artifact documents the superseded control UI.
