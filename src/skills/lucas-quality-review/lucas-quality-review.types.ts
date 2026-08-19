import type { ContentQualityProfile } from "../../shared/utils/content-quality-profile.js";
import type { ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";
import type { AdLayoutZoneType } from "../../shared/utils/ad-layout.types.js";
import type { CreativeQualityScoreResult } from "../../shared/utils/creative-quality-score.js";

/** Espelha por convenção `TypographyGeometryEntry` (`ad-creative-renderer.ts`) — a geometria EXATA
 * que o renderer determinístico usou por zona (Performance Creative Engine, Fase 16). Fonte de
 * verdade determinística pro quality gate de tipografia, nunca uma estimativa de IA. */
export type LucasTypographyGeometryEntry = {
  type: AdLayoutZoneType;
  text: string;
  fontSizePx: number;
  lineCount: number;
  widthPx: number;
  heightPx: number;
  textColor: string;
  backgroundColor: string;
};

export type LucasSupportedChannel =
  | "instagram"
  | "facebook"
  | "threads"
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "google_business"
  | "meta_ads"
  | "google_ads";

/** Espelha por convenção o formato real de saída de João, sem importar o tipo da Skill do João. */
export type LucasJoaoStrategySummary = {
  objective: string;
  targetAudience: string;
  channel: string;
  toneOfVoice: string;
  angle: string;
  centralPromise: string;
  valueProposition: string;
  keyMessages: string[];
  recommendedCta: string;
  risks?: string[];
};

/** Espelha por convenção o formato real de `JoaoCreativeBrief`, sem importar o tipo da Skill do
 * João — requisito de "quality gate obrigatório" precisa saber de onde a oferta realmente veio
 * (`commercialFactsSource`) para checar se um fato comercial forte disponível foi ignorado. */
export type LucasJoaoCreativeBriefSummary = {
  productOrService: string;
  offer?: string;
  commercialFactsSource: "reference_image" | "registered_product" | "none";
  nonInventableInfo: string[];
};

/** Espelha por convenção o formato real de saída da Maria, sem importar o tipo da Skill da Maria. */
export type LucasMariaCopy = {
  title: string;
  caption: string;
  cta: string;
  hashtags: string[];
  keywords: string[];
  summary: string;
  objective: string;
  toneUsed: string;
  identifiedAudience: string;
  qualityScore?: number;
  /** Rastreabilidade `claim -> source` que a Maria produziu — ver `MariaStructuredCopy.claims`. */
  claims?: Array<{ text: string; source: string }>;
  qualityPassed?: boolean;
};

/** Espelha por convenção o formato real de saída da Sofia, sem importar o tipo da Skill da Sofia. */
export type LucasSofiaDirection = {
  visualConcept: string;
  recommendedStyle: string;
  suggestedPalette: string[];
  recommendedFormat: string;
  recommendedAspectRatio: string;
  visualConstraints: string[];
  visualRisks: string[];
};

/** Espelha por convenção o formato real de saída da Bianca, sem importar o tipo da Skill da Bianca. */
export type LucasBiancaDesign = {
  designConcept: string;
  gridSystem: string;
  slides: Array<{ slideIndex: number; role: string }>;
  designRisks: string[];
};

export type LucasPedroImage = {
  id?: string;
  mimeType?: string;
  extension?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  altText?: string;
  uri?: string;
};

/** Espelha por convenção o formato real de saída do Pedro, sem importar o tipo da Skill do Pedro. */
export type LucasPedroImages = {
  imageCount: number;
  images: LucasPedroImage[];
};

export type LucasBrunoScene = {
  order: number;
  name: string;
  durationSeconds: number;
  spokenText: string;
  publicVisibleText?: string;
  publicSubtitle?: string;
  narrativePurpose?: string;
  narrativeIntensity?: "impacto" | "descoberta" | "demonstracao" | "beneficio" | "prova" | "convite" | "cta";
  internalNotes?: string[];
  onScreenText?: string;
  /**
   * AGENCY FILM PIPELINE 2.0 — Shots planejados. Lucas usa isso para reprovar vídeos com poucos
   * Shots, cenas de um único plano, ou aparência de slideshow. Opcional para preservar backward
   * compat.
   */
  shots?: Array<{
    id: string;
    order: number;
    purpose: string;
    durationSeconds: number;
    startSeconds: number;
    cinematography?: {
      shotType?: string;
      cameraMovement?: string;
    };
    motion?: {
      entrance?: string;
      action?: string;
      exit?: string;
    };
    transitionToNext?: string;
    assetRequirement?: {
      preferredMediaKind?: string;
      sequenceRole?: string;
    };
  }>;
};

/** Espelha por convenção o formato real de saída do Bruno (`vanessaBriefing`), sem importar o tipo da Skill do Bruno. */
export type LucasBrunoScript = {
  hook: string;
  totalDurationSeconds: number;
  scenes: LucasBrunoScene[];
  finalCta: string;
  channel: string;
};

export type LucasVanessaSceneDirection = {
  order: number;
  name: string;
  /** Recorte da decisão cinematográfica de Vanessa usado para detectar enquadramento repetido entre cenas (ver `evaluateVideoFramingRepetitive`). */
  cinematography?: {
    shotType?: string;
    composition?: string;
  };
  visualSceneDesign?: {
    mainElement: string;
    secondaryElement: string;
    backgroundPlane: string;
    foregroundPlane: string;
    depth: string;
    lighting: string;
    atmosphere: string;
    emotion: string;
    visualRhythm: string;
    eyeFocus: string;
    composition: string;
    productIntegration: string;
    assetPriority: string;
  };
};

/** Espelha por convenção o formato real de saída da Vanessa (`diegoBriefing`), sem importar o tipo da Skill da Vanessa. */
export type LucasVanessaDirection = {
  sceneDirections: LucasVanessaSceneDirection[];
  visualRhythm: string;
  captionStyle: string;
  channel: string;
};

export type LucasDiegoTimelineEntry = {
  order: number;
  name: string;
  durationSeconds?: number;
  onScreenText?: string;
  publicVisibleText?: string;
  publicSubtitle?: string;
  captionText?: string;
  narrativeIntensity?: "impacto" | "descoberta" | "demonstracao" | "beneficio" | "prova" | "convite" | "cta";
  /** Recorte da decisão de edição de Diego usado para detectar cenas com decisão de corte/transição/animação idêntica (ver `evaluateVideoSceneDecisionsDuplicated`). */
  editingDecision?: {
    transition?: string;
    textAnimation?: string;
    mask?: boolean;
    glow?: boolean;
    blur?: boolean;
  };
};

/** Espelha por convenção o formato real de saída do Diego (`rafaBriefing`), sem importar o tipo da Skill do Diego. */
export type LucasDiegoEditingPlan = {
  editingTimeline: LucasDiegoTimelineEntry[];
  totalDurationSeconds: number;
  channel: string;
};

export type LucasNoraNarration = {
  narrationScript: string;
  segments: Array<{
    sceneId: string;
    sceneOrder: number;
    startTime: number;
    endTime: number;
    estimatedDurationSeconds: number;
    text: string;
    emotion: string;
    emphasis: string[];
    pauseAfterMs: number;
  }>;
  voiceProfile: {
    language: string;
    tone: string;
    pace: number;
  };
  audio?: {
    relativePath?: string;
    absolutePath?: string;
    durationSeconds?: number;
    validation?: {
      valid: boolean;
      clippingRisk?: "low" | "medium" | "high" | "unknown";
    };
  };
};

export type LucasRafaVideoSpecs = {
  width: number;
  height: number;
  aspectRatio: string;
  durationSeconds: number;
  format: string;
};

/**
 * Espelha por convenção o formato de `ProductionReadinessScore`
 * (`src/shared/utils/production-readiness.ts`). Não importado diretamente mesmo sendo um módulo
 * neutro (não-Skill) — mantém o mesmo invariante de isolamento de TODO o resto deste arquivo: se
 * o formato real mudar de forma incompatível, o pior caso é um campo `undefined` aqui, nunca um
 * erro de compilação em cascata através da fronteira de Skill.
 */
export type LucasProductionReadinessScore = {
  overall: number;
  minimumAcceptable: number;
  meetsMinimum: boolean;
  visualCoverage: number;
  humanCoverage: number;
  productCoverage: number;
  emotionalCoverage: number;
  videoCoverage: number;
  sceneDiversity: number;
  assetVariety: number;
};

/**
 * FOOTAGE VISUAL VALIDATION 2.0 (seção 11) — espelha por convenção `CompositingReadinessScores`
 * (`src/shared/utils/production-readiness.ts`). Ausente quando `rafaVideo` não tem plano de
 * produção (mesmo caso de `productionReadiness` ausente).
 */
export type LucasCompositingReadinessScore = {
  deviceCoverage: number;
  visibleScreenCoverage: number;
  interactionCoverage: number;
  compositingGeometryCoverage: number;
  temporalStabilityCoverage: number;
  occlusionSafetyCoverage: number;
  verifiedCompositingCoverage: number;
};

/** Espelha por convenção o formato de `ProductionPlan` (`src/shared/utils/production-readiness.ts`). */
export type LucasProductionPlanSummary = {
  scenesCount: number;
  shotsCount: number;
  assetsNeeded: number;
  assetsFound: number;
  assetsMissing: number;
  videoCount: number;
  photoCount: number;
  mockupCount: number;
  productScreenCount: number;
  humanAssetCount: number;
  repeatedAssetCount: number;
  varietySufficient: boolean;
  diversitySufficient: boolean;
  qualitySufficient: boolean;
};

/** Espelha por convenção o formato real do artefato de vídeo registrado pelo Rafa, sem importar o tipo da Skill do Rafa. */
export type LucasRafaVideo = {
  fileName?: string;
  mimeType?: string;
  extension?: string;
  specs: LucasRafaVideoSpecs;
  sizeBytes?: number;
  audioApplied?: boolean;
  narrationApplied?: boolean;
  musicDuckingApplied?: boolean;
  narrationDuration?: number;
  motionSummary?: {
    scenes: number;
    totalAnimatedElements: number;
    totalIndependentAnimations: number;
    averageAnimatedElementsPerScene: number;
    transitionTypes: string[];
    elementAnimations: string[];
    maxStaticMockupSeconds: number;
    mockupElements: number;
    simultaneousEntryWarnings: number;
    assetRoles?: string[];
    layoutPatterns?: string[];
    repeatedLayoutWarnings?: number;
    averageDepthLayers?: number;
    maxHeadlineWords?: number;
    maxSubtitleWords?: number;
    maxTextElementsPerScene?: number;
    mockupOnlySceneRatio?: number;
  };
  /** PRODUCTION READINESS — ver `LucasProductionPlanSummary`/`LucasProductionReadinessScore`. Ausentes quando Rafa renderizou em `developer_assisted` (o Diversity/Readiness Gate só roda no caminho `local_render`). */
  productionPlan?: LucasProductionPlanSummary;
  productionReadiness?: LucasProductionReadinessScore;
  /** FOOTAGE VISUAL VALIDATION 2.0 (seção 11) — ver `LucasCompositingReadinessScore`. Ausente pelo mesmo motivo de `productionReadiness`. */
  compositingReadiness?: LucasCompositingReadinessScore;
  /**
   * PRODUCT COMPOSITING ENGINE — um item por Shot que usa filmagem real com uma tela de produto
   * composta (perspectiva real). Espelha, por convenção (ADR 0002 — Lucas nunca importa o motor de
   * composição diretamente), os resultados já calculados pelo Product Compositing Engine/Lucas Gate
   * — nunca um veredito novo, só os fatos objetivos que o gate de Lucas usa para reprovar.
   */
  compositedProductFootage?: LucasCompositedFootageCheck[];
  /**
   * INTENT-BASED FOOTAGE ACQUISITION — um item por Shot que exigia dispositivo/tela (não só os já
   * compostos) — mais amplo que `compositedProductFootage`. Espelha por convenção (ADR 0002) os
   * fatos já calculados pela Intent-Based Footage Acquisition (Executive Producer +
   * `visual-candidate-validator.ts`), nunca uma nova detecção feita por Lucas.
   */
  shotIntentChecks?: LucasShotIntentCheck[];
};

export type LucasShotIntentCheck = {
  shotId?: string;
  intentSatisfied: boolean;
  productIntegrationPossible: boolean;
  screenVisible?: boolean;
  deviceOrientation?: "front" | "back" | "any" | "unknown";
  narrativePreserved: boolean;
  detail?: string;
};

export type LucasCompositedFootageCheck = {
  shotId?: string;
  assetId: string;
  functionality: string;
  requiredFunctionality?: string;
  legible: boolean;
  perspectiveCoherent: boolean;
  hasLeakageOutsideDevice: boolean;
  isStableAcrossFrames: boolean;
  coversFaceOrKeyElement: boolean;
  usesRealInterface: boolean;
  originLicenseRegistered: boolean;
};

export type LucasQualityReviewRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  joaoStrategy: LucasJoaoStrategySummary;
  mariaCopy: LucasMariaCopy;
  // Opcionais: campanhas somente-texto (sem canal visual detectado por Arthur) nunca passam por
  // Sofia/Bianca/Pedro, então não há direção visual, design ou imagens para revisar — Lucas trata
  // isso como "não aplicável", não como um problema a reprovar.
  sofiaDirection?: LucasSofiaDirection;
  biancaDesign?: LucasBiancaDesign;
  pedroImages?: LucasPedroImages;
  // Opcionais: só existem quando o comando aciona a pipeline de vídeo (Bruno/Vanessa/Diego/Rafa).
  // Mesmo raciocínio do componente visual: "não aplicável" nunca é um problema a reprovar, mas
  // dado parcial (alguns presentes, outros não) indica falha real de encadeamento.
  brunoScript?: LucasBrunoScript;
  vanessaDirection?: LucasVanessaDirection;
  diegoEditingPlan?: LucasDiegoEditingPlan;
  noraNarration?: LucasNoraNarration;
  // rafaVideo é a exceção deliberada: sua ausência com os três campos acima presentes é um
  // cenário de REVISÃO legítimo (vídeo ainda não renderizado/salvo), não um erro de validação —
  // ver NO_VIDEO_FILE.
  rafaVideo?: LucasRafaVideo;
  channel: LucasSupportedChannel;
  format: string;
  workflowContext?: Record<string, unknown>;
  /** Creative brief do João (produto/oferta/fonte da oferta) — requisito de "quality gate
   * obrigatório" (fidelidade e checagem comercial). Ausente = mesmo comportamento de antes (todas
   * as checagens novas que dependem disto ficam inaplicáveis, nunca reprovam por ausência). */
  creativeBrief?: LucasJoaoCreativeBriefSummary;
  /** Fatos estruturados extraídos da(s) imagem(ns) de referência — usado tanto pela checagem de
   * fidelidade visual (comparar a imagem gerada com a referência) quanto pela checagem comercial
   * (fato forte disponível mas ignorado na copy). Ausente = mesmo comportamento de antes. */
  referenceIntelligence?: ReferenceIntelligence;
  /** Geometria exata que o renderer determinístico usou (Fase 16) — presente só quando o
   * Performance Creative Engine rodou (`performanceCreativePlan`/`adLayoutSpec` na Bianca).
   * Ausente = mesmo comportamento de antes (nenhuma checagem de tipografia nova dispara). */
  typographyGeometry?: LucasTypographyGeometryEntry[];
};

