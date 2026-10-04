import type { Snapshot } from '../lib/types'
import { Mark, SourceChip, fieldLabel, valueLabel } from './ui'

/** Shadow's committed guess, and the expert's act written over it. The guess is struck, never erased. */
export default function PredictionCard({ snap, caseId }: { snap: Snapshot; caseId: string | null }) {
  const pred = caseId ? snap.predictions[caseId] : null
  const kase = snap.cases.find((c) => c.id === caseId)
  const ep = [...snap.episodes].reverse().find((e) => e.case_id === caseId && !e.synthetic)
  if (!caseId || !pred) {
    return (
      <div className="panel px-6 py-10">
        <div className="testimony text-[22px] text-ink-2">Waiting for the expert to open a case.</div>
        <div className="mt-2 max-w-md text-[12.5px] text-ink-3">Shadow writes down its guess the moment a case opens, before anything is decided, so every surprise is on the record.</div>
      </div>
    )
  }
  const fields = [...snap.pack.fields.map((f) => f.name), 'action']
  return (
    <div key={caseId} className="panel ink-in">
      <div className="flex items-baseline justify-between border-b border-rule px-4 py-3">
        <div>
          <div className="label">Committed before the expert acts</div>
          <div className="mt-1 text-[15px] font-medium">
            {kase?.invoice_no ? <>Invoice <span className="num">{kase.invoice_no}</span></> : <span className="num">{caseId}</span>}
            <span className="text-ink-2"> · {kase?.supplier.name}</span>
          </div>
        </div>
        <div className="num text-[10.5px] text-inferred">◌ written down before she acts</div>
      </div>
      <div className="grid grid-cols-4 divide-x divide-rule">
        {fields.map((f) => {
          const fp = f === 'action' ? pred.action : pred.fields[f]
          const actual = ep?.expert[f]
          const decided = ep && actual != null
          const hit = decided ? actual === fp?.value : null
          return (
            <div key={f} className="px-4 py-3">
              <div className="label">{fieldLabel(snap, f)}</div>
              <div className={`mt-2 text-[13.5px] ${hit === false ? 'text-ink-3 line-through decoration-ink-3' : 'text-inferred'}`}>
                <Mark state="inferred" />{valueLabel(snap, f, fp?.value)}
              </div>
              <div className="mt-1 flex items-center gap-2">
                {fp && <SourceChip source={fp.source} snap={snap} />}
                {fp && <span className="num text-[10px] text-ink-3">p {fp.p.toFixed(2)}</span>}
              </div>
              {decided && (
                <div className={`ink-in mt-2.5 border-t pt-2 text-[13.5px] font-medium ${hit ? 'border-rule text-confirmed' : 'border-ink-1 text-ink-1'}`}>
                  {hit ? <><Mark state="confirmed" />as predicted</> : <><Mark state="observed" />{valueLabel(snap, f, actual)}</>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {pred.rationale && <div className="border-t border-rule px-4 py-2.5 text-[12px] italic text-ink-2">{pred.rationale}</div>}
    </div>
  )
}
