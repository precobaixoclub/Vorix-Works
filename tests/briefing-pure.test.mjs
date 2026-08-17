import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateBriefingCondition, BRIEFING_TYPES } from "../dist/domain/briefing/briefing.model.js";
import { getBriefingSchema, hasBriefingSchema } from "../dist/domain/briefing/schema-registry.js";
import { CAMPAIGN_CREATION_SCHEMA_V1 } from "../dist/domain/briefing/schemas/campaign-creation.schema.js";
import {
  detectCancellation,
  detectConfirmation,
  detectCorrection,
  extractDirectAnswer,
  extractOpportunistic,
  extractQuotedPhrase,
} from "../dist/application/briefing/extraction.js";
import { resolveFieldCandidates } from "../dist/application/briefing/context-resolver.js";
import { selectCurrentFieldValues, buildKnownValuesMap, isFieldApplicable, needsConfirmation } from "../dist/application/briefing/field-state.js";
import { evaluateBriefingReadiness } from "../dist/application/briefing/readiness-evaluator.js";
import { planNextQuestion } from "../dist/application/briefing/question-planner.js";
import { interpretBriefingMessage } from "../dist/application/briefing/interpret-message.js";
import { buildPreparedCommandInput } from "../dist/application/briefing/prepare-command.js";

// ---------------------------------------------------------------------------------------------
// Fase 2 — DSL declarativa
// ---------------------------------------------------------------------------------------------

test("evaluateBriefingCondition: equals/not_equals/in/exists/contains/all/any", () => {
  const known = { channel: "instagram", objective: "quero agendar um post" };
  assert.equal(evaluateBriefingCondition({ operator: "equals", field: "channel", value: "instagram" }, known), true);
  assert.equal(evaluateBriefingCondition({ operator: "not_equals", field: "channel", value: "facebook" }, known), true);
  assert.equal(evaluateBriefingCondition({ operator: "not_equals", field: "missing", value: "x" }, known), true);
  assert.equal(evaluateBriefingCondition({ operator: "in", field: "channel", values: ["instagram", "facebook"] }, known), true);
  assert.equal(evaluateBriefingCondition({ operator: "exists", field: "channel" }, known), true);
  assert.equal(evaluateBriefingCondition({ operator: "exists", field: "missing" }, known), false);
  assert.equal(evaluateBriefingCondition({ operator: "contains", field: "objective", value: "agend" }, known), true);
  assert.equal(
    evaluateBriefingCondition({ operator: "all", conditions: [{ operator: "exists", field: "channel" }, { operator: "exists", field: "objective" }] }, known),
    true,
  );
  assert.equal(
    evaluateBriefingCondition({ operator: "any", conditions: [{ operator: "exists", field: "missing" }, { operator: "exists", field: "channel" }] }, known),
    true,
  );
});

test("BRIEFING_TYPES: 6 tipos válidos, campaign_creation e content_request têm schema registrado", () => {
  assert.equal(BRIEFING_TYPES.length, 6);
  assert.equal(hasBriefingSchema("campaign_creation"), true);
  assert.equal(hasBriefingSchema("content_request"), true);
  for (const type of BRIEFING_TYPES) {
    if (type === "campaign_creation" || type === "content_request") continue;
    assert.equal(hasBriefingSchema(type), false, `${type} não deveria ter schema nesta sprint`);
    assert.equal(getBriefingSchema(type), undefined);
  }
});

test("CAMPAIGN_CREATION_SCHEMA_V1: expõe schemaVersion e os 9 campos do escopo aprovado", () => {
  assert.equal(CAMPAIGN_CREATION_SCHEMA_V1.version, 1);
  assert.equal(CAMPAIGN_CREATION_SCHEMA_V1.type, "campaign_creation");
  const keys = CAMPAIGN_CREATION_SCHEMA_V1.fields.map((f) => f.key).sort();
  assert.deepEqual(keys, [
    "channel",
    "contentFormat",
    "deadlineOrPublicationDate",
    "desiredAction",
    "objective",
    "offerOrSubject",
    "referencedAssetName",
    "targetAudience",
    "tone",
  ]);
});

// ---------------------------------------------------------------------------------------------
// Fase 5 — Extração determinística
// ---------------------------------------------------------------------------------------------

test("extraction: cancelamento explícito", () => {
  assert.equal(detectCancellation("quero cancelar isso"), true);
  assert.equal(detectCancellation("esquece isso, deixa pra depois"), true);
  assert.equal(detectCancellation("quero criar uma campanha"), false);
});

