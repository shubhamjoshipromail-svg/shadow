# Learning unfamiliar tasks with little prior context

Proposal, not a description of current functionality. The existing invoice engine cannot yet execute this whole flow.

## 1. What “task agnostic” should mean

Use a testable definition: **a person can introduce an unseen workflow through an outcome description and demonstrations, without a developer adding its steps, decision fields, cases, or business rules beforehand.** Generic app access and reusable observation adapters are allowed and must be disclosed. A second handwritten workflow pack proves extensibility, not this definition.

Separate four levels of novelty:

| Level | Example | Current position |
|---|---|---|
| New value/rule in a known task | Expert uses a different capex threshold | Mechanism supports this; live parsing needs verification |
| New observable concept in a known task | A previously unknown compliance flag changes routing | No reliable schema extension and evidence-binding path |
| New task in a known app | Same ERP, different process and success criteria | Not implemented by merely changing the task name |
| New task in a new app | Support triage in an unfamiliar ticket tool | Requires generic capture, task induction, and outcome validation |

“No pre-context” cannot mean no knowledge whatsoever: the foundation model brings pretrained knowledge, the interface provides clues, and the human supplies intent. A credible promise is **no task-specific setup or process document required**. Without an outcome or successful example, identical clicks can serve different goals; Shadow should ask instead of pretending intent is observable.

Start by learning to explain and coach unfamiliar tasks. Independent autonomous execution is a further milestone with different failure costs.

## 2. Proposed first-session experience

Begin with three short prompts, ideally answered conversationally:

1. “What are you trying to get done?”
2. “How will we know this case is finished correctly?”
3. “Show me one example. May I save my questions for pauses?”

If the first two are already clear from the user's request, do not ask again. Optional documents seed assumptions with a document provenance label; their absence must not prevent capture. Let the expert mark an example complete rather than relying on perfect automatic segmentation from day one.

During the demonstration, record evidence before interpretation: visible object, action, changed state, source, time, and observation confidence. Infer a tentative procedure and name its uncertain parts. A click is evidence of an action; it is not automatically evidence of the reason or correctness.

After one example, show a short teach-back: “I saw you inspect impact, choose the owner, and set priority. I don't yet know which impact requires escalation.” Ask only the most decision-relevant missing question. Avoid extracting ten confident rules from a single example.

On subsequent examples, freeze the prediction before the person's decision. Compare at a real decision boundary, not every keystroke. A mismatch can mean an unreadable field, a mistaken interpretation, a different task, a rule exception, or an expert error; do not immediately treat every mismatch as new company policy.

Reuse existing knowledge in later sessions through an explicit **continue this workflow** path. Grow coverage and reduce questions for supported situations. New exceptions can increase questions even after a long period of silence.

## 3. Proposed runtime task model

Keep the executable Work Map and evidence philosophy. Replace the requirement for a developer-authored case world with a versioned task model built from observations and expert corrections.

| Object | Required information |
|---|---|
| Task definition | Goal, start/end cues, successful outcome, scope, owner, schema version |
| Observation | Source app/page, time, visible fact/value, source region/event, readability, missingness |
| Episode | Bounded example, before/after state, actions, actor, result, success evidence |
| Decision point | Available options, prerequisites, committed prediction, actual expert choice |
| Feature definition | Type, units, allowed values if known, how it is observed or derived, supporting examples |
| Knowledge item | Step/rule/exception/preference/example, scope, origin, evidence, status, version |
| Unknown | What is missing, why it matters, next question or observation needed |
| Assessment | Frozen model/map version, test input, independently supplied answer/outcome, score |

The model may propose schema changes as structured data. The expert confirms the meaningful interpretation, while deterministic checks validate types, values, references, and provenance. Do not generate and execute arbitrary Python/JavaScript to “learn an adapter.” The existing restricted rule runtime can remain a bounded execution target.

Two different kinds of knowledge need homes:

