import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readVideoMetadata, isVideoExtension } from "../visual-assets/visual-asset-metadata.js";
import { computeFileHash, computePerceptualHash, hammingDistance, NEAR_DUPLICATE_HAMMING_THRESHOLD } from "./media-hash.js";
import { gatherRealFootageEvidence } from "./footage-classifier.js";
import { downloadMediaFile, type DownloadLimits } from "./media-download-security.js";
import { analyzeVisualCandidate } from "../footage-acquisition/visual-candidate-validator.js";
import { simulatePreComposition } from "../footage-acquisition/pre-composition-simulator.js";
import { buildShotIntentQueryPlan, type ShotIntentQueryPlan } from "../footage-acquisition/shot-intent-query-generator.js";
import { rankCandidatesByShotIntent } from "../footage-acquisition/shot-intent-requirements.js";
import { deriveShotIntent, type ShotIntent } from "../../shared/utils/shot-intent.js";
import { evaluateSemanticSafetyPreDownload, evaluateSemanticSafetyPostAnalysis } from "../footage-acquisition/semantic-safety-gate.js";
import { computeRejectionPatternPenalty, type RejectionHistoryEntry } from "../footage-acquisition/rejection-history.js";
import { hasReached, type RejectionPatternCode, type VisualValidationStage } from "../footage-acquisition/visual-validation-stage.js";
import { rm } from "node:fs/promises";
import type {
  MediaAssetRecord,
  MediaCatalogPort,
  MediaGapAnalysisResult,
  MediaGapItem,
  MediaShotPlanEntry,
} from "../../application/ports/media-catalog.port.js";
import type {
  MediaProviderDownloadRecord,
  MediaProviderPort,
  MediaProviderSearchHit,
  MediaProviderSearchQuery,
} from "../../application/ports/media-provider.port.js";

/**
 * REAL FOOTAGE ACQUISITION — orquestração completa de "buscar -> ranquear -> baixar -> validar ->
 * classificar -> indexar" para um Media Gap Analysis inteiro. Nunca chama o provider a partir do
 * VisualAssetResolver nem de nenhuma Skill — só a CLI (`--media-acquire*`) chama isto, e o
 * resultado entra no catálogo pela mesma porta genérica que o resolver já consulta
 * (`MediaCatalogVisualAssetProvider`, da sprint anterior).
 */

export type AcquisitionRejectionReason =
  | "corrupted_file"
  | "too_small"
  | "low_resolution"
  | "insufficient_duration"
  | "unsupported_codec"
  | "incompatible_content"
  | "duplicate"
  | "near_duplicate"
  | "license_missing_or_incompatible"
  | "download_failed"
  | "screen_not_visible"
  | "semantic_content_mismatch";

export type AcquisitionPolicy = {
  minWidth: number;
  minHeight: number;
  minDurationSeconds: number;
  maxCandidatesPerShot: number;
  maxDownloadsPerRun: number;
};

export const DEFAULT_ACQUISITION_POLICY: AcquisitionPolicy = {
  minWidth: 640,
  minHeight: 640,
  minDurationSeconds: 1,
  maxCandidatesPerShot: 5,
  maxDownloadsPerRun: 20,
};

export type AcquisitionLogEntry = {
  id: string;
  timestamp: string;
  executionId?: string;
  shotId?: string;
  sceneOrder?: number;
  queryText: string;
  provider: string;
  externalId?: string;
  outcome: "acquired" | "rejected";
  rejectionReason?: AcquisitionRejectionReason;
  rejectionDetail?: string;
  assetId?: string;
  author?: string;
  licenseName?: string;
  originalUrl?: string;
  downloadedFilePath?: string;
  /** FOOTAGE VISUAL VALIDATION 2.0 — slug legível da página de origem (nunca a URL de download do arquivo), usado pelo Semantic Safety Gate e pelo Aprendizado de Rejeições (seção 9) para comparar candidatos futuros. */
  originPageUrl?: string;
  /** FOOTAGE VISUAL VALIDATION 2.0 (seção 9) — motivo padronizado e auditável da rejeição, usado por `computeRejectionPatternPenalty` para penalizar candidatos semelhantes em buscas futuras. Ausente quando a rejeição não teve relação com validação visual/semântica (ex.: licença, duplicata). */
  rejectionPattern?: RejectionPatternCode;
  /** FOOTAGE VISUAL VALIDATION 2.0 — estágio final de classificação visual, presente mesmo quando o candidato foi adquirido (não só rejeitado). */
  visualValidationStage?: VisualValidationStage;
};

