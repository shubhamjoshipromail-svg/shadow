import { motion } from 'framer-motion'
import type { Posterior } from '../lib/types'

export default function Threshold({ p }: { p: Posterior }) {
  const W = 360, H = 90
  const { grid, density } = p.curve
  const lo = Math.max(0, p.mean - 4 * Math.max(p.sd, 150))
  const hi = p.mean + 4 * Math.max(p.sd, 150)
  const pts = grid.map((x, i) => [x, density[i]] as const).filter(([x]) => x >= lo && x <= hi)
  const maxD = Math.max(...pts.map(([, d]) => d), 1e-9)
  const sx = (x: number) => ((x - lo) / (hi - lo)) * W
  const sy = (d: number) => H - 6 - (d / maxD) * (H - 16)
  const path = pts.map(([x, d], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(d).toFixed(1)}`).join(' ')
  const area = `${path} L${sx(pts.at(-1)?.[0] ?? hi)},${H} L${sx(pts[0]?.[0] ?? lo)},${H} Z`
  const basisP = p.basis_probs[p.basis] ?? 1
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-[12.5px] font-semibold">{p.name.replace('T_', '').replace('_', ' ')} threshold</div>
        <div className="num text-[12px]">
          <span className="text-learn">{p.mean.toLocaleString('de-DE', { maximumFractionDigits: 0 })}</span>
          <span className="text-faint"> ±{p.sd.toFixed(0)} · </span>
          <span className="text-hyp">{p.basis}</span>
          <span className="text-faint"> {Math.round(basisP * 100)}%</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full">
        <motion.path d={area} fill="rgba(61,220,151,.12)" initial={false} animate={{ d: area }} transition={{ duration: 0.8 }} />
        <motion.path d={path} fill="none" stroke="#3ddc97" strokeWidth={1.8} initial={false} animate={{ d: path }} transition={{ duration: 0.8 }} />
        <line x1={sx(p.mean)} x2={sx(p.mean)} y1={4} y2={H} stroke="#3ddc97" strokeDasharray="3 3" opacity={0.6} />
      </svg>
      <div className="num flex justify-between text-[10px] text-faint">
        <span>{lo.toFixed(0)}</span><span>{p.n_obs.toFixed(1)} observations</span><span>{hi.toFixed(0)}</span>
      </div>
    </div>
  )
}
