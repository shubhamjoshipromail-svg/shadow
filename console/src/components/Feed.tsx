import type { ShadowEvent, Snapshot } from '../lib/types'
import { mmss } from '../lib/api'
import { Mark, type Prov, fieldLabel, valueLabel } from './ui'

/** The evidence ledger: one dated line per thing that happened, newest first. */
export default function Feed({ snap, feed }: { snap: Snapshot; feed: ShadowEvent[] }) {
  const items = feed.filter((e) => ['silence', 'episode', 'learned', 'ask', 'inquiry', 'record', 'intervene', 'teachback', 'mode'].includes(e.type)).slice(0, 40)
  return (
    <div className="divide-y divide-rule">
      {items.length === 0 && <div className="py-6 text-[12px] text-ink-3">Every decision, silence and lesson is entered here as it happens.</div>}
      {items.map((e, i) => {
        const row = line(snap, e)
        if (!row) return null
        return (
          <div key={`${e.type}-${e.t}-${i}`} className="ink-in grid grid-cols-[42px_16px_1fr] gap-1 py-1.5 text-[12.5px] leading-snug">
            <span className="num pt-px text-[10.5px] text-ink-3">{mmss(e.t)}</span>
            <Mark state={row[0]} className="pt-[3px]" />
            <span className="text-ink-2">{row[1]}</span>
          </div>
        )
      })}
    </div>
  )
}

function line(snap: Snapshot, e: ShadowEvent): [Prov, React.ReactNode] | null {
  switch (e.type) {
    case 'silence':
      return ['confirmed', <>Stayed quiet on {fieldLabel(snap, e.field).toLowerCase()} = {valueLabel(snap, e.field, e.value)}: {e.why_silent}</>]
    case 'episode': {
      const gaps = e.episode.gaps as { field: string; type: string }[]
      return ['observed', <>Decision on <span className="num text-ink-1">{e.episode.case_id}</span>{gaps.length
        ? <>: {gaps.map((g) => <span key={g.field} className={g.type === 'structural' ? 'text-binding' : ''}>{fieldLabel(snap, g.field).toLowerCase()} ({g.type === 'structural' ? 'unexplained' : 'threshold moved'}) </span>)}</>
        : <span className="text-confirmed"> · every field as predicted</span>}</>]
    }
    case 'inquiry':
      if (e.inquiry.status === 'silent') return null
      return ['query', <>Saved for {e.inquiry.phase === 'live' ? 'the next pause' : 'the debrief'}: <span className="text-ink-1">{e.inquiry.text}</span>{e.note && <i> ({e.note})</i>}</>]
    case 'ask':
      return ['query', <><span className="text-query">Asked</span> at a natural pause: <span className="text-ink-1">{e.inquiry.text}</span></>]
    case 'learned': {
      const added = (e.changes as any[]).filter((c) => c.kind === 'node_added')
      const retro = (e.retro as any[]).filter((r) => r.now_explains)
      const probe = (e.changes as any[]).find((c) => c.kind === 'probe')
      return ['observed', <>
        {added.length > 0 && <><span className="text-ink-1">Noted</span> {added.map((a) => a.title).join('; ')}. </>}
        {probe && <span className="text-candidate">What-if “{probe.delta}”: she said {probe.answer}{probe.map_predicted && probe.map_predicted !== probe.answer ? ` (map said ${probe.map_predicted})` : ' (map agreed)'}. </span>}
        {retro.length > 0 && <>Also explains {retro.map((r) => r.case_id).join(', ')}. </>}
        <span className="num text-ink-3">+{(e.info_gain_bits as number).toFixed(2)} bits</span>
      </>]
    }
    case 'record':
      return ['written', e.off_record ? 'Off the record. Nothing is captured.' : 'Back on the record.']
    case 'intervene':
      return ['binding', <><span className="text-binding">Stopped a save</span>: {e.intervention.violation.title}</>]
    case 'teachback':
      return e.confirmed ? ['confirmed', <span className="text-confirmed">She confirmed the teach-back.</span>] : ['contested', <>Teach-back corrected: {e.correction}</>]
    case 'mode':
      return ['written', <>Now in <span className="text-ink-1">{e.mode}</span></>]
  }
  return null
}
