import type { BriefingAnswerType, BriefingFieldDefinition, BriefingFieldValue, BriefingReadiness, BriefingSchema } from "../../domain/briefing/briefing.model.js";

/**
 * Question Planner — Sprint 07 (Fase 6). Produz NO MÁXIMO uma pergunta por chamada, na prioridade
 * declarada na Sprint 07B: (1) bloqueio de objetivo; (2) campo que desbloqueia dependências;
 * (3) campo obrigatório faltante; (4) valor ambíguo; (5) sugestão externa pendente de confirmação;
 * (6) campo opcional de alto impacto. Nunca cria múltiplas perguntas simultâneas — o orquestrador
 * só chama isto quando não há pergunta pendente válida.
 */
export type PlannedQuestion = {
  fieldKeys: readonly string[];
  text: string;
  reason: string;
  priority: number;
  answerType: BriefingAnswerType;
  options?: readonly string[];
};

const OBJECTIVE_BLOCKER_KEYS = ["objective", "offerOrSubject"];

export function planNextQuestion(
  schema: BriefingSchema,
  readiness: BriefingReadiness,
  currentValues: ReadonlyMap<string, BriefingFieldValue>,
  previouslyAskedFieldKeys: ReadonlySet<string> = new Set(),
): PlannedQuestion | undefined {
  const fieldsByKey = new Map(schema.fields.map((field) => [field.key, field] as const));

  const objectiveBlockers = OBJECTIVE_BLOCKER_KEYS.filter(
    (key) => readiness.missingRequiredFields.includes(key) || readiness.invalidFields.includes(key),
  );
  if (objectiveBlockers.length > 0) {
    return buildFieldGroupQuestion(schema, fieldsByKey, objectiveBlockers, 1, "O objetivo e a oferta definem tudo o resto do briefing.");
  }

  const dependencyTargets = new Set(schema.fields.flatMap((field) => field.dependsOn ?? []));
  const missingUnblocking = readiness.missingRequiredFields.filter((key) => dependencyTargets.has(key) && !previouslyAskedFieldKeys.has(key));
  if (missingUnblocking.length > 0) {
    const field = fieldsByKey.get(missingUnblocking[0]);
    if (field) return buildSingleFieldQuestion(field, 2, `${field.label} precisa ser conhecido antes de outros campos que dependem dele.`);
  }

  const missingRequired = readiness.missingRequiredFields.filter((key) => !previouslyAskedFieldKeys.has(key));
  if (missingRequired.length > 0) {
    const field = fieldsByKey.get(missingRequired[0]);
    if (field) return buildSingleFieldQuestion(field, 3, `${field.label} é obrigatório para este tipo de briefing.`);
  }

  if (readiness.ambiguousFields.length > 0) {
    const field = fieldsByKey.get(readiness.ambiguousFields[0]);
    if (field) {
      return buildSingleFieldQuestion(
        field,
        4,
        `Mais de um valor possível foi identificado para ${field.label}.`,
        `Você mencionou mais de uma opção para "${field.label}" — qual delas é a certa?`,
      );
    }
  }

  if (readiness.unconfirmedSuggestedFields.length > 0) {
    const key = readiness.unconfirmedSuggestedFields[0];
    const field = fieldsByKey.get(key);
    const value = currentValues.get(key);
    if (field && value) {
      return {
        fieldKeys: [field.key],
        text: `Encontrei "${value.value}" para ${field.label} a partir de ${describeSource(value.source)} — posso usar esse valor?`,
        reason: `Sugestão vinda de fonte externa precisa de confirmação explícita antes de ser usada (${field.confirmationPolicy}).`,
        priority: 5,
        answerType: "confirmation",
        options: ["sim", "não"],
      };
    }
  }

  const highImpact = readiness.optionalHighImpactFields.find((key) => !previouslyAskedFieldKeys.has(key));
  if (highImpact) {
    const field = fieldsByKey.get(highImpact);
    if (field) return buildSingleFieldQuestion(field, 6, `${field.label} é opcional, mas melhora bastante o resultado.`);
  }

  return undefined;
}

function buildSingleFieldQuestion(field: BriefingFieldDefinition, priority: number, reason: string, text?: string): PlannedQuestion {
  return {
    fieldKeys: [field.key],
    text: text ?? `${field.label}: ${field.description}`,
    reason,
    priority,
    answerType: answerTypeFor(field),
    options: field.acceptedValues,
  };
}

function buildFieldGroupQuestion(
  schema: BriefingSchema,
  fieldsByKey: ReadonlyMap<string, BriefingFieldDefinition>,
  keys: readonly string[],
  priority: number,
  reason: string,
): PlannedQuestion {
  const labels = keys.map((key) => fieldsByKey.get(key)?.label ?? key);
  return {
    fieldKeys: keys,
    text: `Para começar, me conta: ${labels.join(" e ")}?`,
    reason,
    priority,
    answerType: "text",
  };
}

function answerTypeFor(field: BriefingFieldDefinition): BriefingAnswerType {
  if (field.dataType === "enum") return "single_choice";
  if (field.dataType === "date") return "date";
  return "text";
}

function describeSource(source: BriefingFieldValue["source"]): string {
  switch (source) {
    case "workspace":
      return "dados do seu workspace";
    case "company_knowledge":
      return "sua base de conhecimento";
    case "asset_metadata":
      return "sua biblioteca de ativos";
    case "system_inference":
      return "inferência do sistema";
    default:
      return "uma fonte anterior";
  }
}
