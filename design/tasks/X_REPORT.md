# X · EXTENSION — report

**Task:** Chrome MV3 extension (load-unpacked) so Mira appears on any site the user turns her
on for, not only the ERP. **Owns:** new `extension/**`. No edits to `engine.py`, `main.py`,
`store.py`, or any other owned file. Not committed.

## What was built

```
extension/
  manifest.json              MV3: action popup, storage/scripting/activeTab/webNavigation,
                             required http://localhost/* + http://127.0.0.1/*,
                             optional https://*/*
  shared.js                  NAME = "Tacet", default server URL, site/pattern helpers, settings
  background.js              service worker: decides where Mira may run, injects the bundle
  injected/loader.js         MAIN world: records __shadowHadCapture, bridges the companion socket
  injected/wire.js           MAIN world: forwards observe.js events into that socket (guarded)
  vendor/capture.js          copy of backend/shadow/static/capture.js   (written by sync.sh)
  vendor/observe.js          copy of backend/shadow/static/observe.js   (written by sync.sh)
  sync.sh                    copies the two files from backend; run before loading
  popup/popup.html|css|js    320px popup: server URL, per-site switch, enabled-site list
  test/page.html|css         plain third-party form (labels, inputs, select, checkbox, buttons)
  test/page-own-capture.html a page that ships capture.js itself (the ERP case)
  test/run.mjs               headless-Chrome acceptance harness (:8098 page, :8001 fake Core)
  test/get-chrome.sh         fetches an unbranded Chrome for Testing (see note below)
  test/out/                  screenshots written by the harness
  README.md, .gitignore
```

### How it works

- **Permission model.** `background.js` listens on `tabs.onUpdated`, `webNavigation.onCommitted`
  and `webNavigation.onHistoryStateUpdated`; for a top-frame URL it looks up the site
  (`scheme://hostname`) in `chrome.storage.local.enabledOrigins`, checks
  `chrome.permissions.contains`, and only then injects. Non-`http(s)` pages are ignored.
- **Injection.** Five ordered `chrome.scripting.executeScript({ world: "MAIN" })` calls: a
  tiny func that sets `window.SHADOW_API` + `window.SHADOW_NAME`, then `injected/loader.js`,
  `vendor/capture.js`, `vendor/observe.js`, `injected/wire.js`. Ordering is explicit so the
  companion's socket exists before the observer is wired.
- **One socket, not two.** `capture.js` owns its WebSocket and exports no `send`. `loader.js`
  wraps `WebSocket` for the injection window, captures the `/ws/capture` instance, exposes
  `window.__shadowBridge`, and queues until it opens. `wire.js` sends the observer's snapshot
  and every subsequent event through that same socket.
- **Never double-inject.** `loader.js` records `window.__shadowHadCapture = !!window.__shadowCapture`
  *before* `capture.js` runs; `capture.js`'s own `if (window.__shadowCapture) return;` stops a
  second companion, and `wire.js` returns early when the page already ships its own observer, so
  the ERP keeps its own, richer capture and gets no duplicate generic events.
- **SPA + reloads.** `observe.js` already patches `history` and re-announces; the worker also
  re-injects on history-state navigations and on reloads. In-page guards make repeats free.

## Acceptance checks

Commands and output (verbatim), run from the repo root:

