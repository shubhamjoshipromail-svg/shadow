# Lovable prompt — "Nordwerk ERP" sandbox (paste everything below the line)

Notes for you, not for Lovable:
- Build this as its own Lovable project. Shadow observes it in two ways: through screen share, and through a small `capture.js` script that Shadow hosts.
- Lovable only needs to get three things exactly right: the `data-shadow-*` attributes, `window.shadowERP`, and the `beforeSave` hook. All of the intelligence lives in Shadow.
- Once Lovable is done, connect it to GitHub and send me the repo URL (or clone it into `erp/` in this folder).

---

Build **Nordwerk ERP**, a realistic, slightly old-school but clean accounts-payable module for a German machine builder (Nordwerk Maschinenbau GmbH). It's a desktop web app with dense, professional UI similar to SAP Fiori or Odoo. It has no landing page and no marketing. Use React + Vite + TypeScript + Tailwind + shadcn/ui. No auth and no Supabase, because all data comes from a JSON API, with a local fallback.

## Screens

### 1. AP Inbox (`/`)
A table of open supplier invoices with these columns:
- invoice no.
- supplier
- country flag
- invoice date
- due date
- net
- gross
- currency
- status (Open / On hold / Awaiting 2nd approval / Posted / Rejected / Escalated)

Add filters (status, supplier), a search box, and a header banner: "Month-end close in 2 days · N invoices open". Clicking a row opens the invoice.

### 2. Invoice workspace (`/invoice/:id`)
Use a three-column layout.

**Left: invoice document.** Render a fake PDF-looking invoice: the supplier letterhead, address, VAT ID, IBAN, invoice no., date, line items table (description, qty, unit price, line net, category), net, VAT rate and amount, gross, and payment terms (e.g. "2% Skonto within 10 days, net 30").

**Middle: booking form** (the expert edits this):
- Cost center: a select with options 4711 Opex – Maintenance, 4720 Opex – Consumables, 0400 Capex – Machinery & Equipment, 0410 Capex – IT Hardware, 9100 Intercompany Clearing
- GL account: a text input with autocomplete
- Asset number: a text input that is optional, with placeholder "AN-…"
- Tax code: a select with options V19 (19% domestic), V7, RC (EU reverse charge), V0
- Payment date: a date input, plus a hint showing the Skonto deadline
- Internal note: a textarea

At the bottom, a row of action buttons:
- **Post** (primary)
- **Hold** (opens a small dialog asking for a reason)
- **Send for 2nd approval** (asks for an approver from a select: M. Keller (Head of Finance), Controller T. Brandt)
- **Ask controller** (escalate, with a message box)
- **Reject** (asks for a reason)

**Right: context panels**, as collapsible accordion sections, all collapsed by default:
- **Supplier**: name, country, supplier status badge (Known / New / Unknown), group company flag (e.g. "Nordwerk CZ s.r.o. – intercompany"), bank details changed recently (yes/no), notes.
- **Invoice history**: this supplier's last 8 invoices (no., date, amount, status). It must be able to show two invoices with the same amount in the same month (duplicates / double billing).
- **Purchase order & goods receipt**: PO no., ordered qty/price, received qty, asset number from the PO if present ("Asset no.: AN-2026-0142", or "— no asset number"), and a 3-way-match indicator (match / price variance x% / quantity variance).
- **Approval history**: a timeline for this invoice.

### 3. Case done toast
After an action, show a toast and auto-advance to the next open invoice. Keep a "Back to inbox" link.

