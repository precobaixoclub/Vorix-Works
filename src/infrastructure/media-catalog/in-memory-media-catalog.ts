import { randomUUID } from "node:crypto";
import { isCapableOfDesiredType } from "../../shared/utils/local-asset-qualification/desired-kind-compatibility.js";
import {
  isProceduralFootage,
  isRealFootage,
  type MediaAssetRecord,
  type MediaAssetType,
  type MediaApprovalStatus,
  type MediaAssetUsageRecord,
  type MediaCollectionRecord,
  type MediaCollectionStats,
  type MediaGapAnalysisResult,
  type MediaGapItem,
  type MediaGapPriority,
  type MediaHealthReport,
  type MediaLicenseStatus,
  type MediaSearchMatch,
  type MediaSearchQuery,
  type MediaSearchResult,
  type MediaSearchScoreBreakdown,
  type MediaShotPlanEntry,
  type ShotRequirementState,
} from "../../application/ports/media-catalog.port.js";
import { assetSignalFromMediaAssetRecord } from "../../shared/utils/coverage/asset-signal.js";
import { evaluateProductScreenCompositingReadiness, evaluateRequirement } from "../../shared/utils/coverage/requirement-evaluator.js";
import type { RequirementState } from "../../shared/utils/coverage/requirement-state.js";
import type { ShotRequirement } from "../../shared/utils/coverage/shot-requirement.model.js";

/**
 * MEDIA INTELLIGENCE ENGINE — motor puro em memória: busca/ranqueamento, análise de lacunas,
 * relatório de saúde e coleções. `MediaCatalogRepository` (persistência JSON) delega toda a lógica
 * real para esta classe, no mesmo espírito de `InMemoryClaraKnowledgeRepository`. Não faz nenhum
 * I/O — nunca lê/escreve arquivo, nunca chama FFmpeg. `scan()` NÃO existe aqui de propósito: é
 * inerentemente I/O-pesado (varredura de disco, hash, extração de metadados) e vive em
 * `media-file-scanner.ts`, cujos resultados o repositório mescla nesta classe.
 */

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeToken(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function textFieldsOf(asset: MediaAssetRecord): string {
  return [
    asset.name,
    asset.subtype,
    asset.emotion,
    asset.style,
    asset.location,
    ...asset.themes,
    ...asset.people,
    ...asset.actions,
    ...asset.objects,
    ...asset.tags,
  ].filter((value): value is string => Boolean(value)).join(" ");
}

/** Sobreposição de tokens 0..1 — a mesma filosofia de "correspondência por token normalizado" usada em `local-visual-asset-library.ts`/`visual-asset-resolver.ts`, generalizada para texto livre. Esta é uma busca por PALAVRAS-CHAVE, não uma busca semântica real (nenhum modelo de embeddings está disponível neste ambiente) — limitação documentada no relatório final da sprint. */
function tokenOverlapScore(queryTokens: string[], candidateText: string): number {
  if (queryTokens.length === 0) return 0.5;
  const candidateTokens = new Set(tokenize(candidateText));
  if (candidateTokens.size === 0) return 0;
  let matched = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) { matched += 1; continue; }
    for (const candidateToken of candidateTokens) {
      if (candidateToken.includes(token) || token.includes(candidateToken)) { matched += 1; break; }
    }
  }
  return Math.min(1, matched / queryTokens.length);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function qualityOf(asset: MediaAssetRecord): number {
  const scores = [asset.scores.technicalScore, asset.scores.aestheticScore, asset.scores.productionScore].filter((value): value is number => typeof value === "number");
  if (scores.length === 0) return 0.5;
  return clamp01(scores.reduce((sum, value) => sum + value, 0) / scores.length / 100);
}

function humanSignal(asset: MediaAssetRecord): boolean {
  return asset.people.length > 0 || asset.tags.some((tag) => ["pessoa", "casal", "noivos", "contexto-humano"].includes(normalizeToken(tag)));
}

function physicalKeyOf(asset: MediaAssetRecord): string {
  return asset.absolutePath.replace(/\\/g, "/").toLowerCase();
}

/** UNIFIED COVERAGE MODEL — traduz o `RequirementState` canônico (7 estados) para o vocabulário legado de 4 estados que `MediaGapItem.requirementStates` continua expondo publicamente. */
function toLegacyShotRequirementState(state: RequirementState): ShotRequirementState {
  if (state === "fulfilled" || state === "approved") return "satisfied";
  if (state === "candidate_found" || state === "validated") return "partially_satisfied";
  if (state === "rejected" || state === "missing") return "unsatisfied";
  return "unknown";
}

