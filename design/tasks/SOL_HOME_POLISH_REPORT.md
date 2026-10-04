# Home and landing polish — 2026-10-04

Implemented `SOL_HOME_POLISH.md` in `console/src/pages/Home.tsx`, `site/index.html`, and `site/privacy.html`. No backend changes, commits, pushes, deployments, learning, or labels were performed by this task.

- Landing has one pilot CTA in “Who it’s for”; masthead and closing CTA say “Talk to us.” All three open the same accessible contact dialog. All four privacy contact controls open the matching dialog. Both show the mono email address, truthful Copy/Copied state, the exact Gmail compose URL in a new tab, and the mailto fallback. Native modal focus handling, Escape, click-outside, focus return, and clipboard-failure guidance are included.
- New workflow has notebook Mira on the right in two equal desktop columns, with mobile stacking through the existing `md` breakpoint.
- Picker always includes AP (default, taught by Sabine), Support, other learned workflows, and New. Support uses the learned workflow ID when its name or signature matches; otherwise it shows the cold-start message, the specified Support URL, and disabled teaching.
- Process-owner entries have whole-block hover/focus/click targets. Work Map reuses a live session with the richest expert’s map or posts `{mode:"capture", pack, expert, fresh:false}`. Agent permissions selects the most recent certification across historical sessions; without one, it resumes the saved map and opens proof. Compare remains a whole-block link. Pending and failure states are visible.

Validation:

- `cd console && npx tsc --noEmit -p . && npm run build` passes. Vite reports its existing large-bundle warning.
- `git diff --check`, inline JavaScript syntax, contact-control counts, single pilot CTA, Gmail URL/target/rel, and fallback markup checks pass.
- Chrome preview at `127.0.0.1:5193/app/` used the live API through `SHADOW_API` and `VITE_SHADOW_API`; site preview was served on :8093. Port 8000 was never used.
- Clicked each process-owner entry once against live: Work Map resumed Sabine’s saved v8 as session `3b6f16ac27`; proof reused it and showed “Certify an agent on this map”; compare opened Sabine/Klaus. One capture session was created; no learning, sealed-test generation, certification generation, or labels were started.
- Chrome verified all landing triggers, privacy masthead/body triggers, Copy/Copied, Escape with focus return, and click-outside closure. Gmail/mailto destinations were inspected; no email was sent. Contact layout was visually verified at 390 × 844.
- Separate local API fixtures verified signature-only Support matching, additional workflow dropdown options, both enabled jobs and their actual workflow IDs, richest-map continuation despite a newer sparse map, and latest historical certification routing without creating another session. Fixtures intentionally cover Home payloads/navigation; they do not emulate the session WebSocket or test learning internals.
- Screenshot review led to an iteration aligning all process-owner headings at the top. Final PNGs are in `design/tasks/shots/sol-home-*.png`: overview, new workflow, contact desktop/mobile, privacy contact, live map/proof/compare. Browser JPEG captures were converted to PNG without altering their pixels.

Verification limit: the supported viewport control resized the landing tab, but not the console tab. Raw CDP access for console mobile emulation was rejected by automatic approval review because permission for that access had previously been declined. No bypass was attempted. Console mobile stacking is implemented in CSS but has no claimed mobile-browser screenshot. Live has no learned Support map, so that branch was checked with local fixtures.

Temporary local preview and fixture servers were stopped after verification.
