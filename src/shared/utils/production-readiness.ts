import type {
  VisualAssetCreationPackage,
  VisualAssetKind,
  VisualAssetMetadata,
  VisualAssetResolved,
  VisualAssetSearchQuery,
  VisualSequenceRole,
} from "../../application/ports/visual-asset-provider.port.js";
import {
  DEFAULT_ASSET_DIVERSITY_REQUIREMENTS,
  type AssetDiversityRequirements,
  type AssetQualityProfile,
} from "../../application/ports/asset-quality-profile.js";
import { physicalKeyForAsset, type FlaggedShot, type FlaggedShotReason } from "./asset-diversity-gate.js";
import { HUMAN_TAG_SIGNAL, PRODUCT_TAG_SIGNAL, SCREENSHOT_TAG_SIGNAL } from "./visual-asset-tag-signals.js";
import { isProceduralFootage } from "../../application/ports/media-catalog.port.js";
import { assetSignalFromVisualAssetMetadata } from "./coverage/asset-signal.js";
import { evaluateProductScreenCompositingReadiness } from "./coverage/requirement-evaluator.js";

/**
 * PRODUCTION READINESS — módulo puro e determinístico (nenhum I/O), vive em `src/shared/utils`
 * pelo mesmo motivo de `asset-diversity-gate.ts` (não é Skill nem infraestrutura, importável por
 * ambos sem violar ADR 0002). Transforma o `VisualAssetResolver` de "que arquivo usar neste Shot?"
 * em "esta campanha tem material real para virar um comercial?" — calculado ANTES de qualquer
 * renderização, respondendo com um Production Plan (inventário de cenas/Shots/assets) e um
 * Production Readiness Score (cobertura nomeada + nota composta) que pode impedir a renderização
 * quando a resposta for não, explicando exatamente o motivo.
 *
 * Complementa (não substitui) o Asset Diversity Gate: aquele module continua sendo a fonte de
 * verdade para `distinctPhysicalFiles`/`reuseRatio`/pacotes de criação assistida; este módulo lê o
 * mesmo `VisualAssetResolved[]` (mais o `pending: VisualAssetCreationPackage[]` do resolver, que o
 * gate antigo não recebe) para responder a uma pergunta mais ampla: existe show aqui?
 */

export type MediaTypeLabel = "video" | "photo" | "mockup" | "screenshot" | "graphic" | "illustration";

export type ShotPriority = "obrigatorio" | "desejavel";

const PURPOSE_LABEL: Record<VisualSequenceRole, string> = {
  establishing: "Abertura",
  detail: "Detalhe",
  human_interaction: "Interação",
  product: "Produto",
  reaction: "Reação",
  closing: "Fechamento",
};

/** Um Shot, exatamente como um produtor executivo o leria: o que precisa aparecer, em que formato, e se já existe. */
export type ShotRequirement = {
  shotId: string;
  sceneOrder: number;
  shotOrder?: number;
  sceneName: string;
  subjectLabel: string;
  mediaType: MediaTypeLabel;
  role: string;
  isHero: boolean;
  priority: ShotPriority;
  fulfilled: boolean;
  foundAssetKind?: VisualAssetKind;
  foundPhysicalPath?: string;
  missingReason?: string;
  /**
   * EXECUTIVE PRODUCER (INTENT-BASED FOOTAGE ACQUISITION) — pergunta feita ANTES de aprovar
   * qualquer asset: "este vídeo realmente resolve este Shot?" Nunca "é bonito?" — só quando o Shot
   * exige tela de produto visível (`query.productRequirement`/`mockupRequirement`/
   * `screenshotRequirement`) esta pergunta tem sinal real para responder (via `screenVisible`/
   * `compositingReady` do asset); Shots sem essa exigência sempre respondem SIM com justificativa
   * neutra, nunca bloqueados por um critério que não pediram.
   */
  executiveProducerVerdict: "SIM" | "NAO";
  executiveProducerJustification: string;
};

