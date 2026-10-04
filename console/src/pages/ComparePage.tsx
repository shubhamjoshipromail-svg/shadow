import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, mmss } from '../lib/api'
import type { CompareExpert, CompareNode, Comparison, Conflict, PeerQuestion } from '../lib/types'
import { Btn, Mark, Testimony, Wordmark } from '../components/ui'

const num = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('de-DE', { maximumFractionDigits: 0 }))
const ACTION: Record<string, string> = { post: 'Post', hold: 'Hold', second_approval: '2nd approval', escalate: 'Ask the controller', reject: 'Reject' }
const valueText = (field: string, v: string | null) => (v == null ? null : field === 'action' ? ACTION[v] ?? v : v)

/** Two experts, one task: where two Work Maps part ways, in each expert's own words, and the question each is asked. */
export default function ComparePage() {
  const { packId = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const [experts, setExperts] = useState<CompareExpert[] | null>(null)
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const withSim = sp.get('sim') === '1'
  const a = sp.get('a') ?? ''
  const b = sp.get('b') ?? ''
  const set = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) (v == null ? next.delete(k) : next.set(k, v))
    setSp(next, { replace: true })
  }, [sp, setSp])

  useEffect(() => {
    api<CompareExpert[]>(`/api/workflows/${packId}/experts?simulated=true`).then(setExperts).catch((e) => setError(String(e)))
  }, [packId])

  const visible = useMemo(() => (experts ?? []).filter((e) => withSim || !e.simulated), [experts, withSim])
  const hasSim = (experts ?? []).some((e) => e.simulated)

  // Defaults: the URL decides; otherwise the first two experts. A rehearsal expert is only offered once the page says so.
  useEffect(() => {
    if (!experts) return
    const names = visible.map((e) => e.expert)
    if (!withSim && hasSim && names.length < 2 && !sp.get('a')) set({ sim: '1' })
    if (names.length >= 2 && (!names.includes(a) || !names.includes(b) || a === b)) {
      const na = names.includes(a) ? a : names[0]
      set({ a: na, b: names.includes(b) && b !== na ? b : names.find((n) => n !== na)! })
    }
  }, [experts, visible, withSim, hasSim, a, b]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    if (!a || !b || a === b || !experts) return
    setError(null)
    api<Comparison>(`/api/workflows/${packId}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&simulated=${withSim}`)
      .then(setCmp).catch((e) => { setCmp(null); setError(String(e).replace(/^Error: \d+ /, '')) })
  }, [packId, a, b, withSim, experts])
  useEffect(load, [load])

  const ask = async (keys: string[] | null, sides: ('a' | 'b')[]) => {
    setBusy(true)
    try {
      const r = await api<{ compare: Comparison }>(`/api/workflows/${packId}/compare/ask`, {
        method: 'POST', body: JSON.stringify({ a, b, simulated: withSim, keys, sides }),
      })
      setCmp(r.compare)
    } catch (e) { setError(String(e)) }
    setBusy(false)
  }

  const open = cmp ? cmp.disagree.flatMap((c) => (['a', 'b'] as const).filter((s) => !c.asked[s]).map((s) => [c.key, s] as const)) : []
  const pct = cmp && cmp.n_comparisons ? Math.round((100 * cmp.agree) / cmp.n_comparisons) : null
  const anySim = !!cmp && (cmp.simulated.a || cmp.simulated.b)

  const select = 'rounded-[3px] border border-rule-strong bg-sheet px-2 py-1 text-[15px] text-ink-1 outline-none focus:border-ink-2'
  return (
    <div className="min-h-full bg-paper">
      <header className="flex items-center gap-4 border-b border-rule-strong bg-sheet px-6 py-2.5">
        <Link to="/" className="text-[12px] text-ink-2 hover:text-ink-1">← notebook</Link>
        <Wordmark />
        <div className="num text-[10.5px] text-ink-3">{cmp?.workflow_name ?? packId}</div>
      </header>

      <main className="mx-auto max-w-[1040px] px-6 pb-24 pt-12">
        <div className="label">Two experts, one task</div>
        <h1 className="testimony mb-0 mt-3 max-w-[22ch] text-[34px] leading-[1.06] tracking-[-0.015em] sm:text-[46px]">
          {cmp ? <>Where {cmp.a} and {cmp.b} part ways</> : 'Where two experts part ways'}
        </h1>
        <p className="mb-0 mt-4 max-w-[62ch] text-[16px] leading-relaxed text-ink-2">
          Each Work Map was taught by one person. Mira ran both on the same cases. Wherever they decide differently, she asks each expert what they look at, in their next debrief.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-3 border-y border-rule py-3.5 text-[15px] text-ink-2">
          <span>Compare</span>
          <select aria-label="First expert" value={a} onChange={(e) => set({ a: e.target.value })} className={select}>
            {visible.map((e) => <option key={e.expert} value={e.expert}>{e.expert}{e.simulated ? ' · rehearsal' : ''}</option>)}
          </select>
          <span>with</span>
          <select aria-label="Second expert" value={b} onChange={(e) => set({ b: e.target.value })} className={select}>
            {visible.map((e) => <option key={e.expert} value={e.expert}>{e.expert}{e.simulated ? ' · rehearsal' : ''}</option>)}
          </select>
          {hasSim && (
            <label className="ml-auto flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={withSim} onChange={(e) => set({ sim: e.target.checked ? '1' : null })} className="accent-[#4e6b44]" />
              include rehearsal experts
            </label>
          )}
        </div>

        {anySim && (
          <div className="mt-5 border-l-[3px] border-query bg-wash px-4 py-3 text-[13px] leading-relaxed text-ink-2">
            <Mark state="query" className="mr-1" />
            <span className="text-ink-1">Rehearsal.</span> {[cmp!.simulated.a && cmp!.a, cmp!.simulated.b && cmp!.b].filter(Boolean).join(' and ')} {cmp!.simulated.a && cmp!.simulated.b ? 'are simulated experts:' : 'is a simulated expert:'} a stand-in that shows how the comparison works, not a claim about a real person. Questions queued for a simulated expert are only asked in a Rehearsal debrief.
          </div>
        )}

        {experts && visible.length < 2 && (
          <p className="mt-8 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
            Only {visible.length === 1 ? visible[0].expert : 'nobody'} has taught this workflow so far. Once a second expert has taught it, their maps can be compared here.
            {hasSim && !withSim && ' A rehearsal expert is available: tick “include rehearsal experts”.'}
          </p>
        )}
        {error && <div role="alert" className="mt-6 border-l-[3px] border-binding pl-3 text-[13px] leading-relaxed text-binding">{error}</div>}
        {!cmp && !error && visible.length >= 2 && <div className="mt-8 text-[14px] text-ink-3">Running both maps on the same cases…</div>}

        {cmp && (
          <>
            <div className="num mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[12px] text-ink-2">
              <span>{cmp.n_cases} cases</span>
              <span><Mark state="confirmed" />{pct}% of {cmp.n_comparisons} decisions identical</span>
              <span><Mark state={cmp.disagree.length ? 'contested' : 'confirmed'} />{cmp.disagree.length} {cmp.disagree.length === 1 ? 'difference' : 'differences'}</span>
              <span className="ml-auto">
                <Btn tone="ask" disabled={busy || open.length === 0} onClick={() => ask(null, ['a', 'b'])}
                  title="Queue every question below into each expert’s next debrief">
                  {open.length ? `Ask everyone why · ${open.length}` : 'Everyone has been asked'}
                </Btn>
              </span>
            </div>

            <Differences cmp={cmp} ask={ask} busy={busy} />
            <Limits cmp={cmp} />
            <OnlyOne cmp={cmp} />
            <Agree cmp={cmp} pct={pct} />
            <Earlier cmp={cmp} />
          </>
        )}
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ sections */
function SectionHead({ n, title, note }: { n: string; title: string; note?: string }) {
  return (
    <div className="mt-14 border-b border-rule-strong pb-2">
      <div className="flex items-baseline gap-3">
        <span className="num text-[11px] text-ink-3">{n}</span>
        <h2 className="m-0 text-[18px] font-medium text-ink-1">{title}</h2>
      </div>
      {note && <p className="mb-0 ml-7 mt-1 max-w-[64ch] text-[14px] leading-relaxed text-ink-2">{note}</p>}
    </div>
  )
}

function Differences({ cmp, ask, busy }: { cmp: Comparison; ask: (keys: string[] | null, sides: ('a' | 'b')[]) => void; busy: boolean }) {
  return (
    <>
      <SectionHead n="1" title="They decide differently" note={cmp.disagree.length ? 'The same case, two different decisions. Each side shows the rule that decided it and what the expert said when they taught it.' : undefined} />
      {cmp.disagree.length === 0 && <p className="mt-5 text-[15px] text-ink-2">On every case compared, the two maps decide the same way.</p>}
      <div>
        {cmp.disagree.map((c, i) => <Difference key={c.key} c={c} i={i + 1} cmp={cmp} ask={ask} busy={busy} />)}
      </div>
    </>
  )
}

function Difference({ c, i, cmp, ask, busy }: { c: Conflict; i: number; cmp: Comparison; ask: (keys: string[] | null, sides: ('a' | 'b')[]) => void; busy: boolean }) {
  const sides = (['a', 'b'] as const).filter((s) => !c.asked[s])
  return (
    <article className="border-b border-rule py-8 first:pt-6">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="num text-[11px] text-ink-3">D{i}</span>
        <h3 className="m-0 text-[16px] font-medium text-ink-1">{c.field_label}</h3>
        <span className="num text-[11px] text-ink-3">{c.count} {c.count === 1 ? 'case' : 'cases'}</span>
        {sides.length === 2 && (
          <span className="ml-auto"><Btn disabled={busy} onClick={() => ask([c.key], ['a', 'b'])}>Ask both why</Btn></span>
        )}
      </header>
      <p className="mb-0 mt-1.5 max-w-[72ch] text-[14px] leading-snug text-ink-2">
        <span className="num mr-2 text-[11px] text-ink-3">e.g.</span>{c.case_describe}
      </p>
      <div className="mt-5 grid grid-cols-1 gap-y-8 md:grid-cols-2 md:gap-y-0 md:divide-x md:divide-rule">
        {(['a', 'b'] as const).map((s) => <Side key={s} c={c} s={s} sim={cmp.simulated[s]} ask={ask} busy={busy} />)}
      </div>
    </article>
  )
}

function Side({ c, s, sim, ask, busy }: { c: Conflict; s: 'a' | 'b'; sim: boolean; ask: (keys: string[] | null, sides: ('a' | 'b')[]) => void; busy: boolean }) {
  const name = s === 'a' ? c.a_expert : c.b_expert
  const value = valueText(c.field, s === 'a' ? c.a_value : c.b_value)
  const node = s === 'a' ? c.a_node : c.b_node
  const q = c.asked[s]
  return (
    <div className={s === 'a' ? 'md:pr-8' : 'md:pl-8'}>
      <div className="num text-[10.5px] uppercase tracking-[.08em] text-ink-3">{name}{sim && ' · rehearsal'}</div>
      <div className="mt-2 flex items-baseline gap-3">
        {value != null
          ? <span className="num text-[24px] leading-none text-ink-1">{value}</span>
          : <span className="text-[15px] italic text-ink-3">{c.field === 'action' ? 'carries on, nothing stops it' : 'leaves it unset'}</span>}
      </div>
      <NodeLine node={node} />
      <div className="mt-6 border-t border-rule pt-3">
        <div className="text-[13.5px] leading-snug text-ink-1"><Mark state="query" className="mr-1" />{c.questions[s]}</div>
        <div className="mt-2.5"><AskStatus q={q} name={name} onAsk={() => ask([c.key], [s])} busy={busy} /></div>
      </div>
    </div>
  )
}

function NodeLine({ node }: { node: CompareNode | null }) {
  if (!node) return <p className="mb-0 mt-3 text-[13px] leading-snug text-ink-3">No rule of theirs applies here.</p>
  const guard = node.kind === 'guardrail'
  return (
    <div className={`mt-3 ${guard ? 'border-l-[3px] border-binding bg-sheet py-2 pl-3 pr-2' : ''}`}>
      <div className="flex items-baseline gap-2 text-[13.5px] leading-snug text-ink-2">
        <Mark state={guard ? 'binding' : node.status === 'confirmed' ? 'confirmed' : node.origin === 'doc' ? 'written' : 'observed'} />
        <span>{node.title}</span>
      </div>
      {node.quote && (
        <div className="mt-2">
          <Testimony quote={{ text: node.quote.text, speaker: node.quote.speaker, ts: (node.quote.ts ?? 0) >= 1 ? node.quote.ts : null, lang: 'en', translation: node.quote.translation, inquiry_id: null }} size="sm" />
        </div>
      )}
      {node.moment && ((node.moment.ts ?? 0) >= 1 || node.moment.entity) && (
        <div className="num mt-1.5 text-[10.5px] text-inferred">▶ on screen {(node.moment.ts ?? 0) >= 1 ? mmss(node.moment.ts) : ''}{node.moment.entity ? ` · ${node.moment.entity}` : ''}</div>
      )}
    </div>
  )
}

function AskStatus({ q, name, onAsk, busy }: { q: PeerQuestion | null; name: string; onAsk: () => void; busy: boolean }) {
  if (!q) return <Btn tone="ask" disabled={busy} onClick={onAsk}>Ask {name}</Btn>
  if (q.status === 'queued') return <div className="num text-[11px] text-query"><Mark state="query" />asked in {name}’s next debrief</div>
  if (q.status === 'asked') return <div className="num text-[11px] text-query"><Mark state="query" />put to {name}{q.session_id ? ` in ${q.session_id}` : ''}; no answer yet</div>
  const a = q.answer
  return (
    <div>
      <div className="num text-[11px] text-confirmed"><Mark state="confirmed" />answered{q.receipt_id ? ` · receipt ${q.receipt_id}` : ''}{a ? ` · map v${a.map_version}` : ''}{a?.added?.length ? ` · +${a.added.join(' +')}` : ''}</div>
      {a?.quote && <blockquote className="testimony m-0 mt-2 text-[15px] leading-[1.45]">“{a.translation || a.quote}”<span className="num ml-2 text-[10px] uppercase tracking-[.08em] text-ink-3">{name}</span></blockquote>}
    </div>
  )
}

/* ------------------------------------------------------------------ limits */
function Limits({ cmp }: { cmp: Comparison }) {
  if (!cmp.thresholds.length) return null
  return (
    <>
      <SectionHead n="2" title="They draw the line in different places" />
      {cmp.thresholds.map((t) => {
        const vals = [t.a, t.b].filter((v): v is number => v != null)
        const lo = Math.min(...vals) * 0.85, hi = Math.max(...vals) * 1.15
        const pos = (v: number | null) => (v == null ? 0 : ((v - lo) / (hi - lo)) * 100)
        return (
          <article key={t.param} className="border-b border-rule py-7">
            <div className="flex items-baseline gap-3">
              <span className="num text-[12px] text-ink-1">{t.param}</span>
              <span className="text-[14px] text-ink-2">{(t.a_node ?? t.b_node)?.title}</span>
            </div>
            <div className="relative mt-8 h-[34px]" aria-hidden>
              <div className="absolute left-0 right-0 top-[17px] h-px bg-rule-strong" />
              {([['a', t.a, cmp.a], ['b', t.b, cmp.b]] as const).map(([k, v, who]) => v != null && (
                <div key={k} className="absolute top-0 -translate-x-1/2" style={{ left: `${pos(v)}%` }}>
                  <div className="num whitespace-nowrap text-center text-[10.5px] text-ink-2">{who}</div>
                  <div className="mx-auto mt-1 h-[18px] w-px bg-ink-1" />
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-y-6 md:grid-cols-2 md:divide-x md:divide-rule">
              {([['a', t.a, cmp.a, t.a_node], ['b', t.b, cmp.b, t.b_node]] as const).map(([k, v, who, node]) => (
                <div key={k} className={k === 'a' ? 'md:pr-8' : 'md:pl-8'}>
                  <div className="num text-[10.5px] uppercase tracking-[.08em] text-ink-3">{who}</div>
                  <div className="num mt-1.5 text-[24px] leading-none text-ink-1">{num(v)}</div>
                  {node?.quote && <div className="mt-3"><Testimony quote={{ text: node.quote.text, speaker: node.quote.speaker, ts: (node.quote.ts ?? 0) >= 1 ? node.quote.ts : null, lang: 'en', translation: node.quote.translation, inquiry_id: null }} size="sm" /></div>}
                </div>
              ))}
            </div>
          </article>
        )
      })}
    </>
  )
}

/* ------------------------------------------------------------------ only one */
function OnlyOne({ cmp }: { cmp: Comparison }) {
  const n = cmp.unique.a.length + cmp.unique.b.length
  if (!n) return null
  return (
    <>
      <SectionHead n="3" title="One of them has a rule the other does not" />
      <div className="mt-5 grid grid-cols-1 gap-y-8 md:grid-cols-2 md:divide-x md:divide-rule">
        {([['a', cmp.a, cmp.unique.a, cmp.b], ['b', cmp.b, cmp.unique.b, cmp.a]] as const).map(([k, who, nodes, other]) => (
          <div key={k} className={k === 'a' ? 'md:pr-8' : 'md:pl-8'}>
            <div className="num text-[10.5px] uppercase tracking-[.08em] text-ink-3">Only {who}</div>
            {nodes.length === 0 && <p className="mb-0 mt-3 text-[13.5px] text-ink-3">Nothing that {other} lacks.</p>}
            {nodes.map((n) => (
              <div key={n.id} className="mt-4">
                {n.kind === 'guardrail' && <div className="num text-[10.5px] uppercase tracking-[.08em] text-binding">■ {n.guardrail_type?.replaceAll('_', ' ')}{n.ask ? ` · ${n.ask}` : ''}</div>}
                <NodeLine node={n} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ agreement */
function Agree({ cmp, pct }: { cmp: Comparison; pct: number | null }) {
  return (
    <>
      <SectionHead n="4" title="They agree" note={`On ${cmp.agree} of ${cmp.n_comparisons} decisions (${pct ?? '—'}%).${cmp.shared_written ? ` Both start from the same ${cmp.shared_written} clauses of the written process.` : ''}`} />
      {cmp.shared.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-rule p-0">
          {cmp.shared.map((s) => (
            <li key={s.title} className="flex items-baseline gap-2 py-2.5 text-[14px] text-ink-1">
              <Mark state="confirmed" /><span>{s.title}</span>
              <span className="num ml-auto text-[10.5px] text-ink-3">both</span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-[14px] text-ink-3">No learned rule is shared yet.</p>}
    </>
  )
}

function Earlier({ cmp }: { cmp: Comparison }) {
  if (!cmp.earlier.length) return null
  return (
    <>
      <SectionHead n="5" title="Asked earlier" note="Questions put to these experts about differences that have since changed or closed." />
      <div className="divide-y divide-rule">
        {cmp.earlier.map((q) => (
          <div key={q.id} className="py-4">
            <div className="text-[13.5px] leading-snug text-ink-2"><span className="num mr-2 text-[10.5px] uppercase tracking-[.08em] text-ink-3">{q.expert}</span>{q.text}</div>
            <div className="mt-2"><AskStatus q={q} name={q.expert} onAsk={() => {}} busy /></div>
          </div>
        ))}
      </div>
    </>
  )
}