- **Decision knowledge:** if these grounded facts hold, select this option or ask this person. Existing rules/thresholds are useful here.
- **Procedural and qualitative knowledge:** step order, prerequisites, examples of good outcomes, and rationale that cannot yet be evaluated as a precise predicate. Store these honestly as procedures/rubrics/examples until a reliable checker exists.

Feature availability must be explicit. If an expert says “VIP accounts need engineering review” but VIP status is not visible, Shadow records a required external fact and asks how to obtain it. It must not invent `customer.vip` and quietly evaluate it as false.

Suggested availability states: observed, expert-supplied, derived, missing, unreadable, and conflicting. Keep observation confidence separate from confidence in the rule and confidence in a prediction.

## 4. How to generate useful examples without inventing truth

Generation and labeling are different jobs. A model can suggest a scenario; it cannot establish the company's correct answer by agreeing with itself.

Use this order of preference:

1. **Fresh real examples:** predict before the expert acts; score against the subsequent decision and outcome.
2. **Replay earlier examples:** useful for finding contradictions, but not an independent test if they shaped the rule.
3. **Expert-labeled counterfactuals:** vary one grounded fact to distinguish plausible explanations. Label the result as hypothetical testimony.
4. **Validated synthetic scenarios:** only after a task schema and constraints exist. Validate consistency, then ask an expert or use an independently specified outcome checker.

For a newly introduced support workflow, suppose Shadow is unsure whether escalation depends on contract tier or business impact. It can ask: “Same customer, but the problem blocks all users instead of one; would you choose the same route?” This is a candidate question, not a known correct policy. If the expert introduces a previously invisible dependency, extend the task model and gather its evidence.

Generated cases must preserve dependencies. Changing currency without changing amounts/exchange context, or changing a customer while retaining its old contract, creates misleading probes. Store constraints and the reason for each change. Show the exact change to the expert and allow “this situation cannot happen.”

At cold start, do not immediately generate forty synthetic cases as if the task were already understood. First capture one example and validate the important objects, options, and outcome. Until then, ask grounded clarification questions about the actual work.

## 5. Asking less as knowledge improves

Reuse the planner's interruption budget and natural-pause handling, but base question selection on task-specific uncertainty and novelty. Prefer questions that distinguish explanations with different practical consequences.

Useful signals: repeated prospective success on the same decision family, coverage of important exceptions, contradictions, missing observations, and explicit user interruption preferences. A simple age counter or number of stored rules is insufficient.

Separate live interruption budget from debrief budget and report both. If only the live budget shrinks while a long debrief grows, do not claim total human effort decreased.

Maintain the option to abstain: “I can identify the steps, but I cannot yet judge this exception.” That is a useful product outcome when supported by a targeted next question.

## 6. Multiple experts and learner progress

Proposed hierarchy: workspace → workflow/context → versioned knowledge, with attributed expert contributions and separate learner progress. Roles are scoped to a workflow; one employee can teach invoices and learn support triage.

When experts disagree, first check context: department, jurisdiction, customer type, effective date, or objective. Keep both candidate rules and their evidence until a workflow owner resolves policy. Distinguish mandatory policy, common practice, and individual preference. A majority vote does not automatically establish a correct rule.

Publication states should be distinct from epistemic confidence: a well-supported expert practice may still be unapproved company policy. Assign trainees an explicit approved map version; record what changes invalidate previous assessments.

## 7. Research basis and its limits

