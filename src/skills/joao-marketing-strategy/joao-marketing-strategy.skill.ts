import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse, ClaraKnowledgeRecord } from "../../application/knowledge/clara.types.js";
import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, latest, normalize, normalizeStringArray } from "../../shared/utils/skill-parsing.js";
import { buildDeveloperAiPendingResponse, isDeveloperAssistancePending } from "../../shared/utils/developer-ai-assistance.js";
import { deriveCampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import type { DeveloperAssistancePendingOutput } from "../../application/ai/developer-assistance.types.js";
import { joaoMarketingStrategyManifest } from "./joao.manifest.js";
import type { JoaoLogAction, JoaoLoggerPort } from "./joao-log.contract.js";
import type {
  JoaoEditorialBriefSummary,
  JoaoMariaBriefing,
  JoaoMariaBriefingChannel,
  JoaoMarketingStrategyCore,
  JoaoMarketingStrategyOutput,
  JoaoSofiaBriefing,
  JoaoStrategyEnhancement,
  JoaoStrategyRequestInput,
  JoaoSupportedChannel,
} from "./joao-marketing-strategy.types.js";

export type JoaoIdGenerator = {
  create(prefix: string): string;
};

export type JoaoMarketingStrategySkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  icaro?: IcaroBrainPort;
  logger?: JoaoLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: JoaoIdGenerator;
  now?: () => Date;
};

class SequentialJoaoIdGenerator implements JoaoIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopJoaoLogger implements JoaoLoggerPort {
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
      throw new Error(`${portName} não configurado para João.`);
    },
  });
}

/** Une a saída normal de João à pausa aguardando IA desenvolvedora, mesmo padrão de `PedroSkillOutput`. */
export type JoaoSkillOutput = JoaoMarketingStrategyOutput | DeveloperAssistancePendingOutput;

