import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Mark, Wordmark } from '../components/ui'
import { AGENTS } from '../lib/voice'

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
  const [lang, setLang] = useState('en')
  const [busy, setBusy] = useState<'capture' | 'tutor' | null>(null)
  const [continueSaved, setContinueSaved] = useState(false)
  const [workflows, setWorkflows] = useState<{ id: string; name: string; kind: string; version: number; experts: string[]; learners: string[]; sessions: number; compare_experts?: { expert: string; simulated: boolean }[] }[]>([])
  const [wfState, setWfState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [workflow, setWorkflow] = useState('ap_invoices')

  useEffect(() => {
    api('/api/workflows')
      .then((w) => { setWorkflows(w); setWfState('ready') })
      .catch(() => setWfState('error'))
  }, [])

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
    try {
      const snap = await api('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(mode === 'tutor'
          ? { mode, trainee: 'Lena', pack: workflow, from_session: capture && (capture as any).pack === workflow ? capture.id : null, simulate: rehearsal }
          : { mode, lang, pack: workflow, simulate: rehearsal, fresh: !continueSaved }),
      })
      nav(`/s/${snap.id}`)
    } catch (e) {
      setError(String(e))
      setBusy(null)
    }
  }

  const core = health === null ? 'Connecting' : health.ok ? 'Connected' : 'Unavailable'
  const coreDot = health === null ? 'bg-ink-3' : health.ok ? 'bg-confirmed' : 'bg-binding'

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
        <section className="border-b border-rule pb-9 pt-12">
          <div className="label">Your notebook</div>
          <h1 className="testimony mb-0 mt-3 max-w-[20ch] text-[34px] leading-[1.06] tracking-[-0.015em] sm:text-[48px]">
            Teach Mira how you work.
          </h1>
          <p className="mb-0 mt-4 max-w-[64ch] text-[17px] leading-relaxed text-ink-2">
            Show the decisions you make. Mira learns the rules, then helps someone else follow them.
          </p>
        </section>

        <section className="border-b border-rule py-9">
          <h2 className="m-0 text-[16px] font-medium text-ink-1">Choose a workflow</h2>
          <div className="mt-4">
            {wfState === 'loading' && <div className="text-[14px] text-ink-3">Loading workflows…</div>}
            {wfState === 'error' && <div className="text-[14px] text-ink-3">Couldn’t load workflows — using the default.</div>}
            {wfState === 'ready' && workflows.length === 0 && (
              <div className="text-[14px] text-ink-3">No workflows yet. Learn one from a work page with the extension.</div>
            )}
            {workflows.length > 0 && (
              <div className="divide-y divide-rule">
                {workflows.map((w) => {
                  const on = workflow === w.id
                  return (
                    <label
                      key={w.id}
                      className={`grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] items-start gap-3 border-l-2 py-3.5 pl-3 pr-1 ${on ? 'border-l-confirmed' : 'border-l-transparent'}`}
                    >
                      <input type="radio" name="wf" checked={on} onChange={() => setWorkflow(w.id)} className="mt-1 accent-[#4e6b44]" />
                      <span className="min-w-0">
                        <span className="block text-[16px] leading-snug text-ink-1">{w.name}</span>
                        <span className="mt-0.5 block text-[14px] leading-snug text-ink-2">
                          <Mark state={w.kind === 'learned' ? 'observed' : 'written'} className="mr-1" />
                          {w.kind === 'learned' ? 'Learned from a person' : 'Built in'}
                          <span className="text-ink-3">
                            {' · '}
                            {w.experts.length ? `taught by ${w.experts.join(', ')}` : 'not taught yet'}
                            {w.learners.length ? ` · training ${w.learners.join(', ')}` : ''}
                          </span>
                        </span>
                        {(w.compare_experts?.length ?? 0) >= 2 && (
                          <Link
                            to={`/w/${w.id}/compare`}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 inline-block text-[14px] text-inferred hover:underline"
                          >
                            Compare {w.compare_experts!.length} experts
                            {w.compare_experts!.some((x) => x.simulated) ? ' (includes a rehearsal expert)' : ''} →
                          </Link>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section className="border-b border-rule py-9">
          {rehearsal && (
            <div className="mb-7 border-l-[3px] border-query bg-wash px-4 py-3 text-[13px] leading-relaxed text-ink-2">
              <Mark state="query" className="mr-1" />
              <span className="text-ink-1">Practice mode.</span> This run uses a simulated expert. It is labelled everywhere and never feeds a saved Work Map.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr]">
            <div className="flex flex-col pb-8 md:pb-0 md:pr-10">
              <div className="num text-[11px] text-ink-3">1</div>
              <h2 className="testimony mb-0 mt-1.5 text-[30px] leading-[1.1] tracking-[-0.01em]">Learn from an expert</h2>
              <p className="mb-0 mt-3 max-w-[46ch] text-[16px] leading-relaxed text-ink-2">
                Work as usual. Mira watches your decisions and asks a question when you pause.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 md:mt-auto md:pt-6">
                <button
                  disabled={busy !== null}
                  onClick={() => start('capture')}
                  className="inline-flex h-11 items-center rounded-[3px] bg-ink-1 px-5 text-[13.5px] font-medium text-sheet hover:bg-[#3a3732] disabled:opacity-40"
                >
                  Start capture
                </button>
                <label className="flex items-center gap-2 text-[14px] text-ink-2">
                  Expert speaks
                  <select value={lang} onChange={(e) => setLang(e.target.value)} className="num rounded-[3px] border border-rule-strong bg-sheet px-2 py-1 text-[14px] text-ink-1 outline-none focus:border-ink-2">
                    <option value="en">English</option>
                    <option value="de">Deutsch</option>
                  </select>
                </label>
              </div>
              {busy === 'capture' && <div className="num mt-3 text-[12px] text-ink-2">Starting capture…</div>}
            </div>

            <div className="flex flex-col border-t border-rule pt-8 md:border-l md:border-t-0 md:pl-10 md:pt-0">
              <div className="num text-[11px] text-ink-3">2</div>
              <h2 className="testimony mb-0 mt-1.5 text-[30px] leading-[1.1] tracking-[-0.01em]">Teach someone new</h2>
              <p className="mb-0 mt-3 max-w-[46ch] text-[16px] leading-relaxed text-ink-2">
                Put the learned rules into practice. Mira guides the next person in the expert’s words.
              </p>
              <div className="mt-6 md:mt-auto md:pt-6">
                <button
                  disabled={busy !== null}
                  onClick={() => start('tutor')}
                  className="inline-flex h-11 items-center rounded-[3px] border border-rule-strong px-5 text-[13.5px] font-medium text-ink-1 hover:border-ink-2 disabled:opacity-40"
                >
                  Start tutoring
                </button>
              </div>
              {busy === 'tutor' && <div className="num mt-3 text-[12px] text-ink-2">Starting tutoring…</div>}
            </div>
          </div>
          {error && (
            <div role="alert" className="mt-6 border-l-[3px] border-binding pl-3 text-[13px] leading-relaxed text-binding">
              Couldn’t start the session. {error}
            </div>
          )}
        </section>

        <section className="border-b border-rule py-8">
          <h2 className="m-0 text-[16px] font-medium text-ink-1">Working in another app?</h2>
          <p className="mb-0 mt-2 max-w-[76ch] text-[16px] leading-relaxed text-ink-2">
            Open the Tacet extension on your work page, turn Mira on, and choose <span className="text-ink-1">Learn this task</span>. The workflow will appear here.
          </p>
        </section>

        {sessions.length > 0 && (
          <section className="border-b border-rule py-8">
            <h2 className="m-0 text-[16px] font-medium text-ink-1">Continue a session</h2>
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
              <label className="flex items-center gap-1.5 text-ink-2" title="Capture continues from the last saved Work Map instead of the written process only">
                <input type="checkbox" checked={continueSaved} onChange={(e) => setContinueSaved(e.target.checked)} className="accent-[#4e6b44]" />
                continue from saved map
              </label>
              <button onClick={runCheck} disabled={checking} className="text-inferred hover:underline disabled:opacity-40">
                {checking ? 'checking…' : 'check LLM providers'}
              </button>
              {check && Object.entries(check).map(([p, s]) => (
                <span key={p} className={`num text-[11px] ${s.ok ? 'text-confirmed' : 'text-binding'}`} title={s.why}>{p}: {s.ok ? `ok (${s.model})` : s.why}</span>
              ))}
              {checkError && <span className="num text-[11px] text-binding">check failed · {checkError}</span>}
            </div>
            <div className="text-[11.5px] text-ink-3 sm:col-span-2 lg:col-span-3">
              Live sessions learn only from real people. Practice runs use a simulated expert, are labelled everywhere, and never feed a saved Work Map.
            </div>
          </div>
        </details>
      </main>
    </div>
  )
}
