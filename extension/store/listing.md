# Tacet — Chrome Web Store listing pack

Everything the Chrome Web Store "New item" form asks for, ready to paste. Written
against the code in this repo on 2026-10-03 (`extension/manifest.json`,
`extension/background.js`, `extension/popup/popup.js`, `extension/injected/*`,
`backend/shadow/static/observe.js`, `backend/shadow/static/capture.js`).

Store assets (rendered by `extension/store/compose/render.mjs`) live next to this file:

| File | Store slot |
|---|---|
| `screenshot-1-watching.png` | Screenshot 1 · 1280×800 |
| `screenshot-2-one-question.png` | Screenshot 2 · 1280×800 |
| `screenshot-3-stopped.png` | Screenshot 3 · 1280×800 |
| `promo-440x280.png` | Small promo tile · 440×280 |
| `icon16.png` `icon32.png` `icon48.png` `icon128.png` | Manifest icons (16/32/48) + store icon (128). The manifest has **no `icons` entry** yet — see "Before you submit". |

---

## 1. Product details

**Name**
```
Tacet
```

**Short description** (132 characters max; this one is 121)
```
Mira watches the form on sites you turn her on for, learns what she cannot yet explain, and asks one question at a pause.
```

**Category**
```
Productivity
```

**Language**
```
English
```

**Homepage URL**
```
https://core-production-c5ac.up.railway.app/
```

**Support email**
```
hello@tacet.work
```

**Privacy policy URL**
```
https://core-production-c5ac.up.railway.app/privacy.html
```
(the source for that page is `site/privacy.html` in this repo)

**Detailed description**
```
Tacet is an apprentice that learns the part of a job nobody wrote down.

You work in a web form the way you always do. Tacet watches the decisions, predicts each one before you make it, and — when it cannot explain what you did — waits for a pause and asks one question. Your answer becomes an executable Work Map: a rule, a threshold, or a guardrail that is checked against later cases and taught to the next person.

The extension brings that apprentice to pages you choose. It reads the form that already exists: the names and labels of fields, the options in dropdowns, the buttons, and the safe values you enter. It needs no integration, no server-side plugin, and no change to the page.

What it reads
• The form on sites you turn Mira on for: field names, labels, control types, and dropdown or radio options.
• Safe values: numbers, dates, categories, checkboxes, and short codes.
• Actions: which button you pressed, and on which page.
• Free text is reported as a length only. Passwords, hidden fields, and anything that looks like a card, an IBAN, an email, are filtered by the structured observer; sensitive-named fields are skipped.

What it never reads
• Passwords, hidden inputs, or payment-card and bank-account numbers.
• Free-text contents, keystrokes, the clipboard, files, or your other tabs.
• Anything at all on a site until you switch Mira on for that site.

Optional capture
If you enable Replays and approve browser screen sharing, the companion keeps sampled frames of the surface you selected in device memory until replays stop. These images are not filtered by the structured observer. Talk sends microphone audio to ElevenLabs for voice interaction; Tacet stores the answer transcript. Separately, optional console vision sends app-masked frames to Tacet Core and its configured vision provider.

Where the data goes
Observations travel over a WebSocket to the Tacet Core you configure (the hosted core by default), where they are stored and used to learn the rules you confirm. The privacy policy describes retention, deletion, and the model and voice providers used to process your answers.

Who it is for
Teams with a senior person whose judgement is written down nowhere, and a new hire who needs it. Tacet is built to be quiet: it is invisible until it has something worth asking.

Support: hello@tacet.work
```

---

## 2. Single purpose

The Chrome Web Store asks for one sentence describing the extension's single purpose.
```
Tacet observes the form a person works in on sites they explicitly turn it on for, and sends those observations to their Tacet Core so the apprenticeship engine can predict a decision, ask one question at a pause, and learn the answer.
```

---

## 3. Permission justifications

The form asks for a separate justification for each permission and host permission in
`manifest.json`. The justifications below match what the code actually does.

