import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex min-w-0 flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="break-words font-display text-xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex w-full min-w-0 flex-wrap items-stretch gap-2 sm:w-auto sm:items-center">{actions}</div> : null}
    </div>
  );
}
