import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { Mark, Section, Testimony, Wordmark } from '../components/ui'

/*
 * "What was collected" — the honest document, not a dashboard.
 *
 * Reads GET /api/data/inventory?session=<sid> and prints exactly what Tacet stored for this session:
 * where each kind of row lives, what is never recorded, the newest five rows per ledger table, and the
 * totals. No cards, no pills, no icons; separation by 1px rules, field values in mono, the expert's words
 * in serif. See design/DESIGN.md and design/tasks/DEEPSEEK_DATA_PAGE.md.
 */

type Src = 'live' | 'rehearsal'

interface DecisionRow {
  source?: Src
  created?: number
  case_id?: string
  via?: string
  predicted?: Record<string, string | null>
  actual?: Record<string, string | null>
  prospective?: boolean
  surprises?: string[]
  predicted_map_version?: number
}

interface ExplanationRow {
  source?: Src
  created?: number
  expert?: string
  question_type?: string
  question?: string
  field?: string
  transcript?: string
  redactions?: string[] | null
  status?: string
  map_version_before?: number
  map_version_after?: number
}

interface AttemptRow {
  source?: Src
  created?: number
  learner?: string
  case_id?: string
  action?: string
  allowed?: boolean
  independent?: boolean
  violations?: unknown[] | null
}

interface Inventory {
  database: string
  counts: {
    decisions?: Record<string, number>
    explanations?: Record<string, number>
    learner_attempts?: Record<string, number>
    events?: Record<string, number>
    maps?: { versions: number }
  }
  samples: {
    decisions?: DecisionRow[]
    explanations?: ExplanationRow[]
    learner_attempts?: AttemptRow[]
  }
  locations: { where: string; what: string }[]
  never: string[]
  redaction: string
}

const stamp = (t?: number) =>
  t == null ? '—' : new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ')

/** Provenance of a ledger row: a human did it (live) or the simulator did (rehearsal), with the time. */
function Source({ row }: { row: { source?: Src; created?: number } }) {
  const live = row.source === 'live'
  return (
    <div>
      <span className="num inline-flex items-center gap-1 text-[10.5px] text-ink-2">
        <Mark state={live ? 'observed' : 'inferred'} />
        {live ? 'live' : 'practice'}
      </span>
      <div className="num mt-0.5 text-[9.5px] text-ink-3" title="UTC">{stamp(row.created)}</div>
    </div>
  )
}

function Empty({ children }: { children: string }) {
  return <p className="m-0 border-b border-rule py-3 text-[12.5px] text-ink-3">{children}</p>
}

const violationTitles = (vs: unknown[] | null | undefined): string[] =>
  (vs ?? [])
    .map((v) =>
      typeof v === 'string'
        ? v
        : v && typeof v === 'object' && 'title' in v
          ? String((v as { title?: unknown }).title ?? '')
          : '',
    )
    .filter(Boolean)

/** One table cell header (mono, small caps apparatus, ruled). */
const headCell = 'border-b border-rule py-2 pr-6 font-normal text-left'
const cell = 'border-b border-rule py-3 pr-6 align-top'

