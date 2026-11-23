"use client";

import Link from "next/link";
import { contentPipeline, type PipelineStep } from "@/features/marketing/content-stages";
import type { EditorialIdea } from "@/features/editorial-ideas/api";
import type { SocialPostView } from "@/features/social/types";
import { cn } from "@/lib/utils";

/**
 * Jornada do conteúdo (Fase 4): de ideia a publicado, com quantos itens há em cada etapa e um
 * clique para a tela onde eles estão. Números vêm do Bolsão e das publicações reais; fonte que não
 * carregou mostra "—" (nunca um zero inventado).
 */
export function ContentPipeline({ base, ideas, posts }: { base: string; ideas: readonly EditorialIdea[] | undefined; posts: readonly SocialPostView[] | undefined }) {
  const steps = contentPipeline({ ideas, posts });
  return (
    <nav aria-label="Etapas do conteúdo" className="-mx-1 overflow-x-auto px-1 pb-1" data-testid="content-pipeline">
      <ol className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-6">
        {steps.map((step) => <Step key={step.key} base={base} step={step} />)}
      </ol>
    </nav>
  );
}

function Step({ base, step }: { base: string; step: PipelineStep }) {
  const tone = step.key === "failed" && step.count ? "text-destructive" : step.key === "review" && step.count ? "text-warning" : "text-foreground";
  return (
    <li className="min-w-0">
      <Link href={`${base}${step.href}`} data-step={step.key} className="flex min-h-[60px] min-w-0 flex-col justify-center rounded-xl border border-border/70 bg-card px-3 py-2 transition-colors hover:border-solution/45 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45">
        <span className={cn("text-lg font-semibold tabular-nums leading-tight", tone)}>{step.count === undefined ? "—" : step.count.toLocaleString("pt-BR")}</span>
        <span className="text-[11px] leading-tight text-muted-foreground">{step.label}</span>
      </Link>
    </li>
  );
}
