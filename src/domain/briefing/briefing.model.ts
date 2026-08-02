import type { UserIntentType } from "../conversation/conversation.model.js";

/**
 * Domínio de Briefing Intelligence — Sprint 07. Resolve estruturalmente o `request_more_context`
 * da Sprint 06: em vez de "Preciso de mais informações" genérico, o sistema sabe exatamente QUAL
 * objetivo o usuário persegue, QUAIS campos faltam, de ONDE cada valor já conhecido veio, e
 * quando é seguro parar de perguntar. Depende do domínio `Conversation` (Sprint 06) de mão única
 * — `Conversation` nunca importa nada daqui. Não é um sistema de contexto concorrente: é a
 * continuação do que `start_briefing`/`request_more_context` já apontavam sem implementação.
 *
 * IMPORTANTE — não confundir com os documentos "briefing" já existentes no projeto
 * (`MariaCopyBriefing`, `SofiaBiancaBriefing` etc., em `src/skills/*​/*.types.ts`): aqueles são
 * documentos de handoff ENTRE especialistas dentro do pipeline de conteúdo (Sofia→Bianca→Pedro
 * etc.), produzidos DEPOIS que um `PreparedCommand` daqui seria executado — trabalho de uma
 * sprint futura. Nada neste arquivo é lido ou escrito por eles.
 *
 * Zero dependência de Fastify, Postgres ou LLM — puro domínio.
 */

// -------------------------------------------------------------------------------------------
// Briefing — o container
// -------------------------------------------------------------------------------------------

export const BRIEFING_TYPES = [
  "campaign_creation",
  "campaign_edit",
  "content_request",
  "knowledge_query",
  "asset_search",
  "generic_task",
] as const;
export type BriefingType = (typeof BRIEFING_TYPES)[number];

/**
 * `awaiting_confirmation`: o resumo estruturado foi mostrado e está aguardando "sim"/"corrigir"/
 * "cancelar" do usuário — nenhum `PreparedCommand` existe ainda.
 * `ready`: a confirmação ocorreu e existe um `PreparedCommand` válido (`status: "prepared"`) para
 * esta revisão do briefing.
 * `completed`: o comando foi consumido por outro fluxo (execução real) — nunca acontece nesta
 * sprint; existe só para o dia em que Caio/Skills passarem a consumir `PreparedCommand`.
 * Não existe status "suspended": suspensão (Fase "Mudança de assunto") é registrada via eventos
 * (`briefing_suspended`/`briefing_resumed`), nunca muda `status` — um briefing suspenso continua
 * `collecting` (ou o status que tinha), só dormente, pronto para retomar.
 */
export const BRIEFING_STATUSES = ["collecting", "awaiting_confirmation", "ready", "completed", "cancelled", "expired"] as const;
export type BriefingStatus = (typeof BRIEFING_STATUSES)[number];

export type Briefing = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  type: BriefingType;
  status: BriefingStatus;
  schemaVersion: number;
  /** Incrementa a cada ciclo de correção DEPOIS de já ter alcançado `awaiting_confirmation` pelo
   * menos uma vez — é o que torna `PreparedCommand` referenciável de forma estável (Fase 9). */
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
};

// -------------------------------------------------------------------------------------------
// BriefingSource — de onde um valor veio
// -------------------------------------------------------------------------------------------

export const BRIEFING_SOURCES = [
  "user_message",
  "conversation_memory",
  "workspace",
  "company_knowledge",
  "asset_metadata",
  "system_inference",
  "ai_extraction",
] as const;
export type BriefingSource = (typeof BRIEFING_SOURCES)[number];

/** Nesta sprint, `system_inference`/`ai_extraction` nunca produzem um `BriefingFieldValue`
 * sozinhos sem confirmação explícita — ver `confirmationPolicy` abaixo. `ai_extraction`
 * (Sprint 08) entra em `EXTERNAL_SOURCES` pelo mesmo motivo que `workspace`/`company_knowledge`:
 * é uma SUGESTÃO, nunca uma afirmação do próprio usuário — `confidence` alto do modelo NUNCA
 * substitui `confirmationPolicy` (decisão obrigatória da Sprint 08). */
export const USER_PROVIDED_SOURCES: readonly BriefingSource[] = ["user_message"];
export const EXTERNAL_SOURCES: readonly BriefingSource[] = ["workspace", "company_knowledge", "asset_metadata", "system_inference", "ai_extraction"];