function probe(category: ShotRequirement["category"]): ShotRequirement {
  return { requirementId: "probe", shotId: "probe", sceneOrder: 0, category, description: "sonda interna", weight: 1, mandatory: true, validationMethod: "structured_field", source: "shot_plan" };
}

/**
 * FOOTAGE VISUAL VALIDATION 2.0 (seção 10) / UNIFIED COVERAGE MODEL (sprint atual) — corrige o bug
 * real e comprovado do gapAnalysis: um Shot que exige "casal usando celular com tela visível" era
 * marcado `found` sempre que QUALQUER asset com tag "casamento"/"casal" pontuasse bem na
 * sobreposição de tokens, mesmo sem nenhum dispositivo/tela/interação real. Esta função avalia os
 * requisitos ESTRUTURADOS do Shot (dispositivo/tela/interação/composição) usando o MESMO
 * `evaluateRequirement` canônico (`shared/utils/coverage/requirement-evaluator.ts`) que Production
 * Readiness e Asset Diversity Gate agora também chamam — nunca mais uma terceira implementação
 * independente da mesma pergunta. Só roda quando o Shot de fato declarou ao menos um desses
 * requisitos (`undefined`/`"none"` nunca vira "satisfeito por omissão"; vira `"unknown"`, o valor honesto).
 */
function evaluateStructuredShotRequirements(shot: MediaShotPlanEntry, asset: MediaAssetRecord): {
  states: Record<"device" | "screenVisible" | "interaction" | "compositing", ShotRequirementState>;
  anyUnsatisfied: boolean;
  reasonParts: string[];
} {
  const states: Record<"device" | "screenVisible" | "interaction" | "compositing", ShotRequirementState> = {
    device: "unknown", screenVisible: "unknown", interaction: "unknown", compositing: "unknown",
  };
  const reasonParts: string[] = [];
  const signal = assetSignalFromMediaAssetRecord(asset);

  if (shot.device && shot.device !== "none") {
    const evaluation = evaluateRequirement(probe(shot.device), signal);
    states.device = toLegacyShotRequirementState(evaluation.state);
    if (states.device === "unsatisfied") reasonParts.push(evaluation.evidence.detail);
  }

  if (shot.screenVisibleRequired) {
    const screenEvaluation = evaluateRequirement(probe("phone_screen"), signal);
    states.screenVisible = toLegacyShotRequirementState(screenEvaluation.state);
    if (states.screenVisible === "unsatisfied") reasonParts.push("tela visível exigida, mas o candidato não passou na validação visual (screenVisible=false)");

    const interactionEvaluation = evaluateRequirement(probe("interaction"), signal);
    states.interaction = toLegacyShotRequirementState(interactionEvaluation.state);
    if (states.interaction === "unsatisfied") reasonParts.push("interação com o dispositivo exigida, mas humanInteractionScore do candidato é 0 (ninguém interagindo, só o dispositivo — ou nem isso)");
  }

  if (shot.compositingRequired) {
    const compositingEvaluation = evaluateProductScreenCompositingReadiness(signal);
    states.compositing = toLegacyShotRequirementState(compositingEvaluation.state);
    if (states.compositing === "unsatisfied") reasonParts.push("composição de produto exigida, mas o candidato não chegou ao estágio compositing_ready");
  }

  const anyUnsatisfied = Object.values(states).includes("unsatisfied");
  return { states, anyUnsatisfied, reasonParts };
}

function hasStructuredRequirements(shot: MediaShotPlanEntry): boolean {
  return Boolean((shot.device && shot.device !== "none") || shot.screenVisibleRequired || shot.compositingRequired);
}

export class InMemoryMediaCatalog {
  private readonly assets = new Map<string, MediaAssetRecord>();
  private readonly collections = new Map<string, MediaCollectionRecord>();

  async upsert(asset: MediaAssetRecord): Promise<void> {
    this.assets.set(asset.assetId, asset);
  }

  /** Alias de `upsert` — existe para que `InMemoryMediaCatalog` sozinho já satisfaça a interface `MediaCatalogPort` completa (usado diretamente em testes de `media-acquisition.ts`, sem precisar da persistência JSON de `MediaCatalogRepository`). */
  async indexAcquiredAsset(asset: MediaAssetRecord): Promise<void> {
    await this.upsert(asset);
  }

