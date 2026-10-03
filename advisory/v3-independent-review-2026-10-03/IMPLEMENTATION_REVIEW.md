# Implementation review: evidence and integration checks

Static inspection of work in progress, October 3, 2026. These are source-backed findings and test proposals, not reproduced runtime failures unless explicitly described as arithmetic. Function names are the durable references because line numbers are moving. Reported test results belong to Opus's session; I did not rerun them or touch the live application.

## Foundations worth preserving

| Component | Observed implementation | Value |
|---|---|---|
| Executable knowledge | `workmap.py`, restricted expressions in `dsl.py` | Predictions and tutor decisions share a representation |
| Learning loop | `engine.py`: opening, prediction, divergence, inquiry, compilation, replay | Real state transitions exist beyond transcript summarization |
| Targeted questioning | `planner.py`, `hypotheses.py`, `bayes.py` | Supports selective questions and threshold/basis uncertainty |
| Voice bridge | `voice.tsx`, `converse.py`, custom LLM route | ElevenLabs can speak questions selected by Shadow |
| Tutor | `before_save`, `check_proposal`, `capture.js` | An instrumented ERP can prevent a wrong save |
| Evidence and persistence | `Quote`, `ScreenMoment`, append-only events, map snapshots | Good starting point for auditable learning |
| Rehearsal | `sim.py`, fake proposer/compiler, tests, visible simulator badge | Useful deterministic engineering environment |

## A. Resolve before using the live demo as evidence

### A1. A missing live model silently selects an oracle-backed learning path

**Evidence:** [session creation](</Users/shubhamjoshi/Hacknation 2/backend/shadow/main.py:83>) installs `fake_propose` and `FakeCompiler` when simulation is requested **or** `llm.available()` is false. [Availability](</Users/shubhamjoshi/Hacknation 2/backend/shadow/llm.py:30>) checks only the Anthropic key. `sim.py` has fixed `TRUTH` rules, and its compiler often ignores the actual answer text. The frontend does visibly mark simulated sessions, which is good.

**Consequence:** a successful oracle session cannot establish spoken knowledge acquisition. An existing but unusable Anthropic key creates the opposite problem: “available” is true, but live calls can fail. The OpenAI fallback discussed elsewhere is not implemented in the inspected wrapper.

**Proposed acceptance:** explicit Live / Rehearsal modes; real structured output, image reading, and voice round-trip verified with the chosen provider; missing/invalid access produces a clear unavailable state. A real answer containing a new supported threshold changes the map to that threshold. Saying “I don't know” must not install a canned rule.

**Integration seam:** `llm.py`, configuration, `create_session`, home/session mode UI. Preserve the current structured-output interfaces; changing providers should not require redesigning the engine.

### A2. Debrief advancement can race answer compilation

**Evidence:** `Session.on_utterance` clears `awaiting`, marks the inquiry answered, and spawns `learn_from_answer`. `converse.reply` then immediately calls `debrief_next`. The existing test helper explicitly drains background tasks. During this review, Opus added a separate exam cursor and a pending-teach-back drain, improving duplicate-turn handling. Ordinary agenda advancement still lacks a corresponding per-answer completion barrier in the closing inspection.

**Consequence:** a slow real compiler can leave the next spoken question using stale rules or generate the initial teach-back before earlier learning has completed. This is especially important because the fake compiler completes quickly. `answers_question` is present in the compiler schema but is not used to gate acceptance in the reviewed engine. Repeated exam position is no longer the main concern after the cursor change.

**Proposed acceptance:** delay compilation in a controlled later test; one answer causes one committed learning update and one subsequent question. Unrelated speech and “repeat that” do not consume the pending inquiry. An unanswered or ambiguous question stays pending or becomes an explicit follow-up.

**Integration seam:** a per-session turn state such as `asking → receiving → compiling → applied → ready`; release the next debrief turn only after the corresponding answer is applied. A brief acknowledgement can be streamed during that wait.

### A3. The current “self-exam” is not a frozen held-out evaluation

**Evidence:** `_build_exam` derives cases from perturbations also used elsewhere in debrief and saves an expected result. `_learn_probe` scores a freshly recomputed prediction at answer-processing time and immediately learns from exam answers. `_handle_teachback_answer` can patch rules without rebuilding/invalidation of the exam. `debrief_next` eventually says the map is ready after teach-back without requiring `understood()['done']`.

**Consequence:** the displayed score may combine different map versions, overlap elicitation cases, and remain attached to a corrected map it never tested. The exam selection can also return fewer than five cases, while `understood` requires at least five answers. A teach-back confirmation can coexist with an incomplete readiness checklist.

