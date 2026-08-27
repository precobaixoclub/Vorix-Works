import type { ReactNode } from "react";

/** Mantém a API flexível (`actions: ReactNode`) já usada por todas as telas — o design system
 * propõe `action`/`secondaryAction` tipados, mas isso obrigaria reescrever toda tela que já monta
 * combinações livres de botão/select/badge no cabeçalho pra zero ganho visual real. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-2xl font-semibold text-foreground">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex w-full min-w-0 flex-wrap items-stretch gap-2 sm:w-auto sm:items-center">{actions}</div> : null}
    </div>
  );
}
