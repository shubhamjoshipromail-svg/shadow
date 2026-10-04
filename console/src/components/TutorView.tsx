import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API, api, mmss } from '../lib/api'
import type { Intervention, ShadowEvent, Snapshot } from '../lib/types'
import { Btn, Dot, Section, Testimony, Wordmark } from './ui'
import Mastery from './Mastery'
import Mira from './Mira'

const LANG: Record<string, string> = { en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español' }

interface Report { rules: { id: string; title: string; status: string; p: number | null }[]; practice_next: { title: string; p: number } | null; next_case: string | null }
interface Summary { learner: string; mastered: { title: string; p: number }[]; practice: { title: string; p: number | null; status: string }[]; next_case: string | null; independent: { ok: number; of: number } }

/** The tutor session: the new hire's practice, seen from the side. Nothing here asks the expert anything. */
export default function TutorView(p: {
  sid: string; snap: Snapshot; connected: boolean; feed: ShadowEvent[]; interventions: Intervention[]; erpUrl: string
  voiceOn: boolean; voiceStatus: string; onVoice: () => void
  lines: { who: 'agent' | 'user'; text: string; at: number }[]
  typed: string; setTyped: (s: string) => void; sendTyped: () => void
  onMoment: (ts: number | null, quote: Intervention['violation']['quote']) => void
  shareScreen: () => void; sharing: boolean
  send: (m: Record<string, unknown>) => void
}) {
  const { snap, sid } = p
  const learner = snap.trainee || 'the new hire'
  const [report, setReport] = useState<Report | null>(null)
  const tick = p.feed.filter((e) => ['tutor_ok', 'tutor_saved', 'intervene', 'tutor_summary'].includes(e.type)).length
  useEffect(() => { api<Report>(`/api/sessions/${sid}/tutor/report`).then(setReport).catch(() => {}) }, [sid, tick])

  const summary = (p.feed.find((e) => e.type === 'tutor_summary') as unknown as Summary | undefined) ?? null
  const caseId = snap.current_case
  const kase = snap.cases.find((c) => c.id === caseId)
  const caseEvents = p.feed.filter((e) => e.case_id === caseId)
  const prompt = caseEvents.find((e) => e.type === 'tutor_case')?.prompt as string | undefined
  const stops = p.interventions.filter((iv) => iv.case_id === caseId)
  const saved = caseEvents.some((e) => e.type === 'tutor_saved')
  const firstTry = caseEvents.find((e) => e.type === 'tutor_ok')
  const hints = p.feed.filter((e) => e.type === 'nudge' && e.case_id === caseId)
  const fromV = snap.map_source.kind === 'saved' || snap.map_source.kind === 'session' ? snap.map_source.version : snap.map.version
  const done = p.feed.filter((e) => e.type === 'tutor_saved').length
  const lang = snap.learner_lang && snap.learner_lang !== 'en' ? LANG[snap.learner_lang] ?? snap.learner_lang : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-rule-strong bg-sheet px-5 py-2.5">
        <Link to="/"><Wordmark /></Link>
        <div className="flex items-center gap-3">
          <Mira role="teach" height={44} />
          <div>
            <div className="text-[13.5px] text-ink-1">Mira tutor · {learner} practising {snap.pack.name}</div>
            <div className="num flex flex-wrap items-center gap-x-3 text-[11px] text-ink-2">
              <span>taught from {snap.expert}’s Work Map v{fromV}</span>
              {lang && <span>teaching in {lang}</span>}
              <span className="flex items-center gap-1.5"><Dot on={p.connected} />{p.connected ? 'connected' : 'reconnecting'}</span>
              {snap.simulated && <span className="text-candidate">practice run · simulated new hire</span>}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Btn onClick={() => p.send({ type: 'finish_practice' })} tone="ask">Finish practice</Btn>
          <Link to={`/s/${sid}/map`}><Btn tone="ghost">Work Map</Btn></Link>
          <Link to="/"><Btn tone="ghost">Home</Btn></Link>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-5 lg:content-stretch px-5 py-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="scroll-thin flex min-h-0 flex-col gap-5 lg:overflow-y-auto">
          <Section title={`${learner}’s screen`}>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <a href={`${p.erpUrl}/?shadow=${sid}`} target="nordwerk-erp">
                <Btn tone="primary">Open the ERP as {learner} ↗</Btn>
              </a>
              <button onClick={p.shareScreen} className="text-[12.5px] text-inferred hover:underline">
                {p.sharing ? `Sharing ${learner}’s screen` : `or share ${learner}’s screen`}
              </button>
            </div>
            <p className="mb-0 mt-2.5 max-w-[60ch] text-[12.5px] leading-snug text-ink-2">
              {learner} works the cases there. Mira sits in the corner, and stops a save that {snap.expert} would not have made.
            </p>
          </Section>

          <Section title="Current case" right={<span className="num text-[10.5px] text-ink-3">{done} saved</span>}>
            {!caseId ? (
              <div className="testimony text-[20px] text-ink-2">Waiting for {learner} to open a case.</div>
            ) : (
              <div className="space-y-3 text-[13px]">
                <div className="text-[15px] font-medium">
                  {kase?.invoice_no ? <>Invoice <span className="num">{kase.invoice_no}</span></> : <span className="num">{caseId}</span>}
                  {kase?.supplier && <span className="text-ink-2"> · {kase.supplier.name}</span>}
                </div>
                {prompt && <div className="border-l-2 border-rule-strong pl-3 text-ink-2"><span className="label mr-2">Mira said</span>{prompt}</div>}
                <div className="num text-[11.5px] text-ink-2">
                  {saved
                    ? firstTry
                      ? <span className="text-confirmed">✓ saved on the first try</span>
                      : <span className="text-confirmed">✓ saved after {stops.length} stop{stops.length === 1 ? '' : 's'}</span>
                    : stops.length ? <span className="text-binding">■ stopped {stops.length}×, not saved yet</span> : 'working on it'}
                </div>
                {hints.length > 0 && (
                  <div className="space-y-1">
                    {hints.map((h, i) => <div key={i} className="text-ink-2"><span className="label mr-2">hint {h.level}</span>{h.text}</div>)}
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section title="Where Mira stepped in">
            {p.interventions.length === 0 && <div className="text-[12.5px] text-ink-3">Nothing yet. Mira only speaks before a mistake would be saved.</div>}
            <div className="space-y-4">
              {p.interventions.map((iv) => (
                <div key={iv.id} className="border border-l-[3px] border-rule border-l-binding px-3.5 py-3">
                  <div className="num text-[10.5px] uppercase tracking-[.06em] text-binding">stopped before save · {iv.case_id}</div>
                  <div className="mt-1.5 text-[13px] text-ink-1">{iv.violation.title}: expected <b className="font-medium">{iv.violation.expected}</b>, chose <span className="text-binding">{iv.violation.got}</span></div>
                  {iv.violation.quote && <div className="mt-2.5"><Testimony quote={iv.violation.quote} size="sm" /></div>}
                  <div className="mt-2 text-[12.5px] text-ink-2">{iv.explain}</div>
                  {iv.screen_moment?.ts != null && (
                    <button onClick={() => p.onMoment(iv.screen_moment!.ts, iv.violation.quote)} className="num mt-2 text-[10.5px] text-inferred hover:underline">▶ {snap.expert}’s moment {mmss(iv.screen_moment.ts)}</button>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Talk with Mira" right={
            <Btn tone={p.voiceOn ? 'danger' : 'primary'} onClick={p.onVoice}>{p.voiceOn ? 'Stop voice' : 'Start voice'}</Btn>
          }>
            <div className="num text-[10.5px] text-ink-3">{p.voiceStatus}</div>
            <div className="scroll-thin mt-2 max-h-[220px] divide-y divide-rule overflow-y-auto">
              {p.lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[52px_1fr] gap-2 py-1.5 text-[12.5px] leading-snug">
                  <span className={`num pt-px text-[10px] uppercase tracking-[.06em] ${l.who === 'agent' ? 'text-query' : 'text-ink-3'}`}>{l.who === 'agent' ? 'Mira' : learner}</span>
                  <span className="text-ink-1">{l.text}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input value={p.typed} onChange={(e) => p.setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && p.sendTyped()}
                placeholder="Type to Mira…" className="min-w-0 flex-1 rounded-[3px] border border-rule-strong bg-sheet px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-ink-3 focus:border-ink-2" />
              <Btn onClick={p.sendTyped}>Send</Btn>
            </div>
          </Section>
        </div>

        <div className="scroll-thin flex min-h-0 flex-col gap-5 lg:overflow-y-auto">
          <Section title={`${learner}’s mastery, rule by rule`}><Mastery snap={snap} /></Section>

          <Section title="What to practise next" right={<a href={`${API}/api/sessions/${sid}/tutor/report`} target="_blank" className="num text-[10.5px] text-inferred hover:underline">report ↗</a>}>
            {summary ? (
              <div className="space-y-3 text-[13px]">
                <div className="num text-[12px] text-ink-2">first try: <span className="text-ink-1">{summary.independent.ok} of {summary.independent.of}</span></div>
                {summary.mastered.length > 0 && <div><div className="label mb-1">Solid</div>{summary.mastered.map((m) => <div key={m.title} className="text-confirmed">✓ {m.title}</div>)}</div>}
                {summary.practice.length > 0 && <div><div className="label mb-1">Practise</div>{summary.practice.map((m) => <div key={m.title} className="text-ink-1">◌ {m.title} <span className="num text-[10.5px] text-ink-3">{m.status}</span></div>)}</div>}
                {summary.next_case && <div className="num text-[11.5px] text-ink-2">next case: {summary.next_case}</div>}
              </div>
            ) : report?.practice_next ? (
              <div className="text-[13px]">
                <div className="text-ink-1">{report.practice_next.title}</div>
                <div className="num mt-1 text-[11px] text-ink-3">weakest so far · mastery {report.practice_next.p.toFixed(2)}{report.next_case ? ` · next case ${report.next_case}` : ''}</div>
              </div>
            ) : (
              <div className="text-[12.5px] text-ink-3">Appears once {learner} has worked a case. “Finish practice” writes the report card.</div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
