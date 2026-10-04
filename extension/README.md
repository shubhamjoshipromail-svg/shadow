# Tacet — browser extension

Mira, on any site you turn her on for. The extension injects the same companion
(`capture.js`) and generic page observer (`observe.js`) that Shadow Core serves, so the
engine sees the work — not just the one app it was built against.

## Load it (unpacked)

1. Run `bash extension/sync.sh` once (and after Shadow Core changes) to copy the companion + observer into `vendor/`.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, select this `extension/` folder.
3. Open an `http(s)` page, click the Tacet toolbar button, set the **Server URL**, then switch on **Turn on Mira for this site**.

> Official Chrome 137+ ignores `--load-extension` and blocks unpacked extensions in
> automated sessions. Use an unbranded Chromium/Chrome for Testing, or load it by hand as
> above. `extension/test/get-chrome.sh` fetches one for the harness.

## What it can and cannot do

**Can**

- Discover the form on an arbitrary page: inputs, selects, checkboxes, buttons, their
  labels, and safe values (free text is length-only; passwords, hidden fields, and
  card/IBAN-looking values are never read).
- Show Mira on pages you enabled, survive reloads, and follow SPA route changes.
- Send those events to Shadow Core over the companion's own `/ws/capture` socket, so a
  session on any page behaves like a session on an observed app.
- Stay off everywhere else: host access is opt-in per site and remembered; `localhost`
  is enabled out of the box for development.

**Cannot**

- Act on a site you have not turned Mira on for, or on non-`http(s)` pages.
- Read inside cross-origin iframes, shadow-DOM widgets, or canvas/video content.
- Read free-text values, passwords, hidden inputs, or payment fields (by design).
- Auto-fill or click for you. It observes and asks; the person works.
- Guarantee voice on every site: the injected `capture.js` loads the ElevenLabs client
  from a CDN at runtime, so a page whose CSP blocks that import keeps text-only Mira.

## Layout

| Path | What |
|---|---|
| `manifest.json` | MV3: popup action, `storage`/`scripting`/`activeTab`/`webNavigation`, optional `https://*/*` |
| `background.js` | decides where Mira is allowed and injects the bundle (MAIN world) |
| `injected/loader.js` | records whether the page ships its own companion, bridges its socket |
| `injected/wire.js` | forwards observer events into that socket (only when the page is not already observed) |
| `vendor/` | copies of `capture.js` + `observe.js`, written by `sync.sh`; no remote code |
| `popup/` | 320px popup: server URL, per-site switch, list of enabled sites |
| `test/` | static test pages + the headless-Chrome acceptance harness |

## Acceptance harness

```bash
bash extension/sync.sh
node extension/test/run.mjs        # serves the test page on :8098 and a fake Core on :8001
```

It launches a Chromium with `--load-extension`, asserts the injection, the single socket,
SPA/reload behaviour and the "don't double-inject our ERP" guard, then writes
`test/out/mira-on-any-site.png` and `test/out/popup.png`.
