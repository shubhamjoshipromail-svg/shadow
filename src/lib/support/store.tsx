import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export type Tier = "Premium" | "Standard";
export type IssueType = "Outage" | "How-to" | "Billing";
export type Team = "Support" | "Engineering" | "Dispatch";
export type Priority = "Normal" | "Urgent";
export type TicketStatus = "New" | "Resolved";

export type Ticket = {
  id: string;
  subject: string;
  customer: string;
  contact: string;
  tier: Tier;
  issue_type: IssueType;
  age_hours: number;
  affected_users: number;
  status: TicketStatus;
  body: string;
  decision: { team: Team; priority: Priority; note: string } | null;
};

/** Fictional sample data. No decisions prefilled, no rules encoded. */
function seedTickets(): Ticket[] {
  const t = (
    id: string, subject: string, customer: string, contact: string, tier: Tier, issue_type: IssueType,
    age_hours: number, affected_users: number, body: string,
  ): Ticket => ({ id, subject, customer, contact, tier, issue_type, age_hours, affected_users, status: "New", body, decision: null });
  return [
    t("SR-4101", "Line controllers offline after firmware update", "Halvorsen Fräsetechnik AS", "Ingrid Halvorsen", "Premium", "Outage", 1, 200, "Since this morning's update none of our line controllers report to the dashboard. Production planning is blind across both halls."),
    t("SR-4102", "How do I export maintenance logs to CSV?", "Bäckerei Lindqvist", "Tomas Lindqvist", "Standard", "How-to", 24, 1, "Looking for a way to export the last quarter of maintenance logs for our auditor. Couldn't find it in the menu."),
    t("SR-4103", "Invoice shows double service fee", "Moravec Stroje s.r.o.", "Petra Moravcová", "Premium", "Billing", 7, 1, "Our September invoice lists the annual service fee twice. Please correct before our payment run on Friday."),
    t("SR-4104", "Remote portal login fails for whole shift", "Ostrander Packaging BV", "Daan Ostrander", "Standard", "Outage", 4, 20, "The night shift can't log into the remote portal. Error message says 'session service unavailable'."),
    t("SR-4105", "Configure alarm thresholds for spindle temperature", "Keskinen Metalli Oy", "Aino Keskinen", "Premium", "How-to", 12, 1, "Which screen do I use to change the spindle temperature alarm limit? The manual refers to an older version."),
    t("SR-4106", "Licence renewal charged in wrong currency", "Brightwater Tools Ltd", "Owen Price", "Standard", "Billing", 8, 1, "We were billed in EUR, our contract is in GBP. Can you reissue?"),
    t("SR-4107", "Conveyor sensors intermittently dropping", "Fontaine Agroalimentaire SA", "Claire Fontaine", "Premium", "Outage", 8, 20, "Sensors on line 3 drop out every few minutes. Operators are restarting manually."),
    t("SR-4108", "Add a new user to the service portal", "Rasmussen Marine ApS", "Jonas Rasmussen", "Standard", "How-to", 1, 1, "We hired a new technician. How do I add her to our portal account?"),
    t("SR-4109", "Data sync stopped for all sites", "Castellano Automazione Srl", "Marco Castellano", "Standard", "Outage", 12, 200, "None of our five sites have synced production counts since last night."),
    t("SR-4110", "Credit note not applied", "Weber Kunststoff GmbH", "Lena Weber", "Premium", "Billing", 24, 1, "The credit note from August still isn't reflected on our account statement."),
  ];
}

type Ctx = {
  tickets: Ticket[];
  saveDecision: (id: string, d: { team: Team; priority: Priority; note: string }) => void;
  reset: () => void;
};
const SupportCtx = createContext<Ctx | null>(null);

export function SupportProvider({ children }: { children: ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[]>(() => seedTickets());
  const saveDecision = useCallback<Ctx["saveDecision"]>((id, d) => {
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, decision: d, status: "Resolved" } : t)));
  }, []);
  const reset = useCallback(() => setTickets(seedTickets()), []);
  return <SupportCtx.Provider value={{ tickets, saveDecision, reset }}>{children}</SupportCtx.Provider>;
}

export function useSupport() {
  const c = useContext(SupportCtx);
  if (!c) throw new Error("useSupport outside SupportProvider");
  return c;
}

declare global {
  interface Window {
    tacetSupportBeforeSave?: (p: {
      ticketId: string;
      action: "save_decision";
      booking: { team: string; priority: string; note: string };
    }) => Promise<{ allow: boolean }>;
  }
}
