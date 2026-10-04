import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Intervention, Prediction, ShadowEvent, Snapshot } from './types'

export const API = import.meta.env.VITE_SHADOW_API ?? ''

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  const ct = r.headers.get('content-type') ?? ''
  return (ct.includes('json') ? r.json() : r.text()) as Promise<T>
}

export interface Live {
  snap: Snapshot | null
  feed: ShadowEvent[]
  asked: ShadowEvent | null
  lastLearned: ShadowEvent | null
  transcript: { who: string; text: string; t: number }[]
  interventions: Intervention[]
  replay: ShadowEvent | null
  activity: { paused: boolean; blocking: string[] } | null
}

const initial: Live = { snap: null, feed: [], asked: null, lastLearned: null, transcript: [], interventions: [], replay: null, activity: null }

function reduce(state: Live, e: ShadowEvent): Live {
  const feed = e.type === 'activity' ? state.feed : [e, ...state.feed].slice(0, 120)
  const s = state.snap
  if (e.type === 'snapshot') return { ...state, snap: e.snapshot, activity: e.snapshot.activity, interventions: state.interventions.length ? state.interventions : (e.snapshot.interventions ?? []) }
  if (!s) return { ...state, feed }
  const next: Snapshot = { ...s }
  switch (e.type) {
    case 'prediction':
      next.predictions = { ...s.predictions, [e.case_id]: e.prediction as Prediction }
      next.current_case = e.case_id
      break
    case 'episode':
      next.episodes = [...s.episodes, e.episode]
      next.metrics = e.metrics
      if (e.posteriors) next.posteriors = e.posteriors
      if (e.map) next.map = e.map
      break
    case 'silence':
      next.silence_log = [...s.silence_log, { case_id: e.case_id, field: e.field, value: e.value, why_silent: e.why_silent }]
      break
    case 'hypotheses':
      next.hypotheses = { ...s.hypotheses, [e.set.gap_id]: e.set }
      break
    case 'inquiry':
    case 'ask': {
      const q = e.inquiry
      const rest = s.inquiries.filter((x) => x.id !== q.id)
      next.inquiries = [...rest, q]
      break
    }
    case 'learned':
      next.map = e.map
      next.posteriors = e.posteriors
      next.metrics = e.metrics
      next.understood = e.understood
      next.inquiries = s.inquiries.map((q) => (q.id === e.inquiry_id ? { ...q, status: 'answered' } : q))
      break
    case 'record':
      next.off_record = e.off_record
      break
    case 'receipt': {
      const r = e.receipt
      next.receipts = e.update ? s.receipts.map((x) => (x.id === r.id ? r : x)) : [...s.receipts.filter((x) => x.id !== r.id), r]
      break
    }
    case 'ended':
      next.ended = true
      break
    case 'proof':
      next.proofs = { ...s.proofs, [e.proof.id]: e.proof }
      break
    case 'activity':
      return { ...state, activity: e.activity }
    case 'mode':
      next.mode = e.mode
      if (e.understood) next.understood = e.understood
      break
    case 'tutor_ok':
    case 'intervene':
      if (e.mastery) next.mastery = e.mastery
      break
  }
  return {
    ...state,
    snap: next,
    feed,
    asked: e.type === 'ask' ? e : e.type === 'learned' && state.asked?.inquiry?.id === e.inquiry_id ? null : state.asked,
    lastLearned: e.type === 'learned' ? e : state.lastLearned,
    transcript: e.type === 'utterance' ? [...state.transcript, { who: e.who, text: e.text, t: e.t }] : state.transcript,
    interventions: e.type === 'intervene' ? [e.intervention, ...state.interventions] : state.interventions,
    replay: e.type === 'replay' ? e : state.replay,
    activity: e.type === 'ask' && e.activity ? e.activity : state.activity,
  }
}

export function useShadow(sid: string | undefined) {
  const [live, dispatch] = useReducer(reduce, initial)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const listeners = useRef(new Set<(e: ShadowEvent) => void>())

  useEffect(() => {
    if (!sid) return
    let closed = false
    let retry: number | undefined
    const connect = () => {
      const base = API || location.origin
      const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws/panel/${sid}`)
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = window.setTimeout(connect, 1200)
      }
      ws.onmessage = (m) => {
        const e = JSON.parse(m.data) as ShadowEvent
        dispatch(e)
        listeners.current.forEach((fn) => fn(e))
      }
    }
    connect()
    return () => {
      closed = true
      window.clearTimeout(retry)
      wsRef.current?.close()
    }
  }, [sid])

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
  }, [])

  const on = useCallback((fn: (e: ShadowEvent) => void) => {
    listeners.current.add(fn)
    return () => { listeners.current.delete(fn) }
  }, [])

  const refresh = useCallback(() => send({ type: 'snapshot' }), [send])

  return { live, connected, send, on, refresh }
}

export const mmss = (t: number | null | undefined) => {
  if (t == null) return '--:--'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** The page a session's workflow lives on, pinned to the session: the ERP inbox, or a learned workflow's own page. */
export const appUrl = (erpUrl: string, home: string | null | undefined, sid: string) =>
  home ? `${home}?tacet=learn&shadow=${sid}` : `${erpUrl}/?shadow=${sid}`
