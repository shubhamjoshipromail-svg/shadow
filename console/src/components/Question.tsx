import { motion } from 'framer-motion'
import { MessageCircleQuestion } from 'lucide-react'
import type { Inquiry } from '../lib/types'

const TYPE_LABEL: Record<string, string> = {
  cue_probe: 'Open probe', confirm: 'Confirm', comparison: 'Comparison', counterfactual: 'Counterfactual',
  boundary: 'Boundary', guardrail: 'Guardrail', exam: 'Self-exam', teachback: 'Teach-back',
}

export default function Question({ q, live }: { q: Inquiry | null; live: boolean }) {
  if (!q) return null
  return (
    <motion.div key={q.id} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
      className={`relative overflow-hidden rounded-2xl border p-5 ${live ? 'border-ask/60 bg-ask/[0.07]' : 'border-line bg-panel'}`}>
      {live && <div className="breathe absolute inset-x-0 top-0 h-0.5 bg-ask" />}
      <div className="flex items-center gap-2">
        <MessageCircleQuestion size={15} className="text-ask" />
        <span className="label !text-ask">{live ? 'Shadow is asking' : 'Last question'} · {TYPE_LABEL[q.type] ?? q.type} · {q.phase}</span>
      </div>
      <div className="mt-3 font-serif text-[26px] leading-[1.25] text-text">“{q.text}”</div>
      {q.type !== 'teachback' && (
        <div className="num mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          <span>EVOI <b className="text-text">{q.evoi.toFixed(2)}</b> bits</span>
          <span>× impact <b className="text-text">{q.impact.toFixed(2)}</b></span>
          {q.guardrail_gap > 0 && <span>+ guardrail gap <b className="text-text">{q.guardrail_gap.toFixed(1)}</b></span>}
          <span>− cost <b className="text-text">{q.cost.toFixed(2)}</b></span>
          <span>= value <b className="text-ask">{q.value.toFixed(2)}</b></span>
        </div>
      )}
      {q.reason && q.type === 'teachback' ? null : q.probe_delta && <div className="mt-2 text-[12px] text-hyp">Synthesized unseen case: {q.probe_delta}</div>}
    </motion.div>
  )
}
