"use client";

import useSWR from "swr";
import { AlertTriangle, CheckCircle2, ImageOff, Layers, MonitorSmartphone, Package, Sparkles } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * "Como a arte será produzida" — o que o motor criativo vai usar ANTES de gerar, em linguagem de
 * designer: o tipo de peça, o material principal (foto do produto ou tela real), o papel de cada
 * arquivo anexado, o que fica de fora e por quê, o que falta e a composição de cada tela. Para trocar
 * um material, a pessoa edita as imagens da ideia — o modo acompanha os materiais escolhidos.
 */

export type CreativePlanPreview = {
  businessKind: string;
  mode: "physical_product" | "software" | "conceptual";
  modeLabel?: string;
  modeReasons: string[];
  feature: { key: string; label: string } | null;
  blocked: boolean;
  guidance: Array<{ code: string; blocking: boolean; message: string }>;
  autoSelected: Array<{ id: string; reason: string }>;
  references: Array<{ id: string; role: string; roleLabel: string; roleReason: string; source: string; productCode?: string; variantLabel?: string; name?: string; url?: string; principal: boolean; used: boolean; excludedReason?: string }>;
  screens: Array<{ index: number; headline: string; archetype: string; compositionLabel: string; operation: string; intent: string; fidelity: string[]; avoid: string[] }>;
};

export function fetchCreativePlan(workspaceId: string, ideaId: string) {
  return apiClient.get<CreativePlanPreview>(`/v1/editorial-ideas/${encodeURIComponent(ideaId)}/creative-plan?workspaceId=${encodeURIComponent(workspaceId)}`);
}

const MODE_ICON = { physical_product: Package, software: MonitorSmartphone, conceptual: Sparkles } as const;
const OPERATION_LABEL: Record<string, string> = {
  deterministic_composite: "com o arquivo original",
  ai_edit_with_reference: "IA a partir da foto original (conferida depois)",
  ai_scene_with_composite: "cenário pela IA + arquivo original",
  ai_generation: "criação livre pela IA",
};

export function CreativePlanPanel({ workspaceId, ideaId, referenceCount, onEditReferences }: { workspaceId: string; ideaId: string; referenceCount: number; onEditReferences: () => void }) {
  const { data, error, isLoading } = useSWR(["creative-plan", workspaceId, ideaId, referenceCount], () => fetchCreativePlan(workspaceId, ideaId));
  if (isLoading) return <p className="text-sm text-muted-foreground" data-testid="creative-plan-loading">Analisando os materiais da ideia…</p>;
  if (error || !data) return <p className="text-sm text-muted-foreground">Não foi possível montar a prévia agora. A arte segue as regras da marca.</p>;
  const Icon = MODE_ICON[data.mode];
  const principal = data.references.find((reference) => reference.principal);
  return (
    <div className="space-y-4" data-testid="creative-plan">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary dark:text-primary-glow" aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground" data-testid="creative-plan-mode">{data.modeLabel}{data.feature ? ` · ${data.feature.label}` : ""}</p>
          {data.modeReasons.map((reason) => <p key={reason} className="text-xs text-muted-foreground">{reason}</p>)}
          {principal ? (
            <p className="text-xs text-foreground"><span className="font-medium">Material principal:</span> {principal.roleLabel}{principal.productCode ? ` · modelo ${principal.productCode}` : ""}{principal.variantLabel ? ` · ${principal.variantLabel}` : ""}{principal.name ? ` · ${principal.name}` : ""}</p>
          ) : null}
          {data.autoSelected.map((item) => <p key={item.id} className="text-xs text-muted-foreground">{item.reason}</p>)}
        </div>
      </div>

      {data.guidance.length ? (
        <ul className="space-y-2" data-testid="creative-plan-guidance">
          {data.guidance.map((item) => (
            <li key={`${item.code}-${item.message}`} className={cn("flex items-start gap-2 rounded-lg border p-3 text-sm", item.blocking ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "border-border text-muted-foreground")}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{item.blocking ? <strong className="font-semibold">Antes de gerar: </strong> : null}{item.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {data.references.length ? (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Materiais da ideia">
          {data.references.map((reference) => (
            <li key={reference.id} className={cn("flex gap-3 rounded-lg border p-2", reference.used ? "border-border" : "border-dashed border-border/70 opacity-80")}>
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {reference.url ? <img src={reference.url} alt="" className="h-full w-full object-cover" /> : <ImageOff className="m-4 h-6 w-6 text-muted-foreground" aria-hidden="true" />}
              </div>
              <div className="min-w-0 text-xs">
                <p className="font-medium text-foreground">{reference.roleLabel}{reference.principal ? " · principal" : ""}</p>
                {reference.productCode || reference.variantLabel || reference.name ? <p className="truncate text-muted-foreground">{[reference.productCode && `Modelo ${reference.productCode}`, reference.variantLabel, reference.name].filter(Boolean).join(" · ")}</p> : null}
                <p className={cn("mt-0.5", reference.used ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
                  {reference.used ? <><CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />Vai para a arte</> : reference.excludedReason ?? "Não usada nesta peça"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Layers className="h-3.5 w-3.5" aria-hidden="true" /> Composição</p>
        <ol className="space-y-1.5">
          {data.screens.map((screen) => (
            <li key={screen.index} className="text-sm">
              <span className="font-medium text-foreground">{data.screens.length > 1 ? `${screen.index}. ` : ""}{screen.compositionLabel}</span>
              <span className="text-muted-foreground"> — {OPERATION_LABEL[screen.operation] ?? screen.operation}</span>
              <span className="block text-xs text-muted-foreground">{screen.intent}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-xs text-muted-foreground">
        Para mudar o material (outro produto, outra cor, outra tela), <button type="button" className="font-medium text-primary underline underline-offset-2 dark:text-primary-glow" onClick={onEditReferences}>troque as imagens da ideia</button>. A peça só é aprovada se mostrar o produto ou a tela verdadeiros.
      </p>
    </div>
  );
}
