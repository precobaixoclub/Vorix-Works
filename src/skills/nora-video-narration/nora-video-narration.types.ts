import type { CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";

export type NoraSupportedChannel =
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

export type NoraNarrativeIntensity = "impacto" | "descoberta" | "demonstracao" | "beneficio" | "prova" | "convite" | "cta";

export type NoraJoaoStrategySummary = {
  objective: string;
  targetAudience: string;
  channel: string;
  toneOfVoice: string;
  angle: string;
  centralPromise: string;
  valueProposition: string;
  keyMessages: string[];
  recommendedCta: string;
};

export type NoraBrunoScene = {
  order: number;
  name: string;
  startSeconds: number;
  durationSeconds: number;
  spokenText: string;
  publicVisibleText?: string;
  publicSubtitle?: string;
  narrativePurpose?: string;
  featureFocus?: string;
  narrativeIntensity?: NoraNarrativeIntensity;
  onScreenText?: string;
};

export type NoraBrunoScriptSummary = {
  hook: string;
  totalDurationSeconds: number;
  scenes: NoraBrunoScene[];
  finalCta: string;
  channel: string;
};

export type NoraVanessaDirectionSummary = {
  visualRhythm: string;
  captionStyle: string;
  channel: string;
  sceneDirections: Array<{
    order: number;
    name: string;
    visualSceneDesign?: {
      emotion: string;
      visualRhythm: string;
      productIntegration: string;
    };
  }>;
};

export type NoraDiegoTimelineEntry = {
  order: number;
  name: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  captionText?: string;
  onScreenText?: string;
  publicVisibleText?: string;
  publicSubtitle?: string;
  narrativeIntensity?: NoraNarrativeIntensity;
  /**
   * AGENCY FILM PIPELINE 2.0 — Nora espelha os Shots da timeline de Diego. Cada entrada
   * corresponde a um Shot com timing absoluto; Nora usa isso para segmentar a fala e emitir
   * marcadores de sincronia (ver `NoraShotSyncMarker`). Opcional para preservar backward compat
   * com testes/legacy que não enviarem shots.
   */
  shotTimeline?: Array<{
    shotId: string;
    shotOrder: number;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
    purpose: string;
  }>;
};

export type NoraDiegoEditingPlanSummary = {
  editingTimeline: NoraDiegoTimelineEntry[];
  totalDurationSeconds: number;
  channel: string;
};

export type NoraVideoNarrationRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  joaoStrategy: NoraJoaoStrategySummary;
  brunoScript: NoraBrunoScriptSummary;
  vanessaDirection: NoraVanessaDirectionSummary;
  diegoEditingPlan: NoraDiegoEditingPlanSummary;
  channel: NoraSupportedChannel;
  format: string;
  videoObjective: string;
  language?: string;
  workflowContext?: Record<string, unknown>;
};

export type NoraVoiceProfile = {
  language: string;
  genderPreference: "female" | "male" | "neutral";
  tone: string;
  pace: number;
};

export type NoraNarrationSegment = {
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
  /** Marcador explícito de intensidade narrativa da cena — guia o dublador/IA de voz sobre o "peso" da fala. */
  intensity: NoraNarrativeIntensity;
  /** Marcador de entrega: a fala deve soar com um sorriso perceptível (calor, acolhimento). */
  smile: boolean;
  /** Marcador de entrega: a fala deve soar com leve surpresa/descoberta, nunca informativa e plana. */
  surprise: boolean;
  /** Silêncio dramático (ms) a respeitar imediatamente antes desta fala, além da pausa normal entre cenas. 0 quando não se aplica. */
  silenceBeforeMs: number;
  /** Pausa de respiração (ms) antes desta fala — natural após uma frase anterior longa, distinta do silêncio dramático (que marca impacto, não fôlego). 0 quando a fala anterior foi curta o suficiente para não precisar. */
  breathBeforeMs: number;
  /**
   * AGENCY FILM PIPELINE 2.0 — pontos de sincronia com Shots dentro desta cena. Cada marcador diz
   * onde (em tempo absoluto) a imagem muda, para que a voz respire ou mude de tom junto — nunca
   * lendo um bloco inteiro enquanto a imagem permanece parada. Vazio quando a cena tem um único
   * Shot (legacy) ou quando Diego não entregou timeline por Shot.
   */
  shotSyncMarkers: NoraShotSyncMarker[];
};

/**
 * Marcador de sincronia entre a fala e o corte de Shot. Rafa consome estes marcadores para
 * ajustar a entrega da voz (respiração/pausa/mudança de tom) no exato ponto em que o Shot muda,
 * evitando "leitura contínua enquanto imagem para".
 */
export type NoraShotSyncMarker = {
  shotId: string;
  shotOrder: number;
  /** Instante absoluto (segundos) em que o Shot começa. */
  startSeconds: number;
  /** Instante absoluto (segundos) em que o Shot termina. */
  endSeconds: number;
  /** Trecho aproximado do texto que deve tocar dentro deste Shot (fatiado por proporção de tempo). */
  textSlice: string;
  /** Sugestão de respiração ao ENTRAR neste Shot (ms). 0 no primeiro Shot da cena. */
  breathOnEnterMs: number;
};

export type NoraNarrationAudioValidation = {
  valid: boolean;
  format?: "wav" | "mp3" | "m4a" | "aac";
  durationSeconds?: number;
  sampleRateHz?: number;
  clippingRisk?: "low" | "medium" | "high" | "unknown";
  reason?: string;
};

export type NoraGeneratedNarrationAudio = {
  expectedRelativePath: string;
  relativePath: string;
  absolutePath: string;
  fileName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  durationSeconds?: number;
  sampleRateHz?: number;
  validation: NoraNarrationAudioValidation;
};

export type NoraRafaBriefing = {
  narrationScript: string;
  segments: NoraNarrationSegment[];
  voiceProfile: NoraVoiceProfile;
  providerInstructions: string[];
  audio: NoraGeneratedNarrationAudio;
  textReductionGuidance: string[];
};

export type NoraVideoNarrationOutput = {
  generationSummary: string;
  voiceProfile: NoraVoiceProfile;
  narrationScript: string;
  segments: NoraNarrationSegment[];
  providerInstructions: string[];
  expectedRelativePath: string;
  audio: NoraGeneratedNarrationAudio;
  rafaBriefing: NoraRafaBriefing;
  warnings: string[];
  /** Identidade criativa da campanha (Creative Director Engine) — nunca renderizada, só orienta emoção da voz. */
  creativeDna: CampaignCreativeDNA;
};

export type NoraAssistedNarrationRequest = {
  index: number;
  fileName: string;
  expectedRelativePath: string;
  mimeTypes: string[];
  durationSeconds: number;
  prompt: string;
  voiceProfile: NoraVoiceProfile;
  segments: NoraNarrationSegment[];
};

export type NoraAssistedGenerationOutput = {
  mode: "developer_assisted";
  instruction: string;
  pendingNarrations: NoraAssistedNarrationRequest[];
  narrationScript: string;
  voiceProfile: NoraVoiceProfile;
  resumeCommand: string;
  validationErrors?: string[];
};
