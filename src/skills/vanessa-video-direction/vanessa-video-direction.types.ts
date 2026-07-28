import type { CinematicSceneDecision } from "../../shared/utils/cinematic-reference-library.js";
import type { Shot, ShotPurpose, TransitionStyle } from "../../shared/utils/cinematic-reference-library.js";
import type { CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";

export type VanessaSupportedChannel =
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
export type VanessaJoaoStrategySummary = {
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

export type VanessaBrunoSceneRhythm = "lento" | "moderado" | "dinamico" | "acelerado";
export type VanessaNarrativeIntensity = "impacto" | "descoberta" | "demonstracao" | "beneficio" | "prova" | "convite" | "cta";
export type VanessaVisualAssetPriority =
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
export type VanessaBrunoScene = {
  order: number;
  name: string;
  startSeconds: number;
  durationSeconds: number;
  spokenText: string;
  publicVisibleText?: string;
  publicSubtitle?: string;
  narrativePurpose?: string;
  featureFocus?: string;
  narrativeIntensity?: VanessaNarrativeIntensity;
  internalNotes?: string[];
  onScreenText?: string;
  brollSuggestions: string[];
  framing: string;
  cameraMovement: string;
  rhythm: VanessaBrunoSceneRhythm;
  pauseNotes?: string;
  transitionToNext?: string;
  soundEffectSuggestions: string[];
  /**
   * AGENCY FILM PIPELINE 2.0 — Bruno agora escreve `shots` por cena. O tipo `Shot` vem da shared
   * library `cinematic-reference-library.ts` (shared util, não Skill; ADR 0002 não se aplica —
   * mesmo padrão de `CinematicSceneDecision` já importado acima). Vanessa nunca redefine Shots;
   * apenas complementa cada um com direção de fotografia própria em `shotDirections`.
   */
  shots: Shot[];
};

/**
 * Espelha por convenção o formato de `BrunoVanessaBriefing` (saída real de Bruno, já pensada
 * para esta etapa), sem importar o tipo da Skill do Bruno, para preservar o isolamento entre
 * Skills.
 */
export type VanessaBrunoScriptSummary = {
  status: string;
  narrativeStructure: string;
  hook: string;
  totalDurationSeconds: number;
  scenes: VanessaBrunoScene[];
  overallRhythm: string;
  musicSuggestions: string[];
  finalCta: string;
  recordingNotes: string[];
  editingNotes: string[];
  channel: string;
  notes: string[];
};

export type VanessaDirectionRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  joaoStrategy: VanessaJoaoStrategySummary;
  brunoScript: VanessaBrunoScriptSummary;
  channel: VanessaSupportedChannel;
  format: string;
  videoObjective: string;
  workflowContext?: Record<string, unknown>;
};

/**
 * As 18 decisões cinematográficas explícitas que Vanessa, como Diretora de Comerciais, toma para
 * toda cena — nunca deixa tipo de plano, lente, profundidade de campo, luz, ritmo ou movimento de
 * câmera implícitos ou a cargo do renderizador. Ver `CinematicSceneDecision` em
 * `src/shared/utils/cinematic-reference-library.ts` (tipo compartilhado, não é Skill — importado
 * diretamente, sem violar ADR 0002).
 */
export type VanessaCinematicDecision = CinematicSceneDecision;

export type VanessaVisualSceneDesign = {
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
  assetPriority: VanessaVisualAssetPriority;
};

/**
 * Direção audiovisual de uma cena específica, sempre derivada da cena correspondente do roteiro
 * de Bruno (mesma `order`/`name`) — Vanessa nunca cria, remove ou reordena cenas, apenas decide
 * como cada uma delas deve ser filmada e composta visualmente.
 */
export type VanessaSceneDirection = {
  order: number;
  name: string;
  framing: string;
  visualComposition: string;
  cameraMovement: string;
  transitionToNext?: string;
  visualEffects: string[];
  /** Vanessa como Diretora de Comerciais — as 18 decisões cinematográficas explícitas desta cena. */
  cinematography: VanessaCinematicDecision;
  /** Pedido visual explícito para o Asset Resolver/Rafa — não é arquivo, é intenção visual por cena. */
  visualAssetRequirement?: {
    whatShouldAppear: string;
    emotion: string;
    imageType: "photo" | "illustration" | "mockup" | "graphic";
    framing: string;
    movement: string;
    lighting: string;
    narrativeFunction: string;
    tags: string[];
    assetPriority?: VanessaVisualAssetPriority;
  };
  /** Direção de arte completa da cena — usada por Diego/Rafa para evitar aparência de apresentação. */
  visualSceneDesign?: VanessaVisualSceneDesign;
  /**
   * AGENCY FILM PIPELINE 2.0 — Vanessa, como Diretora de Fotografia, agora dirige por Shot, não
   * apenas por cena. Cada entrada corresponde 1:1 a um Shot que Bruno criou; Vanessa nunca cria
   * nem remove Shots. Nenhuma cena aceita menos de `MIN_SHOTS_PER_SCENE` direções aqui.
   */
  shotDirections: VanessaShotDirection[];
};

/**
 * Direção de fotografia por Shot — o retrato mais concreto que Vanessa entrega para o
 * VisualAssetResolver (asset por Shot) e Diego (transição/continuidade entre Shots). Vanessa
 * respeita a cinematografia que já veio no `Shot` de Bruno; aqui ela adiciona a intenção de
 * fotografia dela sobre aquela base.
 */
export type VanessaShotDirection = {
  /** Id do Shot em Bruno — deve casar exatamente com `shot.id`. */
  shotId: string;
  /** Ordem 1-based do Shot dentro da cena. */
  shotOrder: number;
  /** Finalidade narrativa do Shot herdada de Bruno. */
  purpose: ShotPurpose;
  /** Enquadramento específico desejado por Vanessa para este Shot (mais fino que o `shotType` genérico). */
  framing: string;
  /** Iluminação dirigida por Vanessa para este Shot. */
  lighting: string;
  /** Regras de composição desta tomada (regra dos terços, ancoragem, respiro). */
  composition: string;
  /** Movimento de câmera final para este Shot — reforça ou refina o `motion` que veio de Bruno. */
  cameraMovement: string;
  /** Foco visual — para onde Vanessa quer que o olho do espectador vá. */
  eyeFocus: string;
  /** Pedido visual explícito para o VisualAssetResolver — por Shot, nunca por cena. */
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
    assetPriority?: VanessaVisualAssetPriority;
    /** Papel visual do Shot dentro da sequência da cena — alimenta `sequenceRoles` do resolver. */
    sequenceRole: ShotPurpose;
    /** Tipo preferido de mídia (vídeo > b-roll > cinemagraph > fotografia). */
    preferredMediaKind: "photo" | "illustration" | "mockup" | "graphic" | "video" | "b_roll" | "cinemagraph";
  };
  /** Transição escolhida por Vanessa para sair deste Shot em direção ao próximo. */
  transitionToNextShot: TransitionStyle;
  /** Nota de continuidade — fio narrativo/visual herdado do Shot anterior. */
  continuityFromPreviousShot: string;
};