export const LUCAS_REVIEW_STATUSES = ["approved", "approved_with_warnings", "needs_adjustments", "rejected"] as const;

export type LucasReviewStatus = (typeof LUCAS_REVIEW_STATUSES)[number];

export type LucasIssueSeverity = "low" | "medium" | "high";

export type LucasIssueCategory = "strategy" | "copy" | "visual" | "coherence" | "tone" | "cta" | "brand" | "risk" | "fidelity" | "commercial" | "typography" | "composition";

export type LucasIssueCode =
  | "NO_IMAGES_GENERATED"
  | "IMAGE_COUNT_MISMATCH"
  | "WEAK_STRATEGY_KEY_MESSAGES"
  | "COPY_MISSING_TITLE"
  | "COPY_MISSING_CAPTION"
  | "COPY_LOW_QUALITY_SCORE"
  | "VISUAL_CONCEPT_MISSING"
  | "FORMAT_MISMATCH"
  | "CHANNEL_MISMATCH"
  | "ASPECT_RATIO_MISMATCH"
  | "CTA_DIVERGENT"
  | "TONE_INCONSISTENT"
  | "FORBIDDEN_WORD_FOUND"
  | "FORBIDDEN_HASHTAG_FOUND"
  | "MANDATORY_WORD_MISSING"
  | "NO_RISKS_DOCUMENTED"
  | "NO_VIDEO_FILE"
  | "VIDEO_TECHNICAL_QUALITY_LOW"
  | "VIDEO_NOT_VERTICAL"
  | "VIDEO_ASPECT_RATIO_INVALID"
  | "VIDEO_DURATION_MISMATCH"
  | "VIDEO_HOOK_UNCLEAR"
  | "VIDEO_CTA_MISSING"
  | "VIDEO_CTA_DIVERGENT"
  | "VIDEO_RHYTHM_UNDEFINED"
  | "VIDEO_ON_SCREEN_TEXT_TOO_LONG"
  | "VIDEO_INTERNAL_TEXT_VISIBLE"
  | "VIDEO_THEME_DRIFT"
  | "VIDEO_END_CARD_INCOMPLETE"
  | "VIDEO_COHERENCE_MISMATCH"
  | "VIDEO_MOTION_COMPOSITION_WEAK"
  | "VIDEO_MOCKUP_STATIC"
  | "VIDEO_ELEMENTS_SIMULTANEOUS"
  | "VIDEO_ANIMATION_REPETITIVE"
  | "VIDEO_VISUAL_DEPTH_WEAK"
  | "VIDEO_LAYOUT_REPETITIVE"
  | "VIDEO_MOCKUP_PRESENTATION"
  | "VIDEO_SCENE_DESIGN_MISSING"
  | "VIDEO_NARRATION_MISSING"
  | "VIDEO_NARRATION_TIMING_INVALID"
  | "VIDEO_NARRATION_AUDIO_INVALID"
  | "VIDEO_NARRATION_CLIPPING"
  | "VIDEO_AUDIO_DUCKING_MISSING"
  | "VIDEO_VOICE_TEXT_REDUNDANT"
  | "VIDEO_SCENE_DECISIONS_DUPLICATED"
  | "VIDEO_RHYTHM_MONOTONOUS"
  | "VIDEO_SCENE_TOO_LONG"
  | "VIDEO_FRAMING_REPETITIVE"
  // AGENCY FILM PIPELINE 2.0 — reprovações específicas de shot planning e diversidade audiovisual.
  // Ver `evaluateAgencyFilmPipelineShots` em `lucas-quality-review.skill.ts`.
  | "VIDEO_FEW_SHOTS"
  | "VIDEO_SCENE_SINGLE_SHOT"
  | "VIDEO_SLIDESHOW_LIKE"
  | "VIDEO_SHOT_FRAMING_REPETITIVE"
  | "VIDEO_SHOT_PURPOSE_MONOTONOUS"
  | "VIDEO_SHOT_MOTION_MONOTONOUS"
  | "VIDEO_EXCESS_MOCKUP_SHOTS"
  | "VIDEO_EXCESS_ON_SCREEN_TEXT"
  // PRODUCTION READINESS (`src/shared/utils/production-readiness.ts`) — a campanha inteira tinha
  // material real o suficiente para virar um comercial antes de renderizar? Ver
  // `evaluateProductionReadinessGate` em `lucas-quality-review.skill.ts`. Todos os cinco entram em
  // `BLOCKING_ISSUE_CODES`: qualquer um abaixo do mínimo reprova automaticamente, independente da
  // nota agregada.
  | "PRODUCTION_READINESS_LOW"
  | "PRODUCTION_ASSET_DIVERSITY_LOW"
  | "PRODUCTION_HUMAN_PRESENCE_LOW"
  | "PRODUCTION_SCENE_VARIETY_LOW"
  | "PRODUCTION_SHOT_VARIETY_LOW"
  // PRODUCT COMPOSITING ENGINE — a tela do produto composta na filmagem real está tecnicamente e
  // narrativamente correta? Ver `evaluateCompositedProductFootageGate` em
  // `lucas-quality-review.skill.ts`. `COMPOSITED_SCREEN_STUCK_ON_TOP`/`_FUNCTIONALITY_MISMATCH`/
  // `_ORIGIN_UNLICENSED` entram em `BLOCKING_ISSUE_CODES` (reprovação automática).
  | "COMPOSITED_SCREEN_ILLEGIBLE"
  | "COMPOSITED_SCREEN_PERSPECTIVE_INCOHERENT"
  | "COMPOSITED_SCREEN_LEAKAGE"
  | "COMPOSITED_SCREEN_UNSTABLE"
  | "COMPOSITED_SCREEN_COVERS_KEY_ELEMENT"
  | "COMPOSITED_SCREEN_FUNCTIONALITY_MISMATCH"
  | "COMPOSITED_SCREEN_NOT_REAL_INTERFACE"
  | "COMPOSITED_SCREEN_ORIGIN_UNLICENSED"
  // INTENT-BASED FOOTAGE ACQUISITION — Shot Intent atendido? Product Integration possível? Screen
  // Visibility? Device Orientation? Narrativa preservada? Ver `evaluateShotIntentGate` em
  // `lucas-quality-review.skill.ts`. `SHOT_INTENT_NOT_SATISFIED` é bloqueante.
  | "SHOT_INTENT_NOT_SATISFIED"
  | "SHOT_INTENT_PRODUCT_INTEGRATION_IMPOSSIBLE"
  | "SHOT_INTENT_NARRATIVE_DRIFT"
  // FOOTAGE VISUAL VALIDATION 2.0 (seção 11) — ver `evaluateCompositingVerificationGate`. Sinal de
  // governança (não bloqueante): o pipeline automático marcou candidatos como geometricamente
  // prontos para composição, mas nenhum foi humanamente aprovado ainda (seção 8: nenhuma aprovação
  // automática nesta versão).
  | "PRODUCT_COMPOSITING_UNVERIFIED_CLAIM"
  // Consistência com a identidade criativa da campanha (Creative Director Engine) — ver
  // `evaluateCreativeDnaIdentity`. Só avaliados quando a campanha corresponde a um arquétipo
  // criativo específico reconhecido (`isWeddingOrganizationTheme`), nunca para DNA genérico.
  | "CREATIVE_DNA_HERO_SCENE_MISSING"
  | "CREATIVE_DNA_HERO_FRAME_MISSING"
  | "CREATIVE_DNA_VISUAL_METAPHOR_MISSING"
  | "CREATIVE_DNA_EMOTION_NOT_PERCEIVED"
  | "CREATIVE_DNA_IDENTITY_DRIFT"
  // Critérios específicos de perfil (ver `resolveContentQualityProfile`/`evaluateFormatProfile`):
  // só disparam quando `qualityProfile` for o formato correspondente.
  | "STORY_CAPTION_TOO_LONG"
  | "STORY_CTA_TOO_LONG"
  | "STORY_MISSING_CURIOSITY"
  | "CARROSSEL_INSUFFICIENT_PROGRESSION"
  | "CARROSSEL_MISSING_FINAL_CTA"
  | "MISSING_VIDEO_PACKAGE_FOR_FORMAT"
  // REFERENCE INTELLIGENCE — fidelidade ao produto de referência e uso correto de fatos
  // comerciais reais (ver `evaluateProductFidelity`/`evaluateCommercialHallucination`/
  // `evaluateCommercialFactUtilization`/`evaluateCopySpecificity` em
  // `lucas-quality-review.skill.ts`). `PRODUCT_FIDELITY_MISMATCH`/`COMMERCIAL_HALLUCINATION_
  // DETECTED` entram em `BLOCKING_ISSUE_CODES` (reprovação automática — requisito
  // "REJECT_AUTOMATICALLY" para falha crítica de fidelidade ou alucinação comercial).
  | "PRODUCT_FIDELITY_MISMATCH"
  | "COMMERCIAL_HALLUCINATION_DETECTED"
  | "COMMERCIAL_FACT_IGNORED"
  | "GENERIC_CLICHE_IN_COPY"
  // PERFORMANCE CREATIVE ENGINE — Typography Quality Gate (Fase 16): geometria EXATA que o
  // renderer determinístico usou por zona, nunca uma estimativa de IA. `TYPOGRAPHY_TEXT_CLIPPED`/
  // `TYPOGRAPHY_CONTRAST_LOW` entram em `BLOCKING_ISSUE_CODES` — texto ilegível ou cortado é
  // defeito objetivo, mesma classe de `PRODUCT_FIDELITY_MISMATCH`.
  | "TYPOGRAPHY_MIN_SIZE_VIOLATION"
  | "TYPOGRAPHY_CONTRAST_LOW"
  | "TYPOGRAPHY_TEXT_CLIPPED"
  | "TYPOGRAPHY_LINE_COUNT_EXCEEDED"
  | "TYPOGRAPHY_ALL_CAPS_OVERUSE"
  // Visual Composition Quality Gate (Fase 17) — veredito assíncrono via visão (mesmo padrão de
  // `evaluateProductFidelity`).
  | "VISUAL_COMPOSITION_UNPROFESSIONAL";