export type AcquisitionOutcome =
  | { status: "acquired"; record: MediaAssetRecord; downloadRecord: MediaProviderDownloadRecord; logEntry: AcquisitionLogEntry }
  | { status: "rejected"; reason: AcquisitionRejectionReason; detail: string; logEntry: AcquisitionLogEntry };

/** Consulta estruturada (seção 3) a partir de um item de gap + a entrada de Shot Plan correspondente — sempre orientação vertical (9:16), padrão de todas as produções do Zuno. Continua existindo como o "molde" de campos compartilhados (tema/emoção/ambiente/DNA) para todas as consultas geradas por `buildShotIntentQueryPlan` — nunca mais usada sozinha como ÚNICA consulta enviada ao provider (ver `acquireForShotPlan`). */
export function buildAcquisitionQuery(gapItem: MediaGapItem, shotEntry: MediaShotPlanEntry | undefined, creativeDnaKeywords?: string[]): MediaProviderSearchQuery {
  const textParts = [shotEntry?.subjectLabel, shotEntry?.action, ...(shotEntry?.themes ?? [])].filter((part): part is string => Boolean(part && part.trim().length > 0));
  return {
    text: textParts.length > 0 ? textParts.slice(0, 3).join(" ") : gapItem.description,
    type: "video",
    theme: shotEntry?.themes?.[0],
    action: shotEntry?.action,
    emotion: shotEntry?.emotion,
    scenario: shotEntry?.environment,
    orientation: "portrait",
    minDurationSeconds: shotEntry?.minDurationSeconds ?? 1,
    shotId: gapItem.shotId,
    creativeDnaKeywords,
    device: shotEntry?.device,
    screenVisibleRequired: shotEntry?.screenVisibleRequired,
  };
}

function rejectPreDownload(hit: MediaProviderSearchHit): { reason: AcquisitionRejectionReason; detail: string } | undefined {
  if (!hit.license.allowsCommercialUse) {
    return { reason: "license_missing_or_incompatible", detail: "Licença do candidato não permite uso comercial." };
  }
  return undefined;
}

async function findExactDuplicate(hash: string, catalog: MediaCatalogPort): Promise<MediaAssetRecord | undefined> {
  const assets = await catalog.list();
  return assets.find((asset) => asset.hash === hash);
}

async function findNearDuplicate(perceptualHash: string | undefined, catalog: MediaCatalogPort): Promise<MediaAssetRecord | undefined> {
  if (!perceptualHash) return undefined;
  const assets = await catalog.list();
  return assets.find((asset) => asset.perceptualHash && hammingDistance(asset.perceptualHash, perceptualHash) <= NEAR_DUPLICATE_HAMMING_THRESHOLD);
}

/**
 * Baixa, valida tecnicamente e classifica UM candidato já escolhido. Nunca marca `approvalStatus`
 * como algo diferente de `"needs_review"` — aprovação é sempre humana e explícita (seção 5).
 */
