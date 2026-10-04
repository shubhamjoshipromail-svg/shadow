import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, mmss } from '../lib/api'
import type { CompareExpert, CompareNode, Comparison, Conflict, PeerQuestion } from '../lib/types'
import { Btn, Mark, Testimony, Wordmark } from '../components/ui'

const num = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('de-DE', { maximumFractionDigits: 0 }))
const ACTION: Record<string, string> = { post: 'Post', hold: 'Hold', second_approval: '2nd approval', escalate: 'Ask the controller', reject: 'Reject' }
const valueText = (field: string, v: string | null) => (v == null ? null : field === 'action' ? ACTION[v] ?? v : v)

type Side = 'a' | 'b'
type AskFn = (keys: string[] | null, sides: Side[]) => void
/** One neutral ink and one glyph per expert. Neither is "right": no red / green. */
const SIDE = {
  a: { glyph: '‹', ink: 'text-ink-1', rule: 'border-ink-1' },
  b: { glyph: '›', ink: 'text-inferred', rule: 'border-inferred' },
} as const
const quoteOf = (n: CompareNode) => n.quote && { text: n.quote.text, speaker: n.quote.speaker, ts: (n.quote.ts ?? 0) >= 1 ? n.quote.ts : null, lang: 'en', translation: n.quote.translation, inquiry_id: null }
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** Two experts, one task, read like a diff of two people's judgment. Mira asks each expert why, in their next debrief. */
export default function ComparePage() {
  const { packId = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const [experts, setExperts] = useState<CompareExpert[] | null>(null)
  const [cmp, setCmp] = useState<Comparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  const names = useMemo(() => (experts ?? []).map((e) => e.expert), [experts])

  // Defaults: the URL decides; otherwise the first two experts.
  useEffect(() => {
    if (names.length >= 2 && (!names.includes(a) || !names.includes(b) || a === b)) {
      const na = names.includes(a) ? a : names[0]
      set({ a: na, b: names.includes(b) && b !== na ? b : names.find((n) => n !== na)! })
    }
  }, [names, a, b]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    if (!a || !b || a === b || !experts) return
    setError(null)
    api<Comparison>(`/api/workflows/${packId}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&simulated=true`)
      .then(setCmp).catch((e) => { setCmp(null); setError(String(e).replace(/^Error: \d+ /, '')) })
  }, [packId, a, b, experts])
  useEffect(load, [load])

  const ask: AskFn = async (keys, sides) => {
    setBusy(true)
    try {
      const r = await api<{ compare: Comparison }>(`/api/workflows/${packId}/compare/ask`, {
        method: 'POST', body: JSON.stringify({ a, b, simulated: true, keys, sides }),
      })
      setCmp(r.compare)
    } catch (e) { setError(String(e)) }
    setBusy(false)
  }

  const open = cmp ? cmp.disagree.flatMap((c) => (['a', 'b'] as const).filter((s) => !c.asked[s]).map((s) => [c.key, s] as const)) : []
  const sel = 'num cursor-pointer rounded-[3px] border border-rule-strong bg-sheet px-2 py-1 text-[13px] text-ink-1 outline-none focus:border-ink-2'

  return (
    <div className="min-h-full bg-paper">
      <header className="flex items-center gap-4 border-b border-rule-strong bg-sheet px-6 py-2.5">
        <Link to="/" className="text-[12px] text-ink-2 hover:text-ink-1">← notebook</Link>
        <Wordmark />
        <div className="num text-[10.5px] text-ink-3">{cmp?.workflow_name ?? packId}</div>
      </header>

      <main className="mx-auto max-w-[1120px] px-5 pb-28 pt-10 sm:px-6">
        <div className="label">Two experts, one task</div>
        <p className="mb-0 mt-3 max-w-[64ch] text-[16px] leading-relaxed text-ink-2">
          Mira ran both Work Maps on the same cases. Where they part, she can ask each expert why, out loud, in their next session with her. You choose which differences are worth asking about. This page is for the process owner; new hires never see it.
        </p>

        <div className="num mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-rule py-3 text-[13px] text-ink-3">
          <span>compare</span>
          <select aria-label="First expert" value={a} onChange={(e) => set({ a: e.target.value })} className={sel}>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button aria-label="Swap experts" title="Swap" onClick={() => set({ a: b, b: a })} className="px-1 text-[18px] leading-none text-ink-2 hover:text-ink-1">⇄</button>
          <select aria-label="Second expert" value={b} onChange={(e) => set({ b: e.target.value })} className={sel}>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {experts && names.length < 2 && (
          <p className="mt-8 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
            Only {names.length === 1 ? names[0] : 'nobody'} has taught this workflow so far. Once a second expert has taught it, their maps can be compared here.
          </p>
        )}
        {error && <div role="alert" className="mt-6 border-l-[3px] border-binding pl-3 text-[13px] leading-relaxed text-binding">{error}</div>}
        {!cmp && !error && names.length >= 2 && <div className="num mt-8 text-[12px] text-ink-3">running both maps on the same cases…</div>}

        {cmp && <Diff cmp={cmp} ask={ask} busy={busy} nOpen={open.length} />}
      </main>
    </div>
  )
}

