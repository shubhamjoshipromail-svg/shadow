import type { ReactNode } from 'react'
import type { Quote, Snapshot, Status } from '../lib/types'
import { mmss } from '../lib/api'

/* ------------------------------------------------------------------ provenance
 * Every claim carries its state in two channels: a glyph and an ink. Hue alone is never enough.
 *   observed ▮  a human did or said this         inferred ◌  Tacet thinks this
 *   confirmed ✓ behavior agreed with it          binding ■   a guardrail: it forbids
 *   contested ✗ later behavior contradicted it   query ?     Tacet is asking
 */
export type Prov = 'observed' | 'inferred' | 'confirmed' | 'binding' | 'contested' | 'query' | 'written'

const MARK: Record<Prov, [string, string]> = {
  observed: ['▮', 'text-observed'],
  inferred: ['◌', 'text-inferred'],
  confirmed: ['✓', 'text-confirmed'],
  binding: ['■', 'text-binding'],
  contested: ['✗', 'text-contested'],
  query: ['?', 'text-query'],
  written: ['§', 'text-written'],
}

export function Mark({ state, className = '' }: { state: Prov; className?: string }) {
  const [g, c] = MARK[state]
  return <span aria-hidden className={`num inline-block w-[1.1em] text-center leading-none ${c} ${className}`}>{g}</span>
}

export function statusProv(status: Status, guardrail = false): Prov {
  if (status === 'contested') return 'contested'
  if (guardrail && status !== 'inferred') return 'binding'
  if (status === 'confirmed') return 'confirmed'
  if (status === 'stated') return 'observed'
  return 'inferred'
}

const STATUS_WORD: Record<Status, string> = { inferred: 'inferred', stated: 'stated', confirmed: 'confirmed', contested: 'contested' }

/** A node's belief, as apparatus: glyph + word + (optionally) probability. No pill, no fill. */
export function BeliefBadge({ status, p, guardrail = false }: { status: Status; p?: number; guardrail?: boolean }) {
  const prov = statusProv(status, guardrail)
  return (
    <span className={`num inline-flex shrink-0 items-center gap-1 text-[10.5px] ${MARK[prov][1]}`}>
      <Mark state={prov} />{STATUS_WORD[status]}
      {p != null && <span className="text-ink-3">{p.toFixed(2)}</span>}
    </span>
  )
}

/** The expert's words. Serif, quoted, attributed in small caps. */
export function Testimony({ quote, size = 'md', onPlay }: { quote: Quote; size?: 'sm' | 'md' | 'lg'; onPlay?: () => void }) {
  const cls = size === 'lg' ? 'text-[26px] leading-[1.3]' : size === 'sm' ? 'text-[14.5px] leading-[1.45]' : 'text-[18px] leading-[1.45]'
  return (
    <figure className="ink-in m-0">
      <blockquote className={`testimony m-0 ${cls}`}>“{quote.translation || quote.text}”</blockquote>
      <figcaption className="num mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[.08em] text-ink-3">
        <span>{quote.speaker}</span>
        {quote.ts != null && (onPlay
          ? <button onClick={onPlay} className="text-inferred hover:underline">▶ {mmss(quote.ts)}</button>
          : <span>{mmss(quote.ts)}</span>)}
        {quote.translation && <span className="normal-case tracking-normal">· original: “{quote.text}”</span>}
      </figcaption>
    </figure>
  )
}

/* ------------------------------------------------------------------ layout */
export function Section({ title, right, children, className = '', flush = false }: {
  title: string; right?: ReactNode; children: ReactNode; className?: string; flush?: boolean
}) {
  return (
    <section className={`${flush ? '' : 'panel px-4 pb-4 pt-3'} ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-rule pb-2">
        <div className="label">{title}</div>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Wordmark({ size = 13 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-[-0.02em] text-ink-1" style={{ fontSize: size + 3 }}>
      <span className="relative inline-block" style={{ width: size, height: size }}>
        <span className="absolute inset-0 translate-x-[3px] -translate-y-[3px] bg-[#c9d1bb]" />
        <span className="absolute inset-0 bg-confirmed" />
      </span>
      tacet
    </span>
  )
}

export function SourceChip({ source, snap }: { source: string; snap: Snapshot }) {
  const node = [...snap.map.rules, ...snap.map.guardrails].find((n) => n.id === source)
  if (source === 'novice') return <span className="num text-[10px] text-inferred"><Mark state="inferred" />AI novice</span>
  if (node?.origin === 'doc') return <span className="num text-[10px] text-written"><Mark state="written" />2019 doc</span>
  if (node) return <span className="num text-[10px] text-confirmed"><Mark state={statusProv(node.belief.status, !!node.type)} />{node.id}</span>
  return <span className="num text-[10px] text-ink-3">{source}</span>
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

/** Connection / capture state: a small square, steady. */
export function Dot({ on }: { on: boolean; color?: string }) {
  return <span className={`inline-block h-[6px] w-[6px] ${on ? 'capture-tick bg-confirmed' : 'bg-ink-3'}`} />
}

export function Btn({ children, onClick, tone = 'default', disabled, title }: {
  children: ReactNode; onClick?: () => void; tone?: 'default' | 'primary' | 'ask' | 'danger' | 'ghost'; disabled?: boolean; title?: string
}) {
  const tones = {
    default: 'bg-sheet border-rule-strong text-ink-1 hover:border-ink-2',
    primary: 'bg-ink-1 border-ink-1 text-sheet hover:bg-[#3a3732]',
    ask: 'bg-sheet border-query text-query hover:bg-[#f6efe0]',
    danger: 'bg-sheet border-binding text-binding hover:bg-[#f7ebe7]',
    ghost: 'bg-transparent border-transparent text-ink-2 hover:text-ink-1',
  }
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2.5 py-[5px] text-[12.5px] font-medium transition-colors disabled:opacity-40 ${tones[tone]}`}>
      {children}
    </button>
  )
}

/** An interval, not a fill bar: a hairline track with the value marked. */
export function Bar({ value, color = 'bg-candidate', className = '' }: { value: number; color?: string; className?: string }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className={`relative h-[3px] w-full bg-rule ${className}`}>
      <div className={`absolute inset-y-0 left-0 ${color} transition-[width] duration-200`} style={{ width: `${v * 100}%` }} />
    </div>
  )
}
