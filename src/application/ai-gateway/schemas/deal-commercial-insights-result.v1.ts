import { z } from "zod";

/**
 * `DealCommercialInsightsResultV1` — Sales Engine (IA comercial). Operação
 * `deal_commercial_insights`: resumo da negociação, riscos e próximas ações SUGERIDAS para uma
 * oportunidade. Mesma validação em duas camadas do Copiloto Comercial:
 *
 * 1. ESTRUTURAL — Zod `strict()`.
 * 2. SEMÂNTICA (anti-alucinação) — toda evidência precisa aparecer literalmente no texto-fonte; risco
 *    ou ação sem evidência é descartado; o resumo só sobrevive se ao menos uma evidência bater.
 * Números comerciais NUNCA vêm da IA (são calculados no backend e só explicados por ela).
 */

export const DEAL_COMMERCIAL_INSIGHTS_RESULT_SCHEMA_VERSION = 1;

const ACTION_TYPES = ["call", "message", "meeting", "proposal", "follow_up", "other"] as const;

const riskSchema = z.object({ title: z.string().min(1).max(160), evidence: z.string().min(1).max(300) }).strict();
const actionSchema = z.object({ title: z.string().min(1).max(160), rationale: z.string().min(1).max(300), evidence: z.string().min(1).max(300), actionType: z.enum(ACTION_TYPES) }).strict();

const resultSchema = z
  .object({
    schemaVersion: z.literal(DEAL_COMMERCIAL_INSIGHTS_RESULT_SCHEMA_VERSION),
    summary: z.string().max(700),
    summaryEvidence: z.array(z.string().min(1).max(300)).max(4),
    risks: z.array(riskSchema).max(5),
    nextActions: z.array(actionSchema).max(3),
    warnings: z.array(z.string()).max(10),
  })
  .strict();

export type DealCommercialInsightsResult = z.infer<typeof resultSchema>;
export type StructuredValidationResult<T> = { valid: true; data: T } | { valid: false; errors: readonly string[] };

export const DEAL_COMMERCIAL_INSIGHTS_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "summary", "summaryEvidence", "risks", "nextActions", "warnings"],
  properties: {
    schemaVersion: { const: DEAL_COMMERCIAL_INSIGHTS_RESULT_SCHEMA_VERSION },
    summary: { type: "string", maxLength: 700, description: "Resumo comercial em 1 a 3 frases (o que o cliente busca, objeções, prazo). Vazio se os dados não permitirem." },
    summaryEvidence: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 300, description: "Trecho LITERAL dos dados que embasa o resumo." } },
    risks: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "evidence"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160, description: "Risco concreto (ex.: cliente citou concorrente)." },
          evidence: { type: "string", minLength: 1, maxLength: 300, description: "Trecho LITERAL dos dados — nunca paráfrase. Sem evidência, não há risco." },
        },
      },
    },
    nextActions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "evidence", "actionType"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160, description: "Ação sugerida (ex.: Ligar amanhã às 14h)." },
          rationale: { type: "string", minLength: 1, maxLength: 300 },
          evidence: { type: "string", minLength: 1, maxLength: 300, description: "Trecho LITERAL dos dados que embasa a ação." },
          actionType: { type: "string", enum: [...ACTION_TYPES] },
        },
      },
    },
    warnings: { type: "array", maxItems: 10, items: { type: "string" } },
  },
};

export function validateDealCommercialInsightsStructure(raw: unknown): StructuredValidationResult<DealCommercialInsightsResult> {
  const result = resultSchema.safeParse(raw);
  if (!result.success) return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  return { valid: true, data: result.data };
}

export function applyDealCommercialInsightsSemanticValidation(params: { structural: DealCommercialInsightsResult; sourceText: string }): { valid: true; data: DealCommercialInsightsResult; warnings: readonly string[] } {
  const source = params.sourceText.toLowerCase();
  const grounded = (evidence: string) => source.includes(evidence.trim().toLowerCase());
  const warnings: string[] = [...params.structural.warnings];
  const summaryEvidence = params.structural.summaryEvidence.filter(grounded);
  const risks = params.structural.risks.filter((risk) => grounded(risk.evidence) || (warnings.push(`risk_not_grounded: "${risk.title}"`), false));
  const nextActions = params.structural.nextActions.filter((action) => grounded(action.evidence) || (warnings.push(`action_not_grounded: "${action.title}"`), false));
  const summary = summaryEvidence.length > 0 ? params.structural.summary : "";
  if (params.structural.summary && !summary) warnings.push("summary_not_grounded");
  return { valid: true, data: { ...params.structural, summary, summaryEvidence, risks, nextActions, warnings }, warnings };
}
