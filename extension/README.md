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
- Choose **Learn this task**, enter a goal, and show one to three save/submit demonstrations.
  **Done showing** creates a learned workflow and pins the companion to its capture session.
- Continue a matching saved workflow, or choose when the same form has multiple workflows.
- Send assigned events to Tacet Core over the companion's `/ws/capture` socket; unassigned
  generic pages keep observations local instead of teaching another tab's latest session.
- Stay off everywhere else: host access is opt-in per site and remembered; `localhost`
  is enabled out of the box for development.

**Cannot**

- Act on a site you have not turned Mira on for, or on non-`http(s)` pages.
- Read inside cross-origin iframes, shadow-DOM widgets, or canvas/video content.
- Read free-text values, passwords, hidden inputs, or payment fields (by design).
- Auto-fill or click for you. It observes and asks; the person works.
- Reliably prevent saves on an arbitrary site from a click observation alone. Tutor enforcement
  requires the host action to await `window.shadow.beforeSave`.
- Guarantee voice on every site: the injected `capture.js` loads the ElevenLabs client
  from a CDN at runtime, so a page whose CSP blocks that import keeps text-only Mira.

## Layout

| Path | What |
|---|---|
| `manifest.json` | MV3: popup action, `storage`/`scripting`/`activeTab`/`webNavigation`, optional `http://*/*` and `https://*/*`, plus the prepared store icons |
| `background.js` | decides where Mira is allowed and injects the bundle (MAIN world) |
| `injected/loader.js` | records whether the page ships its own companion without replacing WebSocket |
| `injected/wire.js` | asks the companion to own observer routing/watch mode (only on generic pages) |
| `vendor/` | copies of `capture.js` + `observe.js`, written by `sync.sh`; voice still imports the CDN client |
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

## Store preparation

Listing, icons, rendered store screenshots and composition sources are in `store/`.
The four icons are wired into the manifest. Bundle the ElevenLabs client locally before
submitting: the current voice CDN import prevents a truthful no-remote-code declaration.
See `store/listing.md` and `../site/privacy.html`; this repository does not claim store approval.
