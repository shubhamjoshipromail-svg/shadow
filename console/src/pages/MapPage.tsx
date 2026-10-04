import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API, api } from '../lib/api'
import type { MapNode, Snapshot } from '../lib/types'
import { BeliefBadge, Btn, Mark, Testimony, Wordmark, statusProv } from '../components/ui'
import { MomentButton, MomentPanel } from '../components/Moment'
import { nodeTitle, whenText } from '../components/WorkMapView'

const EVIDENCE_WORD: Record<string, string> = {
  live: 'later decision', retro: 'earlier case', counterfactual: 'what-if answer', teachback: 'teach-back',
  contradiction: 'contradiction', origin: 'the case she explained',
}

/** The deliverable: a document the expert could sign. Numbered clauses, her words, guardrails as stop plates, evidence at the foot. */
export default function MapPage() {
  const { sid } = useParams()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [openMoment, setOpenMoment] = useState<string | null>(null)
  useEffect(() => { api<Snapshot>(`/api/sessions/${sid}`).then(setSnap) }, [sid])
  useEffect(() => {
    if (!openMoment) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMoment(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openMoment])
  if (!snap) return <div className="p-10 text-[13px] text-ink-2">Opening the Work Map…</div>
  const wm = snap.map
  const nodes = new Map([...wm.rules, ...wm.guardrails].map((n) => [n.id, n]))
  const steps = [...wm.steps].sort((a, b) => a.order - b.order)
  const learnedAll = [...wm.rules, ...wm.guardrails].filter((n) => n.origin !== 'doc')
  const judgment = learnedAll.filter((n) => !n.type).length
  const guards = learnedAll.filter((n) => n.type).length
  const confirmed = learnedAll.filter((n) => n.belief.status === 'confirmed').length
  const selected = sel ? nodes.get(sel) : null

  return (
    <div className="min-h-full bg-paper">
      <header className="flex items-center gap-4 border-b border-rule-strong bg-sheet px-6 py-2.5">
        <Link to={`/s/${sid}`} className="text-[12px] text-ink-2 hover:text-ink-1">← session</Link>
        <Wordmark />
        <div className="ml-auto flex items-center gap-1.5">
          <Link to={`/s/${sid}/agent`} className="mr-2 text-[12px] text-ink-2 hover:text-ink-1">What may an agent do alone? →</Link>
          <Link to={`/w/${snap.pack.id}/compare?a=${encodeURIComponent(snap.expert)}`}><Btn tone="ghost">Compare experts</Btn></Link>
          <a href={`${API}/api/sessions/${sid}/export/md`} target="_blank"><Btn>SOP ↗</Btn></a>
          <a href={`${API}/api/sessions/${sid}/export/skill`} target="_blank"><Btn>Agent skill ↗</Btn></a>
          <a href={`${API}/api/sessions/${sid}/export/json`} target="_blank"><Btn tone="ghost">JSON ↗</Btn></a>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1180px] grid-cols-[minmax(0,700px)_1fr] gap-12 px-6 py-12">
        <article className="panel px-12 py-10">
          <div className="num flex justify-between border-b border-rule pb-3 text-[10.5px] text-ink-3">
            <span>WORK MAP · v{wm.version}</span><span>{wm.task.replace(/_/g, ' ')}</span>
          </div>
          <h1 className="testimony mb-0 mt-8 text-[40px] leading-[1.08] tracking-[-0.015em]">How {wm.expert} processes a supplier invoice</h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">
            <span className="text-ink-1">For the process owner.</span> Read it step by step, check it against how the work really runs, and sign it off. It is what Mira teaches new hires from.
          </p>
          <p className="mt-2 text-[13.5px] text-ink-2">
            {steps.length} steps · {judgment} judgment calls · {guards} guardrails · {confirmed} confirmed by her behavior.
            Each line links to the moment on screen and to her own words.
          </p>

          <ol className="m-0 mt-10 list-none space-y-9 p-0">
            {steps.map((s) => {
              const ns = [...s.rule_ids, ...s.guardrail_ids].map((id) => nodes.get(id)).filter(Boolean) as MapNode[]
              const learned = ns.filter((n) => n.origin !== 'doc' && n.belief.status !== 'contested')
              const doc = ns.filter((n) => n.origin === 'doc')
              const sm = s.screen_moment
              const momentKey = `step:${s.id}`
              return (
                <li key={s.id} className="grid grid-cols-[40px_1fr]">
                  <span className="num pt-1 text-[12px] text-ink-3">§{s.order}</span>
                  <div>
                    <div className="flex items-baseline justify-between gap-4">
                      <h2 className="m-0 text-[17px] font-medium">{s.name}</h2>
                      {sm && <MomentButton snap={snap} source={{ key: momentKey, moment: sm, step: s }}
                        open={openMoment === momentKey} onToggle={() => setOpenMoment(openMoment === momentKey ? null : momentKey)} showEntity />}
                    </div>
                    {openMoment === momentKey && sm && <MomentPanel snap={snap} source={{ key: momentKey, moment: sm, step: s }} />}
                    {learned.length === 0 && (
                      <p className="mb-0 mt-1.5 text-[13.5px] text-written">As written in the 2019 process: {doc.map((d) => d.title.replace('Doc: ', '')).join(' · ') || s.description}</p>
                    )}
                    <div className="mt-3 space-y-4">
                      {learned.map((n) => {
                        const nsm = n.screen_moment
                        const nodeKey = `node:${n.id}`
                        return (
                          <div key={n.id}
                            className={n.type ? `border border-l-[3px] border-l-binding px-4 py-3 ${sel === n.id ? 'border-ink-2' : 'border-rule'}` : `border-t pt-3 ${n.belief.status === 'confirmed' ? 'border-ink-1' : 'border-rule'} ${sel === n.id ? 'bg-wash' : ''}`}>
                            <div className="flex items-baseline justify-between gap-3">
                              <button type="button" onClick={() => setSel(n.id)}
                                className={`min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink-2 ${n.belief.status === 'inferred' ? 'italic text-inferred' : 'text-ink-1'}`}>
                                {n.type && <span className="mb-1 block text-[11px] font-medium uppercase tracking-[.08em] text-binding">■ {n.action === 'escalate' ? 'stop and ask' : n.action?.replace('_', ' ')}{n.ask ? ` · ${n.ask}` : ''}</span>}
                                {nodeTitle(n, wm.params)}
                              </button>
                              <span className="flex shrink-0 items-baseline gap-3">
                                {nsm && <MomentButton snap={snap} source={{ key: nodeKey, moment: nsm, node: n }}
                                  open={openMoment === nodeKey} onToggle={() => setOpenMoment(openMoment === nodeKey ? null : nodeKey)} />}
                                <BeliefBadge status={n.belief.status} guardrail={!!n.type} />
                              </span>
                            </div>
                            {n.quote && <div className="mt-2"><Testimony quote={n.quote} size="sm" /></div>}
                            {openMoment === nodeKey && nsm && <MomentPanel snap={snap} source={{ key: nodeKey, moment: nsm, node: n }} />}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>

          <div className="mt-14 border-t border-ink-1 pt-4">
            <div className="label">Signature</div>
            <div className="mt-6 grid grid-cols-2 gap-10 text-[11.5px] text-ink-3">
              <div className="border-t border-rule-strong pt-1.5">{wm.expert}, expert</div>
              <div className="border-t border-rule-strong pt-1.5">date</div>
            </div>
          </div>
        </article>

        <aside className="sticky top-6 h-fit">
          {selected ? (
            <div className="ink-in">
              <div className="label">{selected.type ? 'Guardrail' : 'Judgment rule'} {selected.id}</div>
              <div className="testimony mt-2 text-[22px] leading-snug">{nodeTitle(selected, wm.params)}</div>
              <div className="num mt-4 border-l border-rule-strong pl-3 text-[11px] leading-relaxed text-ink-1">{whenText(selected)}</div>
              {selected.quote && <div className="mt-6"><div className="label mb-2">In {wm.expert}’s words</div><Testimony quote={selected.quote} /></div>}
              <div className="mt-6">
                <div className="label border-b border-rule pb-2">Evidence · behavior, not just words</div>
                <div className="divide-y divide-rule">
                  {selected.evidence.length === 0 && <div className="py-2 text-[12px] text-ink-3">Stated, not yet tested.</div>}
                  {selected.evidence.map((e, i) => (
                    <div key={i} className="num flex justify-between py-1.5 text-[11px]">
                      <span className="text-ink-2">{EVIDENCE_WORD[e.kind] ?? e.kind} · {e.episode_id}</span>
                      <span className={e.agrees ? 'text-confirmed' : 'text-binding'}>{e.agrees ? '✓ agrees' : '✗ contradicts'}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="num mt-4 text-[10.5px] text-ink-3"><Mark state={statusProv(selected.belief.status, !!selected.type)} />{selected.belief.status} · belief {selected.belief.p.toFixed(2)} (a score, not a calibrated accuracy)</div>
            </div>
          ) : (
            <div className="border-l border-rule-strong pl-4 text-[13px] leading-relaxed text-ink-2">
              Select a clause or a guardrail to see the rule Mira runs, her words, and the behavior that confirmed or contradicted it.
              <div className="num mt-4 space-y-1 text-[11px] text-ink-3">
                <div><Mark state="observed" />stated by her</div>
                <div><Mark state="inferred" />inferred by Mira</div>
                <div><Mark state="confirmed" />confirmed by later behavior</div>
                <div><Mark state="binding" />guardrail: stops the work</div>
                <div><Mark state="written" />2019 written process</div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
