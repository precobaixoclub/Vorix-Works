/**
 * CAMPAIGN INTELLIGENCE ENGINE — modelos de domínio (seções 1-10, 14, 15). Vive em `src/domain/`
 * pelo mesmo raciocínio do Company Intelligence: nenhum tipo aqui depende de `application/ports`.
 *
 * Reuso deliberado do Company Intelligence Engine (nunca duplicação): `Feature`, `CapturedScreen`,
 * `MediaLibraryItem`, `DiscoveredPage`, `ExtractedContent`/`ExtractedFaqItem`/`ExtractedTestimonial`/
 * `ExtractedPlan`, `KnowledgeGraph`/`KnowledgeNode`/`KnowledgeEdge`, `MediaItemCategory` e
 * `ScreenCategory` são exatamente os mesmos tipos usados pelo Company Intelligence — um arquivo de
 * campanha vira um `ExtractedContent` (para reusar `discoverFeatures` sem reescrevê-lo) e uma tela
 * detectada vira um `CapturedScreen` (para reusar `buildKnowledgeGraph` sem reescrevê-lo). Nenhum
 * desses arquivos reusados é modificado — só importado.
 */

import type {
  CapturedScreen,
  DiscoveredPage,
  ExtractedContent,
  ExtractedFaqItem,
  Feature,
  KnowledgeGraph,
  MediaItemCategory,
  MediaLibraryItem,
  ScreenCategory,
} from "../company-intelligence/company-intelligence.model.js";

export type {
  CapturedScreen,
  DiscoveredPage,
  ExtractedContent,
  ExtractedFaqItem,
  Feature,
  KnowledgeGraph,
  MediaItemCategory,
  MediaLibraryItem,
  ScreenCategory,
};

// -------------------------------------------------------------------------------------------
// 2. MULTIMODAL INGESTION
// -------------------------------------------------------------------------------------------

export const CAMPAIGN_FILE_KINDS = ["photo", "video", "pdf", "ppt", "docx", "xlsx", "svg", "audio", "zip", "unsupported"] as const;
export type CampaignFileKind = (typeof CAMPAIGN_FILE_KINDS)[number];

export const CAMPAIGN_FILE_STATUSES = ["pending", "processed", "failed", "unsupported"] as const;
export type CampaignFileStatus = (typeof CAMPAIGN_FILE_STATUSES)[number];

export type CampaignFile = {
  id: string;
  campaignId: string;
  originalFileName: string;
  absolutePath: string;
  kind: CampaignFileKind;
  extension: string;
  sizeBytes: number;
  hash: string;
  uploadedAt: string;
  status: CampaignFileStatus;
  processingNotes: string[];
};

// -------------------------------------------------------------------------------------------
// 3. IMAGE UNDERSTANDING
// -------------------------------------------------------------------------------------------

export type MediaQuality = "low" | "medium" | "high";

export type ImageAnalysis = {
  fileId: string;
  ocrText: string;
  detectedTexts: string[];
  dominantColors: string[];
  hasInterfaceElements: boolean;
  buttons: string[];
  category: MediaItemCategory;
  quality: MediaQuality;
  width: number;
  height: number;
  aspectRatio: string;
  tags: string[];
};

// -------------------------------------------------------------------------------------------
// 4. VIDEO UNDERSTANDING
// -------------------------------------------------------------------------------------------

export type VideoScene = { sceneIndex: number; startSeconds: number; endSeconds: number };

export type VideoFrame = {
  timestampSeconds: number;
  framePath: string;
  sceneIndex: number;
  ocrText: string;
};

export type TimelineEntry = {
  timestampSeconds: number;
  label: string;
  kind: "feature" | "screen";
  confidence: number;
};

export type VideoAnalysis = {
  fileId: string;
  durationSeconds: number;
  scenes: VideoScene[];
  frames: VideoFrame[];
  timeline: TimelineEntry[];
  /** Nunca inventado: só preenchido quando existe texto de legenda/caption realmente queimado no vídeo (via OCR de frame). Sem ASR local disponível neste ambiente — ver relatório de qualidade/limitações. */
  transcript?: string;
  quality: MediaQuality;
};

// -------------------------------------------------------------------------------------------
// 5. DOCUMENT UNDERSTANDING
// -------------------------------------------------------------------------------------------

