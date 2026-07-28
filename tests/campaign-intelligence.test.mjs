import test from "node:test";
import assert from "node:assert/strict";
import { classifyCampaignScreen } from "../dist/shared/utils/campaign-intelligence/campaign-screen-classification.js";
import { tierForOrigin, tierLabel, rankBySourcePriority, pickHighestPriority } from "../dist/shared/utils/campaign-intelligence/source-priority.js";
import { findReusableMaterial, formatTimestamp } from "../dist/shared/utils/campaign-intelligence/reuse-engine.js";
import { searchFrames, buildTimelineIndex } from "../dist/shared/utils/campaign-intelligence/frame-search.js";
import { buildCampaignQualityReport } from "../dist/shared/utils/campaign-intelligence/campaign-quality-report.js";
import { campaignScreenToCapturedScreen, campaignMediaItemToMediaLibraryItem } from "../dist/shared/utils/campaign-intelligence/graph-adapters.js";
import { documentAnalysisToExtractedContent, imageAnalysisToExtractedContent, videoAnalysisToExtractedContent } from "../dist/shared/utils/campaign-intelligence/to-extracted-content.js";
import { detectFileKind } from "../dist/infrastructure/campaign-intelligence/file-kind.js";

// ---------------------------------------------------------------------------------------------
// screen classification
// ---------------------------------------------------------------------------------------------

test("classifyCampaignScreen reconhece categorias por texto OCR livre, não por URL", () => {
  assert.equal(classifyCampaignScreen("Confirmar Presença - RSVP do casamento"), "rsvp");
  assert.equal(classifyCampaignScreen("Lista de presentes via PIX"), "gift_list");
  assert.equal(classifyCampaignScreen("Consultar mesa do convidado"), "table_lookup");
  assert.equal(classifyCampaignScreen("Página Inicial do site"), "home");
  assert.equal(classifyCampaignScreen("texto qualquer sem categoria conhecida"), "unknown");
});

// ---------------------------------------------------------------------------------------------
// source priority
// ---------------------------------------------------------------------------------------------

test("tierForOrigin/tierLabel refletem a ordem fixa de prioridade (seção 10)", () => {
  assert.equal(tierForOrigin("campaign_upload"), 1);
  assert.equal(tierForOrigin("generic_content"), 7);
  assert.equal(tierLabel(1), "Arquivos enviados para esta campanha");
  assert.equal(tierLabel(7), "Conteúdo genérico");
});

test("rankBySourcePriority/pickHighestPriority nunca preferem um mockup a material oficial", () => {
  const items = [{ id: "stock", tier: 6 }, { id: "upload", tier: 1 }, { id: "company", tier: 3 }];
  const ranked = rankBySourcePriority(items, (item) => item.tier);
  assert.deepEqual(ranked.map((item) => item.id), ["upload", "company", "stock"]);
  assert.equal(pickHighestPriority(items, (item) => item.tier).id, "upload");
});

// ---------------------------------------------------------------------------------------------
// reuse engine
// ---------------------------------------------------------------------------------------------

function feature(overrides = {}) {
  return { id: "rsvp", name: "RSVP", description: "RSVP", benefit: "", painPointSolved: "", category: "product", keywords: ["rsvp"], relatedScreenIds: [], ...overrides };
}

test("findReusableMaterial encontra tela oficial já existente e nunca sugere gerar de novo", () => {
  const screen = { id: "screen-1", campaignId: "c1", category: "rsvp", sourceFileId: "file-1", sourceType: "image", imagePath: "x.png", relatedFeatureIds: ["rsvp"], capturedAt: "2026-01-01" };
  const result = findReusableMaterial({ query: "RSVP", features: [feature({ relatedScreenIds: ["screen-1"] })], screens: [screen], videoAnalyses: [] });
  assert.equal(result.found, true);
  assert.equal(result.kind, "screen");
  assert.equal(result.screen.id, "screen-1");
});

