import type { EditingSceneDecision, MusicTrackReference, SoundEffectReference } from "../../shared/utils/cinematic-reference-library.js";
import type {
  VisualAssetCreationPackage,
  VisualAssetResolved,
} from "../../application/ports/visual-asset-provider.port.js";
import type { VideoMotionAnimation } from "../../application/ports/video-rendering.port.js";
import type { CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import type { ProductionPlan, ProductionReadinessScore } from "../../shared/utils/production-readiness.js";

export type RafaSupportedChannel =
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

/**
 * Espelha por convenção o formato de `JoaoMarketingStrategyCore` (saída real de João),
 * sem importar o tipo da Skill do João, para preservar o isolamento entre Skills.
 */
export type RafaJoaoStrategySummary = {
  overallStrategy: string;
  objective: string;
  targetAudience: string;
  channel: string;
  format: string;
  toneOfVoice: string;
  angle: string;
  centralPromise: string;
  valueProposition: string;
  keyMessages: string[];
  recommendedCta: string;
  observations?: string[];
  risks?: string[];
  nextSteps?: string[];
};

export type RafaBrunoSceneRhythm = "lento" | "moderado" | "dinamico" | "acelerado";
export type RafaNarrativeIntensity = "impacto" | "descoberta" | "demonstracao" | "beneficio" | "prova" | "convite" | "cta";
export type RafaVisualAssetPriority =
  | "person_using_product"
  | "product_mockup"
  | "screenshot"
  | "context_photo"
  | "conceptual_photo"
  | "brand_end_card";

/**
 * Espelha por convenção o formato de `BrunoVideoScene` (saída real de Bruno), sem importar o
 * tipo da Skill do Bruno, para preservar o isolamento entre Skills.
 */
export type RafaBrunoScene = {
  order: number;
  name: string;
  startSeconds: number;
  durationSeconds: number;
  spokenText: string;
  publicVisibleText?: string;
  publicSubtitle?: string;
  narrativePurpose?: string;
  featureFocus?: string;
  narrativeIntensity?: RafaNarrativeIntensity;
  internalNotes?: string[];
  onScreenText?: string;
  brollSuggestions: string[];
  framing: string;
  cameraMovement: string;
  rhythm: RafaBrunoSceneRhythm;
  pauseNotes?: string;
  transitionToNext?: string;
  soundEffectSuggestions: string[];
  /**
   * AGENCY FILM PIPELINE 2.0 — Shots planejados por Bruno. Rafa lê daqui a lista de Shots
   * para saber em que instante cada plano começa/termina, quem é o asset esperado e qual
   * transição costurar. Opcional para preservar backward compat com fakes/legacy.
   */
  shots?: RafaShot[];
};

/**
 * Espelha por convenção o formato de `Shot` (`shared/utils/cinematic-reference-library.ts`, shared
 * util). Rafa nunca redefine o Shot; apenas lê. Todos os campos vêm de Bruno.
 */
export type RafaShot = {
  id: string;
  sceneOrder: number;
  order: number;
  name: string;
  purpose: "establishing" | "detail" | "human_interaction" | "product" | "reaction" | "closing";
  action: string;
  startSeconds: number;
  durationSeconds: number;
  assetRequirement: {
    preferredMediaKind: "photo" | "illustration" | "mockup" | "graphic" | "video" | "b_roll" | "cinemagraph";
    sequenceRole: "establishing" | "detail" | "human_interaction" | "product" | "reaction" | "closing";
    whatShouldAppear: string;
    emotion: string;
    framing: string;
    movement: string;
    lighting: string;
    narrativeFunction: string;
    tags: string[];
    forbiddenTags: string[];
  };
  motion: {
    entrance: string;
    action: string;
    exit: string;
    motivation: string;
  };
  transitionFromPrevious: string;
  transitionToNext: string;
};

/**
 * Espelha por convenção o formato de `BrunoVanessaBriefing` (saída real de Bruno), sem importar
 * o tipo da Skill do Bruno, para preservar o isolamento entre Skills.
 */
export type RafaBrunoScriptSummary = {
  status: string;
  narrativeStructure: string;
  hook: string;
  totalDurationSeconds: number;
  scenes: RafaBrunoScene[];
  overallRhythm: string;
  musicSuggestions: string[];
  finalCta: string;
  recordingNotes: string[];
  editingNotes: string[];
  channel: string;
  notes: string[];
};

/**
 * Espelha por convenção o formato de `VanessaSceneDirection` (saída real de Vanessa), sem
 * importar o tipo da Skill da Vanessa, para preservar o isolamento entre Skills.
 */
export type RafaVanessaSceneDirection = {
  order: number;
  name: string;
  framing: string;
  visualComposition: string;
  cameraMovement: string;
  transitionToNext?: string;
  visualEffects: string[];
  visualAssetRequirement?: {
    whatShouldAppear: string;
    emotion: string;
    imageType: "photo" | "illustration" | "mockup" | "graphic";
    framing: string;
    movement: string;
    lighting: string;
    narrativeFunction: string;
    tags: string[];
    assetPriority?: RafaVisualAssetPriority;
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
    assetPriority: RafaVisualAssetPriority;
  };
  /** AGENCY FILM PIPELINE 2.0 — direções de fotografia por Shot herdadas de Vanessa. */
  shotDirections?: Array<{
    shotId: string;
    shotOrder: number;
    purpose: string;
    framing: string;
    lighting: string;
    composition: string;
    cameraMovement: string;
    eyeFocus: string;
    visualAssetRequirement: {
      whatShouldAppear: string;
      emotion: string;
      imageType: "photo" | "illustration" | "mockup" | "graphic";
      framing: string;
      movement: string;
      lighting: string;
      narrativeFunction: string;
      tags: string[];
      forbiddenTags: string[];
      assetPriority?: RafaVisualAssetPriority;
      sequenceRole: string;
      preferredMediaKind: "photo" | "illustration" | "mockup" | "graphic" | "video" | "b_roll" | "cinemagraph";
    };
    transitionToNextShot: string;
    continuityFromPreviousShot: string;
  }>;
};

/**
 * Espelha por convenção o formato de `VanessaDiegoBriefing` (saída real de Vanessa), sem
 * importar o tipo da Skill da Vanessa, para preservar o isolamento entre Skills.
 */
export type RafaVanessaDirectionSummary = {
  status: string;
  sceneDirections: RafaVanessaSceneDirection[];
  visualRhythm: string;
  captionStyle: string;
  soundDesignGuidance: string[];
  musicDirection: string;
  brollGuidance: string[];
  lightDirection: string;
  colorDirection: string;
  recordingGuidance: string[];
  editingGuidance: string[];
  channel: string;
  notes: string[];
};

/**
 * Espelha por convenção o formato de `DiegoEditingSceneDecision` (`EditingSceneDecision` de
 * `src/shared/utils/cinematic-reference-library.ts`, não é uma Skill — importado diretamente).
 */
export type RafaEditingSceneDecision = EditingSceneDecision;

/**
 * Espelha por convenção o formato de `DiegoTimelineEntry` (saída real de Diego), sem importar o
 * tipo da Skill do Diego, para preservar o isolamento entre Skills.
 */
export type RafaEditingTimelineEntry = {
  order: number;
  name: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  captionText: string;
  onScreenText?: string;
  publicVisibleText?: string;
  publicSubtitle?: string;
  narrativeIntensity?: RafaNarrativeIntensity;
  cutType: string;
  transitionToNext?: string;
  visualEffects: string[];
  soundEffectSuggestions: string[];
  /** As decisões completas de edição desta cena — ver `RafaEditingSceneDecision`. Rafa traduz isso, nunca reinterpreta. */
  editingDecision?: RafaEditingSceneDecision;
  /** Efeitos sonoros locais selecionados por Diego para esta cena. */
  selectedSoundEffects?: SoundEffectReference[];
  /** Requisito visual por cena herdado de Vanessa/Diego para resolução automática de assets. */
  visualAssetRequirement?: RafaVanessaSceneDirection["visualAssetRequirement"];
  /** Direção de arte completa herdada de Vanessa/Diego para composição temporal. */
  visualSceneDesign?: RafaVanessaSceneDirection["visualSceneDesign"];
  /**
   * AGENCY FILM PIPELINE 2.0 — timeline por Shot herdada de Diego. Rafa renderiza consumindo
   * essa lista shot a shot (entrada/ação/saída por Shot, transição entre Shots, sync com fala).
   */
  shotTimeline?: Array<{
    shotId: string;
    shotOrder: number;
    sceneOrder: number;
    purpose: string;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
    action: string;
    entranceTransition: string;
    exitTransition: string;
    continuityFromPreviousShot: string;
    syncNotes: string;
    photographyBrief: string;
    visualAssetRequirement: {
      whatShouldAppear: string;
      emotion: string;
      imageType: "photo" | "illustration" | "mockup" | "graphic";
      framing: string;
      movement: string;
      lighting: string;
      narrativeFunction: string;
      tags: string[];
      forbiddenTags: string[];
      sequenceRole: string;
      preferredMediaKind: "photo" | "illustration" | "mockup" | "graphic" | "video" | "b_roll" | "cinemagraph";
    };
  }>;
};

/**
 * Espelha por convenção o formato de `DiegoRafaBriefing` (saída real de Diego, já pensada para
 * esta etapa), sem importar o tipo da Skill do Diego, para preservar o isolamento entre Skills.
 */
export type RafaDiegoEditingPlanSummary = {
  status: string;
  editingTimeline: RafaEditingTimelineEntry[];
  totalDurationSeconds: number;
  musicTrackPlan: string;
  musicTrack?: MusicTrackReference;
  requiredAssets: string[];
  editingInstructions: string[];
  technicalChecklist: string[];
  channel: string;
  notes: string[];
};

export type RafaNoraNarrationSegment = {
  sceneId: string;
  sceneOrder: number;
  sceneName: string;
  startTime: number;
  endTime: number;
  estimatedDurationSeconds: number;
  text: string;
  emotion: string;
  emphasis: string[];
  pauseAfterMs: number;
  speed: number;
  volume: number;
  pronunciationHints: Record<string, string>;
  /** AGENCY FILM PIPELINE 2.0 — pontos de sincronia com Shots dentro desta cena, vindos de Nora. */
  shotSyncMarkers?: Array<{
    shotId: string;
    shotOrder: number;
    startSeconds: number;
    endSeconds: number;
    textSlice: string;
    breathOnEnterMs: number;
  }>;
};

export type RafaNoraNarrationBriefing = {
  narrationScript: string;
  segments: RafaNoraNarrationSegment[];
  voiceProfile: {
    language: string;
    genderPreference: "female" | "male" | "neutral";
    tone: string;
    pace: number;
  };
  providerInstructions: string[];
  audio: {
    expectedRelativePath: string;
    relativePath: string;
    absolutePath: string;
    fileName: string;
    mimeType: string;
    extension: string;
    sizeBytes: number;
    durationSeconds?: number;
    sampleRateHz?: number;
    validation?: {
      valid: boolean;
      clippingRisk?: "low" | "medium" | "high" | "unknown";
    };
  };
  textReductionGuidance: string[];
};

/**
 * Assets locais REAIS e explícitos (nunca sugestões em texto) que o chamador pode fornecer para
 * a renderização automática local. Diferente de `brollSuggestions`/`musicSuggestions`/
 * `requiredAssets` do plano de Bruno/Diego (sempre texto livre, nunca caminho de arquivo), estes
 * campos só existem quando alguém realmente aponta um arquivo local — hoje nenhum fluxo da CLI
 * preenche isto automaticamente (ver `docs/video-rendering.md`, seção "Próximos passos"). Cada
 * caminho aqui é tratado como **obrigatório**: se não resolver para um arquivo real, a renderização
 * local é cancelada e o workflow cai para Developer Assisted Mode informando exatamente o que falta.
 */
export type RafaLocalAssetsInput = {
  backgroundImagePathBySceneOrder?: Record<number, string>;
  musicTrackPath?: string;
  soundEffectPathBySceneOrder?: Record<number, string>;
};

export type RafaVideoRenderingRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  joaoStrategy: RafaJoaoStrategySummary;
  brunoScript: RafaBrunoScriptSummary;
  vanessaDirection: RafaVanessaDirectionSummary;
  diegoEditingPlan: RafaDiegoEditingPlanSummary;
  noraNarration?: RafaNoraNarrationBriefing;
  channel: RafaSupportedChannel;
  format: string;
  videoObjective: string;
  workflowContext?: Record<string, unknown>;
  /** Ver `RafaLocalAssetsInput`. Opcional — na ausência, a renderização local usa só texto/cores/logo (se houver). */
  localAssets?: RafaLocalAssetsInput;
};

