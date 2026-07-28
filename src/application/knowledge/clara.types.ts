export type ClaraKnowledgeModule =
  | "BrandContext"
  | "BusinessContext"
  | "AudienceContext"
  | "ProductContext"
  | "CampaignContext"
  | "ContentContext"
  | "IdentityContext"
  | "PublishingContext"
  | "AIContext"
  | "WorkflowContext"
  | "FutureContext"
  // Módulos novos da fase "inteligência de marketing" (ver docs/clara-knowledge-center.md):
  // sem equivalente anterior em nenhum módulo existente, então nenhuma Skill os consulta ainda —
  // passam a existir na Clara e ficam prontos para uma Skill pedir explicitamente no futuro
  // (adicionar o nome à própria lista de `modules` da Skill), sem qualquer mudança em Skill nesta
  // fase.
  | "MarketingContext"
  | "LearningContext"
  | "CompetitionContext"
  | "PlaybookContext"
  // Último módulo da fase "inteligência de marketing" — ver docs/clara-knowledge-center.md e
  // docs/clara-editorial-library-report.md. Alimentado automaticamente (nunca escrito à mão por
  // nenhuma Skill) por `syncEditorialLibrary` sempre que uma campanha/conteúdo recebe avaliação.
  | "EditorialLibraryContext";

export type ClaraKnowledgeActor = {
  id: string;
  type: "specialist" | "arthur" | "caio" | "helena" | "icaro" | "system" | "human";
  name?: string;
};

export type ClaraAuditMetadata = {
  actor: ClaraKnowledgeActor;
  reason?: string;
  correlationId?: string;
};

export type ClaraKnowledgeBase = {
  clientId: string;
  brandId?: string;
  campaignId?: string;
  publicationId?: string;
  productId?: string;
  serviceId?: string;
  workflowId?: string;
  keywords?: string[];
};

export type BrandContext = ClaraKnowledgeBase & {
  brandName: string;
  positioning?: string;
  promise?: string;
  toneOfVoice?: string;
  preferredHashtags?: string[];
  forbiddenHashtags?: string[];
  preferredCtas?: string[];
  mandatoryWords?: string[];
  forbiddenWords?: string[];
  importantLinks?: string[];
  // Campos da fase "inteligência de marketing" (Módulo 1 — Identidade da Marca). Todos opcionais:
  // registros antigos de BrandContext continuam válidos sem nenhum deles (ver
  // `resolveContentQualityProfile`-style fallback seguro — nenhuma Skill quebra por ausência).
  /** Missão da marca. */
  mission?: string;
  /** Visão da marca. */
  vision?: string;
  /** Valores da marca. */
  values?: string[];
  /** Propósito da marca (o "porquê" além do produto). */
  purpose?: string;
  /** Traços de personalidade da marca (ex.: "acolhedora", "direta", "divertida"). */
  personality?: string[];
  /** Arquétipos de marca predominantes (ex.: "Cuidador", "Explorador", "Sábio"). */
  archetypes?: string[];
  /** Nível de formalidade da comunicação. */
  formalityLevel?: "muito informal" | "informal" | "neutro" | "formal" | "muito formal";
  /** Emojis preferenciais da marca, além do tom de voz textual. */
  preferredEmojis?: string[];
  /** Emojis que a marca nunca deve usar. */
  forbiddenEmojis?: string[];
  /** Estilo de comunicação (ex.: "direto e objetivo", "caloroso e narrativo"). */
  communicationStyle?: string;
  /** Forma de tratamento ao público (ex.: "você", "tu", "senhor(a)"). */
  audienceAddressForm?: string;
};

export type BusinessContext = ClaraKnowledgeBase & {
  businessName: string;
  segment?: string;
  description?: string;
  marketingObjectives?: string[];
  connectedSocialNetworks?: string[];
  clientSettings?: Record<string, unknown>;
};

