const SYM: Record<string, string> = { EUR: "€", CZK: "Kč", USD: "$" };

export function money(n: number, cur = "EUR") {
  return (
    new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) +
    " " +
    (SYM[cur] ?? cur)
  );
}

export function num(n: number) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(n);
}

export function date(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function flag(cc: string) {
  return cc
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
