import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, useShadow } from '../lib/api'
import type { Proof, Snapshot } from '../lib/types'
import { Btn, Mark, Section, Wordmark, fieldLabel, valueLabel } from '../components/ui'
import Receipts from '../components/Receipts'
import Threshold from '../components/Threshold'

const eur = (v: number | undefined) => (v == null ? '—' : v.toLocaleString('de-DE', { maximumFractionDigits: 0 }))
const groups = (h: string) => h.match(/.{1,4}/g)?.join(' ') ?? h

/** The evaluator's page: pick a threshold, let the expert teach it, then test Shadow on sealed, unseen cases. */
export default function ProofPage() {
  const { sid } = useParams()
  const nav = useNavigate()
  const { live } = useShadow(sid)
  const snap = live.snap
  const [param, setParam] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<{ proofs: (Proof & { session: string })[] } | null>(null)

  useEffect(() => {
    if (snap?.expert) api(`/api/history?expert=${encodeURIComponent(snap.expert)}&pack=${snap.pack.id}`).then(setHistory).catch(() => {})
  }, [snap?.expert, snap?.pack.id, Object.keys(snap?.proofs ?? {}).length])

  const proofs = useMemo(() => Object.values(snap?.proofs ?? {}).sort((a, b) => b.round - a.round), [snap?.proofs])
  if (!snap) return <div className="p-10 text-[13px] text-ink-2">Connecting…</div>
  const params = Object.keys(snap.posteriors)

  const freeze = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/sessions/${sid}/proofs`, { method: 'POST', body: JSON.stringify({ param: param || params[0] || null }) })
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }
  const restart = async () => {
    setError(null)
    try {
      const s = await api<Snapshot>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'capture', fresh: false, expert: snap.expert }) })
      nav(`/s/${s.id}/proof`)
    } catch (e) {
      setError(String(e))
    }
  }
  const earlier = (history?.proofs ?? []).filter((p) => p.session !== sid)

  return (
    <div className="min-h-full bg-paper">
      <header className="flex items-center gap-4 border-b border-rule-strong bg-sheet px-6 py-2.5">
        <Link to={`/s/${sid}`} className="text-[12px] text-ink-2 hover:text-ink-1">← session</Link>
        <Wordmark />
        <div className="num text-[10.5px] text-ink-3">
          {snap.simulated ? 'rehearsal session · tests disabled' : 'live session'} · map v{snap.map.version} from {snap.map_source.kind}
          {snap.map_source.session ? ` (${snap.map_source.session}, v${snap.map_source.version})` : ''}
          {snap.pending.compiling && <span className="text-query"> · compiling the last answer…</span>}
        </div>
        <div className="ml-auto"><Btn tone="ghost" onClick={restart} title="New session that starts from the last saved Work Map">Restart from saved map</Btn></div>
      </header>

      <div className="mx-auto max-w-[1180px] px-6 py-12">
        <div className="grid grid-cols-[1fr_340px] items-end gap-12 border-b border-rule pb-10">
          <div>
            <div className="label">Sealed boundary test</div>
            <h1 className="testimony mb-0 mt-3 text-[44px] leading-[1.05] tracking-[-0.015em]">Did Shadow learn what {snap.expert} taught?</h1>
          </div>
          <ol className="m-0 list-none space-y-1.5 p-0 text-[12.5px] leading-relaxed text-ink-2">
            <li><span className="num text-ink-3">1 </span>Pick any threshold; {snap.expert} teaches it live.</li>
            <li><span className="num text-ink-3">2 </span>Shadow writes invoices it has never seen and commits to its answers with a hash.</li>
            <li><span className="num text-ink-3">3 </span>You label each one here or in the ERP. Answers stay sealed until labelled.</li>
            <li><span className="num text-ink-3">4 </span>Each miss teaches. The next round tests the correction on new invoices.</li>
          </ol>
        </div>

        <div className="mt-10 grid grid-cols-[minmax(0,1fr)_340px] gap-12">
          <div className="space-y-10">
            <Section title="Freeze a test" right={
              <div className="flex items-center gap-2">
                {params.length > 1 && (
                  <select value={param} onChange={(e) => setParam(e.target.value)} className="num rounded-[3px] border border-rule-strong bg-sheet px-2 py-1 text-[11.5px]">
                    {params.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                <Btn tone="primary" disabled={busy || snap.simulated} onClick={freeze}>{params.length ? 'Freeze a sealed test' : 'Freeze a discovery spread'}</Btn>
              </div>
            }>
              {params.length === 0 ? (
                <p className="m-0 text-[13px] text-ink-2">No threshold learned yet. A discovery spread covers the whole supported range, so even a threshold above every demo invoice shows up as a surprise Shadow will ask about.</p>
              ) : (
                <div className="space-y-4">{params.map((p) => <Threshold key={p} p={snap.posteriors[p]} />)}</div>
              )}
              {error && <div className="mt-2 text-[12px] text-binding">{error}</div>}
            </Section>

            {proofs.map((p) => <ProofSheet key={p.id} p={p} snap={snap} sid={sid!} />)}
          </div>

          <aside className="space-y-10">
            <Section title="Learning receipts" flush><Receipts snap={snap} limit={8} /></Section>
            {earlier.length > 0 && (
              <Section title="Earlier sessions" flush>
                <div className="divide-y divide-rule">
                  {earlier.slice().reverse().map((p) => (
                    <div key={`${p.session}:${p.id}`} className="num flex justify-between py-1.5 text-[11px] text-ink-2">
                      <span>{p.session} · {p.id} · map v{p.map_version}</span>
                      <span className="text-ink-1">{p.summary.labeled}/{p.summary.n} · {p.summary.accuracy == null ? '—' : `${Math.round(p.summary.accuracy * 100)}%`}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function ProofSheet({ p, snap, sid }: { p: Proof; snap: Snapshot; sid: string }) {
  const options = p.field === 'action' ? snap.pack.actions : snap.pack.fields.find((f) => f.name === p.field)?.options ?? []
  const label = (case_id: string, value: string) =>
    api(`/api/sessions/${sid}/proofs/${p.id}/label`, { method: 'POST', body: JSON.stringify({ case_id, value }) })
  const sm = p.summary
  return (
    <section className="panel">
      <header className="border-b border-rule px-5 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <div className="label">Test {p.id} · {fieldLabel(snap, p.field)}</div>
            <div className="testimony mt-1 text-[22px]">
              {p.mode === 'threshold' ? <>Threshold {eur(p.learned.value ?? undefined)} on {p.learned.quantity.replace('inv.', '')}</> : 'Discovery spread across the supported range'}
            </div>
            {p.rule_title && <div className="mt-1 text-[12px] text-ink-2">under {p.rule}: {p.rule_title}</div>}
          </div>
          <div className="num text-right">
            <div className="text-[26px] text-ink-1">{sm.accuracy == null ? '—' : `${Math.round(sm.accuracy * 100)}%`}</div>
            <div className="text-[10.5px] text-ink-3">{sm.labeled}/{sm.n} labelled · {sm.agree} agree</div>
          </div>
        </div>
        <div className="num mt-4 border-l-[3px] border-ink-1 pl-3 text-[11px] leading-relaxed">
          <div className="text-ink-3">sha-256 commitment, published before any label · frozen at map v{p.map_version} (fp {p.map_fp}) · {p.provenance}</div>
          <div className="break-all text-ink-1">{groups(p.commitment)}</div>
        </div>
      </header>
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="num text-left text-[10px] uppercase tracking-[.06em] text-ink-3">
            <th className="border-b border-rule px-5 py-2 font-normal">Unseen invoice</th>
            <th className="border-b border-rule py-2 pr-4 text-right font-normal">net / gross €</th>
            <th className="border-b border-rule py-2 pr-4 font-normal">Your answer</th>
            <th className="border-b border-rule py-2 pr-4 font-normal">Shadow, frozen</th>
            <th className="w-8 border-b border-rule py-2 pr-5 font-normal" />
          </tr>
        </thead>
        <tbody>
          {p.items.map((i) => (
            <tr key={i.case_id} className="align-top">
              <td className="border-b border-rule px-5 py-2.5">
                <div className="num text-[10px] text-ink-3">{i.case_id}{i.bucket ? ` · ${i.bucket}` : ''}</div>
                <div className="text-ink-1">{i.describe}</div>
              </td>
              <td className="num border-b border-rule py-2.5 pr-4 text-right text-ink-2">{eur(i.quantities.net)} / {eur(i.quantities.gross)}</td>
              <td className="border-b border-rule py-2.5 pr-4">
                {i.label ? <span className="num text-ink-1" title={valueLabel(snap, p.field, i.label)}><Mark state="observed" />{i.label}</span> : (
                  <div className="flex flex-wrap gap-1">
                    {options.map((o) => (
                      <button key={o} onClick={() => label(i.case_id, o)} className="num rounded-[3px] border border-rule-strong px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-ink-1 hover:text-ink-1">{o}</button>
                    ))}
                  </div>
                )}
              </td>
              <td className="border-b border-rule py-2.5 pr-4">
                {i.sealed ? <span className="num text-[11px] text-ink-3">◌ sealed</span> : <span className="num text-inferred" title={valueLabel(snap, p.field, i.predicted ?? null)}>◌ {i.predicted ?? '—'}</span>}
              </td>
              <td className="num border-b border-rule py-2.5 pr-5 text-[14px]">{i.agrees == null ? null : i.agrees ? <span className="text-confirmed">✓</span> : <span className="text-binding">✗</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(Object.keys(sm.by_bucket).length > 0 || p.sealed_body) && (
        <footer className="px-5 py-3">
          <div className="num flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {Object.entries(sm.by_bucket).map(([b, v]) => (
              <span key={b} className={v.agree === v.n ? 'text-confirmed' : 'text-binding'}>{b} {v.agree}/{v.n}</span>
            ))}
          </div>
          {p.sealed_body && (
            <details className="mt-3 text-[11px] text-ink-2">
              <summary className="cursor-pointer">recompute the hash: sha-256 of this exact text</summary>
              <pre className="num mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all border border-rule bg-wash p-2 text-[10.5px]">{p.sealed_body}</pre>
            </details>
          )}
        </footer>
      )}
    </section>
  )
}
