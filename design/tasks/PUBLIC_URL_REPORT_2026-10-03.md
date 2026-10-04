# Named public URL

User requested the shortest available product-named address. Created an additional
Railway service domain on core and renamed it to `tacet.up.railway.app` via Railway
CLI/API. Domain ID: `05e8b64b-1d9c-4114-ab79-821bce10ee4b`; Railway reports ACTIVE.
The original `core-production-c5ac.up.railway.app` alias remains active so existing
ERP builds, stored extension settings and voice integration links continue to work.
No application redeployment or session restart was necessary. The running backend's
SHADOW_PUBLIC_URL still uses the compatibility alias; do not remove that alias without
migrating stored settings and voice webhooks first.

Verified HTTPS GET 200 for `/`, `/app`, `/api/config` and `/privacy.html` on both
addresses. Opened the new homepage in Chrome; screenshot saved in tasks/shots.
Updated extension default, store listing, site README and CLAUDE project context.
Rebuilt `dist/tacet-extension-0.1.0.zip`; package validation and offline SDK check pass.
Also preserved the user-requested real-page Mira screenshot (1280x800 PNG, fitted
with padding) and its original JPEG capture in extension/store.
No Git push performed.