export async function acquireAssetFromHit(input: {
  hit: MediaProviderSearchHit;
  query: MediaProviderSearchQuery;
  providerId: string;
  destinationDir: string;
  catalog: MediaCatalogPort;
  policy?: Partial<AcquisitionPolicy>;
  downloadLimits: DownloadLimits;
  campaign?: string;
  sceneOrder?: number;
  shotId?: string;
  executionId?: string;
  intent?: ShotIntent;
  artifactsDir?: string;
}): Promise<AcquisitionOutcome> {
  const policy = { ...DEFAULT_ACQUISITION_POLICY, ...input.policy };
  const baseLog = (): Omit<AcquisitionLogEntry, "outcome"> => ({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    executionId: input.executionId,
    shotId: input.shotId,
    sceneOrder: input.sceneOrder,
    queryText: input.query.text,
    provider: input.providerId,
    externalId: input.hit.externalId,
    author: input.hit.author,
    licenseName: input.hit.license.name,
    originalUrl: input.hit.downloadUrl,
    originPageUrl: input.hit.originPageUrl,
  });

  const preRejection = rejectPreDownload(input.hit);
  if (preRejection) {
    return { status: "rejected", reason: preRejection.reason, detail: preRejection.detail, logEntry: { ...baseLog(), outcome: "rejected", rejectionReason: preRejection.reason, rejectionDetail: preRejection.detail } };
  }

  // FOOTAGE VISUAL VALIDATION 2.0 (seção 5, checkpoint 1) — Semantic Safety Gate ANTES do
  // download: usa só o slug textual real da própria página de origem (nenhum texto inventado).
  // Bloqueia fantasia/Halloween sempre, e conteúdo religioso quando o Shot em si não é sobre
  // cerimônia — mesmo tipo de erro real já documentado desta saga (busca por tema retornando
  // "padre rezando" para um Shot de "casal usando celular"). `riskFlag` (objeto que mimetiza tela)
  // nunca bloqueia sozinho aqui — só é reaplicado depois da análise visual (checkpoint 2).
  const semanticPreCheck = evaluateSemanticSafetyPreDownload({
    originPageUrl: input.hit.originPageUrl,
    shotContext: input.intent ? { narrativeGoal: input.intent.narrativeGoal, mainAction: input.intent.mainAction, protagonist: input.intent.protagonist } : undefined,
  });
  if (semanticPreCheck.blocked) {
    return {
      status: "rejected",
      reason: "semantic_content_mismatch",
      detail: semanticPreCheck.reason ?? "Bloqueado pelo Semantic Safety Gate.",
      logEntry: {
        ...baseLog(), outcome: "rejected", rejectionReason: "semantic_content_mismatch", rejectionDetail: semanticPreCheck.reason,
        rejectionPattern: "semantic_false_positive",
      },
    };
  }

  // O nome de arquivo é determinístico (provider+externalId) para o mesmo candidato reaparecer
  // como duplicata óbvia entre Shots diferentes na mesma execução. Checar isso ANTES de baixar
  // evita repetir a chamada de rede E evita que o download sobrescreva/apague, na limpeza de
  // rejeição, o arquivo de um asset já aceito e indexado sob esse mesmo nome.
  const fileNameHint = `${input.providerId}-${input.hit.externalId}${extname(new URL(input.hit.downloadUrl).pathname) || ".mp4"}`;
  const alreadyIndexed = (await input.catalog.list()).find((asset) => asset.name === fileNameHint);
  if (alreadyIndexed) {
    const detail = `Candidato (externalId "${input.hit.externalId}") já foi adquirido e indexado nesta execução como "${alreadyIndexed.assetId}" — não baixado novamente.`;
    return { status: "rejected", reason: "duplicate", detail, logEntry: { ...baseLog(), outcome: "rejected", rejectionReason: "duplicate", rejectionDetail: detail } };
  }

  const download = await downloadMediaFile({
    url: input.hit.downloadUrl,
    destinationDir: input.destinationDir,
    fileNameHint,
    limits: input.downloadLimits,
  });
  if (!download.ok) {
    return { status: "rejected", reason: "download_failed", detail: download.reason, logEntry: { ...baseLog(), outcome: "rejected", rejectionReason: "download_failed", rejectionDetail: download.reason } };
  }

  const rejectAndCleanup = async (reason: AcquisitionRejectionReason, detail: string, rejectionPattern?: RejectionPatternCode): Promise<AcquisitionOutcome> => {
    await rm(download.absolutePath, { force: true });
    return { status: "rejected", reason, detail, logEntry: { ...baseLog(), outcome: "rejected", rejectionReason: reason, rejectionDetail: detail, downloadedFilePath: download.absolutePath, rejectionPattern } };
  };

  if (!isVideoExtension(extname(download.absolutePath))) {
    return rejectAndCleanup("unsupported_codec", `Extensão "${extname(download.absolutePath)}" não é um container de vídeo suportado.`);
  }

  let metadata: { width: number; height: number; durationSeconds: number };
  try {
    metadata = await readVideoMetadata(download.absolutePath);
  } catch (error) {
    return rejectAndCleanup("corrupted_file", `Arquivo baixado não é um vídeo válido: ${error instanceof Error ? error.message : String(error)}.`);
  }

  if (metadata.width < policy.minWidth || metadata.height < policy.minHeight) {
    return rejectAndCleanup(metadata.width < 200 || metadata.height < 200 ? "too_small" : "low_resolution", `Resolução ${metadata.width}x${metadata.height} abaixo do mínimo exigido (${policy.minWidth}x${policy.minHeight}).`);
  }
  if (metadata.durationSeconds < policy.minDurationSeconds) {
    return rejectAndCleanup("insufficient_duration", `Duração de ${metadata.durationSeconds.toFixed(2)}s abaixo do mínimo (${policy.minDurationSeconds}s).`);
  }

  const hash = await computeFileHash(download.absolutePath);
  const exactDuplicate = await findExactDuplicate(hash, input.catalog);
  if (exactDuplicate) {
    return rejectAndCleanup("duplicate", `Arquivo idêntico (hash) ao asset já catalogado "${exactDuplicate.assetId}" (${exactDuplicate.relativePath}).`);
  }
  const perceptualHash = await computePerceptualHash(download.absolutePath);
  const nearDuplicate = await findNearDuplicate(perceptualHash, input.catalog);
  if (nearDuplicate) {
    return rejectAndCleanup("near_duplicate", `Quase-duplicata visual do asset já catalogado "${nearDuplicate.assetId}" (${nearDuplicate.relativePath}).`);
  }

  const evidence = await gatherRealFootageEvidence(download.absolutePath, metadata.durationSeconds);
  if (!evidence.hasValidFrames) {
    return rejectAndCleanup("corrupted_file", "Não foi possível extrair frames reais do vídeo baixado (arquivo corrompido ou stream de vídeo inválido).");
  }
  if (!evidence.hasTemporalVariation) {
    return rejectAndCleanup("corrupted_file", `Vídeo sem variação temporal real entre frames (score ${evidence.temporalVariationScore?.toFixed(2)}) — parece congelado ou corrompido, não filmagem real.`);
  }
  if (evidence.looksProceduralByEdgeEnergy) {
    return rejectAndCleanup("incompatible_content", "Assinatura de pixel do vídeo baixado é consistente com conteúdo procedural/sintético, inesperado para um provider de filmagem real — rejeitado por segurança.");
  }

  // FOOTAGE VISUAL VALIDATION 2.0 (seções 1-4) — classificação em estágios sobre MÚLTIPLOS frames
  // (nunca 1-2 frames), exigindo geometria + persistência + variedade de cor + interação, nunca
  // brilho/contraste isolado. Só rejeita automaticamente aqui quando o Shot PEDE dispositivo com
  // tela visível e o resultado é "no_device_detected" (nada plausível encontrado em nenhum frame)
  // — qualquer outro estágio (incluindo `needs_human_review`) é ADQUIRIDO com o estágio real
  // registrado, nunca escondido, para que a fila de revisão humana (seção 8) possa vê-lo.
  const assetId = randomUUID();
  const visualAnalysis = await analyzeVisualCandidate(download.absolutePath, metadata.durationSeconds, metadata.width, metadata.height, {
    device: input.query.device,
    screenVisibleRequired: input.query.screenVisibleRequired,
    interactionRequired: Boolean(input.query.screenVisibleRequired),
  });
  if (input.query.screenVisibleRequired && (!visualAnalysis || visualAnalysis.stage === "no_device_detected")) {
    return rejectAndCleanup(
      "screen_not_visible",
      `Shot exige tela visível, mas a validação visual (${visualAnalysis?.framesAnalyzed ?? 0} frame(s) analisados) não encontrou nenhuma região de dispositivo plausível (screenArea=${visualAnalysis?.screenArea ?? 0}) — provavelmente mostra o verso do aparelho, tela ocluída ou nenhum dispositivo.`,
      "no_screen",
    );
  }

  // Seção 5, checkpoint 2 — combina o risco textual (checkpoint 1, calculado antes do download)
  // com o estágio visual real: só força `needs_human_review` quando os DOIS sinais concordam
  // (título sugere objeto que mimetiza tela + validação visual encontrou algo screen_visible+),
  // nunca rejeita sozinho.
  const semanticPostCheck = visualAnalysis
    ? evaluateSemanticSafetyPostAnalysis({ riskFlag: semanticPreCheck.riskFlag, visualStage: visualAnalysis.stage })
    : { forceHumanReview: false, reason: undefined };
  const analysisForComposition = visualAnalysis && semanticPostCheck.forceHumanReview
    ? { ...visualAnalysis, stage: "needs_human_review" as VisualValidationStage }
    : visualAnalysis;

  const preComposition = await simulatePreComposition({
    analysis: analysisForComposition,
    width: metadata.width,
    height: metadata.height,
    absolutePath: download.absolutePath,
    assetId,
    artifactsDir: input.artifactsDir,
  });
  const finalStage = preComposition.finalStage;
  const screenVisibleFinal = hasReached(finalStage, "screen_visible");
  const compositingReadyFinal = finalStage === "compositing_ready";

  const now = new Date().toISOString();
  const record: MediaAssetRecord = {
    assetId,
    absolutePath: download.absolutePath,
    relativePath: download.absolutePath,
    name: download.absolutePath.split(/[\\/]/).pop() ?? download.absolutePath,
    type: "video",
    format: extname(download.absolutePath).replace(".", ""),
    durationSeconds: metadata.durationSeconds,
    width: metadata.width,
    height: metadata.height,
    aspectRatio: metadata.height >= metadata.width ? "9:16" : "16:9",
    sizeBytes: download.sizeBytes,
    hash,
    perceptualHash,
    indexedAt: now,
    origin: "external_provider",
    author: input.hit.author,
    license: input.hit.license,
    licenseStatus: "known",
    sourceUrl: input.hit.originPageUrl,
    campaign: input.campaign,
    themes: input.query.theme ? [input.query.theme] : [],
    people: [],
    actions: input.query.action ? [input.query.action] : [],
    objects: [],
    location: input.query.scenario,
    emotion: input.query.emotion,
    tags: [input.query.text].filter(Boolean),
    // Justificado por: provider curado de filmagem real (não banco de gráficos procedurais) +
    // validação técnica real (múltiplos frames, variação temporal, energia de borda não-procedural)
    // — evidência registrada explicitamente, nunca uma alegação sem prova (seção 7).
    footageClassification: "filmed_footage",
    scores: {},
    approvalStatus: "needs_review",
    usageHistory: [],
    duplicate: {},
    available: true,
    notes: [
      `Evidência de filmagem real: variação temporal=${evidence.temporalVariationScore?.toFixed(2)}, energia de borda=${evidence.edgeEnergy?.toFixed(2)}.`,
      `Adquirido via ${input.providerId} em ${now} — consulta: "${input.query.text}".`,
      `Validação visual em estágios (FOOTAGE VISUAL VALIDATION 2.0, heurística, não detecção de objeto real): estágio="${finalStage}", screenArea=${visualAnalysis?.screenArea ?? "n/d"}, colorVarietyScore=${visualAnalysis?.colorVarietyScore ?? "n/d"}, persistenceRatio=${visualAnalysis?.persistenceRatio ?? "n/d"}, humanInteractionScore=${visualAnalysis?.humanInteractionScore ?? "n/d"}, humanPresenceScore=${visualAnalysis?.humanPresenceScore ?? "n/d"}, occlusionRisk=${visualAnalysis?.occlusionRisk ?? "n/d"}.`,
      visualAnalysis && visualAnalysis.rejectionReasons.length > 0 ? `Sinais de risco (não bloqueiam sozinhos, cada um cobra evidência adicional): ${visualAnalysis.rejectionReasons.join(", ")}.` : undefined,
      semanticPreCheck.riskFlag ? `Semantic Safety Gate: título sugere objeto que mimetiza tela ("${semanticPreCheck.matchedKeyword ?? "?"}") — ${semanticPostCheck.forceHumanReview ? "combinado com detecção visual positiva, forçou needs_human_review." : "sem detecção visual positiva o suficiente para combinar, não alterou o estágio."}` : undefined,
      `Pré-composição: ${preComposition.verdict} — ${preComposition.justification}`,
    ].filter((note): note is string => Boolean(note)),
    screenVisible: screenVisibleFinal,
    screenArea: visualAnalysis?.screenArea,
    deviceOrientation: visualAnalysis?.deviceOrientation,
    deviceType: input.query.device,
    interactionPossible: compositingReadyFinal,
    compositingReady: compositingReadyFinal,
    humanInteractionScore: visualAnalysis?.humanInteractionScore,
    productIntegrationScore: visualAnalysis
      ? Math.round(((visualAnalysis.screenArea > 0 ? Math.min(1, visualAnalysis.screenArea / 0.15) : 0) * 0.5 + visualAnalysis.humanInteractionScore * 0.3 + (visualAnalysis.resolutionSufficient ? 0.2 : 0)) * 1000) / 1000
      : undefined,
    visualValidationStage: finalStage,
    deviceConfidence: visualAnalysis?.deviceConfidence,
    screenConfidence: visualAnalysis?.screenConfidence,
    humanPresenceScore: visualAnalysis?.humanPresenceScore,
    persistenceRatio: visualAnalysis?.persistenceRatio,
    occlusionRisk: visualAnalysis?.occlusionRisk,
    reviewArtifacts: preComposition.artifacts,
  };

  const downloadRecord: MediaProviderDownloadRecord = {
    provider: input.providerId,
    externalId: input.hit.externalId,
    author: input.hit.author,
    originPageUrl: input.hit.originPageUrl,
    license: input.hit.license,
    downloadedAt: now,
    queryUsed: input.query.text,
    originalFileUrl: input.hit.downloadUrl,
    downloadedFilePath: download.absolutePath,
    campaign: input.campaign,
    sceneOrder: input.sceneOrder,
    shotId: input.shotId,
  };

  return {
    status: "acquired",
    record,
    downloadRecord,
    logEntry: { ...baseLog(), outcome: "acquired", assetId: record.assetId, downloadedFilePath: download.absolutePath, visualValidationStage: finalStage },
  };
}

