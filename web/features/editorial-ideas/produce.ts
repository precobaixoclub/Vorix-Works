import { getEditorialBrief, updateEditorialIdea, type EditorialIdea } from "@/features/editorial-ideas/api";
import { generateFromIdea } from "@/features/production-line/api";
import type { ProductionAspectRatio, ProductionChannel } from "@/features/production-line/types";

/**
 * Coloca uma ideia do Bolsão em produção — UM caminho só, usado pelo Bolsão e por "Criar conteúdo"
 * (Fase 4). Parte do briefing completo da ideia (`getEditorialBrief`: prompt criativo, roteiro,
 * legenda, CTA, direção visual), mantém as imagens de referência e chama o MESMO motor de sempre
 * (`generateFromIdea`). Depois marca a ideia como "Em produção" com o vínculo da execução, para o
 * Bolsão acompanhar o estado real (produzida/aprovada/volta a disponível se falhar).
 */
export async function startIdeaProduction(
  workspaceId: string,
  idea: Pick<EditorialIdea, "id" | "referenceImages">,
  options: { channel?: ProductionChannel; aspectRatio?: ProductionAspectRatio } = {},
): Promise<{ executionRunId: string; idea: EditorialIdea }> {
  const brief = await getEditorialBrief(workspaceId, idea.id);
  const references = idea.referenceImages ?? [];
  const run = await generateFromIdea({
    workspaceId,
    ...brief,
    channel: options.channel ?? "instagram",
    aspectRatio: options.aspectRatio ?? "4:5",
    ...(references.length ? { referenceImages: references, referenceAssets: references.map((url) => ({ url, role: "product_photo" as const })) } : {}),
  });
  const updated = await updateEditorialIdea(workspaceId, idea.id, { status: "in_production", executionRunId: run.executionRunId });
  return { executionRunId: run.executionRunId, idea: updated };
}