**Agent Workflow Memory (AWM)** induces reusable workflows from experience and retrieves them for later web-agent tasks, including an online setting. This supports a workflow-memory design rather than requiring weight training. It does not establish the ability to infer unwritten policy from one demonstration or certify this implementation. [Paper](https://arxiv.org/abs/2409.07429)

**WONDERBREAD** is especially relevant because it evaluates documentation, segmentation, knowledge transfer, and workflow improvement from human demonstrations. Its dataset contains 2,928 demonstrations of 598 workflows. Its authors report a tendency to add inaccurate/superfluous steps when generating SOPs. This supports separating observable steps from inferred intent and measuring invented steps, not merely producing an attractive map. [Project and findings](https://hazyresearch.stanford.edu/wonderbread-website/)

**Reflexion** demonstrates an agent using verbal feedback and episodic memory without updating model weights. It supports calling memory-based improvement a form of learning, while still requiring external feedback and task-specific evaluation. [Paper](https://arxiv.org/abs/2303.11366)

**ThriftyDAgger** studies querying humans using novelty/risk under an intervention budget. Its robotics results motivate selective questioning but are not office-workflow evidence. [Paper](https://proceedings.mlr.press/v164/hoque22a.html)

**Mind2Web** provides a precedent for separating cross-task, website, and domain generalization. Use this distinction in Shadow evaluation instead of treating new invoice IDs as unseen tasks. [Paper](https://arxiv.org/abs/2306.06070)

These sources establish plausible mechanisms and useful evaluation methods. None makes “learn any task reliably” a justified claim for Shadow today. This is focused research, not an exhaustive literature review or a new benchmark run.

## 8. Proof plan: distinguish learning from a prepared performance

### First prove live learning within the existing invoice task

Have an evaluator choose a supported rule value after the software is frozen, such as a previously unused threshold. Run live mode with real language compilation, not `FakeCompiler`. Record a baseline prediction before teaching, the actual teaching statement, the exact map diff, and predictions on fresh cases on both sides of the threshold. Include a counterexample that requires narrowing a rule and an unrelated case that should remain unchanged. Then reload the saved knowledge in a new session and check transfer.

This validates live adaptation **within the prepared invoice schema**. Do not call it new-task discovery.

### Then prove cold-start workflow learning

Select a different workflow, such as support triage, after the build is frozen. Start with no preloaded SOP, case list, or business rules for that workflow. Allow generic observations and a declared app adapter. The human states the goal, demonstrates cases, and supplies policy only when teaching.

Required evidence:

- The initial task model is empty apart from generic schema/capture capabilities and the stated goal.
- Objects, steps, choices, and task-specific features are learned during the session, with source links.
- At least one human-taught policy is deliberately unusual enough that pretrained convention is not a substitute for learning it.
- Predictions are committed before held-out labels/actions are exposed.
- Test labels come from an independent expert or deterministic task checker, not the same model that generated the cases.
- The final assessment freezes the map and prevents test answers from updating it; failures may become later training data, followed by a new test set.
- A fresh trainee can use the captured knowledge, with separate independent-performance scoring.
- A contradictory example and an unobservable required fact cause correction/abstention rather than confident invention.
- Resume after restart with the same approved workflow version and no cross-expert leakage.

Report separate metrics: observation extraction errors; invented/missed steps; prospective decision accuracy; whole-task success; live questions and debrief minutes; unsupported suggestions; appropriate abstentions; persistence/transfer; learner independent success. Compare document-only/base-model, passive demonstration memory, and active questioning under equal human-time budgets where feasible.

A handful of cases can demonstrate the mechanism, not estimate robust accuracy. For a stronger report, pre-register several workflows and multiple experts/seeds, reserve held-out cases, and report sample sizes plus uncertainty. Do not tune repeatedly on the final held-out examples.

## 9. Integration sequence

1. Preserve the current invoice engine and make a live evidence receipt trustworthy.
2. Introduce normalized observations and explicit session/workflow identity.
3. Add runtime task/feature schemas and missingness-aware validation.
4. Build cold-start goal/example onboarding and observation-to-episode admission.
5. Generalize `inv.`-specific engine paths; use packs as optional adapters/bootstrap hints.
6. Add constrained scenario proposals with independent labels and frozen evaluations.
7. Add organization publishing/assignment and expert reconciliation.

The browser extension can advance alongside the normalized observation contract. Building more dashboards before the observation-to-task-model bridge would make the product look broader without making it learn broader tasks.
