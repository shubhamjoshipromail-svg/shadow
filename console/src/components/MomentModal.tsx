import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { Frame } from '../lib/screen'
import type { Quote } from '../lib/types'
import { mmss } from '../lib/api'

/** Replays a screen moment as a short flipbook of the frames kept in the browser. */
export default function MomentModal({ frames, ts, quote, title, onClose }: {
  frames: Frame[]; ts: number | null; quote?: Quote | null; title?: string; onClose: () => void
}) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (frames.length < 2) return
    const t = window.setInterval(() => setI((x) => (x + 1) % frames.length), 700)
    return () => window.clearInterval(t)
  }, [frames])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}
        className="panel w-full max-w-4xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="text-sm font-semibold">Screen moment <span className="num text-predict">{mmss(ts)}</span>{title && <span className="text-muted"> · {title}</span>}</div>
          <button onClick={onClose} className="text-muted hover:text-text"><X size={16} /></button>
        </div>
        {frames.length ? <img src={frames[i]?.url} className="w-full" /> : <div className="p-16 text-center text-sm text-muted">No frames kept for this moment (screen wasn’t shared in this browser).</div>}
        {quote && (
          <div className="border-t border-line px-5 py-4">
            <div className="font-serif text-xl italic">“{quote.translation ?? quote.text}”</div>
            {quote.translation && <div className="mt-1 text-xs italic text-faint">original: “{quote.text}”</div>}
            <div className="num mt-1 text-xs text-muted">— {quote.speaker}, {mmss(quote.ts)}</div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