/**
 * Especificações técnicas do vídeo final. A resolução/proporção vem da autoridade única
 * compartilhada (`resolveAspectRatio`/`resolutionForAspectRatio`, ver `src/shared/utils/aspect-ratio.ts`),
 * a mesma usada por Sofia/Pedro/Bianca para imagens — cobre 9:16 (Reels/Stories/TikTok/Shorts),
 * 4:5 (feed vertical) e 1:1 (feed quadrado). `audioCodec` é omitido quando o vídeo final não tem
 * trilha/efeito sonoro algum (`hasAudio: false`).
 */
export type RafaVideoSpecs = {
  format: string;
  width: number;
  height: number;
  resolution: string;
  aspectRatio: string;
  durationSeconds: number;
  fps: number;
  videoCodec: string;
  audioCodec?: string;
  hasAudio?: boolean;
};

export type RafaVideoMotionSummary = {
  scenes: number;
  totalAnimatedElements: number;
  totalIndependentAnimations: number;
  averageAnimatedElementsPerScene: number;
  transitionTypes: string[];
  elementAnimations: VideoMotionAnimation[];
  maxStaticMockupSeconds: number;
  mockupElements: number;
  simultaneousEntryWarnings: number;
  assetRoles: string[];
  layoutPatterns: string[];
  repeatedLayoutWarnings: number;
  averageDepthLayers: number;
  maxHeadlineWords: number;
  maxSubtitleWords: number;
  maxTextElementsPerScene: number;
  mockupOnlySceneRatio: number;
};

