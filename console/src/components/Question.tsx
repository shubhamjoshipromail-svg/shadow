import type { Inquiry } from '../lib/types'

const TYPE_LABEL: Record<string, string> = {
  cue_probe: 'open question', confirm: 'confirmation', comparison: 'comparison', counterfactual: 'what-if',
  boundary: 'boundary', guardrail: 'guardrail', exam: 'self-exam', teachback: 'teach-back',
}

/** A margin query: a question mark, a rule down to what it concerns, and the question in plain words. */
export default function Question({ q, live }: { q: Inquiry | null; live: boolean }) {
  if (!q) return null
  return (
    <div key={q.id} className={`ink-in relative border-l-2 py-1 pl-5 ${live ? 'border-query' : 'border-rule-strong'}`}>
      <div className="label flex items-center gap-2">
        <span className={`num text-[13px] leading-none ${live ? 'text-query' : 'text-ink-3'}`}>?</span>
        <span className={live ? '!text-query' : ''}>{live ? 'Asking now' : 'Last question'} · {TYPE_LABEL[q.type] ?? q.type} · {q.phase}</span>
      </div>
      <div className="testimony mt-2 text-[24px] leading-[1.3]">{q.text}</div>
      {q.probe_delta && q.type !== 'teachback' && (
        <div className="mt-2 text-[12.5px] text-candidate"><span className="num">◌</span> hypothetical case: {q.probe_delta}</div>
      )}
      {q.type !== 'teachback' && (
        <div className="num mt-2.5 text-[10.5px] text-ink-3">
          worth asking: {q.evoi.toFixed(2)} bits × impact {q.impact.toFixed(2)}
          {q.guardrail_gap > 0 && <> + guardrail {q.guardrail_gap.toFixed(1)}</>} − interruption {q.cost.toFixed(2)} = <span className="text-ink-1">{q.value.toFixed(2)}</span>
        </div>
      )}
    </div>
  )
}