function Diff({ cmp, ask, busy, nOpen }: { cmp: Comparison; ask: AskFn; busy: boolean; nOpen: number }) {
  const differ = cmp.n_comparisons - cmp.agree
  const nBar = 40
  const dBar = differ ? Math.min(nBar - 1, Math.max(1, Math.round((nBar * differ) / Math.max(1, cmp.n_comparisons)))) : 0
  const plusRules = cmp.unique.b.length, minusRules = cmp.unique.a.length
  const nRules = plusRules + minusRules
  const hasEarlier = cmp.earlier.length > 0
  const rail: [string, string, number | null][] = [
    ['decisions', 'Decisions', cmp.disagree.length],
    ...(cmp.thresholds.length ? [['thresholds', 'Thresholds', cmp.thresholds.length] as [string, string, number]] : []),
    ...(nRules ? [['rules', 'Rules', nRules] as [string, string, number]] : []),
    ['same', 'Same', null],
    ...(hasEarlier ? [['earlier', 'Asked earlier', cmp.earlier.length] as [string, string, number]] : []),
  ]
  return (
    <div className="ink-in mt-8 lg:grid lg:grid-cols-[150px_minmax(0,1fr)] lg:gap-x-10">
      <nav aria-label="Sections" className="num hidden text-[12px] lg:block">
        <div className="sticky top-6 border-l border-rule pl-3">
          <div className="label mb-2">changed</div>
          {rail.map(([id, label, n]) => (
            <button key={id} onClick={() => jump(id)} className="flex w-full items-baseline justify-between py-1 text-left text-ink-2 hover:text-ink-1">
              <span>{label}</span>{n != null && <span className="text-ink-3">{n}</span>}
            </button>
          ))}
        </div>
      </nav>

      <div className="min-w-0">
        <h1 className="num m-0 text-[17px] font-medium leading-snug text-ink-1 sm:text-[20px]">
          <span>{cmp.a}</span><span className="mx-2.5 text-ink-3">⇄</span><span>{cmp.b}</span>
          <span className="ml-3 text-[13px] font-normal text-ink-3">· {cmp.workflow_name}</span>
        </h1>
        <div className="num mt-3 text-[12.5px] leading-relaxed text-ink-2">
          {cmp.n_cases} cases · {cmp.n_comparisons} decisions · {cmp.agree} same · <span className={differ ? 'text-query' : ''}>{differ} differ</span> · thresholds ~{cmp.thresholds.length} · rules <span className="text-ink-1">+{plusRules}</span> <span className="text-ink-1">−{minusRules}</span>
        </div>
        <div aria-hidden className="num mt-1 select-none text-[13px] leading-none tracking-[.04em]">
          <span className="text-query">{'|'.repeat(dBar)}</span><span className="text-rule-strong">{'|'.repeat(nBar - dBar)}</span>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Btn tone="ask" disabled={busy || nOpen === 0} onClick={() => ask(null, ['a', 'b'])}
            title="Mira will put each open question to its expert in their next session">
            {nOpen ? 'Have Mira ask about every difference' : cmp.disagree.length ? 'Mira has been asked about every difference' : 'Nothing to ask'}
          </Btn>
          {nOpen > 0 && <span className="num text-[11.5px] text-ink-3">{nOpen} {nOpen === 1 ? 'question' : 'questions'}, one per expert per difference</span>}
        </div>

        <Decisions cmp={cmp} ask={ask} busy={busy} />
        <Limits cmp={cmp} />
        <OnlyOne cmp={cmp} />
        <Same cmp={cmp} />
        <Earlier cmp={cmp} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ sections */
function Head({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <div id={id} className="num mt-14 scroll-mt-6 border-b border-rule-strong pb-2 text-[11px] uppercase tracking-[.08em] text-ink-3">
      {title}{count != null && <span className="ml-2 text-ink-2">{count}</span>}
    </div>
  )
}

function Decisions({ cmp, ask, busy }: { cmp: Comparison; ask: AskFn; busy: boolean }) {
  return (
    <>
      <Head id="decisions" title="Decisions that differ" count={cmp.disagree.length} />
      {cmp.disagree.length === 0 && <p className="mt-5 text-[15px] text-ink-2">On every case compared, the two maps decide the same way.</p>}
      {cmp.disagree.map((c) => <Hunk key={c.key} c={c} ask={ask} busy={busy} />)}
    </>
  )
}

function Hunk({ c, ask, busy }: { c: Conflict; ask: AskFn; busy: boolean }) {
  const both = !c.asked.a && !c.asked.b
  return (
    <section className="ink-in mt-7">
      <div className="num flex flex-wrap items-baseline gap-x-2 bg-wash px-3 py-1.5 text-[11.5px] leading-snug text-ink-2">
        <span className="min-w-0 flex-1"><span className="text-ink-3">@@</span> {c.field_label.toLowerCase()} · {c.case_describe} · {c.count} {c.count === 1 ? 'case' : 'cases'} <span className="text-ink-3">@@</span></span>
        {both && <button disabled={busy} onClick={() => ask([c.key], ['a', 'b'])} className="whitespace-nowrap text-query hover:underline disabled:opacity-40">Have Mira ask both</button>}
      </div>
      <Line c={c} s="a" ask={ask} busy={busy} />
      <Line c={c} s="b" ask={ask} busy={busy} />
    </section>
  )
}

function Line({ c, s, ask, busy }: { c: Conflict; s: Side; ask: AskFn; busy: boolean }) {
  const name = s === 'a' ? c.a_expert : c.b_expert
  const value = valueText(c.field, s === 'a' ? c.a_value : c.b_value)
  const node = s === 'a' ? c.a_node : c.b_node
  const q = c.asked[s]
  return (
    <div className={`grid grid-cols-[1.4rem_minmax(0,1fr)] gap-y-4 border-b border-rule py-5 md:grid-cols-[1.4rem_minmax(0,1fr)_17rem] md:gap-x-6`}>
      <div className={`num text-[24px] leading-[.9] ${SIDE[s].ink}`} aria-hidden>{SIDE[s].glyph}</div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <span className={`num text-[11px] uppercase tracking-[.08em] ${SIDE[s].ink}`}>{name}</span>
          {value != null
            ? <span className="num text-[24px] leading-none text-ink-1">{value}</span>
            : <span className="text-[15px] italic text-ink-3">{c.field === 'action' ? 'carries on, nothing stops it' : 'leaves it unset'}</span>}
        </div>
        <NodeLine node={node} />
      </div>
      <div className="col-start-2 min-w-0 md:col-start-3">
        <div className="num text-[10px] uppercase tracking-[.08em] text-ink-3">Mira would ask</div>
        <div className="mt-1 text-[12.5px] leading-snug text-ink-2">{c.questions[s]}</div>
        <div className="mt-2.5"><AskStatus q={q} name={name} onAsk={() => ask([c.key], [s])} busy={busy} /></div>
      </div>
    </div>
  )
}

function NodeLine({ node }: { node: CompareNode | null }) {
  if (!node) return <p className="mb-0 mt-2.5 text-[13px] leading-snug text-ink-3">No rule of theirs applies here.</p>
  const guard = node.kind === 'guardrail'
  const quote = quoteOf(node)
  return (
    <div className={`mt-2.5 ${guard ? 'border-l-[3px] border-binding bg-sheet py-2 pl-3 pr-2' : ''}`}>
      <div className="flex items-baseline gap-2 text-[13.5px] leading-snug text-ink-2">
        <Mark state={guard ? 'binding' : node.status === 'confirmed' ? 'confirmed' : node.origin === 'doc' ? 'written' : 'observed'} />
        <span>{node.title}</span>
      </div>
      {quote && <div className="mt-2"><Testimony quote={quote} size="sm" /></div>}
      {node.moment && ((node.moment.ts ?? 0) >= 1 || node.moment.entity) && (
        <div className="num mt-1.5 text-[10.5px] text-inferred">▶ on screen {(node.moment.ts ?? 0) >= 1 ? mmss(node.moment.ts) : ''}{node.moment.entity ? ` · ${node.moment.entity}` : ''}</div>
      )}
    </div>
  )
}

function AskStatus({ q, name, onAsk, busy }: { q: PeerQuestion | null; name: string; onAsk: () => void; busy: boolean }) {
  if (!q) return <Btn tone="ask" disabled={busy} onClick={onAsk}>Have Mira ask {name}</Btn>
  if (q.status === 'queued') return <div className="num text-[11.5px] leading-snug text-query"><Mark state="query" />Mira will ask {name} in {name}’s next session</div>
  if (q.status === 'asked') return <div className="num text-[11.5px] leading-snug text-query"><Mark state="query" />Mira put it to {name}{q.session_id ? <> in <Link to={`/s/${q.session_id}`} className="underline">{q.session_id}</Link></> : ''}; no answer yet</div>
  const a = q.answer
  return (
    <div>
      <div className="num text-[11.5px] leading-snug text-confirmed">
        <Mark state="confirmed" />{name} answered
        {q.receipt_id && <> · {q.session_id ? <Link to={`/s/${q.session_id}`} className="underline">receipt {q.receipt_id}</Link> : `receipt ${q.receipt_id}`}</>}
        {a ? ` · map v${a.map_version}` : ''}{a?.added?.length ? ` · +${a.added.join(' +')}` : ''}
      </div>
      {a?.quote && <blockquote className="testimony m-0 mt-2 text-[14.5px] leading-[1.45]">“{a.translation || a.quote}”<span className="num ml-2 text-[10px] uppercase tracking-[.08em] text-ink-3">{name}</span></blockquote>}
    </div>
  )
}

/* ------------------------------------------------------------------ thresholds */
function Limits({ cmp }: { cmp: Comparison }) {
  if (!cmp.thresholds.length) return null
  return (
    <>
      <Head id="thresholds" title="Thresholds" count={cmp.thresholds.length} />
      {cmp.thresholds.map((t) => {
        const vals = [t.a, t.b].filter((v): v is number => v != null)
        const lo = Math.min(...vals) * 0.9, hi = Math.max(...vals) * 1.1
        const pos = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100)
        const ends = ([['a', t.a, cmp.a, t.a_node], ['b', t.b, cmp.b, t.b_node]] as const)
          .filter((e): e is readonly [Side, number, string, CompareNode | null] => e[1] != null)
          .sort((x, y) => x[1] - y[1])
        return (
          <article key={t.param} className="ink-in border-b border-rule py-6">
            <div className="num flex flex-wrap items-baseline gap-x-3 text-[13px] text-ink-1">
              <span className="text-query">~</span><span>{(t.a_node ?? t.b_node)?.title ?? t.param}</span><span className="text-[11px] text-ink-3">{t.param}</span>
            </div>
            <div className="num mt-4 flex items-center gap-3 text-[13px]">
              {ends.length === 1 && <span className={`whitespace-nowrap ${SIDE[ends[0][0] === 'a' ? 'b' : 'a'].ink}`}>{ends[0][0] === 'a' ? cmp.b : cmp.a} draws no line</span>}
              {ends.length > 1 && <span className={`whitespace-nowrap ${SIDE[ends[0][0]].ink}`}>{ends[0][2]} {num(ends[0][1])}</span>}
              <div className="relative h-[16px] min-w-0 flex-1" aria-hidden>
                <div className="rule-draw absolute left-0 right-0 top-[8px] h-px bg-rule-strong" />
                {ends.map(([k, v]) => <div key={k} className={`absolute top-[3px] h-[11px] w-[2px] -translate-x-1/2 ${k === 'a' ? 'bg-ink-1' : 'bg-inferred'}`} style={{ left: `${pos(v)}%` }} />)}
              </div>
              <span className={`whitespace-nowrap ${SIDE[ends[ends.length - 1][0]].ink}`}>{num(ends[ends.length - 1][1])} {ends[ends.length - 1][2]}</span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-y-4 md:grid-cols-2 md:gap-x-8">
              {ends.map(([k, , who, node]) => {
                const quote = node && quoteOf(node)
                return quote ? (
                  <div key={k} className={`border-l pl-3 ${SIDE[k].rule}`}>
                    <div className={`num mb-1 text-[10px] uppercase tracking-[.08em] ${SIDE[k].ink}`}>{who}</div>
                    <Testimony quote={quote} size="sm" />
                  </div>
                ) : null
              })}
            </div>
          </article>
        )
      })}
    </>
  )
}

/* ------------------------------------------------------------------ rules only one has */
function OnlyOne({ cmp }: { cmp: Comparison }) {
  const rows = [
    ...cmp.unique.b.map((n) => ({ n, mark: '+', label: `${cmp.b} only` })),
    ...cmp.unique.a.map((n) => ({ n, mark: '−', label: `not in ${cmp.b}` })),
  ]
  if (!rows.length) return null
  return (
    <>
      <Head id="rules" title="Rules only one has" count={rows.length} />
      {rows.map(({ n, mark, label }) => {
        const guard = n.kind === 'guardrail'
        const quote = quoteOf(n)
        return (
          <div key={n.id + mark} className="ink-in grid grid-cols-[1.4rem_minmax(0,1fr)] gap-x-2 border-b border-rule py-4 md:grid-cols-[1.4rem_9rem_minmax(0,1fr)] md:gap-x-4">
            <span className="num text-[16px] leading-snug text-ink-1">{mark}</span>
            <span className="num text-[11.5px] leading-[1.9] text-ink-2">{label}</span>
            <div className="col-start-2 min-w-0 md:col-start-3">
              <div className={guard ? 'border-l-[3px] border-binding bg-sheet py-2 pl-3 pr-2' : ''}>
                <div className="flex items-baseline gap-2 text-[14px] leading-snug text-ink-1">
                  <Mark state={guard ? 'binding' : n.origin === 'doc' ? 'written' : 'observed'} /><span>{n.title}</span>
                </div>
                {guard && n.ask && <div className="num mt-1 text-[10.5px] uppercase tracking-[.08em] text-binding">{n.guardrail_type?.replaceAll('_', ' ')} · {n.ask}</div>}
                {quote && <div className="mt-2"><Testimony quote={quote} size="sm" /></div>}
              </div>
            </div>
          </div>
        )
      })}
    </>
  )
}

/* ------------------------------------------------------------------ same */
function Same({ cmp }: { cmp: Comparison }) {
  return (
    <>
      <div id="same" className="mt-14 scroll-mt-6" />
      <details className="group border-t border-rule-strong">
        <summary className="num flex cursor-pointer list-none items-baseline gap-2 py-3 text-[13px] text-ink-2 hover:text-ink-1 [&::-webkit-details-marker]:hidden">
          <span>{cmp.agree} of {cmp.n_comparisons} decisions decided the same</span>
          <span className="text-ink-3 group-open:hidden">▸</span><span className="hidden text-ink-3 group-open:inline">▾</span>
        </summary>
        <div className="pb-2">
          {cmp.shared_written > 0 && <p className="num m-0 pb-3 text-[11.5px] text-ink-3">Both start from the same {cmp.shared_written} clauses of the written process.</p>}
          {cmp.shared.length > 0 ? (
            <ul className="m-0 list-none divide-y divide-rule border-t border-rule p-0">
              {cmp.shared.map((s) => (
                <li key={s.title} className="flex items-baseline gap-2 py-2.5 text-[14px] text-ink-1">
                  <Mark state="confirmed" /><span>{s.title}</span>
                  <span className="num ml-auto text-[10.5px] text-ink-3">both</span>
                </li>
              ))}
            </ul>
          ) : <p className="num m-0 text-[12px] text-ink-3">No learned rule is shared yet.</p>}
        </div>
      </details>
    </>
  )
}

function Earlier({ cmp }: { cmp: Comparison }) {
  if (!cmp.earlier.length) return null
  return (
    <>
      <Head id="earlier" title="Asked earlier" count={cmp.earlier.length} />
      <p className="mb-0 mt-3 max-w-[64ch] text-[13.5px] leading-relaxed text-ink-2">Questions Mira put to these experts about differences that have since changed or closed.</p>
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