// -------------------------------------------------------------------------------------------
// DSL de condições — nunca uma função TypeScript arbitrária (inspecionável/testável/serializável)
// -------------------------------------------------------------------------------------------

export type BriefingConditionLeaf =
  | { operator: "equals"; field: string; value: string }
  | { operator: "not_equals"; field: string; value: string }
  | { operator: "in"; field: string; values: readonly string[] }
  | { operator: "exists"; field: string }
  | { operator: "contains"; field: string; value: string };

export type BriefingConditionCombinator =
  | { operator: "all"; conditions: readonly BriefingCondition[] }
  | { operator: "any"; conditions: readonly BriefingCondition[] };

export type BriefingCondition = BriefingConditionLeaf | BriefingConditionCombinator;

/** Avalia a DSL contra os valores JÁ conhecidos (map fieldKey -> valor normalizado). Nunca lança
 * — um campo referenciado que ainda não existe em `known` simplesmente falha a condição (exceto
 * `not_equals`, que é vacuamente verdadeira para um campo ausente — "não é igual a X" é verdade
 * quando não há valor nenhum). Determinístico, sem estado, sem I/O. */
export function evaluateBriefingCondition(condition: BriefingCondition, known: Readonly<Record<string, string>>): boolean {
  switch (condition.operator) {
    case "equals":
      return known[condition.field] === condition.value;
    case "not_equals":
      return known[condition.field] !== condition.value;
    case "in":
      return condition.field in known && condition.values.includes(known[condition.field]);
    case "exists":
      return condition.field in known && known[condition.field].trim().length > 0;
    case "contains":
      return condition.field in known && known[condition.field].toLowerCase().includes(condition.value.toLowerCase());
    case "all":
      return condition.conditions.every((child) => evaluateBriefingCondition(child, known));
    case "any":
      return condition.conditions.some((child) => evaluateBriefingCondition(child, known));
  }
}

// -------------------------------------------------------------------------------------------
// BriefingFieldDefinition — schema declarativo (código, versionado — nunca banco)
// -------------------------------------------------------------------------------------------

export const BRIEFING_FIELD_DATA_TYPES = ["string", "date", "enum", "boolean", "string_array"] as const;
export type BriefingFieldDataType = (typeof BRIEFING_FIELD_DATA_TYPES)[number];

export const BRIEFING_FIELD_SENSITIVITY = ["normal", "sensitive"] as const;
export type BriefingFieldSensitivity = (typeof BRIEFING_FIELD_SENSITIVITY)[number];

/**
 * `never_required`: um valor sugerido por qualquer fonte (mesmo externa) já resolve o campo, sem
 * pedir confirmação — usado só para campos de baixo risco/baixo impacto criativo.
 * `required_for_external_source`: um valor vindo de `user_message`/`conversation_memory` resolve
 * o campo direto; um valor vindo de fonte EXTERNA (`workspace`/`company_knowledge`/
 * `asset_metadata`/`system_inference`) fica como sugestão (`confirmedByUser: false`) até o
 * usuário confirmar — nunca satisfaz o campo sozinho. É a política padrão para campos criativos.
 * `always_required`: mesmo uma resposta do próprio usuário nesta sprint não muda o comportamento
 * (não há verificação adicional além da resposta direta), mas o rótulo existe para deixar
 * explícito que este campo nunca deve ser preenchido por inferência, mesmo no futuro.
 */
export const CONFIRMATION_POLICIES = ["never_required", "required_for_external_source", "always_required"] as const;
export type ConfirmationPolicy = (typeof CONFIRMATION_POLICIES)[number];

export type BriefingFieldValidation = {
  pattern?: string;
  minLength?: number;
  maxLength?: number;
};

export type BriefingFieldDefinition = {
  key: string;
  label: string;
  description: string;
  required: boolean;
  /** Sobrepõe `required` quando presente — avaliado contra os campos já conhecidos via a DSL acima. */
  requiredWhen?: BriefingCondition;
  dataType: BriefingFieldDataType;
  acceptedValues?: readonly string[];
  /** Só estas fontes, nesta ordem de preferência, são consultadas pelo Context Resolver para este campo. */
  sourcePriority: readonly BriefingSource[];
  validation?: BriefingFieldValidation;
  dependsOn?: readonly string[];
  sensitivity: BriefingFieldSensitivity;
  confirmationPolicy: ConfirmationPolicy;
  /** Só usado por campos OPCIONAIS — marca "opcional de alto impacto" para `BriefingReadiness.optionalHighImpactFields`. */
  highImpact?: boolean;
};

