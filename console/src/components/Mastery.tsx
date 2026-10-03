import type { Snapshot } from '../lib/types'
import { Bar } from './ui'

export default function Mastery({ snap }: { snap: Snapshot }) {
  const trusted = [...snap.map.rules, ...snap.map.guardrails].filter((n) => n.origin !== 'doc' && ['stated', 'confirmed'].includes(n.belief.status))
  return (
    <div className="space-y-2.5">
      {trusted.map((n) => {
        const m = snap.mastery[n.id]
        const color = !m ? 'bg-faint' : m.status === 'mastered' ? 'bg-learn' : m.status === 'shaky' ? 'bg-ask' : 'bg-gap'
        return (
          <div key={n.id}>
            <div className="flex justify-between gap-2 text-[12px]">
              <span className="truncate">{n.title}</span>
              <span className="shrink-0 text-[11px] text-muted">{m ? m.status : 'not seen yet'}</span>
            </div>
            <Bar value={m?.p ?? 0} color={color} className="mt-1" />
          </div>
        )
      })}
      {trusted.length === 0 && <div className="text-xs text-faint">No confirmed rules yet — capture an expert first.</div>}
    </div>
  )
}
