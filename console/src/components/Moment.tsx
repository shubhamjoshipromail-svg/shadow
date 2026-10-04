import { mmss } from '../lib/api'
import type { MapNode, Quote, Receipt, ScreenMoment, Snapshot, Step } from '../lib/types'
import { Mark, Testimony, fieldLabel, statusProv, valueLabel, type Prov } from './ui'

/*
 * A screen moment on the Work Map: the timestamp, the case, the field and the before → after change,
 * her quote, the attention path, and the frame slot. Frames are never uploaded — the browser keeps them —
 * so the panel says so plainly instead of pointing at an endpoint that does not exist.
 *
 * The shared ScreenMoment type declares ts/frame_id/entity/field/label. The backend also writes two keys
 * the type does not yet name: `path` (where she looked, in order) and, on a field edit, before/after.
 * This file widens the read-only view of that JSON; it does not change the contract.
 */
export interface MomentPathStep { kind?: string | null; name?: string | null; t?: number | null }
export interface MomentData extends ScreenMoment { path?: MomentPathStep[] | null; before?: string | null; after?: string | null }

export interface MomentSource {
  key: string // unique per row: `step:S3`, `node:R1`
  moment: MomentData
  node?: MapNode | null
  step?: Step | null
}

const panelId = (key: string) => `moment-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`

function findCase(snap: Snapshot, entity: string | null | undefined) {
  if (!entity) return null
  const exact = snap.cases.find((c) => c.id === entity)
  if (exact) return exact
  const no = String(entity).replace(/^inv-/, '')
  return snap.cases.find((c) => c.invoice_no === entity || c.invoice_no === no) ?? null
}

function entityLabel(snap: Snapshot, entity: string | null | undefined) {
  if (!entity) return ''
  const c = findCase(snap, entity)
  return c ? `invoice ${c.invoice_no}` : entity
}

function sameMoment(a: ScreenMoment | null | undefined, b: MomentData) {
  if (!a) return false
  return a.ts === b.ts && (a.frame_id ?? null) === (b.frame_id ?? null)
}

/** The receipt that taught this node, else the earliest receipt on this case/field: its before/after is the change. */
function receiptFor(snap: Snapshot, m: MomentData, node?: MapNode | null): Receipt | null {
  if (!m.entity && !m.field) return null
  const rows = (snap.receipts ?? []).filter((r) =>
    (!m.entity || r.case_id === m.entity) && (!m.field || r.field === m.field))
  if (rows.length === 0) return null
  const byNode = node && rows.find((r) => r.diff?.added?.some((a) => a.id === node.id))
  return byNode || rows.find((r) => r.status === 'learned') || rows[0]
}

type ChangeKind = 'screen' | 'receipt' | 'episode' | 'rule'
interface Change {
  before: string | null; after: string | null; kind: ChangeKind
  beforeNote?: string | null; afterNote?: string | null
}

function changeFor(snap: Snapshot, m: MomentData, node: MapNode | null | undefined, receipt: Receipt | null): Change | null {
  // 1. the literal edit on screen, if the snapshot carries it
  if (m.before != null || m.after != null) return { before: m.before ?? null, after: m.after ?? null, kind: 'screen' }
  // 2. the receipt: Tacet's committed guess → what she did (and the rule that now explains it)
  if (receipt) {
    const before = receipt.before?.value ?? null
    const after = receipt.after?.value ?? receipt.expert_value ?? null
    if (before != null || after != null) {
      return { before, after, kind: 'receipt',
        beforeNote: receipt.before?.source_title ?? null, afterNote: receipt.after?.source_title ?? null }
    }
  }
  // 3. the episode: the prediction written down beforehand vs her value
  const field = m.field ?? null
  if (m.entity && field) {
    const ep = [...(snap.episodes ?? [])].filter((e) => e.case_id === m.entity).sort((a, b) => b.ts - a.ts)[0]
    if (ep) {
      const before = ep.predicted[field] ?? null
      const after = ep.expert[field] ?? null
      if (before != null || after != null) return { before, after, kind: 'episode' }
    }
  }
  // 4. the rule's own consequence, with no before to show
  if (node && field && node.then?.[field] != null) return { before: null, after: String(node.then[field]), kind: 'rule' }
  return null
}

/** Her words at that moment: the clause's own quote, else the answer that taught it, else a sibling clause's. */
function quoteFor(snap: Snapshot, m: MomentData, node: MapNode | null | undefined, step: Step | null | undefined,
                  receipt: Receipt | null): Quote | null {
  if (node?.quote) return node.quote
  const taught = receipt?.teaching?.quote
  if (taught && taught.trim()) {
    return { text: taught, speaker: snap.expert, ts: null, lang: snap.lang,
      translation: receipt?.teaching?.translation ?? null, inquiry_id: receipt?.inquiry_id ?? null }
  }
  if (step) {
    const ids = new Set([...step.rule_ids, ...step.guardrail_ids])
    const nodes = [...snap.map.rules, ...snap.map.guardrails]
    const hit = nodes.find((n) => ids.has(n.id) && n.quote && sameMoment(n.screen_moment, m))
      ?? nodes.find((n) => ids.has(n.id) && n.quote)
    if (hit?.quote) return hit.quote
  }
  return null
}

