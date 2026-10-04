import { API } from '../lib/api'

/** Mira, cropped out of the pixel-art sheets the companion uses. Pixelated, small; never a mascot. */
export default function Mira({ role, height = 96, className = '' }: { role: 'learn' | 'teach'; height?: number; className?: string }) {
  const learn = role === 'learn'
  const box = learn ? [145, 96, 426, 520] : [120, 260, 1120, 880]
  const src = `${API}/companion/${learn ? 'intern' : 'teacher'}.png`
  return (
    <svg
      role="img"
      aria-label={learn ? 'Mira, the apprentice, with her notebook' : 'Mira, the tutor, with her pointer'}
      viewBox={box.join(' ')}
      style={{ height, width: (height * box[2]) / box[3], imageRendering: 'pixelated' }}
      className={`block shrink-0 ${className}`}
    >
      <image href={src} width="1254" height="1254" style={{ imageRendering: 'pixelated' }} />
    </svg>
  )
}