export type AudienceContext = ClaraKnowledgeBase & {
  targetAudience: string;
  // Módulo 3 — Personas: cada persona ganhou campos novos e opcionais (idade, momento de vida,
  // objetivos, medos, objeções, gatilhos emocionais, linguagem/canais preferidos, estágio do
  // funil). `name`/`description`/`pains`/`desires` são os únicos campos que já existiam —
  // "desires" cobre tanto desejos quanto sonhos. Registros antigos sem os campos novos continuam
  // válidos (todos opcionais).
  personas?: Array<{
    name: string;
    description: string;
    age?: string;
    lifeMoment?: string;
    goals?: string[];
    pains?: string[];
    fears?: string[];
    desires?: string[];
    objections?: string[];
    emotionalTriggers?: string[];
    preferredLanguage?: string;
    preferredChannels?: string[];
    funnelStage?: "topo" | "meio" | "fundo";
  }>;
};

export type ProductContext = ClaraKnowledgeBase & {
  productName?: string;
  serviceName?: string;
  description: string;
  benefits?: string[];
  differentiators?: string[];
  priceRange?: string;
  // Módulo 2 — Produto. Todos opcionais; registros antigos continuam válidos.
  /** Funcionalidades do produto/serviço. */
  features?: string[];
  /** Objeções comuns de quem ainda não comprou/assinou. */
  objections?: string[];
  /** Argumentos de venda validados. */
  salesArguments?: string[];
  /** Dúvidas frequentes dos clientes. */
  faq?: Array<{ question: string; answer: string }>;
  /** Limitações conhecidas do produto/serviço. */
  limitations?: string[];
  /** Comparativos com alternativas/concorrentes específicos. */
  comparisons?: Array<{ competitor: string; comparison: string }>;
  /** Erros comuns cometidos pelos clientes ao usar o produto/serviço. */
  commonCustomerMistakes?: string[];
  /** Vantagens competitivas, distintas dos diferenciais gerais. */
  competitiveAdvantages?: string[];
};

export type CampaignContext = ClaraKnowledgeBase & {
  campaignName: string;
  status: "draft" | "active" | "paused" | "finished";
  objective?: string;
  channels?: string[];
  startDate?: string;
  endDate?: string;
};

export type ContentContext = ClaraKnowledgeBase & {
  editorialCalendar?: Array<{
    date: string;
    channel: string;
    topic: string;
    status: "planned" | "created" | "published" | "cancelled";
  }>;
  publicationHistory?: Array<{
    publicationId: string;
    channel: string;
    publishedAt: string;
    title?: string;
    url?: string;
  }>;
};

export type IdentityContext = ClaraKnowledgeBase & {
  colors?: string[];
  fonts?: string[];
  logoUri?: string;
  imageStyle?: string;
  visualGuidelines?: string[];
  // Módulo 5 — Direção Criativa. Todos opcionais; registros antigos continuam válidos.
  /** Referências visuais (marcas, campanhas, estéticas) usadas como norte criativo. */
  visualReferences?: string[];
  /** Diretriz de composição predominante. */
  composition?: string;
  /** Diretriz de iluminação predominante. */
  lighting?: string;
  /** Enquadramentos preferidos. */
  framing?: string[];
  /** Estilo fotográfico preferido. */
  photographyStyle?: string;
  /** Diretrizes para uso de mockups. */
  mockupGuidelines?: string[];
  /** Estilo de iconografia preferido. */
  iconography?: string[];
  /** Estilos de fundo aceitos. */
  backgroundStyles?: string[];
  /** Padrões de layout recorrentes e aprovados. */
  layoutPatterns?: string[];
  /** Exemplos de peças aprovadas, como referência positiva. */
  approvedExamples?: Array<{ description: string; uri?: string }>;
  /** Exemplos de peças reprovadas, com o motivo, como referência negativa. */
  rejectedExamples?: Array<{ description: string; reason?: string }>;
};

export type PublishingContext = ClaraKnowledgeBase & {
  connectedSocialNetworks?: Array<{
    network: string;
    handle?: string;
    status: "connected" | "pending" | "disabled";
  }>;
  postingRules?: string[];
  approvalFlow?: string;
};

export type AIContext = ClaraKnowledgeBase & {
  preferredModels?: string[];
  forbiddenModels?: string[];
  creativityLevel?: "low" | "medium" | "high";
  languagePreferences?: string[];
  costPreference?: "quality" | "balanced" | "cost";
};

export type WorkflowContext = ClaraKnowledgeBase & {
  workflowName: string;
  executionId?: string;
  usedContext?: Record<string, unknown>;
  notes?: string[];
};

