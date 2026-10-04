import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConversationProvider } from '@elevenlabs/react'
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
import Receipts from '../components/Receipts'
import { Btn, Dot, Section, Wordmark } from '../components/ui'

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
  const [erpUrl, setErpUrl] = useState('http://localhost:8080')
  useEffect(() => { api<{ erp_url?: string }>('/api/config').then((c) => c.erp_url && setErpUrl(c.erp_url)).catch(() => {}) }, [])

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
    return <div className="flex h-full items-center justify-center text-[13px] text-ink-2">{connected ? 'Opening the session…' : 'Connecting to Shadow Core…'}</div>
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

  const modeWord = mode === 'capture' ? 'Capture' : mode === 'debrief' ? 'Debrief' : 'Tutor'
  const stats: [string, string][] = [
    ['predicted right', acc == null ? '—' : `${Math.round(acc * 100)}%`],
    ['asked live + debrief', `${m.questions_live} + ${m.questions_debrief}`],
    ['stayed quiet', `${m.silent_decisions}`],
    ['rules confirmed', `${m.rules_confirmed} / ${m.rules_learned}`],
  ]

  return (
    <div className="flex h-full flex-col">
      {/* folio */}
      <header className="flex items-center gap-4 border-b border-rule-strong bg-sheet px-5 py-2.5">
        <Link to="/"><Wordmark /></Link>
        <div className="num flex items-center gap-3 text-[11px] text-ink-2">
          <span className="text-ink-1">{modeWord}</span>
          <span>{mode === 'tutor' ? `${snap.trainee} learning from ${snap.expert}` : snap.expert}</span>
          <span className="flex items-center gap-1.5"><Dot on={connected && !snap.off_record} />{snap.off_record ? 'off the record' : connected ? 'on record' : 'reconnecting'}</span>
          <span>map v{snap.map.version}{snap.map_source.kind === 'saved' ? ` · continued from saved v${snap.map_source.version}` : ''}</span>
          {snap.pending.compiling && <span className="text-query">compiling an answer…</span>}
          {snap.ended && <span className="text-binding">session ended</span>}
          {snap.simulated && <span className="text-candidate">practice run · simulated {mode === 'tutor' ? 'trainee' : snap.expert}</span>}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {snap.simulated && <>
            <Btn tone="ghost" onClick={simStep}>step</Btn>
            <Btn tone="ghost" onClick={() => setAutoplay((a) => !a)}>{autoplay ? 'pause' : 'autoplay'}</Btn>
          </>}
          <Btn tone="ghost" onClick={toggleRecord}>{snap.off_record ? 'Back on record' : 'Off the record'}</Btn>
          {mode === 'capture' && <Btn tone="ask" onClick={startDebrief}>Start debrief</Btn>}
          {mode !== 'tutor' && <Btn onClick={startTutor}>Teach a new hire</Btn>}
          {mode !== 'tutor' && !snap.simulated && <Link to={`/s/${sid}/proof`}><Btn title="Sealed test on unseen cases">Test it</Btn></Link>}
          <Link to={`/s/${sid}/map`}><Btn tone="primary">Work Map</Btn></Link>
          <Link to={`/s/${sid}/data`}><Btn tone="ghost" title="What was collected, where it lives">Data</Btn></Link>
          <a href={`${API}/api/sessions/${sid}/export/skill`} target="_blank"><Btn tone="ghost" title="Agent-ready guardrails">Agent skill ↗</Btn></a>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_400px] gap-5 px-5 py-5">
        {/* LEFT: the exhibit + the conversation */}
        <div className="scroll-thin flex min-h-0 flex-col gap-5 overflow-y-auto">
          <Section title="The expert's screen" right={screen.stream ? <span className="num text-[10px] text-ink-3">{screen.frameCount} frames, kept locally</span> : null}>
            {screen.stream ? (
              <video ref={screen.videoRef} muted className="aspect-video w-full border border-rule bg-wash object-contain" />
            ) : (
              <button onClick={() => screen.start()} className="flex aspect-video w-full flex-col items-center justify-center gap-1 border border-dashed border-rule-strong text-[13px] text-ink-2 hover:border-ink-2 hover:text-ink-1">
                Share the expert’s screen
                <span className="text-[11px] text-ink-3">frames stay in this browser</span>
              </button>
            )}
            <label className="mt-3 flex items-start gap-2 text-[12px] text-ink-2">
              <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} className="mt-0.5 accent-[#4e6b44]" />
              Read changed frames with a vision model (personal data blurred first)
            </label>
            {screen.lastVision && <div className="mt-2 text-[11.5px] italic text-ink-3">read: “{screen.lastVision}”</div>}
            <a href={`${erpUrl}/?shadow=${sid}`} target="nordwerk-erp" className="mt-3 block border-t border-rule pt-2.5 text-[12px] text-inferred hover:underline">
              Open Nordwerk ERP ↗ <span className="num text-[10.5px] text-ink-3">(pinned to this session)</span>
            </a>
          </Section>

          <Section title="When to ask">
            <div className={`text-[13px] ${activity?.paused ? 'text-confirmed' : 'text-ink-2'}`}>
              {activity?.paused ? 'Natural pause. Shadow may speak.' : 'She is working. Shadow stays quiet.'}
            </div>
            {(activity?.blocking ?? []).length > 0 && (
              <div className="num mt-1.5 text-[10.5px] text-ink-3">waiting on: {(activity?.blocking ?? []).join(' · ')}</div>
            )}
            <div className="num mt-2 text-[10.5px] text-ink-3">{m.questions_live} asked live · budget 3–5 per 10 min · the rest waits for the debrief</div>
          </Section>

          <Section title={mode === 'tutor' ? 'Tutor · conversation' : 'Interview · conversation'} right={
            <Btn tone={voiceOn ? 'danger' : 'primary'} onClick={() => (voiceOn ? voice.stop() : voice.start().catch((err) => alert(err.message)))}>
              {voiceOn ? 'Stop voice' : 'Start voice'}
            </Btn>
          }>
            <div className="num text-[10.5px] text-ink-3">{voiceOn ? (voice.conv.isSpeaking ? 'Shadow is speaking' : 'listening') : voice.conv.status}</div>
            <div className="scroll-thin mt-2 max-h-[280px] divide-y divide-rule overflow-y-auto">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[52px_1fr] gap-2 py-1.5 text-[12.5px] leading-snug">
                  <span className={`num pt-px text-[10px] uppercase tracking-[.06em] ${l.who === 'agent' ? 'text-query' : 'text-ink-3'}`}>{l.who === 'agent' ? 'Shadow' : mode === 'tutor' ? snap.trainee : snap.expert}</span>
                  <span className={l.who === 'agent' ? 'text-ink-1' : 'testimony text-[14px] text-ink-1'}>{l.who === 'agent' ? l.text : `“${l.text}”`}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendTyped()}
                placeholder="Type an answer instead of speaking…" className="min-w-0 flex-1 rounded-[3px] border border-rule-strong bg-sheet px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-ink-2" />
              <Btn onClick={sendTyped}>Send</Btn>
            </div>
            {!voiceOn && (asked || mode === 'debrief') && (
              <button onClick={askNextTyped} className="mt-2 text-[11.5px] text-query hover:underline">show the pending question as text</button>
            )}
          </Section>



          {mode === 'tutor' && live.interventions.length > 0 && (
            <Section title="Stops">
              <div className="space-y-3">
                {live.interventions.map((iv: Intervention) => (
                  <div key={iv.id} className="border border-l-[3px] border-rule border-l-binding px-3 py-2 text-[12.5px]">
                    <div className="font-medium text-ink-1">{iv.say}</div>
                    <div className="mt-1 text-ink-2">{iv.violation.title}: expected <b className="font-medium text-ink-1">{iv.violation.expected}</b>, chose <span className="text-binding">{iv.violation.got}</span></div>
                    {iv.screen_moment?.ts != null && <button onClick={() => setMoment({ ts: iv.screen_moment!.ts, quote: iv.violation.quote })} className="num mt-1 text-[10.5px] text-inferred hover:underline">▶ {snap.expert}’s moment {mmss(iv.screen_moment.ts)}</button>}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* MIDDLE: what Shadow thinks, asks, and learned */}
        <div className="scroll-thin flex min-h-0 flex-col gap-5 overflow-y-auto">
          <PredictionCard snap={snap} caseId={snap.current_case} />
          {question && <div className="px-1"><Question key={question.id} q={question} live={!!asked && asked.id === question.id} /></div>}
          {mode !== 'tutor' && <Hypotheses snap={snap} set={latestHyp} />}
          {mode !== 'tutor' && (
            <Section title="Learning receipts" right={<Link to={`/s/${sid}/proof`} className="text-[11.5px] text-inferred hover:underline">sealed test →</Link>}>
              <Receipts snap={snap} limit={4} />
            </Section>
          )}
          <Section title="Ledger" right={<span className="num text-[10.5px] text-ink-3">{m.silent_decisions} quiet · {m.gaps} surprises</span>}>
            <Feed snap={snap} feed={live.feed} />
          </Section>
        </div>

        {/* RIGHT: the model */}
        <div className="scroll-thin flex min-h-0 flex-col gap-5 overflow-y-auto">
          <div className="panel grid grid-cols-4 divide-x divide-rule">
            {stats.map(([k, v]) => (
              <div key={k} className="px-3 py-2.5">
                <div className="num text-[18px] text-ink-1">{v}</div>
                <div className="mt-0.5 text-[10.5px] leading-tight text-ink-3">{k}</div>
              </div>
            ))}
          </div>
          {mode === 'tutor' ? (
            <Section title={`${snap.trainee}’s mastery`}><Mastery snap={snap} /></Section>
          ) : (
            <Section title="Has Shadow understood?"><Checklist u={snap.understood} /></Section>
          )}
          {posteriors.length > 0 && (
            <Section title="Learned parameters"><div className="space-y-4">{posteriors.map((p) => <Threshold key={p.name} p={p} />)}</div></Section>
          )}
          <Section title="Work Map" right={<span className="num text-[10.5px] text-ink-3">v{snap.map.version}</span>}>
            <WorkMapView snap={snap} onMoment={openMoment} highlight={highlight} />
          </Section>
        </div>
      </div>

      {moment && <MomentModal frames={momentFrames} ts={moment.ts} quote={moment.quote} title={moment.title} onClose={() => setMoment(null)} />}
    </div>
  )
}
