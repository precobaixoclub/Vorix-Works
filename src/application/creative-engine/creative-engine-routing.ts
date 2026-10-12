import type { CreativeContextAsset } from "../../shared/utils/gpt-creative-plan.types.js";
import { extractCommercialFactsFromText } from "../../shared/utils/commercial-fact-normalizer.js";

export const CREATIVE_ENGINE_PATHS = ["APPROVED_CREATIVE_ENGINE", "LEGACY_STANDARD", "INTERNAL_TEST"] as const;
export type CreativeEnginePath = (typeof CREATIVE_ENGINE_PATHS)[number];

export type ApprovedCreativeFamily = "product_offer" | "premium_institutional" | "digital_service";

export type CreativeEngineRoutingInput = {
  validatedInputs: Record<string, string>;
  assets: readonly CreativeContextAsset[];
  entitlementEnabled: boolean;
  internalLegacyAllowed?: boolean;
};

export type CreativeEngineRoutingDecision = {
  enginePath: CreativeEnginePath;
  compositionMode: "standard" | "editorial_experimental";
  family?: ApprovedCreativeFamily;
  reason: string;
};

function normalize(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function explicitlyRequestsLegacy(validatedInputs: Record<string, string>): boolean {
  return normalize(validatedInputs.creativeEngineMode) === "legacy_standard"
    || normalize(validatedInputs.internalCreativeEnginePath) === "legacy_standard";
}

export function inferApprovedCreativeFamily(input: Pick<CreativeEngineRoutingInput, "validatedInputs" | "assets">): ApprovedCreativeFamily {
  const text = normalize([
    input.validatedInputs.objective,
    input.validatedInputs.offerOrSubject,
    input.validatedInputs.targetAudience,
    input.validatedInputs.channel,
    input.validatedInputs.contentFormat,
  ].filter(Boolean).join("\n"));

  if (
    input.assets.some((asset) => asset.role === "screenshot")
    || includesAny(text, ["whatsapp", "atendimento", "conversas", "app", "software", "plataforma digital", "interface", "screenshot", "servico digital"])
  ) {
    return "digital_service";
  }

  const textCommercialFacts = extractCommercialFactsFromText(input.validatedInputs.offerOrSubject ?? "");
  if (
    input.assets.some((asset) => asset.role === "product_photo")
    || textCommercialFacts.length > 0
    || includesAny(text, ["oferta", "ofertas", "produto", "produtos", "preco", "economia", "desconto", "promocao", "compre"])
  ) {
    return "product_offer";
  }

  return "premium_institutional";
}

export function resolveCreativeEngineRouting(input: CreativeEngineRoutingInput): CreativeEngineRoutingDecision {
  if (explicitlyRequestsLegacy(input.validatedInputs)) {
    if (!input.internalLegacyAllowed) {
      return {
        enginePath: "APPROVED_CREATIVE_ENGINE",
        compositionMode: "editorial_experimental",
        family: inferApprovedCreativeFamily(input),
        reason: "legacy_standard_requested_but_not_authorized",
      };
    }
    return {
      enginePath: "LEGACY_STANDARD",
      compositionMode: "standard",
      reason: "internal_legacy_standard_authorized",
    };
  }

  if (input.entitlementEnabled) {
    return {
      enginePath: "APPROVED_CREATIVE_ENGINE",
      compositionMode: "editorial_experimental",
      family: inferApprovedCreativeFamily(input),
      reason: "creative_engine_entitlement_enabled_default",
    };
  }

  return {
    enginePath: "LEGACY_STANDARD",
    compositionMode: "standard",
    reason: "creative_engine_entitlement_not_enabled",
  };
}
