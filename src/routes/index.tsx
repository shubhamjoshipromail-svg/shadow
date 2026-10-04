import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useErp } from "@/lib/erp/store";
import { STATUSES } from "@/lib/erp/types";
import { date, flag, money } from "@/lib/erp/format";
import { StatusBadge } from "@/components/erp/StatusBadge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AP Inbox · Nordwerk ERP" },
      { name: "description", content: "Open supplier invoices awaiting booking at Nordwerk Maschinenbau." },
      { property: "og:title", content: "AP Inbox · Nordwerk ERP" },
      { property: "og:description", content: "Open supplier invoices awaiting booking." },
    ],
  }),
  component: Inbox,
});

function Inbox() {
  const { cases } = useErp();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [supplier, setSupplier] = useState("");
  const [q, setQ] = useState("");

  const suppliers = useMemo(() => [...new Set(cases.map((c) => c.supplier.name))].sort(), [cases]);
  const openCount = cases.filter((c) => !["Posted", "Rejected"].includes(c.status)).length;
  const rows = cases.filter((c) => {
    if (status && c.status !== status) return false;
    if (supplier && c.supplier.name !== supplier) return false;
    if (q) {
      const s = q.toLowerCase();
      return [c.invoice_no, c.supplier.name, String(c.gross)].some((v) => v.toLowerCase().includes(s));
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      <h1 className="page-title mb-1">Supplier invoices</h1>
      <p className="mb-4 text-muted-foreground">Accounts payable inbox · Nordwerk Maschinenbau GmbH</p>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-sm border-l-[3px] border-banner-foreground/60 bg-banner px-3 py-2 text-banner-foreground">
        <span className="font-semibold">Month-end close in 2 days</span>
        <span>·</span>
        <span>{openCount} invoices open</span>
      </div>

      <div className="rounded-sm border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2.5">
          <input
            className="field max-w-64"
            placeholder="Search invoice no., supplier, amount…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="field max-w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="field max-w-64" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <span className="ml-auto text-muted-foreground">{rows.length} items</span>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-[14px]">
          <thead className="border-b border-rule-strong text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Invoice no.</th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 font-medium">Ctry</th>
              <th className="px-3 py-2 font-medium">Invoice date</th>
              <th className="px-3 py-2 font-medium">Due date</th>
              <th className="px-3 py-2 text-right font-medium">Net</th>
              <th className="px-3 py-2 text-right font-medium">Gross</th>
              <th className="px-3 py-2 font-medium">Curr.</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.id}
                data-shadow-entity={`invoice:${c.id}`}
                data-shadow-action="open"
                onClick={() => navigate({ to: "/invoice/$id", params: { id: c.id } })}
                className="cursor-pointer border-t border-border hover:bg-accent/60"
              >
                <td className="px-3 py-2 font-mono text-primary">{c.invoice_no}</td>
                <td className="px-3 py-2">{c.supplier.name}</td>
                <td className="px-3 py-2" title={c.supplier.country}>
                  {flag(c.supplier.country)} <span className="text-muted-foreground">{c.supplier.country}</span>
                </td>
                <td className="px-3 py-2 amount">{date(c.invoice_date)}</td>
                <td className="px-3 py-2 amount">{date(c.due_date)}</td>
                <td className="px-3 py-2 text-right amount">{money(c.net, c.currency)}</td>
                <td className="px-3 py-2 text-right amount">{money(c.gross, c.currency)}</td>
                <td className="px-3 py-2">{c.currency}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  No invoices match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