## Data
On load, fetch `GET ${VITE_SHADOW_API}/api/erp/cases` (env var, default `http://localhost:8000`). If that fails, fall back to `src/data/seed.json`, which you should generate with 12 invoices. The response has this shape:
```ts
type Case = {
  id: string; invoice_no: string; invoice_date: string; due_date: string;
  currency: "EUR" | "CZK" | "USD";
  supplier: { id: string; name: string; country: string; status: "known" | "new" | "unknown";
              intercompany: boolean; bank_changed_recently: boolean; vat_id: string; iban: string; notes?: string };
  lines: { description: string; qty: number; unit_price: number; category: "equipment" | "it_hardware" | "service" | "consumables" | "software" | "freight"; }[];
  net: number; vat_rate: number; vat: number; gross: number;
  payment_terms: { skonto_pct: number; skonto_days: number; net_days: number };
  po?: { po_no: string; ordered_total: number; received_qty_ratio: number; price_variance_pct: number; asset_number?: string };
  history: { invoice_no: string; date: string; amount: number; status: string }[];
  booking: { cost_center: string | null; gl_account: string | null; asset_number: string | null;
             tax_code: string | null; payment_date: string | null; note: string };
  status: string;
}
```
Persist edits in React state only. On an action, `POST ${VITE_SHADOW_API}/api/erp/cases/:id/action` with `{action, booking, reason?, approver?}`, and ignore any failure.

## Instrumentation contract (CRITICAL, implement exactly)
The app is observed by an AI apprentice called Shadow. Add the following.

1. **Load the observer script** in `index.html`:
   ```html
   <script>window.SHADOW_API = "%VITE_SHADOW_API%";</script>
   <script defer src="%VITE_SHADOW_API%/capture.js" onerror="console.info('shadow capture not loaded')"></script>
   ```
   (Or inject it equivalently from `main.tsx` using `import.meta.env.VITE_SHADOW_API`.) The app must work normally when the script is missing.

2. **Data attributes:**
   - Invoice workspace root: `data-shadow-entity="invoice:{id}"`
   - Every booking input/select/textarea: `data-shadow-field="cost_center"` (etc.: `gl_account`, `asset_number`, `tax_code`, `payment_date`, `note`)
   - Every action button: `data-shadow-action="post" | "hold" | "second_approval" | "escalate" | "reject"`
   - Every accordion section trigger: `data-shadow-panel="supplier" | "history" | "po" | "approvals"`
   - Each invoice-document region: `data-shadow-region="document"`, and on the line items table `data-shadow-region="lines"`
   - Personal or sensitive text (IBAN, contact person names, VAT ID): `data-shadow-pii="true"`
   - Inbox rows: `data-shadow-entity="invoice:{id}"` plus `data-shadow-action="open"`

3. **Global state accessor.** Keep it updated on every state change:
   ```ts
   window.shadowERP = {
     getState: () => ({ route, case: currentCaseOrNull, booking: currentBookingOrNull }),
   };
   ```

4. **Save hook.** Before executing ANY action button (post / hold / second_approval / escalate / reject), do this:
   ```ts
   const verdict = await (window.shadow?.beforeSave?.({ action, caseId, booking, reason, approver }) ?? Promise.resolve({ allow: true }));
   if (!verdict.allow) { /* keep the user on the form, do not post, do not advance */ return; }
   ```
   When it is blocked, show nothing yourself. Shadow will speak and show its own overlay. Also expose `window.shadowERP.highlight(field: string)`, which pulses a yellow ring around that booking field for 3 seconds.

## Look & feel
- Neutral greys, one corporate accent (deep teal), compact 13px table text, monospace for amounts.
- German-style number formatting (1.234,56 €), but English UI labels.
- It should look like real enterprise software that a 24-year AP veteran uses every day, not a startup dashboard.

## Seed data guidance
Make the 12 invoices include:
- An equipment invoice of about €6,400 net with no asset number
- A laptop order of about €4,800
- A supplier "Krämer Industriebedarf" with two near-identical invoices in December
- An invoice from "Nordwerk CZ s.r.o." (intercompany, CZK)
- An Austrian supplier with RC tax
- A brand-new unknown supplier whose bank details changed recently
- A PO with a 4% price variance
- An invoice with a 2% Skonto due tomorrow
- Several boring, clean ones
