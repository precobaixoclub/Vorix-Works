/**
 * MEDIA INTELLIGENCE ENGINE — porta central do catálogo de mídia. `src/application/ports` não é
 * uma Skill; qualquer Skill ou infraestrutura pode importar daqui sem violar o isolamento entre
 * Skills (ADR 0002). Este módulo NUNCA é consumido diretamente por uma Skill — o ponto de
 * integração real é `MediaCatalogVisualAssetProvider` (`src/infrastructure/media-catalog/`), que
 * implementa a porta genérica `VisualAssetProviderPort` já existente, para que o
 * `VisualAssetResolver` consulte o catálogo exatamente como consulta qualquer outro provider, sem
 * recriar lógica de catálogo própria e sem que nenhuma Skill precise saber que este módulo existe.
 */

export const MEDIA_ASSET_TYPES = [
  "photo",
  "video",
  "b_roll",
  "cinemagraph",
  "screenshot",
  "mockup",
  "logo",
  "overlay",
  "music",
  "sfx",
  "narration",
  "graphic",
] as const;
export type MediaAssetType = (typeof MEDIA_ASSET_TYPES)[number];

/**
 * Classificação explícita de filmagem real vs. sintética (seção 7 da sprint). `filmed_footage` e
 * `generated_video` (de alta qualidade) e `screenshot_recording` (para cenas de produto) contam
 * como vídeo real para a métrica Video Coverage premium; `procedural_background`/`motion_graphics`/
 * `animated_still`/`mockup_animation` nunca contam, mesmo que o `kind` técnico seja "video".
 */
export const MEDIA_FOOTAGE_CLASSIFICATIONS = [
  "filmed_footage",
  "generated_video",
  "motion_graphics",
  "animated_still",
  "procedural_background",
  "screenshot_recording",
  "mockup_animation",
  "composited_product_footage",
] as const;
export type MediaFootageClassification = (typeof MEDIA_FOOTAGE_CLASSIFICATIONS)[number];

/** `true` quando a classificação NUNCA deve contar como filmagem real na métrica Video Coverage. */
export function isProceduralFootage(classification: MediaFootageClassification | undefined): boolean {
  return classification === "procedural_background" || classification === "motion_graphics" || classification === "animated_still" || classification === "mockup_animation";
}

/**
 * `true` quando a classificação conta como vídeo real (filmagem ou geração de alta qualidade).
 * `composited_product_footage` (PRODUCT COMPOSITING ENGINE) conta como real porque a base é sempre
 * filmagem real já validada — a composição só insere uma tela de produto real por cima, nunca troca
 * a base por conteúdo sintético.
 */
export function isRealFootage(classification: MediaFootageClassification | undefined): boolean {
  return classification === "filmed_footage" || classification === "generated_video" || classification === "screenshot_recording" || classification === "composited_product_footage";
}

export const MEDIA_APPROVAL_STATUSES = [
  "discovered",
  "indexed",
  "metadata_pending",
  "needs_review",
  "approved",
  "rejected",
  "unavailable",
  "license_blocked",
] as const;
export type MediaApprovalStatus = (typeof MEDIA_APPROVAL_STATUSES)[number];

/** Nunca inventar autor/origem/licença — assets sem informação real de licença ficam `"unknown"` e bloqueados para publicação externa até validação humana. */
export type MediaLicenseStatus = "known" | "unknown";

export type MediaAssetLicense = {
  name: string;
  url?: string;
  allowsCommercialUse: boolean;
  requiresAttribution: boolean;
  expiresAt?: string;
};

export type MediaDuplicateRelation = {
  /** Mesmo arquivo físico byte-a-byte (mesmo hash sha256) — o "original" é o primeiro indexado. */
  duplicateOf?: string;
  /** Candidatos a quase-duplicata visual (perceptual hash próximo), nunca decidido automaticamente. */
  visualNearDuplicateOf?: string[];
  /** Este asset é derivado de outro (frame extraído de vídeo, versão redimensionada, etc.). */
  derivedFrom?: string;
};

export type MediaAssetScores = {
  technicalScore?: number;
  aestheticScore?: number;
  semanticScore?: number;
  brandFitScore?: number;
  productionScore?: number;
};

export type MediaAssetUsageRecord = {
  executionId: string;
  shotId?: string;
  usedAt: string;
};

