"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Vorix AI — identidade visual ÚNICA de todo recurso de IA (resumo, sugestão, análise, próxima
 * ação, riscos...). Um ícone só (Sparkles), um gradiente só (violeta → azul), uma superfície só.
 * Nunca criar outro "sparkle" por tela.
 */
export function VorixAiIcon({ className }: { className?: string }) {
  return <Sparkles aria-hidden="true" className={cn("h-4 w-4 text-ai", className)} />;
}

export function AiBadge({ label = "Vorix AI", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-ai/30 bg-ai/10 px-2 py-0.5 text-[11px] font-semibold", className)}>
      <VorixAiIcon className="h-3 w-3" />
      <span className="vorix-ai-text">{label}</span>
    </span>
  );
}

export type AiLoadingKind = "analyzing" | "generating" | "summarizing" | "transcribing";
const AI_LOADING_LABEL: Record<AiLoadingKind, string> = {
  analyzing: "Analisando",
  generating: "Gerando",
  summarizing: "Resumindo",
  transcribing: "Transcrevendo",
};

/** Carregamento de IA — nunca spinner genérico: barra com brilho discreto + verbo da ação. */
export function AiLoading({ kind = "analyzing", detail, className }: { kind?: AiLoadingKind; detail?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("space-y-2 rounded-xl vorix-ai-surface p-3", className)}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-ai">
        <VorixAiIcon className="h-3.5 w-3.5" />
        {AI_LOADING_LABEL[kind]}…{detail ? <span className="font-normal text-muted-foreground"> {detail}</span> : null}
      </p>
      <div className="h-2 w-full rounded-full vorix-ai-shimmer" />
      <div className="h-2 w-2/3 rounded-full vorix-ai-shimmer" />
    </div>
  );
}

/**
 * Cartão de insight de IA. Sempre deixa claro que é SUGESTÃO (nunca verdade absoluta) e que ações
 * críticas exigem confirmação humana — o rodapé padrão diz isso.
 */
export function AIInsightCard({
  title,
  children,
  actions,
  meta,
  footnote = "Sugestão da IA — revise antes de agir.",
  className,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  footnote?: string | null;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl vorix-ai-surface p-4", className)}>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AiBadge />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {meta ? <div className="text-[11px] text-muted-foreground">{meta}</div> : null}
      </header>
      <div className="space-y-2 text-sm text-text-secondary">{children}</div>
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      {footnote ? <p className="mt-3 text-[11px] text-muted-foreground">{footnote}</p> : null}
    </section>
  );
}
