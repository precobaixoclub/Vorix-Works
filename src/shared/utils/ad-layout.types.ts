/**
 * Tipos puros do Performance Creative Engine — estrutura o que antes só existia como prosa livre
 * no design-spec da Bianca. Nenhuma lógica de IA aqui, só formas de dado; a decisão de quais
 * campos preencher (nunca inventando fato comercial novo) vive em `bianca-social-media-design.
 * skill.ts` (`buildPerformanceCreativePlan`/`buildAdLayoutSpec`). `src/shared` não é uma Skill —
 * importar daqui não viola ADR 0002.
 */

import type { ProductRenderMode } from "./product-asset.types.js";
import type { CommercialFactResolution } from "./commercial-fact-normalizer.js";
import type { ComponentSkin } from "./brand-visual-profile.types.js";
import type { VisualGrammar } from "./visual-grammar.types.js";
import type { RepairInstructionType } from "./repair-instructions.js";

export const LAYOUT_FAMILIES = [
  "hero_offer",
  "price_dominant",
  "product_feature",
  "comparison",
  "benefit_grid",
  "social_proof",
  "premium_product",
  "flash_sale",
  "minimal_offer",
  "performance_product",
] as const;

export type LayoutFamily = (typeof LAYOUT_FAMILIES)[number];

export const VISUAL_DENSITIES = ["clean", "performance", "max_performance"] as const;

export type VisualDensity = (typeof VISUAL_DENSITIES)[number];

// Fatia 2, Prioridades 8/9 — tipos compartilhados entre `creative-candidate-planning.ts` e
// `pre-render-creative-score.ts`, definidos AQUI (não em nenhum dos dois) para evitar import
// circular: os dois módulos já precisam importar `PerformanceCreativePlan`/`AdLayoutSpec` daqui.
export const CREATIVE_CANDIDATE_IDS = ["A", "B", "C"] as const;
export type CreativeCandidateId = (typeof CREATIVE_CANDIDATE_IDS)[number];

/** Resumo de um candidato criativo (Prioridade 8) — auditoria, não o plano completo (que já vive
 * em `PerformanceCreativePlan`, redundante repetir aqui). */
export type CreativeCandidateSummary = {
  id: CreativeCandidateId;
  layoutFamily: LayoutFamily;
  visualDensity: VisualDensity;
  rationale: string;
  zoneTypes: AdLayoutZoneType[];
};

export type CandidateScoreDimensions = {
  objectiveFit: number;
  commercialStrength: number;
  informationHierarchy: number;
  brandFit: number;
  formatFit: number;
  productProminencePlan: number;
  clarity: number;
  densityBalance: number;
  differentiation: number;
  /** 10 = risco de poluição visual BAIXO (bom); 0 = risco alto. */
  clutterRisk: number;
};

export type CandidateScoreEntry = {
  candidateId: CreativeCandidateId;
  score: number;
  dimensions: CandidateScoreDimensions;
  penalties: string[];
};

// Fatia 3 — Repair Loop: registro de cada tentativa automática de reparo (nunca mais de 2 por
// geração). Nunca decide silenciosamente — toda tentativa fica registrada, resolvida ou não.
export type RepairAttemptResult = "resolved" | "still_violated" | "verification_unavailable" | "zone_removed";

export type RepairAttemptRecord = {
  attempt: number;
  issueType: RepairInstructionType;
  zoneType?: AdLayoutZoneType;
  reasoning: string;
  correctionApplied: string;
  result: RepairAttemptResult;
};

/**
 * Plano criativo de performance — transforma o creative_brief (João) + fatos comerciais
 * (Reference Intelligence) + copy (Maria) numa estratégia visual de conversão. Nem todo campo
 * precisa estar preenchido; só entram fatos confirmados (nunca um valor inventado). Ver
 * `buildPerformanceCreativePlan` em `bianca-social-media-design.skill.ts` — função determinística
 * pura, nunca passa pelo aprimoramento de IA da Bianca.
 */
