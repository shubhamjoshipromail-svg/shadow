import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useErp } from "@/lib/erp/store";
import { beforeSave, setShadowState } from "@/lib/erp/shadow";
import {
  APPROVERS,
  COST_CENTERS,
  GL_ACCOUNTS,
  TAX_CODES,
  type ActionKind,
  type Booking,
  type Case,
} from "@/lib/erp/types";
import { addDays, date, flag, money, num, todayISO } from "@/lib/erp/format";
import { StatusBadge } from "@/components/erp/StatusBadge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/invoice/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Invoice ${params.id} · Nordwerk ERP` },
      { name: "description", content: "Review and book a supplier invoice." },
      { property: "og:title", content: "Invoice workspace · Nordwerk ERP" },
      { property: "og:description", content: "Review and book a supplier invoice." },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  const { id } = Route.useParams();
  const { cases } = useErp();
  const c = cases.find((x) => x.id === id);
  if (!c)
    return (
      <div className="p-6">
        Invoice not found.{" "}
        <Link to="/" className="text-primary underline">
          Back to inbox
        </Link>
      </div>
    );
  return <WorkspaceInner key={c.id} c={c} />;
}

function WorkspaceInner({ c }: { c: Case }) {
  const { cases, updateBooking, applyAction } = useErp();
  const navigate = useNavigate();
  const [booking, setBooking] = useState<Booking>(c.booking);

  useEffect(() => {
    setShadowState({ case: { ...c, booking }, booking });
    updateBooking(c.id, booking);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking]);

  const set = <K extends keyof Booking>(k: K, v: Booking[K]) => setBooking((b) => ({ ...b, [k]: v }));

  const idx = cases.findIndex((x) => x.id === c.id);
  const nextOpen = [...cases.slice(idx + 1), ...cases.slice(0, idx)].find(
    (x) => x.id !== c.id && x.status === "Open",
  );

  const [dialog, setDialog] = useState<null | "hold" | "second_approval" | "escalate" | "reject">(null);
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState<string>(APPROVERS[0]);
  const [busy, setBusy] = useState(false);

  async function run(action: ActionKind, r?: string, a?: string) {
    setBusy(true);
    const verdict = await beforeSave({ action, caseId: c.id, booking, reason: r, approver: a });
    setBusy(false);
    if (!verdict.allow) return;
    applyAction(c.id, action, booking, r, a);
    setDialog(null);
    setReason("");
    const label = {
      post: "Posted",
      hold: "Put on hold",
      second_approval: `Sent to ${a}`,
      escalate: "Escalated to controller",
      reject: "Rejected",
    }[action];
    toast.success(`${c.invoice_no} · ${label}`, {
      description: nextOpen ? `Next: ${nextOpen.invoice_no} – ${nextOpen.supplier.name}` : "No more open invoices.",
    });
    if (nextOpen) navigate({ to: "/invoice/$id", params: { id: nextOpen.id } });
    else navigate({ to: "/" });
  }

  const skontoDeadline = c.payment_terms.skonto_pct > 0 ? addDays(c.invoice_date, c.payment_terms.skonto_days) : null;
  const daysLeft = skontoDeadline
    ? Math.round((Date.parse(skontoDeadline) - Date.parse(todayISO())) / 86400000)
    : null;

  return (
    <div data-shadow-entity={`invoice:${c.id}`} className="flex h-[calc(100vh-2.5rem)] flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
        <Link to="/" className="text-primary hover:underline">
          ← Back to inbox
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono font-medium">{c.invoice_no}</span>
        <span>{c.supplier.name}</span>
        <StatusBadge status={c.status} />
        <span className="ml-auto amount text-[14px] font-semibold">{money(c.gross, c.currency)}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(320px,0.8fr)_minmax(300px,0.75fr)]">
        {/* Document */}
        <div className="overflow-auto bg-muted p-4">
          <InvoiceDocument c={c} />
        </div>

        {/* Booking form */}
        <div className="flex min-h-0 flex-col border-x border-border bg-card">
          <div className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Booking
          </div>
          <div className="flex-1 space-y-3 overflow-auto p-4">
            <div>
              <label className="field-label">Cost center</label>
              <select
                data-shadow-field="cost_center"
                className="field"
                value={booking.cost_center ?? ""}
                onChange={(e) => set("cost_center", e.target.value || null)}
              >
                <option value="">— select —</option>
                {COST_CENTERS.map(([k, v]) => (
                  <option key={k} value={k}>
                    {k} {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">GL account</label>
              <input
                data-shadow-field="gl_account"
                className="field font-mono"
                list="gl-accounts"
                placeholder="e.g. 4805"
                value={booking.gl_account ?? ""}
                onChange={(e) => set("gl_account", e.target.value || null)}
              />
              <datalist id="gl-accounts">
                {GL_ACCOUNTS.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </datalist>
              {booking.gl_account && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {GL_ACCOUNTS.find(([k]) => k === booking.gl_account)?.[1] ?? "Unknown account"}
                </div>
              )}
            </div>
            <div>
              <label className="field-label">Asset number (optional)</label>
              <input
                data-shadow-field="asset_number"
                className="field font-mono"
                placeholder="AN-…"
                value={booking.asset_number ?? ""}
                onChange={(e) => set("asset_number", e.target.value || null)}
              />
            </div>
            <div>
              <label className="field-label">Tax code</label>
              <select
                data-shadow-field="tax_code"
                className="field"
                value={booking.tax_code ?? ""}
                onChange={(e) => set("tax_code", e.target.value || null)}
              >
                <option value="">— select —</option>
                {TAX_CODES.map(([k, v]) => (
                  <option key={k} value={k}>
                    {k} ({v})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Payment date</label>
              <input
                data-shadow-field="payment_date"
                type="date"
                className="field font-mono"
                value={booking.payment_date ?? ""}
                onChange={(e) => set("payment_date", e.target.value || null)}
              />
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {skontoDeadline ? (
                  <>
                    Skonto {c.payment_terms.skonto_pct}% until{" "}
                    <span
                      className={cn(
                        "font-mono",
                        daysLeft !== null && daysLeft <= 1 && "font-semibold text-status-escalated",
                      )}
                    >
                      {date(skontoDeadline)}
                    </span>{" "}
                    ({daysLeft! < 0 ? "expired" : daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`})
                    {" · "}saves {money((c.gross * c.payment_terms.skonto_pct) / 100, c.currency)}
                  </>
                ) : (
                  <>No Skonto · net due {date(c.due_date)}</>
                )}
              </div>
            </div>
            <div>
              <label className="field-label">Internal note</label>
              <textarea
                data-shadow-field="note"
                className="field h-20 py-1"
                value={booking.note}
                onChange={(e) => set("note", e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-border bg-muted/60 p-3">
            <Button size="sm" data-shadow-action="post" disabled={busy} onClick={() => run("post")}>
              Post
            </Button>
            <Button size="sm" variant="outline" data-shadow-action="hold" onClick={() => setDialog("hold")}>
              Hold
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-shadow-action="second_approval"
              onClick={() => setDialog("second_approval")}
            >
              Send for 2nd approval
            </Button>
            <Button size="sm" variant="outline" data-shadow-action="escalate" onClick={() => setDialog("escalate")}>
              Ask controller
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              data-shadow-action="reject"
              onClick={() => setDialog("reject")}
            >
              Reject
            </Button>
          </div>
        </div>

        {/* Context */}
        <div className="overflow-auto bg-card">
          <div className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Context
          </div>
          <ContextPanels c={c} />
        </div>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-md text-[13px]">
          <DialogHeader>
            <DialogTitle className="text-[15px]">
              {dialog === "hold" && "Put invoice on hold"}
              {dialog === "second_approval" && "Send for 2nd approval"}
              {dialog === "escalate" && "Ask controller"}
              {dialog === "reject" && "Reject invoice"}
            </DialogTitle>
          </DialogHeader>
          {dialog === "second_approval" ? (
            <div>
              <label className="field-label">Approver</label>
              <select className="field" value={approver} onChange={(e) => setApprover(e.target.value)}>
                {APPROVERS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="field-label">{dialog === "escalate" ? "Message" : "Reason"}</label>
              <textarea className="field h-24 py-1" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </div>
          )}
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || (dialog !== "second_approval" && !reason.trim())}
              data-shadow-action={dialog ?? undefined}
              onClick={() =>
                dialog === "second_approval" ? run("second_approval", undefined, approver) : run(dialog!, reason.trim())
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const CAT: Record<string, string> = {
  equipment: "Equipment",
  it_hardware: "IT hardware",
  service: "Service",
  consumables: "Consumables",
  software: "Software",
  freight: "Freight",
};

function InvoiceDocument({ c }: { c: Case }) {
  const t = c.payment_terms;
  const terms =
    t.skonto_pct > 0 ? `${t.skonto_pct}% Skonto within ${t.skonto_days} days, net ${t.net_days}` : `Net ${t.net_days} days`;
  return (
    <div data-shadow-region="document" className="mx-auto max-w-[720px] bg-paper p-8 font-serif shadow-md">
      <div className="flex items-start justify-between border-b-2 border-foreground pb-3">
        <div>
          <div className="text-[20px] font-semibold">{c.supplier.name}</div>
          <div className="font-sans text-[11px] text-muted-foreground">
            {c.supplier.country} · VAT ID <span data-shadow-pii="true">{c.supplier.vat_id}</span>
          </div>
        </div>
        <div className="text-right font-sans text-[22px] font-light uppercase tracking-[0.2em] text-muted-foreground">
          Rechnung
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 font-sans text-[12px]">
        <div>
          <div className="text-[10px] text-muted-foreground">{c.supplier.name} · {c.supplier.country}</div>
          <div className="mt-1">
            Nordwerk Maschinenbau GmbH
            <br />
            Kreditorenbuchhaltung
            <br />
            Hafenstraße 41
            <br />
            28197 Bremen, DE
          </div>
        </div>
        <table className="ml-auto">
          <tbody>
            <tr><td className="pr-4 text-muted-foreground">Invoice no.</td><td className="font-mono">{c.invoice_no}</td></tr>
            <tr><td className="pr-4 text-muted-foreground">Invoice date</td><td className="font-mono">{date(c.invoice_date)}</td></tr>
            <tr><td className="pr-4 text-muted-foreground">Due date</td><td className="font-mono">{date(c.due_date)}</td></tr>
            {c.po && <tr><td className="pr-4 text-muted-foreground">Your PO</td><td className="font-mono">{c.po.po_no}</td></tr>}
          </tbody>
        </table>
      </div>
      <table data-shadow-region="lines" className="mt-6 w-full font-sans text-[12px]">
        <thead>
          <tr className="border-b border-foreground text-left">
            <th className="py-1 font-medium">Description</th>
            <th className="py-1 text-right font-medium">Qty</th>
            <th className="py-1 text-right font-medium">Unit price</th>
            <th className="py-1 text-right font-medium">Line net</th>
            <th className="py-1 pl-3 font-medium">Category</th>
          </tr>
        </thead>
        <tbody>
          {c.lines.map((l, i) => (
            <tr key={i} className="border-b border-border">
              <td className="py-1.5 pr-2">{l.description}</td>
              <td className="py-1.5 text-right amount">{num(l.qty)}</td>
              <td className="py-1.5 text-right amount">{money(l.unit_price, c.currency)}</td>
              <td className="py-1.5 text-right amount">{money(l.qty * l.unit_price, c.currency)}</td>
              <td className="py-1.5 pl-3 text-muted-foreground">{CAT[l.category]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="ml-auto mt-4 font-sans text-[12px]">
        <tbody>
          <tr><td className="pr-6">Net</td><td className="text-right amount">{money(c.net, c.currency)}</td></tr>
          <tr><td className="pr-6">VAT {c.vat_rate}%</td><td className="text-right amount">{money(c.vat, c.currency)}</td></tr>
          <tr className="border-t border-foreground font-semibold"><td className="pr-6 pt-1">Gross</td><td className="pt-1 text-right amount">{money(c.gross, c.currency)}</td></tr>
        </tbody>
      </table>
      {c.vat_rate === 0 && c.supplier.country !== "DE" && (
        <div className="mt-2 font-sans text-[11px] italic text-muted-foreground">
          {["AT", "CZ"].includes(c.supplier.country)
            ? "Reverse charge – tax liability of the recipient (§13b UStG)."
            : "Not taxable in Germany."}
        </div>
      )}
      <div className="mt-6 border-t border-border pt-3 font-sans text-[11px] text-muted-foreground">
        <div>Payment terms: <span className="text-foreground">{terms}</span></div>
        <div>
          Bank: IBAN <span data-shadow-pii="true" className="font-mono text-foreground">{c.supplier.iban}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function ContextPanels({ c }: { c: Case }) {
  const { approvals } = useErp();
  const s = c.supplier;
  const statusLabel = { known: "Known", new: "New", unknown: "Unknown" }[s.status];
  const amounts = c.history.map((h) => `${h.date.slice(0, 7)}|${h.amount}`);
  const dupKeys = new Set(amounts.filter((a, i) => amounts.indexOf(a) !== i));
  const po = c.po;
  let match: { label: string; tone: string } | null = null;
  if (po) {
    if (po.received_qty_ratio < 1)
      match = { label: `Quantity variance (${Math.round(po.received_qty_ratio * 100)}% received)`, tone: "text-status-hold" };
    else if (Math.abs(po.price_variance_pct) > 0)
      match = { label: `Price variance ${num(po.price_variance_pct)}%`, tone: "text-status-escalated" };
    else match = { label: "3-way match", tone: "text-status-posted" };
  }
  const trig = "px-4 py-2 text-[13px] font-medium hover:no-underline";
  return (
    <Accordion type="multiple" className="text-[12px]">
      <AccordionItem value="supplier">
        <AccordionTrigger data-shadow-panel="supplier" className={trig}>Supplier</AccordionTrigger>
        <AccordionContent className="px-4">
          <Row k="Name">{s.name}</Row>
          <Row k="Country">{flag(s.country)} {s.country}</Row>
          <Row k="Status">
            <span className={cn("rounded-sm border px-1.5 text-[11px]", s.status === "known" ? "border-status-posted/40 text-status-posted" : s.status === "new" ? "border-status-hold/40 text-status-hold" : "border-status-rejected/40 text-status-rejected")}>
              {statusLabel}
            </span>
          </Row>
          <Row k="Group company">{s.intercompany ? `${s.name} – intercompany` : "No"}</Row>
          <Row k="Bank details changed recently">
            <span className={s.bank_changed_recently ? "font-semibold text-status-rejected" : ""}>
              {s.bank_changed_recently ? "Yes" : "No"}
            </span>
          </Row>
          <Row k="VAT ID"><span data-shadow-pii="true" className="font-mono">{s.vat_id}</span></Row>
          <Row k="IBAN"><span data-shadow-pii="true" className="font-mono">{s.iban}</span></Row>
          {s.notes && <div className="mt-2 rounded-sm bg-muted p-2">{s.notes}</div>}
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="history">
        <AccordionTrigger data-shadow-panel="history" className={trig}>Invoice history ({c.history.length})</AccordionTrigger>
        <AccordionContent className="px-4">
          {c.history.length === 0 ? (
            <div className="text-muted-foreground">No previous invoices from this supplier.</div>
          ) : (
            <table className="w-full">
              <thead className="text-left text-[10px] uppercase text-muted-foreground">
                <tr><th className="font-medium">No.</th><th className="font-medium">Date</th><th className="text-right font-medium">Amount</th><th className="pl-2 font-medium">Status</th></tr>
              </thead>
              <tbody>
                {c.history.slice(0, 8).map((h) => {
                  const dup = dupKeys.has(`${h.date.slice(0, 7)}|${h.amount}`);
                  return (
                    <tr key={h.invoice_no} className={cn("border-t border-border", dup && "bg-banner")}>
                      <td className="py-1 font-mono">{h.invoice_no}</td>
                      <td className="py-1 font-mono">{date(h.date)}</td>
                      <td className="py-1 text-right amount">{money(h.amount, c.currency)}</td>
                      <td className="py-1 pl-2"><StatusBadge status={h.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {dupKeys.size > 0 && (
            <div className="mt-2 text-banner-foreground">Same amount billed twice in one month.</div>
          )}
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="po">
        <AccordionTrigger data-shadow-panel="po" className={trig}>Purchase order & goods receipt</AccordionTrigger>
        <AccordionContent className="px-4">
          {po ? (
            <>
              <Row k="PO no."><span className="font-mono">{po.po_no}</span></Row>
              <Row k="Ordered total"><span className="amount">{money(po.ordered_total, c.currency)}</span></Row>
              <Row k="Invoiced net"><span className="amount">{money(c.net, c.currency)}</span></Row>
              <Row k="Received qty">{Math.round(po.received_qty_ratio * 100)}% of ordered</Row>
              <Row k="Match"><span className={cn("font-semibold", match!.tone)}>{match!.label}</span></Row>
            </>
          ) : (
            <div className="text-muted-foreground">No purchase order referenced.</div>
          )}
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="approvals">
        <AccordionTrigger data-shadow-panel="approvals" className={trig}>Approval history</AccordionTrigger>
        <AccordionContent className="px-4">
          <ol className="relative ml-1 border-l border-border">
            {(approvals[c.id] ?? []).map((e, i) => (
              <li key={i} className="mb-2 ml-3">
                <span className="absolute -left-[4px] mt-1 h-2 w-2 rounded-full bg-primary" />
                <div className="font-mono text-[11px] text-muted-foreground">{e.at}</div>
                <div><span className="font-medium">{e.what}</span> · <span data-shadow-pii="true">{e.who}</span></div>
                {e.detail && <div className="text-muted-foreground">{e.detail}</div>}
              </li>
            ))}
          </ol>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
