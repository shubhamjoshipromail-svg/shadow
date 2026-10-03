import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import seed from "@/data/seed.json";
import type { ActionKind, ApprovalEvent, Booking, Case } from "./types";
import { date } from "./format";

export const SHADOW_API: string =
  (import.meta.env.VITE_SHADOW_API as string | undefined) || "http://localhost:8000";

type Ctx = {
  cases: Case[];
  source: "api" | "local";
  approvals: Record<string, ApprovalEvent[]>;
  updateBooking: (id: string, b: Booking) => void;
  applyAction: (id: string, action: ActionKind, b: Booking, reason?: string, approver?: string) => void;
};

const ErpCtx = createContext<Ctx | null>(null);

const STATUS_FOR: Record<ActionKind, string> = {
  post: "Posted",
  hold: "On hold",
  second_approval: "Awaiting 2nd approval",
  escalate: "Escalated",
  reject: "Rejected",
};

function initialApprovals(c: Case): ApprovalEvent[] {
  const ev: ApprovalEvent[] = [
    { at: date(c.invoice_date), who: "System", what: "Received via e-invoice inbox" },
    { at: date(c.invoice_date), who: "OCR", what: "Header and line items extracted" },
  ];
  if (c.status === "On hold") ev.push({ at: "29.09.2026", who: "S. Albrecht (AP)", what: "Put on hold", detail: c.booking.note });
  if (c.status === "Awaiting 2nd approval")
    ev.push({ at: "30.09.2026", who: "S. Albrecht (AP)", what: "Sent for 2nd approval", detail: "M. Keller (Head of Finance)" });
  if (c.status === "Posted") ev.push({ at: date(c.booking.payment_date), who: "S. Albrecht (AP)", what: "Posted" });
  return ev;
}

export function ErpProvider({ children }: { children: ReactNode }) {
  const [cases, setCases] = useState<Case[]>(seed as Case[]);
  const [source, setSource] = useState<"api" | "local">("local");
  const [approvals, setApprovals] = useState<Record<string, ApprovalEvent[]>>(() =>
    Object.fromEntries((seed as Case[]).map((c) => [c.id, initialApprovals(c)])),
  );

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    fetch(`${SHADOW_API}/api/erp/cases`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Case[]) => {
        if (Array.isArray(data) && data.length) {
          setCases(data);
          setApprovals(Object.fromEntries(data.map((c) => [c.id, initialApprovals(c)])));
          setSource("api");
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(t));
    return () => ctrl.abort();
  }, []);

  const updateBooking = useCallback((id: string, b: Booking) => {
    setCases((cs) => cs.map((c) => (c.id === id ? { ...c, booking: b } : c)));
  }, []);

  const applyAction = useCallback(
    (id: string, action: ActionKind, b: Booking, reason?: string, approver?: string) => {
      setCases((cs) => cs.map((c) => (c.id === id ? { ...c, booking: b, status: STATUS_FOR[action] } : c)));
      const now = new Date();
      setApprovals((a) => ({
        ...a,
        [id]: [
          ...(a[id] ?? []),
          {
            at: `${date(now.toISOString())} ${now.toTimeString().slice(0, 5)}`,
            who: "You (AP)",
            what: STATUS_FOR[action],
            detail: approver ?? reason,
          },
        ],
      }));
      fetch(`${SHADOW_API}/api/erp/cases/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, booking: b, reason, approver }),
      }).catch(() => {});
    },
    [],
  );

  return (
    <ErpCtx.Provider value={{ cases, source, approvals, updateBooking, applyAction }}>{children}</ErpCtx.Provider>
  );
}

export function useErp() {
  const c = useContext(ErpCtx);
  if (!c) throw new Error("useErp outside provider");
  return c;
}

export const OPEN_STATUSES = ["Open", "Escalated"];