/**
 * PRODUCT COMPOSITING ENGINE (seção 12) — proveniência completa de um asset `type: "video"` com
 * `footageClassification: "composited_product_footage"`. Nunca inventado: `sourceFootageAssetId`
 * e `productScreenId` sempre apontam para registros reais já existentes no catálogo (o vídeo
 * original nunca é modificado, só um NOVO asset derivado é criado — ver `derivedFrom` em
 * `MediaDuplicateRelation`).
 */
export type MediaCompositionProvenance = {
  sourceFootageAssetId: string;
  productScreenId: string;
  functionality: string;
  engineVersion: string;
  createdAt: string;
  clientId: string;
  keyframes: Array<{ time: number; corners: { topLeft: [number, number]; topRight: [number, number]; bottomRight: [number, number]; bottomLeft: [number, number] } }>;
};

/**
 * Registro central do catálogo — um asset pode estar tecnicamente válido e esteticamente
 * inadequado (scores independentes, nunca uma nota única). Todos os campos de proveniência
 * (author/sourceUrl/license) só são preenchidos quando realmente conhecidos; nunca inventados.
 */
export type MediaAssetRecord = {
  assetId: string;
  absolutePath: string;
  relativePath: string;
  name: string;
  type: MediaAssetType;
  subtype?: string;
  format: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  aspectRatio?: string;
  fps?: number;
  videoCodec?: string;
  audioChannels?: number;
  sampleRateHz?: number;
  sizeBytes: number;
  hash: string;
  perceptualHash?: string;
  createdAt?: string;
  indexedAt: string;
  origin: "local_library" | "developer_assisted" | "external_provider" | "unknown";
  author?: string;
  license?: MediaAssetLicense;
  licenseStatus: MediaLicenseStatus;
  sourceUrl?: string;
  client?: string;
  campaign?: string;
  themes: string[];
  people: string[];
  actions: string[];
  objects: string[];
  location?: string;
  emotion?: string;
  style?: string;
  lighting?: string;
  colorTemperature?: string;
  framing?: string;
  cameraMovement?: string;
  dominantPalette?: string[];
  tags: string[];
  footageClassification?: MediaFootageClassification;
  scores: MediaAssetScores;
  approvalStatus: MediaApprovalStatus;
  usageHistory: MediaAssetUsageRecord[];
  duplicate: MediaDuplicateRelation;
  /** `false` quando o arquivo físico não foi encontrado num rescan — nunca removido automaticamente do catálogo. */
  available: boolean;
  notes?: string[];
  /** Presente apenas quando `footageClassification === "composited_product_footage"`. */
  compositionProvenance?: MediaCompositionProvenance;
  /** PRODUCT COMPOSITING ENGINE (seção 10) — preenchido só pelo engine de composição; nunca assumido para outros assets. */
  legibleProductScreen?: boolean;
  /**
   * INTENT-BASED FOOTAGE ACQUISITION — preenchidos só pela validação visual pós-download
   * (`visual-candidate-validator.ts`), sempre heurísticos/aproximados (sem modelo de visão
   * computacional real neste ambiente — ver auditoria no relatório da sprint). Nunca assumidos
   * para assets que não passaram por essa validação (`undefined`, nunca um valor inventado).
   */
  screenVisible?: boolean;
  /** Fração (0 a 1) da área do frame ocupada pela região candidata a tela — só heurística. */
  screenArea?: number;
  deviceOrientation?: MediaShotDeviceOrientation | "unknown";
  deviceType?: MediaShotDeviceType;
  /** `true` só quando a simulação de pré-composição (reaproveita a geometria do Product Compositing Engine) responde SIM com justificativa registrada em `notes`. */
  interactionPossible?: boolean;
  compositingReady?: boolean;
  /** 0 a 1 — heurística de tom de pele restrita à vizinhança do dispositivo candidato (nunca o frame inteiro) como proxy de INTERAÇÃO, nunca detecção facial real. Ver `humanPresenceScore` para presença humana em qualquer lugar do frame — os dois são propositalmente scores distintos (seção 4 da FOOTAGE VISUAL VALIDATION 2.0: "uma pessoa apenas próxima ao dispositivo não conta como interação"). */
  humanInteractionScore?: number;
  /** 0 a 1 — combina screenArea + resolução + estabilidade de forma simples, documentado como aproximação. */
  productIntegrationScore?: number;
  /**
   * FOOTAGE VISUAL VALIDATION 2.0 — estágio de classificação em cadeia (ver
   * `visual-validation-stage.ts`), substitui a decisão binária antiga. Nunca preenchido para
   * assets que não passaram pelo Visual Candidate Validator desta versão (`undefined`, nunca um
   * estágio inventado).
   */
  visualValidationStage?: string;
  /** 0 a 1 — confiança geométrica (proporção + área plausíveis para o tipo de dispositivo pedido), separada da confiança de "é uma tela" (`screenConfidence`) — seção 6. */
  deviceConfidence?: number;
  /** 0 a 1 — combina área + variedade de cor interna da região candidata, nunca brilho/contraste isolado (causa raiz do falso positivo de 50% da sprint anterior). */
  screenConfidence?: number;
  /** 0 a 1 — presença humana em QUALQUER lugar do frame (skin ratio total), distinto de `humanInteractionScore` (só perto do dispositivo). */
  humanPresenceScore?: number;
  /** 0 a 1 — fração dos frames analisados em que a região candidata persistiu (mesma posição/tamanho aproximados), nunca uma detecção nova a cada frame — seção 3. */
  persistenceRatio?: number;
  /** `true` quando mãos/dedos cobrem a maior parte da região candidata no frame de referência — seção 2. */
  occlusionRisk?: boolean;
  /** Caminhos para os artefatos visuais reais gerados pelo Pre-composition Simulator (seção 7) — frame anotado com a região detectada e recorte ampliado — para revisão humana via `--footage-review-show`. */
  reviewArtifacts?: { annotatedFramePath?: string; zoomFramePath?: string };

  // -----------------------------------------------------------------------------------------
  // LOCAL OFFICIAL ASSET QUALIFICATION — campos aditivos (todos opcionais, nunca removem/
  // sobrescrevem os campos acima). Permitem que um asset oficial local (Company/Campaign
  // Intelligence, Product Screen Catalog, upload local) receba os MESMOS campos de validação
  // visual que um candidato do Intent-Based Footage Acquisition recebe (`screenVisible`,
  // `compositingReady` etc. acima) — preenchidos pelo MESMO `visual-candidate-validator.ts`,
  // nunca por uma lógica paralela. Ver `src/infrastructure/local-asset-qualification/`.
  // -----------------------------------------------------------------------------------------

  /** Capacidade criativa do asset — ortogonal a `type` (formato físico). Um vídeo ou uma foto real podem ter `product_screen` sem que `type` precise ser "mockup". Nunca inferida às cegas: só atribuída por `inferCapabilities` (heurística determinística sobre origem/tags), nunca por um Shot/Skill diretamente. */
  capabilities?: MediaAssetCapability[];
  /** De onde este asset foi originalmente ingerido — preservado para sempre, nunca sobrescrito por uma validação posterior. */
  ingestionSource?: MediaAssetIngestionSource;
  /** Identificador do arquivo/registro de origem no sistema que o ingeriu (ex.: `CampaignFile.id`, `CapturedScreen.id`, `ProductScreenRecord.screenId`) — preservado para rastreabilidade, nunca inventado quando ausente. */
  sourceFile?: string;
  /** Quando o asset é um frame/trecho extraído de um vídeo oficial — o timestamp real de origem, nunca recalculado. */
  sourceTimestampSeconds?: number;
  /** Quando este asset passou pela Local Official Asset Qualification pela última vez. */
  validationDate?: string;
  /** Identifica qual versão do Visual Candidate Validator (reaproveitado, nunca duplicado) produziu os campos de validação acima — nunca um número inventado, só a constante real do validador reaproveitado. */
  validatorVersion?: string;
  /** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 11) — carimbado só no momento da criação (composite, seção 11) quando a classificação real já é conhecida ali; nunca inferido depois. */
  authenticityClassOverride?: import("./visual-asset-provider.port.js").AuthenticityClass;
};

