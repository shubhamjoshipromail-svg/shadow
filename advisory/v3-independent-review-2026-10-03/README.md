# Shadow V3: independent review and winning plan

Prepared October 3, 2026, America/Los_Angeles. Advisory only; implementation was actively changing during review.

**Recommendation: finish one convincing, human-driven learning loop, then make the improvement impossible to miss.** Keep V3's executable Work Map. The most valuable addition is a learning receipt: what Shadow predicted before, what the expert taught it, what changed, and whether the change worked on an independently answered, unseen case.

The project already has substantial foundations. The priority is turning those foundations into reliable evidence of learning and a patient voice experience. Adding more algorithms before that evidence exists will weaken the submission by consuming rehearsal time.

## Read in this order

1. [Implementation review](</Users/shubhamjoshi/Hacknation 2/advisory/v3-independent-review-2026-10-03/IMPLEMENTATION_REVIEW.md>) — observed strengths, concrete gaps, and acceptance checks for later integration.
2. [Learning and extensions](</Users/shubhamjoshi/Hacknation 2/advisory/v3-independent-review-2026-10-03/LEARNING_AND_EXTENSIONS.md>) — how to prove learning, the three best additions, and the longer-term product.
3. [Demo and execution plan](</Users/shubhamjoshi/Hacknation 2/advisory/v3-independent-review-2026-10-03/DEMO_AND_EXECUTION_PLAN.md>) — sponsor requirements, rehearsal sequence, conditional priorities, and pitch.
4. [Research and source notes](</Users/shubhamjoshi/Hacknation 2/advisory/v3-independent-review-2026-10-03/RESEARCH_AND_SOURCES.md>) — primary research, competitor positioning, and limits on the conclusions.

## My assessment of Opus's direction

**Keep the architecture.** The restricted rule language, reusable `run_map`, event log, separation between real and simulated compilation, active probes, and pre-save tutor intervention all support the intended product. V3 is meaningfully more coherent than a collection of independent capture, summarization, and tutoring features.

**Shift the next milestone from breadth to a real end-to-end session.** Opus's session reports 16 passing backend tests and a clean frontend type-check, followed by simulator and visual checks. I inspected the tests; their compiler and proposer are oracle-backed stand-ins. Those checks are useful engineering evidence. They do not establish that arbitrary spoken explanations are understood, that ElevenLabs remains silent at the right times, or that a judge can teach a previously unknown rule.

**Treat provider readiness as a dependency.** The reviewed live LLM wrapper uses Anthropic. Your separate chat reports a failed Anthropic credit redemption and discusses using available OpenAI credits. That discussion has not become a provider-independent implementation in the inspected wrapper. Key presence also does not prove billing or model access. This needs a small live capability check by the implementation owner before rehearsal.

**Keep the sponsor's product framing in front.** The brief makes the conversation central. For the audience, Shadow is a thoughtful apprentice who learns, checks its understanding, and teaches Lena. The executable map explains why that experience works. Begin the pitch with the person and the decision; bring up the algorithm when someone asks how it works.

## What would most improve the chance of winning

| Priority | Deliverable | Why it matters |
|---|---|---|
| First | One real voice + shared-screen + ERP session | Demonstrates the product the sponsor actually requested |
| First | Three live questions, three genuinely new debrief follow-ups, confirmed teach-back | Direct challenge requirements, with timing and content evidence |
| First | Durable source moment and exact expert quote available in tutor mode | Connects learning to teaching visibly |
| First | Fresh trainee case, wrong save blocked, then a second case solved without help | Proves both intervention and transfer |
| First | Honest frozen exam and map-version tracking | Makes learning claims defensible |
| Next | Judge-chosen rule + before/after learning receipt | Strongest compact response to “is this scripted?” |
| Next | One counterexample that corrects an overbroad rule | Makes the system feel capable of learning exceptions |
| Later | Agent export, extra domains, two-expert comparison | Valuable extension story once the core works |

No scoring weights or win probability are assumed. The supplied brief gives requirements and strong/weak examples, not a numerical judging rubric or confirmed pitch duration.

## What “self-learning” can honestly mean here

Shadow can select its own informative question, turn the expert's answer into a persistent rule, test that rule against independent evidence, and change future predictions and tutoring. That is a substantive learning loop without fine-tuning an LLM.

The strongest product claim is:

> Shadow learns an expert's decision practice, shows the evidence, and checks whether that knowledge transfers to a new case and a new person.

Avoid claiming objective accounting correctness, general professional competence, calibrated confidence from a few examples, or autonomous recursive improvement. The hackathon examples are fictional company practices. Predicting Sabine and proving Sabine is universally correct are separate tasks.

## Scope and isolation

Reviewed: the complete eight-page AI Apprentice brief at `~/Downloads/file.pdf`; V3 architecture; Lovable ERP contract; incomplete process document; relevant local Opus session requests and progress; backend learning/runtime/API code and tests; frontend capture, voice, map, and tutor paths; the related “Challenge Comparison and Recommendation” chat; and the primary external sources cited in the research note.

The older Desktop/Hacknation research inventory refers to a different challenge, “The Negotiator.” It was not treated as a requirement for this AI Apprentice submission. I did not establish access to every remote HackNation document, current organizer announcement, or external Lovable project.

No messages were sent to Opus. No implementation files, dependencies, databases, environment variables, running services, or agent instructions were changed. I did not operate the shared demo or rerun its tests. All new files are inert advisory documents in this folder. The source manifest records the closing inspection hashes; it is not a claim that the actively edited workspace was an atomic snapshot throughout review.

Implementation findings are requests to verify against Opus's eventual checkpoint, not instructions to stop its current work. The individual acceptance checks make this folder directly usable as a later integration backlog.
