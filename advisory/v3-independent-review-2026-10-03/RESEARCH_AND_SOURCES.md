# Research and source notes

Sources checked October 3, 2026. External claims below use primary papers, official product documentation, or vendors' own descriptions. Vendor descriptions establish what they market; they are not independent proof of performance. The recommendations are my synthesis and need validation in Shadow.

## Local evidence

- [AI Apprentice challenge brief](</Users/shubhamjoshi/Downloads/file.pdf>), all eight pages, text extracted directly. Pages 3–4 state required Capture/Map/Teach behavior; page 4 lists the five Apprentice Tests; page 5 identifies stretch goals; pages 6–7 give practical guidance and the example submission.
- [Shadow architecture V3](</Users/shubhamjoshi/Hacknation 2/SHADOW_ARCHITECTURE.md>), full document: intended loop, executable map, capture/voice plan, self-exam, business vision, and cut order.
- [Lovable ERP contract](</Users/shubhamjoshi/Hacknation 2/LOVABLE_PROMPT.md>): expected application state, instrumentation, save hook, and case schema. This is a specification, not a verified ERP deployment.
- [Incomplete 2019 process document](</Users/shubhamjoshi/Hacknation 2/backend/shadow/packs/ap_invoices/process_doc_2019.md>) and AP pack/oracle: deliberate domain sandbox and learner baseline.
- Relevant local Opus session: `2ccf89a8-567b-413b-8381-253fce63227c`, model label `claude-opus-5-5`, user requests and progress inspected read-only. Its recent updates report testing and UI rehearsal; they do not substitute for independent live verification.
- Related chat: “Challenge Comparison and Recommendation,” recent discussion of the V3 loop, expert fidelity versus truth, and unusable Anthropic promo credits. Credit availability was reported by the user there, not verified through billing access.
- Source paths and closing hashes are listed in `SOURCE_MANIFEST.json`. No credentials or environment-file contents were inspected or copied.

Older local Hacknation folders contain a different ElevenLabs challenge (“The Negotiator”). Their inventory was checked to avoid mixing events. No claim is made to have inspected every remote organizer document. Submission deadline, pitch length, numerical judging weights, and account entitlements remain unverified.

## Research that changes the design

| Primary source | What it supports | Recommendation and limit |
|---|---|---|
| [Reflexion, Shinn et al., 2023](https://arxiv.org/abs/2303.11366) | Feedback stored in episodic language memory can improve later agent behavior without weight updates | A persistent rule-and-evidence update is a legitimate adaptation mechanism; this paper does not validate Shadow's accuracy |
| [DAgger, Ross et al., 2011](https://proceedings.mlr.press/v15/ross11a.html) | Sequential imitation needs attention to the states induced by the learner | Future agent mistakes should produce expert-label requests; current passive expert observation is not the full DAgger algorithm |
| [ThriftyDAgger, Hoque et al., 2022](https://proceedings.mlr.press/v164/hoque22a.html) | Novelty/risk gating can manage a budget of human interventions in interactive robot learning | Rank questions by decision value and human burden; transferring robotics results to desk work is a hypothesis, not a result |
| [BALD, Houlsby et al., 2011](https://arxiv.org/abs/1112.5745) | Information gain can select informative classification/preference queries | Show one case separating plausible rule hypotheses; uncertainty estimates still depend on the model |
| [Asking Easy Questions, Bıyık et al., CoRL 2019 / proceedings 2020](https://proceedings.mlr.press/v100/b-iy-ik20a.html) | Questions should account for the human's ability to answer, not only machine uncertainty | Prefer visually simple, single-change contrasts; measure answer burden instead of treating every synthetic probe as equally useful |

The practical design inference is to combine a narrow decision model, evidence-backed updates, easy discriminating questions, and a separate prospective evaluation. More complex training is not needed to demonstrate this loop.

## Sponsor integration facts

[ElevenLabs Custom LLM documentation](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm) describes the OpenAI-compatible route, streaming, extra request context, and function-call responses for system tools. That supports the architectural choice of letting Shadow select the dialogue while ElevenLabs supplies the conversation surface. It does not confirm that the user's agents, tunnel, billing, and overrides are configured.

[Skip turn documentation](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/skip-turn) provides an explicit silence mechanism. The reviewed endpoint emits text replies, so this is an integration seam to verify, not a feature presumed complete.

[Presidio getting started](https://microsoft.github.io/presidio/getting_started/) describes text detection and related structured/image tools. Screenshot masking and text redaction address different channels; merely naming Presidio in the architecture does not protect a full-case JSON request. The smallest hackathon trust implementation should clearly state and demonstrate its actual supported boundary.

## Competitive positioning: update the architecture's shorthand

[Scribe's agent page](https://scribe.com/solutions/train-ai-agents) markets AI-legible workflows, specialized operational knowledge, MCP/API delivery, and structured data for training. Therefore “we turn workflows into agent instructions” is not sufficient differentiation. Do not describe the whole category as only static screenshots.

[Interloom's current product page](https://interloom.com/en/) describes operational orchestration, a context graph of resolutions, and a learning loop using outcomes and graders. The architecture's shorthand that it merely mines historical cases is too narrow. The page does not establish whether it duplicates Shadow's exact live interview-and-tutor experience, so avoid claiming that it cannot.

**Positioning hypothesis:** Shadow can distinguish itself through live elicitation of missing decision knowledge, explicit counterexamples, prospective evaluation, and independent human transfer—with expert time as a constrained resource. Demonstrate those properties and measure them. A defensible future advantage would be better learning efficiency and reliable deployment in a narrow workflow, supported by the accumulated evidence corpus.

## Claims to keep, qualify, or remove

| Claim | Recommended treatment |
|---|---|
| “It learns without fine-tuning” | Keep if persistent changes alter future behavior and survive independent checks |
| “It learns what the expert knows” | Qualify to the modeled task, observable context, and tested cases |
| “The map is executable” | Keep; show `run_map` producing decisions and the tutor using the same semantics |
| “95% accurate” | Do not generalize the current synthetic cost-center assertion into a product result |
| “Confidence: 95%” | Label as a heuristic belief score unless calibrated against independent outcomes |
| “Every mismatch is a preference-training pair” | Qualify: common context, valid alternatives, expert review, and separate evaluation are required |
| “Works on any screen” | Limit to observed capture capability; generic decision extraction and save interception remain unproven |
| “Agent certification” | Use as a future capability-scoped gate; five examples do not certify general autonomous competence |
| “Nobody else is doing this” | Remove; show the specific difference without asserting exclusivity |

No headline market size, demographic statistic, projected ROI, or benchmark superiority is necessary for the proposed demo. Use only results actually measured in the team's own session.
