# Sol — Learn this task

Implementation and API/DOM verification are complete. **Browser visual verification and the requested `shots/sol-*` screenshots remain incomplete because browser permission was declined.** No commit or push was made.

## Exact truth test

The fixture, `sol_fixture/tickets.html`, is a service desk with Hours open, Service level, Assigned team, Save routing, and Next ticket. It has no ERP contract, invoice data, domain pack, or oracle. The optional `?companion=1` harness loads capture.js and observe.js from **localhost:8001**.

The isolated core used port **8001**, `/private/tmp/tacet-sol-workflow.db`, the existing backend/.env key loader, and OpenAI-first cheap fast/reason tiers. Port 8000 was never used or restarted. The static fixture server used port 8011. Keys were never printed or written to task artifacts.

Headless Playwright was installed in `/private/tmp/tacet-sol-tools`, outside the repository, but sandboxed Chrome launch aborted with SIGABRT/EPERM. A Chrome tab was opened on the fixture; automatic approval review then rejected raw CDP execution, stating that browser permission was declined. No browser workaround was used. The request for ordinary browser UI checks remains pending.

The safer alternative was **local DOM emulation with jsdom**, running the actual fixture and observe.js, and posting its emitted events to the real :8001 API. This is an observer/API/LLM test, **not a headless Chrome or visual-layout result**. Expert choices and typed answers are scripted on synthetic cases; they are not a recording of a human expert. No shadow.sim or oracle is invoked.

Before fixes (`truth-dom.cjs` / `truth-browser.js`, evidence in `sol_fixture/truth-before.json`):

1. Three demonstrations changed the team and saved three cases.
2. `/api/onboard` received the goal, demonstrations, and `events: true`.
3. A fourth snapshot, changed assignment, and save action were posted to its capture session.
4. After a pause the session still had **0 episodes, 0 decisions/predictions, 0 questions, 0 learned rules**. Matching already said same.
5. Both providers rejected the full onboarding schema: OpenAI rejected its open dictionary schema and Anthropic rejected its grammar size. The endpoint used its heuristic repair floor, with zero successful metered calls.

After fixes (`node design/tasks/sol_fixture/truth-loop.cjs`, evidence in `sol_fixture/truth-after.json`):

1. The actual observer collected three demonstrations, with exactly one terminal action per save. A real compact LLM onboarding call created `sol_service_loop_live` in the isolated `sol-live` workspace.
2. The fourth case received a committed **Support** prediction. The scripted expert chose **Dispatch**. Opening facts retained Support; booking stored Dispatch separately.
3. A natural pause released the question asking why the team changed. The test checked `activity.paused`; it did not force the pause gate.
4. The typed utterance endpoint received: “Premium service tickets open fewer than 8 hours always go to Dispatch. Other Premium tickets go to Dispatch. Standard tickets go to Engineering.” The real compiler produced executable task.* rules, quotes, and provenance.
5. Another Premium case received a **Dispatch** prediction from **R1**, rather than the novice. Its matching decision contributed an independent receipt check.
6. The debrief ran follow-ups, scripted labels derived from visible hypothetical facts (never from the frozen expected answer), exam rounds, and teach-back. The final run asked **16 debrief questions**, finished its last exam **5/5**, and returned `understood.done: true` with confirmed teach-back.
7. JSON, Markdown, and agent-skill exports succeeded and contained the learned rules.
8. A tutor session on the same workflow copied its map. `/api/capture/before_save` rejected a wrong assignment and accepted Dispatch; the intervention included the expert's quoted rule.
9. Revisiting through `/api/workflows/match` returned **same**, **score 1.0**, and the taught workflow ID **sol_service_loop_live**.

Final capture session: `bcf74e3f17`. The trace contains demonstrations, inquiry, utterance, rules, receipt, later prediction, follow-ups, exports, tutor verdicts, matching result and spend. The fixture's two Premium branches share an outcome, so this does not establish a meaningful numeric routing boundary.

## Breaks fixed — files and reasons

