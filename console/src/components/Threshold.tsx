import type { Posterior } from '../lib/types'

/** A learned threshold as a measured ruler: the density in hairline, the ±1σ interval bracketed, the estimate marked. */
export default function Threshold({ p }: { p: Posterior }) {
  const W = 360, H = 78
  const { grid, density } = p.curve
  const lo = Math.max(0, p.mean - 4 * Math.max(p.sd, 150))
  const hi = p.mean + 4 * Math.max(p.sd, 150)
  const pts = grid.map((x, i) => [x, density[i]] as const).filter(([x]) => x >= lo && x <= hi)
  const maxD = Math.max(...pts.map(([, d]) => d), 1e-9)
  const sx = (x: number) => ((x - lo) / (hi - lo)) * W
  const sy = (d: number) => H - 18 - (d / maxD) * (H - 26)
  const path = pts.map(([x, d], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(d).toFixed(1)}`).join(' ')
  const basisP = p.basis_probs[p.basis] ?? 1
  const fmt = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 0 })
  const base = H - 14
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-[12.5px] font-medium">{p.name.replace('T_', '').replace('_', ' ')} threshold</div>
        <div className="num text-[11.5px]">
          <span className="text-ink-1">{fmt(p.mean)}</span>
          <span className="text-ink-3"> ± {p.sd.toFixed(0)} on </span>
          <span className="text-ink-1">{p.basis}</span>
          <span className="text-ink-3"> ({basisP.toFixed(2)})</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full">
        <path d={path} fill="none" stroke="var(--color-inferred)" strokeWidth={1.2} />
        <line x1={0} x2={W} y1={base} y2={base} stroke="var(--color-rule-strong)" />
        {ticks.map((t) => <line key={t} x1={sx(t)} x2={sx(t)} y1={base} y2={base + 4} stroke="var(--color-rule-strong)" />)}
        <path d={`M${sx(p.mean - p.sd)},${base - 6} v6 H${sx(p.mean + p.sd)} v-6`} fill="none" stroke="var(--color-ink-1)" strokeWidth={1} />
        <line x1={sx(p.mean)} x2={sx(p.mean)} y1={6} y2={base} stroke="var(--color-ink-1)" strokeWidth={1} />
      </svg>
      <div className="num flex justify-between text-[10px] text-ink-3">
        <span>{fmt(lo)}</span><span>{p.n_obs.toFixed(1)} observations</span><span>{fmt(hi)}</span>
      </div>
    </div>
  )
}
