import { useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { useErp, SHADOW_API } from "@/lib/erp/store";
import { installShadow, setShadowState } from "@/lib/erp/shadow";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";

/** Invoice (AP) shell only. Installs window.shadowERP + capture.js; never mounted on /support. */
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
    <div className="flex min-h-screen flex-col bg-background text-[14px]">
      <WorkspaceHeader
        active="invoices"
        badge={
          <span className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10.5px] sm:inline">
            {source === "api" ? "Live data" : "Local data"}
          </span>
        }
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
