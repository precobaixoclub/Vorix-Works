import type { CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import type { MarketingObjective } from "../../shared/utils/marketing-objective-classifier.js";
import type { ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";

export type JoaoSupportedChannel =
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

export type JoaoMariaBriefingChannel =
  | "instagram"
  | "facebook"
  | "threads"
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "youtube"
  | "google_business";

/**
 * Espelha por convenção (ADR 0002 — nenhuma Skill importa outra Skill) o formato real de
 * `EduardoEditorialPlanningOutput`. Quando presente, é o Editorial Brief que o Eduardo decidiu
 * antes de João iniciar o trabalho — João deixa de decidir formato sozinho a partir daqui.
 */
export type JoaoEditorialBriefSummary = {
  campaignObjective: string;
  recommendedFormat: string;
  recommendedFormatLabel: string;
  formatJustification: string;
  recommendedSlideCount?: number;
  recommendedVideoDurationSeconds?: number;
  recommendedChannel: string;
  primaryEmotion: string;
  narrativeStructure: string[];
  recommendedCta: string;
  depthLevel: string;
  contentComplexity: string;
  conversionPriority: string;
  recommendationsForJoao: string[];
};

export type JoaoStrategyRequestInput = {
  clientId?: string;
  tenantId?: string;
  originalRequest: string;
  desiredChannel: JoaoSupportedChannel;
  desiredFormat: string;
  desiredObjective: string;
  // Opcional para não quebrar quem ainda não roteia o Eduardo antes de João (ex.: testes
  // unitários de João isolado). Quando presente, sobrescreve a decisão de formato/CTA de João.
  editorialBrief?: JoaoEditorialBriefSummary;
  workflowContext?: Record<string, unknown>;
  /** Memória editorial (headlines/CTAs/conceitos recentes deste workspace, já aprovados ou
   * rejeitados) — texto compacto pronto para prompt, montado por
   * `ContentBriefExecutionTaskHandler` (real-skill-execution-handlers.ts) a partir de
   * `ContentGenerationHistoryPort`/`QualityFeedbackPort`. Ausente = comportamento idêntico ao
   * atual (nenhuma instrução de "evitar repetir" é adicionada). */
  avoidRepeating?: string;
  /** Fatos estruturados (produto, preço, desconto, oferta, o que preservar) extraídos das imagens
   * de referência anexadas na ideia — ver `reference-intelligence.types.ts`. Ausente = mesmo
   * comportamento de sempre (nenhum fato de referência disponível, ex.: `campaign_creation`, que
   * nunca tem imagens de referência). */
  referenceIntelligence?: ReferenceIntelligence;
};

/**
 * Creative brief estruturado (requisito de "etapa obrigatória de planejamento" antes de copy/
 * imagem) — interno, nunca exposto ao usuário, serve de contexto compartilhado para Maria/Sofia/
 * Bianca/Pedro/Lucas. `nonInventableInfo` é computado por AUSÊNCIA real de dado na Clara (ex.: sem
 * preço cadastrado em ProductContext → entra na lista) — nunca uma lista fixa.
 */
export type JoaoCreativeBrief = {
  brand?: string;
  segment?: string;
  productOrService: string;
  publicationObjective: string;
  marketingObjective: MarketingObjective;
  targetAudience: string;
  channel: JoaoSupportedChannel;
  funnelStage: "topo" | "meio" | "fundo";
  differentiator?: string;
  offer?: string;
  mainBenefit?: string;
  toneOfVoice: string;
  cta: string;
  creativeConcept: string;
  communicationAngle: string;
  mandatoryInfo: string[];
  nonInventableInfo: string[];
  /** De onde `offer` veio — permite a Maria/Lucas saber se a oferta é evidência real (imagem de
   * referência) ou só uma faixa de preço cadastrada na Clara (menos específica). Requisito de
   * "toda afirmação relevante precisa ser rastreável até uma fonte". */
  commercialFactsSource: "reference_image" | "registered_product" | "none";
};

export type JoaoMariaBriefing = {
  objective: string;
  /** Classificação de objetivo de marketing (ver `marketing-objective-classifier.ts`) — Maria usa
   * para variar estrutura/CTA da copy conforme o tipo real de publicação, em vez de uma fórmula
   * única para tudo. */
  marketingObjective?: MarketingObjective;
  channel: JoaoMariaBriefingChannel;
  /** Rótulo do formato da peça (`strategy.format`, herdado de `recommendedFormatLabel` do Eduardo) — usado pela Maria para escolher o perfil de avaliação de qualidade correspondente. */
  format?: string;
  targetAudience: string;
  toneOfVoice: string;
  cta: string;
  keyMessage: string;
  productName?: string;
  offer?: string;
  keywords?: string[];
  forbiddenTerms?: string[];
  mandatoryWords?: string[];
  preferredHashtags?: string[];
  language?: string;
  additionalContext?: string;
};

export type JoaoSofiaBriefing = {
  status: "preliminary";
  channel: JoaoSupportedChannel;
  format: string;
  angle: string;
  centralPromise: string;
  keyMessages: string[];
  visualDirectionNotes: string[];
  brandIdentityNotes: string[];
  notes: string[];
};

export type JoaoMarketingStrategyCore = {
  overallStrategy: string;
  objective: string;
  /** Classificação estruturada do objetivo (requisito de "inteligência de marketing" — venda,
   * promoção, engajamento, branding, educativo, prova social, lançamento, relacionamento, leads).
   * A estrutura da publicação (ângulo, CTA, tom) muda conforme este campo — ver
   * `marketing-objective-classifier.ts`. */
  marketingObjective: MarketingObjective;
  targetAudience: string;
  channel: JoaoSupportedChannel;
  format: string;
  toneOfVoice: string;
  angle: string;
  centralPromise: string;
  valueProposition: string;
  keyMessages: string[];
  recommendedCta: string;
  observations: string[];
  risks: string[];
  nextSteps: string[];
  /** Identidade criativa da campanha (Creative Director Engine) — enriquece o contexto entregue a Bruno/Vanessa/Diego/Nora/Rafa, nunca decide roteiro/direção sozinho. */
  creativeDna: CampaignCreativeDNA;
  /** Repassado de `JoaoStrategyRequestInput.referenceIntelligence` sem alteração — existe aqui só
   * para que Maria/Lucas (que recebem a SAÍDA de João, não o input original) também tenham acesso
   * aos fatos de referência, sem precisar reler/reparsear do banco. */
  referenceIntelligence?: ReferenceIntelligence;
};

export type JoaoMarketingStrategyOutput = JoaoMarketingStrategyCore & {
  mariaBriefing: JoaoMariaBriefing;
  sofiaBriefing: JoaoSofiaBriefing;
  creativeBrief: JoaoCreativeBrief;
  aiSupportUsed: boolean;
  /**
   * `provider.id` devolvido pelo Ícaro quando `aiSupportUsed` é `true` — permite ao relatório
   * final distinguir apoio de IA real (`"developer-ai-assisted"`) de conteúdo determinístico
   * (`"fake-icaro-provider"`, só em testes/demonstrações). `undefined` quando `aiSupportUsed` é
   * `false` (Ícaro não configurado ou apoio de IA não aplicado).
   */
  aiProviderId?: string;
};

export type JoaoStrategyEnhancement = {
  angle?: string;
  centralPromise?: string;
  valueProposition?: string;
  keyMessages?: string[];
  risks?: string[];
};
