import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FilterBar({
  children,
  summary,
  className,
}: {
  children: ReactNode;
  summary?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-5 flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-card/80 px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {summary ? <div className="shrink-0 text-xs text-muted-foreground">{summary}</div> : null}
    </div>
  );
}
