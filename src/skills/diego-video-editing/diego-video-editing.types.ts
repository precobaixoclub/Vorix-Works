import type { EditingSceneDecision, MusicTrackReference, Shot, ShotPurpose, SoundEffectReference, TransitionStyle } from "../../shared/utils/cinematic-reference-library.js";
import type { CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";

export type DiegoSupportedChannel =
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
export type DiegoJoaoStrategySummary = {
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

export type DiegoBrunoSceneRhythm = "lento" | "moderado" | "dinamico" | "acelerado";
export type DiegoNarrativeIntensity = "impacto" | "descoberta" | "demonstracao" | "beneficio" | "prova" | "convite" | "cta";
export type DiegoVisualAssetPriority =
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
export type DiegoBrunoScene = {
  order: number;
  name: string;
  startSeconds: number;
  durationSeconds: number;
  spokenText: string;
  publicVisibleText?: string;
  publicSubtitle?: string;
  narrativePurpose?: string;
  featureFocus?: string;
  narrativeIntensity?: DiegoNarrativeIntensity;
  internalNotes?: string[];
  onScreenText?: string;
  brollSuggestions: string[];
  framing: string;
  cameraMovement: string;
  rhythm: DiegoBrunoSceneRhythm;
  pauseNotes?: string;
  transitionToNext?: string;
  soundEffectSuggestions: string[];
  /** AGENCY FILM PIPELINE 2.0 — Shots planejados por Bruno (mínimo 2 por cena). */
  shots: Shot[];
};

/**
 * Espelha por convenção o formato de `BrunoVanessaBriefing` (saída real de Bruno, já pensada
 * para a etapa de direção), sem importar o tipo da Skill do Bruno, para preservar o isolamento
 * entre Skills.
 */
export type DiegoBrunoScriptSummary = {
  status: string;
  narrativeStructure: string;
  hook: string;
  totalDurationSeconds: number;
  scenes: DiegoBrunoScene[];
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
export type DiegoVanessaSceneDirection = {
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
    assetPriority?: DiegoVisualAssetPriority;
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
    assetPriority: DiegoVisualAssetPriority;
  };
  /** AGENCY FILM PIPELINE 2.0 — direção de fotografia por Shot herdada de Vanessa. */
  shotDirections: DiegoVanessaShotDirection[];
};

/**
 * Espelha por convenção o formato de `VanessaShotDirection` — direção de fotografia por Shot que
 * Vanessa gera a partir dos Shots de Bruno. Diego usa isso para montar transições e continuidade
 * entre Shots (não só entre cenas).
 */
export type DiegoVanessaShotDirection = {
  shotId: string;
  shotOrder: number;
  purpose: ShotPurpose;
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
    assetPriority?: DiegoVisualAssetPriority;
    sequenceRole: ShotPurpose;
    preferredMediaKind: "photo" | "illustration" | "mockup" | "graphic" | "video" | "b_roll" | "cinemagraph";
  };
  transitionToNextShot: TransitionStyle;
  continuityFromPreviousShot: string;
};

/**
 * Espelha por convenção o formato de `VanessaDiegoBriefing` (saída real de Vanessa, já pensada
 * para esta etapa), sem importar o tipo da Skill da Vanessa, para preservar o isolamento entre
 * Skills.
 */
export type DiegoVanessaDirectionSummary = {
  status: string;
  sceneDirections: DiegoVanessaSceneDirection[];
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

export type DiegoEditingRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  joaoStrategy: DiegoJoaoStrategySummary;
  brunoScript: DiegoBrunoScriptSummary;
  vanessaDirection: DiegoVanessaDirectionSummary;
  channel: DiegoSupportedChannel;
  format: string;
  videoObjective: string;
  workflowContext?: Record<string, unknown>;
};

/**
 * Espelha por convenção o formato de `EditingSceneDecision` (`src/shared/utils/cinematic-reference-library.ts`,
 * não é uma Skill — importado diretamente por convenção, sem violar ADR 0002). Diego, como editor
 * profissional, decide isso para toda cena: nunca deixa "tipo de corte" como a única decisão.
 */
export type DiegoEditingSceneDecision = EditingSceneDecision;

/**
 * Um trecho da timeline técnica de edição, sempre derivado 1:1 da cena correspondente de Bruno
 * (timing e texto) combinada com a direção correspondente de Vanessa (composição, transição,
 * efeitos visuais) — Diego nunca cria, remove, reordena ou redefine cenas; apenas traduz o que
 * já foi decidido em um plano técnico executável.
 */
export type DiegoTimelineEntry = {
  order: number;
  name: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  captionText: string;
  onScreenText?: string;
  publicVisibleText?: string;
  publicSubtitle?: string;
  narrativeIntensity?: DiegoNarrativeIntensity;
  cutType: string;
  transitionToNext?: string;
  visualEffects: string[];
  soundEffectSuggestions: string[];
  /** As decisões completas de edição desta cena (corte, ritmo, transição, zoom/pan, animação, easing, sync). */
  editingDecision: DiegoEditingSceneDecision;
  /** Efeitos sonoros locais selecionados automaticamente por Diego para esta cena — ver `SoundEffectReference`. */
  selectedSoundEffects: SoundEffectReference[];
  /** Requisito visual por cena herdado de Vanessa para o Asset Resolver/Rafa. */
  visualAssetRequirement?: DiegoVanessaSceneDirection["visualAssetRequirement"];
  /** Direção de arte completa herdada da Vanessa para orientar Rafa. */
  visualSceneDesign?: DiegoVanessaSceneDirection["visualSceneDesign"];
  /**
   * AGENCY FILM PIPELINE 2.0 — timeline por Shot: cada entrada corresponde a um Shot planejado
   * por Bruno e dirigido por Vanessa. Diego costura continuidade/transições entre Shots (não só
   * entre cenas). Rafa renderiza shot a shot lendo daqui.
   */
  shotTimeline: DiegoShotTimelineEntry[];
};

/**
 * Trecho de timeline por Shot — Diego traduz cada Shot (cinematografia + motion + assetRequirement)
 * em uma decisão de edição executável: entrada/ação/saída, transição, sync com narração e
 * continuidade com o Shot anterior. Rafa renderiza consumindo esta lista.
 */
export type DiegoShotTimelineEntry = {
  shotId: string;
  shotOrder: number;
  sceneOrder: number;
  purpose: ShotPurpose;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  /** Ação concreta do Shot (herdada de Bruno, ex.: "Mão segurando celular"). */
  action: string;
  /** Transição de entrada — cut/fade/dissolve/whip/mask reveal etc. */
  entranceTransition: TransitionStyle;
  /** Transição de saída — para o próximo Shot da mesma cena ou o próximo Shot da próxima cena. */
  exitTransition: TransitionStyle;
  /** Continuidade herdada do Shot anterior — nunca "N/A" para Shots que não são o primeiro do vídeo. */
  continuityFromPreviousShot: string;
  /** Sync com narração — se este Shot precisa sincronizar com um segmento específico de Nora. */
  syncNotes: string;
  /** Direção de fotografia condensada para Rafa (framing + lighting + camera movement). */
  photographyBrief: string;
  /** Pedido de asset para este Shot — cópia do requirement de Vanessa, pronto para Rafa passar ao resolver. */
  visualAssetRequirement: DiegoVanessaShotDirection["visualAssetRequirement"];
};

export type DiegoEditingCore = {
  editingTimeline: DiegoTimelineEntry[];
  totalDurationSeconds: number;
  musicTrackPlan: string;
  /** Trilha selecionada automaticamente da biblioteca local — ver `MusicTrackReference`. */
  musicTrack: MusicTrackReference;
  requiredAssets: string[];
  editingInstructions: string[];
  technicalChecklist: string[];
  risks: string[];
  observations: string[];
  nextSteps: string[];
  /** Identidade criativa da campanha (Creative Director Engine) — nunca renderizada, só orienta ritmo/edição. */
  creativeDna: CampaignCreativeDNA;
};

export type DiegoEditingOutput = DiegoEditingCore & {
  rafaBriefing: DiegoRafaBriefing;
  aiSupportUsed: boolean;
  /** `provider.id` do Ícaro quando `aiSupportUsed` é `true` — ver `JoaoMarketingStrategyOutput.aiProviderId`. */
  aiProviderId?: string;
};

/**
 * `DiegoRafaBriefing` é o documento autocontido que Diego prepara para a futura Skill Rafa. Ele
 * reúne exclusivamente decisões de plano técnico de edição — timeline, cortes, legendas por
 * cena, textos na tela, transições, efeitos visuais e sonoros, trilha, assets necessários,
 * instruções de edição e checklist técnico — nunca a renderização ou publicação do vídeo em si,
 * que permanecem responsabilidade de Rafa e das próximas Skills.
 */
export type DiegoRafaBriefing = {
  status: "preliminary";
  editingTimeline: DiegoTimelineEntry[];
  totalDurationSeconds: number;
  musicTrackPlan: string;
  musicTrack: MusicTrackReference;
  requiredAssets: string[];
  editingInstructions: string[];
  technicalChecklist: string[];
  channel: DiegoSupportedChannel;
  notes: string[];
};

export type DiegoEditingEnhancement = {
  musicTrackPlan?: string;
  requiredAssets?: string[];
  editingInstructions?: string[];
  technicalChecklist?: string[];
};
