# Demo and execution plan

**The demo should make three changes visible: Shadow learns, its Work Map changes, and Lena becomes more capable.** The complete experience needs both a quiet voice and inspectable evidence.

This plan is for integration after the active implementation reaches a checkpoint. It does not dispatch work or set a deadline. The exact time remaining, final submission requirements, and pitch slot were not verified.

## Sponsor requirements and evidence to collect

Requirements below come from the supplied [AI Apprentice brief](</Users/shubhamjoshi/Downloads/file.pdf>), especially pages 3–7. The “seven steps, three judgments, four guardrails” example is a benchmark illustration, not separately labeled as a numerical mandatory requirement. The question counts and unseen-case tutor behavior are explicitly required.

| Requirement | Evidence the submission should contain | Current review status |
|---|---|---|
| Screen sharing with vision events | A real frame and corresponding visible semantic event | Capture and vision components exist; live proof unverified |
| At least three live questions | Three spoken, screen-anchored questions in the session record | Simulator test checks a count; human timing unverified |
| Natural pauses | Visible typing/speech stops before each question; no repeated interruptions | Activity gate exists; actual conversational behavior unverified |
| At least one guardrail question | Expert explains a stop, limit, or escalation condition | Planner support exists; exact live path to rehearse |
| Three new debrief follow-ups | Three unresolved issues closed, not repeated answers | Agenda exists; compilation/advancement ordering needs checking |
| Confirmed teach-back | Expert confirms or corrects the actual executable policy | Implemented path; readiness and version validity need checking |
| Every step/guardrail links to screen moment and words | Click through the complete map and retrieve original evidence | Data structures exist; durable replay has gaps |
| Unseen case for a judge as new hire | Separate trainee case with preserved expert map | Tutor path and seeded cases exist |
| Wrong decision caught before save | Attempt blocked before ERP mutation, exact reason shown/spoken | Intercept implemented; real ERP integration unverified |
| Evidence that trainee learned | Second fresh case solved independently | Mastery UI exists; unique unassisted opportunity proof needed |
| Off-record and personal-data protection | Visible pause/resume and correctly masked fake sensitive data | Partial controls; multiple uncovered paths identified |
| Moonshot with path from MVP | One final slide tied to existing artifacts | Can be prepared from V3 without extra infrastructure |

## Use two demonstration formats

**Full evidence session: approximately 8–10 minutes.** This fits the brief's suggested workflow length and gives room for three live questions, three new follow-ups, a teach-back, and a trainee task. Record an actual completed session after the live path works.

**Pitch version: approximately 4 minutes only if that is the allowed slot.** Show selected moments from the full session with honest editing, then a small live judge interaction. If the pitch must be entirely live, rehearse a narrower sequence that still meets the actual judging format. Do not pretend a four-minute montage demonstrates an uninterrupted ten-minute workflow.

## Full session storyboard

| Segment | Approximate time | Audience sees |
|---|---|---|
| Establish the problem | 20 seconds | Written instruction, expert, apprentice side panel |
| Expert processes invoices | 3 minutes | Baseline predictions, quiet observation, three useful questions including a guardrail |
| Debrief | 2 minutes | Three distinct gaps, one discriminating counterfactual, teach-back and correction |
| Map and learning receipt | 45 seconds | Original evidence; version change; result on fresh case |
| Trainee attempt | 90 seconds | Wrong save blocked, Socratic prompt, expert reasoning replayed |
| Independent transfer | 45 seconds | Another new case solved without hints |
| Moonshot | 20 seconds | Same knowledge teaches people and constrains future agents |

These are rehearsal budgets, not a promise that current latency supports them. Shorten explanation before shortening the human's thinking time.

### Capture: three useful questions

Use the case behavior to select questions. Candidate examples:

1. “You changed the cost center on this equipment invoice. What made you change it?”
2. “You held this invoice after checking the history. What did you notice?”
3. “When would you stop rather than post an invoice like this?”

The third must identify a real guardrail, such as missing asset information or an escalation condition. The wording and order should follow the observed actions. Do not ask why a value changed before there is evidence that it changed.

Show one explained decision that Shadow leaves alone. A brief “already explained by the learned rule” note demonstrates restraint better than a crowded log of every correct field.

### Debrief: three new unresolved questions

Possible questions, only if the answers remain unknown:

1. “Does that threshold apply to the net amount or the gross amount?”
2. “Does the hold apply to every supplier or just this one—and does it apply outside December?” Split this if the answer becomes ambiguous.
3. “What has to happen before that held invoice can be released, and who can authorize it?”

The third may require a new release-condition field in the map; otherwise choose an unresolved guardrail the existing schema supports. A question about something the map cannot represent should not silently become an unusable note.

Use one minimal contrast on screen. The expert should not have to keep an entire hypothetical invoice in working memory. Ask one decision at a time and permit “I need more information.”

