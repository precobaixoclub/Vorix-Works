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
    <section className={`mb-6 rounded-xl border border-border bg-surface-raised p-3 sm:p-4 ${className}`}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
          <ol className="mt-3 grid gap-2 sm:grid-cols-2">
            {items.map((item, index) => (
              <li key={item} className="flex min-w-0 gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">
                  {index + 1}
                </span>
                <span className="min-w-0 break-words">{item}</span>
              </li>
            ))}
          </ol>
        </div>
        {aside ? <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-3 text-sm text-ink-muted">{aside}</div> : null}
      </div>
    </section>
  );
}

export function InfoCallout({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-surface-raised p-3 sm:p-4 ${className}`}>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="mt-1 text-sm text-ink-muted">{children}</div>
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
    <section className={`rounded-xl border border-border bg-surface-raised ${className}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left sm:px-4">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          {description ? <span className="mt-0.5 block text-xs text-ink-muted">{description}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badge ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-primary">{badge}</span> : null}
          <span className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold text-ink-muted">
            {open ? "Ocultar" : "Abrir"}
          </span>
        </span>
      </button>
      {open ? <div className="border-t border-border px-3 py-3 sm:px-4">{children}</div> : null}
    </section>
  );
}
