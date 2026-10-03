import { ArrowRight, CircleAlert, MessageSquareQuote, MousePointerClick } from 'lucide-react'
import type { Receipt, Snapshot } from '../lib/types'
import { fieldLabel, valueLabel } from './ui'

const VERDICT: Record<Receipt['summary']['verdict'], [string, string]> = {
  held: ['held on later cases', 'text-learn border-learn/40 bg-learn/10'],
  contradicted: ['contradicted later', 'text-gap border-gap/40 bg-gap/10'],
  untested: ['not yet tested', 'text-ask border-ask/40 bg-ask/10'],
  no_change: ['no map change', 'text-muted border-line-2'],
  compile_failed: ['compile failed', 'text-gap border-gap/40 bg-gap/10'],
  kept_open: ['not an answer — kept open', 'text-muted border-line-2'],
}

const fmt = (v: number | null) => (v == null ? '—' : v.toLocaleString('de-DE', { maximumFractionDigits: 1 }))

/** Proof of learning: what Shadow predicted before, what it was told, what changed, and whether it held up. */
export default function Receipts({ snap, limit }: { snap: Snapshot; limit?: number }) {
  const list = [...snap.receipts].filter((r) => !r.evaluation).reverse().slice(0, limit)
  if (!list.length) return <div className="text-[12px] text-faint">Nothing learned yet. Every answer gets a receipt here: before, after, the rule diff, and later independent tests.</div>
  return <div className="space-y-2.5">{list.map((r) => <ReceiptCard key={r.id} r={r} snap={snap} />)}</div>
}

export function ReceiptCard({ r, snap }: { r: Receipt; snap: Snapshot }) {
  const [label, cls] = VERDICT[r.summary.verdict]
  const f = r.field ?? 'action'
  const failed = r.status === 'compile_failed' || r.status === 'kept_open'
  return (
    <div className={`rounded-xl border p-3 text-[12.5px] ${failed ? 'border-gap/30 bg-gap/5' : 'border-line bg-panel-2'}`}>
      <div className="flex items-center gap-2">
        <span className="num text-[10.5px] text-faint">{r.id}</span>
        {r.trigger === 'answer' ? <MessageSquareQuote size={13} className="text-ask" /> : <MousePointerClick size={13} className="text-predict" />}
        <span className="text-[11px] text-muted">{r.trigger === 'answer' ? `answer to a ${r.question?.type?.replace('_', ' ')}` : 'correction from a decision'}{r.case_id ? ` · ${r.case_id}` : ''}</span>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
          {label}{r.summary.tests > 0 && ` · ${r.summary.agree}/${r.summary.tests}`}
        </span>
      </div>

      {r.teaching.quote && <div className="mt-2 border-l-2 border-ask/50 pl-2 italic text-text">“{r.teaching.translation || r.teaching.quote}”</div>}
      {!r.teaching.quote && r.teaching.transcript && <div className="mt-2 border-l-2 border-line-2 pl-2 italic text-muted">heard: “{r.teaching.transcript}”</div>}
      {r.teaching.behavior && <div className="mt-2 text-muted">{r.teaching.behavior} on {r.teaching.case}</div>}
      {r.error && <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-gap"><CircleAlert size={12} />{r.error}</div>}

      {r.before && r.after && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <span className="text-faint">{fieldLabel(snap, f)}:</span>
          <span className="rounded bg-ink px-1.5 py-0.5 text-doc">{valueLabel(snap, f, r.before.value)}</span>
          <ArrowRight size={12} className="text-faint" />
          <span className={`rounded bg-ink px-1.5 py-0.5 ${r.after.value === r.expert_value ? 'text-learn' : 'text-gap'}`}>{valueLabel(snap, f, r.after.value)}</span>
          {r.expert_value != null && <span className="text-faint">· expert: {valueLabel(snap, f, r.expert_value)} {r.trigger === 'answer' ? '(taught case, not a test)' : '(the counterexample itself, not a test)'}</span>}
        </div>
      )}

      {r.diff && (r.diff.added.length > 0 || r.diff.params.length > 0 || r.diff.changed.some((c) => Object.keys(c.changes).some((k) => k !== 'status'))) && (
        <div className="num mt-2 space-y-0.5 rounded-lg bg-ink px-2 py-1.5 text-[10.5px]">
          <div className="text-faint">map v{r.diff.version.before} → v{r.diff.version.after}</div>
          {r.diff.added.map((n) => <div key={n.id} className="text-learn">+ {n.id} if {n.when} → {Object.entries(n.then).map(([k, v]) => `${k}=${v}`).join(', ')}</div>)}
          {r.diff.changed.filter((c) => Object.keys(c.changes).some((k) => k !== 'status')).map((c) => (
            <div key={c.id} className="text-ask">~ {c.id} {Object.entries(c.changes).filter(([k]) => k !== 'status').map(([k, v]) => `${k}: ${JSON.stringify(v.before)} → ${JSON.stringify(v.after)}`).join('; ')}</div>
          ))}
          {r.diff.params.map((p) => (
            <div key={p.param} className="text-hyp">~ {p.param}: {fmt(p.before)} → {fmt(p.after)}{p.quantity_before !== p.quantity_after && p.quantity_before ? ` (on ${p.quantity_after}, was ${p.quantity_before})` : p.quantity_after ? ` on ${p.quantity_after}` : ''}</div>
          ))}
        </div>
      )}

      {r.independent.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.independent.slice(-12).map((c) => (
            <span key={`${c.episode}.${c.field}`} title={`${c.case_id}: predicted ${c.predicted} (by ${c.decided_by}), expert ${c.expert}${c.proof ? ` · sealed test ${c.proof}` : ''}`}
              className={`num rounded px-1.5 py-px text-[10px] ${c.agrees ? 'bg-learn/15 text-learn' : 'bg-gap/15 text-gap'}`}>
              {c.agrees ? '✓' : '✗'} {c.case_id}
            </span>
          ))}
        </div>
      )}

      <div className="num mt-2 text-[10px] text-faint">
        {r.provenance.mode} · {r.provenance.compiler} · map from {r.provenance.map_source.kind}{r.provenance.map_source.version != null ? ` v${r.provenance.map_source.version}` : ''}
      </div>
    </div>
  )
}
