import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { Snapshot } from '../lib/types'
import { Btn, Wordmark } from '../components/ui'

type Level = 'act' | 'suggest' | 'stop'
interface CaseRec { case_id: string; bucket: string; describe: string; q: number | null; agent: string | null; mode: string; label: string | null; right: boolean | null }
interface Row {
  node: string; kind: 'rule' | 'guardrail' | 'default'; title: string; when: string | null; field: string; origin: string | null
  quote: { text: string; speaker: string; english: string } | null
  cases: number; tested: number; right: number; wrong: number; violations: number
  level: Level; effective: Level; reason: string; effective_reason: string; stale: boolean; detail: CaseRec[]
}
interface Cert {
  id: string; session: string; field: string; created_at: string; min_cases: number; provenance: string
  map_version: number; map_fp: string; closed_map_version: number | null; current_map_version: number | null; exam_open: boolean
  commitment: string; sealed_body: string
  agent: { id: string; model: string; kind: string; tools: string[]; withheld: string[]; tool_calls: string[]; failed_cases: number }
  labels: { source: 'fresh_sealed_exam' | 'reused_human_labels'; proofs: string[]; at_commit: number; weaker: boolean; note: string }
  result: { rows: Row[]; complete: boolean; totals: { cases: number; labelled: number; agent_right: number; agent_accuracy: number | null; mira_right: number; mira_of: number; by_level: Record<Level, number> } }
  items: { case_id: string; describe: string; bucket: string; labels: Record<string, { value: string; via: string }> }[]
}
interface CertSummary { id: string; created: number }

const groups = (h: string) => h.match(/.{1,4}/g)?.join(' ') ?? h
const GLYPH: Record<Level, { g: string; word: string; short: string; ink: string }> = {
  act: { g: '✓', word: 'Act alone', short: 'act alone', ink: 'text-confirmed' },
  suggest: { g: '◌', word: 'Suggest, human confirms', short: 'suggest', ink: 'text-inferred' },
  stop: { g: '■', word: 'Stop and ask', short: 'stop and ask', ink: 'text-binding' },
}
const ORDER: Record<Level, number> = { act: 0, suggest: 1, stop: 2 }

function Permission({ level, stale }: { level: Level; stale?: boolean }) {
  const p = GLYPH[level]
  return (
    <span className={`inline-flex items-baseline gap-1.5 text-[13px] font-medium ${p.ink}`}>
      <span aria-hidden className="num w-[1em] text-center">{p.g}</span>
      <span className={stale ? 'line-through decoration-1' : ''}>{p.word}</span>
    </span>
  )
}

