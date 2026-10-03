import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useErp, SHADOW_API } from "@/lib/erp/store";
import { installShadow, setShadowState } from "@/lib/erp/shadow";

export function AppShell({ children }: { children: ReactNode }) {
  const { source } = useErp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    installShadow(SHADOW_API);
  }, []);
  useEffect(() => {
    setShadowState({ route: pathname });
    if (!pathname.startsWith("/invoice/")) setShadowState({ case: null, booking: null });
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-[13px]">
      <header className="flex h-10 items-center gap-6 bg-shell px-4 text-shell-foreground">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-wide">
          <span className="grid h-6 w-6 place-items-center rounded-sm bg-primary text-[11px] font-bold text-primary-foreground">
            NW
          </span>
          Nordwerk ERP
        </Link>
        <nav className="flex gap-4 text-shell-muted">
          <span>Finance</span>
          <span>›</span>
          <span className="text-shell-foreground">Accounts Payable</span>
        </nav>
        <div className="ml-auto flex items-center gap-4 text-shell-muted">
          <span>Company 1000 · Nordwerk Maschinenbau GmbH</span>
          <span className="rounded-sm border border-shell-muted/40 px-1.5 py-0.5 text-[11px]">
            {source === "api" ? "Live data" : "Local data"}
          </span>
          <span className="text-shell-foreground">S. Albrecht</span>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
