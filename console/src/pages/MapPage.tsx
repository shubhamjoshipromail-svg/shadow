import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Shield } from 'lucide-react'
import { API, api, mmss } from '../lib/api'
import type { MapNode, Snapshot } from '../lib/types'
import { BeliefBadge, Btn } from '../components/ui'
import { nodeTitle } from '../components/WorkMapView'

/** The deliverable: a clickable timeline where every step shows the screen moment, decision, reason and guardrails. */
export default function MapPage() {
  const { sid } = useParams()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => { api<Snapshot>(`/api/sessions/${sid}`).then(setSnap) }, [sid])
  if (!snap) return <div className="p-10 text-muted">Loading…</div>
  const wm = snap.map
  const nodes = new Map([...wm.rules, ...wm.guardrails].map((n) => [n.id, n]))
  const steps = [...wm.steps].sort((a, b) => a.order - b.order)
  const learnedAll = [...wm.rules, ...wm.guardrails].filter((n) => n.origin !== 'doc')
  const judgment = learnedAll.filter((n) => !n.type).length
  const guards = learnedAll.filter((n) => n.type).length
  const selected = sel ? nodes.get(sel) : null

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Link to={`/s/${sid}`} className="text-muted hover:text-text"><ArrowLeft size={18} /></Link>
        <div>
          <div className="label">Work Map · v{wm.version}</div>
          <h1 className="font-serif text-4xl">How {wm.expert} processes a supplier invoice</h1>
        </div>
        <div className="ml-auto flex gap-2">
          <a href={`${API}/api/sessions/${sid}/export/md`} target="_blank"><Btn><Download size={14} />SOP</Btn></a>
          <a href={`${API}/api/sessions/${sid}/export/skill`} target="_blank"><Btn><Download size={14} />Agent skill</Btn></a>
          <a href={`${API}/api/sessions/${sid}/export/json`} target="_blank"><Btn tone="ghost">JSON</Btn></a>
        </div>
      </div>
      <div className="num mt-3 text-sm text-muted">{steps.length} steps · {judgment} judgment calls · {guards} guardrails · each linked to its screen moment and {wm.expert}’s own words</div>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)_380px] gap-6">
        <ol className="space-y-3">
          {steps.map((s) => {
            const ns = [...s.rule_ids, ...s.guardrail_ids].map((id) => nodes.get(id)).filter(Boolean) as MapNode[]
            const learned = ns.filter((n) => n.origin !== 'doc' && n.belief.status !== 'contested')
            const doc = ns.filter((n) => n.origin === 'doc')
            return (
              <li key={s.id} className="panel p-5">
                <div className="flex items-baseline justify-between">
                  <div className="text-[15px] font-semibold">Step {s.order} of {steps.length}: {s.name}</div>
                  <div className="num text-xs text-predict">{s.screen_moment?.ts != null ? `screen moment ${mmss(s.screen_moment.ts)}${s.screen_moment.entity ? ` · ${s.screen_moment.entity}` : ''}` : ''}</div>
                </div>
                {learned.length === 0 && <div className="mt-2 text-sm text-doc">As documented: {doc.map((d) => d.title.replace('Doc: ', '')).join(' · ') || s.description}</div>}
                <div className="mt-3 grid gap-2">
                  {learned.map((n) => (
                    <button key={n.id} onClick={() => setSel(n.id)} className={`rounded-xl border p-3 text-left transition ${sel === n.id ? 'border-learn bg-learn/5' : 'border-line bg-panel-2 hover:border-line-2'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2 text-[13.5px] font-medium">
                          {n.type ? <Shield size={14} className="mt-0.5 text-ask" /> : <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-learn" />}
                          <span><span className="text-faint">{n.type ? 'Guardrail' : 'Decision'} · </span>{nodeTitle(n, wm.params)}</span>
                        </div>
                        <BeliefBadge status={n.belief.status} p={n.belief.p} />
                      </div>
                      {n.quote && <div className="mt-2 font-serif text-[16px] italic text-muted">Reason: “{n.quote.translation ?? n.quote.text}” <span className="num text-[11px] not-italic text-faint">— {n.quote.speaker}, {snap.inquiries.find((q) => q.id === n.quote?.inquiry_id)?.phase === 'debrief' ? 'debrief' : 'live question'} at {mmss(n.quote.ts)}</span></div>}
                    </button>
                  ))}
                </div>
              </li>
            )
          })}
        </ol>
        <aside className="panel sticky top-6 h-fit p-5">
          {selected ? (
            <>
              <div className="label">{selected.type ? 'Guardrail' : 'Judgment rule'} {selected.id}</div>
              <div className="mt-2 text-lg font-semibold">{nodeTitle(selected, wm.params)}</div>
              <div className="num mt-3 rounded-lg bg-ink p-3 text-[11.5px] text-learn">if {selected.when}<br />→ {selected.then ? JSON.stringify(selected.then) : selected.action}</div>
              {selected.quote && (
                <div className="mt-4">
                  <div className="label">In {wm.expert}’s words</div>
                  <div className="mt-1 font-serif text-xl italic">“{selected.quote.translation ?? selected.quote.text}”</div>
                  {selected.quote.translation && <div className="mt-1 text-xs italic text-faint">original ({selected.quote.lang}): “{selected.quote.text}”</div>}
                </div>
              )}
              <div className="mt-4">
                <div className="label">Evidence (behavior, not just words)</div>
                <div className="mt-2 space-y-1">
                  {selected.evidence.map((e, i) => (
                    <div key={i} className="num flex justify-between text-[11.5px]">
                      <span className="text-muted">{e.kind} · {e.episode_id}</span>
                      <span className={e.agrees ? 'text-learn' : 'text-gap'}>{e.agrees ? 'agrees' : 'contradicts'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted">Select a decision or guardrail to see its rule, the expert’s words and the behavioral evidence behind it.</div>
          )}
        </aside>
      </div>
    </div>
  )
}
