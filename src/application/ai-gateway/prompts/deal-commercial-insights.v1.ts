import { createHash } from "node:crypto";
import type { PromptTemplate } from "../prompt-template.js";
import { DEAL_COMMERCIAL_INSIGHTS_RESULT_SCHEMA_VERSION } from "../schemas/deal-commercial-insights-result.v1.js";

export type DealInsightsPromptMessage = { direction: "inbound" | "outbound"; at: string; text: string };

export type DealInsightsPromptContext = {
  dealTitle: string;
  stageName: string;
  status: string;
  /** Fatos comerciais JÁ calculados pelo backend (texto pronto) — a IA só explica, nunca calcula. */
  facts: readonly string[];
  proposals: readonly string[];
  pendingTasks: readonly string[];
  messages: readonly DealInsightsPromptMessage[];
};

/**
 * `deal-commercial-insights:v1` — resumo, riscos e próximas ações de UMA oportunidade, somente
 * com os dados fornecidos (conversa real, propostas, tarefas, fatos calculados). Nunca executa
 * nada: cada ação é sugestão que o vendedor decide.
 */
const STATIC_INSTRUCTIONS = `Você é um analista comercial que ajuda um vendedor a conduzir UMA oportunidade de venda.

Regras obrigatórias, sem exceção:
1. Use SOMENTE os dados fornecidos (fatos, propostas, tarefas e mensagens). Nunca invente valor, prazo, concorrente, objeção ou qualquer fato.
2. Valores, margens, metas e espaço de negociação já vêm calculados nos "Fatos" — nunca recalcule nem proponha preço abaixo do mínimo ou fora da política.
3. Toda evidência deve ser um trecho LITERAL copiado dos dados — nunca resumo ou paráfrase. Sem evidência, não inclua o item.
4. Resumo: 1 a 3 frases sobre o que o cliente busca, objeções e prazo. Se os dados não permitirem, deixe vazio.
5. Riscos: apenas os sustentados por evidência (ex.: menção a concorrente, objeção de preço, silêncio do cliente).
6. Próximas ações: no máximo 3, concretas e acionáveis; são SUGESTÕES — nunca diga que algo já foi feito.
7. Responda em português do Brasil e APENAS através da ferramenta disponibilizada.`;

export const DEAL_COMMERCIAL_INSIGHTS_PROMPT_HASH = createHash("sha256").update(STATIC_INSTRUCTIONS).digest("hex");

export const dealCommercialInsightsPromptV1: PromptTemplate<DealInsightsPromptContext> = {
  id: "deal-commercial-insights",
  version: 1,
  operation: "deal_commercial_insights",
  changelog: "v1: resumo, riscos e próximas ações com evidência literal sobre uma oportunidade.",
  hash: DEAL_COMMERCIAL_INSIGHTS_PROMPT_HASH,

  buildSystemInstructions() {
    return [STATIC_INSTRUCTIONS, "", `A saída deve ter "schemaVersion": ${DEAL_COMMERCIAL_INSIGHTS_RESULT_SCHEMA_VERSION}.`].join("\n");
  },

  buildUserInput(context) {
    const lines: string[] = [`Oportunidade: ${context.dealTitle}`, `Etapa: ${context.stageName} (${context.status})`, "", "Fatos:"];
    lines.push(context.facts.length ? context.facts.map((fact) => `- ${fact}`).join("\n") : "(nenhum)");
    lines.push("", "Propostas:", context.proposals.length ? context.proposals.map((item) => `- ${item}`).join("\n") : "(nenhuma)");
    lines.push("", "Tarefas pendentes:", context.pendingTasks.length ? context.pendingTasks.map((item) => `- ${item}`).join("\n") : "(nenhuma)");
    lines.push("", "Mensagens recentes (mais antigas primeiro):");
    lines.push(context.messages.length ? context.messages.map((message) => `[${message.at}] ${message.direction === "inbound" ? "Cliente" : "Vendedor"}: ${message.text}`).join("\n") : "(nenhuma mensagem)");
    return lines.join("\n");
  },
};
