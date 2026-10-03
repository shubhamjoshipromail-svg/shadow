import type { Receipt, Snapshot } from '../lib/types'
import { Mark, type Prov, fieldLabel, valueLabel } from './ui'

const VERDICT: Record<Receipt['summary']['verdict'], [Prov, string]> = {
  held: ['confirmed', 'held on later cases'],
  contradicted: ['contested', 'contradicted later'],
  untested: ['inferred', 'not yet tested'],
  no_change: ['written', 'no change to the map'],
  compile_failed: ['contested', 'could not compile'],
  kept_open: ['query', 'not an answer, kept open'],
}

const fmt = (v: number | null) => (v == null ? '—' : v.toLocaleString('de-DE', { maximumFractionDigits: 1 }))

/** Proof of learning: what Shadow predicted before, what it was told, what changed, and whether it held up. */
export default function Receipts({ snap, limit }: { snap: Snapshot; limit?: number }) {
  const list = [...snap.receipts].filter((r) => !r.evaluation).reverse().slice(0, limit)
  if (!list.length) return <div className="text-[12px] text-ink-3">Nothing learned yet. Every answer is entered here: the guess before, her words, the change to the map, and every later case that tested it.</div>
  return <div className="divide-y divide-rule">{list.map((r) => <ReceiptCard key={r.id} r={r} snap={snap} />)}</div>
}

/** A dated entry in the apparatus. The old value is struck; the new one is set in ink. */
export function ReceiptCard({ r, snap }: { r: Receipt; snap: Snapshot }) {
  const [prov, word] = VERDICT[r.summary.verdict]
  const f = r.field ?? 'action'
  const diff = r.diff
  const edits = diff ? diff.changed.filter((c) => Object.keys(c.changes).some((k) => k !== 'status')) : []
  return (
    <article className="ink-in py-3 first:pt-0 last:pb-0">
      <header className="num flex items-baseline gap-2 text-[10.5px] text-ink-3">
        <span className="text-ink-1">{r.id}</span>
        <span>{r.trigger === 'answer' ? `answer to a ${r.question?.type?.replace('_', ' ')}` : 'correction from a decision'}{r.case_id ? ` · ${r.case_id}` : ''}</span>
        <span className="ml-auto whitespace-nowrap"><Mark state={prov} />{word}{r.summary.tests > 0 && ` · ${r.summary.agree}/${r.summary.tests}`}</span>
      </header>

      {r.teaching.quote && <blockquote className="testimony m-0 mt-2 text-[16px] leading-[1.4]">“{r.teaching.translation || r.teaching.quote}”</blockquote>}
      {!r.teaching.quote && r.teaching.transcript && <div className="mt-2 text-[13px] italic text-ink-2">heard: “{r.teaching.transcript}”</div>}
      {r.teaching.behavior && <div className="mt-2 text-[13px] text-ink-1"><Mark state="observed" />{r.teaching.behavior} <span className="text-ink-2">on {r.teaching.case}</span></div>}
      {r.error && <div className="mt-1.5 text-[12px] text-binding"><Mark state="contested" />{r.error}</div>}

      {r.before && r.after && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
          <span className="text-ink-3">{fieldLabel(snap, f)}</span>
          <span className="text-ink-3 line-through">{valueLabel(snap, f, r.before.value)}</span>
          <span className="text-ink-3">→</span>
          <span className={r.after.value === r.expert_value ? 'font-medium text-ink-1' : 'text-binding'}>{valueLabel(snap, f, r.after.value)}</span>
          {r.expert_value != null && <span className="text-[11px] text-ink-3">({r.trigger === 'answer' ? 'the taught case, not a test' : 'the counterexample itself, not a test'})</span>}
        </div>
      )}

      {diff && (diff.added.length > 0 || diff.params.length > 0 || edits.length > 0) && (
        <div className="num mt-2 space-y-0.5 border-l border-rule-strong pl-2.5 text-[10.5px] leading-[1.6]">
          <div className="text-ink-3">map v{diff.version.before} → v{diff.version.after}</div>
          {diff.added.map((n) => <div key={n.id} className="text-confirmed">+ {n.id}  if {n.when} → {Object.entries(n.then).map(([k, v]) => `${k} = ${v}`).join(', ')}</div>)}
          {edits.map((c) => <div key={c.id} className="text-ink-1">~ {c.id}  {Object.entries(c.changes).filter(([k]) => k !== 'status').map(([k, v]) => `${k}: ${JSON.stringify(v.before)} → ${JSON.stringify(v.after)}`).join('; ')}</div>)}
          {diff.params.map((p) => (
            <div key={p.param} className="text-ink-1">~ {p.param}  {fmt(p.before)} → {fmt(p.after)}{p.quantity_before && p.quantity_before !== p.quantity_after ? `  (now on ${p.quantity_after}, was ${p.quantity_before})` : p.quantity_after ? `  on ${p.quantity_after}` : ''}</div>
          ))}
        </div>
      )}

      {r.independent.length > 0 && (
        <div className="num mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px]">
          <span className="text-ink-3">tested on</span>
          {r.independent.slice(-12).map((c) => (
            <span key={`${c.episode}.${c.field}`} className={c.agrees ? 'text-confirmed' : 'text-binding'}
              title={`${c.case_id}: predicted ${c.predicted} (by ${c.decided_by}), expert ${c.expert}${c.proof ? ` · sealed test ${c.proof}` : ''}`}>
              {c.agrees ? '✓' : '✗'} {c.case_id}
            </span>
          ))}
        </div>
      )}

      <footer className="num mt-2 text-[10px] text-ink-3">
        {r.provenance.mode} · {r.provenance.compiler} · map from {r.provenance.map_source.kind}{r.provenance.map_source.version != null ? ` v${r.provenance.map_source.version}` : ''}
      </footer>
    </article>
  )
}