export type ShotQuerySearchReport = {
  shotId?: string;
  sceneOrder?: number;
  intent: ShotIntent;
  positiveQueries: string[];
  negativePatterns: string[];
  discardedQueries: Array<{ query: string; reason: string }>;
  resultsPerQuery: Record<string, number>;
  candidatesConsidered: number;
  chosenAssetId?: string;
  chosenReason?: string;
};

export type AcquisitionRunReport = {
  executionId?: string;
  searched: number;
  downloaded: number;
  acquired: number;
  rejected: number;
  rejectionsByReason: Record<string, number>;
  authors: string[];
  licenses: string[];
  shotAssignments: Array<{ shotId?: string; sceneOrder?: number; assetId: string; author?: string }>;
  fallbackNeeded: MediaGapItem[];
  logEntries: AcquisitionLogEntry[];
  /** INTENT-BASED FOOTAGE ACQUISITION — uma entrada por Shot processado, consumida por `--footage-search-report`. */
  queryReports: ShotQuerySearchReport[];
};

// Ranqueamento por Shot Intent (aderência ao Shot antes de tema) substituiu o antigo
// `rankCandidates` (só retrato/resolução/diversidade de autor) — ver `rankCandidatesByShotIntent`
// em `src/infrastructure/footage-acquisition/shot-intent-requirements.ts`.

