import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, GraduationCap, Mic, ScanEye } from 'lucide-react'
import { api } from '../lib/api'
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

  useEffect(() => {
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
          : { mode, lang, simulate: rehearsal }),
      })
      nav(`/s/${snap.id}`)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <div className="flex items-center gap-3">
        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-learn to-predict" />
        <div className="text-lg font-bold tracking-tight">Shadow</div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          <span className={health?.ok ? 'text-learn' : 'text-gap'}>{health?.ok ? 'core online' : 'core offline'}</span>
          <span className={health?.llm ? 'text-learn' : 'text-ask'}>{health?.llm ? 'LLM key present' : 'no LLM key'}</span>
          {health?.spend && <span className="num">${health.spend.usd.toFixed(3)} spent · {health.spend.calls} calls</span>}
        </div>
      </div>

      <h1 className="mt-16 max-w-3xl font-serif text-[56px] leading-[1.02] tracking-tight">
        An apprentice that learns <i className="text-learn">what the AI doesn’t already know.</i>
      </h1>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">
        Shadow predicts every decision before the expert makes it. When the expert does something it can’t explain,
        it waits for a natural pause and asks the one question worth asking, then turns the answer into executable,
        verified judgment that it teaches to the next hire.
      </p>

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <button disabled={busy} onClick={() => start('capture')} className="panel group p-6 text-left transition hover:border-learn/50">
          <ScanEye className="text-learn" />
          <div className="mt-4 text-lg font-semibold">Capture an expert</div>
          <div className="mt-1 text-sm text-muted">Share the screen, work real cases, answer a few questions at natural pauses. Then a short debrief and teach-back.</div>
          <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-learn">Start session <ArrowRight size={15} className="transition group-hover:translate-x-1" /></div>
        </button>
        <button disabled={busy} onClick={() => start('tutor')} className="panel group p-6 text-left transition hover:border-predict/50">
          <GraduationCap className="text-predict" />
          <div className="mt-4 text-lg font-semibold">Teach a new hire</div>
          <div className="mt-1 text-sm text-muted">The tutor watches the trainee work cases the expert never showed, and steps in before a guardrail is broken, in the expert’s words.</div>
          <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-predict">Start tutoring <ArrowRight size={15} className="transition group-hover:translate-x-1" /></div>
        </button>
      </div>

      <div className="panel mt-6 grid gap-4 p-5 md:grid-cols-3">
        <label className="text-xs text-muted">ElevenLabs interviewer agent id
          <input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} onBlur={save} placeholder="agent_…"
            className="num mt-1.5 w-full rounded-lg border border-line-2 bg-ink px-3 py-2 text-[12px] text-text outline-none focus:border-learn" />
        </label>
        <label className="text-xs text-muted">ElevenLabs tutor agent id
          <input value={tutor} onChange={(e) => setTutor(e.target.value)} onBlur={save} placeholder="agent_…"
            className="num mt-1.5 w-full rounded-lg border border-line-2 bg-ink px-3 py-2 text-[12px] text-text outline-none focus:border-learn" />
        </label>
        <label className="text-xs text-muted">Expert speaks
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line-2 bg-ink px-3 py-2 text-[12px] text-text">
            <option value="en">English</option>
            <option value="de">Deutsch (tutor teaches in English)</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-4 md:col-span-3">
          <div className="flex rounded-lg border border-line-2 p-0.5 text-[12px] font-semibold">
            <button onClick={() => setRehearsal(false)} className={`rounded-md px-3 py-1 ${!rehearsal ? 'bg-learn text-ink' : 'text-muted'}`}>Live</button>
            <button onClick={() => setRehearsal(true)} className={`rounded-md px-3 py-1 ${rehearsal ? 'bg-hyp text-ink' : 'text-muted'}`}>Rehearsal · simulated expert</button>
          </div>
          <button onClick={runCheck} className="text-[12px] text-predict hover:underline">Check LLM providers</button>
          {check && Object.entries(check).map(([p, s]) => (
            <span key={p} className={`text-[11.5px] ${s.ok ? 'text-learn' : 'text-gap'}`} title={s.why}>{p}: {s.ok ? `ok (${s.model})` : s.why}</span>
          ))}
        </div>
        {error && <div className="text-[12px] text-gap md:col-span-3">{error}</div>}
        <div className="flex items-center gap-2 text-[11px] text-faint md:col-span-3"><Mic size={12} /> Both agents use a Custom LLM pointing at Shadow Core, so Shadow decides what they say. Live learns from real speech; Rehearsal uses simulated Sabine and costs nothing.</div>
      </div>

      {sessions.length > 0 && (
        <div className="mt-8">
          <div className="label mb-2">Sessions</div>
          <div className="space-y-1.5">
            {sessions.slice().reverse().map((s) => (
              <button key={s.id} onClick={() => nav(`/s/${s.id}`)} className="panel flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:border-line-2">
                <span><span className="num text-muted">{s.id}</span> · {s.mode} · {s.expert}</span>
                <span className="num text-xs text-faint">{s.metrics.episodes} cases · {s.metrics.rules_learned} rules</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
