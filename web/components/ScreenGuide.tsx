import type { ReactNode } from "react";

export function ScreenGuide({
  title = "Guia rápido",
  description,
  items,
  aside,
  className = "",
}: {
  title?: string;
  description?: string;
  items: readonly string[];
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-6 rounded-xl border border-border/60 bg-card p-3 sm:p-4 ${className}`}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          <ol className="mt-3 grid gap-2 sm:grid-cols-2">
            {items.map((item, index) => (
              <li key={item} className="flex min-w-0 gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 break-words">{item}</span>
              </li>
            ))}
          </ol>
        </div>
        {aside ? <div className="min-w-0 rounded-lg border border-border/60 bg-background px-3 py-3 text-sm text-muted-foreground">{aside}</div> : null}
      </div>
    </section>
  );
}

export function InfoCallout({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border/60 bg-card p-3 sm:p-4 ${className}`}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-1 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export function ProgressivePanel({
  title,
  description,
  open,
  onToggle,
  badge,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  open: boolean;
  onToggle: () => void;
  badge?: number | string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border/60 bg-card ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 sm:px-4"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          {description ? <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badge ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{badge}</span> : null}
          <span className="rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground">
            {open ? "Ocultar" : "Abrir"}
          </span>
        </span>
      </button>
      {open ? <div className="border-t border-border/60 px-3 py-3 sm:px-4">{children}</div> : null}
    </section>
  );
}
