import { cn } from "@/lib/utils";

const MAP: Record<string, string> = {
  Open: "bg-status-open/15 text-status-open border-status-open/30",
  "On hold": "bg-status-hold/15 text-status-hold border-status-hold/40",
  "Awaiting 2nd approval": "bg-status-approval/15 text-status-approval border-status-approval/30",
  Posted: "bg-status-posted/15 text-status-posted border-status-posted/30",
  Rejected: "bg-status-rejected/15 text-status-rejected border-status-rejected/30",
  Escalated: "bg-status-escalated/15 text-status-escalated border-status-escalated/30",
  Paid: "bg-status-posted/15 text-status-posted border-status-posted/30",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-sm border px-1.5 py-px text-[11px] font-medium",
        MAP[status] ?? "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {status}
    </span>
  );
}
