import type { AuthenticityClass } from "../../../application/ports/visual-asset-provider.port.js";
import type { MediaAssetCapability, MediaAssetIngestionSource } from "../../../application/ports/media-catalog.port.js";

/**
 * OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 2) — classificador canônico de
 * autenticidade. Nunca infere `official_original` só porque o asset está armazenado localmente —
 * exige proveniência real (`ingestionSource` de um sistema de captura oficial, ou uma declaração
 * explícita `authenticityClassOverride` vinda do manifesto/composite). Determinístico, sem
 * palpite: qualquer asset sem sinal suficiente cai em `generic`, nunca em uma categoria oficial.
 */

const OFFICIAL_INGESTION_SOURCES: MediaAssetIngestionSource[] = ["company_intelligence", "campaign_intelligence", "product_screen_catalog"];
const PRODUCT_CAPABILITIES: MediaAssetCapability[] = ["product_screen", "product_demo", "interface_capture", "compositing_source"];
const HUMAN_CAPABILITIES: MediaAssetCapability[] = ["human_context", "background"];
const SYNTHETIC_KIND_HINTS = ["mockup", "graphic", "illustration"];
const PRODUCT_TAG_HINTS = ["mockup", "mockup-produto", "interface", "screenshot", "produto-real"];
const HUMAN_TAG_HINTS = ["pessoa", "casal", "noivos", "contexto-humano", "foto-contexto"];

/** Sem confirmação de atualidade além deste prazo, um asset oficial vira `official_historical` em vez de `official_original` — nunca some da política de prioridade, só perde a garantia de "versão corrente". Genérico, não específico de nenhuma empresa. */
export const OFFICIAL_FRESHNESS_STALE_DAYS = 180;

export type AuthenticityClassificationInput = {
  authenticityClassOverride?: AuthenticityClass;
  ingestionSource?: MediaAssetIngestionSource;
  origin: string;
  kind: string;
  tags: string[];
  capabilities?: MediaAssetCapability[];
  approvalStatus?: string;
  footageClassification?: string;
  validationDate?: string;
  indexedAt?: string;
  now?: Date;
};

function daysSince(isoDate: string | undefined, now: Date): number | undefined {
  if (!isoDate) return undefined;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return (now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24);
}

function isStale(input: AuthenticityClassificationInput): boolean {
  const now = input.now ?? new Date();
  const ageDays = daysSince(input.validationDate, now) ?? daysSince(input.indexedAt, now);
  return ageDays === undefined || ageDays > OFFICIAL_FRESHNESS_STALE_DAYS;
}

function hasAny(haystack: string[], needles: string[]): boolean {
  const normalized = haystack.map((value) => value.toLowerCase());
  return needles.some((needle) => normalized.some((value) => value.includes(needle)));
}

export function classifyAuthenticity(input: AuthenticityClassificationInput): AuthenticityClass {
  if (input.authenticityClassOverride) return input.authenticityClassOverride;

  // Composite sem carimbo explícito de origem (seção 11): nunca assume oficial por omissão.
  if (input.footageClassification === "composited_product_footage") {
    return input.approvalStatus === "approved" ? "synthetic_approved" : "synthetic_unverified";
  }

  const isOfficialSource = Boolean(input.ingestionSource && OFFICIAL_INGESTION_SOURCES.includes(input.ingestionSource));
  const hasProductCapability = (input.capabilities ?? []).some((capability) => PRODUCT_CAPABILITIES.includes(capability));

  if (isOfficialSource && hasProductCapability) {
    return isStale(input) ? "official_historical" : "official_original";
  }

  const looksSynthetic = SYNTHETIC_KIND_HINTS.includes(input.kind) || hasAny(input.tags, PRODUCT_TAG_HINTS) || hasProductCapability;
  if (looksSynthetic) {
    return input.approvalStatus === "approved" ? "synthetic_approved" : "synthetic_unverified";
  }

  const hasHumanCapability = (input.capabilities ?? []).some((capability) => HUMAN_CAPABILITIES.includes(capability));
  const looksLikeStockContext = (input.origin === "free_provider" || input.origin === "external_provider") && (hasHumanCapability || hasAny(input.tags, HUMAN_TAG_HINTS));
  if (looksLikeStockContext) return "stock_contextual";
  if (hasHumanCapability || hasAny(input.tags, HUMAN_TAG_HINTS)) return "stock_contextual";

  return "generic";
}

/** Ordem de prioridade fixa (seção 3) — índice menor = mais confiável. Usada pela Hard Authenticity Constraint (seção 5) e pelo desempate por autenticidade, nunca pela pontuação bruta sozinha. */
export const AUTHENTICITY_PRIORITY_ORDER: AuthenticityClass[] = [
  "official_original",
  "official_derived",
  "official_historical",
  "synthetic_approved",
  "synthetic_unverified",
  "stock_contextual",
  "generic",
];

export function authenticityRank(authenticityClass: AuthenticityClass): number {
  return AUTHENTICITY_PRIORITY_ORDER.indexOf(authenticityClass);
}

export function isOfficial(authenticityClass: AuthenticityClass): boolean {
  return authenticityClass === "official_original" || authenticityClass === "official_derived" || authenticityClass === "official_historical";
}

/** 0-100 usado como a dimensão `authenticity` do score (seção 4) — puramente a posição na ordem de prioridade, nunca dependente de tags. */
export function authenticityScore(authenticityClass: AuthenticityClass): number {
  const rank = authenticityRank(authenticityClass);
  const steps = AUTHENTICITY_PRIORITY_ORDER.length - 1;
  return Math.round(100 - (rank / steps) * 100);
}
