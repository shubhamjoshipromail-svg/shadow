import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared slim header. Switching workspace uses plain <a href> (full-document navigation) on purpose:
 * the invoice shell installs window.shadowERP and capture.js, which must never survive into /support.
 */
export function WorkspaceHeader({ active, badge }: { active: "invoices" | "support"; badge?: ReactNode }) {
  const tab = (on: boolean) =>
    cn(
      "border-b-2 py-2.5 transition-colors",
      on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
    );
  return (
    <header className="flex h-11 items-center gap-4 border-b border-border bg-card px-4 text-foreground md:gap-6">
      <a href={active === "invoices" ? "/" : "/support"} className="flex items-center gap-2 whitespace-nowrap">
        <span className="font-serif text-[18px] leading-none">Nordwerk</span>
        <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground sm:inline">
          {active === "invoices" ? "ERP" : "Service"}
        </span>
      </a>
      <nav className="flex h-full items-end gap-4">
        <a href="/" className={tab(active === "invoices")}>
          Invoices
        </a>
        <a href="/support" className={tab(active === "support")}>
          Support
        </a>
      </nav>
      <div className="ml-auto flex items-center gap-3 text-[12px] text-muted-foreground">
        <span className="hidden lg:inline">Nordwerk Maschinenbau GmbH</span>
        {badge}
        <span className="text-foreground">{active === "invoices" ? "S. Albrecht" : "J. Okafor"}</span>
      </div>
    </header>
  );
}