### `storage`
```
Saves two settings in chrome.storage.local: the URL of the user's Tacet Core, and the list of sites the user has switched Mira on for. No page content, form values, or observations are kept in extension storage.
```

### `scripting`
```
Injects the extension's own bundled observer and companion scripts into a tab after the user has turned Mira on for that site. Injection is triggered by the service worker on navigation and by the popup on user request. The injected files are packaged in the extension (vendor/capture.js, vendor/observe.js, injected/loader.js, injected/wire.js); nothing is fetched and executed from a remote server for this.
```

### `activeTab`
```
When the user opens the popup, the extension reads the URL of the current tab to show which site they are on and to request access to that one site. activeTab grants temporary access to the active tab only at that moment, on the user's click.
```

### `webNavigation`
```
Detects top-frame navigations and single-page-app history changes on sites the user has enabled, so the observer and companion are re-injected and follow the page without the user reloading.
```

### Host permissions — `http://localhost/*` and `http://127.0.0.1/*`
```
Allows the extension to work against a Tacet Core running on the user's own machine during development and testing. The default core is the hosted service; this permission covers localhost only.
```

### Optional host permissions — `http://*/*` and `https://*/*`
```
Requested at runtime, one site at a time, only when the user switches Mira on for that site (chrome.permissions.request in the popup). It is what lets the observer and companion run on that site. The permission is removed again when the user turns Mira off for the site. The same per-site request applies to the optional http://*/* permission for HTTP sites.
```

**Note.** The manifest has no `icons` entry. All four sizes are ready at
`extension/store/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`; adding the
`"icons"` block to the manifest is a one-line change the user (or the agent who owns
`extension/manifest.json`) must make — this pack deliberately does not edit it.

---

## 4. Remote code

The Chrome Web Store form asks: *"Are you using remote code?"* — answer carefully,
because the honest answer is not a plain "no".

**Core observer and companion: no remote code.** All injected JavaScript is bundled
in the extension: `injected/loader.js`, `vendor/capture.js`, `vendor/observe.js`,
`injected/wire.js` (the two `vendor/` files are copies of
`backend/shadow/static/` written by `extension/sync.sh`). The extension fetches no
script to run its observation, prediction, or question behavior.

**Voice feature: yes, one remote import.** The bundled `vendor/capture.js` starts
voice only when the user presses **Talk**, and at that moment dynamically imports the
ElevenLabs browser client from a CDN:

```js
var EL_CDN = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.26.0/+esm";
...
import(EL_CDN)
```

That is code fetched and executed at runtime, so under Chrome's MV3 policy it counts
as remote code. **Before submitting, choose one of:**

1. **Bundle it.** Copy the ElevenLabs client into `extension/vendor/` and import it
   locally (the extension code is owned by another agent right now; this is their
   one-file change), then declare "No" with confidence. Recommended if voice must ship
   in the store build.
2. **Ship without voice in the extension.** Remove the `import(EL_CDN)` path from the
   bundled copy / gate it behind the core's own settings, so the store build is
   text-only, and declare "No".
3. **Declare "Yes" and describe it** exactly as above, accepting the review risk:
   Chrome may reject a remote-code import even when it is optional and
   user-triggered.

Do **not** paste "No remote code" while `import(EL_CDN)` is in the shipped bundle.

---

## 5. Data usage disclosures

The store form asks which categories of user data the extension collects, and for the
three permanent certifications. The wording below is checked line by line against
`backend/shadow/static/observe.js` (the file that actually reads the page) and
`backend/shadow/static/capture.js` (the companion).

### Categories to tick
- **Website content** — yes. On sites the user turned Mira on for, the extension reads
  the visible form controls and their structure: a stable field name, the human label,
  the control type, the value kind, and the options of dropdowns and radio groups.
  It reads the page URL and title, and the label of the button or submit action the
  user takes.
- **User activity** — yes. It reports field changes and button/form actions on those
  sites, and coarse activity kinds (a key press happened, a scroll happened, the mouse
  moved) without any content.
