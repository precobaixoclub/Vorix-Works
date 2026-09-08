import { createHash } from "node:crypto";
import type { PromptTemplate } from "../prompt-template.js";
import { COMMERCIAL_COPILOT_SUGGESTIONS_RESULT_SCHEMA_VERSION } from "../schemas/commercial-copilot-suggestions-result.v1.js";

export type CommercialCopilotDealSummary = {
  title: string;
  stageName: string;
  isWon: boolean;
  isLost: boolean;
  valueCents: number;
  daysInStage: number;
};

export type CommercialCopilotTaskSummary = {
  title: string;
  status: "pending" | "done" | "cancelled";
  overdueDays?: number;
};

export type CommercialCopilotPromptContext = {
  contactName: string;
  origin?: string;
  tags: readonly string[];
  daysSinceLastInteraction?: number;
  deals: readonly CommercialCopilotDealSummary[];
  pendingTasks: readonly CommercialCopilotTaskSummary[];
};

/**
 * `commercial-copilot-suggestions:v1` — CRM/Comercial, Fase 5. Sugere até 3 próximas ações
 * comerciais SOMENTE com base nos dados fornecidos (contato/negócios/tarefas reais) — nunca
 * inventa valor, prazo ou fato que não apareça no texto dado; nunca decide nada sozinho, cada
 * sugestão exige confirmação humana explícita antes de qualquer efeito real (ver
 * `applyCommercialSuggestionAcceptance`).
 */
const STATIC_INSTRUCTIONS = `Você é um copiloto comercial que analisa os dados de um contato do CRM e sugere as próximas ações mais úteis para o time de vendas.

Regras obrigatórias, sem exceção:
1. Baseie cada sugestão SOMENTE nos dados fornecidos abaixo — nunca invente valor, prazo, histórico ou qualquer fato que não apareça ali.
2. Para cada sugestão, copie em "evidence" um trecho LITERAL do texto fornecido que a embasa — nunca um resumo ou paráfrase.
3. No máximo 3 sugestões, priorizando o que é mais urgente ou valioso.
4. Se não houver nada de útil a sugerir com os dados disponíveis, devolva uma lista vazia — nunca force uma sugestão fraca só para preencher.
5. Nunca afirme que uma ação já foi realizada — você está sugerindo, não executando nem confirmando nada.
6. Devolva o resultado APENAS através da ferramenta disponibilizada — nunca como texto livre fora dela.`;

export const COMMERCIAL_COPILOT_SUGGESTIONS_PROMPT_HASH = createHash("sha256").update(STATIC_INSTRUCTIONS).digest("hex");

function renderDeal(deal: CommercialCopilotDealSummary): string {
  const statusLabel = deal.isWon ? "Ganho" : deal.isLost ? "Perdido" : "Aberto";
  const valueLabel = (deal.valueCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `- "${deal.title}" — etapa "${deal.stageName}" (${statusLabel}), valor ${valueLabel}, há ${deal.daysInStage} dia(s) nesta etapa.`;
}

function renderTask(task: CommercialCopilotTaskSummary): string {
  if (task.overdueDays && task.overdueDays > 0) return `- "${task.title}" (pendente, atrasada há ${task.overdueDays} dia(s)).`;
  return `- "${task.title}" (pendente).`;
}

export const commercialCopilotSuggestionsPromptV1: PromptTemplate<CommercialCopilotPromptContext> = {
  id: "commercial-copilot-suggestions",
  version: 1,
  operation: "commercial_copilot_suggestions",
  changelog: "v1: primeira versão — sugestões de próxima ação a partir de contato/negócios/tarefas.",
  hash: COMMERCIAL_COPILOT_SUGGESTIONS_PROMPT_HASH,

  buildSystemInstructions() {
    return [STATIC_INSTRUCTIONS, "", `A saída deve ter "schemaVersion": ${COMMERCIAL_COPILOT_SUGGESTIONS_RESULT_SCHEMA_VERSION}.`].join("\n");
  },

  buildUserInput(context) {
    const lines: string[] = [`Contato: ${context.contactName}`];
    if (context.origin) lines.push(`Origem: ${context.origin}`);
    if (context.tags.length > 0) lines.push(`Tags: ${context.tags.join(", ")}`);
    lines.push(context.daysSinceLastInteraction !== undefined ? `Última interação há ${context.daysSinceLastInteraction} dia(s).` : "Sem registro de última interação.");
    lines.push("", "Negócios:");
    lines.push(context.deals.length > 0 ? context.deals.map(renderDeal).join("\n") : "(nenhum negócio registrado)");
    lines.push("", "Tarefas pendentes:");
    lines.push(context.pendingTasks.length > 0 ? context.pendingTasks.map(renderTask).join("\n") : "(nenhuma tarefa pendente)");
    return lines.join("\n");
  },
};
