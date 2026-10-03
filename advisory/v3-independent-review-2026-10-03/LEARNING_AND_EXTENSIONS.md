# Learning that a judge can see

**The best V3 extension is a small proof of changed behavior.** Shadow should ask for information it lacks, preserve what it learned, and perform differently on a new case because of that information. The judge should be able to follow the causal chain without understanding Bayesian inference.

These are proposals for later implementation. Schemas below are design examples, not installed code or migrations.

## 1. Establish what changes when Shadow learns

V3 already contains four different adaptive mechanisms. Keep their claims separate.

| Mechanism | What changes | Convincing evidence | Current limit |
|---|---|---|---|
| Rule acquisition | Conditions, actions, exceptions | New supported rule changes an unseen decision | Needs real speech compilation and independent validation |
| Parameter estimation | Threshold/basis posterior | Expert answers distinguish net from gross or move a boundary | Posterior depends on model assumptions and selected evidence |
| Inquiry adaptation | Question selection | Equal time budget produces better future predictions | Current reward partly reflects assigned confidence; too few live turns for broad claims |
| Student modeling | Practice recommendation | Learner solves a different case without hints | Repeated/assisted saves are not independent mastery evidence |

Use “learns from feedback without retraining the base model.” Research supports feedback-memory approaches as a real adaptation mechanism; it does not establish performance for this particular implementation. [Reflexion](https://arxiv.org/abs/2303.11366) is a relevant precedent.

The minimum proof is:

1. Freeze the baseline map and a prediction on case A.
2. Observe expert action A and ask a focused question at a pause.
3. Compile the answer into a candidate map version.
4. Ask a discriminating probe with an independently supplied expert answer.
5. Freeze the resulting map; predict case B before the expert answers.
6. Compare baseline and learned map on B, while checking unrelated cases remain correct.
7. Give Lena another new case that uses the learned rule.

This establishes expert fidelity and transfer. It does not establish universal accounting truth. All invoice policies in the demo should be labeled fictional company policy.

## 2. Addition one: the learning receipt

**Priority: first differentiating addition after the sponsor loop works.** The backend already emits predictions, learned changes, map versions, and evidence. The extension connects these into one inspectable story.

Example display, with values populated from real events:

> Before Sabine taught me: POST.  
> Sabine: “For Krämer, hold December invoices until we verify duplicates.”  
> Learned: supplier = Krämer AND month = December → HOLD.  
> New December invoice: predicted HOLD before Sabine answered; matched.  
> Same supplier in March: predicted POST; matched.  
> Map changed from v3 to v4. Other checked decisions unchanged.

Show actual counts rather than an animated, unexplained confidence jump. The positive case proves application; the negative case proves the rule has a boundary. Display the old and new result on the same frozen case so unrelated changes in case difficulty cannot explain the improvement.

Suggested receipt fields:

```json
{
  "receipt_id": "receipt-7",
  "source_episode_id": "ep-3",
  "source_inquiry_id": "q-4",
  "before_map_version": 3,
  "after_map_version": 4,
  "changed_node_ids": ["G2"],
  "quote_ref": "quote-4",
  "evidence_refs": ["moment-3", "probe-8"],
  "evaluation_run_id": "eval-2",
  "positive_case_result": "pending",
  "negative_case_result": "pending",
  "regression_result": "pending"
}
```

**Integration:** store the immutable “before” map, link the existing `prediction`, `episode`, and `learned` events, and present a compact panel. Learning receipts should reference evaluation outcomes, not generate them. Display a receipt only when its data exists; “pending” is legitimate.

**Done when:** a judge can click the changed decision, inspect the exact expert statement and original screen moment, and see a prospective outcome on a different case. Refreshing preserves the receipt.

## 3. Addition two: a judge-chosen rule within a supported rule family

**Priority: second; high demonstration value with constrained scope.** Ask the judge to privately choose a threshold or supplier/month combination before the session. Tell them the supported rule families. The system learns their choice from behavior and voice; the answer must not be loaded into the learner's seed data, prompt, or simulator.

For example, the judge chooses the company's equipment threshold from a disclosed range. Shadow begins with only the process document, sees the expert's decision, asks whether the amount is net or gross, and tests a fresh case where the two interpretations differ.

Choose the demonstration cases carefully. An initial case far above every supported threshold will not reveal the selected value by observation alone. That is acceptable if Shadow asks for the rule, then independently validates its boundary. Do not pretend binary search occurred when the expert simply told it the threshold.

If adding a numeric boundary UI is easy, show two hypotheses and one concrete invoice:

| Hypothesis | Invoice net €4,800, gross €5,712 | Why this case helps |
|---|---|---|
| Over €5,000 net | Opex | Below net threshold |
| Over €5,000 gross | Capex | Above gross threshold |

This illustrative contrast comes from the existing V3 idea. The extension is making it judge-controllable and verifiable. Update the displayed numbers to the actual selected rule; do not force the demonstration to €5,000.

**Done when:** at least two different choices and two paraphrased explanations produce the corresponding different maps. A declined or unclear answer does not install a hidden default. A completely unsupported rule should produce “I need another field or clarification,” not invented competence.

## 4. Addition three: ask for the case that would break the rule

**Priority: after receipts and a reliable debrief.** This extends V3's counterfactual probes and conflict handling into a visible correction loop.

Example conversation:

> Shadow: “I think every equipment invoice above your threshold goes to capex.”  
> Expert: “Except leased equipment.”  
> Shadow: “So the lease flag changes the decision even at €8,000?”  
> Expert: “Yes.”  
> Shadow: “I added that exception. The owned-equipment examples still produce capex. I'll test the lease case next.”

Before choosing this example for the demo, add and validate the lease field in the schema and ERP. The reviewed pack does not expose a verified leased-equipment feature. A cheaper first version can use existing fields, such as category, supplier, month, or intercompany status.

**Mechanism:** generate plausible single-field variations near a candidate rule, discard invalid invoices, then prefer cases where plausible rules disagree or where an exception would change the decision. Ask the expert to label the selected case. The generator is allowed to propose questions; it is not the authority that declares the rule correct. BALD supplies an information-gain idea, and question difficulty matters as well. [BALD](https://arxiv.org/abs/1112.5745), [Asking Easy Questions](https://proceedings.mlr.press/v100/b-iy-ik20a.html).

**Important distinction:** agreement between several model-generated explanations is not independent expert evidence. A self-authored test with a self-authored answer is a consistency check. An independently labeled boundary case is stronger evidence of learning.

**Integration:** use the existing `pack.perturb`, hypothesis scoring, compiled exceptions, and map versions. Add proposed rule replacement/exception semantics and a regression gate. Do not overwrite a rule merely because one noisy observation disagrees.

**Done when:** a broad rule becomes a scoped exception, prior unaffected cases retain their behavior, the change has provenance, and the previous exam is invalidated. Show one repair in the demo, not a long synthetic argument between agents.

## 5. A clean boundary between learning and validation

Use three collections with explicit roles:

| Collection | Can change the map? | Can count toward a final score? |
|---|---|---|
| Observations and elicitation probes | Yes | Not as held-out evidence |
| Frozen evaluation cases | No, during that scoring pass | Yes, with independent labels and exact version |
| Regression cases | Used to reject harmful changes | Report separately; repeated exposure makes them development checks |

A compact validation contract:

```text
PredictionCommit:
  prediction_id, case_id, state_fingerprint, map_version
  received_sequence, committed_sequence, predicted_fields, predicted_action

EvaluationRun:
  evaluation_id, frozen_map_version, case_fingerprints
  expert_label_source, prediction_ids, results, invalidated_by_version

EvidenceRef:
  source_session_id, event_id, quote_id, media_asset_id
  source_time, evidence_kind, origin_episode_id

LearningChange:
  from_version, to_version, proposed_nodes, superseded_nodes
  scope, supporting_evidence, conflicting_evidence, regression_result
```

Use explicit epistemic states such as proposed, expert-stated, behavior-validated, and contested. Keep “approved to teach/block” as a separate operational decision. A stated hard limit may deserve immediate conservative handling, but the UI should not pretend it was empirically validated.

Save a stable state snapshot. If the application's mutable invoice object changes later, old episodes must still mean what they meant at decision time. Store model/prompt versions when using LLM outputs so provider changes cannot silently rewrite the explanation of a past result.

## 6. Measure improvement without gaming the score

The headline metric I recommend is **unseen expert agreement gained per minute of expert interaction, with guardrail misses reported separately**. It ties learning to interruption cost. A small hackathon sample is a demonstration, not a reliable population estimate.

Collect these separately:

- Whole-case action/field agreement on reserved cases, with numerator and denominator.
- Guardrail recall and false blocks, including rare applicable cases.
- Live questions and expert answer time; repeated or redundant questions.
- Silence violations while typing, speaking, or explicitly requesting time.
- Question release-to-audio and answer-end-to-map-update latency, with sample counts.
- Trainee independent first-attempt success, assisted corrections, and unseen rules.

The paired comparison should be between the frozen document-only baseline and the learned map on the same cases. A transcript-summary baseline is useful later. Give it the same available evidence and compute budget; otherwise an apparent advantage could come from different inputs. A fuller study should also compare a fixed three-question policy with active questioning under equal expert time.

Five exam cases can make a compact live demonstration. They do not justify broad claims of reliability. A later offline regression suite could cover 20–40 cases stratified across boundary, exception, normal, and guardrail situations; report its actual size and split rather than borrowing the current generated cost-center test's 95% threshold as a product statistic.

## 7. Additional ideas, ranked by value and dependency

| Idea | Stage | Value | Dependency / reason to wait |
|---|---|---|---|
| “What changed since last time?” with version diff | After reliable core | Living memory; visible correction over time | Scoped updates, persistence, and regression checks |
| Stop and ask when outside the learned region | Small next increment | Shows judgment about uncertainty | Explicit unsupported states; cannot rely on raw LLM confidence |
| Practice the trainee's weakest rule | After unique opportunity tracking | Connects learning to teaching | Hint tracking and new cases; existing mastery data is a start |
| “What did you check before doing nothing?” | Debrief improvement | Captures tacit guardrails missed by divergence-only asking | Limited coverage questions; no return to asking after every click |
| Missing fact request | Next product iteration | Separates unobserved context from a missing rule | Evidence schema; ask what signal the expert used before compiling a policy |
| Two experts, scoped disagreements | Stretch/post-event | Reveals site, role, and time differences | Context-aware rule scope; don't average incompatible practices |
| German expert → English trainee | Stretch if already stable | Easy-to-understand sponsor-aligned transfer | Test critical terms, thresholds, and original-quote provenance |
| Export an executable decision contract | Stretch | Builds toward agent use | Shared runtime and guardrail semantics; Markdown alone is instruction, not enforcement |
| Outcome-linked rule quality | Post-event | Tests whether expert-consistent decisions work in practice | Real outcomes and confounders; not inferable from imitation accuracy |
| Fine-tuning or preference training | Later | Possible use of accumulated episodes | Sufficient clean data, independent evals, and genuine preferences |

Matching the novice's action does not prove it knows the expert's reason. A very small coverage budget for stopping conditions is useful even when there is no divergence. This preserves the selective-questioning thesis while avoiding a blind spot for shared assumptions and hidden guardrails.

## 8. The startup path and the broader vision

Start with one team's repeated, costly exceptions in AP or another workflow the team can access. The buyer hypothesis is an operations lead responsible for onboarding and escalation load. Validate that hypothesis with a narrow pilot: expert minutes spent, independent new-hire case completion, expert interruptions avoided, and exception errors. Price and willingness to pay remain unknown; do not invent a market estimate for the hackathon.

The compounding asset is a versioned set of decision situations, alternatives, explanations, boundaries, outcomes, and tests. Raw episode count is not a moat by itself. The evidence must improve capture efficiency or downstream decisions, and the product must fit everyday work.

For agent training, a disagreement is not automatically a valid preference pair. Both actions need the same decision context; the expert action needs review; and two acceptable alternatives should not be forced into a winner/loser label. Reserve separate evaluation cases. Keep learning an expert's practice separate from organizational approval and outcome validation.

DAgger motivates collecting labels in states reached by a learner. Shadow's current expert-observation loop is related, but it is not literally DAgger or entitled to its guarantees. A future agent running sandbox tasks and requesting expert labels on its own failure states would be a closer application. [DAgger](https://proceedings.mlr.press/v15/ross11a.html).

Broader domains should reuse the evidence-and-probe loop while changing the representation:

| Domain | Evidence to learn from | How to check understanding |
|---|---|---|
| Software debugging | Failing tests, rejected patches, expert diagnosis | Fresh failure and independent test suite |
| Visual design | Alternative layouts, selected edits, stated constraints | New brief and expert pairwise judgments |
| Procurement/support | Cases, exceptions, escalation boundaries | New case with independent expert disposition |
| Physical or clinical expertise | Additional sensing and specialized expert context | Domain-specific outcomes and validation beyond this MVP |

The invoice DSL is a practical first representation, not a universal theory of expertise. Show the broader path on the moonshot slide. Keep the hackathon demonstration on the workflow that can actually be completed and checked.
