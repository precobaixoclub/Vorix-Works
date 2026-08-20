/**
 * Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — instruções
 * criativas permanentes por workspace, editáveis pelo usuário a qualquer momento sem deploy.
 * Único texto livre (`productionPrompt`) + um punhado pequeno de opções estruturadas de
 * comportamento, escolhidas deliberadamente para não duplicar o que o texto livre já cobre (ver
 * `db/migrations/0065_workspace_production_settings.sql` para a justificativa de cada campo
 * mantido/descartado). Tudo aqui entra em `CreativeContext.productionInstructions`/
 * `behaviorPreferences` (ver `gpt-creative-plan.types.ts`) — nunca reintroduz `layoutFamily`/
 * candidate planning/regras rígidas do motor legado.
 */

export const TEXT_DENSITY_OPTIONS = ["minimal", "balanced", "rich"] as const;
export type TextDensity = (typeof TEXT_DENSITY_OPTIONS)[number];

export const CREATIVE_FREEDOM_OPTIONS = ["low", "medium", "high"] as const;
export type CreativeFreedom = (typeof CREATIVE_FREEDOM_OPTIONS)[number];

export type ProductionSettings = {
  workspaceId: string;
  /** Texto livre, permanente, incluído verbatim em toda geração daquele workspace — ver
   * "Instruções de geração de conteúdo"/"Prompt de Produção"/"Diretrizes Criativas" no pedido do
   * usuário. `undefined` = workspace ainda não configurou nada (nunca inventa um texto). */
  productionPrompt?: string;
  /** Incrementado a cada update — só um número de referência estável; a prova de auditoria real
   * de qual texto foi usado em cada execução é o snapshot completo em
   * `creative_engine_runs.creative_context.productionInstructions`, não este número por si só. */
  version: number;
  preferRealAssets: boolean;
  allowFictionalInterfaces: boolean;
  allowGeneratedPeople: boolean;
  textDensity: TextDensity;
  creativeFreedom: CreativeFreedom;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_PRODUCTION_SETTINGS: Omit<ProductionSettings, "workspaceId" | "createdAt" | "updatedAt"> = {
  version: 1,
  preferRealAssets: true,
  allowFictionalInterfaces: false,
  allowGeneratedPeople: true,
  textDensity: "balanced",
  creativeFreedom: "medium",
};

/** Traduz as opções estruturadas em frases claras para o GPT — nunca uma árvore de regras, só
 * texto. Usado por `build-creative-context.ts`; mantido aqui (não em `application/`) pelo mesmo
 * motivo de `commercial-fact-normalizer.ts` — utilitário puro, sem I/O, reaproveitável dos dois
 * lados. */
export function describeProductionSettingsAsInstructions(settings: Pick<ProductionSettings, "preferRealAssets" | "allowFictionalInterfaces" | "allowGeneratedPeople" | "textDensity" | "creativeFreedom">): string[] {
  const lines: string[] = [];
  lines.push(settings.preferRealAssets
    ? "Priorize sempre o uso de assets reais (fotos/screenshots/logo reais) em vez de recriar visualmente o que já existe como arquivo real."
    : "Não há preferência forçada por assets reais — use julgamento criativo normal.");
  lines.push(settings.allowFictionalInterfaces
    ? "Interfaces fictícias (telas/apps inventados) são permitidas quando não houver screenshot real disponível."
    : "NUNCA invente uma interface fictícia de site/app — se não houver screenshot real disponível para o que foi pedido, prefira outra direção criativa que não dependa de mostrar uma tela.");
  lines.push(settings.allowGeneratedPeople
    ? "Pessoas geradas por IA são permitidas na peça quando fizer sentido criativo."
    : "Não gere pessoas/rostos humanos artificiais na peça.");
  lines.push({
    minimal: "Use o mínimo de texto possível na peça — priorize impacto visual sobre texto.",
    balanced: "Use uma quantidade equilibrada de texto — nem poluído, nem vazio.",
    rich: "Pode usar mais texto/informação na peça quando o conteúdo pedir — não corte informação relevante só por minimalismo.",
  }[settings.textDensity]);
  lines.push({
    low: "Liberdade criativa baixa — siga as diretrizes e materiais da marca de forma conservadora, com poucas variações.",
    medium: "Liberdade criativa média — siga as diretrizes da marca, mas com espaço para variação criativa razoável.",
    high: "Liberdade criativa alta — use as diretrizes da marca como base, mas sinta-se livre para explorar direções criativas mais ousadas.",
  }[settings.creativeFreedom]);
  return lines;
}
