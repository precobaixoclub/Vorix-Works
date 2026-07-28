import type { ClaraKnowledgePort } from "../knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse } from "../knowledge/clara.types.js";
import type { ArthurTextCommandPlannerPort } from "../orchestration/arthur.contract.js";
import { latest, normalize } from "../../shared/utils/skill-parsing.js";
import type { ValentinaTenantPort } from "../tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../events/zuno-event.contract.js";
import type { CampaignLoggerPort } from "./campaign-log.contract.js";
import type { CampaignManagerPort, CampaignContentExecutionPlanResult } from "./campaign-manager.port.js";
import type { CampaignRepositoryPort } from "./campaign-repository.port.js";
import {
  CAMPAIGN_CONTENT_STATUSES,
  type CampaignCalendarEntry,
  type CampaignContentFormat,
  type CampaignContentItem,
  type CampaignContentPriority,
  type CampaignContentRole,
  type CampaignContentStatus,
  type CampaignCreationInput,
  type CampaignIdGenerator,
  type CampaignObjectiveType,
  type CampaignPlan,
  type CampaignQuery,
  type CampaignStatusSummary,
} from "./campaign.types.js";

export type CampaignManagerDependencies = {
  valentina: ValentinaTenantPort;
  arthur: ArthurTextCommandPlannerPort;
  clara?: ClaraKnowledgePort;
  repository: CampaignRepositoryPort;
  logger?: CampaignLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: CampaignIdGenerator;
  now?: () => Date;
};

const DEFAULT_DURATION_DAYS = 30;
const MIN_CONTENT_COUNT = 3;
const MAX_CONTENT_COUNT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOFT_CTA_DEFAULT = "Saiba mais";
const STRONG_CTA_DEFAULT = "Comece agora";
const DEFAULT_CHANNELS = ["instagram", "facebook"];

type ContentTemplate = {
  role: CampaignContentRole;
  topic: string;
  format: CampaignContentFormat;
};

const TEMPLATES_BY_OBJECTIVE: Record<CampaignObjectiveType, ContentTemplate[]> = {
  divulgacao: [
    { role: "abertura", topic: "Apresentação da marca e da proposta principal", format: "carrossel" },
    { role: "desenvolvimento", topic: "Funcionalidade em destaque", format: "reels" },
    { role: "prova_social", topic: "Depoimento ou prova social de quem já usa", format: "imagem_unica" },
    { role: "desenvolvimento", topic: "Lembrete rápido da proposta", format: "story" },
    { role: "cta_final", topic: "Convite direto para conhecer a plataforma", format: "carrossel" },
  ],
  captacao: [
    { role: "abertura", topic: "A dor de organizar o casamento sem ajuda", format: "carrossel" },
    { role: "desenvolvimento", topic: "Como a plataforma resolve essa dor", format: "reels" },
    { role: "desenvolvimento", topic: "Passo a passo de como começar", format: "carrossel" },
    { role: "prova_social", topic: "Casais que já organizaram o casamento com a plataforma", format: "imagem_unica" },
    { role: "cta_final", topic: "Convite para casais recém-noivos começarem agora", format: "story" },
  ],
  conversao_especifica: [
    { role: "abertura", topic: "Teaser sobre {recurso}", format: "story" },
    { role: "desenvolvimento", topic: "Explicação do benefício principal de {recurso}", format: "carrossel" },
    { role: "desenvolvimento", topic: "Passo a passo de como usar {recurso}", format: "reels" },
    { role: "prova_social", topic: "Prova social sobre {recurso}", format: "imagem_unica" },
    { role: "cta_final", topic: "CTA final para usar {recurso} agora", format: "carrossel" },
  ],
  engajamento: [
    { role: "abertura", topic: "Pergunta ou enquete para engajar o público", format: "story" },
    { role: "desenvolvimento", topic: "Conteúdo educativo relacionado ao tema", format: "carrossel" },
    { role: "prova_social", topic: "Bastidores ou conteúdo descontraído", format: "imagem_unica" },
    { role: "cta_final", topic: "Convite para comentar e compartilhar", format: "reels" },
  ],
};

class SequentialCampaignIdGenerator implements CampaignIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopCampaignLogger implements CampaignLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

