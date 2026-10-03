import type { Understood } from '../lib/types'
import { Mark } from './ui'

/** Apprentice Test 3, as a signed-off list rather than a progress widget. */
export default function Checklist({ u }: { u: Understood }) {
  const rows: [string, boolean, string][] = [
    ['Every decision step covered', u.steps_covered.passed, `${u.steps_covered.covered}/${u.steps_covered.of}`],
    ['Guardrails captured', u.guardrails.passed, `${u.guardrails.count}`],
    ['No question left worth asking', u.agenda_exhausted.passed, u.agenda_exhausted.passed ? 'none' : `best ${u.agenda_exhausted.best_remaining_value.toFixed(2)}`],
    ['Passes its own exam on unseen cases', u.exam.passed, u.exam.score],
    ['Expert confirmed the teach-back', u.teachback_confirmed.passed, ''],
  ]
  return (
    <div>
      <div className="divide-y divide-rule">
        {rows.map(([label, ok, detail]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1.5 text-[12.5px]">
            <span className={ok ? 'text-ink-1' : 'text-ink-2'}><Mark state={ok ? 'confirmed' : 'inferred'} className="mr-1" />{label}</span>
            <span className="num text-[10.5px] text-ink-3">{detail}</span>
          </div>
        ))}
      </div>
      <div className={`mt-3 border-t pt-2.5 text-[13px] ${u.done ? 'border-confirmed text-confirmed' : 'border-rule text-ink-2'}`}>
        {u.done ? <span className="testimony text-[16px]">Shadow has understood this process.</span> : 'Not done yet. Still learning.'}
      </div>
    </div>
  )
}