  async list(filter?: { type?: MediaAssetType; approvalStatus?: MediaApprovalStatus; licenseStatus?: MediaLicenseStatus }): Promise<MediaAssetRecord[]> {
    let records = [...this.assets.values()];
    if (filter?.type) records = records.filter((asset) => asset.type === filter.type);
    if (filter?.approvalStatus) records = records.filter((asset) => asset.approvalStatus === filter.approvalStatus);
    if (filter?.licenseStatus) records = records.filter((asset) => asset.licenseStatus === filter.licenseStatus);
    return records.sort((a, b) => a.assetId.localeCompare(b.assetId));
  }

  async get(assetId: string): Promise<MediaAssetRecord | undefined> {
    return this.assets.get(assetId);
  }

  async findByPath(absolutePath: string): Promise<MediaAssetRecord | undefined> {
    const key = physicalKeyOf({ absolutePath } as MediaAssetRecord);
    return [...this.assets.values()].find((asset) => physicalKeyOf(asset) === key);
  }

  async findByHash(hash: string): Promise<MediaAssetRecord | undefined> {
    return [...this.assets.values()].find((asset) => asset.hash === hash);
  }

  async tag(assetIdOrPath: string, tags: string[]): Promise<MediaAssetRecord> {
    const asset = this.assets.get(assetIdOrPath) ?? (await this.findByPath(assetIdOrPath));
    if (!asset) throw new Error(`Asset não encontrado no catálogo: ${assetIdOrPath}`);
    const merged = new Set([...asset.tags, ...tags.map((tag) => tag.trim()).filter(Boolean)]);
    const updated: MediaAssetRecord = { ...asset, tags: [...merged] };
    this.assets.set(asset.assetId, updated);
    return updated;
  }

  async approve(assetId: string, note?: string): Promise<MediaAssetRecord> {
    const asset = this.requireAsset(assetId);
    const notes = note ? [...(asset.notes ?? []), `Aprovado (revisão humana): ${note}`] : asset.notes;
    const updated: MediaAssetRecord = { ...asset, approvalStatus: "approved", notes };
    this.assets.set(assetId, updated);
    return updated;
  }

  async reject(assetId: string, reason?: string): Promise<MediaAssetRecord> {
    const asset = this.requireAsset(assetId);
    const notes = reason ? [...(asset.notes ?? []), `Rejeitado: ${reason}`] : asset.notes;
    const updated: MediaAssetRecord = { ...asset, approvalStatus: "rejected", notes };
    this.assets.set(assetId, updated);
    return updated;
  }

  async remove(assetId: string): Promise<void> {
    this.assets.delete(assetId);
  }

  async recordUsage(assetId: string, usage: MediaAssetUsageRecord): Promise<void> {
    const asset = this.assets.get(assetId);
    if (!asset) return;
    this.assets.set(assetId, { ...asset, usageHistory: [...asset.usageHistory, usage] });
  }