export type FutureContext = ClaraKnowledgeBase & {
  ideas?: string[];
  experiments?: string[];
  opportunities?: string[];
};

/** Módulo 4 — Marketing: repertório tático reutilizável entre peças, campanhas e temas. */
export type MarketingContext = ClaraKnowledgeBase & {
  preferredCtas?: string[];
  hooks?: string[];
  storytellingFrameworks?: string[];
  mentalTriggers?: string[];
  openingStyles?: string[];
  closingStyles?: string[];
  captionStyles?: string[];
  preferredFormats?: string[];
  campaignObjectives?: string[];
  seasonalCalendar?: Array<{ date: string; theme: string; notes?: string }>;
  usedThemes?: string[];
  forbiddenThemes?: string[];
  idealFrequency?: string;
};

/**
 * Módulo 6 — Aprendizado: alimentado automaticamente a partir do Quality Feedback (ver
 * `clara-learning-sync.ts`) — não é esperado que nenhuma Skill escreva aqui diretamente.
 */
export type LearningContext = ClaraKnowledgeBase & {
  bestRatedContent?: Array<{ executionId: string; format: string; score: number }>;
  rejectedContent?: Array<{ executionId: string; format: string; score: number; reasons?: string[] }>;
  recurringPatterns?: string[];
  qualityEvolution?: Array<{ period: string; averageScore: number }>;
  futureRecommendations?: string[];
  /** Quando este registro foi sincronizado pela última vez a partir do Quality Feedback. */
  lastSyncedAt?: string;
};

/** Módulo 7 — Concorrência. */
export type CompetitionContext = ClaraKnowledgeBase & {
  competitors?: Array<{ name: string; strengths?: string[]; weaknesses?: string[] }>;
  opportunities?: string[];
  clientDifferentiators?: string[];
};

/**
 * Módulo 8 — Playbook. "Histórico de mudanças" não precisa de campo próprio: todo
 * `ClaraKnowledgeRecord` (qualquer módulo) já tem `versions`/`history` genéricos — ver
 * `docs/clara-knowledge-center.md`.
 */
export type PlaybookContext = ClaraKnowledgeBase & {
  brandRules?: string[];
  bestPractices?: string[];
  campaignExamples?: string[];
  approvedCampaigns?: string[];
  rejectedCampaigns?: string[];
  importantDecisions?: string[];
};

/** Um conteúdo produzido, registrado na Biblioteca Editorial a cada avaliação recebida. */
export type EditorialLibraryContentEntry = {
  executionId: string;
  campaignId?: string;
  theme: string;
  format?: string;
  objective?: string;
  cta?: string;
  emojis?: string[];
  hook?: string;
  storytellingFramework?: string;
  score?: number;
  producedAt?: string;
};

export type EditorialLibraryEvaluation = {
  executionId: string;
  score: number;
  format?: string;
  comment?: string;
};

export type EditorialLibraryHighlightedContent = {
  executionId: string;
  theme: string;
  format?: string;
  score: number;
};

export type EditorialLibraryLowPerformanceContent = EditorialLibraryHighlightedContent & {
  reasons?: string[];
};

export type EditorialLibraryForbiddenSubject = {
  subject: string;
  reason: string;
  until?: string;
};

/**
 * Módulo 9 — Biblioteca Editorial: conhecimento editorial acumulado da marca (o que já foi
 * produzido, o que funcionou, o que não funcionou, o que evitar repetir). Nunca substitui o
 * Quality Feedback — ela **interpreta** o histórico que o Quality Feedback já registra (e o
 * conteúdo real de cada execução) e produz conhecimento editorial derivado. Alimentada
 * automaticamente por `syncEditorialLibrary` (ver `clara-editorial-library-sync.ts`), nunca escrita
 * à mão por nenhuma Skill.
 */