export default function DataPage() {
  const { sid } = useParams()
  const [inv, setInv] = useState<Inventory | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sid) return
    let alive = true
    api<Inventory>(`/api/data/inventory?session=${encodeURIComponent(sid)}`)
      .then((d) => { if (alive) setInv(d) })
      .catch((e) => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [sid])

  const decisions = inv?.samples.decisions ?? []
  const explanations = inv?.samples.explanations ?? []
  const attempts = inv?.samples.learner_attempts ?? []

  return (
    <div className="min-h-full bg-paper">
      <header className="flex items-center gap-4 border-b border-rule-strong bg-sheet px-6 py-2.5">
        <Link to={`/s/${sid}`} className="text-[12px] text-ink-2 hover:text-ink-1">← session</Link>
        <Wordmark />
        {inv && (
          <div className="num ml-auto text-[10.5px] text-ink-3">
            {inv.database} · redaction {inv.redaction}
          </div>
        )}
      </header>

      {!inv ? (
        <div className="p-10 text-[13px] text-ink-2">
          {error ? <>Could not read the ledger. <span className="num text-[11.5px] text-ink-3">{error}</span></> : 'Opening the ledger…'}
        </div>
      ) : (
        <div className="mx-auto max-w-[900px] px-6 py-12">
          <article className="panel px-12 py-10">
            <div className="label">Data inventory · session {sid}</div>
            <h1 className="testimony mb-0 mt-3 text-[40px] leading-[1.08] tracking-[-0.015em]">What was collected</h1>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">
              Everything below is what Tacet has stored about this session: the guess it wrote down before each
              decision, the questions it asked and the answers it heard, and what a new hire did on unseen cases —
              together with where each of those lives and who else can reach them.
            </p>

            <Section flush title="Where it lives" className="mt-12">
              <div className="divide-y divide-rule">
                {inv.locations.map((l, i) => (
                  <div key={i} className="grid grid-cols-[190px_1fr] gap-6 py-3">
                    <div className="text-[13px] font-medium text-ink-1">{l.where}</div>
                    <div className="text-[13px] leading-relaxed text-ink-2">{l.what}</div>
                  </div>
                ))}
              </div>
            </Section>

            <Section flush title="Never collected" className="mt-12">
              <ul className="m-0 list-none space-y-1.5 p-0">
                {inv.never.map((n) => (
                  <li key={n} className="text-[13px] leading-relaxed text-ink-2">
                    <span className="text-ink-3">— </span>{n}
                  </li>
                ))}
              </ul>
            </Section>

            <Section
              flush
              title="The ledger"
              className="mt-12"
              right={<span className="num text-[10.5px] text-ink-3">newest five · this session</span>}
            >
              {/* ---------------------------------------------------------- decisions */}
              <h3 className="label mt-2">Decisions</h3>
              {decisions.length === 0 ? (
                <Empty>No decisions yet. Each one appears here as soon as the expert saves a case.</Empty>
              ) : (
                <table className="mt-2 w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="num text-[10px] uppercase tracking-[.06em] text-ink-3">
                      <th className={headCell}>Source</th>
                      <th className={headCell}>Case</th>
                      <th className={headCell}>Guess → her answer</th>
                      <th className={`${headCell} pr-0`}>How</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisions.map((d, i) => {
                      const surprises = d.surprises ?? []
                      return (
                        <tr key={i}>
                          <td className={cell}><Source row={d} /></td>
                          <td className={`num ${cell} text-[11.5px] text-ink-2`}>{d.case_id ?? '—'}</td>
                          <td className={cell}>
                            {surprises.length === 0 ? (
                              <span className="text-[12.5px] text-ink-3">guess held</span>
                            ) : (
                              <div className="space-y-0.5">
                                {surprises.map((f) => {
                                  const guess = d.predicted?.[f]
                                  const actual = d.actual?.[f]
                                  const wrong = guess !== actual
                                  return (
                                    <div key={f} className="num text-[11.5px]">
                                      <span className="text-ink-3">{f}</span>{' '}
                                      <span className={wrong ? 'text-ink-3 line-through' : 'text-ink-2'}>{guess ?? '—'}</span>
                                      <span className="text-ink-3"> → </span>
                                      <span className="text-ink-1">{actual ?? '—'}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </td>
                          <td className={`num ${cell} pr-0 text-[10.5px] text-ink-3`}>
                            {d.via ?? '—'} · map v{d.predicted_map_version ?? '—'} · {d.prospective ? 'written before' : 'scored after'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {/* ------------------------------------------------------- explanations */}
              <h3 className="label mt-10">Explanations</h3>
              {explanations.length === 0 ? (
                <Empty>No answers yet. When Tacet asks a question and the expert explains, the question and the scrubbed answer are recorded here.</Empty>
              ) : (
                <table className="mt-2 w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="num text-[10px] uppercase tracking-[.06em] text-ink-3">
                      <th className={headCell}>Source</th>
                      <th className={headCell}>Question</th>
                      <th className={headCell}>Her answer</th>
                      <th className={`${headCell} pr-0`}>What changed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {explanations.map((e, i) => (
                      <tr key={i}>
                        <td className={cell}><Source row={e} /></td>
                        <td className={cell}>
                          <div className="num text-[10px] uppercase tracking-[.06em] text-ink-3">
                            {e.question_type ?? 'question'}{e.field ? ` · ${e.field}` : ''}
                          </div>
                          <div className="mt-1 text-[13px] leading-relaxed text-ink-1">{e.question ?? '—'}</div>
                        </td>
                        <td className={cell}>
                          {e.transcript ? (
                            <Testimony
                              size="sm"
                              quote={{ text: e.transcript, speaker: e.expert ?? '', ts: null, lang: '', translation: null, inquiry_id: null }}
                            />
                          ) : (
                            <span className="text-[12.5px] text-ink-3">—</span>
                          )}
                          {(e.redactions ?? []).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                              {(e.redactions ?? []).map((r) => (
                                <span key={r} className="num text-[10px] text-ink-3">[{r.toUpperCase()}]</span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className={`num ${cell} pr-0 text-[10.5px] text-ink-3`}>
                          map v{e.map_version_before ?? '—'} → v{e.map_version_after ?? '—'}<br />{e.status ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* ---------------------------------------------------- new-hire attempts */}
              <h3 className="label mt-10">New-hire attempts</h3>
              {attempts.length === 0 ? (
                <Empty>No new-hire attempts yet. Each save a trainee makes on an unseen case is recorded here.</Empty>
              ) : (
                <table className="mt-2 w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="num text-[10px] uppercase tracking-[.06em] text-ink-3">
                      <th className={headCell}>Source</th>
                      <th className={headCell}>Learner</th>
                      <th className={headCell}>Case</th>
                      <th className={`${headCell} pr-0`}>Attempt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a, i) => {
                      const violations = violationTitles(a.violations)
                      return (
                        <tr key={i}>
                          <td className={cell}><Source row={a} /></td>
                          <td className={`${cell} text-[13px] text-ink-1`}>{a.learner ?? '—'}</td>
                          <td className={`num ${cell} text-[11.5px] text-ink-2`}>{a.case_id ?? '—'}</td>
                          <td className={`${cell} pr-0`}>
                            <div className="num text-[11px]">
                              {a.action ?? '—'}
                              <span className={a.allowed ? 'ml-2 text-confirmed' : 'ml-2 text-binding'}>
                                {a.allowed ? '✓ allowed' : '■ blocked'}
                              </span>
                            </div>
                            <div className="num mt-0.5 text-[10px] text-ink-3">
                              {a.independent ? 'independent attempt' : 'assisted'}
                            </div>
                            {violations.length > 0 && (
                              <div className="num mt-0.5 text-[10px] text-binding">{violations.join(' · ')}</div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </Section>

            <Section flush title="Counts" className="mt-12" right={<span className="num text-[10.5px] text-ink-3">this session</span>}>
              <div className="num flex flex-wrap items-baseline gap-x-8 gap-y-2 text-[11px] text-ink-3">
                <Split label="decisions" c={inv.counts.decisions} />
                <Split label="explanations" c={inv.counts.explanations} />
                <Split label="new-hire attempts" c={inv.counts.learner_attempts} />
                <span>maps <span className="text-ink-1">{inv.counts.maps?.versions ?? 0}</span> versions</span>
              </div>
              <div className="num mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[10.5px] text-ink-3">
                <span className="uppercase tracking-[.08em]">events</span>
                {Object.entries(inv.counts.events ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, n]) => (
                    <span key={t}><span className="text-ink-2">{t}</span> {n}</span>
                  ))}
                {Object.keys(inv.counts.events ?? {}).length === 0 && <span>none yet</span>}
              </div>
            </Section>
          </article>
        </div>
      )}
    </div>
  )
}

function Split({ label, c }: { label: string; c?: Record<string, number> }) {
  const live = c?.live ?? 0
  const rehearsal = c?.rehearsal ?? 0
  return (
    <span>
      {label} <span className="text-ink-1">{live} live</span>
      <span className="text-ink-3"> · {rehearsal} practice</span>
    </span>
  )
}
