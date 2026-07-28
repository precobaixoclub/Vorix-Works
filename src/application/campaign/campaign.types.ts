// Campaign Manager não é uma Skill: não possui manifesto, não é descoberto por Helena e nunca
// participa de um ExecutionPlan. Funciona ACIMA do Arthur — recebe um objetivo de campanha,
// organiza um Campaign Plan com vários conteúdos, e cada conteúdo pode gerar, sob demanda, um
// ExecutionPlan independente chamando `arthur.planFromText` (o mesmo `ArthurTextCommandPlannerPort`
// que a CLI já usa) — nunca o contrário. Campaign Manager não cria copy, imagem ou vídeo.
export const CAMPAIGN_OBJECTIVE_TYPES = ["divulgacao", "captacao", "conversao_especifica", "engajamento"] as const;

export type CampaignObjectiveType = (typeof CAMPAIGN_OBJECTIVE_TYPES)[number];

// Mesmo vocabulário de formato já usado pelo Eduardo (`imagem_unica`/`carrossel`/`reels`/`video`/
// `story`), definido de forma independente aqui: Campaign Manager não importa nada do Eduardo (não
// há relação de dependência entre os dois módulos). A recomendação aqui é só um palpite de
// planejamento embutido no comando enviado ao Arthur — quem decide de fato o formato de cada peça,
// no momento da execução, continua sendo o Eduardo.
export const CAMPAIGN_CONTENT_FORMATS = ["imagem_unica", "carrossel", "reels", "video", "story"] as const;

export type CampaignContentFormat = (typeof CAMPAIGN_CONTENT_FORMATS)[number];

export const CAMPAIGN_CONTENT_ROLES = ["abertura", "desenvolvimento", "prova_social", "cta_final"] as const;

export type CampaignContentRole = (typeof CAMPAIGN_CONTENT_ROLES)[number];

export const CAMPAIGN_CONTENT_PRIORITIES = ["alta", "media", "baixa"] as const;

export type CampaignContentPriority = (typeof CAMPAIGN_CONTENT_PRIORITIES)[number];

export const CAMPAIGN_CONTENT_STATUSES = [
  "pending",
  "execution_planned",
  "in_review",
  "approved",
  "rejected",
  "published",
  "failed",
] as const;

export type CampaignContentStatus = (typeof CAMPAIGN_CONTENT_STATUSES)[number];

export type CampaignContentStatusHistoryEntry = {
  status: CampaignContentStatus;
  occurredAt: string;
  reason?: string;
};

export type CampaignContentItem = {
  id: string;
  order: number;
  role: CampaignContentRole;
  topic: string;
  channel: string;
  recommendedFormat: CampaignContentFormat;
  priority: CampaignContentPriority;
  cta: string;
  scheduledDate: string;
  // Relação entre os conteúdos: todo conteúdo (exceto a abertura) referencia o id da abertura da
  // campanha, modelando explicitamente o fio narrativo que os conecta.
  relatedContentIds: string[];
  status: CampaignContentStatus;
  statusHistory: CampaignContentStatusHistoryEntry[];
  // Comando em texto livre que `generateExecutionPlanForContent` envia ao Arthur — guardado aqui
  // para reprodutibilidade/auditoria mesmo antes do plano ser gerado.
  executionCommand: string;
  executionPlanId?: string;
};

export type CampaignCalendarEntry = {
  date: string;
  contentId: string;
  topic: string;
  channel: string;
};

export type CampaignFrequency = {
  postsPerWeek: number;
  label: string;
};

export type CampaignPlan = {
  id: string;
  clientId: string;
  tenantId?: string;
  objective: string;
  objectiveType: CampaignObjectiveType;
  durationDays: number;
  startDate: string;
  endDate: string;
  persona: string;
  channels: string[];
  frequency: CampaignFrequency;
  calendar: CampaignCalendarEntry[];
  contents: CampaignContentItem[];
  createdAt: string;
  updatedAt: string;
};

export type CampaignStatusSummary = {
  campaignId: string;
  totalContents: number;
  pendingCount: number;
  executionPlannedCount: number;
  inReviewCount: number;
  approvedCount: number;
  rejectedCount: number;
  publishedCount: number;
  failedCount: number;
  percentComplete: number;
};

export type CampaignCreationInput = {
  clientId?: string;
  tenantId?: string;
  objective: string;
  durationDays?: number;
  channels?: string[];
};

export type CampaignQuery = {
  clientId?: string;
  objectiveType?: CampaignObjectiveType;
  limit?: number;
};

export type CampaignIdGenerator = {
  create(prefix: string): string;
};
