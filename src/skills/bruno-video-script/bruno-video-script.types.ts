import type { CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import type { Shot } from "../../shared/utils/cinematic-reference-library.js";

/**
 * A partir da sprint AGENCY FILM PIPELINE 2.0, Bruno escreve por Shot — a menor unidade da
 * pipeline de vídeo passa a ser o Shot, definido em `shared/utils/cinematic-reference-library.ts`
 * (shared util, não Skill; ADR 0002 não se aplica — mesmo padrão de `CampaignCreativeDNA` acima).
 * `BrunoShot` é apenas o alias local que Bruno expõe, para que as próximas Skills (Vanessa,
 * Diego, Rafa, Lucas) possam espelhar por convenção via mirror types se preferirem, sem importar
 * este alias diretamente.
 */
export type BrunoShot = Shot;

export type BrunoSupportedChannel =
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
export type BrunoJoaoStrategySummary = {
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

export type BrunoSceneRhythm = "lento" | "moderado" | "dinamico" | "acelerado";
export type BrunoNarrativeIntensity = "impacto" | "descoberta" | "demonstracao" | "beneficio" | "prova" | "convite" | "cta";
/**
 * Função de comercial de cada cena — nunca duas cenas adjacentes com a mesma função. "hook" e
 * "cta" são sempre a primeira/última cena; "build"/"payoff"/"release" cobrem o bloco de
 * desenvolvimento, na ordem, e nunca se repetem dentro do mesmo bloco (ver `narrativeBeatFor`).
 */
export type BrunoSceneFunction = "hook" | "build" | "payoff" | "release" | "cta";

export type BrunoVideoScene = {
  order: number;
  name: string;
  startSeconds: number;
  durationSeconds: number;
  /** Texto de narração/fala pública. Nunca deve conter observações internas de estratégia. */
  spokenText: string;
  /** Headline pública, curta e segura para renderização no vídeo. */
  publicVisibleText?: string;
  /** Complemento público opcional, curto e seguro para renderização no vídeo. */
  publicSubtitle?: string;
  /** Finalidade narrativa interna para auditoria. Nunca deve ser renderizada. */
  narrativePurpose?: string;
  /** Funcionalidade/prova principal da cena. Nunca deve dominar o tema central sozinha. */
  featureFocus?: string;
  /** Intensidade narrativa pública da cena, usada por Diego/Rafa para variar ritmo e motion. */
  narrativeIntensity?: BrunoNarrativeIntensity;
  /** Função de comercial desta cena — por que ela existe. Nunca repetida entre cenas adjacentes. */
  sceneFunction?: BrunoSceneFunction;
  /** Notas internas para direção/edição. Nunca devem ser renderizadas. */
  internalNotes?: string[];
  /** Por que esta cena existe, em uma frase (objetivo emocional). Nunca deve ser renderizada. */
  emotionalGoal?: string;
  /** A dúvida/desconforto ainda não resolvido que sustenta a atenção nesta cena. Nunca deve ser renderizada. */
  tension?: string;
  /** O que o espectador ganha (prova, identificação, alívio) ao assistir esta cena. Nunca deve ser renderizada. */
  reward?: string;
  /** O que o espectador passa a esperar da cena seguinte por causa desta. Nunca deve ser renderizada. */
  expectation?: string;
  /** A entrega concreta desta cena — a resposta à tensão que ela mesma levantou. Nunca deve ser renderizada. */
  payoff?: string;
  onScreenText?: string;
  brollSuggestions: string[];
  framing: string;
  cameraMovement: string;
  rhythm: BrunoSceneRhythm;
  pauseNotes?: string;
  transitionToNext?: string;
  soundEffectSuggestions: string[];
  /**
   * Sequência de Shots que compõem esta cena — AGENCY FILM PIPELINE 2.0 proíbe cenas de um
   * único plano. Bruno preenche automaticamente via `planShotsForScene()` da shared library.
   * A soma de `durationSeconds` dos Shots é sempre igual à `durationSeconds` da cena; nenhum
   * Shot dura menos de 0.4s; nenhuma cena tem menos de `MIN_SHOTS_PER_SCENE` Shots.
   */
  shots: BrunoShot[];
};

export type BrunoScriptRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  joaoStrategy: BrunoJoaoStrategySummary;
  channel: BrunoSupportedChannel;
  format: string;
  videoObjective: string;
  desiredDurationSeconds?: number;
  workflowContext?: Record<string, unknown>;
};

/**
 * `BrunoVanessaBriefing` é o documento autocontido que Bruno prepara para a futura Vanessa,
 * Especialista de produção/filmagem de vídeos curtos. Ele reúne exclusivamente decisões de
 * roteiro — estrutura narrativa, gancho, cenas, texto falado, texto na tela, B-roll,
 * enquadramentos, movimentos de câmera, ritmo, pausas, transições, efeitos sonoros, trilha e CTA
 * final — nunca a geração, edição, renderização ou publicação do vídeo em si, que permanecem
 * responsabilidade das próximas Skills da pipeline de vídeo (Vanessa, Diego, Rafa).
 */
export type BrunoVanessaBriefing = {
  status: "preliminary";
  narrativeStructure: string;
  hook: string;
  totalDurationSeconds: number;
  scenes: BrunoVideoScene[];
  overallRhythm: string;
  musicSuggestions: string[];
  finalCta: string;
  recordingNotes: string[];
  editingNotes: string[];
  channel: BrunoSupportedChannel;
  notes: string[];
};

export type BrunoVideoScriptCore = {
  narrativeStructure: string;
  hook: string;
  totalDurationSeconds: number;
  scenes: BrunoVideoScene[];
  overallRhythm: string;
  musicSuggestions: string[];
  finalCta: string;
  recordingNotes: string[];
  editingNotes: string[];
  risks: string[];
  observations: string[];
  nextSteps: string[];
  /** Identidade criativa da campanha (Creative Director Engine) — nunca renderizada, só orienta roteiro/gravação. */
  creativeDna: CampaignCreativeDNA;
};

export type BrunoVideoScriptOutput = BrunoVideoScriptCore & {
  vanessaBriefing: BrunoVanessaBriefing;
  aiSupportUsed: boolean;
  /** `provider.id` do Ícaro quando `aiSupportUsed` é `true` — ver `JoaoMarketingStrategyOutput.aiProviderId`. */
  aiProviderId?: string;
};

export type BrunoScriptEnhancement = {
  narrativeStructure?: string;
  hook?: string;
  overallRhythm?: string;
  musicSuggestions?: string[];
  finalCta?: string;
};
