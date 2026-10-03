import type { ReactNode } from 'react'
import type { Snapshot, Status } from '../lib/types'

export function Section({ title, right, children, className = '' }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="label">{title}</div>
        {right}
      </div>
      {children}
    </section>
  )
}

const STATUS_STYLE: Record<Status, string> = {
  confirmed: 'text-learn border-learn/40 bg-learn/10',
  stated: 'text-ask border-ask/40 bg-ask/10',
  inferred: 'text-hyp border-hyp/40 bg-hyp/10',
  contested: 'text-gap border-gap/40 bg-gap/10',
}

export function BeliefBadge({ status, p }: { status: Status; p?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_STYLE[status]}`}>
      {status}
      {p != null && <span className="num opacity-70">{Math.round(p * 100)}%</span>}
    </span>
  )
}

export function SourceChip({ source, snap }: { source: string; snap: Snapshot }) {
  const node = [...snap.map.rules, ...snap.map.guardrails].find((n) => n.id === source)
  let cls = 'border-line-2 text-muted'
  let label = source
  if (source === 'novice') { cls = 'border-predict/40 text-predict'; label = 'AI novice' }
  else if (node?.origin === 'doc') { cls = 'border-doc/40 text-doc'; label = '2019 doc' }
  else if (node) { cls = 'border-learn/40 text-learn'; label = `learned ${node.id}` }
  return <span className={`rounded border px-1.5 py-px text-[10px] font-semibold ${cls}`}>{label}</span>
}

export function fieldLabel(snap: Snapshot, field: string | null | undefined) {
  if (!field) return ''
  if (field === 'action') return 'Action'
  return snap.pack.fields.find((f) => f.name === field)?.label ?? field
}

export function valueLabel(snap: Snapshot, field: string, value: string | null | undefined) {
  if (value == null) return '—'
  if (field === 'action') return ({ post: 'Post', hold: 'Hold', second_approval: '2nd approval', escalate: 'Ask controller', reject: 'Reject' } as Record<string, string>)[value] ?? value
  const lbl = snap.pack.fields.find((f) => f.name === field)?.option_labels?.[value]
  if (field === 'payment_timing') return value === 'skonto' ? 'Skonto window' : 'Due date'
  return lbl ? `${value} · ${lbl}` : value
}

export function Dot({ on, color = 'bg-learn' }: { on: boolean; color?: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${on ? `${color} shadow-[0_0_0_3px_rgba(61,220,151,.15)]` : 'bg-faint'}`} />
}

export function Btn({ children, onClick, tone = 'default', disabled, title }: { children: ReactNode; onClick?: () => void; tone?: 'default' | 'primary' | 'ask' | 'danger' | 'ghost'; disabled?: boolean; title?: string }) {
  const tones = {
    default: 'bg-panel-2 border-line-2 hover:border-muted text-text',
    primary: 'bg-learn text-ink border-learn hover:brightness-110',
    ask: 'bg-ask text-ink border-ask hover:brightness-110',
    danger: 'bg-gap/15 text-gap border-gap/40 hover:bg-gap/25',
    ghost: 'bg-transparent border-transparent text-muted hover:text-text',
  }
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold transition disabled:opacity-40 ${tones[tone]}`}>
      {children}
    </button>
  )
}

export function Bar({ value, color = 'bg-hyp', className = '' }: { value: number; color?: string; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`}>
      <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  )
}