export type PerformanceCreativePlan = {
  objective: string;
  creativeType: string;
  primaryHook?: string;
  secondaryHook?: string;
  heroProduct?: string;
  offer?: string;
  price?: string;
  oldPrice?: string;
  discount?: string;
  socialProof?: string;
  benefits: string[];
  trustSignals: string[];
  specifications: string[];
  urgency?: string;
  cta: string;
  brandElements: string[];
  visualDensity: VisualDensity;
  layoutFamily: LayoutFamily;
  /** Argumentos comerciais disponíveis, já ranqueados por força (ver `rankCommercialArguments`,
   * `commercial-argument-ranking.ts`) — só os que de fato existem, na ordem de prioridade. */
  informationPriority: string[];
  /** Product Asset Pipeline (Rodada 2, Prioridade 1) — modo de renderização decidido para o
   * produto (ver `resolveProductRenderMode`, `product-asset.types.ts`). `undefined` quando a
   * decisão nunca rodou (ex.: sem `objectStorage` configurado) — mesmo comportamento de sempre. */
  productRenderMode?: ProductRenderMode;
  /** URL do recorte real do produto (fundo neutralizado), só presente quando
   * `productRenderMode === "original_asset"` — consumido pela zona `heroProduct` do renderer. */
  heroProductAssetUrl?: string;
  /** Fatia 2, Bloco 0.4 — todo conflito real entre fontes de fato comercial (imagem de referência
   * vs. texto livre) e como foi resolvido — nunca decidido silenciosamente. Lista vazia = nenhum
   * conflito ocorreu (fontes concordam ou só uma trouxe cada fato). */
  commercialFactResolutions: CommercialFactResolution[];
  /** Fatia 2, Prioridade 7 — como a marca organiza informação visualmente, derivado de
   * `BrandVisualProfile.personality`/`shapeLanguage`/`imagery` (ver `deriveVisualGrammar`).
   * `undefined` quando não há perfil de marca disponível (degrada para o visual neutro de sempre). */
  visualGrammar?: VisualGrammar;
  /** Fatia 2, Prioridade 6 — skin visual por tipo de zona (ver `resolveZoneSkins`), aplicado pelo
   * renderer aos componentes correspondentes. `undefined` = todos os componentes usam o skin
   * "clean" (visual de sempre, pré-Prioridade 6). */
  componentSkins?: Partial<Record<AdLayoutZoneType, ComponentSkin>>;
  /** Fatia 2, Prioridade 5 — origem do `BrandVisualProfile` usado neste plano (auditoria/relatório
   * de "BrandVisualProfile funcionando"). `undefined` quando nenhum perfil estava disponível. */
  brandVisualProfileSource?: string;
  /** Fatia 2, Prioridade 8 — os até 3 candidatos criativos considerados antes da geração cara
   * (ver `generateCreativeCandidates`). `undefined` quando o multi-candidate planning não rodou
   * (mesma condição de ausência do restante do plano). */
  creativeCandidates?: CreativeCandidateSummary[];
  /** Fatia 2, Prioridade 9 — score 0-100 de cada candidato (ver `scoreCandidates`), nunca decidido
   * silenciosamente. */
  candidateScores?: CandidateScoreEntry[];
  /** Fatia 2, Prioridade 9 — id do candidato vencedor; este PRÓPRIO plano já É o plano do
   * vencedor (`layoutFamily`/`visualDensity` já refletem a escolha). */
  winnerCandidateId?: CreativeCandidateId;
  /** Fatia 2, Prioridade 9 — por que o vencedor venceu (dimensões que mais pesaram vs. o 2º
   * colocado). */
  selectionReason?: string;
  /** Fatia 2, Prioridade 8 — diversidade real entre os candidatos (0-100; ver
   * `computeCandidateDiversity`) — nunca aceita "mesma família com 10px de diferença". */
  candidateDiversityScore?: number;
  /** Fatia 3 — Repair Loop: toda tentativa automática de reparo desta geração, resolvida ou não
   * (nunca mais de 2). Lista vazia = nenhuma violação reparável foi detectada (não significa que
   * o Repair Loop não rodou — ver `repairLoopRan` pra distinguir os dois casos). */
  repairAttempts?: RepairAttemptRecord[];
  /** `true` quando a checagem de oclusão semântica do Repair Loop de fato rodou (best-effort —
   * `false`/`undefined` quando `semanticOcclusionChecker` não estava configurado ou a verificação
   * falhou antes de produzir qualquer veredito). */
  repairLoopRan?: boolean;
};

export const AD_LAYOUT_ZONE_TYPES = [
  "price",
  "discount",
  "headline",
  "cta",
  "rating",
  "salesProof",
  "benefits",
  "specs",
  "badge",
  "logo",
  "heroProduct",
] as const;

export type AdLayoutZoneType = (typeof AD_LAYOUT_ZONE_TYPES)[number];

/** Zonas "renderer-owned" — elementos comerciais críticos que a Fase 7 tira do modelo generativo e
 * passa a compor deterministicamente. `logo` fica de fora (já tem seu próprio compositor,
 * `logo-compositor.ts`, com posicionamento/tamanho próprios). `heroProduct` entrou na Rodada 2
 * (Product Asset Pipeline, Prioridade 1) — só é resolvida de verdade quando
 * `plan.heroProductAssetUrl` existe (`productRenderMode === "original_asset"`); nos outros modos,
 * o produto continua sendo o próprio Pedro quem desenha, e a zona simplesmente não resolve nada
 * (ver `resolveZoneContent` em `ad-creative-renderer.ts`). */
export const RENDERER_OWNED_ZONE_TYPES: readonly AdLayoutZoneType[] = [
  "price",
  "discount",
  "headline",
  "cta",
  "rating",
  "salesProof",
  "benefits",
  "specs",
  "badge",
  "heroProduct",
];

export type AdLayoutZonePosition = {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
};

export type AdLayoutZone = {
  type: AdLayoutZoneType;
  /** 1 = mais importante. Usado por `applyInformationBudget` pra decidir o que remover quando a
   * densidade escolhida não comporta todas as zonas candidatas. */
  priority: number;
  position: AdLayoutZonePosition;
};

export type AdLayoutSpec = {
  format: string;
  aspectRatio: string;
  layoutFamily: LayoutFamily;
  density: VisualDensity;
  zones: AdLayoutZone[];
};

function isValidLayoutFamily(value: unknown): value is LayoutFamily {
  return (LAYOUT_FAMILIES as readonly string[]).includes(value as string);
}

function isValidVisualDensity(value: unknown): value is VisualDensity {
  return (VISUAL_DENSITIES as readonly string[]).includes(value as string);
}

export { isValidLayoutFamily, isValidVisualDensity };