test("extraction: confirmação estrita nunca aceita texto ambíguo", () => {
  assert.equal(detectConfirmation("sim"), "affirmative");
  assert.equal(detectConfirmation("confirmo"), "affirmative");
  assert.equal(detectConfirmation("Sim!"), "affirmative");
  assert.equal(detectConfirmation("sim, mas quero mudar o formato"), "ambiguous");
  assert.equal(detectConfirmation("quero falar sobre outra coisa"), "none");
});

test("extraction: extractQuotedPhrase pega o primeiro nome entre aspas", () => {
  assert.equal(extractQuotedPhrase('usa o asset "Logo Verão"'), "Logo Verão");
  assert.equal(extractQuotedPhrase("sem aspas aqui"), undefined);
});

test("extraction: extractDirectAnswer usa o padrão enum quando bate, senão o texto inteiro", () => {
  const channelField = CAMPAIGN_CREATION_SCHEMA_V1.fields.find((f) => f.key === "channel");
  const matched = extractDirectAnswer(channelField, "instagram");
  assert.equal(matched.normalizedValue, "instagram");
  assert.equal(matched.matchedRule, "pattern:enum-keyword");

  const audienceField = CAMPAIGN_CREATION_SCHEMA_V1.fields.find((f) => f.key === "targetAudience");
  const freeText = extractDirectAnswer(audienceField, "mulheres de 25 a 40 anos");
  assert.equal(freeText.value, "mulheres de 25 a 40 anos");
  assert.equal(freeText.matchedRule, "direct-answer:pending-question");
});

test("extraction: dois canais incompatíveis na mesma mensagem geram ambiguidade, nunca escolha automática", () => {
  const known = new Set();
  const results = extractOpportunistic(CAMPAIGN_CREATION_SCHEMA_V1, "posso postar no instagram ou no facebook", known);
  const channel = results.find((r) => r.fieldKey === "channel");
  assert.ok(channel);
  assert.equal(channel.ambiguityStatus, "ambiguous");
});

test("extraction: extractOpportunistic reconhece canal, formato e data numa mensagem livre", () => {
  const results = extractOpportunistic(CAMPAIGN_CREATION_SCHEMA_V1, "quero um carrossel no instagram até 2026-08-01", new Set());
  const byKey = Object.fromEntries(results.map((r) => [r.fieldKey, r]));
  assert.equal(byKey.channel.normalizedValue, "instagram");
  assert.equal(byKey.contentFormat.normalizedValue, "carousel");
  assert.equal(byKey.deadlineOrPublicationDate.normalizedValue, "2026-08-01");
});

// ---------------------------------------------------------------------------------------------
// Fase 4 — Context Resolver / política de confirmação
// ---------------------------------------------------------------------------------------------

test("Context Resolver: sugestão de canal único do Workspace nunca satisfaz o campo sozinha (exige confirmação)", async () => {
  const candidates = await resolveFieldCandidates(
    {
      schema: CAMPAIGN_CREATION_SCHEMA_V1,
      missingFieldKeys: ["channel"],
      workspaceId: "workspace-1",
      currentMessageText: "quero divulgar minha loja",
      workspaceConnectedChannels: ["instagram"],
    },
    {
      companyKnowledgeSource: { suggestFields: async () => [] },
      assetMetadataSource: { findByName: async () => [] },
    },
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, "workspace");
  assert.equal(candidates[0].requiresConfirmation, true);
});

test("Context Resolver: fonte indisponível (porta lança) nunca quebra o turno", async () => {
  const candidates = await resolveFieldCandidates(
    {
      schema: CAMPAIGN_CREATION_SCHEMA_V1,
      missingFieldKeys: ["targetAudience"],
      workspaceId: "workspace-1",
      currentMessageText: "sem nada relevante aqui",
    },
    {
      companyKnowledgeSource: {
        suggestFields: async () => {
          throw new Error("indisponível");
        },
      },
      assetMetadataSource: { findByName: async () => [] },
    },
  );
  assert.deepEqual(candidates, []);
});

// ---------------------------------------------------------------------------------------------
// Fase 3/7 — seleção determinística de valor atual + Readiness
// ---------------------------------------------------------------------------------------------

