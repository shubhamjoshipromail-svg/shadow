import { useEffect, useRef, useState } from 'react'
import { useConversation } from '@elevenlabs/react'
import type { ShadowEvent } from './types'
import { api } from './api'

export const AGENTS = {
  interviewer: () => localStorage.getItem('shadow.agent.interviewer') || import.meta.env.VITE_EL_AGENT_INTERVIEWER || '',
  tutor: () => localStorage.getItem('shadow.agent.tutor') || import.meta.env.VITE_EL_AGENT_TUTOR || '',
}

const TAG = /\[\[shadow:[^\]]*\]\]/g

export interface VoiceLine { who: 'agent' | 'user'; text: string; at: number }

/**
 * Bridges Tacet and the ElevenLabs agent.
 * Tacet decides what to say (server, via Custom LLM); this hook only triggers turns at the right time,
 * reports who is speaking (for pause detection), and keeps a transcript.
 */
export function useVoiceBridge(opts: {
  sid?: string
  mode: 'capture' | 'debrief' | 'tutor'
  lang: string
  send: (m: Record<string, unknown>) => void
  on: (fn: (e: ShadowEvent) => void) => () => void
}) {
  const [lines, setLines] = useState<VoiceLine[]>([])
  const userSpeaking = useRef(false)
  const quietSince = useRef(0)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const conv = useConversation({
    onMessage: ({ message, role }) => {
      const text = message.replace(TAG, '').trim()
      if (text) setLines((l) => [...l.slice(-60), { who: role === 'agent' ? 'agent' : 'user', text, at: Date.now() }])
    },
    onModeChange: ({ mode }) => optsRef.current.send({ type: 'speech', who: 'agent', speaking: mode === 'speaking' }),
    onVadScore: ({ vadScore }) => {
      const now = Date.now()
      if (vadScore > 0.6 && !userSpeaking.current) {
        userSpeaking.current = true
        optsRef.current.send({ type: 'speech', who: 'user', speaking: true })
      } else if (vadScore < 0.3) {
        if (!quietSince.current) quietSince.current = now
        if (userSpeaking.current && now - quietSince.current > 600) {
          userSpeaking.current = false
          optsRef.current.send({ type: 'speech', who: 'user', speaking: false })
        }
      }
      if (vadScore >= 0.3) quietSince.current = 0
    },
  })

  const token = useRef('')

  // Tacet's planner decides *when*; we just trigger the agent's turn.
  useEffect(() => opts.on((e) => {
    // one voice per session: the companion on the work page took it, so this conversation hangs up
    if (e.type === 'voice_owner' && e.token !== token.current && conv.status === 'connected') { conv.endSession(); return }
    if (conv.status !== 'connected') return
    if (e.type === 'ask' && optsRef.current.mode === 'capture') conv.sendUserMessage(`[[shadow:ask ${e.inquiry.id}]]`)
    if (e.type === 'intervene') conv.sendUserMessage(`[[shadow:intervene ${e.intervention.id}]]`)
    if (e.type === 'tutor_case') conv.sendContextualUpdate(`The trainee opened a new case: ${e.case_id}.`)
  }), [opts, conv])

  const start = async () => {
    const role = opts.mode === 'tutor' ? 'tutor' : 'interviewer'
    // the server's agent ids win: a stale id kept in this browser is a different agent, with a different voice
    const served = await api<{ agents: { interviewer?: string; tutor?: string } }>('/api/config').then((c) => c.agents[role]).catch(() => undefined)
    const agentId = served || AGENTS[role]()
    if (!agentId) throw new Error(`Set the ElevenLabs ${role} agent id on the home page first.`)
    await navigator.mediaDevices.getUserMedia({ audio: true })
    await conv.startSession({
      agentId,
      connectionType: 'webrtc',
      dynamicVariables: { shadow_session: opts.sid ?? '', shadow_mode: opts.mode },
      customLlmExtraBody: { shadow_session: opts.sid },
      // the expert's language is detected by the agent (Scribe + language_detection); only the new hire's is chosen
      overrides: opts.mode === 'debrief'
        ? { agent: { firstMessage: 'Thanks, that was really useful. Mind if I ask a few things I’m still unsure about?' } }
        : opts.mode === 'tutor' && opts.lang && opts.lang !== 'auto'
          ? { agent: { language: opts.lang as never } }
          : undefined,
    })
    token.current = Math.random().toString(36).slice(2)
    if (opts.sid) await api(`/api/sessions/${opts.sid}/voice`, { method: 'POST', body: JSON.stringify({ client: 'console', token: token.current }) }).catch(() => {})
  }

  const kickDebrief = () => conv.sendUserMessage('[[shadow:debrief]]')

  return { conv, lines, start, stop: () => conv.endSession(), kickDebrief }
}