**Proposed acceptance:** reserve case fingerprints; freeze a map version and predictions before collecting answers; score against independently supplied expert answers; prohibit learning inside that scoring pass. If an exam failure becomes a lesson, retire that item into training and draw a replacement for the next exam. Any relevant map change invalidates the prior pass. Never announce completion when required checks fail.

**Integration seam:** `_build_exam`, `_learn_probe`, `understood`, teach-back completion. Split “learning probes” from “evaluation probes” in data as well as UI.

### A4. Source replay does not yet have stable cross-session identity

**Evidence:** [screen capture](</Users/shubhamjoshi/Hacknation 2/web/src/lib/screen.ts:35>) stores blob URLs in a hook-local frame array. `ScreenMoment` has a relative timestamp but no source-session ID. `startTutor` creates a new session from the map. The console translates relative timestamps with the current session's offset. `MapPage.tsx` displays moments as text and does not retrieve their source media.

**Consequence:** route remounts or reloads can lose frames, and an expert timestamp can be interpreted against the trainee session. A label such as “03:12” is not proof that clicking it retrieves Sabine's actual screen moment. Audio references are modeled but I did not find an implemented recording/retrieval path for them.

**Proposed acceptance:** capture a moment, navigate to the Work Map, start a trainee session, refresh, then click the same rule. Each route retrieves the same expert frame and exact quote. Missing evidence is visibly missing; it must not show an unrelated nearby frame. Full audio/video is optional if accurate frame-and-quote links satisfy the intended experience.

**Integration seam:** stable source-session and asset IDs in `ScreenMoment`; durable redacted frames in local IndexedDB or a small artifact store; shared retrieval in both map and tutor. Local-only storage supports same-device replay, not automatic transfer to another judge's device—declare and test the chosen mode.

### A5. Trust controls do not cover every data path

**Evidence:** `on_utterance` appends text to the session transcript before testing `off_record`. The voice hook keeps its own transcript, and the tutor branch of `converse.reply` proceeds to `_tutor_turn` without respecting an empty off-record immediate reply. Previously started learning tasks are not cancelled by a record toggle. I found DOM rectangle masking for frames, but no implemented Presidio/text-redaction path in the inspected source. `novice.py` sends the full case, including supplier fields, to the model.

**Consequence:** “off the record” currently means less than “this content is neither retained nor used.” Screenshot blur does not redact structured JSON or spoken text. DOM viewport rectangles also require the shared capture surface to match the tab geometry; whole-display sharing can offset the mask.

**Proposed acceptance:** during a later controlled test, mark a distinct fake phrase and fake account number off record; verify they do not enter stored events, map updates, post-pause model requests, or tutor responses. Test a slow in-flight answer across the pause boundary. Use a visible masked preview for the supported capture mode. Explain that audio used to recognize a spoken pause command has already reached the voice service; use a local control for a stronger pause boundary.

**Integration seam:** client capture/mic pause, server ingestion gate, off-record generation token for pending work, transcript/context filtering, and redaction on model-bound structured data. This is an explicit challenge criterion, not an extra ethics workstream.

### A6. Vision is presently an observation stream, not a complete alternate decision pipeline

**Evidence:** `post_frame` calls the vision model and sends `type='vision'`; `Session.on_event` emits that reading as a screen event. The reviewed vision branch does not open a decision point, update normalized case state, or compare an observed decision. Those operations depend on known case IDs and DOM events. The console starts with vision disabled.

**Consequence:** sharing a screen can display contextual understanding, but “works on any screen” and vision-only pre-save protection are not established. A 1–2 second frame cadence cannot guarantee interception of an arbitrary application's save.

**Proposed acceptance:** in the chosen ERP workflow, a real frame yields a visible event; its screen moment is attached to the inquiry. For the hackathon, explicitly describe DOM assistance and limit guaranteed pre-save blocking to the integrated sandbox. If general vision capture is demonstrated, test it separately with DOM observation disabled.

**Integration seam:** normalize vision readings into the existing event schema; deduplicate DOM/vision by case, field, time, and source confidence. Do not make general desktop capture a prerequisite for the narrow demo.

## B. Make the learning claim accurate and robust

### B1. “Confirmed” can mean one explanation and its own originating example

**Evidence:** `refresh_belief` assigns prior counts 3 and 1 when a quote exists. One agreeing live observation gives `(3+1)/(3+1+1) = 0.8`, enough for `confirmed`. `_node_from_compiled` adds the same episode that prompted the explanation. Teach-back is also counted as behavioral evidence. `ACTIVE` includes inferred and stated rules; `TRUSTED` includes stated rules.

**Consequence:** a new explanation can become confirmed without surviving an independent prediction. The novice prompt says confirmed knowledge, while its rule list includes provisional rules. Tutor enforcement can use a merely stated rule. These are design decisions, but the labels currently imply stronger validation.