function fakeValue(overrides) {
  return {
    id: "v1",
    briefingId: "b1",
    fieldKey: "channel",
    value: "instagram",
    normalizedValue: "instagram",
    source: "user_message",
    confidence: 0.9,
    confirmedByUser: true,
    revision: 1,
    ambiguityStatus: "none",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("selectCurrentFieldValues: revision DESC, created_at DESC, id DESC — nunca timestamp isolado", () => {
  const older = fakeValue({ id: "a", revision: 1, createdAt: "2026-01-01T00:00:00.000Z", value: "instagram" });
  const delayedButOlderRevision = fakeValue({ id: "b", revision: 1, createdAt: "2026-01-03T00:00:00.000Z", value: "facebook-delayed" });
  const newerRevision = fakeValue({ id: "c", revision: 2, createdAt: "2026-01-02T00:00:00.000Z", value: "tiktok" });
  const current = selectCurrentFieldValues([older, delayedButOlderRevision, newerRevision]);
  assert.equal(current.get("channel").value, "tiktok", "revisão maior vence mesmo com timestamp mais antigo que uma resposta atrasada");
});

test("Readiness: sugestão externa não confirmada bloqueia isReadyForConfirmation mesmo com todos os campos preenchidos", () => {
  const values = new Map([
    ["objective", fakeValue({ fieldKey: "objective", value: "vender mais", normalizedValue: "vender mais" })],
    ["offerOrSubject", fakeValue({ fieldKey: "offerOrSubject", value: "tênis novo", normalizedValue: "tênis novo" })],
    ["targetAudience", fakeValue({ fieldKey: "targetAudience", value: "jovens", normalizedValue: "jovens" })],
    ["channel", fakeValue({ fieldKey: "channel", value: "instagram", normalizedValue: "instagram", source: "workspace", confirmedByUser: false })],
  ]);
  const readiness = evaluateBriefingReadiness(CAMPAIGN_CREATION_SCHEMA_V1, values, false);
  assert.equal(readiness.isReadyForConfirmation, false);
  assert.ok(readiness.unconfirmedSuggestedFields.includes("channel"));

  values.set("channel", fakeValue({ fieldKey: "channel", value: "instagram", normalizedValue: "instagram", source: "workspace", confirmedByUser: true }));
  // Confirmar "channel" faz `contentFormat` (requiredWhen: exists(channel)) passar a ser obrigatório também.
  values.set("contentFormat", fakeValue({ fieldKey: "contentFormat", value: "image", normalizedValue: "image" }));
  const readinessAfterConfirm = evaluateBriefingReadiness(CAMPAIGN_CREATION_SCHEMA_V1, values, false);
  assert.equal(readinessAfterConfirm.isReadyForConfirmation, true);
});

test("Readiness: contentFormat só entra como obrigatório depois que channel é conhecido (requiredWhen)", () => {
  const withoutChannel = new Map([
    ["objective", fakeValue({ fieldKey: "objective", value: "vender", normalizedValue: "vender" })],
    ["offerOrSubject", fakeValue({ fieldKey: "offerOrSubject", value: "produto", normalizedValue: "produto" })],
    ["targetAudience", fakeValue({ fieldKey: "targetAudience", value: "todos", normalizedValue: "todos" })],
  ]);
  const readiness = evaluateBriefingReadiness(CAMPAIGN_CREATION_SCHEMA_V1, withoutChannel, false);
  assert.ok(!readiness.requiredFields.includes("contentFormat"), "contentFormat não deveria ser obrigatório sem channel");
  assert.ok(readiness.missingRequiredFields.includes("channel"));
});

// ---------------------------------------------------------------------------------------------
// Fase 6 — Question Planner
// ---------------------------------------------------------------------------------------------

test("Question Planner: objetivo/oferta bloqueiam tudo o resto (prioridade 1)", () => {
  const readiness = {
    isReadyForConfirmation: false,
    isConfirmed: false,
    requiredFields: ["objective", "offerOrSubject", "targetAudience", "channel"],
    missingRequiredFields: ["objective", "offerOrSubject", "targetAudience", "channel"],
    invalidFields: [],
    ambiguousFields: [],
    unconfirmedSuggestedFields: [],
    optionalHighImpactFields: [],
    readinessScore: 0,
    reason: "",
  };
  const question = planNextQuestion(CAMPAIGN_CREATION_SCHEMA_V1, readiness, new Map());
  assert.equal(question.priority, 1);
  assert.deepEqual([...question.fieldKeys].sort(), ["objective", "offerOrSubject"]);
});

test("Question Planner: campo ambíguo tem prioridade sobre sugestão externa e opcional de alto impacto", () => {
  const readiness = {
    isReadyForConfirmation: false,
    isConfirmed: false,
    requiredFields: ["channel"],
    missingRequiredFields: [],
    invalidFields: [],
    ambiguousFields: ["channel"],
    unconfirmedSuggestedFields: ["targetAudience"],
    optionalHighImpactFields: ["tone"],
    readinessScore: 0.5,
    reason: "",
  };
  const question = planNextQuestion(CAMPAIGN_CREATION_SCHEMA_V1, readiness, new Map());
  assert.equal(question.priority, 4);
  assert.deepEqual([...question.fieldKeys], ["channel"]);
});

// ---------------------------------------------------------------------------------------------
// Ordem de interpretação (precedência estrita)
// ---------------------------------------------------------------------------------------------

function fakeIntent(type, matchedRule) {
  return { type, confidence: matchedRule ? 0.9 : 0.5, rawText: "", matchedRule };
}

test("Ordem de interpretação: cancelamento sempre vence, mesmo com pergunta pendente", () => {
  const pending = { id: "q1", briefingId: "b1", fieldKeys: ["channel"], text: "Qual canal?", reason: "", priority: 3, answerType: "single_choice", status: "pending", createdAt: "" };
  const result = interpretBriefingMessage({
    schema: CAMPAIGN_CREATION_SCHEMA_V1,
    briefingType: "campaign_creation",
    text: "na verdade esquece isso, cancela",
    pendingQuestion: pending,
    classifiedIntent: fakeIntent("free_chat"),
    alreadyKnownFieldKeys: new Set(),
  });
  assert.equal(result.kind, "cancellation");
});

test("Ordem de interpretação: resposta curta a pergunta pendente vence sobre extração oportunista genérica", () => {
  const pending = { id: "q1", briefingId: "b1", fieldKeys: ["channel"], text: "Qual canal?", reason: "", priority: 3, answerType: "single_choice", status: "pending", createdAt: "" };
  const result = interpretBriefingMessage({
    schema: CAMPAIGN_CREATION_SCHEMA_V1,
    briefingType: "campaign_creation",
    text: "instagram",
    pendingQuestion: pending,
    classifiedIntent: fakeIntent("free_chat"),
    alreadyKnownFieldKeys: new Set(),
  });
  assert.equal(result.kind, "pending_answer");
  assert.equal(result.extracted.normalizedValue, "instagram");
});

test("Ordem de interpretação: intenção incompatível E inequívoca suspende; intenção ambígua/fallback nunca suspende (falso positivo de troca de assunto)", () => {
  const base = {
    schema: CAMPAIGN_CREATION_SCHEMA_V1,
    briefingType: "campaign_creation",
    text: "quero ver os assets que já temos",
    pendingQuestion: undefined,
    alreadyKnownFieldKeys: new Set(),
  };

  const withUnambiguousIntent = interpretBriefingMessage({ ...base, classifiedIntent: fakeIntent("query_assets", "keyword:assets") });
  assert.equal(withUnambiguousIntent.kind, "new_intent");

  const withAmbiguousFallback = interpretBriefingMessage({ ...base, text: "hmm", classifiedIntent: fakeIntent("unknown", undefined) });
  assert.notEqual(withAmbiguousFallback.kind, "new_intent");
});

test("Ordem de interpretação: confirmação ambígua nunca é aceita como confirmação válida", () => {
  const pending = { id: "q1", briefingId: "b1", fieldKeys: [], text: "Confirma?", reason: "", priority: 0, answerType: "confirmation", status: "pending", createdAt: "" };
  const result = interpretBriefingMessage({
    schema: CAMPAIGN_CREATION_SCHEMA_V1,
    briefingType: "campaign_creation",
    text: "sim, mas quero mudar o tom",
    pendingQuestion: pending,
    classifiedIntent: fakeIntent("free_chat"),
    alreadyKnownFieldKeys: new Set(),
  });
  assert.equal(result.kind, "ambiguous_confirmation");
});

// ---------------------------------------------------------------------------------------------
// PreparedCommand builder
// ---------------------------------------------------------------------------------------------

test("buildPreparedCommandInput: só campos resolvidos (sem sugestão pendente de confirmação) entram em validatedInputs", () => {
  const briefing = { id: "b1", tenantId: "t1", workspaceId: "w1", conversationId: "c1", type: "campaign_creation", status: "ready", schemaVersion: 1, revision: 1, createdAt: "", updatedAt: "" };
  const values = new Map([
    ["objective", fakeValue({ fieldKey: "objective", value: "vender", normalizedValue: "vender" })],
    ["offerOrSubject", fakeValue({ fieldKey: "offerOrSubject", value: "produto", normalizedValue: "produto" })],
    ["targetAudience", fakeValue({ fieldKey: "targetAudience", value: "todos", normalizedValue: "todos" })],
    ["channel", fakeValue({ fieldKey: "channel", value: "instagram", normalizedValue: "instagram", source: "workspace", confirmedByUser: false })],
  ]);
  const input = buildPreparedCommandInput({ briefing, schema: CAMPAIGN_CREATION_SCHEMA_V1, currentValues: values, intent: "create_campaign" });
  assert.ok(!("channel" in input.validatedInputs), "channel não confirmado nunca deveria entrar em validatedInputs");
  assert.equal(input.validatedInputs.objective, "vender");
});