/** "May the agent do this alone?" — one permission slip per rule, earned on the same sealed test Mira takes. */
export default function AgentPage() {
  const { sid } = useParams()
  const [cert, setCert] = useState<Cert | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await api<CertSummary[]>(`/api/sessions/${sid}/certifications`)
      setCert(list.length ? await api<Cert>(`/api/certifications/${list[0].id}`) : null)
    } catch (e) {
      setError(String(e))
    }
    setLoaded(true)
  }, [sid])
  useEffect(() => { api<Snapshot>(`/api/sessions/${sid}`).then(setSnap).catch(() => {}); load() }, [sid, load])
  useEffect(() => {
    if (!cert?.exam_open) return
    const t = setInterval(load, 4000)  // labels given on the proof page or in the ERP show up here
    return () => clearInterval(t)
  }, [cert?.exam_open, load])

  const hasLabels = Object.values(snap?.proofs ?? {}).some((p) => p.items.some((i) => i.label != null))
  const certify = async (fresh: boolean) => {
    setBusy(true)
    setError(null)
    try {
      setCert(await api<Cert>(`/api/sessions/${sid}/certify`, { method: 'POST', body: JSON.stringify({ fresh }) }))
    } catch (e) {
      setError(String(e).replace(/^Error: \d+ /, '').replace(/^\{"detail":"(.*)"\}$/, '$1'))
    }
    setBusy(false)
  }
  const label = async (case_id: string, field: string, value: string) => {
    try {
      setCert(await api<Cert>(`/api/certifications/${cert!.id}/label`, { method: 'POST', body: JSON.stringify({ case_id, field, value }) }))
    } catch (e) {
      setError(String(e))
    }
  }

  const rows = cert ? [...cert.result.rows].sort((a, b) => ORDER[a.effective] - ORDER[b.effective] || b.tested - a.tested) : []
  const tested = rows.filter((r) => r.tested > 0 || r.violations > 0)
  const untested = rows.filter((r) => !(r.tested > 0 || r.violations > 0))
  const t = cert?.result.totals
  const fieldOptions = snap?.pack.fields.find((f) => f.name === cert?.field)?.options ?? []
  const waiting = cert ? cert.items.filter((i) => !i.labels[cert.field]) : []

  return (
    <div className="min-h-full bg-paper">
      <header className="flex items-center gap-4 border-b border-rule-strong bg-sheet px-6 py-2.5">
        <Link to={`/s/${sid}`} className="text-[12px] text-ink-2 hover:text-ink-1">← session</Link>
        <Wordmark />
        <div className="num text-[10.5px] text-ink-3">agent permissions</div>
        <div className="ml-auto flex gap-3 text-[12px]">
          <Link to={`/s/${sid}/proof`} className="text-ink-2 hover:text-ink-1">Sealed tests</Link>
          <Link to={`/s/${sid}/map`} className="text-ink-2 hover:text-ink-1">Work Map</Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1040px] px-6 py-12">
        <div className="border-b border-rule pb-9">
          <div className="label">Agent permissions</div>
          <h1 className="testimony mb-0 mt-3 max-w-[760px] text-[44px] leading-[1.05] tracking-[-0.015em]">
            What may an agent do on its own?
          </h1>
          <p className="mb-0 mt-4 max-w-[640px] text-[14px] leading-relaxed text-ink-2">
            <span className="text-ink-1">For the process owner.</span> Before an AI agent touches this workflow, it takes the same sealed test Mira took, on fresh cases, with its answers locked before any label.
            Rules it got right earn <span className="text-confirmed"><span className="num">✓</span> act alone</span>; the rest stay with people (<span className="text-inferred"><span className="num">◌</span> suggest</span>, <span className="text-binding"><span className="num">■</span> stop and ask</span>).
            Use it to decide what to automate.
          </p>
        </div>

        {!loaded && <p className="mt-10 text-[13px] text-ink-2">Opening the permission slips…</p>}

        {loaded && !cert && (
          <div className="mt-10 max-w-[640px]">
            <p className="m-0 text-[14px] leading-relaxed text-ink-1">No agent has been certified on this map yet. Start with a sealed test below. Until one passes, every rule reads <span className="whitespace-nowrap text-binding"><span className="num">■</span> stop and ask</span>.</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {hasLabels && <Btn tone="primary" disabled={busy} onClick={() => certify(false)}>{busy ? 'The agent is reading the map…' : 'Certify using the labels already given'}</Btn>}
              <Btn tone={hasLabels ? 'default' : 'primary'} disabled={busy} onClick={() => certify(true)}>{busy && !hasLabels ? 'The agent is reading the map…' : 'Freeze a fresh sealed exam'}</Btn>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
              {hasLabels
                ? 'A human has already labelled cases in a sealed test. Reusing them is quick, and a weaker test: the map has since learned from those labels. A fresh exam commits the agent’s answers before any label exists.'
                : 'The agent’s answers are frozen and hashed first; then you label the cases here or on the sealed-test page. Live sessions only.'}
            </p>
            {error && <div className="mt-3 text-[12px] text-binding">{error}</div>}
          </div>
        )}

        {cert && t && (
          <>
            <dl className="num m-0 mt-8 grid grid-cols-[130px_1fr] gap-x-6 gap-y-2.5 border-b border-rule pb-8 text-[11.5px] leading-relaxed">
              <dt className="text-ink-3">AGENT</dt>
              <dd className="m-0 text-ink-1">{cert.agent.model} · {cert.agent.kind}. Read the map through <span>{cert.agent.tools.join(', ')}</span>; <span className="text-ink-3">{cert.agent.withheld.join(' and ')} withheld.</span></dd>
              <dt className="text-ink-3">MAP</dt>
              <dd className="m-0 text-ink-1">
                v{cert.map_version} when the agent read it
                {cert.closed_map_version != null ? <> · v{cert.closed_map_version} when the exam closed</> : <span className="text-query"> · exam still open</span>}
                {cert.current_map_version != null && cert.closed_map_version != null && cert.current_map_version !== cert.closed_map_version && <span className="text-binding"> · v{cert.current_map_version} now</span>}
              </dd>
              <dt className="text-ink-3">COMMITMENT</dt>
              <dd className="m-0 break-all border-l-[3px] border-ink-1 pl-3 text-ink-1">
                {groups(cert.commitment)}
                <div className="text-ink-3">sha-256 of the agent’s answers, {cert.labels.source === 'fresh_sealed_exam' ? 'published before any label existed' : 'computed when the exam was set; labels already existed, the agent saw none'}</div>
              </dd>
              <dt className="text-ink-3">LABELS</dt>
              <dd className="m-0 text-ink-1">
                {cert.labels.source === 'fresh_sealed_exam' ? 'Fresh sealed exam' : 'Reused human labels'} · {cert.labels.proofs.join(', ')} · human labels only · {cert.provenance}
                <div className={cert.labels.weaker ? 'text-query' : 'text-ink-3'}>{cert.labels.weaker ? '◌ ' : ''}{cert.labels.note}</div>
              </dd>
              <dt className="text-ink-3">RESULT</dt>
              <dd className="m-0 text-ink-1">
                {t.labelled}/{t.cases} cases labelled{t.labelled > 0 && <> · agent {t.agent_right}/{t.labelled} right on {cert.field.replace(/_/g, ' ')}</>}
                {t.mira_of > 0 && <span className="text-ink-3"> · Mira {t.mira_right}/{t.mira_of} on the same cases</span>}
                <div className="text-ink-3">{t.by_level.act} act alone · {t.by_level.suggest} suggest · {t.by_level.stop} stop and ask</div>
              </dd>
            </dl>

            {waiting.length > 0 && snap && (
              <section className="mt-10">
                <div className="flex items-baseline justify-between border-b border-rule pb-2">
                  <div className="label">Exam open · {waiting.length} cases need your answer</div>
                  <Link to={`/s/${sid}/proof`} className="text-[12px] text-ink-2 hover:text-ink-1">or label them on the sealed-test page →</Link>
                </div>
                <div className="divide-y divide-rule">
                  {waiting.slice(0, 6).map((i) => (
                    <div key={i.case_id} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <div className="num text-[10px] text-ink-3">{i.case_id} · {i.bucket}</div>
                        <div className="truncate text-[12.5px] text-ink-1">{i.describe}</div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {fieldOptions.map((o) => (
                          <button key={o} onClick={() => label(i.case_id, cert.field, o)} className="num rounded-[3px] border border-rule-strong px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-ink-1 hover:text-ink-1">{o}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {waiting.length > 6 && <div className="num mt-1 text-[11px] text-ink-3">+ {waiting.length - 6} more</div>}
              </section>
            )}

            <section className="mt-12">
              <div className="flex items-baseline justify-between border-b border-rule-strong pb-2">
                <div className="label">Permission slips · one per rule</div>
                <div className="num text-[10.5px] text-ink-3">{cert.min_cases} labelled cases and no misses to act alone</div>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="num text-left text-[10px] uppercase tracking-[.06em] text-ink-3">
                    <th className="border-b border-rule py-2 pr-4 font-normal">Rule and the expert’s words</th>
                    <th className="w-[64px] border-b border-rule py-2 pr-3 text-right font-normal">Tested</th>
                    <th className="w-[78px] border-b border-rule py-2 pr-4 text-right font-normal">Right/wrong</th>
                    <th className="w-[290px] border-b border-rule py-2 font-normal">Permission</th>
                  </tr>
                </thead>
                <tbody>
                  {tested.map((r) => <Slip key={r.node} r={r} cert={cert} snap={snap} onLabel={label} />)}
                </tbody>
              </table>
              {tested.length === 0 && <p className="m-0 border-b border-rule py-6 text-[13px] text-ink-2">No human label has reached a rule yet, so every rule is still <span className="text-binding"><span className="num">■</span> stop and ask</span>.</p>}

              {untested.length > 0 && (
                <details className="border-b border-rule">
                  <summary className="num cursor-pointer py-3 text-[11px] text-ink-2">
                    <span className="text-binding">■</span> {untested.length} untested · stop and ask
                  </summary>
                  <table className="w-full border-collapse">
                    <tbody>
                      {untested.map((r) => (
                        <tr key={r.node} className="align-baseline">
                          <td className="num w-[40px] border-t border-rule py-2 pr-2 text-[11px] text-ink-2">{r.node === '—' ? '—' : r.node}</td>
                          <td className="border-t border-rule py-2 pr-4 text-[12.5px] text-ink-2">{r.title}</td>
                          <td className="border-t border-rule py-2 text-right text-[11.5px] text-ink-3">{r.effective_reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </section>

            <section className="mt-12 grid grid-cols-[1fr_1fr] gap-12 text-[12.5px] leading-relaxed text-ink-2">
              <div>
                <div className="label mb-2">How a slip is earned</div>
                <p className="m-0"><span className="text-confirmed"><span className="num">✓</span> Act alone</span>: at least {cert.min_cases} labelled cases decided by the rule, every one right, and the agent never asked for help on them. A guardrail needs the same, with no case where the agent did less than it demands.</p>
                <p className="mb-0 mt-2"><span className="text-inferred"><span className="num">◌</span> Suggest</span>: some misses, or too few cases. The agent drafts, a person confirms.</p>
                <p className="mb-0 mt-2"><span className="text-binding"><span className="num">■</span> Stop and ask</span>: untested, a guardrail miss, or the agent itself chose to stop. A changed rule goes back here until it is re-certified.</p>
              </div>
              <div>
                <div className="label mb-2">Ask before acting</div>
                <p className="m-0">Any agent can ask the Work Map server <span className="num text-ink-1">get_permissions(case_facts)</span> and get act, suggest or stop, with the rule and the expert’s own words.</p>
                {cert.sealed_body && (
                  <details className="mt-3 text-[11.5px]">
                    <summary className="cursor-pointer">recompute the hash: sha-256 of this exact text</summary>
                    <pre className="num mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all border border-rule bg-wash p-2 text-[10.5px]">{cert.sealed_body}</pre>
                  </details>
                )}
              </div>
            </section>
          </>
        )}
        {cert && error && <div className="mt-4 text-[12px] text-binding">{error}</div>}
      </div>
    </div>
  )
}

function Slip({ r, cert, snap, onLabel }: { r: Row; cert: Cert; snap: Snapshot | null; onLabel: (c: string, f: string, v: string) => void }) {
  const [open, setOpen] = useState(false)
  const actions = snap?.pack.actions ?? []
  return (
    <>
      <tr className="align-top">
        <td className="border-b border-rule py-4 pr-4">
          <div className="flex items-baseline gap-2.5">
            <span className="num w-[44px] shrink-0 text-[11px] text-ink-3">{r.kind === 'guardrail' ? <span className="text-binding">■ </span> : null}{r.node}</span>
            <span className="text-[14px] font-medium leading-snug text-ink-1">{r.title}</span>
          </div>
          {r.quote && (
            <blockquote className="testimony m-0 mt-1.5 pl-[54px] text-[15.5px] italic leading-[1.4] text-ink-1">
              “{r.quote.english}” <span className="num text-[10px] not-italic uppercase tracking-[.08em] text-ink-3">{r.quote.speaker}</span>
            </blockquote>
          )}
          {!r.quote && r.origin === 'doc' && <div className="mt-1 pl-[54px] text-[12px] text-written"><span className="num">§</span> from the 2019 written process, not the expert’s words</div>}
          <button onClick={() => setOpen(!open)} className="num mt-2 pl-[54px] text-[10.5px] text-ink-3 hover:text-ink-1">{open ? '− hide' : '+ show'} the {r.cases} case{r.cases === 1 ? '' : 's'}</button>
        </td>
        <td className="num border-b border-rule py-4 pr-3 text-right text-[13px] text-ink-1">{r.tested}</td>
        <td className="num border-b border-rule py-4 pr-4 text-right text-[13px] text-ink-1">{r.right}<span className="text-ink-3"> / </span><span className={r.wrong ? 'text-binding' : ''}>{r.wrong}</span></td>
        <td className="border-b border-rule py-4">
          <Permission level={r.effective} stale={r.stale} />
          <div className="mt-1 text-[12.5px] leading-snug text-ink-2">{r.effective_reason}</div>
          {r.stale && <div className="num mt-1 text-[10.5px] text-binding">stale: the map changed after this exam</div>}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="border-b border-rule bg-wash px-3 py-3">
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {r.detail.map((c) => (
                  <tr key={c.case_id} className="align-baseline">
                    <td className="num w-[92px] py-1 pr-2 text-[10.5px] text-ink-3">{c.case_id}</td>
                    <td className="py-1 pr-3 text-ink-1">{c.describe}</td>
                    <td className="num py-1 pr-3 text-[11px] text-ink-2">agent {c.agent ?? '—'} <span className="text-ink-3">({c.mode.replace(/_/g, ' ')})</span></td>
                    <td className="num py-1 text-right text-[11px]">
                      {c.label != null
                        ? <span className={c.right ? 'text-confirmed' : 'text-binding'}>{c.right ? '✓' : '✗'} human {c.label}</span>
                        : r.kind === 'guardrail' && snap
                          ? <span className="inline-flex flex-wrap justify-end gap-1">{actions.map((a) => (
                              <button key={a} onClick={() => onLabel(c.case_id, 'action', a)} className="rounded-[3px] border border-rule-strong px-1.5 py-0.5 text-[10.5px] text-ink-2 hover:border-ink-1 hover:text-ink-1">{a}</button>))}</span>
                          : <span className="text-ink-3">not labelled</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.kind === 'guardrail' && <div className="mt-2 text-[11px] text-ink-3">For a guardrail the human labels the action the case should get.</div>}
            {cert.field && r.kind !== 'guardrail' && <div className="mt-2 text-[11px] text-ink-3">Scored on {cert.field.replace(/_/g, ' ')}, the field the human labelled.</div>}
          </td>
        </tr>
      )}
    </>
  )
}
