import type { HypSet, Snapshot } from '../lib/types'
import { Bar, Section, fieldLabel, valueLabel } from './ui'

/** Competing explanations for one surprise. Conjectures: sans italic, inferred ink, each with its weight. */
export default function Hypotheses({ snap, set }: { snap: Snapshot; set: HypSet | null }) {
  if (!set) return null
  const items = [...set.items].sort((a, b) => b.posterior - a.posterior)
  const rows = [...items.map((h) => ({ id: h.id, title: h.title, p: h.posterior, h })), { id: 'h0', title: 'something not on screen', p: set.p_unknown, h: null }]
  return (
    <Section title="Why did she do that?" right={<span className="num text-[10.5px] text-ink-3">{set.entropy.toFixed(2)} bits unsure</span>}>
      <div className="text-[13px] text-ink-2">
        She chose <b className="font-medium text-ink-1">{valueLabel(snap, set.field, set.expert_value)}</b> for {fieldLabel(snap, set.field).toLowerCase()};
        the written process says <span className="text-written">{valueLabel(snap, set.field, set.predicted_value)}</span>.
      </div>
      <div className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <div key={r.id}>
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className={`italic ${r.h ? 'text-inferred' : 'text-ink-3'}`}><span className="num not-italic">◌ </span>{r.title}</span>
              <span className="num flex shrink-0 items-baseline gap-3 text-[10.5px] text-ink-3">
                {r.h && r.h.attention_boost > 1 && <span title="She looked at these fields before deciding">looked at</span>}
                {r.h && (r.h.consistent > 0 || r.h.inconsistent > 0) && <span>{r.h.consistent}✓ {r.h.inconsistent}✗</span>}
                <span className="w-9 text-right text-ink-1">{r.p.toFixed(2)}</span>
              </span>
            </div>
            <Bar value={r.p} color={r.h ? 'bg-inferred' : 'bg-ink-3'} className="mt-1" />
          </div>
        ))}
      </div>
    </Section>
  )
}
