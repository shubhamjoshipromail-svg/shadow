import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Mark, Wordmark } from '../components/ui'
import Mira from '../components/Mira'
import { AGENTS } from '../lib/voice'

type ExpertMap = { expert: string; version: number; session_id: string; created: number; rules?: number; guardrails?: number }

export default function Home() {
  const nav = useNavigate()
  const [health, setHealth] = useState<{ ok: boolean; llm: boolean; spend?: { usd: number; calls: number } } | null>(null)
  const [rehearsal, setRehearsal] = useState(false)
  const [check, setCheck] = useState<Record<string, { ok: boolean; why?: string; model?: string }> | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<{ id: string; mode: string; expert: string; metrics: any }[]>([])
  const [interviewer, setInterviewer] = useState(AGENTS.interviewer())
  const [tutor, setTutor] = useState(AGENTS.tutor())
  const [learnerName, setLearnerName] = useState('Lena')
  const [teachLang, setTeachLang] = useState('en')
  const [experts, setExperts] = useState<ExpertMap[]>([])
  const [expertPick, setExpertPick] = useState('__new__')
  const [newName, setNewName] = useState('')
  const [teachFrom, setTeachFrom] = useState('')
  const [busy, setBusy] = useState<'capture' | 'tutor' | null>(null)
  const [workflows, setWorkflows] = useState<{ id: string; name: string; kind: string; version: number; experts: string[]; learners: string[]; sessions: number; compare_experts?: { expert: string; simulated: boolean }[] }[]>([])
  const [wfState, setWfState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [workflow, setWorkflow] = useState('ap_invoices')

  useEffect(() => {
    api('/api/workflows')
      .then((w) => { setWorkflows(w); setWfState('ready') })
      .catch(() => setWfState('error'))
  }, [])

  useEffect(() => {
    api<ExpertMap[]>(`/api/workflows/${workflow}/experts?simulated=false`)
      .then((e) => {
        setExperts(e)
        const richest = e.slice().sort((a, b) => ((b.rules ?? 0) + (b.guardrails ?? 0)) - ((a.rules ?? 0) + (a.guardrails ?? 0)) || b.created - a.created)[0]
        setTeachFrom(richest?.expert ?? '')
        setExpertPick('__new__')
      })
      .catch(() => { setExperts([]); setTeachFrom('') })
  }, [workflow])

  useEffect(() => {
    api<{ agents: { interviewer?: string; tutor?: string } }>('/api/config').then((c) => {
      if (c.agents.interviewer && !localStorage.getItem('shadow.agent.interviewer')) setInterviewer(c.agents.interviewer)
      if (c.agents.tutor && !localStorage.getItem('shadow.agent.tutor')) setTutor(c.agents.tutor)
      if (c.agents.interviewer) localStorage.setItem('shadow.agent.interviewer', c.agents.interviewer)
      if (c.agents.tutor) localStorage.setItem('shadow.agent.tutor', c.agents.tutor)
    }).catch(() => {})
    api('/health').then((h) => { setHealth(h); if (!h.llm) setRehearsal(true) }).catch(() => setHealth({ ok: false, llm: false }))
    api('/api/sessions').then(setSessions).catch(() => {})
  }, [])

  const runCheck = async () => {
    setCheck(null)
    setCheckError(null)
    setChecking(true)
    try {
      const r = await api<{ providers: Record<string, { ok: boolean; why?: string; model?: string }> }>('/api/llm/check', { method: 'POST' })
      setCheck(r.providers)
      if (!Object.values(r.providers).some((p) => p.ok)) setRehearsal(true)
    } catch (e) {
      setCheckError(String(e))
    }
    setChecking(false)
  }

  const save = () => {
    localStorage.setItem('shadow.agent.interviewer', interviewer.trim())
    localStorage.setItem('shadow.agent.tutor', tutor.trim())
  }

  const start = async (mode: 'capture' | 'tutor') => {
    save()
    setBusy(mode)
    setError(null)
    const capture = sessions.slice().reverse().find((s) => s.mode !== 'tutor')
    const expertName = expertPick === '__new__' ? (newName.trim() || 'Guest') : expertPick
    try {
      const snap = await api('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(mode === 'tutor'
          ? rehearsal
            ? { mode, trainee: learnerName.trim() || 'Lena', lang: teachLang, pack: workflow, from_session: capture && (capture as any).pack === workflow ? capture.id : null, simulate: true }
            : { mode, trainee: learnerName.trim() || 'Lena', lang: teachLang, pack: workflow, expert: teachFrom || undefined }
          : { mode, expert: expertName, pack: workflow, simulate: rehearsal }),
      })
      nav(`/s/${snap.id}`)
    } catch (e) {
      setError(String(e))
      setBusy(null)
    }
  }

  const picked = experts.find((e) => e.expert === (expertPick === '__new__' ? newName.trim() : expertPick))
  const from = experts.find((e) => e.expert === teachFrom)
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  const mapWords = (e: ExpertMap) => `v${e.version}${e.rules != null ? `, ${n(e.rules, 'rule')}, ${n(e.guardrails ?? 0, 'guardrail')}` : ''}`

  const core = health === null ? 'Connecting' : health.ok ? 'Connected' : 'Unavailable'
  const coreDot = health === null ? 'bg-ink-3' : health.ok ? 'bg-confirmed' : 'bg-binding'

  const sel = 'mt-1.5 block w-full rounded-[3px] border border-rule-strong bg-sheet px-2.5 py-2 text-[14px] text-ink-1 outline-none focus:border-ink-2'
  const field = 'num mt-1.5 w-full rounded-[3px] border border-rule-strong bg-sheet px-2.5 py-1.5 text-[12px] text-ink-1 outline-none focus:border-ink-2'
  return (
    <div className="min-h-full bg-paper">
      <header className="border-b border-rule-strong">
        <div className="mx-auto flex max-w-[1180px] items-center gap-4 px-6 py-4">
          <Wordmark />
          <a href="/" className="ml-auto text-[12px] text-ink-2 hover:text-ink-1">Product home</a>
          <span className="num flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className={`inline-block h-[6px] w-[6px] ${coreDot}`} aria-hidden />
            {core}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 pb-20">
        <section className="pb-7 pt-12">
          <h1 className="testimony mb-0 mt-0 max-w-[24ch] text-[34px] leading-[1.06] tracking-[-0.015em] sm:text-[46px]">
            Two jobs for Mira.
          </h1>
          <p className="mb-0 mt-3 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
            She learns how your best people decide, then teaches everyone else in their words.
          </p>
        </section>

        <section className="border-y border-rule py-5">
          <div className="grid grid-cols-1 items-baseline gap-x-6 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="label">Workflow</div>
            <div>
              {wfState === 'loading' && <span className="text-[14px] text-ink-3">Loading…</span>}
              {wfState === 'error' && <span className="text-[14px] text-ink-3">Couldn’t load workflows. Using the default.</span>}
              {workflows.length > 4 && (
                <select value={workflow} onChange={(e) => setWorkflow(e.target.value)} className="block w-full max-w-[520px] rounded-[3px] border border-rule-strong bg-sheet px-2.5 py-2 text-[14px] text-ink-1 outline-none focus:border-ink-2">
                  {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}{w.kind === 'learned' ? ' · learned' : ''}</option>)}
                </select>
              )}
              {workflows.length > 0 && workflows.length <= 4 && (
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {workflows.map((w) => (
                    <label key={w.id} className={`flex cursor-pointer items-center gap-2 border-b-2 py-1 text-[15px] ${workflow === w.id ? 'border-confirmed text-ink-1' : 'border-transparent text-ink-2'}`}>
                      <input type="radio" name="wf" checked={workflow === w.id} onChange={() => setWorkflow(w.id)} className="accent-[#4e6b44]" />
                      {w.name}
                      <span className="num text-[11px] text-ink-3">{w.kind === 'learned' ? 'learned' : 'built in'}</span>
                      {(w.compare_experts?.length ?? 0) >= 2 && (
                        <Link to={`/w/${w.id}/compare`} onClick={(e) => e.stopPropagation()} className="text-[13px] text-inferred hover:underline">
                          compare experts →
                        </Link>
                      )}
                    </label>
                  ))}
                </div>
              )}
              <p className="mb-0 mt-2 text-[13px] text-ink-3">
                A task that isn’t listed? Turn Mira on in the browser extension and choose <span className="text-ink-2">Learn this task</span>.
              </p>
            </div>
          </div>
        </section>

        <section className="border-b border-rule py-9">
          {rehearsal && (
            <div className="mb-7 border-l-[3px] border-query bg-wash px-4 py-3 text-[13px] leading-relaxed text-ink-2">
              <Mark state="query" className="mr-1" />
              <span className="text-ink-1">Practice mode.</span> This run uses a simulated expert. It is labelled everywhere and never feeds a saved Work Map.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2">
            <div className="flex flex-col pb-9 md:pb-0 md:pr-10">
              <div className="flex items-end gap-5">
                <Mira role="learn" height={104} />
                <div className="pb-1">
                  <div className="num text-[11px] text-ink-3">Job 1</div>
                  <h2 className="testimony m-0 mt-1 text-[28px] leading-[1.1] tracking-[-0.01em]">Learn from an expert</h2>
                </div>
              </div>
              <p className="mb-0 mt-4 max-w-[46ch] text-[16px] leading-relaxed text-ink-2">
                The expert works as usual. Mira watches, asks one question at a natural pause, and builds the Work Map.
              </p>
              <div className="mt-6 space-y-3">
                <label className="block text-[13px] text-ink-2">Who is the expert?
                  <select value={expertPick} onChange={(e) => setExpertPick(e.target.value)} className={sel}>
                    <option value="__new__">+ New expert (you)</option>
                    {experts.map((e) => <option key={e.expert} value={e.expert}>{e.expert} · Work Map v{e.version}</option>)}
                  </select>
                </label>
                {expertPick === '__new__' && (
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Your name" aria-label="Your name" className={`${sel} mt-0`} />
                )}
                <p className="m-0 text-[13px] leading-snug text-ink-2">
                  {picked
                    ? <>Mira continues {picked.expert}’s Work Map ({mapWords(picked)}).</>
                    : <>Mira starts from the written process and learns from {expertPick === '__new__' ? 'you' : expertPick}.</>}
                </p>
              </div>
              <div className="mt-6 md:mt-auto md:pt-6">
                <button disabled={busy !== null} onClick={() => start('capture')}
                  className="inline-flex h-11 items-center rounded-[3px] bg-ink-1 px-5 text-[13.5px] font-medium text-sheet hover:bg-[#3a3732] disabled:opacity-40">
                  {busy === 'capture' ? 'Starting…' : 'Start learning'}
                </button>
              </div>
            </div>

            <div className="flex flex-col border-t border-rule pt-9 md:border-l md:border-t-0 md:pl-10 md:pt-0">
              <div className="flex items-end gap-5">
                <Mira role="teach" height={104} />
                <div className="pb-1">
                  <div className="num text-[11px] text-ink-3">Job 2</div>
                  <h2 className="testimony m-0 mt-1 text-[28px] leading-[1.1] tracking-[-0.01em]">Teach a new hire</h2>
                </div>
              </div>
              <p className="mb-0 mt-4 max-w-[46ch] text-[16px] leading-relaxed text-ink-2">
                The new hire works a case. Mira watches and steps in before a mistake, in the expert’s own words.
              </p>
              <div className="mt-6 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-[13px] text-ink-2">New hire
                    <input value={learnerName} onChange={(e) => setLearnerName(e.target.value)} className={sel} />
                  </label>
                  <label className="block text-[13px] text-ink-2">Mira teaches in
                    <select value={teachLang} onChange={(e) => setTeachLang(e.target.value)} className={sel}>
                      <option value="en">English</option>
                      <option value="de">Deutsch</option>
                      <option value="fr">Français</option>
                      <option value="es">Español</option>
                    </select>
                  </label>
                </div>
                {experts.length > 1 && (
                  <label className="block text-[13px] text-ink-2">Teach from
                    <select value={teachFrom} onChange={(e) => setTeachFrom(e.target.value)} className={sel}>
                      {experts.map((e) => <option key={e.expert} value={e.expert}>{e.expert} · Work Map v{e.version}</option>)}
                    </select>
                  </label>
                )}
                <p className="m-0 text-[13px] leading-snug text-ink-2">
                  {from ? <>Taught from {from.expert}’s Work Map ({mapWords(from)}).</>
                    : rehearsal ? <>Practice run: taught from a simulated expert.</>
                    : <>No Work Map yet. Learn from an expert first.</>}
                </p>
              </div>
              <div className="mt-6 md:mt-auto md:pt-6">
                <button disabled={busy !== null || (!from && !rehearsal)} onClick={() => start('tutor')}
                  className="inline-flex h-11 items-center rounded-[3px] border border-rule-strong px-5 text-[13.5px] font-medium text-ink-1 hover:border-ink-2 disabled:opacity-40">
                  {busy === 'tutor' ? 'Starting…' : 'Start teaching'}
                </button>
              </div>
            </div>
          </div>
          {error && (
            <div role="alert" className="mt-6 border-l-[3px] border-binding pl-3 text-[13px] leading-relaxed text-binding">
              Couldn’t start the session. {error}
            </div>
          )}
        </section>

        {sessions.length > 0 && (
          <section className="border-b border-rule py-8">
            <h2 className="m-0 text-[16px] font-medium text-ink-1">Recent sessions</h2>
            <div className="mt-4">
              {sessions.slice().reverse().map((s) => (
                <button
                  key={s.id}
                  onClick={() => nav(`/s/${s.id}`)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 border-t border-rule py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] text-ink-1">
                      <span className="num mr-2 text-[10.5px] uppercase tracking-[.06em] text-ink-3">
                        {s.mode === 'tutor' ? 'New hire' : 'Expert'}
                      </span>
                      {s.expert}
                    </span>
                    <span className="num mt-0.5 block truncate text-[11px] text-ink-3">{s.id}</span>
                  </span>
                  <span className="num shrink-0 text-[14px] text-ink-2">
                    {s.metrics.episodes} cases · {s.metrics.rules_learned} rules
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <details className="mt-9">
          <summary className="label cursor-pointer">Settings &amp; diagnostics</summary>
          <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-[12px] text-ink-2">ElevenLabs interviewer agent
              <input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} onBlur={save} placeholder="agent_…" className={field} />
            </label>
            <label className="text-[12px] text-ink-2">ElevenLabs tutor agent
              <input value={tutor} onChange={(e) => setTutor(e.target.value)} onBlur={save} placeholder="agent_…" className={field} />
            </label>
            <div className="text-[12px] text-ink-2">
              <div className="label">Connection</div>
              <div className="num mt-2 space-y-1 text-[12px] text-ink-2">
                <div>core · {health === null ? 'checking…' : health.ok ? 'connected' : 'unavailable'}</div>
                <div>LLM key · {health === null ? 'checking…' : health.llm ? 'present' : 'missing'}</div>
                <div>spend · {health?.spend ? `$${health.spend.usd.toFixed(3)} · ${health.spend.calls} calls` : '—'}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-5 border-t border-rule pt-4 text-[12px] sm:col-span-2 lg:col-span-3">
              <div className="flex border border-rule-strong">
                <button onClick={() => setRehearsal(false)} className={`px-3 py-1 ${!rehearsal ? 'bg-ink-1 text-sheet' : 'text-ink-2'}`}>Live</button>
                <button onClick={() => setRehearsal(true)} className={`border-l border-rule-strong px-3 py-1 ${rehearsal ? 'bg-ink-1 text-sheet' : 'text-ink-2'}`}>Practice run · simulated expert</button>
              </div>
              <button onClick={runCheck} disabled={checking} className="text-inferred hover:underline disabled:opacity-40">
                {checking ? 'checking…' : 'check LLM providers'}
              </button>
              {check && Object.entries(check).map(([p, s]) => (
                <span key={p} className={`num text-[11px] ${s.ok ? 'text-confirmed' : 'text-binding'}`} title={s.why}>{p}: {s.ok ? `ok (${s.model})` : s.why}</span>
              ))}
              {checkError && <span className="num text-[11px] text-binding">check failed · {checkError}</span>}
            </div>
          </div>
        </details>
      </main>
    </div>
  )
}
