import type { MapNode, Snapshot } from '../lib/types'
import { mmss } from '../lib/api'
import { BeliefBadge, Testimony } from './ui'

export function nodeTitle(n: MapNode, params: Record<string, number>) {
  let t = n.title
  for (const [k, v] of Object.entries(params)) t = t.replaceAll(`params.${k}`, v.toLocaleString('de-DE', { maximumFractionDigits: 0 }))
  return t
}

export function whenText(n: MapNode) {
  return `if ${n.when} → ${n.then ? Object.entries(n.then).map(([k, v]) => `${k} = ${v}`).join(', ') : n.action}`
}

/** A guardrail: the only boxed thing in the system. Brick left rule, small caps, the expert's reason. */
export function StopPlate({ n, params, onPlay, compact }: { n: MapNode; params: Record<string, number>; onPlay?: () => void; compact?: boolean }) {
  return (
    <div className="border border-l-[3px] border-rule border-l-binding bg-sheet px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[12px] font-medium uppercase tracking-[.06em] text-binding">■ {n.action === 'escalate' ? 'stop and ask' : n.action?.replace('_', ' ')}</div>
        <BeliefBadge status={n.belief.status} guardrail />
      </div>
      <div className="mt-1 text-[13px] text-ink-1">{nodeTitle(n, params)}{n.ask ? <span className="text-ink-2"> · ask {n.ask}</span> : null}</div>
      {!compact && n.quote && <div className="mt-2"><Testimony quote={n.quote} size="sm" onPlay={onPlay} /></div>}
    </div>
  )
}

/** A judgment call: a clause. Its state is its type: inferred rules are italic conjecture, earned ones are roman with a rule above. */
export function Clause({ n, params, onPlay, compact, fresh }: { n: MapNode; params: Record<string, number>; onPlay?: () => void; compact?: boolean; fresh?: boolean }) {
  const earned = n.belief.status === 'confirmed'
  const inferred = n.belief.status === 'inferred'
  const contested = n.belief.status === 'contested'
  return (
    <div className={`${fresh ? 'ink-in' : ''} border-t pt-2 ${earned ? 'border-ink-1' : 'border-rule'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className={`text-[13.5px] leading-snug ${inferred ? 'italic text-inferred' : 'text-ink-1'} ${contested ? 'line-through decoration-binding' : ''}`}>
          {nodeTitle(n, params)}
        </div>
        <BeliefBadge status={n.belief.status} />
      </div>
      {!compact && n.quote && <div className="mt-1.5"><Testimony quote={n.quote} size="sm" onPlay={onPlay} /></div>}
      {!compact && (
        <div className="num mt-1.5 truncate text-[10px] text-ink-3" title={n.when}>
          {whenText(n)}{n.priority ? ` · priority ${n.priority}` : ''} · {n.evidence.filter((e) => e.agrees).length}✓ {n.evidence.filter((e) => !e.agrees).length}✗
        </div>
      )}
    </div>
  )
}

export default function WorkMapView({ snap, onMoment, compact = false, highlight }: {
  snap: Snapshot; onMoment?: (ts: number | null, node?: MapNode) => void; compact?: boolean; highlight?: Set<string>
}) {
  const wm = snap.map
  const nodes = new Map([...wm.rules, ...wm.guardrails].map((n) => [n.id, n]))
  const steps = [...wm.steps].sort((a, b) => a.order - b.order)
  return (
    <ol className="m-0 list-none space-y-4 p-0">
      {steps.map((s) => {
        const ns = [...s.rule_ids, ...s.guardrail_ids].map((id) => nodes.get(id)).filter(Boolean) as MapNode[]
        const learned = ns.filter((n) => n.origin !== 'doc')
        const doc = ns.filter((n) => n.origin === 'doc')
        const docContested = doc.filter((d) => d.belief.status === 'contested')
        return (
          <li key={s.id} className="grid grid-cols-[26px_minmax(0,1fr)] gap-x-2">
            <span className="num pt-[2px] text-[11px] text-ink-3">§{s.order}</span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[13.5px] font-medium">{s.name}</div>
                {s.screen_moment?.ts != null && onMoment && (
                  <button onClick={() => onMoment(s.screen_moment!.ts)} className="num text-[10.5px] text-inferred hover:underline">▶ {mmss(s.screen_moment.ts)}</button>
                )}
              </div>
              <div className="mt-2 space-y-2">
                {learned.map((n) => n.type
                  ? <StopPlate key={n.id} n={n} params={wm.params} compact={compact} onPlay={() => onMoment?.(n.screen_moment?.ts ?? n.quote?.ts ?? null, n)} />
                  : <Clause key={n.id} n={n} params={wm.params} compact={compact} fresh={highlight?.has(n.id)} onPlay={() => onMoment?.(n.screen_moment?.ts ?? n.quote?.ts ?? null, n)} />)}
                {doc.length > 0 && (learned.length === 0 || docContested.length > 0) && (
                  <div className={`text-[12px] ${docContested.length ? 'text-ink-3 line-through decoration-binding/70' : 'text-written'}`}>
                    <span className="num no-underline">§ </span>{(docContested.length ? docContested : doc).map((d) => d.title.replace('Doc: ', '')).join(' · ')}
                    <span className="ml-1 text-[10.5px] no-underline">(2019 written process)</span>
                  </div>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