/**
 * Um pedido de vídeo esperado no modo assistido. O formato é uma lista (não um único objeto)
 * deliberadamente: nesta primeira versão sempre há exatamente uma variação (`final-video.mp4`),
 * mas o tipo já comporta múltiplas variações futuras (ex.: diferentes cortes ou proporções) sem
 * quebra de contrato.
 */
export type RafaAssistedVideoRequest = {
  index: number;
  fileName: string;
  expectedRelativePath: string;
  mimeType: string;
  specs: RafaVideoSpecs;
  prompt: string;
};

export type RafaAssistedGenerationOutput = {
  mode: "developer_assisted";
  instruction: string;
  pendingVideos: RafaAssistedVideoRequest[];
  pendingVisualAssets?: VisualAssetCreationPackage[];
  resumeCommand: string;
  /**
   * ASSET DIVERSITY GATE — presente apenas quando a pausa foi causada (total ou parcialmente)
   * por diversidade visual insuficiente para o perfil de qualidade pedido, não por ausência
   * simples de candidato. A CLI usa isto para mostrar diversidade atual vs. requisito mínimo
   * antes do prompt de cada Shot bloqueado (ver `printAssistedGenerationInstructions`).
   */
  diversitySummary?: {
    qualityProfile: string;
    passed: boolean;
    failures: string[];
    totalShots: number;
    distinctPhysicalFiles: number;
    minDistinctPhysicalFiles: number;
    videoRatio: number;
    minVideoRatio: number;
  };
  /**
   * PRODUCTION READINESS — presente apenas quando a pausa foi causada (total ou parcialmente) por
   * nota de Production Readiness abaixo do mínimo aceitável para o perfil de qualidade pedido. A
   * CLI usa isto para mostrar o Production Plan completo (Shots exigidos vs. encontrados, por
   * função narrativa/tipo de mídia) e a explicação exata de por que a campanha não tem material
   * suficiente (ver `printAssistedGenerationInstructions`).
   */
  productionPlan?: ProductionPlan;
  productionReadinessScore?: ProductionReadinessScore;
};