test("findReusableMaterial encontra vídeo oficial mostrando a funcionalidade, no exemplo literal da especificação", () => {
  const video = {
    fileId: "video-1", durationSeconds: 200, scenes: [], quality: "high", transcript: undefined,
    frames: [{ timestampSeconds: 92, framePath: "frame-92.png", sceneIndex: 0, ocrText: "RSVP" }],
    timeline: [{ timestampSeconds: 92, label: "rsvp", kind: "screen", confidence: 0.8 }],
  };
  const result = findReusableMaterial({ query: "rsvp", features: [], screens: [], videoAnalyses: [video] });
  assert.equal(result.found, true);
  assert.equal(result.kind, "video_frame");
  assert.equal(result.frame.timestampSeconds, 92);
});

test("findReusableMaterial responde honestamente quando nada existe (geração pode prosseguir)", () => {
  const result = findReusableMaterial({ query: "funcionalidade inexistente", features: [], screens: [], videoAnalyses: [] });
  assert.equal(result.found, false);
});

test("formatTimestamp formata segundos totais em HH:MM:SS", () => {
  assert.equal(formatTimestamp(92), "00:01:32");
  assert.equal(formatTimestamp(3725), "01:02:05");
});

// ---------------------------------------------------------------------------------------------
// frame search / timeline index
// ---------------------------------------------------------------------------------------------

test("searchFrames responde 'Mostrar tela de Check-in' e 'Mostrar trecho onde aparece RSVP'", () => {
  const screens = [{ id: "screen-1", campaignId: "c1", category: "guest_area", sourceFileId: "file-1", sourceType: "image", imagePath: "checkin.png", relatedFeatureIds: [], capturedAt: "2026-01-01" }];
  const video = {
    fileId: "video-1", durationSeconds: 200, scenes: [], quality: "high", transcript: undefined,
    frames: [{ timestampSeconds: 92, framePath: "frame-92.png", sceneIndex: 0, ocrText: "RSVP" }],
    timeline: [{ timestampSeconds: 92, label: "rsvp", kind: "screen", confidence: 0.8 }],
  };
  const checkinResults = searchFrames({ query: "check-in", screens, videoAnalyses: [], imageAnalyses: [] });
  assert.equal(checkinResults.length, 1);
  assert.equal(checkinResults[0].kind, "screen");

  const rsvpResults = searchFrames({ query: "rsvp", screens: [], videoAnalyses: [video], imageAnalyses: [] });
  assert.equal(rsvpResults.length, 1);
  assert.equal(rsvpResults[0].kind, "video_timestamp");
  assert.equal(rsvpResults[0].timestampSeconds, 92);
});

test("buildTimelineIndex devolve o índice temporal em ordem cronológica com timestamp formatado", () => {
  const video = {
    fileId: "video-1", durationSeconds: 200, scenes: [], quality: "high", transcript: undefined, frames: [],
    timeline: [
      { timestampSeconds: 198, label: "album", kind: "screen", confidence: 0.8 },
      { timestampSeconds: 12, label: "home", kind: "screen", confidence: 0.6 },
    ],
  };
  const index = buildTimelineIndex(video);
  assert.deepEqual(index.map((entry) => entry.label), ["home", "album"]);
  assert.equal(index[0].timestamp, "00:00:12");
});

// ---------------------------------------------------------------------------------------------
// quality report
// ---------------------------------------------------------------------------------------------

test("buildCampaignQualityReport soma contagens reais e reporta pendências honestas", () => {
  const files = [
    { id: "f1", campaignId: "c1", originalFileName: "a.png", absolutePath: "a.png", kind: "photo", extension: ".png", sizeBytes: 10, hash: "h1", uploadedAt: "2026-01-01", status: "processed", processingNotes: [] },
    { id: "f2", campaignId: "c1", originalFileName: "b.pdf", absolutePath: "b.pdf", kind: "pdf", extension: ".pdf", sizeBytes: 10, hash: "h2", uploadedAt: "2026-01-01", status: "unsupported", processingNotes: ["motivo"] },
  ];
  const features = [feature({ relatedScreenIds: [] })];
  const report = buildCampaignQualityReport({
    campaignId: "c1", files, videoAnalyses: [], documentAnalyses: [], screens: [], features, mediaLibrary: [],
    ocrCharacterCounts: [100, 50], duplicateFileCount: 2,
  });
  assert.equal(report.filesIngested, 2);
  assert.equal(report.processedFiles, 1);
  assert.equal(report.ocrCharactersExtracted, 150);
  assert.equal(report.duplicateFiles, 2);
  assert.ok(report.pendingItems.some((item) => item.includes("não processado")));
  assert.ok(report.pendingItems.some((item) => item.includes("sem tela relacionada")));
  assert.ok(report.pendingItems.some((item) => item.includes("duplicado")));
});

