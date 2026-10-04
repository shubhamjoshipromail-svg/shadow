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
  const streamRef = useRef<MediaStream | null>(null) // the one stream this hook owns
  const frames = useRef<Frame[]>([])
  const [frameCount, setFrameCount] = useState(0)
  const [lastVision, setLastVision] = useState<string | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  // Capture ownership. `generation` invalidates a permission request that was still in
  // flight when the user stopped, restarted, or the console unmounted, so a late picker
  // result can never leave an orphaned track (and a second Chrome sharing indicator) behind.
  // `pending` dedupes concurrent start() calls so only one picker/stream can ever exist.
  const generation = useRef(0)
  const pending = useRef(false)
  const mounted = useRef(true)

  const dropFrames = useCallback(() => {
    for (const f of frames.current) URL.revokeObjectURL(f.url)
    frames.current = []
    if (mounted.current) setFrameCount(0)
  }, [])

  const stopTracks = useCallback((s: MediaStream | null) => {
    if (!s) return
    try { s.getTracks().forEach((t) => t.stop()) } catch { /* tracks already gone */ }
  }, [])

  /** Stop and forget the stream this hook owns, and release its in-memory frame URLs. */
  const release = useCallback(() => {
    const s = streamRef.current
    streamRef.current = null
    stopTracks(s)
    dropFrames()
    if (mounted.current) setStream(null)
  }, [dropFrames, stopTracks])

  const start = useCallback(async () => {
    if (!mounted.current) return
    if (streamRef.current) return // already sharing: never open a second stream
    if (pending.current) return // one permission request at a time
    pending.current = true
    const mine = ++generation.current
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false })
      // Stop/unmount/newer start happened while the picker was open: drop this stream.
      if (!mounted.current || mine !== generation.current) { stopTracks(s); return }
      const track = s.getVideoTracks()[0]
      if (track) track.addEventListener('ended', () => { if (streamRef.current === s) release() })
      streamRef.current = s
      setStream(s)
    } catch {
      /* picker cancelled or denied: stay off, silently */
    } finally {
      if (mine === generation.current) pending.current = false
    }
  }, [release, stopTracks])

  const stop = useCallback(() => {
    generation.current++ // invalidate a permission request still in flight
    pending.current = false
    release()
  }, [release])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
      pending.current = false
      release()
    }
  }, [release])

  useEffect(() => {
    if (!stream || !videoRef.current) return
    const video = videoRef.current
    video.srcObject = stream
    void video.play()
    let disposed = false
    const small = document.createElement('canvas')
    small.width = HASH
    small.height = 9
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    const big = document.createElement('canvas')
    const bctx = big.getContext('2d')!
    let prev: Uint8Array | null = null
    let lastSent = 0
    let busy = false
    // a frame is only kept while this exact stream is still the owned one
    const live = () => !disposed && streamRef.current === stream

    const timer = window.setInterval(async () => {
      if (!live() || !video.videoWidth) return
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
      if (!blob || !live() || optsRef.current.paused) return // capture may stop or pause while encoding
      frames.current.push({ epoch: Date.now() / 1000, url: URL.createObjectURL(blob) })
      if (frames.current.length > 1500) URL.revokeObjectURL(frames.current.shift()!.url)
      setFrameCount(frames.current.length)
      if (!changed) return
      optsRef.current.send({ type: 'screen_changed' })
      const now = Date.now()
      if (optsRef.current.vision && optsRef.current.sid && !busy && now - lastSent > 2500) {
        busy = true
        lastSent = now
        const visionSid = optsRef.current.sid
        const b64 = await blobToB64(blob)
        if (!live() || optsRef.current.paused || !optsRef.current.vision || optsRef.current.sid !== visionSid) {
          busy = false
          return
        }
        try {
          const reading = await api<{ summary?: string }>(`/api/sessions/${visionSid}/frames`, {
            method: 'POST', body: JSON.stringify({ image: b64, media_type: 'image/jpeg' }),
          })
          if (live() && reading.summary) setLastVision(reading.summary)
        } catch { /* vision is best-effort */ }
        busy = false
      }
    }, 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
      if (video.srcObject === stream) video.srcObject = null
    }
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