**Proposed acceptance:** the initial answer is “expert stated”; its originating example is “explains observed case”; an independent later case is “behavior validated.” Deduplicate evidence IDs and keep testimony separate from observations. Distinguish advisory provisional rules from enforceable expert-approved guardrails. Display evidence counts instead of a calibrated-looking probability unless calibration has been measured.

### B2. Some “pre-committed” predictions may be created after a decision arrives

**Evidence:** `on_decision` calls `open_case` if a prediction is missing. That can compute the baseline after receipt of the decision; it does not necessarily use the answer, but it is no longer prospectively committed. Opening and saving use different network paths.

**Proposed acceptance:** record decision arrival independently of inference completion. Only count predictions whose committed sequence precedes decision arrival. Label late predictions “unscored”; do not discard the expert observation. Freeze the input state and map version with the prediction. Handle a rapid save and delayed model response without fabricating a prospective hit.

### B3. The visible uncertainty reduction partly comes from hand-assigned confidence

**Evidence:** `_collapse` assigns the selected hypothesis 0.95 and unknown mass 0.01. The subsequent entropy drop contributes to the question bandit's reward. `impact_on_pool` and question values include heuristic constants.

**Consequence:** those are useful prototype ranking scores, but fewer entropy bits can reflect the assignment rule rather than independently demonstrated improvement. A bandit could favor questions that produce confident-sounding answers.

**Proposed acceptance:** call the present value an information-value estimate. Measure whether a question improves future expert agreement or resolves a real exception. Keep later outcome feedback distinct from immediate compiler confidence. The threshold posterior is a more defensible visible uncertainty example, subject to its assumptions.

### B4. Mastery can rise on repeated saves of the same case

**Evidence:** `_bkt` updates on every `before_save` call and has no unique opportunity identity or hint flag. With the current defaults, two correct updates from the 0.2 prior raise the estimate to approximately 0.931. Those could be repeated attempts on one already explained case.

**Proposed acceptance:** retries are idempotent; an assisted correction is not an independent success. Report “needed help,” “correct independently,” and “not tested.” Require a fresh case without hints before claiming independent transfer. A model-derived BKT estimate can remain a secondary practice-selection aid.

### B5. Readiness, hard-stop semantics, and completion need one shared contract

**Evidence:** `understood` accepts any learned node for step coverage and any expert guardrail for the guardrail check, rather than checking each step's reviewed status. `run_map` records a `block` guardrail but excludes it from action candidates, so another action may still appear as the prediction. `check_proposal` blocks unconditionally for an applicable `block`. The capture hook returns `{allow:true}` after a network error.

**Consequence:** prediction, readiness, and save authorization can disagree. A missing tutor check can look like permission to save, while a block condition can prevent a corrective hold as well as a post.

**Proposed acceptance:** define a result that includes allowed actions, explicit stop state, evidence status, and uncovered decisions. For the tutor demo, a failed check means “checking unavailable; retry,” while capture-only observation can remain nonblocking. Test both an unsafe post and the appropriate corrective action. Every step has observed evidence or a clearly stated limitation before completion.

## C. Rehearsal checks rather than speculative rewrites

- **Question timing:** the planner's budget caps questions but does not guarantee three relevant live questions. Test with a human who moves on quickly; asynchronous questions can become stale after case transition. Revalidate the anchor before speaking. Silence while motionless reading is not directly observable; task boundaries and a simple “give me a moment” control help.
- **Voice silence:** the source includes VAD-based gating, but spontaneous user speech can trigger `_small_talk`. The custom endpoint currently emits text, not `skip_turn` tool calls. Official ElevenLabs documentation says custom-LLM system tools require function-call responses. Verify actual behavior rather than assuming prompt instructions guarantee silence.
- **ERP integration:** no ERP implementation directory was present in this checkout at review. The Lovable prompt is a contract, not proof of a connected ERP. Verify all actions await the save hook, custom select controls emit events, session IDs stay attached, and tutor cases load after the mode switch.
- **Session persistence:** event and map storage exists, but live sessions are in memory. Opus's own update notes a backend reload cleared them. Avoid planned reloads during presentation; independently test recovery before claiming resumability.
- **Assertion scope:** the engine test's 95% threshold applies to cost-center predictions over generated cases. It is not a 95% full-workflow, guardrail, speech, or human-learning result. The debrief test does not require the overall `done` flag to be true.

The highest-return integration batch is A1–A4 plus the required trust demonstration. Then address B1–B2 before showing learning metrics. Use the remaining items to select focused acceptance tests at Opus's next stable checkpoint.