export type LucasIssue = {
  code: LucasIssueCode;
  category: LucasIssueCategory;
  message: string;
  severity: LucasIssueSeverity;
};

export type LucasSuggestion = {
  relatedIssueCode?: LucasIssueCode;
  message: string;
};

export type LucasChecklistItem = {
  item: string;
  passed: boolean;
  notes?: string;
};

export type LucasQualityReviewOutput = {
  reviewStatus: LucasReviewStatus;
  overallScore: number;
  approvalRecommended: boolean;
  issues: LucasIssue[];
  suggestions: LucasSuggestion[];
  risks: string[];
  checklist: LucasChecklistItem[];
  observations: string[];
  nextSteps: string[];
  /** Perfil de qualidade usado nesta revisão (Feed/Story/Carrossel/Reels/Vídeo curto) — mesmo perfil que a Maria usou. */
  qualityProfile: ContentQualityProfile;
  /** Unified Final Creative Score (Rodada 2, Fatia 2, Prioridade 10) — score 0-100 consolidado em
   * 10 dimensões, só calculado quando o Performance Creative Engine rodou (`typographyGeometry`
   * presente). NÃO substitui `reviewStatus`/`BLOCKING_ISSUE_CODES` — falha crítica objetiva
   * (`PRODUCT_FIDELITY_MISMATCH`/`COMMERCIAL_HALLUCINATION_DETECTED`/`TYPOGRAPHY_TEXT_CLIPPED`/
   * `TYPOGRAPHY_CONTRAST_LOW`) força `verdict: "reject"` mesmo com nota alta. `undefined` quando
   * não aplicável (mesma condição de ausência de `typographyGeometry`). */
  creativeQualityScore?: CreativeQualityScoreResult;
  aiSupportUsed: boolean;
  /** `provider.id` do Ícaro quando `aiSupportUsed` é `true` — ver `JoaoMarketingStrategyOutput.aiProviderId`. */
  aiProviderId?: string;
};

export type LucasReviewEnhancement = {
  additionalObservations?: string[];
  additionalSuggestions?: string[];
};
