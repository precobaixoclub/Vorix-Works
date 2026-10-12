import test from "node:test";
import assert from "node:assert/strict";

import {
  inferApprovedCreativeFamily,
  resolveCreativeEngineRouting,
} from "../dist/application/creative-engine/creative-engine-routing.js";

test("routing: entitlement ON + product_offer normal usa APPROVED_CREATIVE_ENGINE sem flag tecnica", () => {
  const decision = resolveCreativeEngineRouting({
    entitlementEnabled: true,
    validatedInputs: {
      objective: "Validar Creative Engine em oferta de produto antes do lancamento publico.",
      offerOrSubject: "Criar uma peca de oferta premium destacando economia e confianca.",
      aspectRatio: "4:5",
    },
    assets: [{ url: "https://api.vorixworks.com/uploads/assets/t/w/logo.jpg", role: "logo", description: "Logo" }],
  });

  assert.equal(decision.enginePath, "APPROVED_CREATIVE_ENGINE");
  assert.equal(decision.compositionMode, "editorial_experimental");
  assert.equal(decision.family, "product_offer");
});

test("routing: entitlement ON + premium_institutional normal usa APPROVED_CREATIVE_ENGINE", () => {
  const decision = resolveCreativeEngineRouting({
    entitlementEnabled: true,
    validatedInputs: {
      objective: "Validar Creative Engine em peca institucional premium vertical.",
      offerOrSubject: "Criar uma peca institucional premium com confianca, operacao e crescimento.",
      aspectRatio: "9:16",
    },
    assets: [],
  });

  assert.equal(decision.enginePath, "APPROVED_CREATIVE_ENGINE");
  assert.equal(decision.family, "premium_institutional");
});

test("routing: entitlement ON + service_digital normal usa APPROVED_CREATIVE_ENGINE", () => {
  const decision = resolveCreativeEngineRouting({
    entitlementEnabled: true,
    validatedInputs: {
      objective: "Validar Creative Engine em servico digital.",
      offerOrSubject: "Criar uma peca sobre atendimento digital via WhatsApp e conversas em um unico lugar.",
    },
    assets: [{ url: "https://api.vorixworks.com/uploads/assets/t/w/screen.jpg", role: "screenshot", description: "Tela real" }],
  });

  assert.equal(decision.enginePath, "APPROVED_CREATIVE_ENGINE");
  assert.equal(decision.family, "digital_service");
});

test("routing: request atual do frontend nao precisa creativeEngineCompositionMode", () => {
  const decision = resolveCreativeEngineRouting({
    entitlementEnabled: true,
    validatedInputs: {
      objective: "Gerar peca visual",
      offerOrSubject: "Oferta de produto com chamada clara",
      channel: "instagram",
      aspectRatio: "4:5",
    },
    assets: [],
  });

  assert.equal("creativeEngineCompositionMode" in decision, false);
  assert.equal(decision.enginePath, "APPROVED_CREATIVE_ENGINE");
});

test("routing: legacy standard explicito nao autorizado nao derruba para standard", () => {
  const decision = resolveCreativeEngineRouting({
    entitlementEnabled: true,
    validatedInputs: {
      objective: "Gerar peca visual",
      offerOrSubject: "Oferta de produto",
      creativeEngineMode: "legacy_standard",
    },
    assets: [],
    internalLegacyAllowed: false,
  });

  assert.equal(decision.enginePath, "APPROVED_CREATIVE_ENGINE");
  assert.equal(decision.compositionMode, "editorial_experimental");
  assert.equal(decision.reason, "legacy_standard_requested_but_not_authorized");
});

test("routing: legacy standard explicito so existe para QA/teste interno autorizado", () => {
  const decision = resolveCreativeEngineRouting({
    entitlementEnabled: true,
    validatedInputs: {
      objective: "Fixture interno",
      creativeEngineMode: "legacy_standard",
    },
    assets: [],
    internalLegacyAllowed: true,
  });

  assert.equal(decision.enginePath, "LEGACY_STANDARD");
  assert.equal(decision.compositionMode, "standard");
});

test("routing: inferencia de familia cobre as tres familias homologadas", () => {
  assert.equal(inferApprovedCreativeFamily({ validatedInputs: { offerOrSubject: "Oferta com economia" }, assets: [] }), "product_offer");
  assert.equal(inferApprovedCreativeFamily({ validatedInputs: { offerOrSubject: "Institucional premium de confianca" }, assets: [] }), "premium_institutional");
  assert.equal(inferApprovedCreativeFamily({ validatedInputs: { offerOrSubject: "Atendimento digital via WhatsApp" }, assets: [] }), "digital_service");
});
