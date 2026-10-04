# Extension release strategy

Follow-up researched 2026-10-03. Recommendation only; nothing built or submitted.

Start a small working extension now if public installation matters. Submit once its capture, session connection, pause control, and question display actually work. Do not submit a placeholder whose sole function is opening Shadow's website: Chrome's minimum-functionality policy prohibits launcher-only extensions. [Minimum functionality](https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality)

Keep the frequently changing learning engine on the server. Package browser observation, permission handling, transport, and rendering in the extension. Keep the full management dashboard on the website. Use a versioned API and retain compatibility with older installed clients during review and rollout.

Server operations and data/configuration are allowed; remote executable extension logic is restricted. JSON must not disguise an interpreter's remotely supplied program. Isolated iframe exceptions exist but do not remove reviewability requirements. [Manifest V3 policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)

For Shadow, keep learned-rule execution on the backend and return displayable results/evidence. This also fits the existing Python Work Map runtime. Package the voice SDK rather than copying today's CDN import into the extension.

The smallest useful first submission is a browser apprentice with an explicit start/pause session, capture on an enabled site, persistent panel, typed questions/answers, and a notebook link. Choose a scope the current backend can actually support and disclose that scope accurately; do not advertise arbitrary-task learning prematurely.

Google estimates most reviews take a few days, with some taking weeks; updates also undergo review. There is no assured hackathon approval date. [Review process](https://developer.chrome.com/docs/webstore/review-process)

Use Chrome's developer-mode **Load unpacked** on the controlled demo machine so the demonstration does not depend on store timing. That is a development/testing route, not frictionless public distribution. [Official development instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)

Opus should read this with [the browser architecture proposal](BROWSER_COMPANION_PROPOSAL.md). No agent or implementation work should restart automatically based on this note.
