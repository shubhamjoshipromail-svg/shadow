# Screen capture lifecycle and single-owner review — report

Task: `design/tasks/DEEPSEEK_SCREEN_LIFECYCLE.md`.
Status: **done**. No commit, no push, no server started or restarted, port 8000 untouched.
Owned files only: `console/src/lib/screen.ts` and this report. `backend/shadow/**` and
`extension/**` (being edited by other workers) were read-only and are unchanged.

## The two capture owners

Chrome shows two sharing indicators because two different documents each call
`navigator.mediaDevices.getDisplayMedia` for the same session, from two different origins:

1. **Console vision owner — `console/src/lib/screen.ts` (`useScreen`).**
   Runs in the console page (Vite dev `:5173` / deployed console origin). `start()` calls
   `getDisplayMedia({ video: { frameRate: 10 }, audio: false })`, samples the stream on a 1 s
   interval, blurs PII rectangles reported by the observed app, keeps up to 1500 JPEG object
   URLs **in memory only**, and — when the "vision" checkbox is on and a session is pinned —
   POSTs changed frames to `/api/sessions/:sid/frames` for a text reading. It also feeds the
   console's `MomentModal` replays (`frameAt` / `framesAround`).

2. **Companion replay owner — `backend/shadow/static/capture.js` (`startReplays`).**
   Served at `/capture.js` and injected into the **observed ERP page** (a different origin).
   `startReplays()` calls `getDisplayMedia({ video: true, preferCurrentTab: true })`, grabs a
   JPEG blob every second into `REPLAYS.frames` (capped at `MAX_REPLAY_FRAMES`, never sent
   anywhere), and drives the in-page local replay UI. `stopReplays()` clears the frames and
   stops the tracks.

So the same expert screen is being captured twice, by two independently-owned media streams,
which is exactly what produces two Chrome sharing banners/pickers. Because focus/frame-rate
and `preferCurrentTab` differ, the two captures can also disagree on content.

## Console lifecycle bugs found (and fixed in this task)

`useScreen` had no ownership discipline:

- `start()` awaited `getDisplayMedia` with no guard, so a double-click (or two callers before
  React re-rendered) opened two pickers / two streams.
- Calling `start()` while already sharing opened a **second** stream.
- Unmounting the console never stopped the tracks, leaving the screen shared (and the Chrome
  indicator lit) with no UI to stop it — an orphan.
- `frames` held `URL.createObjectURL` blobs that were only ever revoked by the 1500-frame
  cap, so **stop/unmount leaked every object URL** still in the buffer.
- A permission request left pending when the user stopped or the console unmounted still
  resolved and called `setStream(s)`: the capture started **after** stop/unmount, producing an
  orphaned stream nobody could stop.
- A `toBlob` already in flight when stop happened could push a frame (and a new object URL)
  into the just-cleared buffer.
- `s.getVideoTracks()[0].addEventListener(...)` would throw if a display stream ever arrived
  without a video track, and the `ended` handler only cleared state without releasing frames.

Fixes, all inside `console/src/lib/screen.ts`:

1. **One owned stream.** `streamRef` is the single source of truth; `start()` returns
   immediately if a stream is already owned.
2. **Concurrent-start deduplication.** `pending` guard: at most one `getDisplayMedia` in flight.
3. **Generation token.** Every `start()` takes `mine = ++generation`; `stop()` and the unmount
   cleanup bump `generation`, so a late picker result that no longer matches is immediately
   `stopTracks(...)`-ed and discarded. No stale result can start capture after stop/unmount.
4. **Stop all owned tracks on unmount.** A mount-scoped effect records `mounted` and, on
   cleanup, invalidates pending work and calls `release()`.
5. **Release all frame object URLs on stop/unmount.** `dropFrames()` revokes every buffered
   `URL.createObjectURL` and zeroes `frameCount`.
6. **`ended` is a real stop.** The browser "Stop sharing" event routes through `release()`
   (stop tracks, drop frames, clear state) and only when it fires for the still-owned stream.
7. **No late frame leak.** The sampling loop reads `live()` before work and again after the
   async `toBlob`, and creates the object URL only after that check, so a frame encoded after
   stop is dropped without ever getting a URL. Vision replies only update `lastVision` while
   still live.
8. **Cancel is silent.** `getDisplayMedia` rejections (picker cancelled/denied) are caught, as
   the off-record/off-capture dialogs intend, instead of surfacing an unhandled rejection.

Preserved unchanged: vision POST path and 2.5 s throttle, PII blur and the `paused`
(off-the-record) early-return, the 1500-frame window, `screen_changed` events,
`frameAt`/`framesAround` replay accessors, and the hook's return shape — so `Console.tsx` needs
no edit and its UI contract is intact.

## One capture owner per session (proposal — not implemented)