export type RafaGeneratedVideo = {
  id: string;
  index: number;
  fileName: string;
  mimeType: string;
  extension: string;
  specs: RafaVideoSpecs;
  sizeBytes?: number;
  majorBrand?: string;
  uri?: string;
  relativePath?: string;
  downloadHref?: string;
  localPath?: string;
  prompt: string;
  motionSummary?: RafaVideoMotionSummary;
  audioApplied?: boolean;
  narrationApplied?: boolean;
  musicDuckingApplied?: boolean;
  narrationDuration?: number;
  /**
   * Production Plan/Readiness da execução que gerou este vídeo — só preenchidos quando
   * `generationMode === "local_render"` (mesma restrição de `motionSummary`). Duplicados aqui (e
   * não só em `RafaVideoRenderingOutput`) porque é este objeto `video` que chega até Lucas via
   * `reviewInputBindings` (`sourcePath: "video"`, ver `arthur.orchestrator.ts`).
   */
  productionPlan?: ProductionPlan;
  productionReadinessScore?: ProductionReadinessScore;
};

export type RafaVideoRenderingOutput = {
  generationSummary: string;
  finalPrompt: string;
  expectedRelativePath: string;
  specs: RafaVideoSpecs;
  requiredAssets: string[];
  renderingInstructions: string[];
  video: RafaGeneratedVideo;
  /**
   * `local_render`: renderizado automaticamente via `VideoRenderingPort` (FFmpeg local, motion
   * graphics — ver `docs/video-rendering.md`), sem nenhuma intervenção humana. `developer_assisted`:
   * o fluxo original — a IA desenvolvedora (ou quem estiver operando a CLI) salvou o arquivo
   * manualmente. Não há (e não haverá nesta fase) um modo `ai_provider`: não existe provider real
   * de geração de vídeo por IA configurado nem planejado neste projeto.
   */
  generationMode: "developer_assisted" | "local_render";
  executionDurationMs: number;
  warnings: string[];
  observations: string[];
  nextSteps: string[];
  /** Só preenchido quando `generationMode === "local_render"`. */
  renderTimeMs?: number;
  /** Últimas linhas de log do FFmpeg — só preenchido quando `generationMode === "local_render"`. */
  renderLogsSummary?: string[];
  /**
   * `true` somente quando uma música local real (`localAssets.musicTrackPath`, ex.: `--music` na
   * CLI) foi resolvida e efetivamente inserida no MP4 pela renderização local automática. Sempre
   * `false` em Developer Assisted Mode (Rafa não sabe o que a IA desenvolvedora/humano incluiu no
   * arquivo salvo manualmente) e sempre `false` quando nenhuma música foi informada — nunca
   * simulado. Ver `warnings` para o aviso explícito quando nenhuma música foi informada.
   */
  audioApplied: boolean;
  /** Caminho absoluto da música local usada. Só preenchido quando `audioApplied === true`. */
  musicSource?: string;
  /** Nome do arquivo de música (sem diretório). Só preenchido quando `audioApplied === true`. */
  musicFilename?: string;
  /** `true` quando a narração real validada pela Nora foi mixada no MP4 final. */
  narrationApplied?: boolean;
  /** Caminho absoluto da voz validada pela Nora. */
  narrationSource?: string;
  /** Nome do arquivo de narração usado na mixagem. */
  narrationFilename?: string;
  /** Duração da narração medida/validada pela Nora, quando disponível. */
  narrationDuration?: number;
  /** `true` quando a música foi reduzida automaticamente durante as janelas de fala. */
  musicDuckingApplied?: boolean;
  /** Sempre "AAC" quando `audioApplied === true` (codec real do MP4 gerado, nunca simulado). */
  audioCodec?: string;
  /**
   * Duração, em segundos, do áudio presente no MP4 final — sempre igual à duração total do vídeo
   * quando `audioApplied === true`, porque a trilha é cortada ou repetida em loop (`-stream_loop`)
   * para acompanhar exatamente a duração do vídeo (ver `timeline-to-filter-compiler.ts`).
   */
  audioDuration?: number;
  /** Assets visuais reais escolhidos/criados para cada cena quando `generationMode === "local_render"`. */
  visualAssets?: VisualAssetResolved[];
  /** Relatório local de origem/licença/score dos assets visuais usados ou pendentes. */
  visualAssetReportPath?: string;
  /** Métricas do Motion Composer local usadas por Lucas para avaliar linguagem de motion design. */
  motionSummary?: RafaVideoMotionSummary;
  /** Identidade criativa da campanha (Creative Director Engine) — orienta intensidade visual, nunca decide renderização sozinha. */
  creativeDna: CampaignCreativeDNA;
  /** Production Plan (inventário de cenas/Shots/assets) da execução que passou no Production Readiness Gate. Só preenchido quando `generationMode === "local_render"`. */
  productionPlan?: ProductionPlan;
  /** Nota de Production Readiness da execução — ver `productionPlan`. */
  productionReadinessScore?: ProductionReadinessScore;
};