// ---------------------------------------------------------------------------------------------
// graph adapters / extracted-content mappers (reuso do Company Intelligence)
// ---------------------------------------------------------------------------------------------

test("campaignScreenToCapturedScreen produz o formato exato que buildKnowledgeGraph do Company Intelligence espera", () => {
  const screen = { id: "screen-1", campaignId: "c1", category: "rsvp", sourceFileId: "file-1", sourceType: "image", imagePath: "x.png", relatedFeatureIds: [], capturedAt: "2026-01-01" };
  const captured = campaignScreenToCapturedScreen(screen);
  assert.equal(captured.id, "screen-1");
  assert.equal(captured.category, "rsvp");
  assert.equal(captured.absolutePath, "x.png");
});

test("campaignMediaItemToMediaLibraryItem reusa MediaLibraryItem do Company Intelligence e nunca perde a categoria document/audio silenciosamente (cai em image)", () => {
  const item = { id: "media-1", campaignId: "c1", origin: "manual.pdf", type: "pdf", description: "doc", category: "document", tags: [], confidence: 0.8, license: "campaign_upload", hash: "h", quality: "medium", originalFilePath: "manual.pdf", derivedFilePaths: [], sourcePriorityTier: 1 };
  const mapped = campaignMediaItemToMediaLibraryItem(item, ["rsvp"]);
  assert.equal(mapped.category, "image");
  assert.deepEqual(mapped.relatedFeatureIds, ["rsvp"]);
});

test("documentAnalysisToExtractedContent/imageAnalysisToExtractedContent/videoAnalysisToExtractedContent produzem o formato que discoverFeatures do Company Intelligence espera", () => {
  const doc = documentAnalysisToExtractedContent({ fileId: "f1", text: "x", headlines: ["RSVP"], paragraphs: ["Confirme presença sem burocracia."], lists: [["Item"]], tables: [] });
  assert.deepEqual(doc.features, ["RSVP", "Item"]);
  assert.deepEqual(doc.benefits, ["Confirme presença sem burocracia."]);

  const image = imageAnalysisToExtractedContent({ fileId: "f2", ocrText: "Confirmar", detectedTexts: ["Confirmar"], dominantColors: [], hasInterfaceElements: true, buttons: ["Confirmar"], category: "screen_capture", quality: "high", width: 100, height: 100, aspectRatio: "1:1", tags: [] });
  assert.deepEqual(image.features, ["Confirmar"]);

  const video = videoAnalysisToExtractedContent({ fileId: "f3", durationSeconds: 10, scenes: [], frames: [{ timestampSeconds: 1, framePath: "a.png", sceneIndex: 0, ocrText: "RSVP" }], timeline: [{ timestampSeconds: 1, label: "rsvp", kind: "screen", confidence: 0.7 }], transcript: undefined, quality: "high" });
  assert.deepEqual(video.features, ["rsvp"]);
});

// ---------------------------------------------------------------------------------------------
// file kind routing
// ---------------------------------------------------------------------------------------------

test("detectFileKind roteia cada extensão aceita para o pipeline correto (seção 2)", () => {
  assert.equal(detectFileKind(".png"), "photo");
  assert.equal(detectFileKind(".mp4"), "video");
  assert.equal(detectFileKind(".pdf"), "pdf");
  assert.equal(detectFileKind(".pptx"), "ppt");
  assert.equal(detectFileKind(".docx"), "docx");
  assert.equal(detectFileKind(".xlsx"), "xlsx");
  assert.equal(detectFileKind(".svg"), "svg");
  assert.equal(detectFileKind(".mp3"), "audio");
  assert.equal(detectFileKind(".zip"), "zip");
  assert.equal(detectFileKind(".exe"), "unsupported");
});
