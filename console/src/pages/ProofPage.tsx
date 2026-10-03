import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Lock, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { api, useShadow } from '../lib/api'
import type { Proof, Snapshot } from '../lib/types'
import { Btn, Section, fieldLabel, valueLabel } from '../components/ui'
import Receipts from '../components/Receipts'
import Threshold from '../components/Threshold'

const eur = (v: number | undefined) => (v == null ? '—' : v.toLocaleString('de-DE', { maximumFractionDigits: 0 }))

/** The evaluator's view: pick a threshold, let the expert teach it, then test Shadow on sealed, unseen cases. */
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
  if (!snap) return <div className="p-10 text-muted">Connecting…</div>
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
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Link to={`/s/${sid}`} className="text-muted hover:text-text"><ArrowLeft size={18} /></Link>
        <div>
          <div className="label">Sealed boundary test · session {snap.id}</div>
          <h1 className="font-serif text-4xl">Did Shadow learn what {snap.expert} taught?</h1>
        </div>
        <div className="ml-auto"><Btn tone="ghost" onClick={restart} title="New session that starts from the last saved Work Map"><RotateCcw size={14} />Restart from saved map</Btn></div>
      </div>
      <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-muted">
        Pick any threshold and have {snap.expert} teach it live (say it, or just work invoices). Then freeze a test: Shadow generates
        invoices it has never seen around what it learned, commits to its predictions with a hash, and keeps them sealed. You label each
        case here (or work it in the ERP; the first decision counts). A wrong prediction is a counterexample: Shadow learns from it, and the
        next round tests the correction on new cases.
      </p>
      <div className="num mt-2 text-[11px] text-faint">
        {snap.simulated ? 'Rehearsal session: tests are disabled' : 'live session'} · map v{snap.map.version} from {snap.map_source.kind}
        {snap.map_source.session ? ` (session ${snap.map_source.session}, v${snap.map_source.version})` : ''}
        {snap.pending.compiling && ' · compiling the last answer…'}
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="space-y-4">
          <Section title="Freeze a test" right={
            <div className="flex items-center gap-2">
              {params.length > 1 && (
                <select value={param} onChange={(e) => setParam(e.target.value)} className="rounded-lg border border-line-2 bg-ink px-2 py-1 text-[12px]">
                  {params.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              <Btn tone="primary" disabled={busy || snap.simulated} onClick={freeze}><Lock size={13} />{params.length ? 'Freeze sealed test' : 'Freeze discovery spread'}</Btn>
            </div>
          }>
            {params.length === 0 ? (
              <div className="text-[12.5px] text-muted">No threshold learned yet. A discovery spread covers the whole supported range, so a threshold above every demo invoice still shows up as a gap Shadow will ask about.</div>
            ) : (
              params.map((p) => <Threshold key={p} p={snap.posteriors[p]} />)
            )}
            {error && <div className="mt-2 text-[12px] text-gap">{error}</div>}
          </Section>

          {proofs.map((p) => <ProofCard key={p.id} p={p} snap={snap} sid={sid!} />)}
        </div>

        <div className="space-y-4">
          <Section title="Learning receipts"><Receipts snap={snap} limit={8} /></Section>
          {earlier.length > 0 && (
            <Section title="Earlier sessions">
              <div className="space-y-1.5">
                {earlier.slice().reverse().map((p) => (
                  <div key={`${p.session}:${p.id}`} className="num flex justify-between text-[11.5px] text-muted">
                    <span>{p.session} · {p.id} · map v{p.map_version}</span>
                    <span>{p.summary.labeled}/{p.summary.n} labeled · {p.summary.accuracy == null ? '—' : `${Math.round(p.summary.accuracy * 100)}%`}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function ProofCard({ p, snap, sid }: { p: Proof; snap: Snapshot; sid: string }) {
  const options = p.field === 'action' ? snap.pack.actions : snap.pack.fields.find((f) => f.name === p.field)?.options ?? []
  const label = (case_id: string, value: string) =>
    api(`/api/sessions/${sid}/proofs/${p.id}/label`, { method: 'POST', body: JSON.stringify({ case_id, value }) })
  const sm = p.summary
  return (
    <Section title={`Test ${p.id} · ${p.mode === 'threshold' ? `${p.param} at ${eur(p.learned.value ?? undefined)} on ${p.learned.quantity}` : 'discovery spread'}`}
      right={<span className="num text-[11px] text-muted">{sm.labeled}/{sm.n} labeled{sm.accuracy != null && <> · <b className={sm.accuracy >= 0.9 ? 'text-learn' : 'text-ask'}>{Math.round(sm.accuracy * 100)}%</b> agree</>}</span>}>
      <div className="num mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-faint">
        <span className="flex items-center gap-1"><ShieldCheck size={12} className="text-learn" />sha256 {p.commitment.slice(0, 16)}…</span>
        <span>frozen at map v{p.map_version} (fp {p.map_fp})</span>
        <span>{p.provenance}</span>
        {p.rule_title && <span>rule {p.rule}: {p.rule_title}</span>}
        <span>{fieldLabel(snap, p.field)}</span>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-faint">
            <th className="pb-1.5 font-semibold">Unseen invoice</th><th className="pb-1.5 font-semibold">net / gross €</th>
            <th className="pb-1.5 font-semibold">Your answer</th><th className="pb-1.5 font-semibold">Shadow (frozen)</th><th />
          </tr>
        </thead>
        <tbody>
          {p.items.map((i) => (
            <tr key={i.case_id} className="border-t border-line align-middle">
              <td className="py-1.5 pr-2"><div className="num text-[10px] text-faint">{i.case_id}{i.bucket ? ` · ${i.bucket}` : ''}</div><div className="text-muted">{i.describe}</div></td>
              <td className="num py-1.5 pr-2 text-muted">{eur(i.quantities.net)} / {eur(i.quantities.gross)}</td>
              <td className="py-1.5 pr-2">
                {i.label ? <span className="text-text">{valueLabel(snap, p.field, i.label)}</span> : (
                  <div className="flex flex-wrap gap-1">
                    {options.map((o) => (
                      <button key={o} onClick={() => label(i.case_id, o)} className="num rounded border border-line-2 px-1.5 py-0.5 text-[11px] text-muted hover:border-learn hover:text-text">{o}</button>
                    ))}
                  </div>
                )}
              </td>
              <td className="py-1.5 pr-2">{i.sealed ? <span className="flex items-center gap-1 text-faint"><Lock size={11} />sealed</span> : <span className="num">{valueLabel(snap, p.field, i.predicted ?? null)}</span>}</td>
              <td className="py-1.5">{i.agrees == null ? null : i.agrees ? <Check size={14} className="text-learn" /> : <X size={14} className="text-gap" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {Object.keys(sm.by_bucket).length > 0 && (
        <div className="num mt-3 flex flex-wrap gap-2 text-[10.5px]">
          {Object.entries(sm.by_bucket).map(([b, v]) => (
            <span key={b} className={`rounded px-1.5 py-0.5 ${v.agree === v.n ? 'bg-learn/10 text-learn' : 'bg-gap/10 text-gap'}`}>{b} {v.agree}/{v.n}</span>
          ))}
        </div>
      )}
      {p.sealed_body && (
        <details className="mt-3 text-[10.5px] text-faint">
          <summary className="cursor-pointer">verify the commitment (sha256 of this text = {p.commitment})</summary>
          <pre className="num mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-ink p-2">{p.sealed_body}</pre>
        </details>
      )}
    </Section>
  )
}
