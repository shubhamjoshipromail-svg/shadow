import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useErp, SHADOW_API } from "@/lib/erp/store";
import { installShadow, setShadowState } from "@/lib/erp/shadow";
import { cn } from "@/lib/utils";

/** Support routes are a generic, extension-owned surface: no window.shadowERP, no auto-loaded capture.js. */
const isSupport = (p: string) => p === "/support" || p.startsWith("/support/");

export function AppShell({ children }: { children: ReactNode }) {
  const { source } = useErp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const support = isSupport(pathname);

  useEffect(() => {
    if (!support) installShadow(SHADOW_API);
  }, [support]);
  useEffect(() => {
    if (support) return;
    setShadowState({ route: pathname });
    if (!pathname.startsWith("/invoice/")) setShadowState({ case: null, booking: null });
  }, [pathname, support]);

  const tab = (active: boolean) =>
    cn(
      "border-b-2 py-2 transition-colors",
      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex min-h-screen flex-col bg-background text-[14px]">
      <header className="flex h-11 items-center gap-4 border-b border-border bg-card px-4 text-foreground md:gap-6">
        <Link to="/" className="flex items-center gap-2 whitespace-nowrap">
          <span className="font-serif text-[18px] leading-none">Nordwerk</span>
          <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground sm:inline">
            ERP
          </span>
        </Link>
        <nav className="flex h-full items-end gap-4">
          <Link to="/" className={tab(!support)}>
            Invoices
          </Link>
          <Link to="/support" className={tab(support)}>
            Support
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-[12px] text-muted-foreground">
          <span className="hidden lg:inline">Company 1000 · Nordwerk Maschinenbau GmbH</span>
          {!support && (
            <span className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10.5px] sm:inline">
              {source === "api" ? "Live data" : "Local data"}
            </span>
          )}
          <span className="text-foreground">S. Albrecht</span>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
