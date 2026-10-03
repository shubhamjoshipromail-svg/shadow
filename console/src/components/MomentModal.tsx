import { useEffect, useState } from 'react'
import type { Frame } from '../lib/screen'
import type { Quote } from '../lib/types'
import { mmss } from '../lib/api'
import { Testimony } from './ui'

/** Replays a screen moment as a short flipbook of the frames kept in this browser, with her words beneath. */
export default function MomentModal({ frames, ts, quote, title, onClose }: {
  frames: Frame[]; ts: number | null; quote?: Quote | null; title?: string; onClose: () => void
}) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (frames.length < 2) return
    const t = window.setInterval(() => setI((x) => (x + 1) % frames.length), 700)
    return () => window.clearInterval(t)
  }, [frames])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#22201c]/45 p-8" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="panel ink-in w-full max-w-4xl overflow-hidden">
        <div className="flex items-baseline justify-between border-b border-rule px-4 py-2.5">
          <div className="text-[13px]">Screen moment <span className="num">{mmss(ts)}</span>{title && <span className="text-ink-2"> · {title}</span>}</div>
          <button onClick={onClose} className="num text-[11px] text-ink-2 hover:text-ink-1">close (esc)</button>
        </div>
        {frames.length
          ? <img src={frames[i]?.url} className="block w-full" />
          : <div className="px-8 py-16 text-center text-[13px] text-ink-2">No frames were kept for this moment. The screen wasn’t shared in this browser.</div>}
        {quote && <div className="border-t border-rule px-5 py-4"><Testimony quote={quote} /></div>}
      </div>
    </div>
  )
}
