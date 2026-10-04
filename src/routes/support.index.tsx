import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useSupport } from "@/lib/support/store";
import { SampleNote, StatusTag } from "@/components/support/parts";

export const Route = createFileRoute("/support/")({
  head: () => ({
    meta: [
      { title: "Support desk · Nordwerk" },
      { name: "description", content: "Customer support ticket inbox for Nordwerk service (sample data)." },
      { property: "og:title", content: "Support desk · Nordwerk" },
      { property: "og:description", content: "Triage customer support tickets: team and priority." },
    ],
  }),
  component: SupportInbox,
});

function SupportInbox() {
  const { tickets, reset } = useSupport();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");

  const rows = tickets.filter((t) => {
    if (tier && t.tier !== tier) return false;
    if (type && t.issue_type !== type) return false;
    if (status && t.status !== status) return false;
    if (q) {
      const s = q.toLowerCase();
      return [t.id, t.subject, t.customer].some((v) => v.toLowerCase().includes(s));
    }
    return true;
  });

  function onReset() {
    if (tickets.some((t) => t.decision) && !window.confirm("Reset the support demo? Saved ticket decisions will be cleared.")) return;
    reset();
    toast.success("Support sample tickets reset");
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      <div className="mb-1 flex flex-wrap items-end gap-3">
        <h1 className="page-title">Support tickets</h1>
        <button type="button" onClick={onReset} className="ml-auto rounded-sm border border-input px-3 py-1.5 text-[13px] hover:bg-accent">
          Reset demo
        </button>
      </div>
      <p className="mb-4 text-muted-foreground">Route each ticket to a team and set its priority.</p>
      <SampleNote />

      <div className="rounded-sm border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2.5">
          <input aria-label="Search tickets" className="field max-w-64" placeholder="Search id, subject, customer…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Customer tier" className="field max-w-40" value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">All tiers</option><option>Premium</option><option>Standard</option>
          </select>
          <select aria-label="Issue type" className="field max-w-40" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All issue types</option><option>Outage</option><option>How-to</option><option>Billing</option>
          </select>
          <select aria-label="Status" className="field max-w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option><option>New</option><option>Resolved</option>
          </select>
          <span className="ml-auto text-muted-foreground">{rows.length} tickets</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[14px]">
            <thead className="border-b border-rule-strong text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Ticket</th>
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">Tier</th>
                <th className="px-3 py-2 font-medium">Issue type</th>
                <th className="px-3 py-2 text-right font-medium">Age (h)</th>
                <th className="px-3 py-2 text-right font-medium">Affected users</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => navigate({ to: "/support/$ticketId", params: { ticketId: t.id } })}
                  className="cursor-pointer border-t border-border hover:bg-accent/60"
                >
                  <td className="px-3 py-2 font-mono text-primary">{t.id}</td>
                  <td className="px-3 py-2">
                    {t.subject}
                    <div className="text-[12px] text-muted-foreground">{t.customer}</div>
                  </td>
                  <td className="px-3 py-2">{t.tier}</td>
                  <td className="px-3 py-2">{t.issue_type}</td>
                  <td className="px-3 py-2 text-right amount">{t.age_hours}</td>
                  <td className="px-3 py-2 text-right amount">{t.affected_users}</td>
                  <td className="px-3 py-2"><StatusTag status={t.status} /></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No tickets match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
