import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Mark, Wordmark } from '../components/ui'
import { AGENTS } from '../lib/voice'

export default function Home() {
  const nav = useNavigate()
  const [health, setHealth] = useState<{ ok: boolean; llm: boolean; spend?: { usd: number; calls: number } } | null>(null)
  const [rehearsal, setRehearsal] = useState(false)
  const [check, setCheck] = useState<Record<string, { ok: boolean; why?: string; model?: string }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runCheck = async () => {
    setCheck(null)
    const r = await api<{ providers: Record<string, { ok: boolean; why?: string; model?: string }> }>('/api/llm/check', { method: 'POST' })
    setCheck(r.providers)
    if (!Object.values(r.providers).some((p) => p.ok)) setRehearsal(true)
  }
  const [sessions, setSessions] = useState<{ id: string; mode: string; expert: string; metrics: any }[]>([])
  const [interviewer, setInterviewer] = useState(AGENTS.interviewer())
  const [tutor, setTutor] = useState(AGENTS.tutor())
  const [lang, setLang] = useState('en')
  const [busy, setBusy] = useState(false)
  const [continueSaved, setContinueSaved] = useState(false)

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

  const save = () => {
    localStorage.setItem('shadow.agent.interviewer', interviewer.trim())
    localStorage.setItem('shadow.agent.tutor', tutor.trim())
  }

  const start = async (mode: 'capture' | 'tutor') => {
    save()
    setBusy(true)
    setError(null)
    const capture = sessions.slice().reverse().find((s) => s.mode !== 'tutor')
    try {
      const snap = await api('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(mode === 'tutor'
          ? { mode, trainee: 'Lena', from_session: capture?.id ?? null, simulate: rehearsal }
          : { mode, lang, simulate: rehearsal, fresh: !continueSaved }),
      })
      nav(`/s/${snap.id}`)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  const field = 'num mt-1.5 w-full rounded-[3px] border border-rule-strong bg-sheet px-2.5 py-1.5 text-[12px] text-ink-1 outline-none focus:border-ink-2'
  return (
    <div className="min-h-full bg-paper">
      <header className="mx-auto flex max-w-5xl items-center gap-4 border-b border-rule-strong px-6 py-4">
        <Wordmark />
        <div className="num ml-auto flex items-center gap-4 text-[10.5px] text-ink-3">
          <span className={health?.ok ? 'text-confirmed' : 'text-binding'}>{health?.ok ? '■ core online' : '□ core offline'}</span>
          <span className={health?.llm ? 'text-confirmed' : 'text-query'}>{health?.llm ? 'LLM key present' : 'no LLM key'}</span>
          {health?.spend && <span>${health.spend.usd.toFixed(3)} · {health.spend.calls} calls</span>}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-20">
        <section className="grid grid-cols-[1fr_300px] items-end gap-10 border-b border-rule pb-12 pt-16">
          <div>
            <div className="label">An apprentice for retiring expertise</div>
            <h1 className="testimony mt-4 text-[54px] leading-[1.02] tracking-[-0.02em]">
              It learns what the AI <i>doesn’t</i> already know.
            </h1>
          </div>
          <p className="text-[14px] leading-relaxed text-ink-2">
            Shadow writes down its guess before the expert acts. When she does something it can’t explain, it waits for a pause,
            asks one question, and turns her answer into a rule it then tests, and teaches to the next hire.
          </p>
        </section>

        <section className="divide-y divide-rule border-b border-rule">
          {([
            ['capture', 'Capture an expert', 'Work real cases while Shadow watches. A few questions at natural pauses, then a short debrief and teach-back.', 'observed'],
            ['tutor', 'Teach a new hire', 'The trainee works cases the expert never showed. Shadow stops a wrong save before it happens, in the expert’s words.', 'binding'],
          ] as const).map(([mode, title, text, prov]) => (
            <button key={mode} disabled={busy} onClick={() => start(mode)} className="group grid w-full grid-cols-[28px_1fr_auto] items-baseline gap-3 py-6 text-left disabled:opacity-50">
              <Mark state={prov} className="text-[15px]" />
              <span>
                <span className="testimony block text-[26px] leading-tight group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">{title}</span>
                <span className="mt-1.5 block max-w-xl text-[13.5px] text-ink-2">{text}</span>
              </span>
              <span className="num text-[12px] text-ink-2 group-hover:text-ink-1">{mode === 'capture' ? 'start session' : 'start tutoring'} →</span>
            </button>
          ))}
        </section>

        <section className="mt-10 grid grid-cols-3 gap-x-6 gap-y-4">
          <div className="label col-span-3">Session settings</div>
          <label className="text-[12px] text-ink-2">ElevenLabs interviewer agent
            <input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} onBlur={save} placeholder="agent_…" className={field} />
          </label>
          <label className="text-[12px] text-ink-2">ElevenLabs tutor agent
            <input value={tutor} onChange={(e) => setTutor(e.target.value)} onBlur={save} placeholder="agent_…" className={field} />
          </label>
          <label className="text-[12px] text-ink-2">Expert speaks
            <select value={lang} onChange={(e) => setLang(e.target.value)} className={field}>
              <option value="en">English</option>
              <option value="de">Deutsch (tutor teaches in English)</option>
            </select>
          </label>
          <div className="col-span-3 flex flex-wrap items-center gap-5 border-t border-rule pt-4 text-[12px]">
            <div className="flex border border-rule-strong">
              <button onClick={() => setRehearsal(false)} className={`px-3 py-1 ${!rehearsal ? 'bg-ink-1 text-sheet' : 'text-ink-2'}`}>Live</button>
              <button onClick={() => setRehearsal(true)} className={`border-l border-rule-strong px-3 py-1 ${rehearsal ? 'bg-ink-1 text-sheet' : 'text-ink-2'}`}>Rehearsal · simulated expert</button>
            </div>
            <label className="flex items-center gap-1.5 text-ink-2" title="Capture continues from the last saved Work Map instead of the written process only">
              <input type="checkbox" checked={continueSaved} onChange={(e) => setContinueSaved(e.target.checked)} className="accent-[#4e6b44]" />
              continue from saved map
            </label>
            <button onClick={runCheck} className="text-inferred hover:underline">check LLM providers</button>
            {check && Object.entries(check).map(([p, s]) => (
              <span key={p} className={`num text-[11px] ${s.ok ? 'text-confirmed' : 'text-binding'}`} title={s.why}>{p}: {s.ok ? `ok (${s.model})` : s.why}</span>
            ))}
          </div>
          {error && <div className="col-span-3 text-[12px] text-binding">{error}</div>}
          <div className="col-span-3 text-[11.5px] text-ink-3">Both voice agents use a Custom LLM pointing at Shadow Core, so Shadow decides what they say. Live learns from real speech; Rehearsal uses a simulated Sabine and costs nothing.</div>
        </section>

        {sessions.length > 0 && (
          <section className="mt-10">
            <div className="label border-b border-rule pb-2">Sessions in memory</div>
            <div className="divide-y divide-rule">
              {sessions.slice().reverse().map((s) => (
                <button key={s.id} onClick={() => nav(`/s/${s.id}`)} className="num grid w-full grid-cols-[120px_100px_1fr_auto] py-2 text-left text-[12px] text-ink-2 hover:text-ink-1">
                  <span className="text-ink-1">{s.id}</span><span>{s.mode}</span><span>{s.expert}</span>
                  <span>{s.metrics.episodes} cases · {s.metrics.rules_learned} rules</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