export type BriefingSchema = {
  type: BriefingType;
  version: number;
  fields: readonly BriefingFieldDefinition[];
  /** Grupos de campos estreitamente relacionados que o Question Planner pode perguntar juntos
   * quando TODOS os campos do grupo estão simultaneamente elegíveis — nunca força o agrupamento. */
  questionGroups?: readonly (readonly string[])[];
};

// -------------------------------------------------------------------------------------------
// BriefingFieldValue — histórico append-only (nunca UPDATE)
// -------------------------------------------------------------------------------------------

export const BRIEFING_AMBIGUITY_STATUSES = ["none", "ambiguous", "resolved"] as const;
export type BriefingAmbiguityStatus = (typeof BRIEFING_AMBIGUITY_STATUSES)[number];

export type BriefingFieldValue = {
  id: string;
  briefingId: string;
  fieldKey: string;
  /** Texto original exatamente como veio da fonte — nunca alterado. */
  value: string;
  /** Forma canônica usada para comparação/DSL (ex.: canal em minúsculas, sem acento). */
  normalizedValue: string;
  source: BriefingSource;
  confidence: number;
  questionId?: string;
  conversationEventId?: string;
  assetId?: string;
  confirmedByUser: boolean;
  /** Contador por `fieldKey` dentro do briefing — 1 na primeira resposta, incrementa a cada correção. */
  revision: number;
  supersedesValueId?: string;
  ambiguityStatus: BriefingAmbiguityStatus;
  createdAt: string;
  /** Só presentes quando `source === "ai_extraction"` (Sprint 08, Fase 12). `aiExecutionId`
   * referencia a linha completa em `ai_executions` (provider/model/promptTemplateId/promptVersion/
   * traceId/tokens/custo já vivem lá — NUNCA duplicados aqui). `rationaleCode`/`evidence` ficam
   * vinculados ao candidato em si (são metadados interpretativos do valor, não telemetria bruta),
   * por isso moram diretamente no `BriefingFieldValue`, não só no execution. */
  aiExecutionId?: string;
  rationaleCode?: string;
  evidence?: string;
};

// -------------------------------------------------------------------------------------------
// BriefingQuestion
// -------------------------------------------------------------------------------------------

export const BRIEFING_ANSWER_TYPES = ["text", "single_choice", "multi_choice", "date", "confirmation"] as const;
export type BriefingAnswerType = (typeof BRIEFING_ANSWER_TYPES)[number];

export const BRIEFING_QUESTION_STATUSES = ["pending", "answered", "superseded"] as const;
export type BriefingQuestionStatus = (typeof BRIEFING_QUESTION_STATUSES)[number];

export type BriefingQuestion = {
  id: string;
  briefingId: string;
  fieldKeys: readonly string[];
  text: string;
  reason: string;
  priority: number;
  answerType: BriefingAnswerType;
  options?: readonly string[];
  status: BriefingQuestionStatus;
  createdAt: string;
  answeredAt?: string;
  supersededAt?: string;
};

// -------------------------------------------------------------------------------------------
// BriefingReadiness
// -------------------------------------------------------------------------------------------

export type BriefingReadiness = {
  isReadyForConfirmation: boolean;
  isConfirmed: boolean;
  requiredFields: readonly string[];
  missingRequiredFields: readonly string[];
  invalidFields: readonly string[];
  ambiguousFields: readonly string[];
  unconfirmedSuggestedFields: readonly string[];
  optionalHighImpactFields: readonly string[];
  /** Informativo — nunca a única base para decidir prontidão (ver `isReadyForConfirmation`, que é sempre calculado a partir dos critérios explícitos acima). */
  readinessScore: number;
  reason: string;
};

// -------------------------------------------------------------------------------------------
// PreparedCommand
// -------------------------------------------------------------------------------------------

export const PREPARED_COMMAND_STATUSES = ["prepared", "superseded"] as const;
export type PreparedCommandStatus = (typeof PREPARED_COMMAND_STATUSES)[number];

export type PreparedCommand = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  briefingId: string;
  briefingRevision: number;
  type: BriefingType;
  intent: UserIntentType;
  validatedInputs: Record<string, string>;
  sourceReferences: Record<string, BriefingSource>;
  unresolvedOptionalFields: readonly string[];
  status: PreparedCommandStatus;
  createdAt: string;
  supersededAt?: string;
};