/**
 * Orquestra a aquisição automática para TODOS os gaps obrigatórios de um Media Gap Analysis
 * (seção 4). Nunca renderiza nada, nunca decide Production Readiness sozinho — só busca, baixa,
 * valida, classifica e indexa; quem recalcula o Production Readiness é o chamador (CLI), com o
 * catálogo já atualizado.
 */
export async function acquireForShotPlan(input: {
  gapAnalysis: MediaGapAnalysisResult;
  shotPlan: MediaShotPlanEntry[];
  provider: MediaProviderPort;
  catalog: MediaCatalogPort;
  destinationDir: string;
  policy?: Partial<AcquisitionPolicy>;
  downloadLimits: DownloadLimits;
  campaign?: string;
  executionId?: string;
  creativeDnaKeywords?: string[];
  /** FOOTAGE VISUAL VALIDATION 2.0 (seção 9) — histórico de rejeições de execuções anteriores (lido pelo caller a partir do log de aquisição já existente). Combinado com as rejeições DESTA execução conforme elas acontecem, para que Shots processados depois já se beneficiem do aprendizado dos Shots processados antes, na mesma execução. */
  pastRejectionHistory?: RejectionHistoryEntry[];
  /** FOOTAGE VISUAL VALIDATION 2.0 (seção 7) — diretório onde o Pre-composition Simulator salva os artefatos de revisão (frame anotado + zoom). Sem isto, a simulação ainda roda normalmente, só não gera os arquivos de imagem. */
  artifactsDir?: string;
}): Promise<AcquisitionRunReport> {
  const policy = { ...DEFAULT_ACQUISITION_POLICY, ...input.policy };
  const shotById = new Map(input.shotPlan.map((entry) => [entry.shotId, entry]));
  const mandatoryGaps = [...input.gapAnalysis.itemsMissing, ...input.gapAnalysis.itemsSubstitute].filter((item) => item.priority === "obrigatorio");
  const rejectionHistory: RejectionHistoryEntry[] = [...(input.pastRejectionHistory ?? [])];

  const report: AcquisitionRunReport = {
    executionId: input.executionId,
    searched: 0,
    downloaded: 0,
    acquired: 0,
    rejected: 0,
    rejectionsByReason: {},
    authors: [],
    licenses: [],
    shotAssignments: [],
    fallbackNeeded: [],
    logEntries: [],
    queryReports: [],
  };

  const usedAuthors = new Set<string>();
  let totalDownloads = 0;

  for (const gapItem of mandatoryGaps) {
    if (totalDownloads >= policy.maxDownloadsPerRun) {
      report.fallbackNeeded.push(gapItem);
      continue;
    }
    const shotEntry = gapItem.shotId ? shotById.get(gapItem.shotId) : undefined;
    const query = buildAcquisitionQuery(gapItem, shotEntry, input.creativeDnaKeywords);

    // INTENT-BASED FOOTAGE ACQUISITION — a menor unidade de busca passa a ser o Shot Intent, nunca
    // mais uma única consulta por tema. Gera várias consultas específicas, busca cada uma, funde
    // os candidatos (dedup por externalId) e ranqueia por aderência ao Shot antes de tema.
    const intent = deriveShotIntent(shotEntry ?? { sceneOrder: gapItem.sceneOrder ?? 0, desiredType: "video", themes: [] }, gapItem.description);
    const queryPlan: ShotIntentQueryPlan = buildShotIntentQueryPlan(intent);
    const resultsPerQuery: Record<string, number> = {};
    const hitsByExternalId = new Map<string, MediaProviderSearchHit>();
    let searchFailed: { error: unknown } | undefined;

    for (const positiveQuery of queryPlan.positiveQueries) {
      try {
        const hits = await input.provider.search({ ...query, text: positiveQuery, limit: policy.maxCandidatesPerShot });
        report.searched += 1;
        resultsPerQuery[positiveQuery] = hits.length;
        for (const hit of hits) hitsByExternalId.set(hit.externalId, hit);
      } catch (error) {
        resultsPerQuery[positiveQuery] = 0;
        searchFailed = { error };
      }
    }

    const shotQueryReport: ShotQuerySearchReport = {
      shotId: gapItem.shotId,
      sceneOrder: gapItem.sceneOrder,
      intent,
      positiveQueries: queryPlan.positiveQueries,
      negativePatterns: queryPlan.negativePatterns,
      discardedQueries: queryPlan.discardedQueries,
      resultsPerQuery,
      candidatesConsidered: hitsByExternalId.size,
    };
    report.queryReports.push(shotQueryReport);

    if (hitsByExternalId.size === 0) {
      report.fallbackNeeded.push(gapItem);
      if (searchFailed) {
        report.logEntries.push({
          id: randomUUID(), timestamp: new Date().toISOString(), executionId: input.executionId,
          shotId: gapItem.shotId, sceneOrder: gapItem.sceneOrder, queryText: query.text, provider: input.provider.providerId,
          outcome: "rejected", rejectionReason: "download_failed", rejectionDetail: searchFailed.error instanceof Error ? searchFailed.error.message : String(searchFailed.error),
        });
      }
      continue;
    }

    const ranked = rankCandidatesByShotIntent([...hitsByExternalId.values()], intent, usedAuthors, rejectionHistory)
      .slice(0, policy.maxCandidatesPerShot)
      .map((scored) => scored.hit);
    let acquiredForThisShot = false;

    for (const hit of ranked) {
      if (totalDownloads >= policy.maxDownloadsPerRun) break;
      totalDownloads += 1;
      report.downloaded += 1;

      const outcome = await acquireAssetFromHit({
        hit, query, providerId: input.provider.providerId, destinationDir: input.destinationDir,
        catalog: input.catalog, policy, downloadLimits: input.downloadLimits, campaign: input.campaign,
        sceneOrder: gapItem.sceneOrder, shotId: gapItem.shotId, executionId: input.executionId,
        intent, artifactsDir: input.artifactsDir,
      });
      report.logEntries.push(outcome.logEntry);

      if (outcome.status === "rejected") {
        report.rejected += 1;
        report.rejectionsByReason[outcome.reason] = (report.rejectionsByReason[outcome.reason] ?? 0) + 1;
        // Seção 9 — só entra no histórico de aprendizado quando a rejeição teve um padrão
        // auditável (não licença/duplicata, que não dizem nada sobre conteúdo visual/semântico).
        if (outcome.logEntry.rejectionPattern) {
          rejectionHistory.push({ author: hit.author, originPageUrl: hit.originPageUrl, rejectionPattern: outcome.logEntry.rejectionPattern });
        }
        continue;
      }

      await input.catalog.indexAcquiredAsset(outcome.record);
      report.acquired += 1;
      if (outcome.record.author) { usedAuthors.add(outcome.record.author); report.authors.push(outcome.record.author); }
      report.licenses.push(outcome.record.license?.name ?? "desconhecida");
      report.shotAssignments.push({ shotId: gapItem.shotId, sceneOrder: gapItem.sceneOrder, assetId: outcome.record.assetId, author: outcome.record.author });
      shotQueryReport.chosenAssetId = outcome.record.assetId;
      shotQueryReport.chosenReason = `estágio=${outcome.record.visualValidationStage ?? "n/d"}, screenVisible=${outcome.record.screenVisible ?? "n/d"}, compositingReady=${outcome.record.compositingReady ?? "n/d"}, melhor pontuação de aderência ao Shot entre ${ranked.length} candidato(s) ranqueado(s).`;
      acquiredForThisShot = true;
      break;
    }

    if (!acquiredForThisShot) report.fallbackNeeded.push(gapItem);
  }

  return report;
}
