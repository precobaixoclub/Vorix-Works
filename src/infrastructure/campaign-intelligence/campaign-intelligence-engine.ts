import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { CampaignWorkspaceRepositoryPort } from "../../application/campaign-intelligence/campaign-workspace-repository.port.js";
import type {
  CampaignFile,
  CampaignMediaItem,
  CampaignMediaItemCategory,
  CampaignScreen,
  CampaignWorkspace,
  DocumentAnalysis,
  Feature,
  ImageAnalysis,
  ScreenCategory,
  VideoAnalysis,
} from "../../domain/campaign-intelligence/campaign-intelligence.model.js";
import { computeFileHash } from "../media-catalog/media-hash.js";
import { discoverFeatures } from "../../shared/utils/company-intelligence/feature-discovery.js";
import { buildKnowledgeGraph } from "../../shared/utils/company-intelligence/knowledge-graph-builder.js";
import { classifyCampaignScreen } from "../../shared/utils/campaign-intelligence/campaign-screen-classification.js";
import { buildCampaignQualityReport } from "../../shared/utils/campaign-intelligence/campaign-quality-report.js";
import { campaignMediaItemToMediaLibraryItem, campaignScreenToCapturedScreen } from "../../shared/utils/campaign-intelligence/graph-adapters.js";
import { documentAnalysisToExtractedContent, imageAnalysisToExtractedContent, videoAnalysisToExtractedContent } from "../../shared/utils/campaign-intelligence/to-extracted-content.js";
import { detectFileKind } from "./file-kind.js";
import { analyzeImage } from "./image-understanding.js";
import { analyzeVideo } from "./video-understanding.js";
import { analyzeDocx, analyzePdf, analyzePptx, analyzeXlsx } from "./document-understanding.js";
import { shutdownOcrWorker } from "./ocr.js";

/**
 * Campaign Intelligence Engine — orquestra ingestão multimodal → análise → classificação → Media
 * Knowledge Graph → Campaign Media Library, e persiste via a porta injetada. Mesmo raciocínio de
 * `CompanyIntelligenceEngine`: fica em `infrastructure/` porque sua responsabilidade central é
 * I/O (disco + processos ffmpeg/tesseract), com persistência abstraída atrás de uma porta.
 *
 * Reaproveita deliberadamente `discoverFeatures`/`buildKnowledgeGraph` do Company Intelligence
 * (nunca reescritos aqui) — cada arquivo de campanha vira um `ExtractedContent`/`CapturedScreen`
 * no mesmo formato que aquele motor já sabe processar (ver `to-extracted-content.ts`/`graph-adapters.ts`).
 *
 * `ingest()` é incremental por hash: reingestar os mesmos arquivos (ou um ZIP que os contenha)
 * nunca reprocessa o que já existe no Workspace — só acrescenta o que é genuinamente novo.
 */

export type CampaignIntelligenceEngineDependencies = {
  repository: CampaignWorkspaceRepositoryPort;
  uploadsDir: string;
  framesDir: string;
};

export type IngestResult = { workspace: CampaignWorkspace; newFilesProcessed: number; duplicatesSkipped: number };

type QueueEntry = { absolutePath: string; originalFileName: string };

export class CampaignIntelligenceEngine {
  private readonly repository: CampaignWorkspaceRepositoryPort;
  private readonly uploadsDir: string;
  private readonly framesDir: string;

  constructor(deps: CampaignIntelligenceEngineDependencies) {
    this.repository = deps.repository;
    this.uploadsDir = deps.uploadsDir;
    this.framesDir = deps.framesDir;
  }

