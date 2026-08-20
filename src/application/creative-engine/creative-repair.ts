import { CREATIVE_PLAN_RESPONSE_SCHEMA_HINT, type CreativeContext, type CreativePlan } from "../../shared/utils/gpt-creative-plan.types.js";
import type { CreativeQualityIssue, CreativeQualityIssueCode } from "./evaluate-creative-quality-gate.js";

/**
 * Roteamento de reparo do motor GPT — migração "GPT como motor criativo único" (PR 5/9). O
 * quality gate DESCREVE o problema; quem CORRIGE é sempre o GPT (mesmo modelo diretor,
 * `gpt_replan`) ou, só para defeitos puramente geométricos que o próprio renderer determinístico
 * causou, um reflow local (`renderer_reflow`) — nunca o motor/renderer legado "refazendo" a
 * direção de arte do GPT.
 */

export const MAX_CREATIVE_REPAIR_ROUNDS = 2;

export const CREATIVE_REPAIR_ROUTES = ["renderer_reflow", "gpt_replan", "unrecoverable"] as const;
export type CreativeRepairRoute = (typeof CREATIVE_REPAIR_ROUTES)[number];

export type CreativeRepairRound = {
  round: number;
  route: CreativeRepairRoute;
  issues: CreativeQualityIssue[];
  instructions: string[];
  resolved: boolean;
};

/** Únicos códigos cuja causa é geométrica E cuja origem é sempre uma zona de texto que o
 * RENDERER (não o modelo de imagem) desenhou — reposicionar/redimensionar resolve sem precisar
 * de uma nova decisão criativa. Todo o resto (produto errado, logo errada, screenshot
 * descaracterizado, fato comercial inventado, sobreposição crítica, composição quebrada, aspect
 * ratio errado, asset obrigatório ausente, origem não publicável) é uma falha de CONCEITO ou de
 * FATO, nunca puramente geométrica — sempre volta ao GPT. */
const RENDERER_REFLOW_CODES: readonly CreativeQualityIssueCode[] = ["TEXT_ILLEGIBLE_OR_CUT", "ELEMENT_CUT_OFF"];

/**
 * Decide a rota de reparo para uma rodada — nunca decide SE deve reparar (isso é responsabilidade
 * de quem chama, comparando `attempt` com `MAX_CREATIVE_REPAIR_ROUNDS`), só COMO. Uma rodada só
 * vai para `renderer_reflow` quando TODOS os problemas são geométricos-de-renderer; um único
 * problema criativo/factual no meio já manda a rodada inteira de volta ao GPT (nunca mistura as
 * duas correções na mesma rodada).
 */
export function routeCreativeRepair(
  issues: readonly CreativeQualityIssue[],
  attempt: number,
): { route: CreativeRepairRoute; instructions: string[] } {
  const instructions = issues.map((issue) => issue.message);

  if (attempt >= MAX_CREATIVE_REPAIR_ROUNDS) {
    return { route: "unrecoverable", instructions };
  }

  const allRendererFixable = issues.length > 0 && issues.every((issue) => RENDERER_REFLOW_CODES.includes(issue.code));
  if (allRendererFixable) {
    return { route: "renderer_reflow", instructions };
  }

  return { route: "gpt_replan", instructions };
}

/**
 * Prompt de correção enviado ao MESMO modelo diretor criativo — plano anterior verbatim + os
 * motivos exatos da reprovação, nunca uma reinterpretação do defeito por outra camada. Preserva
 * fatos comerciais confirmados (nunca permite que uma correção "resolva" um problema inventando
 * outro fato).
 */
export function buildCreativePlanRepairPrompt(previousPlan: CreativePlan, context: CreativeContext, instructions: readonly string[]): string {
  const lines = [
    "Você é o mesmo diretor de criação sênior que produziu o creative_plan abaixo. Um controle de qualidade encontrou problemas GRAVES na peça final gerada a partir dele — corrija exatamente esses problemas, preservando tudo o que já funcionava no plano.",
    "",
    "PLANO ANTERIOR (JSON completo):",
    JSON.stringify(previousPlan),
    "",
    "PROBLEMAS ENCONTRADOS PELO QUALITY GATE (corrija exatamente estes, nunca introduza um problema novo):",
    ...instructions.map((instruction) => `- ${instruction}`),
    "",
    `Marca: ${context.brandName}`,
    "Fatos comerciais CONFIRMADOS (use exatamente estes, nunca invente outro valor):",
    context.confirmedFacts.length > 0 ? context.confirmedFacts.map((fact) => `- ${fact}`).join("\n") : "- Nenhum fato comercial confirmado disponível. Não mencione preço, desconto, prazo ou qualquer condição comercial específica.",
    "",
    "Responda APENAS com JSON válido, sem markdown, no formato exato (mesmo schema do plano anterior):",
    CREATIVE_PLAN_RESPONSE_SCHEMA_HINT,
  ];
  return lines.join("\n");
}