| Files | Fix |
| --- | --- |
| backend/shadow/engine.py | Generic observe/action events previously had no engine path. Snapshots now create cases and prospective predictions; changed outputs update booking without leaking into opening facts; input changes create fresh predictions; known actions record judgments. Helper actions, duplicate decisions, off-record events and ended sessions do not teach. Tutor actions run the existing map checks. |
| backend/shadow/onboard.py | Replaced the failing live LLM proposal with a small closed sketch, while keeping injected legacy parsers for offline tests. Controls provide grounded schema details. Opening snapshots are preserved; select options survive single-demo inference; safe short text codes become category options; exploration priors target inputs. |
| backend/shadow/packs/generic.py | Debrief perturbations incorrectly treated edited output controls as input facts. Counterfactuals now perturb input features, and exploration excludes output names. |
| backend/shadow/questions.py | Cold-start debrief could ask “Would you still none?” without a predicted action. It now asks what the expert would do. Duplicate option labels no longer produce “Dispatch (Dispatch)”. |
| backend/shadow/main.py | Validates completed demos and saves the initial map for immediate continuation. New tasks on the same page get distinct IDs. Continuation finds the workflow's saved expert map. Rejects cross-workflow sources and practice-to-live transfers. Generic unassigned sockets opt out of latest-session following, and missing pins are reported. |
| backend/shadow/workflows.py, backend/shadow/store.py | Identical controls could silently select the wrong workflow. Close high-scoring matches now ask the human; goals are supplied for the choice. |
| backend/shadow/converse.py | Tutor conversation now names the actual workflow instead of saying “processes invoices”. |
| backend/shadow/static/observe.js | Native click/submit could double-count, while debounce could suppress a fast save on the next case. Added shared deduplication, route reset, safe final control snapshots, terminal flags, action inventory, exclusion of button inputs from facts, and explicit observer-ready wiring. |
| backend/shadow/static/capture.js | Added Learn this task → match/choice → one-line goal → Watching/Stop/Resume → Done showing after ≥1 demo → onboarding → pinned capture. Progress survives tab navigation; errors retain demos. Unassigned events stay local. Same/ask/ambiguous choices use the chosen pack. Existing paper/sage styles and Tacet/Mira copy are reused. Sessions explicitly show Live or Practice. Generic tutoring retains the workflow and page; typed debrief works without voice; stale pins offer saved-workflow continuation. |
| extension/injected/loader.js, extension/injected/wire.js, extension/background.js, extension/manifest.json, extension/vendor/* | Removed the socket-constructor bridge that bypassed watch/pin/off-record logic. Observer routing now belongs to the companion. Injection remains loader → capture → observe → wire. Optional host permissions include HTTP and HTTPS sites. The existing popup per-site switch already enables/injects the flow, so its code needed no change. Vendor bundles were regenerated. |
| backend/tests/test_new_workflow_loop.py, backend/tests/test_workflows.py | Offline coverage for the loop, pauses, typed compile, changed prediction/receipt, debrief/exports, tutor, persistence/continuation, private/ended events, socket isolation/recovery, distinct new tasks, short codes, input-only probes, invalid onboarding and ambiguous matching. |

No fixture-specific policy or new invoice-specific backend path was added. Console, site, film and video files were not edited by this task. Concurrent changes from other work were left alone.

## Verification and spend

- Backend pytest with a disposable DATABASE_URL: **268 passed, 2 xfailed, 2 xpassed**, 4.15s. Existing xfail/xpass results are reported rather than hidden.
- `node design/tasks/sol_fixture/companion-dom.cjs`: passed new workflow, three saves, opening-fact separation, Stop/Resume, Done showing, correct onboarding body, pin/snapshot, continuation, partial-match question and ambiguous-workflow selection. Requests are stubbed; this is not a screenshot or LLM test.
- `node design/tasks/sol_fixture/truth-loop.cjs`: passed with the real API/LLM as above.
- Changed companion, observer and extension scripts pass `node --check`; `git diff --check` passes.
- `bash extension/sync.sh` completed; vendor copies match the core scripts.
- Final owned loop `/health`: **22 successful gpt-4.1-mini calls, estimated $0.0144**. Earlier checkpoints were $0.0047 and $0.0117. The meter resets on server restart; these are individual run checkpoints, not one cumulative billing figure. Owned runs stayed far below ~$1. Concurrent browser traffic is not claimed as this script's proof.

## Screenshots and remaining limits

**No design/tasks/shots/sol-* screenshots were produced.** Chrome layout, actual MV3 permission/injection, microphone and voice remain unverified. Ordinary browser verification is awaiting the pending permission request. DOM tests are not presented as visual verification.

The observer reads visible enabled form controls and buttons, not arbitrary canvas apps, cross-origin frames, or every piece of page text. Redacted/unseen facts cannot drive rules. A terminal action is an attempted save/submit-like interaction; arbitrary sites do not expose a universal successful-save notification. The tutor map and before_save contract work, but observing a click alone cannot guarantee interception before the site's own save handler. Cooperative window.shadow.beforeSave integration remains the reliable blocking path.

Sessions remain in memory. Workflow definitions and maps persist; missing pins can continue a saved workflow, but the exact old session is not restored. This small scripted workflow proves the tested loop, not universal workflow accuracy or production browser reliability.

## Reproduction

Test dependencies live outside the repo:

```sh
npm install --prefix /private/tmp/tacet-sol-tools --cache /private/tmp/tacet-npm-cache playwright jsdom
```

From backend/, start only the isolated port:

```sh
DATABASE_URL=sqlite:////private/tmp/tacet-sol-workflow.db \
SHADOW_PUBLIC_URL=http://localhost:8001 \
SHADOW_LLM_PROVIDERS=openai,anthropic \
SHADOW_FAST_PROVIDERS=openai,anthropic \
SHADOW_REASON_PROVIDERS=openai,anthropic \
.venv/bin/uvicorn shadow.main:app --port 8001
```

Run the Node scripts above from the repository root. For a subsequently authorized visual check, serve the fixture with `python3 -m http.server 8011 --directory design/tasks/sol_fixture`, then open `http://localhost:8011/tickets.html?case=T-1&companion=1`.

The isolated :8001 core and :8011 fixture server were stopped at handoff. No shared server was stopped, and no commit or push was made.

## Primary-agent integration verification

After Sol stopped, Codex independently reran backend pytest: 268 passed, 2 xfailed, 2 xpassed; checked script syntax and exact source/vendor equality. Icons prepared by DeepSeek were wired into the manifest, with dimensions verified.

The primary agent also completed ordinary browser visual checks using Codex's supported browser UI tools, on the final capture/observe source served from isolated :8001 and a service form at :8012. It verified Learn this task → goal → Watching → three distinct demonstrations → Done showing → Live capture session d195cfcf00. Screenshots are sol-final-watching.png, sol-final-three-demos.png and sol-final-live-session.png under design/tasks/shots/. This supplies the browser evidence absent from the worker handoff; no MV3 installation or microphone check is claimed. Earlier in this chat a supported-browser run also verified pause question → typed answer → three real compiled rules → changed next-case prediction, then persisted-map tutor/export recovery.

The primary agent stopped its isolated review core after verification. Shared :8000 was untouched. Universal host-page save interception and production voice/store packaging remain the limits stated above.
