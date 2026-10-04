import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useSupport, type Priority, type Team, type Ticket } from "@/lib/support/store";
import { SampleNote, StatusTag } from "@/components/support/parts";

export const Route = createFileRoute("/support/$ticketId")({
  head: ({ params }) => ({
    meta: [
      { title: `Ticket ${params.ticketId} · Nordwerk Support` },
      { name: "description", content: "Review a support ticket and record team and priority." },
      { property: "og:title", content: "Support ticket · Nordwerk" },
      { property: "og:description", content: "Review a support ticket and record team and priority." },
    ],
  }),
  component: TicketPage,
});

function TicketPage() {
  const { ticketId } = Route.useParams();
  const { tickets } = useSupport();
  const t = tickets.find((x) => x.id === ticketId);
  if (!t)
    return (
      <div className="p-6">
        Ticket not found. <Link to="/support" className="text-primary underline">Back to tickets</Link>
      </div>
    );
  return <TicketDetail key={t.id} t={t} />;
}

function Fact({ name, label, value }: { name: string; label: string; value: string | number }) {
  return (
    <div>
      <label htmlFor={name} className="field-label">{label}</label>
      <input id={name} name={name} readOnly value={value} className="field bg-muted font-mono" />
    </div>
  );
}

function TicketDetail({ t }: { t: Ticket }) {
  const { tickets, saveDecision } = useSupport();
  const navigate = useNavigate();
  const [team, setTeam] = useState<string>(t.decision?.team ?? "");
  const [priority, setPriority] = useState<string>(t.decision?.priority ?? "");
  const [note, setNote] = useState(t.decision?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idx = tickets.findIndex((x) => x.id === t.id);
  const nextOpen = [...tickets.slice(idx + 1), ...tickets.slice(0, idx)].find((x) => x.id !== t.id && x.status !== "Resolved");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!team || !priority) {
      setError("Choose a team and a priority before saving.");
      return;
    }
    const booking = { team, priority, note };
    setBusy(true);
    let allow = true;
    try {
      const hook = window.tacetSupportBeforeSave;
      if (hook) allow = (await hook({ ticketId: t.id, action: "save_decision", booking })).allow;
    } catch {
      setBusy(false);
      setError("Save check unavailable right now. Nothing was saved — please try again.");
      return;
    }
    setBusy(false);
    if (!allow) return; // left untouched for correction
    saveDecision(t.id, { team: team as Team, priority: priority as Priority, note });
    toast.success(`${t.id} saved · ${team}, ${priority}`, {
      description: nextOpen ? `Next: ${nextOpen.id} – ${nextOpen.subject}` : "No more unresolved tickets.",
    });
    if (nextOpen) navigate({ to: "/support/$ticketId", params: { ticketId: nextOpen.id } });
    else navigate({ to: "/support" });
  }

  return (
    <div className="mx-auto max-w-[1300px] p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to="/support" className="text-primary hover:underline">← Back to tickets</Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono">{t.id}</span>
        <StatusTag status={t.status} />
      </div>
      <SampleNote />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <article className="rounded-sm border border-border bg-card p-5">
          <h1 className="font-serif text-[26px] leading-tight md:text-[30px]">{t.subject}</h1>
          <div className="mt-1 text-muted-foreground">{t.contact} · {t.customer}</div>
          <p className="mt-5 max-w-prose text-[15px] leading-relaxed">{t.body}</p>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4 text-[13px]">
            <dt className="text-muted-foreground">Customer</dt><dd>{t.customer}</dd>
            <dt className="text-muted-foreground">Contact</dt><dd>{t.contact}</dd>
            <dt className="text-muted-foreground">Contract tier</dt><dd>{t.tier}</dd>
          </dl>
        </article>

        <div className="space-y-4">
          <section className="rounded-sm border border-border bg-card p-4">
            <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Facts</div>
            <div className="grid grid-cols-2 gap-3">
              <Fact name="ticket_id" label="Ticket id" value={t.id} />
              <Fact name="customer_tier" label="Customer tier" value={t.tier} />
              <Fact name="issue_type" label="Issue type" value={t.issue_type} />
              <Fact name="age_hours" label="Age (hours)" value={t.age_hours} />
              <Fact name="affected_users" label="Affected users" value={t.affected_users} />
            </div>
          </section>

          <form onSubmit={onSubmit} className="rounded-sm border border-border bg-card p-4">
            <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Decision</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="team" className="field-label">Team</label>
                <select id="team" name="team" className="field" value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="">— select —</option>
                  <option>Support</option><option>Engineering</option><option>Dispatch</option>
                </select>
              </div>
              <div>
                <label htmlFor="priority" className="field-label">Priority</label>
                <select id="priority" name="priority" className="field" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="">— select —</option>
                  <option>Normal</option><option>Urgent</option>
                </select>
              </div>
              <div className="col-span-2">
                <label htmlFor="internal_note" className="field-label">Internal note (optional)</label>
                <textarea id="internal_note" name="internal_note" className="field h-20 py-1" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            {error && <p role="alert" className="mt-3 text-[13px] text-destructive">{error}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <button
                id="save_decision"
                name="save_decision"
                type="submit"
                disabled={busy}
                className="rounded-sm bg-primary px-4 py-2 text-[14px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                Save decision
              </button>
              {nextOpen && (
                <Link to="/support/$ticketId" params={{ ticketId: nextOpen.id }} className="rounded-sm border border-input px-3 py-2 text-[13px] hover:bg-accent">
                  Skip to next ticket
                </Link>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
