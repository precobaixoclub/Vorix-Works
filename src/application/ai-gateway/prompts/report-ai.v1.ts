import { createHash } from "node:crypto";
import type { PromptTemplate } from "../prompt-template.js";
import { REPORT_ANALYSIS_RESULT_SCHEMA_VERSION } from "../schemas/report-analysis-result.v1.js";
import { REPORT_TEMPLATE_RESULT_SCHEMA_VERSION } from "../schemas/report-template-result.v1.js";

// ---------------------------------------------------------------------------------------------
// report_ai_analysis
// ---------------------------------------------------------------------------------------------

export type ReportAnalysisPromptContext = {
  reportName: string;
  periodLabel: string;
  /** Linhas prontas ("Rótulo: valor") por seção — números já calculados, a IA só interpreta. */
  sections: readonly { title: string; lines: readonly string[] }[];
  focus?: string;
};

const ANALYSIS_INSTRUCTIONS = `Você é um analista de negócios que lê um relatório de vendas e atendimento para a gestão de uma empresa.

Regras obrigatórias, sem exceção:
1. Use SOMENTE os números e textos do relatório. Nunca invente valor, percentual, nome, causa ou comparação com períodos que não estejam no relatório.
2. Nunca recalcule nem estime números novos; cite os que estão no relatório.
3. Toda evidência deve ser um trecho LITERAL copiado do relatório (ex.: "Conversão: 32,5%"). Sem evidência, não inclua o item.
4. Resumo: 2 a 4 frases com a leitura executiva do período.
5. Destaques: o que foi bem. Riscos: pontos de atenção. Recomendações: no máximo 5 ações concretas para a gestão — são SUGESTÕES, nunca diga que algo foi feito.
6. Se o relatório tiver poucos dados, diga isso no resumo e não force conclusões.
7. Responda em português do Brasil e APENAS através da ferramenta disponibilizada.`;

export const REPORT_ANALYSIS_PROMPT_HASH = createHash("sha256").update(ANALYSIS_INSTRUCTIONS).digest("hex");

export const reportAnalysisPromptV1: PromptTemplate<ReportAnalysisPromptContext> = {
  id: "report-ai-analysis",
  version: 1,
  operation: "report_ai_analysis",
  changelog: "v1: leitura executiva, destaques, riscos e recomendações com evidência literal do relatório.",
  hash: REPORT_ANALYSIS_PROMPT_HASH,
  buildSystemInstructions() {
    return [ANALYSIS_INSTRUCTIONS, "", `A saída deve ter "schemaVersion": ${REPORT_ANALYSIS_RESULT_SCHEMA_VERSION}.`].join("\n");
  },
  buildUserInput(context) {
    const lines = [`Relatório: ${context.reportName}`, `Período: ${context.periodLabel}`];
    if (context.focus) lines.push(`Pergunta da gestão: ${context.focus}`);
    for (const section of context.sections) {
      lines.push("", `## ${section.title}`);
      lines.push(section.lines.length ? section.lines.map((line) => `- ${line}`).join("\n") : "(sem dados no período)");
    }
    return lines.join("\n");
  },
};

// ---------------------------------------------------------------------------------------------
// report_template_builder
// ---------------------------------------------------------------------------------------------

export type ReportTemplatePromptContext = {
  request: string;
  catalog: readonly { key: string; title: string; description: string }[];
};

const TEMPLATE_INSTRUCTIONS = `Você monta modelos de relatório para a gestão de uma empresa que vende e atende pelo WhatsApp.

Regras obrigatórias:
1. Escolha SOMENTE seções do catálogo fornecido, usando a chave exata de cada uma. Nunca invente seção.
2. Escolha entre 2 e 8 seções que respondam ao pedido, na ordem mais útil para a leitura.
3. Se o pedido citar algo que não existe no catálogo, registre em "warnings" e siga com o que existe.
4. Nome curto e claro; descrição em uma frase; "rationale" explicando a escolha.
5. Responda em português do Brasil e APENAS através da ferramenta disponibilizada.`;

export const REPORT_TEMPLATE_PROMPT_HASH = createHash("sha256").update(TEMPLATE_INSTRUCTIONS).digest("hex");

export const reportTemplatePromptV1: PromptTemplate<ReportTemplatePromptContext> = {
  id: "report-template-builder",
  version: 1,
  operation: "report_template_builder",
  changelog: "v1: escolhe seções do catálogo fechado a partir do pedido do cliente.",
  hash: REPORT_TEMPLATE_PROMPT_HASH,
  buildSystemInstructions() {
    return [TEMPLATE_INSTRUCTIONS, "", `A saída deve ter "schemaVersion": ${REPORT_TEMPLATE_RESULT_SCHEMA_VERSION}.`].join("\n");
  },
  buildUserInput(context) {
    return [
      `Pedido do cliente: ${context.request}`,
      "",
      "Catálogo de seções disponíveis (chave — título: descrição):",
      ...context.catalog.map((section) => `- ${section.key} — ${section.title}: ${section.description}`),
    ].join("\n");
  },
};