export type ProductionCoverageScores = {
  /** Fração dos Shots planejados que receberam algum asset real (nem que seja fallback). */
  visualCoverage: number;
  /** Dos Shots que precisam de presença humana, fração que recebeu um asset com sinal humano real. */
  humanCoverage: number;
  /** Dos Shots que precisam de produto/mockup/screenshot, fração que recebeu um asset compatível. */
  productCoverage: number;
  /** Dos Shots de reação/fechamento (os batimentos emocionais do roteiro), fração resolvida sem fallback genérico. */
  emotionalCoverage: number;
  /** Fração de todos os Shots planejados que são vídeo/b-roll real. */
  videoCoverage: number;
  /** 1 menos a taxa de violações de sequenciamento (mesmo asset/enquadramento consecutivo, mesma composição em cenas consecutivas). */
  sceneDiversity: number;
  /** 1 menos a taxa de repetição bruta (mesmo arquivo físico, mesmo casal, mesmo mockup reaproveitado em qualquer ponto do vídeo). */
  assetVariety: number;
};

export type ProductionReadinessScore = ProductionCoverageScores & {
  /**
   * Nota composta final — média GEOMÉTRICA (não aritmética) das sete coberturas acima, propositalmente
   * dura com o elo mais fraco: uma única cobertura crítica baixa (ex.: 15% de vídeo) derruba a nota
   * mesmo que todas as outras estejam altas, porque um comercial não fica pronto só porque a média dá
   * conta — precisa que CADA dimensão exista de verdade. Valores são arredondados para 2 casas decimais
   * antes do cálculo para estabilidade numérica; cada cobertura é limitada a um piso de 2% para evitar
   * log(0), então um valor exibido como "0%" ainda pesa o suficiente para derrubar a nota quase a zero.
   */
  overall: number;
  minimumAcceptable: number;
  meetsMinimum: boolean;
};

export type ProductionDiversityViolationKind =
  | "same_asset_consecutive"
  | "same_couple_reused"
  | "same_framing_consecutive"
  | "same_composition_consecutive_scene"
  | "same_mockup_reused";

export type ProductionDiversityViolation = {
  kind: ProductionDiversityViolationKind;
  shotId: string;
  previousShotId?: string;
  detail: string;
};

export type ProductionPlan = {
  scenesCount: number;
  shotsCount: number;
  assetsNeeded: number;
  assetsFound: number;
  assetsMissing: number;
  videoCount: number;
  photoCount: number;
  mockupCount: number;
  /** "Telas do produto" — Shots com requisito de screenshot OU cujo asset carrega sinal de interface/tela real. */
  productScreenCount: number;
  humanAssetCount: number;
  /** Quantos Shots usam um arquivo físico que já apareceu em outro Shot (mesmo que não consecutivo). */
  repeatedAssetCount: number;
  varietySufficient: boolean;
  diversitySufficient: boolean;
  qualitySufficient: boolean;
  shotRequirements: ShotRequirement[];
};

export type ProductionReadinessResult = {
  qualityProfile: AssetQualityProfile;
  requirements: AssetDiversityRequirements;
  plan: ProductionPlan;
  score: ProductionReadinessScore;
  diversityViolations: ProductionDiversityViolation[];
  /** `true` quando o perfil bloqueia (`requirements.blocksOnFailure`) e a nota composta fica abaixo do mínimo aceitável. */
  blocked: boolean;
  blockExplanation?: string;
  /**
   * Shots que JÁ tinham um asset resolvido, mas precisam de um asset novo para sanar o bloqueio
   * (requisito estrito não cumprido, ou uma das novas violações de diversidade) — no formato
   * `FlaggedShot` do Asset Diversity Gate, para que `buildAssistedPackagesForFlaggedShots` possa
   * ser reaproveitado sem duplicar a lógica de agrupamento/prompt. Vazio quando `blocked` é `false`.
   * Shots que nunca chegaram a ter asset nenhum já aparecem em `visualResolution.pending` — não
   * duplicados aqui.
   */
  flaggedEntries: FlaggedShot[];
  /** FOOTAGE VISUAL VALIDATION 2.0 (seção 11) — coberturas específicas de Product Compositing, separadas do `score` geral (nunca entram na média geométrica de `overall`: são um recorte mais estreito, só sobre Shots que exigem produto/tela). */
  compositingReadiness: CompositingReadinessScores;
};

/**
 * FOOTAGE VISUAL VALIDATION 2.0 (seção 11) — "Separar: deviceCoverage; visibleScreenCoverage;
 * interactionCoverage; compositingGeometryCoverage; temporalStabilityCoverage;
 * occlusionSafetyCoverage; verifiedCompositingCoverage." Calculado só sobre os Shots que
 * `needsProduct(query)` (mesmo critério já usado por `productCoverage`); `1` (piso neutro) quando
 * nenhum Shot exige produto — nunca penaliza uma campanha sem Shots de produto por uma dimensão
 * que não se aplica a ela.
 */
