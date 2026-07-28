import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse, ClaraKnowledgeRecord } from "../../application/knowledge/clara.types.js";
import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { QualityFeedbackPort } from "../../application/quality-feedback/quality-feedback.port.js";
import type { QualityFeedbackCategory, QualityFeedbackInsights } from "../../application/quality-feedback/quality-feedback.types.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, latest, normalize, normalizeStringArray } from "../../shared/utils/skill-parsing.js";
import { classifyContentObjective, classifyRecommendedFormat } from "../../shared/utils/content-format-classification.js";
import { deriveCampaignCreativeDNA, type CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import { eduardoEditorialPlanningManifest } from "./eduardo.manifest.js";
import type { EduardoLogAction, EduardoLoggerPort } from "./eduardo-log.contract.js";
import type {
  EduardoComplexityLevel,
  EduardoContentObjective,
  EduardoConversionPriority,
  EduardoDepthLevel,
  EduardoEditorialPlanningOutput,
  EduardoEditorialPlanningRequestInput,
  EduardoRecommendedFormat,
  EduardoStrategyEnhancement,
} from "./eduardo-editorial-planning.types.js";

export type EduardoIdGenerator = {
  create(prefix: string): string;
};

export type EduardoEditorialPlanningSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  icaro?: IcaroBrainPort;
  // Opcional, no mesmo padrão do Ícaro: sem ela, Eduardo decide exclusivamente por heurística e
  // contexto da Clara, exatamente como antes de o módulo Quality Feedback existir.
  qualityFeedback?: QualityFeedbackPort;
  logger?: EduardoLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: EduardoIdGenerator;
  now?: () => Date;
};

class SequentialEduardoIdGenerator implements EduardoIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopEduardoLogger implements EduardoLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

function missingPort<TPort extends object>(portName: string): TPort {
  return new Proxy({} as TPort, {
    get(): never {
      throw new Error(`${portName} não configurado para Eduardo.`);
    },
  });
}

