import { AnimatePresence, motion } from 'framer-motion'
import { Eye } from 'lucide-react'
import type { HypSet, Snapshot } from '../lib/types'
import { fieldLabel, valueLabel } from './ui'

export default function Hypotheses({ snap, set }: { snap: Snapshot; set: HypSet | null }) {
  if (!set) return null
  const items = [...set.items].sort((a, b) => b.posterior - a.posterior)
  const rows = [...items.map((h) => ({ id: h.id, title: h.title, p: h.posterior, h })), { id: 'h0', title: 'Something not on screen', p: set.p_unknown, h: null }]
  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between">
        <div className="label text-hyp">Knowledge gap · competing explanations</div>
        <div className="num text-[11px] text-muted">uncertainty {set.entropy.toFixed(2)} bits</div>
      </div>
      <div className="mt-1 text-[13px] text-muted">
        Expert chose <b className="text-text">{valueLabel(snap, set.field, set.expert_value)}</b> for {fieldLabel(snap, set.field).toLowerCase()}
        {' '}— written process said <span className="text-doc">{valueLabel(snap, set.field, set.predicted_value)}</span>
      </div>
      <div className="mt-3 space-y-2.5">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div key={r.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
              <div className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className={r.h ? 'text-text' : 'italic text-muted'}>{r.title}</span>
                <span className="flex items-center gap-2">
                  {r.h && r.h.attention_boost > 1 && (
                    <span title="The expert looked at these fields before deciding" className="flex items-center gap-0.5 text-[10px] text-predict"><Eye size={11} />looked</span>
                  )}
                  {r.h && (r.h.consistent > 0 || r.h.inconsistent > 0) && (
                    <span className="num text-[10px] text-faint">{r.h.consistent}✓ {r.h.inconsistent}✗ history</span>
                  )}
                  <span className="num w-10 text-right text-[11px] text-muted">{Math.round(r.p * 100)}%</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                <motion.div className={`h-full rounded-full ${r.h ? 'bg-hyp' : 'bg-faint'}`} animate={{ width: `${Math.max(2, r.p * 100)}%` }} transition={{ type: 'spring', stiffness: 80, damping: 18 }} />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