export type CompositingReadinessScores = {
  /** Fração com geometria de dispositivo plausível (`deviceConfidence` acima do piso). */
  deviceCoverage: number;
  /** Fração com `screenVisible === true` (estágio alcançou `screen_visible` ou além). */
  visibleScreenCoverage: number;
  /** Fração com interação real perto do dispositivo (`humanInteractionScore` acima do piso). */
  interactionCoverage: number;
  /** Fração com `compositingReady === true` (geometria + estágio automático completos). */
  compositingGeometryCoverage: number;
  /** Fração com `persistenceRatio` acima do piso (região candidata estável entre múltiplos frames, não uma detecção nova a cada frame). */
  temporalStabilityCoverage: number;
  /** Fração SEM `occlusionRisk` (mãos/dedos não cobrem a maior parte da região candidata). */
  occlusionSafetyCoverage: number;
  /**
   * Fração com `compositingReady === true` E `approvalStatus === "approved"` — seção 11: "Somente
   * candidatos humanamente aprovados contam integralmente". Sempre `<= compositingGeometryCoverage`;
   * a diferença entre as duas é exatamente o quanto o pipeline automático "acha que está pronto"
   * mas ainda não foi confirmado por um humano (seção 8: nenhuma aprovação automática).
   */
  verifiedCompositingCoverage: number;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const GEOMETRIC_MEAN_FLOOR = 0.02;

function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  const floored = values.map((value) => Math.max(GEOMETRIC_MEAN_FLOOR, clamp01(round2(value))));
  const logSum = floored.reduce((sum, value) => sum + Math.log(value), 0);
  return clamp01(Math.exp(logSum / floored.length));
}

