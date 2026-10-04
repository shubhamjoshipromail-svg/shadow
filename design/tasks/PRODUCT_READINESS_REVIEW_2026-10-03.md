# Product readiness review — October 3, 2026

Assessment: the AP demonstration has the strongest prior evidence. Cold-start capture and learning now have meaningful local evidence, but the product is not yet a seamless universal-browser tutor or store-ready release. Avoid a percentage: completion depends on verified user journeys, not file counts.

## Shared engine
Both AP and generated workflows use shadow.engine.Session and the Pack protocol. AP has a curated adapter, document priors and domain fixtures. onboard.py constructs a TaskDefinition from a goal and observed demonstrations; GenericPack supplies the same protocol. This is one learning engine with different adapters and different amounts of prior knowledge.

## Independent real-browser cold-start check
Used Codex in-app browser, a local service-routing form served at :8012, and the isolated real core on :8001. Synthetic tickets and scripted test choices; real observation, API and LLM; no simulator. Chose Learn this task, saw a recognized workflow offer, explicitly chose a new task, entered a goal, demonstrated Engineering / Dispatch / Engineering on three tickets, chose Done showing. Session 4699f4d787 opened as Live capture. On Premium/3 hours, chose Engineering; a question appeared at the pause. Entered the typed policy: Premium under 8 hours → Engineering; other Premium → Dispatch; Standard → Engineering. Three executable rules compiled. Opening Premium/4 hours yielded Engineering from R1 with confidence .778. Companion displayed 3 learned, 0 confirmed, 1 question. Screenshot: design/tasks/shots/cold-browser-review.png.

This confirms UI onboarding and the capture/question/compile/prospective-prediction path on one structured form. It does not establish support for every website or voice/microphone readiness. The isolated server was restarted by the existing workflow run before the independent export/tutor follow-up; the old session then returned 404. This also illustrates the current distinction between saved maps and in-memory session continuity. Follow-up after that restart: restored route_service_tickets into tutor session 3cbb2e41f0 from saved session 4699f4d787/map v1; all three rules survived. On Premium/4 hours, before-save API rejected Support and accepted Engineering. JSON, Markdown and skill exports all returned HTTP 200. This verifies persisted-map recovery and tutor API behavior, not interception of the host form. Total current isolated-core spend was $0.0117.

## Additional evidence
Independent companion DOM checks passed new, same and ask matching; stop/resume; three demos; session pinning and continuing. Sol truth-after.json reports real API/LLM learning, debrief questions, JSON/Markdown/skill exports, tutor before-save API rejects incorrect choice, accepts correct choice, and match returns same. Its final understood flags are NOT complete: frozen exam not run and teach-back not confirmed. Do not call this a fully certified workflow.

## Remaining release gaps
- Universal tutor enforcement: observe.js observes click/submit after intent, but arbitrary websites do not await window.shadow.beforeSave. Backend rejection/intervention is not proof that an arbitrary site's save was prevented. AP explicitly awaits the hook. Need safe pre-action integration before making universal stop/save claims.
- Capture ownership: console vision and companion replay own separate streams. Lifecycle fixes reduce console duplicates/leaks, but a single session capture-owner contract remains unimplemented.
- Session continuity: in-memory session IDs disappear on restart; workflow/maps persist separately. User-facing recovery must be checked.
- Privacy wording: landing page globally says screen frames never leave the device, but console optional vision POSTs masked frames to the core. Distinguish local replay-only capture from optional vision transmission before release.
- Store: ElevenLabs CDN import remains in extension companion; bundle locally, wire icons, verify privacy text against final code, package and inspect before submission.
- Voice: test actual Chrome microphone, speech, interruptions and tutor transitions on a new workflow.
- UI polish: watching panel also says Not recording; question includes generated case ID rather than user-facing ticket label; panel closes when interacting with host page. Review these before claiming completely smooth onboarding.
- Deployment: uncommitted new-workflow and screen-lifecycle changes have not been released or independently checked on production.

## User-confirmed media decision
User approved the existing audio/video. No new narration or music needed. Requested larger obvious language/sound controls and sound as default. DeepSeek task DEEPSEEK_FILM_CONTROLS.md implements this locally with browser-policy fallback; review final screenshots/behavior before publication.

## Order to finish
Review final Sol diff/report and browser evidence; resolve universal-tutor wording/enforcement; validate voice and recovery; unify capture owner; finish MV3 bundling and privacy/package review; release and smoke-test the production journeys; then finish submission packet.

## Independent film-controls review
Revised site/index.html verified in the Codex in-app browser on a range-capable local server :8137: default audible autoplay was blocked, muted fallback showed honest status and Enable sound; clicking enabled audio; EN→DE preserved time (11.42→11.61 seconds) and unmuted playback; 390px mobile controls fit inside 350px content width. Screenshots: shots/film-controls-review.png and shots/film-controls-review-mobile.png. A plain Python static server lacking byte-range support reset seeking on source swap, so use a range-capable server for playback verification. Changes remain local.