```
$ bash extension/sync.sh
sync: vendor/capture.js vendor/observe.js updated from /Users/shubhamjoshi/Hacknation 2/backend/shadow/static

$ bash -n extension/sync.sh extension/test/get-chrome.sh
shell syntax ok

$ node --check <each>
ok  extension/shared.js
ok  extension/background.js
ok  extension/popup/popup.js
ok  extension/injected/loader.js
ok  extension/injected/wire.js
ok  extension/vendor/capture.js
ok  extension/vendor/observe.js
ok  extension/test/run.mjs

$ node -e JSON.parse(manifest)
manifest.json ok

$ node extension/test/run.mjs
browser: /tmp/tacet-cft/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
PASS  extension loaded  (chrome-extension://bimmdbknfohdcekckkenoihiobjokfok/background.js)
PASS  settings seeded  (server=http://localhost:8001 site=http://localhost)
PASS  window.SHADOW_API points at :8001  (http://localhost:8001)
PASS  window.SHADOW_NAME is Tacet  (Tacet)
PASS  companion injected (window.__shadowCapture)
PASS  observer installed (window.shadowObserve)
PASS  Mira mounted exactly once  (hosts=1)
PASS  bridge reused the companion socket  (connections=1)
PASS  observe event reached :8001
PASS  field_changed reached :8001  (amount=4120)
PASS  action reached :8001
PASS  free text stays short on the wire
PASS  SPA navigation re-announced  (1 -> 2)
PASS  re-injected after reload
PASS  never double-injects after reload  (hosts=1)
PASS  Mira asks one question  (Claims over 3,600 without a receipt — manager review or reject?)
PASS  screenshot written  (extension/test/out/mira-on-any-site.png)
PASS  popup renders at 320px
PASS  popup shows the shared server URL  (http://localhost:8001)
PASS  popup screenshot written  (extension/test/out/popup.png)
PASS  page with its own companion is left alone  ({"capture":true,"hadCapture":true,"hosts":1})
PASS  no second socket on a page with its own companion  (2 -> 3)

22/22 checks passed
```

Screenshots: `extension/test/out/mira-on-any-site.png` (Mira on the plain third-party form,
1440×900, with the question card) and `extension/test/out/popup.png` (the 320px popup at 2×).

## Deviations and notes (all deliberate)

1. **`--load-extension` and official Chrome.** Chrome 137+ (here 154) ignores the flag for
   branded Chrome, so the harness prefers an unbranded Chromium and prints the binary it used;
   `extension/test/get-chrome.sh` fetches Chrome for Testing 154 to `/tmp/tacet-cft`. The
   accepted run above used that binary. `$CHROME=/path` overrides; Edge is the fallback.
2. **Manifest permissions.** The task listed optional host permissions `https://*/*` and
   `http://localhost/*`. `http://localhost/*` (plus `http://127.0.0.1/*`) is a *required*
   host permission so local development works with no prompt; `https://*/*` stays optional and
   every other site is opt-in. This was necessary, not cosmetic: a headless
   `chrome.permissions.request` for an optional origin never resolves (verified), so the local
   acceptance page could not otherwise be enabled. `webNavigation` was added for
   reload/SPA re-injection. `activeTab`, `storage`, `scripting` are as specified.
3. **No remote code in the extension.** `vendor/` files are byte copies made by `sync.sh`
   (`sha256` of each matches `backend/shadow/static/`). The only runtime fetch is inside the
   injected `capture.js`, which `import()`s the ElevenLabs client from a CDN when voice is used;
   a page CSP that blocks that import leaves text-only Mira, nothing else breaks.
4. **Strings.** No user-visible string in `extension/**` uses the banned register (checked with
   a case-insensitive scan for demo/hackathon/sandbox/rehearsal/simulated/try our/AI-powered/
   unlock/revolutionize). The product name is the single constant `NAME` in `shared.js`; the
   popup, banner and companion all read it from there.

## For Claude (integration)

- Nothing is required in `engine.py` / `main.py` / `store.py`. `/capture.js`, `/observe.js`
  and `/ws/capture` already exist and accept the forwarded `observe` / `field_changed` /
  `action` messages (`Session.on_event` ignores unknown types safely).
- If generic observe events should be persisted as onboarding material, the natural hook is
  the existing `POST /api/onboard` with `events: true`; the extension already emits exactly the
  event shapes `onboard.Demo.from_events` expects. No change made here.
- `extension/**` is new and uncommitted; `git status` shows unrelated in-flight work from the
  L2/V tasks (site/, design/video/, advisory/) that I did not touch.