  async ingest(campaignId: string, inputFilePaths: string[]): Promise<IngestResult> {
    const existing = await this.repository.findByCampaignId(campaignId);
    const campaignUploadsDir = join(this.uploadsDir, campaignId);
    const campaignFramesDir = join(this.framesDir, campaignId);
    await mkdir(campaignUploadsDir, { recursive: true });

    const files: CampaignFile[] = existing ? [...existing.files] : [];
    const imageAnalyses: ImageAnalysis[] = existing ? [...existing.imageAnalyses] : [];
    const videoAnalyses: VideoAnalysis[] = existing ? [...existing.videoAnalyses] : [];
    const documentAnalyses: DocumentAnalysis[] = existing ? [...existing.documentAnalyses] : [];

    const existingHashes = new Set(files.map((file) => file.hash));
    let duplicatesSkipped = 0;
    let newFilesProcessed = 0;

    const queue: QueueEntry[] = inputFilePaths.map((path) => ({ absolutePath: path, originalFileName: basename(path) }));

    while (queue.length > 0) {
      const next = queue.shift()!;
      const extension = extname(next.originalFileName);
      const kind = detectFileKind(extension);
      const hash = await computeFileHash(next.absolutePath).catch(() => randomUUID());

      if (existingHashes.has(hash)) {
        duplicatesSkipped += 1;
        continue;
      }
      existingHashes.add(hash);

      const fileId = `file-${randomUUID().slice(0, 8)}`;
      const storedPath = join(campaignUploadsDir, `${fileId}${extension}`);
      await copyFile(next.absolutePath, storedPath).catch(() => {});
      const sizeBytes = await stat(storedPath).then((info) => info.size).catch(() => 0);

      const file: CampaignFile = {
        id: fileId, campaignId, originalFileName: next.originalFileName, absolutePath: storedPath,
        kind, extension, sizeBytes, hash, uploadedAt: new Date().toISOString(), status: "pending", processingNotes: [],
      };

      if (kind === "zip") {
        try {
          const zip = new AdmZip(storedPath);
          const extractDir = join(campaignUploadsDir, `${fileId}-extracted`);
          zip.extractAllTo(extractDir, true);
          const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
          for (const entry of entries) queue.push({ absolutePath: join(extractDir, entry.entryName), originalFileName: basename(entry.entryName) });
          file.status = "processed";
          file.processingNotes.push(`ZIP extraído: ${entries.length} arquivo(s) enfileirado(s) para ingestão.`);
        } catch (error) {
          file.status = "failed";
          file.processingNotes.push(`Falha ao extrair ZIP: ${(error as Error).message}`);
        }
        files.push(file);
        newFilesProcessed += 1;
        continue;
      }

      try {
        if (kind === "photo" || kind === "svg") {
          imageAnalyses.push(await analyzeImage(file));
          file.status = "processed";
        } else if (kind === "video") {
          videoAnalyses.push(await analyzeVideo(file, { outputDir: campaignFramesDir }));
          file.status = "processed";
        } else if (kind === "pdf") {
          documentAnalyses.push(await analyzePdf(file));
          file.status = "processed";
        } else if (kind === "ppt") {
          documentAnalyses.push(await analyzePptx(file));
          file.status = "processed";
        } else if (kind === "docx") {
          documentAnalyses.push(await analyzeDocx(file));
          file.status = "processed";
        } else if (kind === "xlsx") {
          documentAnalyses.push(await analyzeXlsx(file));
          file.status = "processed";
        } else if (kind === "audio") {
          file.status = "processed";
          file.processingNotes.push("Áudio armazenado, sem transcrição (nenhum motor de reconhecimento de fala local disponível nesta sprint).");
        } else {
          file.status = "unsupported";
          file.processingNotes.push(`Extensão "${extension}" não tem pipeline dedicado nesta sprint.`);
        }
      } catch (error) {
        file.status = "failed";
        file.processingNotes.push((error as Error).message);
      }

      files.push(file);
      newFilesProcessed += 1;
    }

    await shutdownOcrWorker();

    const screens = buildScreens(existing?.screens ?? [], files, imageAnalyses, videoAnalyses);

    const extractedContents = [
      ...documentAnalyses.map(documentAnalysisToExtractedContent),
      ...imageAnalyses.map(imageAnalysisToExtractedContent),
      ...videoAnalyses.map(videoAnalysisToExtractedContent),
    ];
    const capturedScreens = screens.map(campaignScreenToCapturedScreen);
    const features = discoverFeatures(extractedContents, capturedScreens);
    backfillRelatedFeatures(screens, features);

    const mediaLibrary = files
      .filter((file) => file.status === "processed" && file.kind !== "zip")
      .map((file) => buildMediaItem(file, imageAnalyses, videoAnalyses, documentAnalyses, campaignId));

    const graph = buildKnowledgeGraph({
      features,
      screens: capturedScreens,
      mediaLibrary: mediaLibrary.map((item) => campaignMediaItemToMediaLibraryItem(item, relatedFeatureIdsFor(item, files, features))),
      pages: [],
      ctas: [],
      targetAudience: undefined,
    });

    const qualityReport = buildCampaignQualityReport({
      campaignId, files, videoAnalyses, documentAnalyses, screens, features, mediaLibrary,
      ocrCharacterCounts: [
        ...imageAnalyses.map((analysis) => analysis.ocrText.length),
        ...videoAnalyses.flatMap((analysis) => analysis.frames.map((frame) => frame.ocrText.length)),
      ],
      duplicateFileCount: duplicatesSkipped,
    });

    const workspace: CampaignWorkspace = {
      campaignId, files, imageAnalyses, videoAnalyses, documentAnalyses, screens, features, mediaLibrary, graph, qualityReport,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.repository.save(workspace);
    return { workspace, newFilesProcessed, duplicatesSkipped };
  }

  async get(campaignId: string): Promise<CampaignWorkspace | undefined> {
    return this.repository.findByCampaignId(campaignId);
  }

  async list(): Promise<CampaignWorkspace[]> {
    return this.repository.list();
  }
}

function buildScreens(existingScreens: CampaignScreen[], files: CampaignFile[], imageAnalyses: ImageAnalysis[], videoAnalyses: VideoAnalysis[]): CampaignScreen[] {
  const screens = [...existingScreens];

  for (const analysis of imageAnalyses) {
    if (!analysis.hasInterfaceElements) continue;
    if (screens.some((screen) => screen.sourceFileId === analysis.fileId)) continue;
    const file = files.find((candidate) => candidate.id === analysis.fileId);
    screens.push({
      id: `screen-${analysis.fileId}`,
      campaignId: file?.campaignId ?? "",
      category: classifyCampaignScreen(`${analysis.ocrText} ${file?.originalFileName ?? ""}`),
      sourceFileId: analysis.fileId,
      sourceType: "image",
      imagePath: file?.absolutePath ?? "",
      relatedFeatureIds: [],
      capturedAt: file?.uploadedAt ?? new Date().toISOString(),
    });
  }

  for (const analysis of videoAnalyses) {
    for (const entry of analysis.timeline) {
      const screenId = `screen-${analysis.fileId}-${entry.timestampSeconds}`;
      if (screens.some((screen) => screen.id === screenId)) continue;
      const file = files.find((candidate) => candidate.id === analysis.fileId);
      const frame = analysis.frames.find((candidate) => Math.abs(candidate.timestampSeconds - entry.timestampSeconds) < 1);
      screens.push({
        id: screenId,
        campaignId: file?.campaignId ?? "",
        category: entry.label as ScreenCategory,
        sourceFileId: analysis.fileId,
        sourceType: "video_frame",
        sourceTimestampSeconds: entry.timestampSeconds,
        imagePath: frame?.framePath ?? "",
        relatedFeatureIds: [],
        capturedAt: new Date().toISOString(),
      });
    }
  }

  return screens;
}

function backfillRelatedFeatures(screens: CampaignScreen[], features: Feature[]): void {
  for (const feature of features) {
    for (const screenId of feature.relatedScreenIds) {
      const screen = screens.find((candidate) => candidate.id === screenId);
      if (screen && !screen.relatedFeatureIds.includes(feature.id)) screen.relatedFeatureIds.push(feature.id);
    }
  }
}

function buildMediaItem(file: CampaignFile, imageAnalyses: ImageAnalysis[], videoAnalyses: VideoAnalysis[], documentAnalyses: DocumentAnalysis[], campaignId: string): CampaignMediaItem {
  const image = imageAnalyses.find((analysis) => analysis.fileId === file.id);
  const video = videoAnalyses.find((analysis) => analysis.fileId === file.id);
  const document = documentAnalyses.find((analysis) => analysis.fileId === file.id);

  let category: CampaignMediaItemCategory = "image";
  let description = file.originalFileName;
  let confidence = 0.5;
  let quality: CampaignMediaItem["quality"] = "medium";
  const derivedFilePaths: string[] = [];

  if (image) {
    category = image.category;
    description = `Imagem classificada como "${image.category}"${image.hasInterfaceElements ? " (interface detectada)" : ""}, ${image.width}x${image.height}.`;
    confidence = image.ocrText.length > 0 ? 0.85 : 0.55;
    quality = image.quality;
  } else if (video) {
    category = "video";
    description = `Vídeo, ${video.durationSeconds.toFixed(1)}s, ${video.scenes.length} cena(s), ${video.timeline.length} funcionalidade(s) identificada(s) por timestamp.`;
    confidence = video.timeline.length > 0 ? 0.85 : 0.5;
    quality = video.quality;
    derivedFilePaths.push(...video.frames.map((frame) => frame.framePath));
  } else if (document) {
    category = "document";
    description = `Documento, ${document.headlines.length} título(s), ${document.paragraphs.length} parágrafo(s)${document.pageCount ? `, ${document.pageCount} página(s)` : ""}${document.slideCount ? `, ${document.slideCount} slide(s)` : ""}.`;
    confidence = document.text.length > 200 ? 0.8 : 0.5;
  } else if (file.kind === "audio") {
    category = "audio";
    description = "Áudio armazenado (sem transcrição automática).";
    confidence = 0.4;
  }

  return {
    id: `media-${file.id}`,
    campaignId,
    origin: file.originalFileName,
    type: file.kind,
    description,
    category,
    tags: [file.kind],
    confidence,
    license: "campaign_upload",
    hash: file.hash,
    quality,
    originalFilePath: file.absolutePath,
    derivedFilePaths,
    sourcePriorityTier: 1,
  };
}

function relatedFeatureIdsFor(item: CampaignMediaItem, files: CampaignFile[], features: Feature[]): string[] {
  const file = files.find((candidate) => `media-${candidate.id}` === item.id);
  if (!file) return [];
  return features.filter((feature) => feature.keywords.some((keyword) => item.description.toLowerCase().includes(keyword))).map((feature) => feature.id);
}