/**
 * LOCAL OFFICIAL ASSET QUALIFICATION (seção 5) — capacidade CRIATIVA de um asset, separada do
 * formato físico (`MediaAssetType`). Um Shot que precisa "mostrar o produto" deve poder ser
 * satisfeito por qualquer asset com a capacidade certa, independente de `type` ser photo/video/
 * screenshot/mockup — nunca o inverso (a ausência de uma capacidade nunca é contornada só porque
 * `type` combina).
 */
export const MEDIA_ASSET_CAPABILITIES = [
  "product_screen",
  "product_demo",
  "compositing_source",
  "background",
  "human_context",
  "logo",
  "end_card",
  "interface_capture",
  "device_interaction",
] as const;
export type MediaAssetCapability = (typeof MEDIA_ASSET_CAPABILITIES)[number];

/** LOCAL OFFICIAL ASSET QUALIFICATION (seção 4) — de onde um asset foi originalmente ingerido, preservado como proveniência permanente. */
export const MEDIA_ASSET_INGESTION_SOURCES = [
  "company_intelligence",
  "campaign_intelligence",
  "product_screen_catalog",
  "media_library",
  "external_provider",
  "local_upload",
] as const;
export type MediaAssetIngestionSource = (typeof MEDIA_ASSET_INGESTION_SOURCES)[number];

