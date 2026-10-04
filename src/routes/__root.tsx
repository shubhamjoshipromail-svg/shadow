import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ErpProvider, SHADOW_API } from "@/lib/erp/store";
import { AppShell } from "@/components/erp/AppShell";
import { SupportProvider } from "@/lib/support/store";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Nordwerk ERP" },
      { name: "description", content: "Accounts payable for Nordwerk Maschinenbau GmbH." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const support = pathname === "/support" || pathname.startsWith("/support/");

  // Support desk, generic mode: `?tacet=learn` loads the Tacet companion without the browser extension.
  // Deliberately no window.shadowERP, so the companion treats this as a page it has never seen.
  useEffect(() => {
    if (!support) return;
    let on = new URLSearchParams(window.location.search).get("tacet") === "learn";
    try {
      if (on) sessionStorage.setItem("tacet.learn", "1");
      else on = sessionStorage.getItem("tacet.learn") === "1";
    } catch {
      /* storage is best-effort */
    }
    if (!on || document.getElementById("shadow-capture")) return;
    window.SHADOW_API = SHADOW_API;
    (window as unknown as { SHADOW_NAME?: string }).SHADOW_NAME = "Mira";
    const s = document.createElement("script");
    s.id = "shadow-capture";
    s.defer = true;
    s.src = `${SHADOW_API}/capture.js`;
    document.head.appendChild(s);
  }, [support]);

  return (
    <QueryClientProvider client={queryClient}>
      {support ? (
        // Generic, extension-owned surface: no ERP context, no window.shadowERP; the companion loads only with ?tacet=learn.
        <SupportProvider>
          <div className="flex min-h-screen flex-col bg-background text-[14px]">
            <WorkspaceHeader active="support" />
            <main className="flex-1">
              <Outlet />
            </main>
          </div>
        </SupportProvider>
      ) : (
        <ErpProvider>
          <AppShell>
            <Outlet />
          </AppShell>
        </ErpProvider>
      )}
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}
