# DEEPSEEK_STORE_REPORT — Chrome Web Store pack for the Tacet extension

Task: `design/tasks/DEEPSEEK_STORE.md`. Status: **done**, with one item the user must
decide before submitting (remote code — section 4 below).

Owned paths only. Files written:

| Path | What |
|---|---|
| `extension/store/listing.md` | Every Chrome Web Store form field, ready to paste: name, short description (121 chars), detailed description, category, language, single purpose, permission justifications, remote-code declaration, data-usage disclosures, privacy/support/homepage URLs, certifications, manual checklist. |
| `site/privacy.html` | A self-contained privacy policy in the landing page's exact paper/ink style (same tokens, type roles, masthead, provenance marks, footer). Dated 2026-10-03. |
| `extension/store/screenshot-1-watching.png` | 1280×800 — the real companion idle on a plain invoice page: "Mira watches the form you already have — no integration, no new app." |
| `extension/store/screenshot-2-one-question.png` | 1280×800 — the companion's ask card at a pause: "At a pause, she asks one question — in the expert's own words." |
| `extension/store/screenshot-3-stopped.png` | 1280×800 — "Mira stepped in" with the expert's quote: "The answer comes back as a rule: the next person is stopped in her words." |
| `extension/store/promo-440x280.png` | 440×280 small promo tile: wordmark + "Learns the part of the job nobody wrote down." + the real Mira sprite crop. |
| `extension/store/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` | The wordmark square (sage square with a pale offset square, transparent), rendered at all four manifest sizes plus the 128 store icon. |
| `extension/store/compose/shot.html`, `promo.html`, `icon.html`, `render.mjs` | The composition sources and the deterministic render harness (headless Chrome, CDP :9351). |

Nothing outside `extension/store/**`, `site/privacy.html`, and this report was
changed. `git status` shows `extension/store/` and `site/privacy.html` as new; the
`site/assets/*` and `site/index.html` modifications visible in `git status` were
already there from another agent and were not touched.

## How the images were made (reproducible)

```bash
node extension/store/compose/render.mjs
```

The harness (never port 8000):

1. serves `extension/store/compose/` on `http://localhost:9350`, the **real**
   `backend/shadow/static/capture.js` at `/capture.js`, the **real** sprite at
   `/companion/intern.png`, and a stub `/api/config`;
2. runs a fake Tacet Core WebSocket on the same port (`/ws/capture`) that sends the
   same messages the engine sends — `session`, `ask`, `intervene` — so the companion in
   the screenshots is the actual shipped companion, not a redraw;
3. launches headless Chrome for Testing with `--remote-debugging-port=9351`, sets
   `Emulation.setDeviceMetricsOverride` to the exact pixel size, waits for the
   shadow-DOM state to settle, and captures the PNG.

The screenshots are therefore real renders of `capture.js` on a plain host page in the
site's paper/ink register, each with a burned-in one-line caption. They were verified
by inspecting the rendered PNGs (dimensions and content). The icon 128 was verified to
be RGBA with the two offset squares on transparency.

## What the user must still do by hand

1. **Developer account + fee.** Create a Chrome Web Store developer account and pay the
   one-time **US$5** registration. Then "New item → Upload".
2. **Decide the remote-code answer (the one real blocker).** `manifest.json`'s
   permissions are all justifiable, but the bundled `vendor/capture.js` dynamically
   imports the ElevenLabs voice client from jsDelivr on **Talk**
   (`backend/shadow/static/capture.js:928`, `EL_CDN`). Chrome's MV3 policy treats that
   as remote code, so the form cannot honestly be answered "No" while it ships. Either
   (a) bundle the ElevenLabs client into `vendor/` and import it locally, or (b) ship
   the store build without voice, then declare "No". Do not paste "No remote code"
   while `import(EL_CDN)` is in the uploaded bundle. Section 4 of `listing.md` has both
   paths written out.
3. **Add an `icons` entry to `extension/manifest.json`.** The manifest has **no
   `icons` key** today. `extension/store/icon16/32/48/128.png` are ready; wiring them
   in is the manifest owner's change (I did not edit `manifest.json`).
4. **Serve the privacy page.** Deploy `site/privacy.html` at
   `https://core-production-c5ac.up.railway.app/privacy.html` so the policy URL used in
   the form resolves. It is a single self-contained file; fonts come from the same
   Google Fonts link as the landing page.
5. **Zip and upload** the *contents* of `extension/` (not the parent folder), then paste
   the fields from `listing.md` and tick the three data-usage certifications.
6. **Screenshots and tile**: upload the three 1280×800 PNGs and the 440×280 tile in the
   order above; upload `icon128.png` as the store icon.

## Truthfulness notes (what was checked against the code)

- **Data-usage wording is verified against `backend/shadow/static/observe.js`.** The
  listing and privacy page state exactly what that file reads: visible, non-sensitive
  `input`/`select`/`textarea` structure and options; numeric/date/category/boolean
  values; short codes only;
  free text reduced to a length; `password`/`hidden` and sensitive-named fields skipped;
  email/card/IBAN-looking values dropped in the page. The `SENSITIVE`, `SHORT_CODE`,
  `EMAIL_LIKE`, `CARD_LIKE`, and `IBAN_LIKE` patterns are quoted from the file.
- **"No screenshots, no video" is verified against `capture.js`.** A grep for frame
  senders (`type:"frame"`, `toDataURL`, `captureStream`, `getUserMedia`) finds none:
  the extension sends structured events only. The one nuance disclosed is `pii_rects`
  (rectangles for blur, never values), which is called out in an "honest exception"
  panel on the privacy page.
- **Financial info was ticked as collected**, because number fields (e.g. a net amount)
  are read and the learned rules depend on them. Card/IBAN-style values are explicitly
  never read, and this is stated next to the tick.
- **Sub-processors** (Anthropic for compile/reason, OpenAI for vision and fast steps,
  ElevenLabs for voice, Railway for hosting) are named with what each is used for,
  matching `backend/shadow/llm*.py` / `converse.py` and the deploy notes.

## Acceptance check against the task

- `extension/store/listing.md` — every field the form asks for, permission-by-permission
  justifications, remote-code declaration (with the one honest caveat), data-usage
  disclosures, privacy URL, support email, homepage. ✅
- `site/privacy.html` — real policy, site's exact visual style, self-contained, dated
  2026-10-03, covers capture/storage/retention/deletion/no-selling/no-ads/sub-processors. ✅
- Store images — three 1280×800 screenshots, one 440×280 promo tile, `icon128.png`
  (+16/32/48), all PNG, all rendered with headless Chrome via CDP 9351 from the real
  companion. ✅
- `manifest.json` icons check + report note. ✅
- No commits made; no files outside ownership edited; port 8000 never used. ✅

## Integration follow-up
Codex reviewed the assets, corrected replay/vision/typed-answer and deletion wording in the draft listing/privacy policy, disclosed optional HTTP sites, and wired the four existing icon assets into the manifest after Sol finished. Remote voice bundling remains unresolved; this is not a store-ready submission claim.
