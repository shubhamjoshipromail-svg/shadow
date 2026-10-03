import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConversationProvider } from '@elevenlabs/react'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, EyeOff, GraduationCap, Map as MapIcon, Mic, MicOff, MonitorUp, PauseCircle, Send, Sparkles } from 'lucide-react'
import { API, api, mmss, useShadow } from '../lib/api'
import { useScreen } from '../lib/screen'
import { useVoiceBridge } from '../lib/voice'
import type { Intervention, MapNode, Quote } from '../lib/types'
import PredictionCard from '../components/Prediction'
import Hypotheses from '../components/Hypotheses'
import Question from '../components/Question'
import Feed from '../components/Feed'
import WorkMapView from '../components/WorkMapView'
import Threshold from '../components/Threshold'
import Checklist from '../components/Checklist'
import Mastery from '../components/Mastery'
import MomentModal from '../components/MomentModal'
import { Btn, Dot, Section } from '../components/ui'

export default function Console() {
  const { sid } = useParams()
  return (
    <ConversationProvider>
      <ConsoleInner sid={sid!} />
    </ConversationProvider>
  )
}

function ConsoleInner({ sid }: { sid: string }) {
  const nav = useNavigate()
  const { live, connected, send, on } = useShadow(sid)
  const snap = live.snap
  const offset = useRef(Date.now() / 1000)
  const [pii, setPii] = useState<{ rects: [number, number, number, number][]; vw: number; vh: number } | null>(null)
  const [vision, setVision] = useState(false)
  const [moment, setMoment] = useState<{ ts: number | null; quote?: Quote | null; title?: string } | null>(null)
  const [typed, setTyped] = useState('')
  const [localLines, setLocalLines] = useState<{ who: 'agent' | 'user'; text: string; at: number }[]>([])
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const [autoplay, setAutoplay] = useState(false)

  const simStep = async () => {
    const r = await api<{ did: string; said?: string; reply?: string }>(`/api/sessions/${sid}/sim/step`, { method: 'POST' })
    if (r.said) setLocalLines((l) => [...l, { who: 'user', text: r.said!, at: Date.now() }])
    if (r.reply) setLocalLines((l) => [...l, { who: 'agent', text: r.reply!, at: Date.now() }])
    return r
  }
  useEffect(() => {
    if (!autoplay) return
    const t = window.setInterval(async () => {
      const r = await simStep()
      if (r.did === 'nothing') setAutoplay(false)
    }, 2600)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay])

  useEffect(() => on((e) => {
    if (typeof e.t === 'number' && e.t > 0) offset.current = Date.now() / 1000 - e.t
    if (e.type === 'pii_rects') setPii({ rects: e.rects, vw: e.vw, vh: e.vh })
    if (e.type === 'learned') {
      const ids = new Set<string>((e.changes as any[]).filter((c) => c.kind === 'node_added').map((c) => c.id))
      setHighlight(ids)
      window.setTimeout(() => setHighlight(new Set()), 5000)
    }
    if (e.type === 'replay' && e.screen_moment) setMoment({ ts: e.screen_moment.ts, quote: e.quote, title: 'what the expert did' })
  }), [on])

  const screen = useScreen({ sid, send, vision, piiRects: pii, paused: !!snap?.off_record })
  const mode = snap?.mode ?? 'capture'
  const voice = useVoiceBridge({ sid, mode, lang: snap?.lang ?? 'en', send, on })
  const lines = useMemo(() => [...voice.lines, ...localLines].sort((a, b) => a.at - b.at).slice(-40), [voice.lines, localLines])

  const latestHyp = useMemo(() => {
    const ev = live.feed.find((e) => e.type === 'hypotheses')
    if (ev) return snap?.hypotheses[ev.set.gap_id] ?? ev.set
    const sets = Object.values(snap?.hypotheses ?? {})
    return sets.at(-1) ?? null
  }, [live.feed, snap?.hypotheses])

  const asked = live.asked?.inquiry ?? null
  const lastAnswered = useMemo(() => [...(snap?.inquiries ?? [])].filter((q) => q.status === 'answered' || q.status === 'asked').sort((a, b) => (b.asked_at ?? 0) - (a.asked_at ?? 0))[0] ?? null, [snap?.inquiries])
  const question = asked ?? lastAnswered

  if (!snap) {
    return <div className="flex h-full items-center justify-center text-muted">{connected ? 'Loading session…' : 'Connecting to Shadow Core…'}</div>
  }

  const openMoment = (ts: number | null, node?: MapNode) => setMoment({ ts, quote: node?.quote, title: node?.title })
  const momentFrames = moment?.ts != null ? screen.framesAround(moment.ts + offset.current, 4, 3) : []

  const startDebrief = async () => {
    await api(`/api/sessions/${sid}/debrief`, { method: 'POST' })
    if (voice.conv.status === 'connected') voice.kickDebrief()
  }
  const startTutor = async () => {
    const s = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'tutor', trainee: 'Lena', from_session: sid }) })
    nav(`/s/${s.id}`)
  }
  const toggleRecord = () => api(`/api/sessions/${sid}/record`, { method: 'POST', body: JSON.stringify({ off: !snap.off_record }) })
  const sendTyped = async () => {
    const text = typed.trim()
    if (!text) return
    setTyped('')
    setLocalLines((l) => [...l, { who: 'user', text, at: Date.now() }])
    const r = await api<{ reply: string }>(`/api/sessions/${sid}/utterance`, { method: 'POST', body: JSON.stringify({ text }) })
    if (r.reply) setLocalLines((l) => [...l, { who: 'agent', text: r.reply, at: Date.now() }])
  }
  const askNextTyped = async () => {
    const r = await api<{ reply: string }>(`/api/sessions/${sid}/utterance`, { method: 'POST', body: JSON.stringify({ text: asked ? `[[shadow:ask ${asked.id}]]` : '[[shadow:debrief]]' }) })
    if (r.reply) setLocalLines((l) => [...l, { who: 'agent', text: r.reply, at: Date.now() }])
  }

  const m = snap.metrics
  const acc = m.prospective_accuracy
  const posteriors = Object.values(snap.posteriors)
  const voiceOn = voice.conv.status === 'connected'
  const activity = live.activity ?? snap.activity

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-gradient-to-br from-learn to-predict" />
          <span className="font-bold tracking-tight">Shadow</span>
        </Link>
        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${mode === 'tutor' ? 'border-predict/50 text-predict' : mode === 'debrief' ? 'border-ask/50 text-ask' : 'border-learn/50 text-learn'}`}>
          {mode === 'capture' ? 'Capturing' : mode === 'debrief' ? 'Debrief' : 'Tutoring'} · {mode === 'tutor' ? `${snap.trainee} learning from ${snap.expert}` : snap.expert}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted"><Dot on={connected} /> {connected ? 'live' : 'reconnecting'}</span>
        {snap.off_record && <span className="flex items-center gap-1 rounded-full bg-panel-2 px-2.5 py-0.5 text-[11px] text-muted"><EyeOff size={12} /> off the record</span>}
        <div className="ml-auto flex items-center gap-2">
          {snap.simulated && (
            <span className="flex items-center gap-1 rounded-lg border border-hyp/40 px-1 py-0.5">
              <span className="px-1.5 text-[10.5px] font-semibold text-hyp">simulated {mode === 'tutor' ? 'trainee' : snap.expert}</span>
              <Btn tone="ghost" onClick={simStep}>step</Btn>
              <Btn tone="ghost" onClick={() => setAutoplay((a) => !a)}>{autoplay ? 'pause' : 'autoplay'}</Btn>
            </span>
          )}
          <Btn tone="ghost" onClick={toggleRecord}><EyeOff size={14} />{snap.off_record ? 'Back on record' : 'Off the record'}</Btn>
          {mode === 'capture' && <Btn tone="ask" onClick={startDebrief}><Sparkles size={14} />Start debrief</Btn>}
          {mode !== 'tutor' && <Btn onClick={startTutor}><GraduationCap size={14} />Teach a new hire</Btn>}
          <Link to={`/s/${sid}/map`}><Btn><MapIcon size={14} />Work Map</Btn></Link>
          <a href={`${API}/api/sessions/${sid}/export/skill`} target="_blank"><Btn tone="ghost" title="Agent-ready guardrails"><Download size={14} />Agent skill</Btn></a>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)_420px] gap-4 p-4">
        {/* LEFT: screen + voice */}
        <div className="scroll-thin flex min-h-0 flex-col gap-4 overflow-y-auto">
          <Section title="Shared screen" right={screen.stream ? <span className="num text-[10px] text-faint">{screen.frameCount} frames kept locally</span> : null}>
            {screen.stream ? (
              <video ref={screen.videoRef} muted className="aspect-video w-full rounded-lg border border-line bg-ink object-contain" />
            ) : (
              <button onClick={() => screen.start()} className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-2 text-sm text-muted hover:border-learn hover:text-text">
                <MonitorUp size={22} /> Share the expert’s screen
              </button>
            )}
            <label className="mt-3 flex items-center gap-2 text-[12px] text-muted">
              <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} className="accent-learn" />
              Vision events (Claude reads changed frames; PII blurred first)
            </label>
            {screen.lastVision && <div className="mt-2 text-[11.5px] italic text-faint">“{screen.lastVision}”</div>}
          </Section>

          <Section title="When to ask">
            <div className={`flex items-center gap-2 text-[13px] font-semibold ${activity?.paused ? 'text-learn' : 'text-muted'}`}>
              <PauseCircle size={16} /> {activity?.paused ? 'Natural pause — Shadow may speak' : 'Staying quiet'}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(activity?.blocking ?? []).map((b) => <span key={b} className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-muted">{b}</span>)}
            </div>
            <div className="num mt-2 text-[10.5px] text-faint">live questions: {m.questions_live} · budget 3–5 / 10 min · rest waits for debrief</div>
          </Section>

          <Section title={mode === 'tutor' ? 'Tutor voice' : 'Interviewer voice'} right={
            <Btn tone={voiceOn ? 'danger' : 'primary'} onClick={() => (voiceOn ? voice.stop() : voice.start().catch((err) => alert(err.message)))}>
              {voiceOn ? <><MicOff size={13} />Stop</> : <><Mic size={13} />Start voice</>}
            </Btn>
          }>
            <div className="text-[11px] text-faint">{voiceOn ? (voice.conv.isSpeaking ? 'Shadow is speaking…' : 'listening') : voice.conv.status}</div>
            <div className="scroll-thin mt-2 max-h-[300px] space-y-2 overflow-y-auto">
              {lines.map((l, i) => (
                <div key={i} className={`rounded-lg px-3 py-2 text-[12.5px] leading-snug ${l.who === 'agent' ? 'bg-ask/10 text-text' : 'bg-panel-2 text-muted'}`}>
                  <span className={`mr-1.5 text-[10px] font-bold uppercase ${l.who === 'agent' ? 'text-ask' : 'text-faint'}`}>{l.who === 'agent' ? 'Shadow' : mode === 'tutor' ? snap.trainee : snap.expert}</span>{l.text}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendTyped()}
                placeholder="Type instead of speaking…" className="min-w-0 flex-1 rounded-lg border border-line-2 bg-ink px-3 py-1.5 text-[12.5px] outline-none focus:border-learn" />
              <Btn onClick={sendTyped}><Send size={13} /></Btn>
            </div>
            {!voiceOn && (asked || mode === 'debrief') && (
              <button onClick={askNextTyped} className="mt-2 text-[11px] text-ask hover:underline">↳ show the pending question as text</button>
            )}
          </Section>

          {mode === 'tutor' && live.interventions.length > 0 && (
            <Section title="Interventions">
              {live.interventions.map((iv: Intervention) => (
                <div key={iv.id} className="mb-2 rounded-lg border border-ask/40 bg-ask/5 p-3 text-[12.5px]">
                  <div className="font-semibold text-ask">{iv.say}</div>
                  <div className="mt-1 text-muted">{iv.violation.title} — expected <b className="text-text">{iv.violation.expected}</b>, trainee chose <b className="text-gap">{iv.violation.got}</b></div>
                  {iv.screen_moment?.ts != null && <button onClick={() => setMoment({ ts: iv.screen_moment!.ts, quote: iv.violation.quote })} className="mt-1 text-[11px] text-predict hover:underline">▶ replay {snap.expert}’s moment {mmss(iv.screen_moment.ts)}</button>}
                </div>
              ))}
            </Section>
          )}
        </div>

        {/* MIDDLE: the mind */}
        <div className="scroll-thin flex min-h-0 flex-col gap-4 overflow-y-auto">
          <PredictionCard snap={snap} caseId={snap.current_case} />
          <AnimatePresence mode="popLayout">
            {question && <Question key={question.id} q={question} live={!!asked && asked.id === question.id} />}
          </AnimatePresence>
          {mode !== 'tutor' && <Hypotheses snap={snap} set={latestHyp} />}
          <Section title="Learning log" right={<span className="num text-[10.5px] text-faint">{m.silent_decisions} silent · {m.gaps} gaps</span>}>
            <Feed snap={snap} feed={live.feed} />
          </Section>
        </div>

        {/* RIGHT: the model */}
        <div className="scroll-thin flex min-h-0 flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-4 gap-2">
            {[
              ['accuracy', acc == null ? '—' : `${Math.round(acc * 100)}%`, 'text-predict'],
              ['asked', `${m.questions_live}+${m.questions_debrief}`, 'text-ask'],
              ['silent', `${m.silent_decisions}`, 'text-muted'],
              ['confirmed', `${m.rules_confirmed}/${m.rules_learned}`, 'text-learn'],
            ].map(([k, v, c]) => (
              <div key={k} className="panel px-3 py-2.5">
                <div className="label !text-[9px]">{k}</div>
                <motion.div key={v} initial={{ opacity: 0.3 }} animate={{ opacity: 1 }} className={`num mt-1 text-[19px] font-semibold ${c}`}>{v}</motion.div>
              </div>
            ))}
          </div>
          {mode === 'tutor' ? (
            <Section title={`${snap.trainee}’s mastery`}><Mastery snap={snap} /></Section>
          ) : (
            <Section title="Has Shadow understood?"><Checklist u={snap.understood} /></Section>
          )}
          {posteriors.length > 0 && (
            <Section title="Learned parameters">{posteriors.map((p) => <Threshold key={p.name} p={p} />)}</Section>
          )}
          <Section title="Work Map" right={<span className="num text-[10.5px] text-faint">v{snap.map.version}</span>}>
            <WorkMapView snap={snap} onMoment={openMoment} highlight={highlight} />
          </Section>
        </div>
      </div>

      {moment && <MomentModal frames={momentFrames} ts={moment.ts} quote={moment.quote} title={moment.title} onClose={() => setMoment(null)} />}
    </div>
  )
}
