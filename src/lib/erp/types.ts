export type Category = "equipment" | "it_hardware" | "service" | "consumables" | "software" | "freight";

export type Booking = {
  cost_center: string | null;
  gl_account: string | null;
  asset_number: string | null;
  tax_code: string | null;
  payment_date: string | null;
  note: string;
};

export type Case = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string;
  currency: "EUR" | "CZK" | "USD";
  supplier: {
    id: string;
    name: string;
    country: string;
    status: "known" | "new" | "unknown";
    intercompany: boolean;
    bank_changed_recently: boolean;
    vat_id: string;
    iban: string;
    notes?: string;
  };
  lines: { description: string; qty: number; unit_price: number; category: Category }[];
  net: number;
  vat_rate: number;
  vat: number;
  gross: number;
  payment_terms: { skonto_pct: number; skonto_days: number; net_days: number };
  po?: { po_no: string; ordered_total: number; received_qty_ratio: number; price_variance_pct: number; asset_number?: string };
  history: { invoice_no: string; date: string; amount: number; status: string }[];
  booking: Booking;
  status: string;
};

export type ActionKind = "post" | "hold" | "second_approval" | "escalate" | "reject";

export type ApprovalEvent = { at: string; who: string; what: string; detail?: string };

export const STATUSES = ["Open", "On hold", "Awaiting 2nd approval", "Posted", "Rejected", "Escalated"] as const;

export const COST_CENTERS = [
  ["4711", "Opex – Maintenance"],
  ["4720", "Opex – Consumables"],
  ["0400", "Capex – Machinery & Equipment"],
  ["0410", "Capex – IT Hardware"],
  ["9100", "Intercompany Clearing"],
] as const;

export const TAX_CODES = [
  ["V19", "19% domestic"],
  ["V7", "7% domestic"],
  ["RC", "EU reverse charge"],
  ["V0", "0% / non-taxable"],
] as const;

export const GL_ACCOUNTS = [
  ["0440", "Machinery"],
  ["0490", "Other operating equipment"],
  ["0650", "Office equipment / IT"],
  ["1590", "Intercompany clearing"],
  ["3400", "Goods purchased 19%"],
  ["3425", "Intra-EU acquisitions 19%"],
  ["4240", "Gas, electricity, water"],
  ["4250", "Cleaning"],
  ["4805", "Repairs & maintenance of equipment"],
  ["4806", "Software maintenance / licences"],
  ["4980", "Operating supplies / consumables"],
  ["4730", "Freight"],
] as const;

export const APPROVERS = ["M. Keller (Head of Finance)", "Controller T. Brandt"] as const;
