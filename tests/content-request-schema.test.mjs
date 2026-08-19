import test from "node:test";
import assert from "node:assert/strict";
import { CONTENT_REQUEST_SCHEMA_V1 } from "../dist/domain/briefing/schemas/content-request.schema.js";

// Achado ao vivo (Rodada 2): o schema do briefing `content_request` é uma ALLOWLIST explícita de
// campos — um campo bruto salvo em `generate-visual-from-idea.ts` (ex.: `fields.push({key:...})`)
// que não está registrado AQUI é descartado silenciosamente antes de virar
// `PreparedCommand.validatedInputs`, mesmo que a extração/lógica que o produziu esteja correta.
// Confirmado com uma geração real: `textCommercialFacts` (Commercial Fact Normalizer, Prioridade 4)
// nunca chegava a Bianca porque este registro estava faltando — preço mencionado só no texto da
// ideia nunca virava campo estruturado do plano, apesar do regex de extração funcionar
// perfeitamente isolado. Este teste trava a lista de campos "pass-through" conhecidos pra nunca
// mais perder um silenciosamente.

test("CONTENT_REQUEST_SCHEMA_V1: registra textCommercialFacts como campo pass-through (Commercial Fact Normalizer)", () => {
  const field = CONTENT_REQUEST_SCHEMA_V1.fields.find((f) => f.key === "textCommercialFacts");

  assert.ok(field, "campo 'textCommercialFacts' deveria estar registrado no schema, senão o valor é descartado silenciosamente");
  assert.equal(field.required, false);
  assert.equal(field.confirmationPolicy, "never_required");
  assert.equal(field.dataType, "string");
});

test("CONTENT_REQUEST_SCHEMA_V1: registra referenceIntelligence como campo pass-through (regressão — precedente que motivou este teste)", () => {
  const field = CONTENT_REQUEST_SCHEMA_V1.fields.find((f) => f.key === "referenceIntelligence");

  assert.ok(field);
  assert.equal(field.required, false);
  assert.equal(field.confirmationPolicy, "never_required");
});

test("CONTENT_REQUEST_SCHEMA_V1: todos os campos 'never_required' (preenchidos automaticamente por generate-visual-from-idea.ts) nunca são required", () => {
  const autoFilledKeys = ["referenceImageUrl", "referenceImageUrls", "referenceIntelligence", "textCommercialFacts"];
  for (const key of autoFilledKeys) {
    const field = CONTENT_REQUEST_SCHEMA_V1.fields.find((f) => f.key === key);
    assert.ok(field, `campo '${key}' deveria existir no schema`);
    assert.equal(field.confirmationPolicy, "never_required", `campo '${key}' deveria ser never_required (nunca perguntado ao usuário)`);
  }
});
