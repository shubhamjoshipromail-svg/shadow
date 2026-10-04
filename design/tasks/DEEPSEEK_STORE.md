# DeepSeek task — Chrome Web Store submission package for the Tacet extension

Repo root: /Users/shubhamjoshi/Hacknation 2. Product: **Tacet**; apprentice character: **Mira**. Read `extension/`
(manifest.json, README.md, popup/, background.js, injected/), `site/index.html` (voice and look), `design/DESIGN.md`.

You own ONLY these new paths: `extension/store/**`, `site/privacy.html`, `design/tasks/DEEPSEEK_STORE_REPORT.md`.
Do NOT edit anything else (another agent is editing `extension/` code, `backend/`, `capture.js` right now).
Never use port 8000. Don't commit.

Produce:
1. `extension/store/listing.md` — everything the Chrome Web Store form asks for, ready to paste: name, short
   description (≤132 chars), detailed description (plain, calm, no hype, no "AI-powered", no emoji), category,
   language, single purpose statement, justification for EACH permission in manifest.json (storage, scripting,
   activeTab, webNavigation, host permissions localhost, optional https://*/*), remote code declaration (the
   extension bundles its scripts in vendor/, no remote code), data usage disclosures (what is collected: form field
   names/labels/safe values and actions on sites the user turns Mira on for; passwords/hidden/card/IBAN/token-like
   values never leave the page — verify this claim against `backend/shadow/static/observe.js` and only state what the
   code actually does), privacy policy URL = https://core-production-c5ac.up.railway.app/privacy.html, support
   email hello@tacet.work, homepage https://core-production-c5ac.up.railway.app/.
2. `site/privacy.html` — a real privacy policy page in the site's exact visual style (copy the head/CSS approach of
   site/index.html; self-contained). Truthful to the code: what's captured, where it's stored (Tacet Core on Railway,
   US West, Postgres), retention/deletion contact, no selling, no ads, LLM sub-processors (Anthropic, OpenAI) and
   voice (ElevenLabs) used to process answers. Date it 2026-10-03.
3. Store images in `extension/store/`: 1280×800 screenshots (2–3) and a 440×280 small promo tile, PNG. Make them
   by rendering small HTML compositions with headless Chrome (CDP, port 9351) in the site's paper/ink style showing
   the real companion (`backend/shadow/static/intern.png`, the panel look from capture.js) on a plain form page and a
   one-line caption. Icon: check whether manifest has icons; if not, produce `extension/store/icon128.png` (the
   wordmark square from the site: sage square with a pale offset square) and note in the report that manifest needs
   an `icons` entry (don't edit manifest yourself).
4. Report: list of files, anything the user must do by hand (developer account, $5 fee, uploading, ticking boxes).