export type MediaScanOptions = {
  roots?: string[];
};

export type MediaScanResult = {
  scanned: number;
  added: number;
  updated: number;
  unavailable: number;
  duplicatesFound: number;
  warnings: string[];
};

export type MediaSearchQuery = {
  text?: string;
  type?: MediaAssetType;
  themes?: string[];
  actions?: string[];
  emotion?: string;
  requiresHuman?: boolean;
  targetAspectRatio?: string;
  minWidth?: number;
  minHeight?: number;
  minDurationSeconds?: number;
  requireApproved?: boolean;
  excludeAssetIds?: string[];
  excludePhysicalKeys?: string[];
  creativeDnaKeywords?: string[];
  shotPlanTags?: string[];
  limit?: number;
};

export type MediaSearchScoreBreakdown = {
  thematic: number;
  action: number;
  emotion: number;
  humanPresence: number;
  productFit: number;
  aspectRatio: number;
  resolution: number;
  duration: number;
  quality: number;
  license: number;
  creativeDna: number;
  shotPlanFit: number;
  diversity: number;
};

export type MediaSearchMatch = {
  asset: MediaAssetRecord;
  score: number;
  scoreBreakdown: MediaSearchScoreBreakdown;
};

export type MediaSearchResult = {
  matches: MediaSearchMatch[];
  warnings: string[];
};

export type MediaGapPriority = "obrigatorio" | "desejavel" | "opcional";

export type MediaGapStatus = "found" | "substitute" | "missing" | "license_unknown" | "duplicate_risk";

/**
 * FOOTAGE VISUAL VALIDATION 2.0 (seção 10) — estado de cada requisito ESTRUTURADO do Shot
 * (dispositivo, tela, interação, compositing), nunca inferido só por sobreposição de tags
 * temáticas. `"unknown"` é o valor honesto quando o Shot não declarou o requisito (não é
 * "satisfeito por omissão").
 */
export type ShotRequirementState = "satisfied" | "partially_satisfied" | "unsatisfied" | "unknown";

export type MediaGapItem = {
  shotId?: string;
  sceneOrder?: number;
  description: string;
  priority: MediaGapPriority;
  status: MediaGapStatus;
  candidateAssetId?: string;
  reason: string;
  /** FOOTAGE VISUAL VALIDATION 2.0 (seção 10) — presente só quando o Shot declarou ao menos um requisito estruturado (`device`/`screenVisibleRequired`/`compositingRequired`); ausente para Shots puramente temáticos (foto de decoração, por exemplo), nunca preenchido com um valor adivinhado. */
  requirementStates?: Record<"device" | "screenVisible" | "interaction" | "compositing", ShotRequirementState>;
};

export type MediaShotDeviceType = "phone" | "tablet" | "notebook" | "desktop" | "none";
export type MediaShotDeviceOrientation = "front" | "back" | "any";

/**
 * Entrada de Shot Plan que o Gap Analysis consome — subconjunto deliberadamente desacoplado de
 * `VisualAssetSearchQuery` para não criar dependência entre este port e o de assets visuais.
 * INTENT-BASED FOOTAGE ACQUISITION — campos adicionais (todos opcionais, aditivos) para que a
 * unidade de busca deixe de ser só "tema da campanha" e passe a ser o objetivo real do Shot. Ver
 * `src/shared/utils/shot-intent.ts` (deriva `ShotIntent` a partir desta entrada).
 */
