import type { Snapshot } from '../lib/types'
import { Bar, Mark } from './ui'

/** Per-rule mastery for the new hire: the estimate as a number, its track as a hairline. */
export default function Mastery({ snap }: { snap: Snapshot }) {
  const trusted = [...snap.map.rules, ...snap.map.guardrails].filter((n) => n.origin !== 'doc' && ['stated', 'confirmed'].includes(n.belief.status))
  return (
    <div className="space-y-3">
      {trusted.map((n) => {
        const m = snap.mastery[n.id]
        const color = !m ? 'bg-ink-3' : m.status === 'mastered' ? 'bg-confirmed' : m.status === 'shaky' ? 'bg-query' : 'bg-binding'
        return (
          <div key={n.id}>
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="truncate"><Mark state={n.type ? 'binding' : 'confirmed'} className="mr-1" />{n.title}</span>
              <span className="num shrink-0 text-[10.5px] text-ink-2">{m ? `${m.p.toFixed(2)} · ${m.status}` : 'not seen yet'}</span>
            </div>
            <Bar value={m?.p ?? 0} color={color} className="mt-1.5" />
          </div>
        )
      })}
      {trusted.length === 0 && <div className="text-[12px] text-ink-3">No trusted rules yet. Capture an expert first.</div>}
    </div>
  )
}