- **Financial and payment information** — yes, in the narrow sense that an amount
  typed into a `number` field (for example an invoice net amount) is read and sent,
  because the learned rules depend on it. Payment-card numbers, IBANs/BICs, CVV, and
  similar values are explicitly **never** read (see below).
- **Personally identifiable information** — no separate category is read. Free-text
  fields are reduced to a length; anything email-like is dropped in the page. Field
  labels and names are form structure, not entered personal data.

### What is read, exactly
- Visible `input`, `select`, and `textarea` elements that are **not** inside Tacet's own
  UI and are not sensitive.
- Safe values: `number`/`range` → the number; `date`/time fields → the value; `select`
  and `radio` → the selected value; `checkbox` → true/false.
- Free text → **a length only**, except a short code matching
  `/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,15}$/` (for example `T2`, `SF-12`, `NORTH`), which
  is sent as-is only if it does not look like an email, a card, or an IBAN.
- Field changes report the before/after safe value (or the before/after lengths when
  the value is redacted).
- Clicks and form submissions report the control's name and label.

### What never leaves the page (verified against `observe.js`)
- Fields of type `password` or `hidden` are skipped entirely.
- Fields whose `name`, `id`, `autocomplete`, `placeholder`, `aria-label`, or label
  matches the sensitive pattern
  `pass(word|phrase)?|secret|token|otp|cvv|cvc|card|credit|iban|bic|swift|ssn|social.?security|routing|account.?number|pin`
  are skipped entirely.
- A value that looks like an email (`EMAIL_LIKE`), a payment card
  (`CARD_LIKE`, 13–19 spaced/dashed digits), or an IBAN (`IBAN_LIKE`) is never
  returned, even from an otherwise safe field.
- Anything at all on a site until the user switches Mira on for that site; nothing on
  non-`http(s)` pages.

### Where it is sent and stored
Observations are sent over the companion's WebSocket to the configured Tacet Core
(default `https://core-production-c5ac.up.railway.app`), stored in its Postgres
database, and used to produce predictions, questions, and Work Maps. See the privacy
policy for retention, deletion, sub-processors, and the voice provider.

### The three certifications
```
[x] I do not sell or transfer user data to third parties, outside of the approved use cases.
[x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
[x] I do not use or transfer user data to determine creditworthiness or for lending purposes.
```

**Data-usage summary for the form's free-text box (if offered):**
```
Tacet reads the visible form on sites you switch it on for: field names, labels, control types, dropdown options, and safe values (numbers, dates, categories, checkboxes, short codes). Free text is reported as a length only. Passwords, hidden fields, and card/IBAN/email patterns are filtered and sensitive-named fields are skipped. Events are sent to the Tacet Core you configure and stored there to learn the rules you confirm.
```

---

## 6. Other form answers

| Question | Answer |
|---|---|
| Visibility | Public (or Unlisted while you test) |
| Mature content | No |
| In-app purchases | No |
| Uses analytics / telemetry? | No third-party analytics in the extension |
| Broadcast / notifications | None; the extension has no notification permission |
| Trademark review | "Tacet" and "Mira" are used as product and character names |
| Content script registration | None; injection happens from the service worker at runtime |

---

## Before you submit (manual checklist)

1. **Decide the remote-code answer** (section 4). Either bundle the ElevenLabs client
   into `vendor/` and remove the CDN import, or ship the store build without voice.
2. **Add an `icons` entry** to `extension/manifest.json` pointing at the icon sizes
   provided here: `extension/store/icon16.png`, `icon32.png`, `icon48.png`,
   `icon128.png`. The manifest currently has no `icons` key. This pack does not edit
   the manifest (another agent owns it).
3. **Serve `site/privacy.html` at `/privacy.html`** on the core host
   (`core-production-c5ac.up.railway.app`) so the privacy-policy URL resolves. The file
   is self-contained and matches the landing page.
4. **Zip the extension** (the contents of `extension/`, not the parent folder) and
   upload, then fill the form above.
5. **Developer account and fee**: a Chrome Web Store developer account is required
   (one-time US$5 registration), then the item review.