export type MediaShotPlanEntry = {
  shotId?: string;
  sceneOrder: number;
  desiredType: MediaAssetType;
  themes: string[];
  action?: string;
  emotion?: string;
  requiresHuman?: boolean;
  requiresRealFootage?: boolean;
  strict?: boolean;
  subjectLabel?: string;
  environment?: string;
  coupleKey?: string;
  narrativeGoal?: string;
  secondaryAction?: string;
  mainObject?: string;
  device?: MediaShotDeviceType;
  deviceOrientationRequired?: MediaShotDeviceOrientation;
  screenVisibleRequired?: boolean;
  framing?: string;
  movement?: string;
  minDurationSeconds?: number;
  compositingRequired?: boolean;
};

export type MediaGapAnalysisResult = {
  totalShots: number;
  itemsFound: MediaGapItem[];
  itemsSubstitute: MediaGapItem[];
  itemsMissing: MediaGapItem[];
  itemsLicenseUnknown: MediaGapItem[];
  itemsDuplicateRisk: MediaGapItem[];
  sameCoupleShots: string[][];
  sameEnvironmentShots: string[][];
  shotsWithoutRealFootage: string[];
  prioritizedList: MediaGapItem[];
};

export type MediaHealthReport = {
  totalAssets: number;
  byType: Record<string, number>;
  byApprovalStatus: Record<string, number>;
  licenseBlocked: number;
  licenseUnknown: number;
  duplicates: number;
  realVideos: number;
  photos: number;
  mockups: number;
  music: number;
  sfx: number;
  coverageByTheme: Record<string, number>;
  coverageByEmotion: Record<string, number>;
  coverageByAction: Record<string, number>;
  criticalGaps: string[];
  mostUsedAssets: Array<{ assetId: string; usageCount: number }>;
  neverUsedAssets: string[];
  saturationRisk: Array<{ assetId: string; usageCount: number }>;
  acquisitionRecommendations: string[];
  generatedAt: string;
};

export type MediaCollectionRecord = {
  collectionId: string;
  name: string;
  description?: string;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type MediaCollectionStats = {
  collectionId: string;
  name: string;
  assetCount: number;
  themeCoverage: string[];
  humanVariety: number;
  environmentVariety: number;
  realVideoCount: number;
  photoCount: number;
  averageQuality: number;
  gaps: string[];
};

export interface MediaCatalogPort {
  scan(options?: MediaScanOptions): Promise<MediaScanResult>;
  list(filter?: { type?: MediaAssetType; approvalStatus?: MediaApprovalStatus; licenseStatus?: MediaLicenseStatus }): Promise<MediaAssetRecord[]>;
  get(assetId: string): Promise<MediaAssetRecord | undefined>;
  search(query: MediaSearchQuery): Promise<MediaSearchResult>;
  tag(assetIdOrPath: string, tags: string[]): Promise<MediaAssetRecord>;
  /** FOOTAGE VISUAL VALIDATION 2.0 (seção 7/8) — `note` opcional registra a decisão humana (checklist respondido, justificativa) em `notes`, mesmo padrão já usado por `reject`. */
  approve(assetId: string, note?: string): Promise<MediaAssetRecord>;
  reject(assetId: string, reason?: string): Promise<MediaAssetRecord>;
  remove(assetId: string): Promise<void>;
  recordUsage(assetId: string, usage: MediaAssetUsageRecord): Promise<void>;
  /**
   * REAL FOOTAGE ACQUISITION — indexa um `MediaAssetRecord` já completo (montado por
   * `media-acquisition.ts` após download/validação/classificação) diretamente no catálogo, sem
   * passar pela varredura de disco (`scan`). Só a orquestração de aquisição chama isto.
   */
  indexAcquiredAsset(record: MediaAssetRecord): Promise<void>;
  healthReport(): Promise<MediaHealthReport>;
  gapAnalysis(shotPlan: MediaShotPlanEntry[]): Promise<MediaGapAnalysisResult>;
  listCollections(): Promise<MediaCollectionRecord[]>;
  createCollection(input: { name: string; description?: string; assetIds: string[] }): Promise<MediaCollectionRecord>;
  collectionStats(collectionId: string): Promise<MediaCollectionStats | undefined>;
}
