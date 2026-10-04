import { cn } from "@/lib/utils";

export function SampleNote() {
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-[3px] border-primary bg-card px-3 py-2 text-[13px]">
      <span className="rounded-sm border border-border px-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
        Sample data
      </span>
      <span>Turn on Mira with the Tacet extension, choose <strong className="font-medium">Learn this task</strong>, then work a few tickets.</span>
    </div>
  );
}

export function StatusTag({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-sm border px-1.5 py-px text-[12px]",
        status === "Resolved" ? "border-status-posted/40 text-status-posted" : "border-status-open/40 text-status-open",
      )}
    >
      {status}
    </span>
  );
}

