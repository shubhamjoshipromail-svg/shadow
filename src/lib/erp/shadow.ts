import type { ActionKind, Booking, Case } from "./types";

type Verdict = { allow: boolean };
declare global {
  interface Window {
    SHADOW_API?: string;
    shadow?: {
      beforeSave?: (p: {
        action: ActionKind;
        caseId: string;
        booking: Booking;
        reason?: string;
        approver?: string;
      }) => Promise<Verdict>;
    };
    shadowERP?: {
      getState: () => { route: string; case: Case | null; booking: Booking | null };
      highlight: (field: string) => void;
    };
  }
}

const state: { route: string; case: Case | null; booking: Booking | null } = {
  route: "/",
  case: null,
  booking: null,
};

export function setShadowState(patch: Partial<typeof state>) {
  Object.assign(state, patch);
}

export function highlightField(field: string) {
  const el = document.querySelector<HTMLElement>(`[data-shadow-field="${CSS.escape(field)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("shadow-pulse");
  void el.offsetWidth;
  el.classList.add("shadow-pulse");
  setTimeout(() => el.classList.remove("shadow-pulse"), 3000);
}

export function installShadow(api: string) {
  if (typeof window === "undefined") return;
  window.shadowERP = {
    getState: () => ({ route: state.route, case: state.case, booking: state.booking }),
    highlight: highlightField,
  };
  window.SHADOW_API = api;
  if (!document.getElementById("shadow-capture")) {
    const s = document.createElement("script");
    s.id = "shadow-capture";
    s.defer = true;
    s.src = `${api}/capture.js`;
    s.onerror = () => console.info("shadow capture not loaded");
    document.head.appendChild(s);
  }
}

export async function beforeSave(p: {
  action: ActionKind;
  caseId: string;
  booking: Booking;
  reason?: string;
  approver?: string;
}): Promise<Verdict> {
  try {
    return await (window.shadow?.beforeSave?.(p) ?? Promise.resolve({ allow: true }));
  } catch {
    return { allow: true };
  }
}