The durable fix is **exactly one document owns `getDisplayMedia` for a session**; every other
consumer gets derived data, not its own stream. A `MediaStream` cannot simply be handed between
the console and ERP pages: they are different origins, `postMessage` of a `MediaStream` is not
allowed cross-origin, and a `MediaStreamTrack` cannot be transferred across origins. A direct stream-handle handoff is not proposed. Derived frames can be exchanged locally with a deliberately designed messaging channel and strict origin checks.

Recommended owner: **the companion, in the observed ERP page.**

- It runs in the page the expert is actually sharing, so `preferCurrentTab` yields one clean
  tab capture and replays are frame-accurate to the moment the engine recorded.
- It produces the single Chrome sharing indicator.
- The console becomes a **consumer of metadata/derived readings**, not a second capturer.

Required backend/companion changes (identified, deliberately **not implemented** here):

- **Backend:** add a session-scoped `capture_owner` (`'console' | 'companion' | null`) to the
  session snapshot and broadcast it on change; add a small claim/release path (e.g.
  `POST /api/sessions/:sid/capture` or a WS message). This lets each UI hide/disable its
  "share screen" control when the other already owns capture.
- **Backend:** emit capture start/stop and "frame available" events so the console can follow
  `lastVision` without owning a stream. The existing `POST /api/sessions/:sid/frames` endpoint
  can be reused by whichever page is the owner.
- **Companion:** gate `startReplays()` on ownership; move the PII masking and optional vision
  POST into the companion's replay loop (it currently stores raw blobs and never POSTs frames).
- **Replay location:** honest constraint — to keep the "frames never leave the browser"
  promise, replay thumbnails can only be shown in the same document that owns the stream. So
  the console's `MomentModal` frame strip should either defer to the companion's replay UI, or
  the console must accept server-relayed, masked JPEGs (a privacy tradeoff). The former is
  recommended; a local cross-origin replay would require a separate, origin-checked frame messaging channel; it is not implemented.

If the team instead wants the **console** to be the owner, then the companion's
`startReplays()` must be removed and the console must live in (or be embedded in) the same
origin as the ERP page — that would require an explicit bridge or embedding arrangement with the current two apps, so the companion owner
is the recommendation.

## Voice bundling follow-up for MV3 (read-only recommendation)

The in-page voice path relies on `EL_CDN` remote imports. MV3 extension pages and the service
worker run under `script-src 'self'`: they cannot load remote scripts, and Chrome Web Store
policy forbids remote code. Follow-up (not implemented): add the ElevenLabs client as a build
dependency and bundle it into the extension package with Vite/esbuild, reference the local
bundle only, keep any key server-side (short-lived session token), and let the persistent side
panel own the mic/voice session so the permission prompt appears once in a known extension
context.

## Changed files

- `console/src/lib/screen.ts` — lifecycle fixes above.
- `design/tasks/DEEPSEEK_SCREEN_LIFECYCLE_REPORT.md` — this report.

No other files touched.

## Validation

- `cd console && npm run build` → `tsc -b && vite build` succeeded (109 modules, `dist/` emitted;
  only the pre-existing >500 kB chunk-size warning).
- `npm run lint` (oxlint) → no errors. `screen.ts` has two warnings: line 40
  (`optsRef.current = opts`, pre-existing) and line 101 (intentional ref access in the unmount
  cleanup); the rest of the repo carries comparable warnings.
- No unit tests added: `console/` has **no test infrastructure** (no vitest/jest, only
  `dev`/`build`/`lint`/`preview`), and the changed behavior turns on `getDisplayMedia`
  permission timing and `MediaStreamTrack` events, which that (absent) harness could not
  faithfully simulate. Per the task, tests were added only if appropriate infrastructure
  existed — it does not.
- No backend server run, no API calls, no deployment, no secrets, and no live/simulated-live
  claims.

## Remaining limits

- Verified by type-check/build/lint and code reasoning only. The actual Chrome single-indicator
  behavior, permission-timing races, and track `ended` handling were **not** exercised in a
  real browser here; per `CLAUDE.md`, screen/voice must be tested in real Chrome.
- This change bounds the **console** to one stream. The duplicate Chrome indicator is only
  fully removed once the companion stops calling `getDisplayMedia` for sessions the console
  owns (or vice versa) — i.e. once the `capture_owner` proposal above lands in
  backend/companion, which was out of this task's ownership.
- Cross-origin stream/frame transfer is neither attempted nor claimed; the "frames never leave
  the browser" property is preserved, at the cost of replay staying in the owning document.

## Integration review
Codex also closed two asynchronous off-record races: recheck paused after frame encoding and recheck capture/session/vision state after base64 conversion before POSTing a frame. This avoids retaining or transmitting newly completed work after pause/stop or routing an old frame to a changed session. Build rechecked before commit.
