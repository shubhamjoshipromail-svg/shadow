import { CheckCircle2, Circle } from 'lucide-react'
import type { Understood } from '../lib/types'

export default function Checklist({ u }: { u: Understood }) {
  const rows: [string, boolean, string][] = [
    ['Every decision step covered', u.steps_covered.passed, `${u.steps_covered.covered}/${u.steps_covered.of}`],
    ['Guardrails captured', u.guardrails.passed, `${u.guardrails.count}`],
    ['Open questions worth asking', u.agenda_exhausted.passed, u.agenda_exhausted.passed ? 'none left' : `best ${u.agenda_exhausted.best_remaining_value.toFixed(2)}`],
    ['Passes its own exam on unseen cases', u.exam.passed, u.exam.score],
    ['Expert confirmed the teach-back', u.teachback_confirmed.passed, ''],
  ]
  return (
    <div className="space-y-2">
      {rows.map(([label, ok, detail]) => (
        <div key={label} className="flex items-center justify-between gap-3 text-[12.5px]">
          <span className="flex items-center gap-2">
            {ok ? <CheckCircle2 size={15} className="text-learn" /> : <Circle size={15} className="text-faint" />}
            <span className={ok ? 'text-text' : 'text-muted'}>{label}</span>
          </span>
          <span className="num text-[11px] text-faint">{detail}</span>
        </div>
      ))}
      <div className={`mt-2 rounded-lg px-3 py-2 text-center text-[12px] font-semibold ${u.done ? 'bg-learn/15 text-learn' : 'bg-panel-2 text-muted'}`}>
        {u.done ? 'Shadow has understood this process.' : 'Not done yet — still learning.'}
      </div>
    </div>
  )
}