function normalizedText(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function hasTagSignal(asset: VisualAssetMetadata, signals: string[]): boolean {
  const text = normalizedText(asset.theme, asset.emotion, asset.kind, ...asset.tags);
  return signals.some((signal) => text.includes(signal));
}

function isStrictQuery(query: VisualAssetSearchQuery): boolean {
  return Boolean(
    query.productRequirement?.strict
    || query.humanRequirement?.strict
    || query.mockupRequirement?.strict
    || query.screenshotRequirement?.strict,
  );
}

/** Mesma definição do Asset Diversity Gate: `true` quando o Shot só recebeu o asset via reuso forçado/fallback, nunca uma seleção genuína. Duplicado intencionalmente (defesa em profundidade, isolamento de módulo) em vez de importado de `asset-diversity-gate.ts`. */
function isReuseSelection(entry: VisualAssetResolved): boolean {
  const reason = entry.selectionReason ?? "";
  return reason.startsWith("shot_reuse") || Boolean(entry.reusedFromShotId);
}

function needsHuman(query: VisualAssetSearchQuery): boolean {
  return Boolean(query.humanRequirement) || query.shotPurpose === "human_interaction" || query.shotPurpose === "reaction";
}

function needsProduct(query: VisualAssetSearchQuery): boolean {
  return Boolean(query.productRequirement || query.mockupRequirement || query.screenshotRequirement) || query.shotPurpose === "product";
}

function isEmotionalBeat(query: VisualAssetSearchQuery): boolean {
  return query.shotPurpose === "reaction" || query.shotPurpose === "closing";
}

/** MEDIA INTELLIGENCE ENGINE (seção 7) — mesma regra de `asset-diversity-gate.ts`: um `kind` de vídeo/b-roll só conta como filmagem real quando o catálogo não o marcou explicitamente como procedural/sintético. Sem classificação anexada (candidato legado), só `kind` decide, como sempre decidiu. */
function isRealVideoAsset(asset: VisualAssetMetadata): boolean {
  if (asset.kind !== "video" && asset.kind !== "b_roll") return false;
  return !isProceduralFootage(asset.footageClassification);
}

function mediaTypeLabelFor(query: VisualAssetSearchQuery, kind?: VisualAssetKind): MediaTypeLabel {
  if (query.screenshotRequirement) return "screenshot";
  return mediaTypeLabelForKind(kind ?? query.desiredKind);
}

function mediaTypeLabelForKind(kind: VisualAssetKind): MediaTypeLabel {
  if (kind === "video" || kind === "b_roll" || kind === "cinemagraph") return "video";
  if (kind === "mockup") return "mockup";
  if (kind === "graphic") return "graphic";
  if (kind === "illustration") return "illustration";
  return "photo";
}

function subjectLabelFor(query: VisualAssetSearchQuery): string {
  const explicit = query.humanRequirement?.subject
    ?? query.productRequirement?.productName
    ?? query.screenshotRequirement?.interface
    ?? query.mockupRequirement?.what;
  if (explicit) return explicit;
  const theme = query.theme ?? "";
  if (theme.length > 0) return theme.length > 70 ? `${theme.slice(0, 67)}...` : theme;
  return query.narrativeFunction ?? "Sem descrição";
}

function priorityFor(query: VisualAssetSearchQuery): ShotPriority {
  return isStrictQuery(query) ? "obrigatorio" : "desejavel";
}

type ResolvedShot = VisualAssetResolved & { shotId: string };
type PendingShot = VisualAssetCreationPackage & { shotId: string };

function resolvedShotsOf(resolved: VisualAssetResolved[]): ResolvedShot[] {
  return resolved.filter((entry): entry is ResolvedShot => typeof entry.shotId === "string" && entry.shotId.length > 0);
}

function pendingShotsOf(pending: VisualAssetCreationPackage[]): PendingShot[] {
  return pending.filter((entry): entry is PendingShot => typeof entry.shotId === "string" && entry.shotId.length > 0);
}

/**
 * EXECUTIVE PRODUCER — "este vídeo realmente resolve este Shot?", nunca "é bonito?". Sem sinal de
 * exigência de produto, a pergunta não se aplica (sempre SIM, neutro). Com exigência, prioriza o
 * sinal REAL da validação visual heurística (`screenVisible`/`compositingReady`, preenchidos só
 * por Shots adquiridos via Intent-Based Footage Acquisition); na ausência desses campos (asset da
 * biblioteca local ou de sprints anteriores, nunca validado assim), cai para o sinal já existente
 * de tag de produto — nunca finge ter rodado uma validação que não rodou.
 */
/**
 * UNIFIED COVERAGE MODEL — delega para o avaliador canônico (`requirement-evaluator.ts`), a MESMA
 * função que Gap Analysis e Asset Diversity Gate agora também chamam para a pergunta "este asset
 * resolve a exigência de tela de produto do Shot?". Só a tradução de `RequirementState` para o
 * vocabulário legado `SIM`/`NAO` (ainda exposto por `ShotRequirement`) continua aqui.
 */
function evaluateExecutiveProducerVerdict(entry: ResolvedShot): { verdict: "SIM" | "NAO"; justification: string } {
  if (!needsProduct(entry.query)) {
    return { verdict: "SIM", justification: "Shot não exige tela de produto visível — critério do Executive Producer não se aplica." };
  }
  const evaluation = evaluateProductScreenCompositingReadiness(assetSignalFromVisualAssetMetadata(entry.asset));
  const verdict: "SIM" | "NAO" = evaluation.state === "fulfilled" || evaluation.state === "candidate_found" ? "SIM" : "NAO";
  return { verdict, justification: evaluation.evidence.detail };
}

function buildShotRequirements(found: ResolvedShot[], missing: PendingShot[]): ShotRequirement[] {
  const fromFound: ShotRequirement[] = found.map((entry) => {
    const executiveProducer = evaluateExecutiveProducerVerdict(entry);
    return {
      shotId: entry.shotId,
      sceneOrder: entry.sceneOrder,
      shotOrder: entry.shotOrder,
      sceneName: entry.sceneName,
      subjectLabel: subjectLabelFor(entry.query),
      mediaType: mediaTypeLabelFor(entry.query, entry.asset.kind),
      role: entry.shotPurpose ? PURPOSE_LABEL[entry.shotPurpose] : "Conectivo",
      isHero: entry.sceneOrder === 1,
      priority: priorityFor(entry.query),
      fulfilled: !(isStrictQuery(entry.query) && isReuseSelection(entry)),
      foundAssetKind: entry.asset.kind,
      foundPhysicalPath: physicalKeyForAsset(entry.asset),
      missingReason: isStrictQuery(entry.query) && isReuseSelection(entry)
        ? "Shot estrito resolvido apenas com asset reutilizado/fallback, não um candidato compatível real."
        : undefined,
      executiveProducerVerdict: executiveProducer.verdict,
      executiveProducerJustification: executiveProducer.justification,
    };
  });

  const fromMissing: ShotRequirement[] = missing.map((entry) => ({
    shotId: entry.shotId,
    sceneOrder: entry.sceneOrder,
    shotOrder: undefined,
    sceneName: entry.sceneName,
    subjectLabel: entry.requiredSubject ?? entry.tags.join(", ") ?? "Sem descrição",
    mediaType: entry.requiredKind ? mediaTypeLabelForKind(entry.requiredKind) : "photo",
    role: entry.shotPurpose ? PURPOSE_LABEL[entry.shotPurpose] : "Conectivo",
    isHero: entry.sceneOrder === 1,
    priority: "obrigatorio",
    fulfilled: false,
    missingReason: entry.rejectionReason ?? "Nenhum asset resolvido para este Shot.",
    executiveProducerVerdict: "NAO",
    executiveProducerJustification: "Shot sem nenhum asset resolvido — não há vídeo para o Executive Producer avaliar.",
  }));

  return [...fromFound, ...fromMissing].sort((a, b) => (a.sceneOrder - b.sceneOrder) || ((a.shotOrder ?? 0) - (b.shotOrder ?? 0)));
}

function detectDiversityViolations(ordered: ResolvedShot[]): ProductionDiversityViolation[] {
  const violations: ProductionDiversityViolation[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const sameScene = previous.sceneOrder === current.sceneOrder;

    if (physicalKeyForAsset(previous.asset) === physicalKeyForAsset(current.asset)) {
      violations.push({
        kind: "same_asset_consecutive",
        shotId: current.shotId,
        previousShotId: previous.shotId,
        detail: `Shot ${current.shotId} reutiliza o mesmo arquivo físico do Shot anterior (${previous.shotId}) — nunca permitido em Shots consecutivos, mesmo com continuityGroup.`,
      });
    }

    if (sameScene && previous.query.framing && current.query.framing && previous.query.framing === current.query.framing) {
      violations.push({
        kind: "same_framing_consecutive",
        shotId: current.shotId,
        previousShotId: previous.shotId,
        detail: `Shot ${current.shotId} repete o mesmo enquadramento ("${current.query.framing}") do Shot anterior (${previous.shotId}) dentro da mesma cena.`,
      });
    }
  }

  const sceneOrders = [...new Set(ordered.map((entry) => entry.sceneOrder))].sort((a, b) => a - b);
  const compositionByScene = new Map<number, string | undefined>();
  for (const entry of ordered) {
    if (!compositionByScene.has(entry.sceneOrder)) compositionByScene.set(entry.sceneOrder, entry.query.composition);
  }
  for (let index = 1; index < sceneOrders.length; index += 1) {
    const previousComposition = compositionByScene.get(sceneOrders[index - 1]);
    const currentComposition = compositionByScene.get(sceneOrders[index]);
    if (previousComposition && currentComposition && previousComposition === currentComposition) {
      const firstShotOfScene = ordered.find((entry) => entry.sceneOrder === sceneOrders[index]);
      if (firstShotOfScene) {
        violations.push({
          kind: "same_composition_consecutive_scene",
          shotId: firstShotOfScene.shotId,
          detail: `Cena ${sceneOrders[index]} repete a mesma composição da cena anterior (${sceneOrders[index - 1]}).`,
        });
      }
    }
  }

  const byPhysicalKey = new Map<string, ResolvedShot[]>();
  for (const entry of ordered) {
    const key = physicalKeyForAsset(entry.asset);
    const bucket = byPhysicalKey.get(key) ?? [];
    bucket.push(entry);
    byPhysicalKey.set(key, bucket);
  }
  for (const bucket of byPhysicalKey.values()) {
    if (bucket.length < 2) continue;
    const isHumanBucket = hasTagSignal(bucket[0].asset, HUMAN_TAG_SIGNAL);
    const isMockupBucket = bucket[0].asset.kind === "mockup";
    for (const repeated of bucket.slice(1)) {
      if (isHumanBucket) {
        violations.push({
          kind: "same_couple_reused",
          shotId: repeated.shotId,
          previousShotId: bucket[0].shotId,
          detail: `Shot ${repeated.shotId} mostra o mesmo casal/pessoa já usado no Shot ${bucket[0].shotId} — nunca reutilizar o mesmo asset humano em mais de um Shot.`,
        });
      }
      if (isMockupBucket) {
        violations.push({
          kind: "same_mockup_reused",
          shotId: repeated.shotId,
          previousShotId: bucket[0].shotId,
          detail: `Shot ${repeated.shotId} reutiliza o mesmo mockup já usado no Shot ${bucket[0].shotId} — nunca reutilizar o mesmo mockup.`,
        });
      }
    }
  }

  return violations;
}

const VIOLATION_REASON: Record<ProductionDiversityViolationKind, FlaggedShotReason> = {
  same_asset_consecutive: "same_asset_consecutive",
  same_couple_reused: "same_couple_reused",
  same_framing_consecutive: "same_framing_consecutive",
  same_composition_consecutive_scene: "same_composition_consecutive_scene",
  same_mockup_reused: "same_mockup_reused",
};

/**
 * Converte Shots que JÁ têm asset, mas ainda assim impedem a produção (requisito estrito não
 * cumprido, ou violação de uma das novas regras de diversidade), em `FlaggedShot[]` reaproveitando
 * o mesmo formato do Asset Diversity Gate — para que `buildAssistedPackagesForFlaggedShots` sirva
 * os dois gates sem duplicar a lógica de agrupamento/prompt.
 */
function flagEntriesForProductionGaps(ordered: ResolvedShot[], shotRequirements: ShotRequirement[], violations: ProductionDiversityViolation[]): FlaggedShot[] {
  const byShotId = new Map(ordered.map((entry) => [entry.shotId, entry] as const));
  const flaggedByShotId = new Map<string, FlaggedShot>();

  const flag = (entry: ResolvedShot, reason: FlaggedShotReason, reasonMessage: string) => {
    if (flaggedByShotId.has(entry.shotId)) return;
    flaggedByShotId.set(entry.shotId, {
      shotId: entry.shotId,
      sceneOrder: entry.sceneOrder,
      shotOrder: entry.shotOrder,
      shotPurpose: entry.shotPurpose,
      reason,
      reasonMessage,
      rejectedAssetId: entry.asset.id,
      entry,
    });
  };

  for (const requirement of shotRequirements) {
    if (requirement.fulfilled || !requirement.missingReason) continue;
    const entry = byShotId.get(requirement.shotId);
    if (entry) flag(entry, "unresolved_strict", requirement.missingReason);
  }

  for (const violation of violations) {
    const entry = byShotId.get(violation.shotId);
    if (entry) flag(entry, VIOLATION_REASON[violation.kind], violation.detail);
  }

  return [...flaggedByShotId.values()];
}

function buildBlockExplanation(plan: ProductionPlan, score: ProductionReadinessScore, requirements: AssetDiversityRequirements): string {
  const byPurpose = new Map<string, number>();
  for (const requirement of plan.shotRequirements) {
    byPurpose.set(requirement.role, (byPurpose.get(requirement.role) ?? 0) + 1);
  }
  const purposeBreakdown = [...byPurpose.entries()].map(([role, count]) => `${count} ${role.toLowerCase()}`).join(", ");

  const lines = [
    `Campanha exige: ${plan.shotsCount} Shots (${plan.assetsNeeded} asset(s) necessário(s)).`,
    `Encontrados: ${plan.videoCount} vídeo(s), ${plan.photoCount} fotografia(s), ${plan.mockupCount} mockup(s), ${plan.productScreenCount} tela(s) de produto, ${plan.humanAssetCount} asset(s) humano(s).`,
    `Faltam: ${plan.assetsMissing} asset(s) sem nenhum candidato resolvido.`,
    purposeBreakdown ? `Distribuição por função narrativa: ${purposeBreakdown}.` : undefined,
    `Production Readiness: ${Math.round(score.overall * 100)}% (mínimo aceitável para o perfil: ${Math.round(requirements.minProductionReadiness * 100)}%).`,
    `Coberturas: visual ${Math.round(score.visualCoverage * 100)}%, humana ${Math.round(score.humanCoverage * 100)}%, produto ${Math.round(score.productCoverage * 100)}%, emocional ${Math.round(score.emotionalCoverage * 100)}%, vídeo ${Math.round(score.videoCoverage * 100)}%, diversidade de cena ${Math.round(score.sceneDiversity * 100)}%, variedade de asset ${Math.round(score.assetVariety * 100)}%.`,
    "Não existe material suficiente para produzir um vídeo profissional com este perfil de qualidade.",
  ];
  return lines.filter(Boolean).join("\n");
}

export function evaluateProductionReadiness(
  resolved: VisualAssetResolved[],
  pending: VisualAssetCreationPackage[],
  qualityProfile: AssetQualityProfile,
  requirementsOverride?: Partial<AssetDiversityRequirements>,
): ProductionReadinessResult {
  const requirements: AssetDiversityRequirements = {
    ...DEFAULT_ASSET_DIVERSITY_REQUIREMENTS[qualityProfile],
    ...requirementsOverride,
  };

  const found = resolvedShotsOf(resolved);
  const missing = pendingShotsOf(pending);
  const ordered = [...found].sort((a, b) => (a.sceneOrder - b.sceneOrder) || ((a.shotOrder ?? 0) - (b.shotOrder ?? 0)));

  const shotsCount = found.length + missing.length;
  const scenesCount = new Set([...found.map((entry) => entry.sceneOrder), ...missing.map((entry) => entry.sceneOrder)]).size;

  const videoCount = found.filter((entry) => isRealVideoAsset(entry.asset)).length;
  const photoCount = found.filter((entry) => entry.asset.kind === "photo").length;
  const mockupCount = found.filter((entry) => entry.asset.kind === "mockup").length;
  const productScreenCount = found.filter((entry) => Boolean(entry.query.screenshotRequirement) || hasTagSignal(entry.asset, SCREENSHOT_TAG_SIGNAL)).length;
  const humanAssetCount = found.filter((entry) => hasTagSignal(entry.asset, HUMAN_TAG_SIGNAL)).length;

  const physicalKeys = found.map((entry) => physicalKeyForAsset(entry.asset));
  const distinctPhysicalFiles = new Set(physicalKeys).size;
  const repeatedAssetCount = Math.max(0, found.length - distinctPhysicalFiles);

  const diversityViolations = detectDiversityViolations(ordered);
  const shotRequirements = buildShotRequirements(found, missing);

  const usageRatio = found.length > 0 ? Math.max(0, ...[...countBy(physicalKeys).values()]) / found.length : 0;
  const varietySufficient = distinctPhysicalFiles >= requirements.minDistinctPhysicalFiles && usageRatio <= requirements.maxAssetUsageRatio;
  const diversitySufficient = diversityViolations.filter((violation) => violation.kind === "same_asset_consecutive" || violation.kind === "same_couple_reused" || violation.kind === "same_mockup_reused").length === 0;
  const qualitySufficient = missing.length === 0 && shotRequirements.every((requirement) => requirement.fulfilled);

  const plan: ProductionPlan = {
    scenesCount,
    shotsCount,
    assetsNeeded: shotsCount,
    assetsFound: found.length,
    assetsMissing: missing.length,
    videoCount,
    photoCount,
    mockupCount,
    productScreenCount,
    humanAssetCount,
    repeatedAssetCount,
    varietySufficient,
    diversitySufficient,
    qualitySufficient,
    shotRequirements,
  };

  const scores = computeCoverageScores({ found, shotsCount, distinctPhysicalFiles, diversityViolations });

  const overall = geometricMean([
    scores.visualCoverage,
    scores.humanCoverage,
    scores.productCoverage,
    scores.emotionalCoverage,
    scores.videoCoverage,
    scores.sceneDiversity,
    scores.assetVariety,
  ]);

  const score: ProductionReadinessScore = {
    ...scores,
    overall,
    minimumAcceptable: requirements.minProductionReadiness,
    meetsMinimum: overall >= requirements.minProductionReadiness,
  };

  const blocked = requirements.blocksOnFailure && !score.meetsMinimum;
  const blockExplanation = blocked ? buildBlockExplanation(plan, score, requirements) : undefined;
  const flaggedEntries = blocked ? flagEntriesForProductionGaps(ordered, shotRequirements, diversityViolations) : [];
  const compositingReadiness = computeCompositingReadinessScores(found);

  return { qualityProfile, requirements, plan, score, diversityViolations, blocked, blockExplanation, flaggedEntries, compositingReadiness };
}

const MIN_DEVICE_CONFIDENCE_FOR_COVERAGE = 0.2;
const MIN_INTERACTION_FOR_COVERAGE = 0.12;
const MIN_PERSISTENCE_FOR_COVERAGE = 0.6;

function computeCompositingReadinessScores(found: ResolvedShot[]): CompositingReadinessScores {
  const productNeeded = found.filter((entry) => needsProduct(entry.query));
  if (productNeeded.length === 0) {
    return {
      deviceCoverage: 1, visibleScreenCoverage: 1, interactionCoverage: 1, compositingGeometryCoverage: 1,
      temporalStabilityCoverage: 1, occlusionSafetyCoverage: 1, verifiedCompositingCoverage: 1,
    };
  }

  const fractionOf = (predicate: (asset: VisualAssetMetadata) => boolean): number =>
    clamp01(productNeeded.filter((entry) => predicate(entry.asset)).length / productNeeded.length);

  return {
    deviceCoverage: fractionOf((asset) => (asset.deviceConfidence ?? 0) >= MIN_DEVICE_CONFIDENCE_FOR_COVERAGE),
    visibleScreenCoverage: fractionOf((asset) => asset.screenVisible === true),
    interactionCoverage: fractionOf((asset) => (asset.humanInteractionScore ?? 0) >= MIN_INTERACTION_FOR_COVERAGE),
    compositingGeometryCoverage: fractionOf((asset) => asset.compositingReady === true),
    temporalStabilityCoverage: fractionOf((asset) => (asset.persistenceRatio ?? 0) >= MIN_PERSISTENCE_FOR_COVERAGE),
    occlusionSafetyCoverage: fractionOf((asset) => asset.occlusionRisk !== true),
    verifiedCompositingCoverage: fractionOf((asset) => asset.compositingReady === true && asset.approvalStatus === "approved"),
  };
}

function countBy(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}

function computeCoverageScores(input: {
  found: ResolvedShot[];
  shotsCount: number;
  distinctPhysicalFiles: number;
  diversityViolations: ProductionDiversityViolation[];
}): ProductionCoverageScores {
  const { found, shotsCount, distinctPhysicalFiles, diversityViolations } = input;

  const visualCoverage = shotsCount > 0 ? found.length / shotsCount : 1;

  const humanNeeded = found.filter((entry) => needsHuman(entry.query));
  const humanFulfilled = humanNeeded.filter((entry) => hasTagSignal(entry.asset, HUMAN_TAG_SIGNAL) && !(isStrictQuery(entry.query) && isReuseSelection(entry)));
  const humanCoverage = humanNeeded.length > 0 ? humanFulfilled.length / humanNeeded.length : 1;

  const productNeeded = found.filter((entry) => needsProduct(entry.query));
  const productFulfilled = productNeeded.filter((entry) => (hasTagSignal(entry.asset, PRODUCT_TAG_SIGNAL) || hasTagSignal(entry.asset, SCREENSHOT_TAG_SIGNAL)) && !(isStrictQuery(entry.query) && isReuseSelection(entry)));
  const productCoverage = productNeeded.length > 0 ? productFulfilled.length / productNeeded.length : 1;

  const emotionalNeeded = found.filter((entry) => isEmotionalBeat(entry.query));
  const emotionalFulfilled = emotionalNeeded.filter((entry) => !isReuseSelection(entry));
  const emotionalCoverage = emotionalNeeded.length > 0 ? emotionalFulfilled.length / emotionalNeeded.length : 1;

  const videoCoverage = shotsCount > 0 ? found.filter((entry) => isRealVideoAsset(entry.asset)).length / shotsCount : 0;

  const sceneDiversityViolations = diversityViolations.filter((violation) => violation.kind === "same_asset_consecutive" || violation.kind === "same_framing_consecutive" || violation.kind === "same_composition_consecutive_scene").length;
  const sceneDiversityPairs = Math.max(1, found.length - 1);
  const sceneDiversity = clamp01(1 - sceneDiversityViolations / sceneDiversityPairs);

  const varietyViolations = diversityViolations.filter((violation) => violation.kind === "same_couple_reused" || violation.kind === "same_mockup_reused").length;
  const rawRepeats = Math.max(0, found.length - distinctPhysicalFiles);
  const assetVariety = found.length > 0 ? clamp01(1 - (rawRepeats + varietyViolations) / found.length) : 0;

  return {
    visualCoverage: clamp01(visualCoverage),
    humanCoverage: clamp01(humanCoverage),
    productCoverage: clamp01(productCoverage),
    emotionalCoverage: clamp01(emotionalCoverage),
    videoCoverage: clamp01(videoCoverage),
    sceneDiversity,
    assetVariety,
  };
}

/** Formata uma cobertura 0..1 como string percentual arredondada, para logs/CLI/relatórios. */
export function formatCoveragePercent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}