  private requireAsset(assetId: string): MediaAssetRecord {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Asset não encontrado no catálogo: ${assetId}`);
    return asset;
  }

  async search(query: MediaSearchQuery): Promise<MediaSearchResult> {
    const warnings: string[] = [];
    const queryTokens = tokenize([query.text ?? "", ...(query.themes ?? []), ...(query.actions ?? []), query.emotion ?? ""].join(" "));
    const excludeIds = new Set(query.excludeAssetIds ?? []);
    const excludeKeys = new Set(query.excludePhysicalKeys ?? []);

    let candidates = [...this.assets.values()].filter((asset) => asset.available);
    // LOCAL OFFICIAL ASSET QUALIFICATION (seção 6): não exige mais igualdade estrita de `type` —
    // um asset cujo `type` físico diverge mas cujas `capabilities` cobrem o tipo pedido (ex.: uma
    // foto/vídeo real com capacidade `product_screen` satisfazendo `desiredKind = "mockup"`)
    // também é aceito. Nunca REMOVE nenhum candidato que já combinava por igualdade estrita.
    if (query.type) candidates = candidates.filter((asset) => isCapableOfDesiredType(asset, query.type));
    if (query.requireApproved) candidates = candidates.filter((asset) => asset.approvalStatus === "approved");
    if (query.minDurationSeconds) candidates = candidates.filter((asset) => (asset.durationSeconds ?? 0) >= query.minDurationSeconds!);
    if (query.minWidth) candidates = candidates.filter((asset) => (asset.width ?? 0) >= query.minWidth!);
    if (query.minHeight) candidates = candidates.filter((asset) => (asset.height ?? 0) >= query.minHeight!);

    const matches: MediaSearchMatch[] = candidates.map((asset) => {
      const scoreBreakdown = this.scoreCandidate(asset, query, queryTokens, excludeIds, excludeKeys);
      const score = this.weightedTotal(scoreBreakdown);
      return { asset, score, scoreBreakdown };
    });

    matches.sort((a, b) => b.score - a.score);
    const limited = query.limit ? matches.slice(0, query.limit) : matches;
    if (candidates.length === 0) warnings.push("Nenhum asset disponível no catálogo para esta consulta.");

    return { matches: limited, warnings };
  }

  private scoreCandidate(
    asset: MediaAssetRecord,
    query: MediaSearchQuery,
    queryTokens: string[],
    excludeIds: Set<string>,
    excludeKeys: Set<string>,
  ): MediaSearchScoreBreakdown {
    const text = textFieldsOf(asset);
    const thematic = tokenOverlapScore(queryTokens.length > 0 ? queryTokens : tokenize((query.themes ?? []).join(" ")), text) * 100;
    const action = query.actions && query.actions.length > 0 ? tokenOverlapScore(tokenize(query.actions.join(" ")), asset.actions.join(" ")) * 100 : 70;
    const emotion = query.emotion ? (normalizeToken(asset.emotion ?? "") === normalizeToken(query.emotion) ? 100 : tokenOverlapScore(tokenize(query.emotion), asset.emotion ?? "") * 100) : 70;
    const humanPresence = query.requiresHuman === undefined ? 70 : (humanSignal(asset) === query.requiresHuman ? 100 : 20);
    let productFit = query.shotPlanTags && query.shotPlanTags.length > 0 ? tokenOverlapScore(tokenize(query.shotPlanTags.join(" ")), text) * 100 : 70;
    // INTENT-BASED FOOTAGE ACQUISITION — quando o Shot claramente pede produto/interface (sinal já
    // existente via shotPlanTags) e o asset passou pela validação visual heurística pós-download,
    // usa esse sinal REAL para reforçar (compositingReady) ou penalizar (screenVisible=false
    // explícito) o candidato — nunca aplicado quando o asset não passou por essa validação
    // (screenVisible/compositingReady === undefined), para não penalizar a biblioteca local.
    const shotWantsProduct = /produto-real|mockup|interface|pessoa-usando-produto/i.test((query.shotPlanTags ?? []).join(" "));
    if (shotWantsProduct) {
      if (asset.compositingReady === true) productFit = Math.min(100, productFit + 20);
      else if (asset.screenVisible === false) productFit = Math.max(0, productFit - 30);
    }

    let aspectRatio = 70;
    if (query.targetAspectRatio && asset.aspectRatio) {
      aspectRatio = asset.aspectRatio === query.targetAspectRatio ? 100 : 50;
    }

    const resolution = asset.width && asset.height ? Math.min(100, Math.round((Math.min(asset.width, asset.height) / 1080) * 100)) : 40;
    const duration = asset.durationSeconds ? Math.min(100, Math.round((asset.durationSeconds / 3) * 100)) : 60;
    const quality = qualityOf(asset) * 100;

    let license = 70;
    if (asset.licenseStatus === "unknown") license = 10;
    else if (asset.license?.allowsCommercialUse === false) license = 20;
    else license = 100;

    const creativeDna = query.creativeDnaKeywords && query.creativeDnaKeywords.length > 0 ? tokenOverlapScore(tokenize(query.creativeDnaKeywords.join(" ")), text) * 100 : 70;
    const shotPlanFit = productFit;

    let diversity = 100;
    if (excludeIds.has(asset.assetId)) diversity = 0;
    else if (excludeKeys.has(physicalKeyOf(asset))) diversity = 0;
    else if (asset.duplicate.duplicateOf) diversity = 30;
    else if ((asset.duplicate.visualNearDuplicateOf ?? []).length > 0) diversity = 55;

    return { thematic, action, emotion, humanPresence, productFit, aspectRatio, resolution, duration, quality, license, creativeDna, shotPlanFit, diversity };
  }

  /** Mesma filosofia de pesos de `scoreTotal` em `visual-asset-resolver.ts` (soma 1.00), adaptada às 13 dimensões de busca do catálogo. */
  private weightedTotal(score: MediaSearchScoreBreakdown): number {
    return Math.round(
      score.thematic * 0.16 +
      score.action * 0.09 +
      score.emotion * 0.08 +
      score.humanPresence * 0.09 +
      score.productFit * 0.08 +
      score.aspectRatio * 0.08 +
      score.resolution * 0.06 +
      score.duration * 0.04 +
      score.quality * 0.1 +
      score.license * 0.08 +
      score.creativeDna * 0.06 +
      score.shotPlanFit * 0.04 +
      score.diversity * 0.04,
    );
  }

  async healthReport(): Promise<MediaHealthReport> {
    const assets = [...this.assets.values()];
    const byType: Record<string, number> = {};
    const byApprovalStatus: Record<string, number> = {};
    const coverageByTheme: Record<string, number> = {};
    const coverageByEmotion: Record<string, number> = {};
    const coverageByAction: Record<string, number> = {};
    const usageCounts = new Map<string, number>();

    let licenseBlocked = 0;
    let licenseUnknown = 0;
    let duplicates = 0;
    let realVideos = 0;
    let photos = 0;
    let mockups = 0;
    let music = 0;
    let sfx = 0;

    for (const asset of assets) {
      byType[asset.type] = (byType[asset.type] ?? 0) + 1;
      byApprovalStatus[asset.approvalStatus] = (byApprovalStatus[asset.approvalStatus] ?? 0) + 1;
      if (asset.approvalStatus === "license_blocked") licenseBlocked += 1;
      if (asset.licenseStatus === "unknown") licenseUnknown += 1;
      if (asset.duplicate.duplicateOf) duplicates += 1;
      if ((asset.type === "video" || asset.type === "b_roll") && isRealFootage(asset.footageClassification)) realVideos += 1;
      if (asset.type === "photo") photos += 1;
      if (asset.type === "mockup") mockups += 1;
      if (asset.type === "music") music += 1;
      if (asset.type === "sfx") sfx += 1;
      for (const theme of asset.themes) coverageByTheme[theme] = (coverageByTheme[theme] ?? 0) + 1;
      if (asset.emotion) coverageByEmotion[asset.emotion] = (coverageByEmotion[asset.emotion] ?? 0) + 1;
      for (const action of asset.actions) coverageByAction[action] = (coverageByAction[action] ?? 0) + 1;
      usageCounts.set(asset.assetId, asset.usageHistory.length);
    }

    const mostUsedAssets = [...usageCounts.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([assetId, usageCount]) => ({ assetId, usageCount }));
    const neverUsedAssets = [...usageCounts.entries()].filter(([, count]) => count === 0).map(([assetId]) => assetId);
    const saturationRisk = [...usageCounts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).map(([assetId, usageCount]) => ({ assetId, usageCount }));

    const criticalGaps: string[] = [];
    if (realVideos === 0) criticalGaps.push("Nenhum vídeo real (filmed_footage/generated_video/screenshot_recording) no catálogo — apenas conteúdo procedural, se houver vídeo.");
    if (licenseUnknown === assets.length && assets.length > 0) criticalGaps.push("100% dos assets têm licença desconhecida — nenhum pode ser usado com segurança em publicação externa.");
    if ((byType.mockup ?? 0) === 0) criticalGaps.push("Nenhum mockup de interface catalogado.");
    if ((byType.music ?? 0) === 0) criticalGaps.push("Nenhuma trilha musical catalogada.");

    const acquisitionRecommendations: string[] = [];
    if (realVideos < 5) acquisitionRecommendations.push(`Adquirir filmagem real (filmed_footage) — apenas ${realVideos} vídeo(s) real(is) catalogado(s) hoje.`);
    if (licenseUnknown > 0) acquisitionRecommendations.push(`Validar licença de ${licenseUnknown} asset(s) com licenseStatus "unknown" antes de qualquer publicação externa.`);
    if ((byType.photo ?? 0) < 10) acquisitionRecommendations.push("Ampliar o acervo de fotografia real de casais/cerimônia/convidados.");

    return {
      totalAssets: assets.length,
      byType,
      byApprovalStatus,
      licenseBlocked,
      licenseUnknown,
      duplicates,
      realVideos,
      photos,
      mockups,
      music,
      sfx,
      coverageByTheme,
      coverageByEmotion,
      coverageByAction,
      criticalGaps,
      mostUsedAssets,
      neverUsedAssets,
      saturationRisk,
      acquisitionRecommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  async gapAnalysis(shotPlan: MediaShotPlanEntry[]): Promise<MediaGapAnalysisResult> {
    const itemsFound: MediaGapItem[] = [];
    const itemsSubstitute: MediaGapItem[] = [];
    const itemsMissing: MediaGapItem[] = [];
    const itemsLicenseUnknown: MediaGapItem[] = [];
    const itemsDuplicateRisk: MediaGapItem[] = [];
    const shotsWithoutRealFootage: string[] = [];

    const byCoupleKey = new Map<string, string[]>();
    const byEnvironment = new Map<string, string[]>();

    for (const shot of shotPlan) {
      const shotLabel = shot.shotId ?? `cena-${shot.sceneOrder}`;
      if (shot.coupleKey) {
        const bucket = byCoupleKey.get(shot.coupleKey) ?? [];
        bucket.push(shotLabel);
        byCoupleKey.set(shot.coupleKey, bucket);
      }
      if (shot.environment) {
        const bucket = byEnvironment.get(shot.environment) ?? [];
        bucket.push(shotLabel);
        byEnvironment.set(shot.environment, bucket);
      }

      const priority: MediaGapPriority = shot.strict ? "obrigatorio" : (shot.requiresRealFootage ? "desejavel" : "opcional");
      const description = `${shot.desiredType} — ${shot.themes.join(", ") || shot.subjectLabel || "sem tema"}`;

      const result = await this.search({
        type: shot.desiredType,
        themes: shot.themes,
        action: shot.action ? [shot.action] : undefined,
        emotion: shot.emotion,
        requiresHuman: shot.requiresHuman,
      } as never);
      const best = result.matches[0];

      if (!best) {
        itemsMissing.push({ shotId: shot.shotId, sceneOrder: shot.sceneOrder, description, priority, status: "missing", reason: "Nenhum candidato encontrado no catálogo para este Shot." });
        if (shot.requiresRealFootage) shotsWithoutRealFootage.push(shotLabel);
        continue;
      }

      if (best.asset.licenseStatus === "unknown") {
        itemsLicenseUnknown.push({ shotId: shot.shotId, sceneOrder: shot.sceneOrder, description, priority, status: "license_unknown", candidateAssetId: best.asset.assetId, reason: "Melhor candidato tem licença desconhecida — bloqueado para publicação externa até validação humana." });
      }
      if (best.asset.duplicate.duplicateOf || (best.asset.duplicate.visualNearDuplicateOf ?? []).length > 0) {
        itemsDuplicateRisk.push({ shotId: shot.shotId, sceneOrder: shot.sceneOrder, description, priority, status: "duplicate_risk", candidateAssetId: best.asset.assetId, reason: "Melhor candidato é uma duplicata/quase-duplicata registrada — não deve contar como variedade real." });
      }

      if (shot.requiresRealFootage && !isRealFootage(best.asset.footageClassification)) {
        shotsWithoutRealFootage.push(shotLabel);
        itemsSubstitute.push({ shotId: shot.shotId, sceneOrder: shot.sceneOrder, description, priority, status: "substitute", candidateAssetId: best.asset.assetId, reason: isProceduralFootage(best.asset.footageClassification) ? "Único candidato disponível é procedural/sintético, não filmagem real." : "Único candidato disponível não tem classificação de filmagem real confirmada." });
        continue;
      }

      // FOOTAGE VISUAL VALIDATION 2.0 (seção 10) — checagem de requisitos ESTRUTURADOS, nunca só
      // sobreposição de tags temáticas. Um asset "casamento"/"casal" pontuando bem no texto NUNCA
      // basta sozinho quando o Shot pediu dispositivo/tela/interação/composição reais e o melhor
      // candidato não tem essa evidência — bug real desta saga (tags genéricas mascarando a falta
      // de dispositivo/tela).
      const structuredRequirements = hasStructuredRequirements(shot) ? evaluateStructuredShotRequirements(shot, best.asset) : undefined;
      if (structuredRequirements?.anyUnsatisfied) {
        itemsSubstitute.push({
          shotId: shot.shotId, sceneOrder: shot.sceneOrder, description, priority, status: "substitute", candidateAssetId: best.asset.assetId,
          reason: `Melhor candidato pontuou ${best.score}/100 no tema, mas não atende requisito(s) estruturado(s) do Shot: ${structuredRequirements.reasonParts.join("; ")}.`,
          requirementStates: structuredRequirements.states,
        });
        continue;
      }

      if (best.score < 50) {
        itemsSubstitute.push({ shotId: shot.shotId, sceneOrder: shot.sceneOrder, description, priority, status: "substitute", candidateAssetId: best.asset.assetId, reason: `Melhor candidato pontuou apenas ${best.score}/100 — é um substituto, não um asset realmente adequado.`, requirementStates: structuredRequirements?.states });
        continue;
      }

      itemsFound.push({ shotId: shot.shotId, sceneOrder: shot.sceneOrder, description, priority, status: "found", candidateAssetId: best.asset.assetId, reason: `Candidato adequado encontrado (score ${best.score}/100).`, requirementStates: structuredRequirements?.states });
    }

    const sameCoupleShots = [...byCoupleKey.values()].filter((shots) => shots.length > 1);
    const sameEnvironmentShots = [...byEnvironment.values()].filter((shots) => shots.length > 1);

    const priorityRank: Record<MediaGapPriority, number> = { obrigatorio: 0, desejavel: 1, opcional: 2 };
    const prioritizedList = [...itemsMissing, ...itemsSubstitute, ...itemsLicenseUnknown, ...itemsDuplicateRisk]
      .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

    return {
      totalShots: shotPlan.length,
      itemsFound,
      itemsSubstitute,
      itemsMissing,
      itemsLicenseUnknown,
      itemsDuplicateRisk,
      sameCoupleShots,
      sameEnvironmentShots,
      shotsWithoutRealFootage: [...new Set(shotsWithoutRealFootage)],
      prioritizedList,
    };
  }

  async listCollections(): Promise<MediaCollectionRecord[]> {
    return [...this.collections.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async createCollection(input: { name: string; description?: string; assetIds: string[] }): Promise<MediaCollectionRecord> {
    const now = new Date().toISOString();
    const record: MediaCollectionRecord = {
      collectionId: randomUUID(),
      name: input.name,
      description: input.description,
      assetIds: [...input.assetIds],
      createdAt: now,
      updatedAt: now,
    };
    this.collections.set(record.collectionId, record);
    return record;
  }

  async loadCollections(records: MediaCollectionRecord[]): Promise<void> {
    for (const record of records) this.collections.set(record.collectionId, record);
  }

  async collectionStats(collectionId: string): Promise<MediaCollectionStats | undefined> {
    const collection = this.collections.get(collectionId);
    if (!collection) return undefined;
    const assets = collection.assetIds.map((id) => this.assets.get(id)).filter((asset): asset is MediaAssetRecord => Boolean(asset));

    const themeCoverage = [...new Set(assets.flatMap((asset) => asset.themes))];
    const humanVariety = new Set(assets.flatMap((asset) => asset.people)).size;
    const environmentVariety = new Set(assets.map((asset) => asset.location).filter(Boolean)).size;
    const realVideoCount = assets.filter((asset) => (asset.type === "video" || asset.type === "b_roll") && isRealFootage(asset.footageClassification)).length;
    const photoCount = assets.filter((asset) => asset.type === "photo").length;
    const averageQuality = assets.length > 0 ? Math.round((assets.reduce((sum, asset) => sum + qualityOf(asset), 0) / assets.length) * 100) : 0;

    const gaps: string[] = [];
    if (realVideoCount === 0) gaps.push("Nenhum vídeo real na coleção.");
    if (humanVariety < 2) gaps.push("Pouca variedade humana (menos de 2 pessoas/sujeitos distintos catalogados).");
    if (assets.some((asset) => asset.licenseStatus === "unknown")) gaps.push("Coleção contém asset(s) com licença desconhecida.");

    return {
      collectionId: collection.collectionId,
      name: collection.name,
      assetCount: assets.length,
      themeCoverage,
      humanVariety,
      environmentVariety,
      realVideoCount,
      photoCount,
      averageQuality,
      gaps,
    };
  }

  size(): number {
    return this.assets.size;
  }
}
