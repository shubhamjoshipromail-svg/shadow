export type Status = 'inferred' | 'stated' | 'confirmed' | 'contested'

export interface Quote { text: string; speaker: string; ts: number | null; lang: string; translation: string | null; inquiry_id: string | null }
export interface ScreenMoment { ts: number | null; frame_id: string | null; entity: string | null; field: string | null; label?: string | null }
export interface Evidence { episode_id: string; kind: string; agrees: boolean }
export interface Belief { status: Status; p: number }

export interface MapNode {
  id: string; step_id: string | null; title: string; when: string; origin: 'doc' | 'expert' | 'inferred'
  quote: Quote | null; screen_moment: ScreenMoment | null; belief: Belief; evidence: Evidence[]
  then?: Record<string, string>; kind?: string; parent?: string | null; priority?: number
  type?: string; action?: string; ask?: string | null
}
export interface Step {
  id: string; order: number; name: string; description: string; screen_moment: ScreenMoment | null
  decision_field: string | null; rule_ids: string[]; guardrail_ids: string[]; discretion: boolean
}
export interface WorkMap {
  pack_id: string; task: string; expert: string; version: number
  steps: Step[]; rules: MapNode[]; guardrails: MapNode[]; params: Record<string, number>
}

export interface FieldPred { value: string; source: string; p: number }
export interface Prediction {
  fields: Record<string, FieldPred>; action: FieldPred | null; fired_rules: string[]
  triggered_guardrails: string[]; uncovered: string[]; rationale: string | null
}

export interface Episode {
  id: string; case_id: string; ts: number; expert: Record<string, string | null>; predicted: Record<string, string | null>
  gaps: { id: string; field: string; expert: string; predicted: string; type: 'parametric' | 'structural'; why: string }[]
  synthetic: boolean
}

export interface Hyp { id: string; title: string; when: string; posterior: number; consistent: number; inconsistent: number; attention_boost: number }
export interface HypSet { gap_id: string; case_id: string; field: string; expert_value: string; predicted_value: string; items: Hyp[]; p_unknown: number; entropy: number }

export interface Inquiry {
  id: string; type: string; case_id: string | null; field: string | null; text: string; evoi: number; impact: number
  guardrail_gap: number; cost: number; value: number; phase: string; status: string; reason: string
  hypotheses: { id: string; title: string; p: number }[]; probe_delta: string | null; screen_moment: { ts?: number } | null
  asked_at: number | null; target_node: string | null
}

export interface Posterior {
  name: string; basis: string; basis_probs: Record<string, number>; mean: number; sd: number; n_obs: number
  curve: { grid: number[]; density: number[] }
}

export interface CaseT {
  id: string; invoice_no: string; currency: string; net: number; gross: number; status: string
  supplier: { name: string; country: string; status: string; intercompany: boolean }
  lines: { description: string; category: string }[]
}

export interface Understood {
  exam: { passed: boolean; score: string }
  steps_covered: { passed: boolean; covered: number; of: number }
  guardrails: { passed: boolean; count: number }
  agenda_exhausted: { passed: boolean; best_remaining_value: number }
  teachback_confirmed: { passed: boolean }
  done: boolean
}

export interface Metrics {
  episodes: number; decisions: number; prospective_accuracy: number | null; gaps: number
  questions_live: number; questions_debrief: number; silent_decisions: number; rules_learned: number; rules_confirmed: number
}

export interface Snapshot {
  id: string; mode: 'capture' | 'debrief' | 'tutor'; expert: string; trainee: string | null; lang: string
  pack: { id: string; name: string; fields: { name: string; label: string; options: string[] | null; option_labels: Record<string, string> }[]; actions: string[] }
  map: WorkMap; current_case: string | null; cases: CaseT[]
  predictions: Record<string, Prediction>; episodes: Episode[]; hypotheses: Record<string, HypSet>
  inquiries: Inquiry[]; posteriors: Record<string, Posterior>
  silence_log: { case_id: string; field: string; value: string; why_silent: string }[]
  off_record: boolean; understood: Understood; mastery: Record<string, { p: number; status: string; title: string; opportunities: number }>
  metrics: Metrics; activity: { paused: boolean; blocking: string[] }; simulated: boolean
  map_source: MapSource; receipts: Receipt[]; proofs: Record<string, Proof>
  pending: { awaiting: string | null; compiling: boolean; background_tasks: number }
}

export interface MapSource { kind: 'seed' | 'given' | 'session' | 'saved'; session?: string; version?: number; saved_at?: number }

export interface FieldGuess { value: string | null; source: string | null; source_title: string | null; map_version: number; committed?: string | null; explains_expert?: boolean }
export interface DiffNode { id: string; title: string; when: string; status: Status; kind: string; then: Record<string, string>; params?: Record<string, number> }
export interface ReceiptCheck { episode: string; case_id: string; field: string; node: string; predicted: string | null; decided_by: string | null; expert: string; agrees: boolean; map_version: number; proof: string | null; t: number }
export interface Receipt {
  id: string; trigger: 'answer' | 'decision'; t: number; session: string
  status: 'learned' | 'no_change' | 'compile_failed' | 'kept_open'; error?: string
  provenance: { mode: 'live' | 'rehearsal'; compiler: string; map_source: MapSource }
  inquiry_id: string | null; case_id: string | null; probe_case_id?: string | null; field: string | null
  question: { type: string; text: string; probe_delta: string | null } | null
  teaching: { transcript?: string; quote?: string; translation?: string | null; behavior?: string; case?: string; threshold?: { param: string; value: number; quantity: string } | null }
  expert_value: string | null; before: FieldGuess | null; after?: FieldGuess | null; evaluation?: boolean
  diff?: { added: DiffNode[]; removed: { id: string; title: string }[]; changed: { id: string; title: string; changes: Record<string, { before: any; after: any }> }[]
    params: { param: string; before: number | null; after: number | null; quantity_before: string | null; quantity_after: string | null }[]; version: { before: number; after: number } }
  retro?: { node: string; case_id: string; agrees: boolean; now_explains: boolean }[]
  independent: ReceiptCheck[]
  summary: { tests: number; agree: number; verdict: 'held' | 'contradicted' | 'untested' | 'compile_failed' | 'kept_open' | 'no_change' }
}

export interface ProofItem {
  case_id: string; describe: string; quantities: Record<string, number>; sealed: boolean; label: string | null
  bucket?: string; predicted?: string | null; source?: string | null; agrees?: boolean | null; labeled_via?: string | null
}
export interface Proof {
  id: string; round: number; mode: 'threshold' | 'discovery'; param: string | null; field: string; positive: string | null
  rule: string | null; rule_title: string | null; learned: { value: number | null; quantity: string }
  map_version: number; map_fp: string; map_source: MapSource; frozen_at: number; seed: number; provenance: string
  commitment: string; sealed_body?: string; items: ProofItem[]
  summary: { n: number; labeled: number; agree: number; accuracy: number | null; complete: boolean
    by_bucket: Record<string, { n: number; agree: number }>; failures: { case_id: string; bucket: string; predicted: string; label: string }[] }
}

export interface Intervention {
  id: string; case_id: string; say: string; explain: string; field: string
  violation: { title: string; quote: Quote | null; expected: string; got: string; kind: string }
  screen_moment: ScreenMoment | null
}

export type ShadowEvent = { type: string; t: number; [k: string]: any }