Generate the teach-back from actual executable conditions. If the expert changes net to gross, show the changed predicate and a new validation status. Do not leave the old “passed” badge intact.

### Tutor: independence is the final payoff

Let the new hire predict the next decision, make the wrong choice, and attempt to save. The integrated ERP holds the action. Shadow asks why Sabine would stop, then explains with her exact quote and source moment. Let the trainee correct it.

Then use another invoice differing in amount, supplier, or exception. No leading hint before the trainee commits. Show “correct independently” or “needed help” honestly. A corrected replay of the first invoice is not that second test.

## Interface focus

The audience needs three main views: the expert's work, one question, and one learning change. Keep hypothesis bars, threshold curves, and raw conditions available on demand. The current multi-panel console is useful for development; its strongest details can be selected for the presentation.

Useful visible states are “watching,” “waiting for a pause,” “question queued,” “learning from your answer,” “testing the rule,” and “ready to teach.” These should reflect actual events. Avoid status labels that claim learning is complete while compilation or evaluation remains pending.

## Integration order by remaining time

Estimates below are planning judgments and depend on the live ERP/voice setup. They are not measured implementation durations.

| Time available after checkpoint | Work to prioritize | Stop condition |
|---|---|---|
| Very little, roughly 2–4 hours | Live provider/voice path, ERP save hook, source replay, truthful mode/status labels, full rehearsal | One uninterrupted human session satisfies the explicit requirements |
| Roughly 4–8 hours | Above plus serialized debrief, frozen evaluation, distinct student opportunities, compact learning receipt | One supported judge rule learned and tested prospectively |
| Roughly 8–16 hours | Above plus one exception repair, version regression checks, stronger pause/recovery behavior | Three varied full rehearsals without a critical failure |
| More time | Improve the weakest measured part of the experience; optionally multilingual or agent export | Stretch work cannot endanger the demonstrated core |

A critical failure means missing a required question or evidence link, wrong session routing, false completion, an unsafe save within the declared tutor contract, or inability to finish. Simulator regressions and live conversational regressions are separate checks.

Preserve Opus's working checkpoint before any later changes. Integrate one coherent batch at a time: first live-path blockers, then evaluation/evidence semantics, then the learning receipt. Recheck source findings because Opus may already have fixed them. Do not replace the architecture or refactor the entire engine to add these capabilities.

## Rehearsal matrix

| Run | Variation | Pass evidence |
|---|---|---|
| 1 | Known fictional policy, ordinary speech | Complete sponsor loop with all required counts |
| 2 | Different supported threshold and paraphrase | Learned value changes; unseen boundary answer matches |
| 3 | “I'm not sure,” “repeat that,” and delayed answer | No invented rule, duplicate question, or premature teach-back |
| 4 | Corrected rule after initial confirmation | Changed map invalidates old exam; next question uses new rule |
| 5 | Move from expert session to tutor and refresh | Source frame and quote remain retrievable |
| 6 | Off-record interval and masked fake personal data | Declared exclusion/redaction behavior holds across relevant paths |
| 7 | Tutor check unavailable in a controlled test | Clear unavailable state; no false claim of checked permission |

Do not run failure injection on the active session. These are proposed checks for a later isolated rehearsal. Save a genuine backup recording once a full run works. An explicitly labeled replay is preferable to passing off simulator behavior as a live expert interaction.

## Pitch language and likely questions

Opening:

> “Sabine knows which invoices to stop, which exceptions matter, and when the written process is wrong. Shadow watches her work, asks the question it needs, and checks whether it learned enough to teach Lena.”

Learning moment:

> “Here is the prediction it made before Sabine acted. Here is her explanation. Now here is a different invoice—and the prediction changed because of what she taught it.”

Moonshot:

> “Every expert leaves behind a living map, a tutor, and an exam. New hires learn from it first. Agents can later handle the steps they pass, with explicit stops for the rest. New corrections keep the map current.”

| Judge question | Supported answer |
|---|---|
| “Is this scripted?” | “The workflow and rule families are bounded. Choose a supported rule value; the live compiler must learn it from your answer. Rehearsal mode is labeled separately.” |
| “What actually learned?” | “The persistent decision rules, their boundaries, and the evidence changed. We froze the old map and compared it with the new one.” |
| “What if the expert is wrong?” | “This MVP learns and tests fidelity to their practice. Organizational policy approval and outcome validation are separate next steps.” |
| “Can it work in any app?” | “We sample screen frames, and this ERP integration gives precise events and reliable save interception. General desktop interception is future work.” |
| “How do you know Lena learned?” | “She gets a different case without a hint; we record first-attempt independent success separately from assisted correction.” |
| “How is this different from workflow documentation?” | “We focus on questions that change the decision model, then test the resulting knowledge on unseen cases. Here is the evidence from this session.” |

Skip unsupported superiority claims, projected accuracy, and a long list of algorithms. End with the new hire's independent success and the path from this artifact to the next product stage.
