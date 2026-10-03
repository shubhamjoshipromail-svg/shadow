import { motion } from 'framer-motion'
import { Check, Lock, X } from 'lucide-react'
import type { Snapshot } from '../lib/types'
import { SourceChip, fieldLabel, valueLabel } from './ui'

export default function PredictionCard({ snap, caseId }: { snap: Snapshot; caseId: string | null }) {
  const pred = caseId ? snap.predictions[caseId] : null
  const kase = snap.cases.find((c) => c.id === caseId)
  const ep = [...snap.episodes].reverse().find((e) => e.case_id === caseId && !e.synthetic)
  if (!caseId || !pred) {
    return (
      <div className="panel flex h-[208px] items-center justify-center p-6 text-center text-sm text-muted">
        <div>
          <div className="font-serif text-2xl italic text-text/80">Waiting for the expert to open a case…</div>
          <div className="mt-2 text-xs">Shadow commits a prediction the moment a case opens, before anything is decided.</div>
        </div>
      </div>
    )
  }
  const fields = [...snap.pack.fields.map((f) => f.name), 'action']
  return (
    <motion.div key={caseId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="label">Shadow’s prediction · committed before the expert acts</div>
          <div className="mt-1 text-[15px] font-semibold">
            Invoice <span className="num">{kase?.invoice_no}</span>
            <span className="text-muted"> · {kase?.supplier.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-predict"><Lock size={12} /> locked</div>
      </div>
      <div className="grid grid-cols-4 divide-x divide-line">
        {fields.map((f) => {
          const fp = f === 'action' ? pred.action : pred.fields[f]
          const actual = ep?.expert[f]
          const hit = ep ? actual === fp?.value : null
          return (
            <div key={f} className="px-4 py-3">
              <div className="label !text-[9.5px]">{fieldLabel(snap, f)}</div>
              <div className="mt-1.5 text-[14px] font-semibold text-predict">{valueLabel(snap, f, fp?.value)}</div>
              <div className="mt-1.5 flex items-center gap-1.5">
                {fp && <SourceChip source={fp.source} snap={snap} />}
                {fp && <span className="num text-[10px] text-faint">{Math.round(fp.p * 100)}%</span>}
              </div>
              {ep && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className={`mt-2.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold ${hit ? 'bg-learn/10 text-learn' : 'bg-gap/10 text-gap'}`}>
                  {hit ? <Check size={13} /> : <X size={13} />}
                  {hit ? 'as predicted' : valueLabel(snap, f, actual)}
                </motion.div>
              )}
            </div>
          )
        })}
      </div>
      {pred.rationale && <div className="border-t border-line px-4 py-2.5 text-[12px] text-muted">{pred.rationale}</div>}
    </motion.div>
  )
}