export class JoaoMarketingStrategySkill implements Skill<JoaoStrategyRequestInput, JoaoSkillOutput> {
  readonly manifest = joaoMarketingStrategyManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly icaro?: IcaroBrainPort;
  private readonly logger: JoaoLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: JoaoIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: JoaoMarketingStrategySkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.icaro = dependencies.icaro;
    this.logger = dependencies.logger ?? new NoopJoaoLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialJoaoIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<JoaoStrategyRequestInput>): Promise<SkillResponse<JoaoSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de estratégia de marketing inválida.", request, { errors: validationErrors });
      await this.emit("MarketingStrategyFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
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
      return await this.runStrategy(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante a estratégia de marketing.";
      await this.log("Error", `Erro inesperado em João. ${message}`, request, { error: message });
      await this.emit("MarketingStrategyFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runStrategy(request: SkillRequest<JoaoStrategyRequestInput>): Promise<SkillResponse<JoaoSkillOutput>> {
    await this.log("RequestReceived", "Solicitação de estratégia de marketing recebida por João.", request, {
      channel: request.input.desiredChannel,
      format: request.input.desiredFormat,
      objective: request.input.desiredObjective,
    });
    await this.emit("MarketingStrategyStarted", request, {
      channel: request.input.desiredChannel,
      objective: request.input.desiredObjective,
    });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("MarketingStrategyFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
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
      requester: { id: this.manifest.id, type: "specialist", name: "João" },
      clientId: tenant.clientId,
      modules: [
        "BrandContext",
        "AudienceContext",
        "ProductContext",
        "CampaignContext",
        "ContentContext",
        "IdentityContext",
        "PublishingContext",
      ],
      reason: "Construção de estratégia de marketing para orientar as próximas Skills.",
    });

    await this.log("ContextConsulted", `Contexto consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });
    await this.emit("MarketingContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    const completeness = evaluateContextCompleteness(claraContext);
    if (!completeness.sufficient) {
      await this.log("ContextIncomplete", "Contexto insuficiente na Clara para construir a estratégia com segurança.", request, {
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      await this.emit("MarketingStrategyFailed", request, {
        reason: "INSUFFICIENT_CONTEXT",
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "needs_more_context",
        artifacts: [],
        warnings: [
          `Contexto insuficiente na Clara para o cliente ${tenant.clientId}.`,
          ...completeness.missing.map((item) => `Faltando na Clara: ${item}.`),
        ],
      };
    }

    await this.log("StrategyStarted", "Construção da estratégia de marketing iniciada.", request, { clientId: tenant.clientId });

    let strategy = buildBaselineStrategy(request.input, claraContext);
    let aiSupportUsed = false;
    let aiProviderId: string | undefined;

    if (this.icaro) {
      await this.log("AISupportRequested", "Apoio de IA solicitado ao Ícaro para aprimorar a estratégia.", request, { clientId: tenant.clientId });
      await this.emit("AIGenerationStarted", request, { clientId: tenant.clientId, channel: request.input.desiredChannel });

      try {
        const prompt = buildIcaroStrategyPrompt(request.input, strategy, claraContext);
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
            "Aprimorar apenas ângulo, promessa central, proposta de valor, mensagens principais e riscos.",
          ],
          expectedOutput: "json",
          priority: "quality",
          temperature: 0.6,
          maxTokens: 1200,
        });

        if (aiResponse.status !== "completed") {
          throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para João.");
        }

        const enhancement = parseStrategyEnhancement(String(aiResponse.content ?? ""));
        strategy = mergeStrategyEnhancement(strategy, enhancement);
        aiSupportUsed = true;
        aiProviderId = aiResponse.provider.id;

        await this.log("AISupportApplied", "Apoio de IA aplicado à estratégia.", request, { clientId: tenant.clientId });
        await this.emit("AIGenerationFinished", request, {
          clientId: tenant.clientId,
          provider: aiResponse.provider,
          model: aiResponse.model,
        });
      } catch (error) {
        if (isDeveloperAssistancePending(error)) {
          return buildDeveloperAiPendingResponse(this.manifest.id, request.context.taskId, error);
        }
        const message = error instanceof Error ? error.message : "Erro desconhecido no apoio de IA solicitado por João.";
        await this.log("AISupportFailed", `Apoio de IA falhou; estratégia segue apenas com heurística e contexto da Clara. ${message}`, request, {
          clientId: tenant.clientId,
          error: message,
        });
      }
    } else {
      await this.log("AISupportSkipped", "Ícaro não foi configurado; estratégia segue apenas com heurística e contexto da Clara.", request, {
        clientId: tenant.clientId,
      });
    }

    await this.log("StrategyFinalized", "Estratégia de marketing finalizada.", request, { clientId: tenant.clientId, angle: strategy.angle });
    await this.emit("MarketingStrategyGenerated", request, { clientId: tenant.clientId, aiSupportUsed });

    const mariaBriefing = buildMariaBriefing(strategy, tenant, claraContext);
    const sofiaBriefing = buildSofiaBriefing(strategy, request.input, claraContext);

    await this.log("MariaBriefingCreated", "Briefing estruturado para Maria criado.", request, {
      clientId: tenant.clientId,
      channel: mariaBriefing.channel,
    });
    await this.emit("MariaBriefingCreated", request, { clientId: tenant.clientId, channel: mariaBriefing.channel });

    const output: JoaoMarketingStrategyOutput = {
      ...strategy,
      mariaBriefing,
      sofiaBriefing,
      aiSupportUsed,
      aiProviderId,
    };

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "completed",
      output,
      artifacts: [
        {
          id: this.idGenerator.create("artifact"),
          type: "plan",
          name: "Estratégia de marketing estruturada de João",
          metadata: {
            clientId: tenant.clientId,
            channel: request.input.desiredChannel,
            aiSupportUsed,
          },
        },
      ],
      warnings: [],
    };
  }

  private async resolveClient(input: JoaoStrategyRequestInput): Promise<TenantClientContext> {
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
    action: JoaoLogAction,
    message: string,
    request: SkillRequest<JoaoStrategyRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("joao-log"),
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

  private async emit(name: ZunoEventName, request: SkillRequest<JoaoStrategyRequestInput>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "joao",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: JoaoStrategyRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de estratégia é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!input.desiredChannel?.trim()) errors.push("desiredChannel é obrigatório.");
  if (!input.desiredFormat?.trim()) errors.push("desiredFormat é obrigatório.");
  if (!input.desiredObjective?.trim()) errors.push("desiredObjective é obrigatório.");
  return errors;
}

function evaluateContextCompleteness(context: ClaraContextResponse): { sufficient: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!context.modules.BrandContext?.length) missing.push("BrandContext");
  if (!context.modules.AudienceContext?.length) missing.push("AudienceContext");

  return {
    sufficient: !(missing.includes("BrandContext") && missing.includes("AudienceContext")),
    missing,
  };
}

export function buildBaselineStrategy(
  input: JoaoStrategyRequestInput,
  context: ClaraContextResponse,
): JoaoMarketingStrategyCore {
  const brand = latest(context.modules.BrandContext);
  const audience = latest(context.modules.AudienceContext);
  const product = latest(context.modules.ProductContext);
  const campaign = latest(context.modules.CampaignContext);
  const content = latest(context.modules.ContentContext);
  const publishing = latest(context.modules.PublishingContext);

  const targetAudience = audience?.payload.targetAudience ?? "Público-alvo ainda não detalhado pela Clara.";
  const toneOfVoice = brand?.payload.toneOfVoice ?? "Tom consultivo, claro e confiável.";
  const angle = inferAngle(input.desiredObjective, input.originalRequest);
  const centralPromise = product?.payload.benefits?.[0]
    ? `${product.payload.benefits[0]}.`
    : `Entregar ${input.desiredObjective} com clareza e consistência de marca.`;
  const valueProposition = product?.payload.description ?? brand?.payload.promise ?? "Proposta de valor a ser refinada com mais dados de produto na Clara.";
  const keyMessages = buildKeyMessages(input, brand, product, campaign);
  // O formato e o CTA deixaram de ser decididos por Arthur/João sozinhos: quando o Eduardo já
  // planejou o Editorial Brief, sua decisão é autoritativa. Sem o brief (ex.: João chamado
  // isoladamente em teste), João mantém seu próprio comportamento heurístico de sempre.
  const format = input.editorialBrief?.recommendedFormatLabel ?? input.desiredFormat;
  const recommendedCta = input.editorialBrief?.recommendedCta ?? brand?.payload.preferredCtas?.[0] ?? defaultCtaFor(input.desiredObjective);
  const risks = buildRisks(brand, publishing);
  const nextSteps = buildNextSteps(input);
  const overallStrategy = `Estratégia para ${input.desiredChannel} com foco em ${input.desiredObjective}, direcionada a ${targetAudience}, usando ${angle.charAt(0).toLowerCase()}${angle.slice(1)}`;

  // Creative Director Engine: com a estratégia completa já sintetizada (promessa central, valor,
  // tom, público e mensagens-chave), João consegue refinar o DNA que Eduardo só esboçou — a mesma
  // função pura, com mais contexto disponível. João registra o DNA nas próprias observações para
  // que Bruno/Vanessa/Diego/Nora/Rafa recebam o fio condutor junto com a estratégia.
  const creativeDna = deriveCampaignCreativeDNA({
    originalRequest: input.originalRequest,
    objective: input.desiredObjective,
    centralPromise,
    valueProposition,
    toneOfVoice,
    targetAudience,
    keyMessages,
    brandName: brand?.payload.brandName,
  });
  const observations = [
    ...buildObservations(context, campaign, content, input.editorialBrief),
    `Creative DNA — Big Idea: ${creativeDna.bigIdea}`,
    `Creative DNA — Hero Scene: ${creativeDna.heroScene}`,
  ];

  return {
    overallStrategy,
    objective: input.desiredObjective,
    targetAudience,
    channel: input.desiredChannel,
    format,
    toneOfVoice,
    angle,
    centralPromise,
    valueProposition,
    keyMessages,
    recommendedCta,
    observations,
    risks,
    nextSteps,
    creativeDna,
  };
}

export function buildIcaroStrategyPrompt(
  input: JoaoStrategyRequestInput,
  strategy: JoaoMarketingStrategyCore,
  context: ClaraContextResponse,
): string {
  return [
    "Você é o apoio de IA de João, Especialista em Estratégia de Marketing do Zuno.",
    "Aprimore apenas ângulo, promessa central, proposta de valor, mensagens principais e riscos.",
    "Não crie copy final, imagem, vídeo, campanha ou publicação.",
    "Retorne apenas JSON válido, sem markdown.",
    "",
    "SOLICITAÇÃO ORIGINAL:",
    input.originalRequest,
    "",
    "ESTRATÉGIA BASE:",
    JSON.stringify(strategy, null, 2),
    "",
    "MÓDULOS DE CONHECIMENTO DISPONÍVEIS NA CLARA:",
    JSON.stringify(Object.keys(context.modules), null, 2),
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify(
      {
        angle: strategy.angle,
        centralPromise: strategy.centralPromise,
        valueProposition: strategy.valueProposition,
        keyMessages: strategy.keyMessages,
        risks: strategy.risks,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function parseStrategyEnhancement(content: string): JoaoStrategyEnhancement {
  const parsed = JSON.parse(extractJson(content, "João")) as Partial<Record<keyof JoaoStrategyEnhancement, unknown>>;
  return {
    angle: typeof parsed.angle === "string" && parsed.angle.trim() ? parsed.angle : undefined,
    centralPromise: typeof parsed.centralPromise === "string" && parsed.centralPromise.trim() ? parsed.centralPromise : undefined,
    valueProposition: typeof parsed.valueProposition === "string" && parsed.valueProposition.trim() ? parsed.valueProposition : undefined,
    keyMessages: normalizeStringArray(parsed.keyMessages),
    risks: normalizeStringArray(parsed.risks),
  };
}

export function mergeStrategyEnhancement(
  strategy: JoaoMarketingStrategyCore,
  enhancement: JoaoStrategyEnhancement,
): JoaoMarketingStrategyCore {
  const centralPromise = enhancement.centralPromise ?? strategy.centralPromise;
  const valueProposition = enhancement.valueProposition ?? strategy.valueProposition;
  const keyMessages = enhancement.keyMessages?.length ? enhancement.keyMessages : strategy.keyMessages;
  // O Creative DNA é derivado de centralPromise/valueProposition/keyMessages — se o apoio de IA
  // os reescreve, o DNA precisa ser recalculado junto, ou ficaria descrevendo uma promessa que a
  // estratégia final nem tem mais (mesma classe de bug já corrigida no CTA final de Bruno).
  const creativeDna = (centralPromise !== strategy.centralPromise || valueProposition !== strategy.valueProposition || keyMessages !== strategy.keyMessages)
    ? deriveCampaignCreativeDNA({
        objective: strategy.objective,
        centralPromise,
        valueProposition,
        toneOfVoice: strategy.toneOfVoice,
        targetAudience: strategy.targetAudience,
        keyMessages,
      })
    : strategy.creativeDna;
  return {
    ...strategy,
    angle: enhancement.angle ?? strategy.angle,
    centralPromise,
    valueProposition,
    keyMessages,
    risks: enhancement.risks?.length ? enhancement.risks : strategy.risks,
    creativeDna,
  };
}

export function buildMariaBriefing(
  strategy: JoaoMarketingStrategyCore,
  tenant: TenantClientContext,
  context: ClaraContextResponse,
): JoaoMariaBriefing {
  const brand = latest(context.modules.BrandContext);

  return {
    objective: strategy.objective,
    channel: toMariaBriefingChannel(strategy.channel),
    format: strategy.format,
    targetAudience: strategy.targetAudience,
    toneOfVoice: strategy.toneOfVoice,
    cta: strategy.recommendedCta,
    keyMessage: strategy.keyMessages[0] ?? strategy.centralPromise,
    keywords: brand?.payload.keywords?.length ? brand.payload.keywords : undefined,
    forbiddenTerms: brand?.payload.forbiddenWords?.length ? brand.payload.forbiddenWords : undefined,
    mandatoryWords: brand?.payload.mandatoryWords?.length ? brand.payload.mandatoryWords : undefined,
    preferredHashtags: brand?.payload.preferredHashtags?.length ? brand.payload.preferredHashtags : undefined,
    language: tenant.language,
    additionalContext: strategy.overallStrategy,
  };
}

export function buildSofiaBriefing(
  strategy: JoaoMarketingStrategyCore,
  input: JoaoStrategyRequestInput,
  context: ClaraContextResponse,
): JoaoSofiaBriefing {
  const identity = latest(context.modules.IdentityContext);

  return {
    status: "preliminary",
    channel: strategy.channel,
    format: strategy.format,
    angle: strategy.angle,
    centralPromise: strategy.centralPromise,
    keyMessages: strategy.keyMessages,
    visualDirectionNotes: identity?.payload.visualGuidelines?.length
      ? identity.payload.visualGuidelines
      : ["Nenhuma diretriz visual registrada na Clara ainda."],
    brandIdentityNotes: [
      identity?.payload.colors?.length ? `Cores da marca: ${identity.payload.colors.join(", ")}.` : undefined,
      identity?.payload.imageStyle ? `Estilo visual: ${identity.payload.imageStyle}.` : undefined,
    ].filter((note): note is string => Boolean(note)),
    notes: [
      "Sofia ainda não existe como Skill; este briefing é preliminar e deverá ser revisado quando a Especialista for criada.",
      `Formato solicitado: ${input.desiredFormat}.`,
      `Canal solicitado: ${input.desiredChannel}.`,
      ...buildEditorialBriefNotes(input.editorialBrief),
    ],
  };
}

function buildEditorialBriefNotes(editorialBrief?: JoaoEditorialBriefSummary): string[] {
  if (!editorialBrief) return [];
  return [
    `Plano editorial do Eduardo — estrutura narrativa sugerida: ${editorialBrief.narrativeStructure.join(" → ")}.`,
    `Plano editorial do Eduardo — emoção principal: ${editorialBrief.primaryEmotion}.`,
  ];
}

function toMariaBriefingChannel(channel: JoaoSupportedChannel): JoaoMariaBriefingChannel {
  if (channel === "meta_ads") return "instagram";
  if (channel === "google_ads") return "google_business";
  return channel;
}

function inferAngle(objective: string, originalRequest: string): string {
  const normalized = normalize(`${objective} ${originalRequest}`);
  if (containsAny(normalized, ["vender", "conversao", "comprar", "assinar"])) {
    return "Ângulo de conversão com benefício direto e chamada clara para ação.";
  }
  if (containsAny(normalized, ["educar", "explicar", "ensinar", "informar"])) {
    return "Ângulo educativo com clareza, exemplo prático e autoridade.";
  }
  if (containsAny(normalized, ["engajar", "interacao", "comunidade"])) {
    return "Ângulo de identificação e conversa próxima com o público.";
  }
  if (containsAny(normalized, ["lancar", "lancamento", "novidade"])) {
    return "Ângulo de novidade e expectativa em torno do lançamento.";
  }
  return "Ângulo de valor percebido, clareza e proximidade com o público.";
}

function buildKeyMessages(
  input: JoaoStrategyRequestInput,
  brand?: ClaraKnowledgeRecord<"BrandContext">,
  product?: ClaraKnowledgeRecord<"ProductContext">,
  campaign?: ClaraKnowledgeRecord<"CampaignContext">,
): string[] {
  const messages: string[] = [`Comunicar objetivo: ${input.desiredObjective}.`];

  if (product?.payload.description) messages.push(`Reforçar: ${product.payload.description}`);
  if (product?.payload.differentiators?.length) messages.push(`Destacar diferencial: ${product.payload.differentiators[0]}.`);
  if (brand?.payload.mandatoryWords?.length) messages.push(`Utilizar termos obrigatórios da marca: ${brand.payload.mandatoryWords.join(", ")}.`);
  if (campaign?.payload.objective) messages.push(`Alinhar com a campanha ativa: ${campaign.payload.campaignName} (${campaign.payload.objective}).`);
  if (messages.length < 2) messages.push(`Adequar mensagem ao formato ${input.desiredFormat} no canal ${input.desiredChannel}.`);

  return messages;
}

function defaultCtaFor(objective: string): string {
  const normalized = normalize(objective);
  if (containsAny(normalized, ["vender", "comprar", "assinar", "conversao"])) return "Compre agora";
  if (containsAny(normalized, ["saiba", "educar", "conhecer"])) return "Saiba mais";
  if (containsAny(normalized, ["cadastr", "lead"])) return "Cadastre-se";
  return "Fale com a gente";
}

function buildRisks(brand?: ClaraKnowledgeRecord<"BrandContext">, publishing?: ClaraKnowledgeRecord<"PublishingContext">): string[] {
  const risks: string[] = [];
  if (brand?.payload.forbiddenWords?.length) risks.push(`Evitar termos proibidos pela marca: ${brand.payload.forbiddenWords.join(", ")}.`);
  if (!brand) risks.push("Marca sem diretrizes de tom de voz registradas na Clara; risco de inconsistência de comunicação.");
  if (publishing?.payload.approvalFlow) risks.push(`Respeitar fluxo de aprovação configurado: ${publishing.payload.approvalFlow}.`);
  risks.push("Validar aderência ao canal antes da criação da copy final pela Maria.");
  return risks;
}

function buildObservations(
  context: ClaraContextResponse,
  campaign?: ClaraKnowledgeRecord<"CampaignContext">,
  content?: ClaraKnowledgeRecord<"ContentContext">,
  editorialBrief?: JoaoEditorialBriefSummary,
): string[] {
  const observations: string[] = [];
  if (!context.modules.ProductContext?.length) observations.push("Nenhum produto ou serviço detalhado na Clara; considerar enriquecer o conhecimento do cliente.");
  if (!campaign) observations.push("Nenhuma campanha ativa encontrada na Clara para alinhamento.");
  if (content?.payload.publicationHistory?.length) {
    observations.push(`Histórico de publicações disponível (${content.payload.publicationHistory.length} publicações) para referência de tom e desempenho.`);
  }
  if (editorialBrief) {
    observations.push(`Plano editorial do Eduardo: formato ${editorialBrief.recommendedFormatLabel} (${editorialBrief.formatJustification})`);
  }
  return observations;
}

function buildNextSteps(input: JoaoStrategyRequestInput): string[] {
  return [
    "Encaminhar o briefing estruturado para Maria criar a copy.",
    "Validar a estratégia com o time responsável antes da criação de conteúdo visual.",
    `Reavaliar a estratégia caso o canal ${input.desiredChannel} ou o objetivo mudem.`,
  ];
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

export function createJoaoMarketingStrategySkill(
  dependencies: Partial<JoaoMarketingStrategySkillDependencies> = {},
): JoaoMarketingStrategySkill {
  return new JoaoMarketingStrategySkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    icaro: dependencies.icaro,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
  });
}
