import { motion } from 'framer-motion'
import { BookOpenCheck, CircleSlash2, GitBranch, Lightbulb, MessageCircleQuestion, ShieldAlert, Sparkles } from 'lucide-react'
import type { ShadowEvent, Snapshot } from '../lib/types'
import { mmss } from '../lib/api'
import { fieldLabel, valueLabel } from './ui'

export default function Feed({ snap, feed }: { snap: Snapshot; feed: ShadowEvent[] }) {
  const items = feed.filter((e) => ['silence', 'episode', 'learned', 'ask', 'inquiry', 'record', 'intervene', 'teachback', 'mode'].includes(e.type)).slice(0, 40)
  return (
    <div className="space-y-1.5">
      {items.length === 0 && <div className="py-6 text-center text-xs text-faint">The learning log will appear here.</div>}
      {items.map((e, i) => (
        <motion.div key={`${e.type}-${e.t}-${i}`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="flex gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-panel-2">
          <span className="num mt-0.5 w-10 shrink-0 text-[10.5px] text-faint">{mmss(e.t)}</span>
          <Row snap={snap} e={e} />
        </motion.div>
      ))}
    </div>
  )
}

function Row({ snap, e }: { snap: Snapshot; e: ShadowEvent }) {
  switch (e.type) {
    case 'silence':
      return <><CircleSlash2 size={14} className="mt-0.5 shrink-0 text-faint" /><span className="text-muted"><b className="text-text/90">Silent</b> on {fieldLabel(snap, e.field).toLowerCase()} = {valueLabel(snap, e.field, e.value)} — {e.why_silent}</span></>
    case 'episode': {
      const gaps = e.episode.gaps as { field: string; type: string }[]
      return <><GitBranch size={14} className="mt-0.5 shrink-0 text-gap" /><span>Decision on <span className="num">{e.episode.case_id}</span>: {gaps.length ? <>{gaps.map((g) => <span key={g.field} className={g.type === 'structural' ? 'text-gap' : 'text-muted'}>{fieldLabel(snap, g.field)} ({g.type}) </span>)}</> : <span className="text-learn">all predicted</span>}</span></>
    }
    case 'inquiry':
      return e.inquiry.status === 'silent' ? null : <><MessageCircleQuestion size={14} className="mt-0.5 shrink-0 text-ask/70" /><span className="text-muted">Queued for {e.inquiry.phase === 'live' ? 'next pause' : 'debrief'}: <span className="text-text/80">{e.inquiry.text}</span>{e.note && <i> — {e.note}</i>}</span></>
    case 'ask':
      return <><MessageCircleQuestion size={14} className="mt-0.5 shrink-0 text-ask" /><span><b className="text-ask">Asked</b> at a natural pause: {e.inquiry.text}</span></>
    case 'learned': {
      const added = (e.changes as any[]).filter((c) => c.kind === 'node_added')
      const retro = (e.retro as any[]).filter((r) => r.now_explains)
      const probe = (e.changes as any[]).find((c) => c.kind === 'probe')
      return (
        <><Lightbulb size={14} className="mt-0.5 shrink-0 text-learn" />
          <span>
            {added.length > 0 && <><b className="text-learn">Learned</b> {added.map((a) => a.title).join('; ')}. </>}
            {probe && <span className="text-hyp">Unseen case “{probe.delta}” → expert: {probe.answer}{probe.map_predicted && probe.map_predicted !== probe.answer ? ` (map said ${probe.map_predicted})` : ' (map agreed)'}. </span>}
            {retro.length > 0 && <span className="text-learn/80">Also explains {retro.map((r) => r.case_id).join(', ')} retroactively. </span>}
            <span className="num text-faint">+{(e.info_gain_bits as number).toFixed(2)} bits</span>
          </span></>
      )
    }
    case 'record':
      return <><ShieldAlert size={14} className="mt-0.5 shrink-0 text-muted" /><span className="text-muted">{e.off_record ? 'Off the record — nothing is captured.' : 'Back on the record.'}</span></>
    case 'intervene':
      return <><ShieldAlert size={14} className="mt-0.5 shrink-0 text-ask" /><span><b className="text-ask">Stepped in</b> before save: {e.intervention.violation.title}</span></>
    case 'teachback':
      return <><BookOpenCheck size={14} className="mt-0.5 shrink-0 text-learn" /><span>{e.confirmed ? <b className="text-learn">Expert confirmed the teach-back.</b> : <>Teach-back corrected: {e.correction}</>}</span></>
    case 'mode':
      return <><Sparkles size={14} className="mt-0.5 shrink-0 text-predict" /><span>Mode: <b>{e.mode}</b></span></>
  }
  return null
}
