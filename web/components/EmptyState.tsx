import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Estado vazio do Vorix Design System 2.0 — ícone em placa de acento, mensagem clara, microcopy e
 * CTA. Nunca só "Nenhum registro encontrado": diga o que a pessoa pode fazer a seguir.
 * `tone="ai"` para vazios de recursos de IA; o padrão segue o acento da solução ativa.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "solution",
  compact,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "solution" | "ai" | "neutral";
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-border/80 px-4 text-center sm:px-6",
        compact ? "py-8" : "py-12 sm:py-16",
        className,
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 vorix-grid opacity-40" />
      {icon ? (
        <div
          className={cn(
            "relative mb-1 flex h-11 w-11 items-center justify-center rounded-xl border [&_svg]:h-5 [&_svg]:w-5",
            tone === "ai" ? "border-ai/30 bg-ai/10 text-ai" : tone === "neutral" ? "border-border bg-surface-2 text-muted-foreground" : "border-solution/25 bg-solution/10 text-solution",
          )}
        >
          {icon}
        </div>
      ) : null}
      <p className="relative text-sm font-semibold text-foreground">{title}</p>
      {description ? <p className="relative max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="relative mt-3">{action}</div> : null}
    </div>
  );
}