export class CampaignManager implements CampaignManagerPort {
  private readonly valentina: ValentinaTenantPort;
  private readonly arthur: ArthurTextCommandPlannerPort;
  private readonly clara?: ClaraKnowledgePort;
  private readonly repository: CampaignRepositoryPort;
  private readonly logger: CampaignLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: CampaignIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: CampaignManagerDependencies) {
    this.valentina = dependencies.valentina;
    this.arthur = dependencies.arthur;
    this.clara = dependencies.clara;
    this.repository = dependencies.repository;
    this.logger = dependencies.logger ?? new NoopCampaignLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialCampaignIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async createCampaign(input: CampaignCreationInput): Promise<CampaignPlan> {
    const errors = validateCreationInput(input);
    if (errors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de campanha inválida.", undefined, undefined, undefined, { errors });
      throw new Error(errors.join("; "));
    }

    const tenant = await this.resolveClient(input);

    const claraContext = this.clara
      ? await this.clara.requestContext({
          requester: { id: "campaign-manager", type: "system", name: "Campaign Manager" },
          clientId: tenant.clientId,
          modules: ["BrandContext", "AudienceContext"],
          reason: "Planejamento de campanha para persona e CTA.",
        })
      : undefined;

    const objectiveType = classifyCampaignObjective(input.objective);
    const durationDays = input.durationDays ?? extractDurationDays(input.objective) ?? DEFAULT_DURATION_DAYS;
    const channels = input.channels?.length ? input.channels : (detectChannels(input.objective) ?? DEFAULT_CHANNELS);
    const persona = buildPersona(objectiveType, claraContext);
    const resource = extractSpecificResource(input.objective);
    const contentCount = clamp(Math.round(durationDays / 3), MIN_CONTENT_COUNT, MAX_CONTENT_COUNT);
    const startDate = this.timestamp();
    const endDate = addDays(startDate, durationDays);

    const contents = this.buildContents({
      objectiveType,
      contentCount,
      durationDays,
      startDate,
      channels,
      resource,
      claraContext,
    });

    const plan: CampaignPlan = {
      id: this.idGenerator.create("campaign"),
      clientId: tenant.clientId,
      tenantId: tenant.tenantId,
      objective: input.objective,
      objectiveType,
      durationDays,
      startDate,
      endDate,
      persona,
      channels,
      frequency: buildFrequency(contentCount, durationDays),
      calendar: buildCalendar(contents),
      contents,
      createdAt: this.timestamp(),
      updatedAt: this.timestamp(),
    };

    await this.repository.save(plan);
    await this.log("CampaignCreated", `Campanha ${plan.id} criada com ${contents.length} conteúdo(s).`, plan.id, undefined, plan.clientId, {
      objectiveType,
      durationDays,
      contentCount: contents.length,
    });
    await this.emit("CampaignCreated", plan, { objectiveType, contentCount: contents.length });
    return clone(plan);
  }

  async listCampaigns(query: CampaignQuery = {}): Promise<CampaignPlan[]> {
    const plans = await this.repository.list();
    await this.log("CampaignListed", "Histórico de campanhas consultado.", undefined, undefined, query.clientId, { query });
    return applyQuery(plans, query);
  }

  async getCampaign(campaignId: string): Promise<CampaignPlan | undefined> {
    return clone(await this.repository.findById(campaignId));
  }

  async generateExecutionPlanForContent(campaignId: string, contentId: string): Promise<CampaignContentExecutionPlanResult> {
    const plan = await this.requireCampaign(campaignId);
    const content = requireContent(plan, contentId);

    await this.log("ExecutionPlanRequested", `ExecutionPlan solicitado ao Arthur para o conteúdo ${contentId}.`, campaignId, contentId, plan.clientId);

    try {
      const { executionPlan } = await this.arthur.planFromText({
        command: content.executionCommand,
        clientId: plan.clientId,
        tenantId: plan.tenantId,
      });

      content.executionPlanId = executionPlan.id;
      if (content.status === "pending") {
        appendStatus(content, "execution_planned", this.timestamp());
      }
      plan.updatedAt = this.timestamp();
      await this.repository.save(plan);

      await this.log("ExecutionPlanGenerated", `ExecutionPlan ${executionPlan.id} gerado para o conteúdo ${contentId}.`, campaignId, contentId, plan.clientId, {
        executionPlanId: executionPlan.id,
      });
      await this.emit("CampaignContentExecutionPlanGenerated", plan, { contentId, executionPlanId: executionPlan.id });
      return { contentId, executionPlan };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao gerar ExecutionPlan pelo Arthur.";
      await this.log("ExecutionPlanGenerationFailed", `Falha ao gerar ExecutionPlan para o conteúdo ${contentId}. ${message}`, campaignId, contentId, plan.clientId, {
        error: message,
      });
      throw error;
    }
  }

  async updateContentStatus(campaignId: string, contentId: string, status: CampaignContentStatus, reason?: string): Promise<CampaignContentItem> {
    if (!CAMPAIGN_CONTENT_STATUSES.includes(status)) {
      const message = `Status inválido: ${String(status)}. Status válidos: ${CAMPAIGN_CONTENT_STATUSES.join(", ")}.`;
      await this.log("StatusUpdateFailed", message, campaignId, contentId, undefined, { status });
      throw new Error(message);
    }

    const plan = await this.requireCampaign(campaignId);
    const content = requireContent(plan, contentId);

    appendStatus(content, status, this.timestamp(), reason);
    plan.updatedAt = this.timestamp();
    await this.repository.save(plan);

    await this.log("StatusUpdated", `Conteúdo ${contentId} atualizado para status ${status}.`, campaignId, contentId, plan.clientId, { status, reason });
    await this.emit("CampaignContentStatusChanged", plan, { contentId, status, reason });
    return clone(content);
  }

  async getStatusSummary(campaignId: string): Promise<CampaignStatusSummary> {
    const plan = await this.requireCampaign(campaignId);
    await this.log("SummaryRequested", `Resumo de status solicitado para a campanha ${campaignId}.`, campaignId, undefined, plan.clientId);
    return buildStatusSummary(plan);
  }

  private buildContents(input: {
    objectiveType: CampaignObjectiveType;
    contentCount: number;
    durationDays: number;
    startDate: string;
    channels: string[];
    resource?: string;
    claraContext?: ClaraContextResponse;
  }): CampaignContentItem[] {
    const templates = TEMPLATES_BY_OBJECTIVE[input.objectiveType];
    const brand = latestBrand(input.claraContext);
    const softCta = brand?.preferredCtas?.[0] ?? SOFT_CTA_DEFAULT;
    const strongCta = brand?.preferredCtas?.[1] ?? brand?.preferredCtas?.[0] ?? STRONG_CTA_DEFAULT;

    const contents: CampaignContentItem[] = [];
    let openingId: string | undefined;

    for (let index = 0; index < input.contentCount; index += 1) {
      const isFirst = index === 0;
      const isLast = index === input.contentCount - 1;
      const template = templates[index % templates.length];
      const role: CampaignContentRole = isFirst ? "abertura" : isLast ? "cta_final" : normalizeMiddleRole(template.role);
      const format: CampaignContentFormat = isFirst ? templates[0].format : isLast ? templates[templates.length - 1].format : template.format;
      const priority: CampaignContentPriority = isFirst || isLast ? "alta" : role === "prova_social" ? "media" : "baixa";
      const isStrongCta = isLast;
      const cta = isStrongCta ? strongCta : softCta;
      const channel = input.channels[index % input.channels.length];
      const scheduledDate = addDays(input.startDate, Math.floor((index * input.durationDays) / input.contentCount));
      const topic = interpolateResource(template.topic, input.resource);
      const id = this.idGenerator.create("campaign-content");

      if (isFirst) openingId = id;

      const item: CampaignContentItem = {
        id,
        order: index + 1,
        role,
        topic,
        channel,
        recommendedFormat: format,
        priority,
        cta,
        scheduledDate,
        relatedContentIds: isFirst || !openingId ? [] : [openingId],
        status: "pending",
        statusHistory: [{ status: "pending", occurredAt: this.timestamp() }],
        executionCommand: buildExecutionCommand({ topic, format, channel, cta }),
      };
      contents.push(item);
    }

    return contents;
  }

  private async resolveClient(input: CampaignCreationInput): Promise<TenantClientContext> {
    if (input.tenantId?.trim()) {
      return this.valentina.getClientContext(input.tenantId);
    }

    const tenant = await this.valentina.getTenant({ clientId: input.clientId, status: "all" });
    if (!tenant) {
      throw new Error(`Valentina não encontrou o cliente ${input.clientId}.`);
    }

    return this.valentina.getClientContext(tenant.id);
  }

  private async requireCampaign(campaignId: string): Promise<CampaignPlan> {
    const plan = await this.repository.findById(campaignId);
    if (!plan) throw new Error(`Campanha ${campaignId} não encontrada.`);
    return plan;
  }

  private async log(
    action: Parameters<CampaignLoggerPort["record"]>[0]["action"],
    message: string,
    campaignId: string | undefined,
    contentId: string | undefined,
    clientId: string | undefined,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("campaign-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      campaignId,
      contentId,
      clientId,
      metadata,
    });
  }

  private async emit(name: ZunoEventName, plan?: CampaignPlan, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      payload: {
        source: "campaign-manager",
        campaignId: plan?.id,
        clientId: plan?.clientId,
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateCreationInput(input: CampaignCreationInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de campanha é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.objective?.trim()) errors.push("objective é obrigatório.");
  if (input.durationDays !== undefined && (!Number.isInteger(input.durationDays) || input.durationDays <= 0)) {
    errors.push("durationDays deve ser um inteiro maior que zero quando informado.");
  }
  if (input.channels !== undefined && input.channels.length === 0) {
    errors.push("channels não pode ser uma lista vazia quando informado.");
  }
  return errors;
}

function requireContent(plan: CampaignPlan, contentId: string): CampaignContentItem {
  const content = plan.contents.find((candidate) => candidate.id === contentId);
  if (!content) throw new Error(`Conteúdo ${contentId} não encontrado na campanha ${plan.id}.`);
  return content;
}

function appendStatus(content: CampaignContentItem, status: CampaignContentStatus, occurredAt: string, reason?: string): void {
  content.status = status;
  content.statusHistory.push({ status, occurredAt, reason });
}

const CONVERSION_RESOURCE_KEYWORDS: Array<{ phrase: string; resource: string }> = [
  { phrase: "lista de presentes", resource: "a lista de presentes" },
  { phrase: "confirmacao de presenca", resource: "a confirmação de presença" },
  { phrase: "rsvp", resource: "a confirmação de presença" },
  { phrase: "painel", resource: "o painel dos noivos" },
];

const CAPTATION_KEYWORDS = ["captar", "atrair", "conquistar", "recem-noivo", "recem-noivos", "recem noivo", "recem noivos", "recem-casado", "recem casado"];
const ENGAGEMENT_KEYWORDS = ["engajar", "engajamento", "interagir", "comunidade", "interacao"];

function classifyCampaignObjective(text: string): CampaignObjectiveType {
  const normalizedText = normalize(text);
  if (CONVERSION_RESOURCE_KEYWORDS.some(({ phrase }) => normalizedText.includes(normalize(phrase)))) return "conversao_especifica";
  if (containsAny(normalizedText, CAPTATION_KEYWORDS)) return "captacao";
  if (containsAny(normalizedText, ENGAGEMENT_KEYWORDS)) return "engajamento";
  return "divulgacao";
}

function extractSpecificResource(text: string): string | undefined {
  const normalizedText = normalize(text);
  return CONVERSION_RESOURCE_KEYWORDS.find(({ phrase }) => normalizedText.includes(normalize(phrase)))?.resource;
}

function interpolateResource(topic: string, resource?: string): string {
  return topic.replace("{recurso}", resource ?? "o recurso da campanha");
}

/**
 * Prioriza um número explícito no texto ("30 dias", "2 semanas", "1 mes"); na ausência de duração
 * explícita, `createCampaign` usa `DEFAULT_DURATION_DAYS`.
 */
function extractDurationDays(text: string): number | undefined {
  const normalizedText = normalize(text);
  const daysMatch = normalizedText.match(/(\d+)\s*dias?/);
  if (daysMatch) return Number.parseInt(daysMatch[1], 10);
  const weeksMatch = normalizedText.match(/(\d+)\s*semanas?/);
  if (weeksMatch) return Number.parseInt(weeksMatch[1], 10) * 7;
  const monthsMatch = normalizedText.match(/(\d+)\s*mes(es)?/);
  if (monthsMatch) return Number.parseInt(monthsMatch[1], 10) * 30;
  return undefined;
}

const CHANNEL_KEYWORDS: Array<{ channel: string; terms: string[] }> = [
  { channel: "instagram", terms: ["instagram", "insta"] },
  { channel: "facebook", terms: ["facebook", "face"] },
  { channel: "tiktok", terms: ["tiktok", "tik tok"] },
  { channel: "youtube", terms: ["youtube"] },
  { channel: "linkedin", terms: ["linkedin"] },
  { channel: "threads", terms: ["threads"] },
  { channel: "pinterest", terms: ["pinterest"] },
];

function detectChannels(text: string): string[] | undefined {
  const normalizedText = normalize(text);
  const channels = CHANNEL_KEYWORDS.filter(({ terms }) => terms.some((term) => normalizedText.includes(normalize(term)))).map(({ channel }) => channel);
  return channels.length > 0 ? channels : undefined;
}

function buildPersona(objectiveType: CampaignObjectiveType, claraContext?: ClaraContextResponse): string {
  const audience = latest(claraContext?.modules.AudienceContext)?.payload.targetAudience;
  if (audience) return audience;

  switch (objectiveType) {
    case "captacao":
      return "Casais recém-noivos organizando o casamento e buscando praticidade.";
    case "conversao_especifica":
      return "Noivos e convidados interessados no recurso específico da campanha.";
    case "engajamento":
      return "Seguidores atuais da marca buscando conteúdo leve e interativo.";
    default:
      return "Público amplo interessado em casamentos e organização de eventos.";
  }
}

function latestBrand(claraContext?: ClaraContextResponse): { preferredCtas?: string[] } | undefined {
  return latest(claraContext?.modules.BrandContext)?.payload;
}

function normalizeMiddleRole(role: CampaignContentRole): CampaignContentRole {
  // Evita que um conteúdo do meio da campanha herde o papel de abertura/fechamento só porque o
  // ciclo de templates repetiu — esses papéis são reservados ao primeiro e ao último conteúdo.
  if (role === "abertura" || role === "cta_final") return "desenvolvimento";
  return role;
}

function buildExecutionCommand(input: { topic: string; format: CampaignContentFormat; channel: string; cta: string }): string {
  return `Crie um ${formatLabel(input.format)} para ${channelLabel(input.channel)} sobre ${input.topic}, com CTA: ${input.cta}.`;
}

function formatLabel(format: CampaignContentFormat): string {
  switch (format) {
    case "imagem_unica": return "post único";
    case "carrossel": return "carrossel";
    case "reels": return "reels";
    case "video": return "vídeo";
    case "story": return "story";
    default: return "post único";
  }
}

function channelLabel(channel: string): string {
  switch (channel) {
    case "instagram": return "Instagram";
    case "facebook": return "Facebook";
    case "tiktok": return "TikTok";
    case "youtube": return "YouTube";
    case "linkedin": return "LinkedIn";
    case "threads": return "Threads";
    case "pinterest": return "Pinterest";
    default: return channel;
  }
}

function buildFrequency(contentCount: number, durationDays: number): { postsPerWeek: number; label: string } {
  const weeks = Math.max(durationDays / 7, 1);
  const postsPerWeek = roundToOneDecimal(contentCount / weeks);
  return { postsPerWeek, label: `~${postsPerWeek}x por semana` };
}

function buildCalendar(contents: CampaignContentItem[]): CampaignCalendarEntry[] {
  return [...contents]
    .sort((left, right) => Date.parse(left.scheduledDate) - Date.parse(right.scheduledDate))
    .map((content) => ({ date: content.scheduledDate, contentId: content.id, topic: content.topic, channel: content.channel }));
}

function buildStatusSummary(plan: CampaignPlan): CampaignStatusSummary {
  const counts: Record<CampaignContentStatus, number> = {
    pending: 0,
    execution_planned: 0,
    in_review: 0,
    approved: 0,
    rejected: 0,
    published: 0,
    failed: 0,
  };
  for (const content of plan.contents) counts[content.status] += 1;

  const totalContents = plan.contents.length;
  const percentComplete = totalContents > 0 ? roundToOneDecimal(((counts.approved + counts.published) / totalContents) * 100) : 0;

  return {
    campaignId: plan.id,
    totalContents,
    pendingCount: counts.pending,
    executionPlannedCount: counts.execution_planned,
    inReviewCount: counts.in_review,
    approvedCount: counts.approved,
    rejectedCount: counts.rejected,
    publishedCount: counts.published,
    failedCount: counts.failed,
    percentComplete,
  };
}

function applyQuery(plans: CampaignPlan[], query: CampaignQuery): CampaignPlan[] {
  const filtered = plans.filter((plan) => {
    if (query.clientId && plan.clientId !== query.clientId) return false;
    if (query.objectiveType && plan.objectiveType !== query.objectiveType) return false;
    return true;
  });
  return typeof query.limit === "number" ? filtered.slice(0, query.limit) : filtered;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * DAY_MS).toISOString();
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}

export function createCampaignManager(dependencies: CampaignManagerDependencies): CampaignManager {
  return new CampaignManager(dependencies);
}
