import { AnimatePresence, motion } from 'framer-motion'
import { Play, Shield } from 'lucide-react'
import type { MapNode, Snapshot } from '../lib/types'
import { mmss } from '../lib/api'
import { BeliefBadge } from './ui'

export function nodeTitle(n: MapNode, params: Record<string, number>) {
  let t = n.title
  for (const [k, v] of Object.entries(params)) t = t.replaceAll(`params.${k}`, v.toLocaleString('de-DE', { maximumFractionDigits: 0 }))
  return t
}

export default function WorkMapView({ snap, onMoment, compact = false, highlight }: {
  snap: Snapshot; onMoment?: (ts: number | null, node?: MapNode) => void; compact?: boolean; highlight?: Set<string>
}) {
  const wm = snap.map
  const nodes = new Map([...wm.rules, ...wm.guardrails].map((n) => [n.id, n]))
  const steps = [...wm.steps].sort((a, b) => a.order - b.order)
  return (
    <ol className="relative space-y-3">
      <div className="absolute bottom-2 left-[11px] top-2 w-px bg-line" />
      {steps.map((s) => {
        const ns = [...s.rule_ids, ...s.guardrail_ids].map((id) => nodes.get(id)).filter(Boolean) as MapNode[]
        const learned = ns.filter((n) => n.origin !== 'doc')
        const doc = ns.filter((n) => n.origin === 'doc')
        return (
          <li key={s.id} className="relative pl-8">
            <div className={`absolute left-0 top-0.5 flex h-[23px] w-[23px] items-center justify-center rounded-full border text-[11px] font-bold ${learned.length ? 'border-learn/60 bg-learn/10 text-learn' : 'border-line-2 bg-panel text-muted'}`}>{s.order}</div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13.5px] font-semibold">{s.name}</div>
              {s.screen_moment?.ts != null && onMoment && (
                <button onClick={() => onMoment(s.screen_moment!.ts)} className="num flex items-center gap-1 text-[10.5px] text-predict hover:underline"><Play size={10} />{mmss(s.screen_moment.ts)}</button>
              )}
            </div>
            <div className="mt-1.5 space-y-1.5">
              <AnimatePresence initial={false}>
                {learned.map((n) => (
                  <motion.div key={n.id} layout initial={{ opacity: 0, scale: 0.96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                    className={`rounded-lg border p-2.5 ${highlight?.has(n.id) ? 'border-learn shadow-[0_0_0_3px_rgba(61,220,151,.15)]' : 'border-line bg-panel-2'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-1.5 text-[12.5px] font-medium leading-snug">
                        {n.type && <Shield size={13} className="mt-0.5 shrink-0 text-ask" />}
                        <span>{nodeTitle(n, wm.params)}</span>
                      </div>
                      <BeliefBadge status={n.belief.status} p={compact ? undefined : n.belief.p} />
                    </div>
                    {!compact && n.quote && (
                      <button onClick={() => onMoment?.(n.screen_moment?.ts ?? n.quote?.ts ?? null, n)} className="mt-1.5 block w-full text-left">
                        <span className="font-serif text-[14px] italic leading-snug text-muted hover:text-text">“{n.quote.translation ?? n.quote.text}”</span>
                        <span className="num ml-1.5 text-[10px] text-faint">— {n.quote.speaker}, {mmss(n.quote.ts)}</span>
                      </button>
                    )}
                    {!compact && (
                      <div className="num mt-1.5 truncate text-[10px] text-faint" title={n.when}>
                        if {n.when} → {n.then ? Object.entries(n.then).map(([k, v]) => `${k}=${v}`).join(', ') : n.action}
                        {n.priority ? ` · priority ${n.priority}` : ''}
                        {' · '}{n.evidence.filter((e) => e.agrees).length}✓ {n.evidence.filter((e) => !e.agrees).length}✗
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {learned.length === 0 && doc.length > 0 && (
                <div className={`text-[11.5px] ${doc.some((d) => d.belief.status === 'contested') ? 'text-gap line-through decoration-gap/60' : 'text-doc'}`}>
                  {doc.map((d) => d.title.replace('Doc: ', '')).join(' · ')} <span className="no-underline">(written process)</span>
                </div>
              )}
              {learned.length > 0 && doc.some((d) => d.belief.status === 'contested') && (
                <div className="text-[11px] text-gap/80 line-through">{doc.filter((d) => d.belief.status === 'contested').map((d) => d.title.replace('Doc: ', '')).join(' · ')}</div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
