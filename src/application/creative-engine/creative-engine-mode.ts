import type { ExecutionFeatureFlags } from "../execution/feature-flags.js";

/**
 * Seleção de motor criativo — migração "GPT como motor criativo único" (PR 6/9). A escolha
 * acontece UMA VEZ no boot do processo (`api-config.ts` deriva as duas flags de uma única
 * variável de ambiente, `CREATIVE_ENGINE`, tornando "os dois ligados" ou "nenhum ligado"
 * literalmente irrepresentável no tipo — nunca uma decisão por execução). Este módulo só valida
 * essa invariante e expõe o modo resolvido para quem monta o Planning/Execution.
 */

export const CREATIVE_ENGINE_MODES = ["gpt", "legacy"] as const;
export type CreativeEngineMode = (typeof CREATIVE_ENGINE_MODES)[number];

export type CreativeEngineSelection = {
  mode: CreativeEngineMode;
  reason: string;
};

/**
 * Nunca deveria lançar em produção real (a derivação em `api-config.ts` já torna ambíguo/vazio
 * irrepresentável) — existe para (a) documentar a invariante explicitamente, (b) proteger contra
 * qualquer código futuro que monte `ExecutionFeatureFlags` por outro caminho (testes, scripts) sem
 * passar pela derivação de `api-config.ts`.
 */
export function resolveCreativeEngineMode(
  flags: Pick<ExecutionFeatureFlags, "creativeEngineGptEnabled" | "legacyCreativeEngineEnabled">,
): CreativeEngineSelection {
  if (flags.creativeEngineGptEnabled && flags.legacyCreativeEngineEnabled) {
    throw new Error(
      "CREATIVE_ENGINE_AMBIGUOUS: creativeEngineGptEnabled e legacyCreativeEngineEnabled não podem estar ligados na mesma execução — a seleção de motor precisa ser mutuamente exclusiva.",
    );
  }
  if (flags.creativeEngineGptEnabled) return { mode: "gpt", reason: "creativeEngineGptEnabled=true" };
  if (flags.legacyCreativeEngineEnabled) return { mode: "legacy", reason: "legacyCreativeEngineEnabled=true" };
  throw new Error("CREATIVE_ENGINE_NONE: nenhum motor criativo habilitado — creativeEngineGptEnabled e legacyCreativeEngineEnabled estão ambos desligados.");
}

/** Chamado uma vez no boot (`container.ts`) — falha alto e cedo em vez de deixar uma execução
 * descobrir a ambiguidade/ausência de motor no meio do caminho. */
export function assertCreativeEngineExclusivity(flags: ExecutionFeatureFlags): void {
  resolveCreativeEngineMode(flags);
}