export class EduardoEditorialPlanningSkill implements Skill<EduardoEditorialPlanningRequestInput, EduardoEditorialPlanningOutput> {
  readonly manifest = eduardoEditorialPlanningManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly icaro?: IcaroBrainPort;
  private readonly qualityFeedback?: QualityFeedbackPort;
  private readonly logger: EduardoLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: EduardoIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: EduardoEditorialPlanningSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.icaro = dependencies.icaro;
    this.qualityFeedback = dependencies.qualityFeedback;
    this.logger = dependencies.logger ?? new NoopEduardoLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialEduardoIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<EduardoEditorialPlanningRequestInput>): Promise<SkillResponse<EduardoEditorialPlanningOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de planejamento editorial inválida.", request, { errors: validationErrors });
      await this.emit("EditorialPlanningFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: validationErrors,
        error: {
          code: "INVALID_REQUEST",
          message: validationErrors.join("; "),
          recoverable: true,
        },
      };
    }

    try {
      return await this.runPlanning(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante o planejamento editorial.";
      await this.log("Error", `Erro inesperado em Eduardo. ${message}`, request, { error: message });
      await this.emit("EditorialPlanningFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: { code: "UNEXPECTED_ERROR", message, recoverable: true },
      };
    }
  }

  private async runPlanning(request: SkillRequest<EduardoEditorialPlanningRequestInput>): Promise<SkillResponse<EduardoEditorialPlanningOutput>> {
    await this.log("RequestReceived", "Solicitação de planejamento editorial recebida por Eduardo.", request, {
      channel: request.input.desiredChannel,
      objective: request.input.desiredObjective,
    });
    await this.emit("EditorialPlanningStarted", request, {
      channel: request.input.desiredChannel,
      objective: request.input.desiredObjective,
    });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("EditorialPlanningFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: {
          code: "CLIENT_NOT_FOUND",
          message,
          recoverable: true,
        },
      };
    }

    await this.log("ClientResolved", `Cliente ${tenant.clientId} resolvido pela Valentina.`, request, {
      clientId: tenant.clientId,
      tenantId: tenant.tenantId,
      plan: tenant.plan,
    });

    const claraContext = await this.clara.requestContext({
      requester: { id: this.manifest.id, type: "specialist", name: "Eduardo" },
      clientId: tenant.clientId,
      modules: ["BrandContext", "AudienceContext", "ContentContext"],
      reason: "Planejamento editorial para decidir a melhor estratégia de conteúdo antes do João.",
    });

    await this.log("ContextConsulted", `Contexto consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });
    await this.emit("EditorialPlanningContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    await this.log("PlanningStarted", "Decisão de estratégia de conteúdo iniciada.", request, { clientId: tenant.clientId });

    let brief = buildBaselineEditorialBrief(request.input, claraContext);
    let aiSupportUsed = false;

    if (this.icaro) {
      await this.log("AISupportRequested", "Apoio de IA solicitado ao Ícaro para aprimorar o planejamento editorial.", request, { clientId: tenant.clientId });
      await this.emit("AIGenerationStarted", request, { clientId: tenant.clientId, channel: request.input.desiredChannel });

      try {
        const prompt = buildIcaroPlanningPrompt(request.input, brief, claraContext);
        const aiResponse = await this.icaro.request({
          taskType: "analysis",
          prompt,
          specialistId: this.manifest.id,
          executionId: request.context.executionId,
          taskId: request.context.taskId,
          correlationId: request.context.correlationId,
          context: {
            skillId: this.manifest.id,
            clientId: tenant.clientId,
            channel: request.input.desiredChannel,
          },
          constraints: [
            "Retornar apenas JSON válido.",
            "Não criar copy final, imagem, vídeo, campanha ou publicação.",
            "Não decidir layout, paleta ou tipografia.",
            "Aprimorar apenas justificativa do formato, estrutura narrativa, emoção principal e recomendações para o João — nunca o formato, a quantidade de slides/telas, a duração ou o canal já decididos heuristicamente.",
          ],
          expectedOutput: "json",
          priority: "quality",
          temperature: 0.6,
          maxTokens: 1000,
        });

        if (aiResponse.status !== "completed") {
          throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para Eduardo.");
        }

        const enhancement = parseStrategyEnhancement(String(aiResponse.content ?? ""));
        brief = mergeStrategyEnhancement(brief, enhancement);
        aiSupportUsed = true;

        await this.log("AISupportApplied", "Apoio de IA aplicado ao planejamento editorial.", request, { clientId: tenant.clientId });
        await this.emit("AIGenerationFinished", request, {
          clientId: tenant.clientId,
          provider: aiResponse.provider,
          model: aiResponse.model,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido no apoio de IA solicitado por Eduardo.";
        await this.log("AISupportFailed", `Apoio de IA falhou; planejamento editorial segue apenas com heurística e contexto da Clara. ${message}`, request, {
          clientId: tenant.clientId,
          error: message,
        });
      }
    } else {
      await this.log("AISupportSkipped", "Ícaro não foi configurado; planejamento editorial segue apenas com heurística e contexto da Clara.", request, {
        clientId: tenant.clientId,
      });
    }

    // Consulta ao histórico de Quality Feedback: estritamente aditiva. Nada aqui reatribui
    // `recommendedFormat`, `recommendedSlideCount`, `recommendedVideoDurationSeconds`,
    // `recommendedChannel` ou `recommendedCta` — o feedback só pode acrescentar recomendações em
    // `recommendationsForJoao` (ver `applyFeedbackInsights`). Falha na consulta nunca falha Eduardo.
    let feedbackInformed = false;
    if (this.qualityFeedback) {
      try {
        const insights = await this.qualityFeedback.getInsightsForClient(tenant.clientId);
        if (insights.sampleSize > 0) {
          brief = applyFeedbackInsights(brief, insights);
          feedbackInformed = true;
        }
        await this.log("FeedbackHistoryConsulted", "Histórico de Quality Feedback consultado.", request, {
          clientId: tenant.clientId,
          sampleSize: insights.sampleSize,
          lowScoringCategories: insights.lowScoringCategories,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido ao consultar o histórico de Quality Feedback.";
        await this.log("FeedbackHistoryFailed", `Consulta ao histórico de Quality Feedback falhou; planejamento editorial segue sem esse insumo. ${message}`, request, {
          clientId: tenant.clientId,
          error: message,
        });
      }
    } else {
      await this.log("FeedbackHistorySkipped", "Quality Feedback não foi configurado; planejamento editorial segue sem histórico de avaliações.", request, {
        clientId: tenant.clientId,
      });
    }

    await this.log("PlanningFinalized", "Planejamento editorial finalizado.", request, {
      clientId: tenant.clientId,
      recommendedFormat: brief.recommendedFormat,
    });
    await this.emit("EditorialPlanningGenerated", request, { clientId: tenant.clientId, aiSupportUsed });
    await this.log("JoaoBriefingCreated", "Editorial Brief estruturado para João criado.", request, {
      clientId: tenant.clientId,
      recommendedFormat: brief.recommendedFormat,
    });
    await this.emit("EduardoBriefingCreated", request, { clientId: tenant.clientId, recommendedFormat: brief.recommendedFormat });

    const output: EduardoEditorialPlanningOutput = { ...brief, aiSupportUsed, feedbackInformed };

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "completed",
      output,
      artifacts: [
        {
          id: this.idGenerator.create("artifact"),
          type: "plan",
          name: "Editorial Brief estruturado de Eduardo",
          metadata: {
            clientId: tenant.clientId,
            channel: request.input.desiredChannel,
            recommendedFormat: brief.recommendedFormat,
            aiSupportUsed,
          },
        },
      ],
      warnings: [],
    };
  }

  private async resolveClient(input: EduardoEditorialPlanningRequestInput): Promise<TenantClientContext> {
    if (input.tenantId?.trim()) {
      return this.valentina.getClientContext(input.tenantId);
    }

    const tenant = await this.valentina.getTenant({ clientId: input.clientId, status: "all" });
    if (!tenant) {
      throw new Error(`Valentina não encontrou o cliente ${input.clientId}.`);
    }

    return this.valentina.getClientContext(tenant.id);
  }

  private async log(
    action: EduardoLogAction,
    message: string,
    request: SkillRequest<EduardoEditorialPlanningRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("eduardo-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      executionId: request.context.executionId,
      taskId: request.context.taskId,
      clientId: typeof metadata.clientId === "string" ? metadata.clientId : request.input.clientId,
      tenantId: request.input.tenantId,
      metadata,
    });
  }

  private async emit(
    name: ZunoEventName,
    request: SkillRequest<EduardoEditorialPlanningRequestInput>,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "eduardo",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: EduardoEditorialPlanningRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de planejamento editorial é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!input.desiredChannel?.trim()) errors.push("desiredChannel é obrigatório.");
  if (!input.desiredObjective?.trim()) errors.push("desiredObjective é obrigatório.");
  return errors;
}

// `classifyContentObjective`/`classifyRecommendedFormat` (e as listas de palavras-chave que usam)
// vivem em `src/shared/utils/content-format-classification.ts` — Arthur importa exatamente as
// mesmas funções para decidir qual pipeline (imagem ou vídeo) entra no `ExecutionPlan`, então a
// decisão de formato nunca mais pode divergir entre o plano e o Editorial Brief do Eduardo.

/**
 * Monta o Editorial Brief de forma inteiramente determinística a partir da solicitação e do
 * contexto da Clara — o mesmo raciocínio já usado por João em `buildBaselineStrategy`: nenhuma
 * decisão aqui depende de o Ícaro estar configurado ou responder com sucesso.
 */
export function buildBaselineEditorialBrief(
  input: EduardoEditorialPlanningRequestInput,
  context: ClaraContextResponse,
): Omit<EduardoEditorialPlanningOutput, "aiSupportUsed" | "feedbackInformed"> {
  const brand = latest(context.modules.BrandContext);
  const normalizedText = normalize(`${input.desiredObjective} ${input.originalRequest}`);

  const contentObjective = classifyContentObjective(normalizedText);
  const explicitCount = extractExplicitCount(normalizedText);
  const recommendedFormat = classifyRecommendedFormat(normalizedText, contentObjective);
  const recommendedFormatLabel = formatLabelFor(recommendedFormat);
  const narrativeStructure = narrativeStructureFor(recommendedFormat, contentObjective);
  const primaryEmotion = primaryEmotionFor(contentObjective);
  const { depthLevel, contentComplexity, conversionPriority } = classifyDepthComplexityAndPriority(recommendedFormat, contentObjective);
  const recommendedCta = brand?.payload.preferredCtas?.[0] ?? defaultCtaFor(contentObjective);

  const recommendedSlideCount = recommendedFormat === "carrossel" || recommendedFormat === "story"
    ? explicitCount ?? (recommendedFormat === "carrossel" ? narrativeStructure.length : 3)
    : undefined;
  const recommendedVideoDurationSeconds = recommendedFormat === "reels" || recommendedFormat === "video"
    ? explicitCount ?? 30
    : undefined;

  const formatJustification = formatJustificationFor(recommendedFormat, contentObjective);
  const campaignObjective = campaignObjectiveLabelFor(contentObjective);

  // Creative Director Engine: responde "o que faz esta campanha ser memorável?" antes de Eduardo
  // decidir formato/objetivo — Eduardo é o primeiro a rodar, então só tem `originalRequest`
  // disponível (derivação mais genérica; João refina com a estratégia completa depois).
  const creativeDna = deriveCampaignCreativeDNA({
    originalRequest: input.originalRequest,
    objective: input.desiredObjective,
  });

  const recommendationsForJoao = buildRecommendationsForJoao({
    narrativeStructure,
    primaryEmotion,
    depthLevel,
    contentComplexity,
    conversionPriority,
    recommendedSlideCount,
    recommendedVideoDurationSeconds,
    creativeDna,
  });

  return {
    campaignObjective,
    contentObjective,
    recommendedFormat,
    recommendedFormatLabel,
    formatJustification,
    recommendedSlideCount,
    recommendedVideoDurationSeconds,
    recommendedChannel: input.desiredChannel,
    primaryEmotion,
    narrativeStructure,
    recommendedCta,
    depthLevel,
    contentComplexity,
    conversionPriority,
    recommendationsForJoao,
    creativeDna,
  };
}

/**
 * A quantidade recomendada de slides/telas e a duração de vídeo priorizam um número explícito no
 * texto (ex.: "5 slides", "3 telas", "30 segundos"); na ausência de número explícito, cada formato
 * usa seu próprio padrão (ver `buildBaselineEditorialBrief`).
 */
function extractExplicitCount(normalizedText: string): number | undefined {
  const match = normalizedText.match(/(\d+)\s*(imagens|imagem|fotos|foto|slides|slide|telas|tela|segundos|segundo)/);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function formatLabelFor(format: EduardoRecommendedFormat): string {
  switch (format) {
    case "imagem_unica": return "post único";
    case "carrossel": return "carrossel";
    case "reels": return "reels";
    case "video": return "vídeo";
    case "story": return "story";
    default: return "post único";
  }
}

function narrativeStructureFor(format: EduardoRecommendedFormat, contentObjective: EduardoContentObjective): string[] {
  if (format === "carrossel") {
    if (contentObjective === "conversao") return ["Problema", "Solução", "Benefícios", "Comparação", "CTA"];
    if (contentObjective === "educacao") return ["Contexto", "Explicação", "Exemplo", "CTA"];
    return ["Contexto", "Mensagem central", "Benefícios", "CTA"];
  }
  if (format === "reels" || format === "video") {
    if (contentObjective === "demonstracao") return ["Hook", "Demonstração", "Benefícios", "CTA"];
    return ["Hook", "Contexto", "Benefícios", "CTA"];
  }
  if (format === "story") {
    return ["Abertura", "Informação principal", "CTA"];
  }
  return ["Mensagem central", "CTA"];
}

function primaryEmotionFor(contentObjective: EduardoContentObjective): string {
  switch (contentObjective) {
    case "conversao": return "Confiança";
    case "demonstracao": return "Clareza";
    case "educacao": return "Confiança";
    case "engajamento": return "Proximidade";
    default: return "Leveza";
  }
}

function classifyDepthComplexityAndPriority(
  format: EduardoRecommendedFormat,
  contentObjective: EduardoContentObjective,
): { depthLevel: EduardoDepthLevel; contentComplexity: EduardoComplexityLevel; conversionPriority: EduardoConversionPriority } {
  if (format === "carrossel") {
    return {
      depthLevel: "alto",
      contentComplexity: "media",
      conversionPriority: contentObjective === "conversao" ? "alta" : "media",
    };
  }
  if (format === "reels" || format === "video") {
    return {
      depthLevel: "medio",
      contentComplexity: "alta",
      conversionPriority: contentObjective === "conversao" ? "alta" : contentObjective === "demonstracao" ? "media" : "baixa",
    };
  }
  if (format === "story") {
    return { depthLevel: "baixo", contentComplexity: "baixa", conversionPriority: "media" };
  }
  return {
    depthLevel: "baixo",
    contentComplexity: "baixa",
    conversionPriority: contentObjective === "conversao" ? "alta" : "baixa",
  };
}

function formatJustificationFor(format: EduardoRecommendedFormat, contentObjective: EduardoContentObjective): string {
  if (format === "carrossel") {
    return "Uma narrativa em múltiplos slides aumenta a retenção e a percepção de valor antes do CTA, favorecendo conversão.";
  }
  if (format === "reels" || format === "video") {
    if (contentObjective === "demonstracao") {
      return "Demonstrar uma funcionalidade em vídeo curto transmite clareza e reduz fricção de entendimento melhor do que uma imagem estática.";
    }
    return "Um vídeo curto prende atenção com movimento e ritmo, favorecendo alcance e retenção.";
  }
  if (format === "story") {
    return "Comunicações rápidas e com senso de urgência funcionam melhor em Stories, com poucas telas e leitura imediata.";
  }
  return "Uma mensagem única e direta é suficiente quando o objetivo não exige explicação em múltiplas etapas.";
}

function campaignObjectiveLabelFor(contentObjective: EduardoContentObjective): string {
  switch (contentObjective) {
    case "conversao": return "Conversão";
    case "demonstracao": return "Demonstração";
    case "educacao": return "Educação";
    case "engajamento": return "Engajamento";
    default: return "Awareness";
  }
}

function defaultCtaFor(contentObjective: EduardoContentObjective): string {
  if (contentObjective === "conversao") return "Compre agora";
  if (contentObjective === "educacao") return "Saiba mais";
  if (contentObjective === "engajamento") return "Comente aqui";
  return "Fale com a gente";
}

function buildRecommendationsForJoao(input: {
  narrativeStructure: string[];
  primaryEmotion: string;
  depthLevel: EduardoDepthLevel;
  contentComplexity: EduardoComplexityLevel;
  conversionPriority: EduardoConversionPriority;
  recommendedSlideCount?: number;
  recommendedVideoDurationSeconds?: number;
  creativeDna: CampaignCreativeDNA;
}): string[] {
  const recommendations = [
    `Seguir estrutura narrativa sugerida: ${input.narrativeStructure.join(" → ")}.`,
    `Priorizar a emoção principal: ${input.primaryEmotion}.`,
    `Nível de profundidade recomendado: ${input.depthLevel}; complexidade: ${input.contentComplexity}; prioridade de conversão: ${input.conversionPriority}.`,
    // Creative Director Engine: a Big Idea e a metáfora visual precisam sobreviver até o roteiro
    // final de Bruno/Vanessa — Eduardo já deixa isso explícito para João, o próximo a decidir.
    `Big Idea da campanha: ${input.creativeDna.bigIdea}`,
    `Preservar a metáfora visual ao longo de toda a peça: ${input.creativeDna.visualMetaphor}`,
  ];
  if (input.recommendedSlideCount) recommendations.push(`Planejar exatamente ${input.recommendedSlideCount} slide(s)/tela(s).`);
  if (input.recommendedVideoDurationSeconds) recommendations.push(`Planejar roteiro para aproximadamente ${input.recommendedVideoDurationSeconds} segundos.`);
  return recommendations;
}

export function buildIcaroPlanningPrompt(
  input: EduardoEditorialPlanningRequestInput,
  brief: Omit<EduardoEditorialPlanningOutput, "aiSupportUsed" | "feedbackInformed">,
  context: ClaraContextResponse,
): string {
  return [
    "Você é o apoio de IA de Eduardo, Especialista em Planejamento Editorial do Zuno.",
    "Aprimore apenas justificativa do formato, estrutura narrativa, emoção principal e recomendações para o João.",
    "Não altere formato, quantidade de slides/telas, duração, canal ou CTA — esses já foram decididos heuristicamente.",
    "Não crie copy final, imagem, vídeo, campanha ou publicação. Não decida layout, paleta ou tipografia.",
    "Retorne apenas JSON válido, sem markdown.",
    "",
    "SOLICITAÇÃO ORIGINAL:",
    input.originalRequest,
    "",
    "EDITORIAL BRIEF BASE:",
    JSON.stringify(brief, null, 2),
    "",
    "MÓDULOS DE CONHECIMENTO DISPONÍVEIS NA CLARA:",
    JSON.stringify(Object.keys(context.modules), null, 2),
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify(
      {
        formatJustification: brief.formatJustification,
        narrativeStructure: brief.narrativeStructure,
        primaryEmotion: brief.primaryEmotion,
        recommendationsForJoao: brief.recommendationsForJoao,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function parseStrategyEnhancement(content: string): EduardoStrategyEnhancement {
  const parsed = JSON.parse(extractJson(content, "Eduardo")) as Partial<Record<keyof EduardoStrategyEnhancement, unknown>>;
  return {
    formatJustification: typeof parsed.formatJustification === "string" && parsed.formatJustification.trim() ? parsed.formatJustification : undefined,
    narrativeStructure: normalizeStringArray(parsed.narrativeStructure),
    primaryEmotion: typeof parsed.primaryEmotion === "string" && parsed.primaryEmotion.trim() ? parsed.primaryEmotion : undefined,
    recommendationsForJoao: normalizeStringArray(parsed.recommendationsForJoao),
  };
}

export function mergeStrategyEnhancement(
  brief: Omit<EduardoEditorialPlanningOutput, "aiSupportUsed" | "feedbackInformed">,
  enhancement: EduardoStrategyEnhancement,
): Omit<EduardoEditorialPlanningOutput, "aiSupportUsed" | "feedbackInformed"> {
  return {
    ...brief,
    formatJustification: enhancement.formatJustification ?? brief.formatJustification,
    narrativeStructure: enhancement.narrativeStructure?.length ? enhancement.narrativeStructure : brief.narrativeStructure,
    primaryEmotion: enhancement.primaryEmotion ?? brief.primaryEmotion,
    recommendationsForJoao: enhancement.recommendationsForJoao?.length ? enhancement.recommendationsForJoao : brief.recommendationsForJoao,
  };
}

const CATEGORY_LABELS: Record<QualityFeedbackCategory, string> = {
  estrategia: "estratégia",
  copy: "copy",
  legenda: "legenda",
  cta: "CTA",
  hashtags: "hashtags",
  layout: "layout",
  design: "design",
  hierarquia_visual: "hierarquia visual",
  imagem: "imagem",
  video: "vídeo",
  roteiro: "roteiro",
  tempo: "tempo",
  reels: "Reels",
  qualidade_geral: "qualidade geral",
};

// Formatos considerados "vídeo" para efeito de comparação de desempenho com carrossel.
const VIDEO_LIKE_FORMATS = new Set(["reels", "vídeo", "video"]);

/**
 * Traduz `QualityFeedbackInsights` em recomendações de texto para o João — nunca em uma mudança
 * de decisão. `recommendedFormat`, `recommendedSlideCount`, `recommendedVideoDurationSeconds`,
 * `recommendedChannel` e `recommendedCta` do `brief` recebido permanecem exatamente os mesmos;
 * apenas `recommendationsForJoao` cresce com novas entradas, sempre acrescentadas ao final.
 */
export function applyFeedbackInsights(
  brief: Omit<EduardoEditorialPlanningOutput, "aiSupportUsed" | "feedbackInformed">,
  insights: QualityFeedbackInsights,
): Omit<EduardoEditorialPlanningOutput, "aiSupportUsed" | "feedbackInformed"> {
  const additionalRecommendations: string[] = [];
  const concerningCategories = new Set<QualityFeedbackCategory>([...insights.lowScoringCategories, ...insights.recurringComplaints]);

  if (concerningCategories.has("cta")) {
    additionalRecommendations.push(
      "Histórico de avaliações mostra nota baixa em CTA nas últimas execuções — recomenda-se um CTA mais forte e direto.",
    );
  }

  if (concerningCategories.has("hashtags")) {
    additionalRecommendations.push(
      "Histórico de avaliações mostra nota baixa em hashtags nas últimas execuções — recomenda-se maior variedade de hashtags.",
    );
  }

  for (const category of concerningCategories) {
    if (category === "cta" || category === "hashtags") continue;
    additionalRecommendations.push(
      `Histórico de avaliações mostra nota baixa em ${CATEGORY_LABELS[category]} nas últimas execuções — atenção redobrada nesse aspecto.`,
    );
  }

  const videoPerformance = insights.formatPerformance.find((entry) => VIDEO_LIKE_FORMATS.has(normalize(entry.format)));
  const carouselPerformance = insights.formatPerformance.find((entry) => normalize(entry.format) === normalize("carrossel"));
  if (
    videoPerformance
    && carouselPerformance
    && videoPerformance.averageScore > carouselPerformance.averageScore
    && brief.recommendedFormat === "carrossel"
  ) {
    additionalRecommendations.push(
      `Histórico mostra desempenho melhor em vídeo (média ${videoPerformance.averageScore}) do que em carrossel (média ${carouselPerformance.averageScore}) — considerar recomendar vídeo quando fizer sentido para o objetivo.`,
    );
  }

  if (additionalRecommendations.length === 0) return brief;

  return {
    ...brief,
    recommendationsForJoao: [...brief.recommendationsForJoao, ...additionalRecommendations],
  };
}

export function createEduardoEditorialPlanningSkill(
  dependencies: Partial<EduardoEditorialPlanningSkillDependencies> = {},
): EduardoEditorialPlanningSkill {
  return new EduardoEditorialPlanningSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    icaro: dependencies.icaro,
    qualityFeedback: dependencies.qualityFeedback,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
  });
}