const beforeProv = (c: Change, receipt: Receipt | null): Prov => {
  if (c.kind === 'screen') return 'observed' // it really was on screen
  if (c.kind === 'receipt' && receipt?.before?.source?.startsWith('D')) return 'written' // the 2019 process
  return 'inferred' // Tacet's committed guess
}
const afterProv = (c: Change, node?: MapNode | null): Prov =>
  c.kind === 'rule' && node ? statusProv(node.belief.status, !!node.type) : 'observed'

/** The moment as a button. Its own control, so it can live inside a row that is itself clickable. */
export function MomentButton({ snap, source, open, onToggle, showEntity = false }: {
  snap: Snapshot; source: MomentSource; open: boolean; onToggle: () => void; showEntity?: boolean
}) {
  const entity = showEntity ? entityLabel(snap, source.moment.entity) : ''
  const label = `screen moment ${mmss(source.moment.ts)}${entity ? `, ${entity}` : ''}`
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onToggle() }}
      aria-expanded={open} aria-controls={panelId(source.key)} aria-label={label} title={label}
      className={`num shrink-0 text-[10.5px] text-inferred hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink-2 ${open ? 'underline' : ''}`}>
      ▶ {mmss(source.moment.ts)}{entity ? ` · ${entity}` : ''}
    </button>
  )
}

/** The moment itself, ruled off under its row. One at a time; Escape closes it (handled by the page). */
export function MomentPanel({ snap, source }: { snap: Snapshot; source: MomentSource }) {
  const m = source.moment
  const receipt = receiptFor(snap, m, source.node)
  const change = changeFor(snap, m, source.node, receipt)
  const quote = quoteFor(snap, m, source.node, source.step, receipt)
  const path = (m.path ?? []).filter((p) => p && (p.name || p.kind))
  const c = findCase(snap, m.entity)
  const field = m.field ?? null
  const value = (v: string | null) => (field ? valueLabel(snap, field, v) : v ?? '—')

  return (
    <div id={panelId(source.key)} className="ink-in mt-3 border-l border-rule-strong pl-3">
      <div className="num flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10.5px] text-ink-3">
        <span className="text-ink-1">{mmss(m.ts)}</span>
        {c ? <span className="text-ink-2">invoice {c.invoice_no}{c.supplier?.name ? ` · ${c.supplier.name}` : ''}</span>
          : m.entity ? <span className="text-ink-2">{m.entity}</span> : null}
        {field && <span className="text-ink-2">{fieldLabel(snap, field)} <span className="text-ink-3">{field}</span></span>}
        {m.label && <span className="text-ink-2">{m.label}</span>}
        {m.frame_id && <span className="text-ink-3">frame {m.frame_id}</span>}
      </div>

      {change && (
        <div className="num mt-2 border-t border-rule pt-2 text-[11px] text-ink-1">
          <span className="label mr-2">change</span>
          <Mark state={beforeProv(change, receipt)} />
          {change.before != null ? <span>{value(change.before)}</span> : <span className="text-ink-3">—</span>}
          <span className="mx-1.5 text-ink-3">→</span>
          <Mark state={afterProv(change, source.node)} />
          {change.after != null ? <span>{value(change.after)}</span> : <span className="text-ink-3">—</span>}
          {(change.beforeNote || change.afterNote) && (
            <span className="ml-2 text-[10px] text-ink-3">
              {[change.beforeNote, change.afterNote].filter(Boolean).join(' → ')}
            </span>
          )}
        </div>
      )}

      {quote && (
        <div className="mt-2 border-t border-rule pt-2">
          <div className="label mb-1">her words</div>
          <Testimony quote={quote} size="sm" />
        </div>
      )}

      {path.length > 0 && (
        <div className="num mt-2 border-t border-rule pt-2 text-[11px] leading-relaxed text-ink-2">
          <span className="label mr-2">attention</span>
          {path.map((p, i) => (
            <span key={`${p.kind ?? 'step'}-${p.name ?? i}-${i}`}>
              {i > 0 && <span className="mx-1 text-ink-3">→</span>}
              <span className="text-ink-3">{p.kind === 'panel' ? 'panel' : 'field'} </span>
              {p.name}{p.t != null && <span className="text-ink-3"> {mmss(p.t)}</span>}
            </span>
          ))}
        </div>
      )}

      <div className="num mt-2 border-t border-rule pt-2 text-[10.5px] text-ink-3">
        frame not kept · frames stay in the browser for privacy
      </div>
    </div>
  )
}
