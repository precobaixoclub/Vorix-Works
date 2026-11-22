import { productionStorageKey } from "@/features/production-line/storage";
import type { ContentBlueprint, ProductionLineConfig } from "@/features/production-line/types";
import type { EditorialIdeaInput } from "./api";

/**
 * As ideias da antiga aba "Planejamento" da Produção viviam só no navegador (localStorage). Agora o
 * Bolsão é o único lugar das ideias: ao abrir o Bolsão, as que ainda estiverem no navegador sobem
 * para ele e saem do armazenamento local. Só lê o que a pessoa de fato guardou — nunca os exemplos
 * padrão da tela antiga.
 */
export function readLocalTankIdeas(workspaceId: string): ContentBlueprint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(productionStorageKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<ProductionLineConfig>;
    if (!Array.isArray(parsed.blueprints)) return [];
    return parsed.blueprints.filter((idea) => Boolean((idea?.name ?? "").trim() || (idea?.ideaText ?? "").trim()));
  } catch {
    return [];
  }
}

export function clearLocalTankIdeas(workspaceId: string, migratedIds: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    const key = productionStorageKey(workspaceId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<ProductionLineConfig>;
    const gone = new Set(migratedIds);
    window.localStorage.setItem(key, JSON.stringify({ ...parsed, blueprints: (parsed.blueprints ?? []).filter((idea) => !gone.has(idea.id)) }));
  } catch { /* armazenamento indisponível: tenta de novo na próxima visita */ }
}

const clip = (value: string | undefined, max: number) => {
  const text = (value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
};

/** Ideia antiga do navegador → cadastro do Bolsão. Carrossel antigo não tinha telas: vira imagem
 * única com o pedido de carrossel na direção de arte (nada se perde). */
export function blueprintToIdeaInput(idea: ContentBlueprint, withReferences: boolean): EditorialIdeaInput {
  const title = clip(idea.name, 200) || clip(idea.ideaText, 120) || "Ideia sem título";
  const direction = [
    idea.format === "carousel" ? "Formato desejado: carrossel." : "",
    idea.ideaText?.trim() ?? "",
    idea.creativeDirection?.trim() ? `Direção criativa: ${idea.creativeDirection.trim()}` : "",
  ].filter(Boolean).join("\n\n");
  return {
    title,
    format: idea.format === "video" ? "video" : "single_image",
    ...(idea.theme?.trim() ? { category: clip(idea.theme, 80) } : {}),
    ...(idea.ideaText?.trim() ? { keyMessage: clip(idea.ideaText, 400) } : {}),
    ...(idea.captionDirection?.trim() ? { caption: clip(idea.captionDirection, 2200) } : {}),
    ...(idea.objective?.trim() ? { commercialObjective: clip(idea.objective, 300) } : {}),
    ...(idea.targetAudience?.trim() ? { targetAudience: clip(idea.targetAudience, 300) } : {}),
    ...(direction ? { creativePrompt: clip(direction, 8000) } : {}),
    ...(withReferences && idea.referenceImages?.length ? { referenceImages: idea.referenceImages.slice(0, 6) } : {}),
  };
}
