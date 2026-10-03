import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/** One sampled frame kept in memory so screen moments can be replayed (no video ever leaves the browser). */
export interface Frame { epoch: number; url: string }

type Rect = [number, number, number, number]

const HASH = 16 // 16x9 average hash

function aHash(ctx: CanvasRenderingContext2D, video: HTMLVideoElement): Uint8Array {
  ctx.drawImage(video, 0, 0, HASH, 9)
  const d = ctx.getImageData(0, 0, HASH, 9).data
  const g = new Float32Array(HASH * 9)
  let sum = 0
  for (let i = 0; i < g.length; i++) {
    g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11
    sum += g[i]
  }
  const avg = sum / g.length
  return Uint8Array.from(g, (v) => (v > avg ? 1 : 0))
}

const hamming = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0)

export function useScreen(opts: {
  sid?: string
  send: (m: Record<string, unknown>) => void
  vision: boolean
  piiRects: { rects: Rect[]; vw: number; vh: number } | null
  paused: boolean
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const frames = useRef<Frame[]>([])
  const [frameCount, setFrameCount] = useState(0)
  const [lastVision, setLastVision] = useState<string | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const start = useCallback(async () => {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false })
    s.getVideoTracks()[0].addEventListener('ended', () => setStream(null))
    setStream(s)
  }, [])

  const stop = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop())
    setStream(null)
  }, [stream])

  useEffect(() => {
    if (!stream || !videoRef.current) return
    const video = videoRef.current
    video.srcObject = stream
    void video.play()
    const small = document.createElement('canvas')
    small.width = HASH
    small.height = 9
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    const big = document.createElement('canvas')
    const bctx = big.getContext('2d')!
    let prev: Uint8Array | null = null
    let lastSent = 0
    let busy = false

    const timer = window.setInterval(async () => {
      if (!video.videoWidth) return
      const h = aHash(sctx, video)
      const changed = !prev || hamming(prev, h) > 5
      prev = h
      const w = Math.min(1280, video.videoWidth)
      big.width = w
      big.height = Math.round((video.videoHeight / video.videoWidth) * w)
      bctx.drawImage(video, 0, 0, big.width, big.height)
      // blur personal data regions reported by the observed app before anything is stored or sent
      const pii = optsRef.current.piiRects
      if (pii && pii.vw) {
        const sx = big.width / pii.vw
        const sy = big.height / pii.vh
        for (const [x, y, rw, rh] of pii.rects) {
          bctx.save()
          bctx.filter = 'blur(9px)'
          bctx.drawImage(big, x * sx, y * sy, rw * sx, rh * sy, x * sx, y * sy, rw * sx, rh * sy)
          bctx.restore()
          bctx.fillStyle = 'rgba(120,130,145,.55)'
          bctx.fillRect(x * sx, y * sy, rw * sx, rh * sy)
        }
      }
      if (optsRef.current.paused) return // off the record: nothing is kept
      const blob = await new Promise<Blob | null>((r) => big.toBlob(r, 'image/jpeg', 0.6))
      if (!blob) return
      frames.current.push({ epoch: Date.now() / 1000, url: URL.createObjectURL(blob) })
      if (frames.current.length > 1500) URL.revokeObjectURL(frames.current.shift()!.url)
      setFrameCount(frames.current.length)
      if (!changed) return
      optsRef.current.send({ type: 'screen_changed' })
      const now = Date.now()
      if (optsRef.current.vision && optsRef.current.sid && !busy && now - lastSent > 2500) {
        busy = true
        lastSent = now
        const b64 = await blobToB64(blob)
        try {
          const reading = await api<{ summary?: string }>(`/api/sessions/${optsRef.current.sid}/frames`, {
            method: 'POST', body: JSON.stringify({ image: b64, media_type: 'image/jpeg' }),
          })
          if (reading.summary) setLastVision(reading.summary)
        } catch { /* vision is best-effort */ }
        busy = false
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [stream])

  const frameAt = useCallback((epoch: number): Frame | null => {
    const fs = frames.current
    if (!fs.length) return null
    let best = fs[0]
    for (const f of fs) if (Math.abs(f.epoch - epoch) < Math.abs(best.epoch - epoch)) best = f
    return Math.abs(best.epoch - epoch) < 30 ? best : null
  }, [])

  const framesAround = useCallback((epoch: number, before = 3, after = 3): Frame[] =>
    frames.current.filter((f) => f.epoch >= epoch - before && f.epoch <= epoch + after), [])

  return { videoRef, stream, start, stop, frameAt, framesAround, frameCount, lastVision }
}

async function blobToB64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}