export type VanessaVideoDirectionCore = {
  sceneDirections: VanessaSceneDirection[];
  visualRhythm: string;
  captionStyle: string;
  soundDesignGuidance: string[];
  musicDirection: string;
  brollGuidance: string[];
  lightDirection: string;
  colorDirection: string;
  recordingGuidance: string[];
  editingGuidance: string[];
  risks: string[];
  observations: string[];
  nextSteps: string[];
  /** Identidade criativa da campanha (Creative Director Engine) — nunca renderizada, só orienta direção audiovisual. */
  creativeDna: CampaignCreativeDNA;
};

export type VanessaVideoDirectionOutput = VanessaVideoDirectionCore & {
  diegoBriefing: VanessaDiegoBriefing;
  aiSupportUsed: boolean;
  /** `provider.id` do Ícaro quando `aiSupportUsed` é `true` — ver `JoaoMarketingStrategyOutput.aiProviderId`. */
  aiProviderId?: string;
};

/**
 * `VanessaDiegoBriefing` é o documento autocontido que Vanessa prepara para o futuro Diego. Ele
 * reúne exclusivamente decisões de direção audiovisual — mapa de cenas, enquadramentos,
 * composição visual, movimentos de câmera, ritmo visual, transições, estilo de legenda, efeitos
 * visuais e sonoros, trilha, B-roll, luz e cor — nunca a gravação, edição, renderização ou
 * publicação do vídeo em si, que permanecem responsabilidade das próximas Skills da pipeline de
 * vídeo (Diego, Rafa).
 */
export type VanessaDiegoBriefing = {
  status: "preliminary";
  sceneDirections: VanessaSceneDirection[];
  visualRhythm: string;
  captionStyle: string;
  soundDesignGuidance: string[];
  musicDirection: string;
  brollGuidance: string[];
  lightDirection: string;
  colorDirection: string;
  recordingGuidance: string[];
  editingGuidance: string[];
  channel: VanessaSupportedChannel;
  notes: string[];
};

export type VanessaDirectionEnhancement = {
  visualRhythm?: string;
  captionStyle?: string;
  musicDirection?: string;
  lightDirection?: string;
  colorDirection?: string;
};
