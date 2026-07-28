import type {
  CampaignFile,
  CampaignMediaItem,
  CampaignQualityReport,
  CampaignScreen,
  DocumentAnalysis,
  Feature,
  VideoAnalysis,
} from "../../../domain/campaign-intelligence/campaign-intelligence.model.js";

/** Relatório de qualidade da ingestão (seção 15) — cada campo é uma contagem/soma real sobre o Workspace, nunca um valor estimado sem base. */
export function buildCampaignQualityReport(input: {
  campaignId: string;
  files: CampaignFile[];
  videoAnalyses: VideoAnalysis[];
  documentAnalyses: DocumentAnalysis[];
  screens: CampaignScreen[];
  features: Feature[];
  mediaLibrary: CampaignMediaItem[];
  ocrCharacterCounts: number[];
  duplicateFileCount: number;
}): CampaignQualityReport {
  const byKind: Record<string, number> = {};
  for (const file of input.files) byKind[file.kind] = (byKind[file.kind] ?? 0) + 1;

  const featuresWithScreens = input.features.filter((feature) => feature.relatedScreenIds.length > 0).length;
  const coverageScore = input.features.length > 0 ? Math.round((featuresWithScreens / input.features.length) * 100) : 0;

  const averageConfidence = input.mediaLibrary.length > 0
    ? Number((input.mediaLibrary.reduce((sum, item) => sum + item.confidence, 0) / input.mediaLibrary.length).toFixed(2))
    : 0;

  const reusableAssets = input.mediaLibrary.filter((item) => item.sourcePriorityTier <= 3).length;

  const pendingItems: string[] = [];
  const processedFiles = input.files.filter((file) => file.status === "processed").length;
  const failedFiles = input.files.filter((file) => file.status === "failed" || file.status === "unsupported").length;
  if (failedFiles > 0) pendingItems.push(`${failedFiles} arquivo(s) não processado(s) (formato não suportado ou falha de leitura).`);
  if (featuresWithScreens < input.features.length) pendingItems.push(`${input.features.length - featuresWithScreens} de ${input.features.length} funcionalidades ainda sem tela relacionada.`);
  if (input.duplicateFileCount > 0) pendingItems.push(`${input.duplicateFileCount} arquivo(s) duplicado(s) detectado(s) (mesmo hash).`);
  if (input.videoAnalyses.some((analysis) => !analysis.transcript)) pendingItems.push("Nenhum vídeo teve narração transcrita (sem motor de reconhecimento de fala local disponível nesta sprint).");

  return {
    campaignId: input.campaignId,
    generatedAt: new Date().toISOString(),
    filesIngested: input.files.length,
    processedFiles,
    byKind,
    featuresFound: input.features.length,
    screensFound: input.screens.length,
    videosProcessed: input.videoAnalyses.length,
    framesExtracted: input.videoAnalyses.reduce((sum, analysis) => sum + analysis.frames.length, 0),
    documentsProcessed: input.documentAnalyses.length,
    ocrCharactersExtracted: input.ocrCharacterCounts.reduce((sum, count) => sum + count, 0),
    assetsCollected: input.mediaLibrary.length,
    coverageScore,
    averageConfidence,
    duplicateFiles: input.duplicateFileCount,
    reusableAssets,
    pendingItems,
  };
}