export type EditorialLibraryContext = ClaraKnowledgeBase & {
  producedContent?: EditorialLibraryContentEntry[];
  usedThemes?: string[];
  usedFormats?: string[];
  campaigns?: string[];
  objectives?: string[];
  ctas?: string[];
  emojis?: string[];
  hooks?: string[];
  storytellingPatterns?: string[];
  evaluations?: EditorialLibraryEvaluation[];
  workingPatterns?: string[];
  nonWorkingPatterns?: string[];
  repeatedSubjects?: string[];
  temporarilyForbiddenSubjects?: EditorialLibraryForbiddenSubject[];
  championContent?: EditorialLibraryHighlightedContent[];
  lowPerformanceContent?: EditorialLibraryLowPerformanceContent[];
  futureRecommendations?: string[];
  /** Quando este registro foi sincronizado pela última vez a partir de uma avaliação real. */
  lastSyncedAt?: string;
};

export type ClaraKnowledgePayloadByModule = {
  BrandContext: BrandContext;
  BusinessContext: BusinessContext;
  AudienceContext: AudienceContext;
  ProductContext: ProductContext;
  CampaignContext: CampaignContext;
  ContentContext: ContentContext;
  IdentityContext: IdentityContext;
  PublishingContext: PublishingContext;
  AIContext: AIContext;
  WorkflowContext: WorkflowContext;
  FutureContext: FutureContext;
  MarketingContext: MarketingContext;
  LearningContext: LearningContext;
  CompetitionContext: CompetitionContext;
  PlaybookContext: PlaybookContext;
  EditorialLibraryContext: EditorialLibraryContext;
};

export type ClaraKnowledgePayload = ClaraKnowledgePayloadByModule[ClaraKnowledgeModule];

export type ClaraKnowledgeVersion<TPayload extends ClaraKnowledgePayload = ClaraKnowledgePayload> = {
  version: number;
  createdAt: string;
  createdBy: ClaraKnowledgeActor;
  reason?: string;
  payload: TPayload;
  changeSummary: string;
};

export type ClaraKnowledgeHistoryEntry = {
  id: string;
  occurredAt: string;
  action: "created" | "updated" | "deleted";
  actor: ClaraKnowledgeActor;
  reason?: string;
  version: number;
  changeSummary: string;
};

export type ClaraKnowledgeRecord<TModule extends ClaraKnowledgeModule = ClaraKnowledgeModule> = {
  id: string;
  module: TModule;
  clientId: string;
  title: string;
  status: "active" | "deleted";
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  payload: ClaraKnowledgePayloadByModule[TModule];
  versions: ClaraKnowledgeVersion<ClaraKnowledgePayloadByModule[TModule]>[];
  history: ClaraKnowledgeHistoryEntry[];
  tags: string[];
};

export type ClaraCreateKnowledgeInput<TModule extends ClaraKnowledgeModule = ClaraKnowledgeModule> = {
  module: TModule;
  title: string;
  payload: ClaraKnowledgePayloadByModule[TModule];
  tags?: string[];
  audit: ClaraAuditMetadata;
};

export type ClaraUpdateKnowledgeInput<TModule extends ClaraKnowledgeModule = ClaraKnowledgeModule> = {
  id: string;
  patch: Partial<ClaraKnowledgePayloadByModule[TModule]>;
  title?: string;
  tags?: string[];
  audit: ClaraAuditMetadata;
};

export type ClaraDeleteKnowledgeInput = {
  id: string;
  audit: ClaraAuditMetadata;
};

export type ClaraKnowledgeQuery = {
  id?: string;
  clientId?: string;
  module?: ClaraKnowledgeModule;
  brandId?: string;
  campaignId?: string;
  publicationId?: string;
  productId?: string;
  serviceId?: string;
  workflowId?: string;
  status?: "active" | "deleted" | "all";
  limit?: number;
};

export type ClaraKnowledgeSearchQuery = ClaraKnowledgeQuery & {
  text?: string;
  keywords?: string[];
};

export type ClaraContextRequest = {
  requester: ClaraKnowledgeActor;
  clientId: string;
  modules?: ClaraKnowledgeModule[];
  scope?: {
    brandId?: string;
    campaignId?: string;
    productId?: string;
    serviceId?: string;
    publicationId?: string;
    workflowId?: string;
  };
  reason?: string;
};

export type ClaraContextResponse = {
  clientId: string;
  deliveredAt: string;
  modules: Partial<{
    [TModule in ClaraKnowledgeModule]: Array<ClaraKnowledgeRecord<TModule>>;
  }>;
  records: ClaraKnowledgeRecord[];
};

export type ClaraIdGenerator = {
  create(prefix: string): string;
};
