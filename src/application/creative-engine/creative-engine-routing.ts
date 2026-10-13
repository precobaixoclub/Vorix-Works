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
  familySource?: "EXPLICIT" | "INFERRED";
  familyEligibility?: {
    result: "PASS" | "FAIL";
    reason: string;
    missingRequirements?: string[];
  };
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

export function explicitlyRequestsProductOffer(validatedInputs: Record<string, string>): boolean {
  const directFields = [
    validatedInputs.creativeFamily,
    validatedInputs.family,
    validatedInputs.contentFamily,
    validatedInputs.requestedFamily,
    validatedInputs.adFamily,
  ].map(normalize);
  if (directFields.some((value) => value === "product_offer" || value === "product offer" || value === "oferta de produto")) return true;
  const freeText = normalize([validatedInputs.objective, validatedInputs.offerOrSubject].filter(Boolean).join("\n"));
  return /\bproduct[_ -]?offer\b/.test(freeText);
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
  ) {
    return "product_offer";
  }

  return "premium_institutional";
}

export function resolveCreativeEngineRouting(input: CreativeEngineRoutingInput): CreativeEngineRoutingDecision {
  const explicitProductOffer = explicitlyRequestsProductOffer(input.validatedInputs);
  const resolvedFamily = explicitProductOffer ? "product_offer" : inferApprovedCreativeFamily(input);
  const familySource = explicitProductOffer ? "EXPLICIT" : "INFERRED";
  const productAssetEligible = input.assets.some((asset) => asset.role === "product_photo");
  const familyEligibility = resolvedFamily === "product_offer"
    ? {
        result: productAssetEligible ? "PASS" as const : "FAIL" as const,
        reason: productAssetEligible ? "verified_product_asset_present" : "product_offer_requires_verified_product_asset",
        ...(productAssetEligible ? {} : { missingRequirements: ["product_photo"] }),
      }
    : { result: "PASS" as const, reason: "family_does_not_require_product_asset" };

  if (explicitlyRequestsLegacy(input.validatedInputs)) {
    if (!input.internalLegacyAllowed) {
      return {
        enginePath: "APPROVED_CREATIVE_ENGINE",
        compositionMode: "editorial_experimental",
        family: resolvedFamily,
        familySource,
        familyEligibility,
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
      family: resolvedFamily,
      familySource,
      familyEligibility,
      reason: "creative_engine_entitlement_enabled_default",
    };
  }

  return {
    enginePath: "LEGACY_STANDARD",
    compositionMode: "standard",
    reason: "creative_engine_entitlement_not_enabled",
  };
}