export type DocumentAnalysis = {
  fileId: string;
  pageCount?: number;
  slideCount?: number;
  text: string;
  headlines: string[];
  paragraphs: string[];
  lists: string[][];
  tables: string[][][];
};

// -------------------------------------------------------------------------------------------
// 6. SCREEN DETECTION / 7. FEATURE LINKING
// -------------------------------------------------------------------------------------------

export const CAMPAIGN_SCREEN_SOURCE_TYPES = ["image", "video_frame", "document_page"] as const;
export type CampaignScreenSourceType = (typeof CAMPAIGN_SCREEN_SOURCE_TYPES)[number];

export type CampaignScreen = {
  id: string;
  campaignId: string;
  category: ScreenCategory;
  sourceFileId: string;
  sourceType: CampaignScreenSourceType;
  sourceTimestampSeconds?: number;
  sourcePageNumber?: number;
  imagePath: string;
  relatedFeatureIds: string[];
  capturedAt: string;
};

// -------------------------------------------------------------------------------------------
// 9. CAMPAIGN MEDIA LIBRARY
// -------------------------------------------------------------------------------------------

/** `MediaItemCategory` (Company Intelligence) cobre bem qualquer asset visual; "document"/"audio" são as categorias genuinamente novas, para PDF/DOCX/PPT/XLSX e áudio (que não são assets visuais). */
export type CampaignMediaItemCategory = MediaItemCategory | "document" | "audio";

export type CampaignMediaItem = {
  id: string;
  campaignId: string;
  origin: string;
  type: CampaignFileKind | "screen";
  description: string;
  category: CampaignMediaItemCategory;
  tags: string[];
  confidence: number;
  license: string;
  hash: string;
  quality: MediaQuality;
  originalFilePath: string;
  derivedFilePaths: string[];
  sourcePriorityTier: number;
};

// -------------------------------------------------------------------------------------------
// 10. SOURCE PRIORITY
// -------------------------------------------------------------------------------------------

export const SOURCE_PRIORITY_TIERS = [
  { tier: 1, label: "Arquivos enviados para esta campanha" },
  { tier: 2, label: "Biblioteca oficial da empresa" },
  { tier: 3, label: "Company Intelligence" },
  { tier: 4, label: "Site oficial" },
  { tier: 5, label: "Biblioteca histórica" },
  { tier: 6, label: "Stock (Pexels)" },
  { tier: 7, label: "Conteúdo genérico" },
] as const;
export type SourcePriorityTierId = (typeof SOURCE_PRIORITY_TIERS)[number]["tier"];
export type SourcePriorityOrigin =
  | "campaign_upload"
  | "official_brand_library"
  | "company_intelligence"
  | "official_website"
  | "historical_library"
  | "stock_provider"
  | "generic_content";

// -------------------------------------------------------------------------------------------
// 14/15. TIMELINE INDEX / QUALITY REPORT
// -------------------------------------------------------------------------------------------

export type CampaignQualityReport = {
  campaignId: string;
  generatedAt: string;
  filesIngested: number;
  processedFiles: number;
  byKind: Record<string, number>;
  featuresFound: number;
  screensFound: number;
  videosProcessed: number;
  framesExtracted: number;
  documentsProcessed: number;
  ocrCharactersExtracted: number;
  assetsCollected: number;
  coverageScore: number;
  averageConfidence: number;
  duplicateFiles: number;
  reusableAssets: number;
  pendingItems: string[];
};

/** Workspace completo de uma campanha — raiz do agregado, o que fica persistido e disponível para toda a pipeline (seção 11), sempre por trás da mesma API. Nunca substitui o Company Intelligence — só complementa (seção 1). */
export type CampaignWorkspace = {
  campaignId: string;
  files: CampaignFile[];
  imageAnalyses: ImageAnalysis[];
  videoAnalyses: VideoAnalysis[];
  documentAnalyses: DocumentAnalysis[];
  screens: CampaignScreen[];
  features: Feature[];
  mediaLibrary: CampaignMediaItem[];
  graph: KnowledgeGraph;
  qualityReport: CampaignQualityReport;
  createdAt: string;
  updatedAt: string;
};
