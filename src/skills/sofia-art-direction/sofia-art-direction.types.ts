export type SofiaSupportedChannel =
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
export type SofiaJoaoStrategySummary = {
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

/**
 * Espelha por convenção o formato de `JoaoSofiaBriefing` (saída real de João),
 * sem importar o tipo da Skill do João, para preservar o isolamento entre Skills.
 */
export type SofiaJoaoBriefing = {
  status: string;
  channel: string;
  format: string;
  angle: string;
  centralPromise: string;
  keyMessages: string[];
  visualDirectionNotes: string[];
  brandIdentityNotes: string[];
  notes: string[];
};

export type SofiaArtDirectionRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  joaoStrategy: SofiaJoaoStrategySummary;
  joaoSofiaBriefing: SofiaJoaoBriefing;
  channel: SofiaSupportedChannel;
  format: string;
  visualObjective: string;
  workflowContext?: Record<string, unknown>;
};

/**
 * `SofiaBiancaBriefing` é o documento autocontido que Sofia prepara para a futura Bianca,
 * Especialista em Design para Redes Sociais. Ele reúne exclusivamente decisões de direção
 * de arte — conceito, identidade visual, paleta, tipografia, moodboard, estilo, linguagem
 * estética, referências de design e emoção — nunca decisões de layout, grid, hierarquia
 * visual detalhada, espaçamento ou posicionamento de elementos, que passam a ser
 * responsabilidade exclusiva de Bianca.
 */
export type SofiaBiancaBriefing = {
  status: "preliminary";
  visualConcept: string;
  recommendedStyle: string;
  emotionalTone: string;
  suggestedPalette: string[];
  typography: string[];
  moodboard: string[];
  designReferences: string[];
  recommendedFormat: string;
  recommendedAspectRatio: string;
  visualConstraints: string[];
  channel: SofiaSupportedChannel;
  notes: string[];
};

export type SofiaArtDirectionCore = {
  visualConcept: string;
  recommendedStyle: string;
  emotionalTone: string;
  suggestedPalette: string[];
  typography: string[];
  moodboard: string[];
  designReferences: string[];
  recommendedFormat: string;
  recommendedAspectRatio: string;
  visualConstraints: string[];
  visualRisks: string[];
  observations: string[];
  nextSteps: string[];
};

export type SofiaArtDirectionOutput = SofiaArtDirectionCore & {
  biancaBriefing: SofiaBiancaBriefing;
  aiSupportUsed: boolean;
  /** `provider.id` do Ícaro quando `aiSupportUsed` é `true` — ver `JoaoMarketingStrategyOutput.aiProviderId`. */
  aiProviderId?: string;
};

export type SofiaDirectionEnhancement = {
  visualConcept?: string;
  recommendedStyle?: string;
  emotionalTone?: string;
  moodboard?: string[];
  designReferences?: string[];
};
