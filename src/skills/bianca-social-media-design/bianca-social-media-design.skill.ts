import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse, ClaraKnowledgeRecord } from "../../application/knowledge/clara.types.js";
import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, latest, normalize, normalizeStringArray } from "../../shared/utils/skill-parsing.js";
import { buildDeveloperAiPendingResponse, isDeveloperAssistancePending } from "../../shared/utils/developer-ai-assistance.js";
import { ANTI_GENERIC_VISUAL_CONSTRAINTS } from "../../shared/utils/visual-reference-library.js";
import { hasStrongCommercialFact } from "../../shared/utils/reference-intelligence.types.js";
import { rankCommercialArguments, type CommercialArgumentInputs } from "../../shared/utils/commercial-argument-ranking.js";
import { selectLayoutFamily, resolveCompatibleDensity, LAYOUT_FAMILY_RULES } from "../../shared/utils/layout-family-rules.js";
import { resolveInformationBudget, applyInformationBudget } from "../../shared/utils/information-budget.js";
import { clampZoneToSafeArea, type AdSafeZonePlatform } from "../../shared/utils/ad-safe-zones.js";
import type { AdLayoutSpec, AdLayoutZone, AdLayoutZoneType, PerformanceCreativePlan, VisualDensity } from "../../shared/utils/ad-layout.types.js";
import type { DeveloperAssistancePendingOutput } from "../../application/ai/developer-assistance.types.js";
import { biancaSocialMediaDesignManifest } from "./bianca.manifest.js";
import type { BiancaLogAction, BiancaLoggerPort } from "./bianca-log.contract.js";
import type {
  BiancaArtDirectorAssessment,
  BiancaCarouselFlow,
  BiancaDesignCore,
  BiancaDesignEnhancement,
  BiancaDesignOutput,
  BiancaDesignRequestInput,
  BiancaPedroBriefing,
  BiancaSlideDesign,
  BiancaTypographyScale,
} from "./bianca-social-media-design.types.js";

export type BiancaIdGenerator = {
  create(prefix: string): string;
};

export type BiancaSocialMediaDesignSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  icaro?: IcaroBrainPort;
  logger?: BiancaLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: BiancaIdGenerator;
  now?: () => Date;
};

class SequentialBiancaIdGenerator implements BiancaIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopBiancaLogger implements BiancaLoggerPort {
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
      throw new Error(`${portName} não configurado para Bianca.`);
    },
  });
}

/** Une a saída normal de Bianca à pausa aguardando IA desenvolvedora, mesmo padrão de `PedroSkillOutput`. */
export type BiancaSkillOutput = BiancaDesignOutput | DeveloperAssistancePendingOutput;

export class BiancaSocialMediaDesignSkill implements Skill<BiancaDesignRequestInput, BiancaSkillOutput> {
  readonly manifest = biancaSocialMediaDesignManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly icaro?: IcaroBrainPort;
  private readonly logger: BiancaLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: BiancaIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: BiancaSocialMediaDesignSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.icaro = dependencies.icaro;
    this.logger = dependencies.logger ?? new NoopBiancaLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialBiancaIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<BiancaDesignRequestInput>): Promise<SkillResponse<BiancaSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de design de redes sociais inválida.", request, { errors: validationErrors });
      await this.emit("DesignFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
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
      return await this.runDesign(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante o design de redes sociais.";
      await this.log("Error", `Erro inesperado em Bianca. ${message}`, request, { error: message });
      await this.emit("DesignFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runDesign(request: SkillRequest<BiancaDesignRequestInput>): Promise<SkillResponse<BiancaSkillOutput>> {
    await this.log("RequestReceived", "Solicitação de design de redes sociais recebida por Bianca.", request, {
      channel: request.input.channel,
      format: request.input.format,
    });
    await this.emit("DesignStarted", request, { channel: request.input.channel, format: request.input.format });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("DesignFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
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
      requester: { id: this.manifest.id, type: "specialist", name: "Bianca" },
      clientId: tenant.clientId,
      modules: ["IdentityContext", "PublishingContext"],
      reason: "Construção do layout detalhado a partir da direção de arte da Sofia.",
    });

    await this.log("DesignContextConsulted", `Contexto de design consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });
    await this.emit("DesignContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    const completeness = evaluateDesignContextCompleteness(claraContext);
    if (!completeness.sufficient) {
      await this.log("ContextIncomplete", "Contexto de identidade visual insuficiente na Clara para montar o layout com segurança.", request, {
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      await this.emit("DesignFailed", request, {
        reason: "INSUFFICIENT_IDENTITY_CONTEXT",
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "needs_more_context",
        artifacts: [],
        warnings: [
          `Contexto de identidade visual insuficiente na Clara para o cliente ${tenant.clientId}.`,
          ...completeness.missing.map((item) => `Faltando na Clara: ${item}.`),
        ],
      };
    }

    let design = buildBaselineDesign(request.input, claraContext);
    let aiSupportUsed = false;
    let aiProviderId: string | undefined;

    if (this.icaro) {
      await this.log("AISupportRequested", "Apoio de IA solicitado ao Ícaro para aprimorar a especificação de design.", request, { clientId: tenant.clientId });
      await this.emit("AIGenerationStarted", request, { clientId: tenant.clientId, channel: request.input.channel });

      try {
        const prompt = buildIcaroDesignPrompt(request.input, design, claraContext);
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
            channel: request.input.channel,
          },
          constraints: [
            "Retornar apenas JSON válido.",
            "Não gerar imagem final; apenas descrever decisões de layout em texto.",
            "Não alterar conceito criativo, paleta, tipografia ou emoção — isso é responsabilidade da Sofia.",
            "Aprimorar apenas grid, composição, hierarquia, aplicação de cor, componentes, regras visuais, uso de mídia e justificativa técnica.",
          ],
          expectedOutput: "json",
          priority: "quality",
          temperature: 0.5,
          maxTokens: 2200,
        });

        if (aiResponse.status !== "completed") {
          throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para Bianca.");
        }

        const enhancement = parseDesignEnhancement(String(aiResponse.content ?? ""));
        design = mergeDesignEnhancement(design, enhancement);
        aiSupportUsed = true;
        aiProviderId = aiResponse.provider.id;

        await this.log("AISupportApplied", "Apoio de IA aplicado à especificação de design.", request, { clientId: tenant.clientId });
        await this.emit("AIGenerationFinished", request, {
          clientId: tenant.clientId,
          provider: aiResponse.provider,
          model: aiResponse.model,
        });
      } catch (error) {
        if (isDeveloperAssistancePending(error)) {
          return buildDeveloperAiPendingResponse(this.manifest.id, request.context.taskId, error);
        }
        const message = error instanceof Error ? error.message : "Erro desconhecido no apoio de IA solicitado por Bianca.";
        await this.log("AISupportFailed", `Apoio de IA falhou; layout segue apenas com heurística e contexto da Clara. ${message}`, request, {
          clientId: tenant.clientId,
          error: message,
        });
      }
    } else {
      await this.log("AISupportSkipped", "Ícaro não foi configurado; layout segue apenas com heurística e contexto da Clara.", request, {
        clientId: tenant.clientId,
      });
    }

    await this.log("DesignFinalized", "Especificação de design finalizada.", request, { clientId: tenant.clientId, slideCount: design.slides.length });
    await this.emit("DesignSpecGenerated", request, { clientId: tenant.clientId, aiSupportUsed, slideCount: design.slides.length });

    const pedroBriefing = buildPedroBriefing(design, request.input);

    await this.log("PedroBriefingCreated", "Briefing de design detalhado para o Pedro criado.", request, {
      clientId: tenant.clientId,
      channel: pedroBriefing.channel,
    });
    await this.emit("PedroBriefingCreated", request, { clientId: tenant.clientId, channel: pedroBriefing.channel });

    const output: BiancaDesignOutput = {
      ...design,
      pedroBriefing,
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
          name: "Especificação de design estruturada de Bianca",
          metadata: {
            clientId: tenant.clientId,
            channel: request.input.channel,
            slideCount: design.slides.length,
            aiSupportUsed,
          },
        },
      ],
      warnings: [],
    };
  }

  private async resolveClient(input: BiancaDesignRequestInput): Promise<TenantClientContext> {
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
    action: BiancaLogAction,
    message: string,
    request: SkillRequest<BiancaDesignRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("bianca-log"),
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

  private async emit(name: ZunoEventName, request: SkillRequest<BiancaDesignRequestInput>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "bianca",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: BiancaDesignRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de design é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!input.channel?.trim()) errors.push("channel é obrigatório.");
  if (!input.format?.trim()) errors.push("format é obrigatório.");
  if (!input.joaoStrategy || typeof input.joaoStrategy !== "object" || !input.joaoStrategy.angle?.trim()) {
    errors.push("joaoStrategy é obrigatório e precisa conter ao menos angle.");
  }
  if (!input.sofiaDirection || typeof input.sofiaDirection !== "object" || !input.sofiaDirection.visualConcept?.trim()) {
    errors.push("sofiaDirection é obrigatório e precisa conter ao menos visualConcept.");
  }
  if (!input.sofiaBriefing || typeof input.sofiaBriefing !== "object" || !input.sofiaBriefing.visualConcept?.trim()) {
    errors.push("sofiaBriefing é obrigatório e precisa conter ao menos visualConcept.");
  }
  return errors;
}

function evaluateDesignContextCompleteness(context: ClaraContextResponse): { sufficient: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!context.modules.IdentityContext?.length) missing.push("IdentityContext");
  return { sufficient: missing.length === 0, missing };
}

// Fase 4 — pelo menos 3 níveis de densidade, escolhidos pelo objetivo e pela quantidade de
// argumentos comerciais realmente disponíveis (nunca por preferência estética isolada).
function resolveVisualDensity(objective: string | undefined, argumentCount: number): VisualDensity {
  if (argumentCount <= 1) return "clean";
  if (argumentCount >= 5) return "max_performance";
  return "performance";
}

// Fase 2 — plano criativo de performance: transforma creative_brief + Reference Intelligence +
// copy real numa estratégia visual de conversão. Função DETERMINÍSTICA e pura — nunca passa pelo
// aprimoramento de IA da Bianca (`buildIcaroDesignPrompt`), só lê fatos já confirmados a montante.
// `undefined` quando não há sinal comercial/copy algum disponível (ex.: `campaign_creation`) —
// degrada para o comportamento de sempre (só o design-spec em prosa).
export function buildPerformanceCreativePlan(input: BiancaDesignRequestInput): PerformanceCreativePlan | undefined {
  const creativeBrief = input.joaoStrategy.creativeBrief;
  const referenceIntelligence = input.joaoStrategy.referenceIntelligence;
  const commercialFacts = referenceIntelligence?.commercialFacts;
  const mariaCopy = input.mariaCopy;

  const hasAnySignal = Boolean(creativeBrief || hasStrongCommercialFact(commercialFacts) || mariaCopy);
  if (!hasAnySignal) return undefined;

  const price = commercialFacts?.currentPrice;
  const oldPrice = commercialFacts?.previousPrice;
  const discount = commercialFacts?.discountPercent;
  const offer = creativeBrief?.offer ?? commercialFacts?.promotion;
  const urgency = commercialFacts?.promotion;
  const cta = mariaCopy?.cta ?? input.joaoStrategy.recommendedCta;
  const primaryHook = mariaCopy?.imageHeadline ?? mariaCopy?.title;
  const secondaryHook = mariaCopy?.title && mariaCopy.title !== primaryHook ? mariaCopy.title : undefined;
  const benefits = [creativeBrief?.mainBenefit].filter((value): value is string => Boolean(value?.trim()));
  const trustSignals = [commercialFacts?.shippingInfo].filter((value): value is string => Boolean(value?.trim()));
  const specifications = (commercialFacts?.commercialConditions ?? []).filter((value) => Boolean(value?.trim()));

  const commercialArguments: CommercialArgumentInputs = {
    price,
    discount,
    promotion: offer,
    mainBenefit: creativeBrief?.mainBenefit,
    shipping: commercialFacts?.shippingInfo,
    paymentTerms: commercialFacts?.commercialConditions?.[0],
    differentiator: creativeBrief?.differentiator,
    cta,
  };
  const informationPriority = rankCommercialArguments(commercialArguments);

  const objective = creativeBrief?.marketingObjective ?? "performance";
  const preferredDensity = resolveVisualDensity(objective, informationPriority.length);
  const layoutFamily = selectLayoutFamily({
    objective,
    infoQuantity: informationPriority.length,
    hasStrongPrice: Boolean(price),
    hasDiscount: Boolean(discount),
    hasSocialProof: false,
    hasUrgency: Boolean(urgency),
    hasManyBenefits: benefits.length >= 2,
    format: input.sofiaDirection.recommendedAspectRatio,
    hasReferenceImage: Boolean(referenceIntelligence),
  });
  const visualDensity = resolveCompatibleDensity(layoutFamily, preferredDensity);

  return {
    objective,
    creativeType: hasStrongCommercialFact(commercialFacts) ? "oferta" : "produto",
    primaryHook,
    secondaryHook,
    heroProduct: creativeBrief?.productOrService,
    offer,
    price,
    oldPrice,
    discount,
    socialProof: undefined,
    benefits,
    trustSignals,
    specifications,
    urgency,
    cta: cta ?? "Saiba mais",
    brandElements: [],
    visualDensity,
    layoutFamily,
    informationPriority,
  };
}

const DEFAULT_ZONE_POSITIONS: Record<AdLayoutZoneType, { xPct: number; yPct: number; widthPct: number; heightPct: number }> = {
  headline: { xPct: 6, yPct: 6, widthPct: 88, heightPct: 18 },
  price: { xPct: 6, yPct: 62, widthPct: 44, heightPct: 16 },
  discount: { xPct: 6, yPct: 40, widthPct: 30, heightPct: 14 },
  cta: { xPct: 6, yPct: 84, widthPct: 88, heightPct: 10 },
  benefits: { xPct: 52, yPct: 40, widthPct: 42, heightPct: 36 },
  specs: { xPct: 52, yPct: 40, widthPct: 42, heightPct: 36 },
  badge: { xPct: 68, yPct: 6, widthPct: 26, heightPct: 12 },
  rating: { xPct: 68, yPct: 20, widthPct: 26, heightPct: 10 },
  salesProof: { xPct: 68, yPct: 32, widthPct: 26, heightPct: 10 },
  logo: { xPct: 6, yPct: 6, widthPct: 18, heightPct: 10 },
  heroProduct: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
};

// Mapeia cada argumento comercial ranqueado (Fase 3) pro tipo de zona correspondente no layout.
const COMMERCIAL_ARGUMENT_TO_ZONE_TYPE: Partial<Record<keyof CommercialArgumentInputs, AdLayoutZoneType>> = {
  price: "price",
  discount: "discount",
  promotion: "badge",
  mainBenefit: "benefits",
  socialProof: "salesProof",
  rating: "rating",
  salesCount: "salesProof",
  shipping: "specs",
  paymentTerms: "specs",
  specification: "specs",
  differentiator: "benefits",
  cta: "cta",
};

function resolveSafeZonePlatform(channel: string, format: string, aspectRatio: string): AdSafeZonePlatform | undefined {
  const normalizedChannel = normalize(channel);
  const normalizedFormat = normalize(format);
  if (normalizedChannel.includes("tiktok")) return "tiktok";
  if (aspectRatio === "9:16" || containsAny(normalizedFormat, ["story", "stories"])) {
    if (containsAny(normalizedFormat, ["reels"]) || normalizedChannel.includes("reels")) return "instagram_reels";
    return "instagram_stories";
  }
  if (normalizedChannel.includes("facebook")) return "facebook_feed";
  return "instagram_feed";
}

// Fase 5-6 — Layout Spec estruturado: zonas com tipo/prioridade/posição, escolhidas pela família
// de layout (regras, não template fixo) e cortadas pelo orçamento de informação (Fase 14) +
// safe zones (Fase 15). `undefined` quando não há plano criativo (mesma condição de ausência de
// `performanceCreativePlan`).
export function buildAdLayoutSpec(plan: PerformanceCreativePlan | undefined, input: BiancaDesignRequestInput): AdLayoutSpec | undefined {
  if (!plan) return undefined;

  const rule = LAYOUT_FAMILY_RULES[plan.layoutFamily];
  const aspectRatio = input.sofiaDirection.recommendedAspectRatio;
  const platform = resolveSafeZonePlatform(input.channel, input.format, aspectRatio);

  const candidateTypes = new Set<AdLayoutZoneType>();
  if (plan.primaryHook) candidateTypes.add("headline");
  for (const argument of plan.informationPriority as Array<keyof CommercialArgumentInputs>) {
    const zoneType = COMMERCIAL_ARGUMENT_TO_ZONE_TYPE[argument];
    if (zoneType && rule.allowedZoneTypes.includes(zoneType)) candidateTypes.add(zoneType);
  }
  // CTA sempre entra quando a família permite, mesmo que não tenha "vencido" o ranking de
  // argumentos comerciais — uma peça de conversão sem CTA visível não cumpre a função.
  if (rule.allowedZoneTypes.includes("cta") && plan.cta) candidateTypes.add("cta");

  const rankedTypes = Array.from(candidateTypes).sort((left, right) => {
    const leftPriority = rule.defaultZonePriority[left] ?? 9;
    const rightPriority = rule.defaultZonePriority[right] ?? 9;
    return leftPriority - rightPriority;
  });

  const zones: AdLayoutZone[] = rankedTypes.map((type, index) => ({
    type,
    priority: rule.defaultZonePriority[type] ?? index + 1,
    position: clampZoneToSafeArea(DEFAULT_ZONE_POSITIONS[type], platform),
  }));

  const budget = resolveInformationBudget(plan.visualDensity, aspectRatio);
  const budgetedZones = applyInformationBudget(zones, budget);

  return {
    format: input.format,
    aspectRatio,
    layoutFamily: plan.layoutFamily,
    density: plan.visualDensity,
    zones: budgetedZones,
  };
}

export function buildBaselineDesign(input: BiancaDesignRequestInput, context: ClaraContextResponse): BiancaDesignCore {
  const identity = latest(context.modules.IdentityContext);
  const publishing = latest(context.modules.PublishingContext);

  const designConcept = `Layout que traduz o conceito visual "${input.sofiaDirection.visualConcept}" em uma peça extremamente escaneável para ${input.channel}.`;
  const slides = buildSlides(input);
  const performanceCreativePlan = buildPerformanceCreativePlan(input);
  const adLayoutSpec = buildAdLayoutSpec(performanceCreativePlan, input);

  return {
    designConcept,
    visualConcept: input.sofiaDirection.visualConcept,
    emotionalObjective: buildEmotionalObjective(input),
    desiredFeeling: buildDesiredFeeling(input),
    minimalismLevel: buildMinimalismLevel(input),
    visualStyle: buildVisualStyle(input),
    recommendedStyle: input.sofiaDirection.recommendedStyle,
    suggestedPalette: input.sofiaDirection.suggestedPalette,
    recommendedFormat: input.sofiaDirection.recommendedFormat,
    recommendedAspectRatio: input.sofiaDirection.recommendedAspectRatio,
    gridSystem: buildGridSystem(input),
    visualHierarchyStrategy: buildVisualHierarchyStrategy(input),
    typographyScale: buildTypographyScale(input),
    compositionStrategy: buildCompositionStrategy(input),
    lightingStrategy: buildLightingStrategy(input),
    depthStrategy: buildDepthStrategy(input),
    contrastStrategy: buildContrastStrategy(input),
    colorApplication: buildColorApplication(input),
    spacingSystem: buildSpacingSystem(),
    componentStyle: buildComponentStyle(),
    illustrationStyle: buildIllustrationStyle(input),
    mockupStyle: buildMockupStyle(input),
    iconographyUsage: buildIconographyUsage(input),
    mockupUsage: buildMockupUsage(input),
    photographyUsage: buildPhotographyUsage(input),
    illustrationUsage: buildIllustrationUsage(input),
    cardUsage: buildCardUsage(input),
    colorBlockUsage: buildColorBlockUsage(input),
    photoTreatment: buildPhotoTreatment(input),
    decorativeElements: buildDecorativeElements(input),
    logoPlacement: identity?.payload.logoUri
      ? "Canto inferior, pequeno e discreto, consistente em todos os slides."
      : "Reservar área discreta para a logo assim que o ativo real for cadastrado na Clara.",
    instagramSafeArea: buildInstagramSafeArea(input),
    logoSizing: buildLogoSizing(input),
    titleSizing: buildTitleSizing(input),
    subtitleSizing: buildSubtitleSizing(input),
    supportTextSizing: buildSupportTextSizing(input),
    buttonSizing: buildButtonSizing(input),
    elementSpacingRules: buildElementSpacingRules(input),
    alignmentRules: buildAlignmentRules(input),
    shadowRules: buildShadowRules(input),
    ctaPlacement: buildCtaPlacement(input),
    reelsCoverComposition: buildReelsCoverComposition(input),
    coverRules: buildCoverRules(input),
    internalSlideRules: buildInternalSlideRules(input),
    finalCtaRules: buildFinalCtaRules(input),
    reelsCoverRules: buildReelsCoverRules(input),
    contrastRules: buildContrastRules(),
    accessibilityGuidelines: buildAccessibilityGuidelines(),
    visualStandardizationRules: buildVisualStandardizationRules(input, slides),
    slides,
    carouselFlow: buildCarouselFlow(input, slides),
    designConstraints: buildDesignConstraints(publishing),
    designRisks: buildDesignRisks(input, identity),
    observations: buildObservations(input, context),
    nextSteps: buildNextSteps(input),
    technicalJustification: buildTechnicalJustification(input, slides),
    performanceCreativePlan,
    adLayoutSpec,
  };
}

export function buildIcaroDesignPrompt(
  input: BiancaDesignRequestInput,
  design: BiancaDesignCore,
  context: ClaraContextResponse,
): string {
  return [
    "Você é o apoio de IA de Bianca, Especialista em Design para Redes Sociais do Zuno.",
    "Bianca pensa como Diretora de Arte, não apenas como diagramadora: cada slide já tem, na especificação base, uma decisão de elemento dominante, percentual de tela ocupado, para onde o olho vai primeiro, emoção antes da leitura, tempo de compreensão, tensão visual, equilíbrio e contraste (ver `slides[].artDirection`) — preserve esse raciocínio ao aprimorar.",
    "Aprimore apenas grid, composição, hierarquia visual, aplicação de cor, estilo de componentes, uso de mídia, regras de contraste, diretrizes de acessibilidade, regras de slides e justificativa técnica.",
    "Não altere conceito criativo, paleta, tipografia ou emoção — isso é responsabilidade da Sofia, apenas repita o que já foi definido.",
    "Não gere imagem final, apenas descreva decisões de layout em texto.",
    "Retorne apenas JSON válido, sem markdown.",
    "",
    "PADRÃO DE QUALIDADE OBRIGATÓRIO:",
    [
      "- grid consistente, hierarquia visual inequívoca e uso intencional de espaço em branco;",
      "- contraste suficiente entre texto, CTA, fundo e elementos de apoio, seguindo as regras de contraste já calculadas;",
      "- pouco texto por slide, sempre priorizando composição sobre densidade de informação;",
      "- estilo de componentes (cards, ícones, botões) coerente slide a slide;",
      "- acessibilidade visual real, não apenas estética — legibilidade e leitura por daltonismo.",
      "- capa com impacto visual forte e um único foco;",
      "- slide final com CTA visualmente dominante e pronto para ação;",
      "- regras claras para mockups, fotografias, ilustrações, cards e blocos coloridos;",
      `- ${ANTI_GENERIC_VISUAL_CONSTRAINTS[ANTI_GENERIC_VISUAL_CONSTRAINTS.length - 1]}.`,
    ].join("\n"),
    "",
    "RESTRIÇÕES NEGATIVAS:",
    [
      "- não poluir o layout com elementos decorativos sem função;",
      "- não usar baixo contraste nem alinhamentos inconsistentes entre slides;",
      "- não alterar paleta, tipografia ou conceito definidos pela Sofia;",
      "- não remover nem enfraquecer as regras de contraste ou acessibilidade já calculadas, apenas complementá-las.",
      "- não transformar justificativa técnica em texto para o usuário final; ela é apenas para auditoria do Lucas.",
    ].join("\n"),
    "",
    "SOLICITAÇÃO ORIGINAL:",
    input.originalRequest,
    "",
    "DIREÇÃO DE ARTE DA SOFIA:",
    JSON.stringify(input.sofiaDirection, null, 2),
    "",
    "ESPECIFICAÇÃO DE DESIGN BASE:",
    JSON.stringify(design, null, 2),
    "",
    "MÓDULOS DE CONHECIMENTO DISPONÍVEIS NA CLARA:",
    JSON.stringify(Object.keys(context.modules), null, 2),
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify(
      {
        gridSystem: design.gridSystem,
        visualHierarchyStrategy: design.visualHierarchyStrategy,
        compositionStrategy: design.compositionStrategy,
        lightingStrategy: design.lightingStrategy,
        depthStrategy: design.depthStrategy,
        contrastStrategy: design.contrastStrategy,
        colorApplication: design.colorApplication,
        componentStyle: design.componentStyle,
        illustrationStyle: design.illustrationStyle,
        mockupStyle: design.mockupStyle,
        iconographyUsage: design.iconographyUsage,
        mockupUsage: design.mockupUsage,
        photographyUsage: design.photographyUsage,
        illustrationUsage: design.illustrationUsage,
        cardUsage: design.cardUsage,
        colorBlockUsage: design.colorBlockUsage,
        photoTreatment: design.photoTreatment,
        decorativeElements: design.decorativeElements,
        elementSpacingRules: design.elementSpacingRules,
        alignmentRules: design.alignmentRules,
        shadowRules: design.shadowRules,
        coverRules: design.coverRules,
        internalSlideRules: design.internalSlideRules,
        finalCtaRules: design.finalCtaRules,
        reelsCoverRules: design.reelsCoverRules,
        contrastRules: design.contrastRules,
        accessibilityGuidelines: design.accessibilityGuidelines,
        reelsCoverComposition: design.reelsCoverComposition,
        technicalJustification: design.technicalJustification,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function parseDesignEnhancement(content: string): BiancaDesignEnhancement {
  const parsed = JSON.parse(extractJson(content, "Bianca")) as Partial<Record<keyof BiancaDesignEnhancement, unknown>>;
  return {
    gridSystem: typeof parsed.gridSystem === "string" && parsed.gridSystem.trim() ? parsed.gridSystem : undefined,
    visualHierarchyStrategy:
      typeof parsed.visualHierarchyStrategy === "string" && parsed.visualHierarchyStrategy.trim() ? parsed.visualHierarchyStrategy : undefined,
    compositionStrategy: typeof parsed.compositionStrategy === "string" && parsed.compositionStrategy.trim() ? parsed.compositionStrategy : undefined,
    lightingStrategy: typeof parsed.lightingStrategy === "string" && parsed.lightingStrategy.trim() ? parsed.lightingStrategy : undefined,
    depthStrategy: typeof parsed.depthStrategy === "string" && parsed.depthStrategy.trim() ? parsed.depthStrategy : undefined,
    contrastStrategy: typeof parsed.contrastStrategy === "string" && parsed.contrastStrategy.trim() ? parsed.contrastStrategy : undefined,
    colorApplication: typeof parsed.colorApplication === "string" && parsed.colorApplication.trim() ? parsed.colorApplication : undefined,
    componentStyle: normalizeStringArray(parsed.componentStyle),
    illustrationStyle: typeof parsed.illustrationStyle === "string" && parsed.illustrationStyle.trim() ? parsed.illustrationStyle : undefined,
    mockupStyle: typeof parsed.mockupStyle === "string" && parsed.mockupStyle.trim() ? parsed.mockupStyle : undefined,
    iconographyUsage: normalizeStringArray(parsed.iconographyUsage),
    mockupUsage: normalizeStringArray(parsed.mockupUsage),
    photographyUsage: normalizeStringArray(parsed.photographyUsage),
    illustrationUsage: normalizeStringArray(parsed.illustrationUsage),
    cardUsage: normalizeStringArray(parsed.cardUsage),
    colorBlockUsage: normalizeStringArray(parsed.colorBlockUsage),
    photoTreatment: typeof parsed.photoTreatment === "string" && parsed.photoTreatment.trim() ? parsed.photoTreatment : undefined,
    decorativeElements: normalizeStringArray(parsed.decorativeElements),
    elementSpacingRules: normalizeStringArray(parsed.elementSpacingRules),
    alignmentRules: normalizeStringArray(parsed.alignmentRules),
    shadowRules: normalizeStringArray(parsed.shadowRules),
    coverRules: normalizeStringArray(parsed.coverRules),
    internalSlideRules: normalizeStringArray(parsed.internalSlideRules),
    finalCtaRules: normalizeStringArray(parsed.finalCtaRules),
    reelsCoverRules: normalizeStringArray(parsed.reelsCoverRules),
    technicalJustification:
      typeof parsed.technicalJustification === "string" && parsed.technicalJustification.trim() ? parsed.technicalJustification : undefined,
    contrastRules: normalizeStringArray(parsed.contrastRules),
    accessibilityGuidelines: normalizeStringArray(parsed.accessibilityGuidelines),
    reelsCoverComposition:
      typeof parsed.reelsCoverComposition === "string" && parsed.reelsCoverComposition.trim() ? parsed.reelsCoverComposition : undefined,
  };
}

export function mergeDesignEnhancement(design: BiancaDesignCore, enhancement: BiancaDesignEnhancement): BiancaDesignCore {
  return {
    ...design,
    gridSystem: enhancement.gridSystem ?? design.gridSystem,
    visualHierarchyStrategy: enhancement.visualHierarchyStrategy ?? design.visualHierarchyStrategy,
    compositionStrategy: enhancement.compositionStrategy ?? design.compositionStrategy,
    lightingStrategy: enhancement.lightingStrategy ?? design.lightingStrategy,
    depthStrategy: enhancement.depthStrategy ?? design.depthStrategy,
    contrastStrategy: enhancement.contrastStrategy ?? design.contrastStrategy,
    colorApplication: enhancement.colorApplication ?? design.colorApplication,
    componentStyle: enhancement.componentStyle?.length ? enhancement.componentStyle : design.componentStyle,
    iconographyUsage: enhancement.iconographyUsage?.length ? enhancement.iconographyUsage : design.iconographyUsage,
    mockupUsage: enhancement.mockupUsage?.length ? enhancement.mockupUsage : design.mockupUsage,
    photographyUsage: enhancement.photographyUsage?.length ? enhancement.photographyUsage : design.photographyUsage,
    illustrationUsage: enhancement.illustrationUsage?.length ? enhancement.illustrationUsage : design.illustrationUsage,
    cardUsage: enhancement.cardUsage?.length ? enhancement.cardUsage : design.cardUsage,
    colorBlockUsage: enhancement.colorBlockUsage?.length ? enhancement.colorBlockUsage : design.colorBlockUsage,
    photoTreatment: enhancement.photoTreatment ?? design.photoTreatment,
    decorativeElements: enhancement.decorativeElements?.length ? enhancement.decorativeElements : design.decorativeElements,
    elementSpacingRules: enhancement.elementSpacingRules?.length ? enhancement.elementSpacingRules : design.elementSpacingRules,
    alignmentRules: enhancement.alignmentRules?.length ? enhancement.alignmentRules : design.alignmentRules,
    shadowRules: enhancement.shadowRules?.length ? enhancement.shadowRules : design.shadowRules,
    coverRules: enhancement.coverRules?.length ? enhancement.coverRules : design.coverRules,
    internalSlideRules: enhancement.internalSlideRules?.length ? enhancement.internalSlideRules : design.internalSlideRules,
    finalCtaRules: enhancement.finalCtaRules?.length ? enhancement.finalCtaRules : design.finalCtaRules,
    reelsCoverRules: enhancement.reelsCoverRules?.length ? enhancement.reelsCoverRules : design.reelsCoverRules,
    technicalJustification: enhancement.technicalJustification ?? design.technicalJustification,
    contrastRules: enhancement.contrastRules?.length ? enhancement.contrastRules : design.contrastRules,
    accessibilityGuidelines: enhancement.accessibilityGuidelines?.length ? enhancement.accessibilityGuidelines : design.accessibilityGuidelines,
    reelsCoverComposition: enhancement.reelsCoverComposition ?? design.reelsCoverComposition,
    illustrationStyle: enhancement.illustrationStyle ?? design.illustrationStyle,
    mockupStyle: enhancement.mockupStyle ?? design.mockupStyle,
  };
}

export function buildPedroBriefing(design: BiancaDesignCore, input: BiancaDesignRequestInput): BiancaPedroBriefing {
  return {
    ...design,
    status: "structured",
    channel: input.channel,
    notes: [
      "Este briefing cobre direção de arte aplicada: grid, composição, hierarquia, espaçamentos, componentes, áreas seguras, uso de mídia e sequência de slides.",
      "Conceito criativo, paleta e tipografia foram definidos pela Sofia e apenas repassados aqui para contexto — não devem ser reinterpretados pelo Pedro.",
      "A justificativa técnica é material de auditoria para Lucas e não deve aparecer na arte final nem na entrega ao usuário.",
      `Canal solicitado: ${input.channel}.`,
      `Formato solicitado: ${input.format}.`,
    ],
  };
}

/**
 * Decide se o formato usa múltiplos slides/telas montados em sequência (carrossel ou Story).
 * "story"/"stories" precisam estar aqui: sem eles, Bianca sempre montava 1 slide único para
 * Story (via `buildSingleSlide`), enquanto Pedro recebia `imageCount` do Eduardo (3 por padrão)
 * — a divergência fazia todo Story com mais de 1 tela falhar em Pedro.
 */
function isCarouselFormat(format: string): boolean {
  return containsAny(normalize(format), ["carrossel", "carousel", "slides", "story", "stories"]);
}

function buildGridSystem(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Grid de 12 colunas por slide, margem lateral fixa de 8% e a mesma grade repetida em todos os slides do carrossel.";
  }
  return "Grid de 12 colunas, margem lateral fixa de 8%, elemento central alinhado à coluna do meio.";
}

function buildVisualHierarchyStrategy(input: BiancaDesignRequestInput): string {
  return `Ordem de leitura: elemento visual principal, depois headline, depois texto de apoio, depois CTA — seguindo o ângulo "${input.joaoStrategy.angle}" definido pela estratégia.`;
}

function buildEmotionalObjective(input: BiancaDesignRequestInput): string {
  return `Transformar a promessa "${input.joaoStrategy.centralPromise}" em uma peça que gere ${input.sofiaDirection.emotionalTone}, com leitura imediata e sensação de confiança antes da ação.`;
}

function buildDesiredFeeling(input: BiancaDesignRequestInput): string {
  return `Sensação desejada: ${input.sofiaDirection.emotionalTone}. A arte deve parecer premium, humana e simples de entender em poucos segundos.`;
}

function buildMinimalismLevel(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Minimalismo médio-alto: um foco visual e uma mensagem principal por slide, com respiro generoso e apoio gráfico controlado.";
  }
  return "Minimalismo alto: poucos elementos, promessa central clara, CTA dominante e nenhum bloco de texto competindo com a imagem principal.";
}

function buildVisualStyle(input: BiancaDesignRequestInput): string {
  return `Estilo visual aplicado: ${input.sofiaDirection.recommendedStyle}, com acabamento editorial moderno, contraste controlado e composição pensada para leitura mobile.`;
}

function buildTypographyScale(input: BiancaDesignRequestInput): BiancaTypographyScale {
  const [primaryFont] = input.sofiaDirection.typography ?? [];
  const fontNote = primaryFont ? ` usando ${primaryFont.replace(/\.$/, "")}` : "";
  return {
    headline: `Maior tamanho da peça${fontNote}, peso forte, alto contraste com o fundo.`,
    subheadline: "Aproximadamente 60% do tamanho da headline, peso médio.",
    body: "Aproximadamente 35% do tamanho da headline, limitado a poucas linhas para manter escaneabilidade.",
    caption: "Menor tamanho da peça, usado apenas para legenda, domínio do site ou texto legal.",
    cta: "Aproximadamente 50% do tamanho da headline, peso forte — grande o suficiente para parecer clicável mesmo em miniatura.",
  };
}

function buildCompositionStrategy(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Composição modular: capa com impacto e foco único, slides internos com alternância entre imagem/ícone e texto curto, fechamento com CTA dominante. Cada slide deve funcionar sozinho e também como parte da narrativa.";
  }
  return "Composição hero: elemento visual principal ocupando a área de maior atenção, headline em bloco limpo, CTA separado em card/botão de alto contraste e logo discreta.";
}

function buildLightingStrategy(input: BiancaDesignRequestInput): string {
  const concept = normalize(input.sofiaDirection.visualConcept);
  if (containsAny(concept, ["luz natural", "dourada", "editorial", "casal", "casamento"])) {
    return "Iluminação suave e editorial, com luz natural/dourada quando houver fotografia, evitando sombras duras sobre áreas com texto.";
  }
  return "Iluminação limpa, com contraste suficiente para separar planos e preservar legibilidade do texto em telas pequenas.";
}

function buildDepthStrategy(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Profundidade moderada: fundos discretos, cards levemente elevados e elemento visual principal em primeiro plano sem competir com o texto.";
  }
  return "Profundidade sutil: separar fundo, protagonista visual e CTA com sombra leve ou camada de cor translúcida, sem criar poluição visual.";
}

function buildContrastStrategy(input: BiancaDesignRequestInput): string {
  const [primary, secondary] = input.sofiaDirection.suggestedPalette ?? [];
  const colors = [primary, secondary].filter(Boolean).join(" e ");
  return colors
    ? `Usar ${colors} para criar contraste emocional e funcional: fundo limpo, texto de leitura em alto contraste e CTA com a maior força visual da peça.`
    : "Contraste funcional obrigatório: fundo limpo, texto sempre legível e CTA como ponto de maior destaque visual.";
}

function buildCtaPlacement(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Destaque máximo no último slide (fechamento): botão ou card de alto contraste, centralizado, na metade inferior do slide, com área de respiro exclusiva ao redor para nunca competir com outro elemento.";
  }
  return "Destaque máximo, na metade inferior da peça, centralizado, com alto contraste em relação ao fundo e área de respiro exclusiva ao redor.";
}

function buildReelsCoverComposition(input: BiancaDesignRequestInput): string | undefined {
  if (!containsAny(normalize(input.format), ["reels cover", "capa de reels", "capa do reels", "reels"])) return undefined;
  return "Capa de Reels: manter os elementos essenciais (headline e elemento visual principal) na metade superior do quadro, fora da área inferior reservada para ícones de interação e legenda sobrepostos pelo próprio Instagram; nenhum texto essencial a menos de 12% da borda inferior.";
}

function buildInstagramSafeArea(input: BiancaDesignRequestInput): string {
  if (containsAny(normalize(input.format), ["story", "stories", "reels", "shorts", "tiktok"])) {
    return "Área segura vertical: manter textos, logo e CTA entre 14% do topo e 18% da base, com margem lateral mínima de 8% para evitar sobreposição de interface.";
  }
  return "Área segura de feed/carrossel: manter textos, logo e CTA a pelo menos 8% das laterais e 7% do topo/base, preservando leitura em miniatura e evitando cortes no grid.";
}

function buildLogoSizing(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Logo entre 4% e 6% da largura do slide, discreta e repetida no mesmo canto; nunca maior que o indicador de progresso ou que o CTA.";
  }
  return "Logo entre 5% e 7% da largura da peça, sempre secundária ao título e ao CTA.";
}

function buildTitleSizing(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Título da capa entre 12% e 18% da altura do slide; títulos internos entre 8% e 12%, sempre com no máximo duas linhas.";
  }
  return "Título entre 12% e 20% da altura da peça, com quebra curta e peso visual dominante.";
}

function buildSubtitleSizing(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Subtítulo até 55% do tamanho do título, limitado a uma frase curta; omitir quando disputar atenção com a mensagem principal.";
  }
  return "Subtítulo até 60% do título, com uma linha de benefício ou contexto e respiro claro antes do CTA.";
}

function buildSupportTextSizing(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Texto auxiliar entre 28% e 38% do título, limitado a 1-2 linhas por slide; nunca usar parágrafos dentro da imagem.";
  }
  return "Texto auxiliar entre 30% e 40% do título, opcional e usado apenas se aumentar clareza da promessa.";
}

function buildButtonSizing(input: BiancaDesignRequestInput): string {
  if (isCarouselFormat(input.format)) {
    return "Botão/card de CTA com altura entre 8% e 12% do slide no fechamento, largura de 55% a 75% e padding visual generoso.";
  }
  return "Botão/card de CTA com altura mínima de 9% da peça, largura suficiente para leitura imediata e aparência clicável em mobile.";
}

function buildContrastRules(): string[] {
  return [
    "Contraste mínimo de 4.5:1 entre texto e fundo em qualquer elemento de leitura (título, subtítulo, corpo, CTA).",
    "CTA sempre com contraste maior que o restante da peça — deve ser o elemento de maior contraste depois do elemento visual principal.",
    "Nunca sobrepor texto diretamente em área de imagem com variação de luz sem um scrim (camada sólida ou gradiente) que garanta o contraste mínimo.",
  ];
}

function buildAccessibilityGuidelines(): string[] {
  return [
    "Não depender apenas de cor para transmitir significado (ex.: usar ícone ou texto junto de qualquer indicação por cor).",
    "Tamanho mínimo de fonte legível em miniatura de feed, mesmo para o texto de menor destaque (legenda/texto legal).",
    "Testar a paleta sugerida contra as formas mais comuns de daltonismo (protanopia e deuteranopia) antes da geração final.",
    "Texto alternativo (altText) de cada imagem deve descrever objetivamente o conteúdo visual, não repetir a legenda.",
  ];
}

function buildVisualStandardizationRules(input: BiancaDesignRequestInput, slides: BiancaSlideDesign[]): string[] {
  const rules = [
    "Mesma paleta, tipografia e posição de logo em toda a peça (e em todos os slides, quando houver mais de um).",
    "Mesmo grid e margens em toda a peça, para alinhamento consistente entre elementos.",
    "Mesmo estilo de componentes (cards, ícones, botões) do início ao fim, sem misturar tratamentos visuais.",
  ];
  if (slides.length > 1) {
    rules.push("Repetir o mesmo estilo de numeração ou indicador de progresso do carrossel em todos os slides intermediários.");
    rules.push("Manter o CTA no mesmo estilo visual em todos os slides em que aparecer, variando apenas a posição quando necessário para o fechamento.");
  }
  return rules;
}

function buildColorApplication(input: BiancaDesignRequestInput): string {
  const [primary, secondary, tertiary] = input.sofiaDirection.suggestedPalette ?? [];
  const parts: string[] = [];
  if (primary) parts.push(`${primary} como cor dominante de fundo ou destaque principal`);
  if (secondary) parts.push(`${secondary} para elementos de apoio e CTA`);
  if (tertiary) parts.push(`${tertiary} como neutro de contraste para texto`);
  if (parts.length === 0) {
    return "Paleta ainda genérica; aplicar cor dominante, cor de apoio e neutro de contraste assim que a identidade visual real for cadastrada na Clara.";
  }
  return `Aplicar ${parts.join(", ")}.`;
}

function buildSpacingSystem(): string {
  return "Espaçamento em múltiplos de uma unidade base (ex.: 8px), com respiro mínimo de duas unidades entre blocos de conteúdo e quatro unidades nas margens externas.";
}

function buildElementSpacingRules(input: BiancaDesignRequestInput): string[] {
  const rules = [
    "Manter distância mínima de 24px equivalentes entre título, subtítulo e CTA em peças 1080px.",
    "Separar blocos de texto e imagem com respiro suficiente para que cada grupo seja percebido como uma unidade independente.",
    "Nunca encostar texto em foto, borda, mockup ou elemento decorativo; todo texto precisa de área limpa própria.",
  ];
  if (isCarouselFormat(input.format)) {
    rules.push("Repetir espaçamentos equivalentes em todos os slides para que o carrossel pareça uma coleção única, não peças soltas.");
  }
  return rules;
}

function buildAlignmentRules(input: BiancaDesignRequestInput): string[] {
  const rules = [
    "Usar no máximo dois eixos de alinhamento por slide para evitar aparência amadora.",
    "Alinhar título, texto auxiliar e CTA ao mesmo eixo quando estiverem no mesmo bloco de leitura.",
    "Evitar centralizar tudo por padrão; centralizar apenas capa, promessa única ou fechamento com CTA.",
  ];
  if (isCarouselFormat(input.format)) {
    rules.push("Slides intermediários devem manter o mesmo eixo principal de leitura para criar ritmo visual ao arrastar.");
  }
  return rules;
}

function buildShadowRules(input: BiancaDesignRequestInput): string[] {
  const rules = [
    "Usar sombras apenas para separar cards, botões ou mockups de fundos fotográficos.",
    "Sombras devem ser suaves, com baixa opacidade e desfoque amplo; nunca usar sombra dura em texto pequeno.",
    "Quando o fundo for sólido e limpo, preferir borda ou contraste de cor em vez de sombra.",
  ];
  if (containsAny(normalize(input.sofiaDirection.visualConcept), ["premium", "editorial", "casamento", "luz natural"])) {
    rules.push("Em fotografia editorial, sombras devem reforçar profundidade sem parecer efeito artificial de template.");
  }
  return rules;
}

function buildComponentStyle(): string[] {
  return [
    "Cards: cantos levemente arredondados, fundo sólido ou com leve transparência, usados para agrupar texto de apoio.",
    "Ícones: traço fino e consistente, um único estilo (linha ou preenchido) em toda a peça.",
    "Botões/CTA: alto contraste com o fundo, área de toque generosa, texto curto e direto.",
    "Boxes: usados para destacar números, estatísticas ou uma única palavra-chave.",
    "Separadores: linha fina ou espaço em branco, nunca elementos decorativos pesados.",
    "Sombras: sutis, usadas apenas para destacar cards ou botões sobre fundos com imagem.",
    "Bordas: finas e discretas, reservadas para separar áreas de conteúdo quando o fundo não for suficiente.",
  ];
}

function buildIconographyUsage(input: BiancaDesignRequestInput): string[] {
  return [
    "Usar ícones apenas para reduzir leitura de texto ou reforçar uma ideia-chave; nunca como decoração aleatória.",
    "Manter um único estilo de ícone em todos os slides (outline fino ou preenchido simples).",
    isCarouselFormat(input.format)
      ? "Nos slides internos, usar no máximo um ícone principal por slide para sustentar a mensagem única."
      : "Na peça única, usar ícone somente se ele aumentar a clareza do CTA ou do benefício principal.",
  ];
}

function buildMockupUsage(input: BiancaDesignRequestInput): string[] {
  const text = normalize(`${input.originalRequest} ${input.sofiaDirection.visualConcept} ${input.format}`);
  if (containsAny(text, ["app", "site", "dashboard", "sistema", "produto digital", "mockup"])) {
    return [
      "Usar mockup como elemento protagonista, ocupando 35% a 55% da área útil.",
      "Aplicar sombra suave e perspectiva discreta para profundidade sem roubar atenção da headline.",
      "Não inserir telas ilegíveis; mockup deve comunicar contexto, não detalhes pequenos.",
    ];
  }
  return [
    "Mockup não é obrigatório; usar apenas se ele ajudar a tangibilizar produto, site, app ou processo.",
    "Se usado, manter tamanho secundário e alinhado ao grid para não substituir a mensagem principal.",
  ];
}

function buildPhotographyUsage(input: BiancaDesignRequestInput): string[] {
  const concept = normalize(input.sofiaDirection.visualConcept);
  const base = containsAny(concept, ["foto", "fotografia", "casal", "ensaio", "editorial", "casamento"])
    ? [
        "Priorizar fotografia como protagonista visual, com recorte emocional e espaço negativo planejado para texto.",
        "Evitar fotos poluídas no fundo de áreas com copy; quando necessário, usar gradiente/scrim.",
        "Manter tratamento de cor consistente em todos os slides para preservar unidade de campanha.",
      ]
    : [
        "Fotografia pode ser usada como textura ou apoio, mas não deve competir com headline, mockup ou ilustração principal.",
        "Se a foto não tiver área limpa para texto, mover a copy para card sólido ou bloco de cor.",
      ];
  return [...base, ANTI_GENERIC_VISUAL_CONSTRAINTS[ANTI_GENERIC_VISUAL_CONSTRAINTS.length - 1]];
}

function buildIllustrationUsage(input: BiancaDesignRequestInput): string[] {
  return [
    `Usar ilustração apenas se combinar com o estilo "${input.sofiaDirection.recommendedStyle}" definido pela Sofia.`,
    "Ilustrações devem simplificar uma ideia complexa, não adicionar ruído visual.",
    "Manter proporção, traço e paleta consistentes entre slides.",
    ANTI_GENERIC_VISUAL_CONSTRAINTS[1],
    ANTI_GENERIC_VISUAL_CONSTRAINTS[3],
  ];
}

function buildCardUsage(input: BiancaDesignRequestInput): string[] {
  return [
    "Usar cards para organizar texto curto, estatísticas ou CTA quando o fundo tiver variação visual.",
    "Cards devem ter padding generoso, borda/sombra sutil e contraste suficiente para leitura mobile.",
    isCarouselFormat(input.format)
      ? "Em carrossel, manter o mesmo raio, padding e opacidade dos cards em todos os slides."
      : "Na peça única, usar no máximo um card principal para não fragmentar a atenção.",
  ];
}

function buildColorBlockUsage(input: BiancaDesignRequestInput): string[] {
  return [
    "Usar blocos coloridos para criar contraste, separar planos ou destacar uma palavra-chave.",
    "Blocos coloridos devem respeitar a paleta da Sofia e nunca cobrir o protagonista visual sem intenção.",
    "Evitar muitos blocos por slide; um bloco forte é melhor do que vários pequenos competindo.",
  ];
}

function buildIllustrationStyle(input: BiancaDesignRequestInput): string {
  return `Ilustrações e fotos consistentes com o estilo "${input.sofiaDirection.recommendedStyle}", sempre com o mesmo tratamento de cor e enquadramento em todos os slides.`;
}

function buildMockupStyle(input: BiancaDesignRequestInput): string {
  if (containsAny(normalize(input.format), ["mockup", "produto", "app", "site"])) {
    return "Mockup limpo, centralizado, com sombra sutil e sem elementos de interface que distraiam do conteúdo principal.";
  }
  return "Nenhum mockup obrigatório para este formato; se usado, manter o mesmo tratamento visual dos demais elementos.";
}

function buildPhotoTreatment(input: BiancaDesignRequestInput): string {
  const palette = input.sofiaDirection.suggestedPalette?.length ? ` harmonizado com ${input.sofiaDirection.suggestedPalette.join(", ")}` : "";
  return `Tratamento fotográfico ${input.sofiaDirection.recommendedStyle}: luz limpa, pele/objetos naturais, contraste equilibrado${palette}, sem filtros pesados que prejudiquem leitura ou credibilidade.`;
}

function buildDecorativeElements(input: BiancaDesignRequestInput): string[] {
  const rules = [
    "Elementos decorativos devem ter função: conduzir olhar, criar profundidade ou reforçar marca.",
    "Usar no máximo dois tipos de elemento decorativo por peça para evitar aparência de template genérico.",
    "Evitar ornamentos próximos ao CTA e à headline principal.",
  ];
  if (containsAny(normalize(input.sofiaDirection.recommendedStyle), ["romântico", "editorial", "casamento"])) {
    rules.push("Quando fizer sentido, usar detalhes sutis como linhas finas, brilho discreto, textura suave ou formas orgânicas inspiradas em convite premium.");
  }
  return rules;
}

function buildCoverRules(input: BiancaDesignRequestInput): string[] {
  return [
    "Capa/primeiro slide deve ter uma única mensagem principal, sem subtítulo longo e sem excesso de elementos.",
    `Usar a promessa "${input.joaoStrategy.centralPromise}" como foco de impacto visual.`,
    "Criar contraste forte entre protagonista visual e headline, com leitura em até dois segundos no celular.",
    "Reservar área segura para logo discreta e indicador de arraste quando for carrossel.",
  ];
}

function buildInternalSlideRules(input: BiancaDesignRequestInput): string[] {
  if (!isCarouselFormat(input.format)) {
    return ["Peça única não possui slides internos; concentrar clareza, benefício e CTA em uma composição limpa."];
  }
  return [
    "Cada slide interno deve defender apenas uma mensagem principal, sem tentar resumir toda a campanha.",
    "Alternar ritmo visual com imagem/ícone/card, mas manter o mesmo grid, paleta e linguagem.",
    "Texto dentro da imagem deve ser curto, escaneável e sempre subordinado ao foco visual do slide.",
    "Usar indicador discreto de progresso para aumentar retenção e orientar leitura.",
  ];
}

function buildFinalCtaRules(input: BiancaDesignRequestInput): string[] {
  return [
    `CTA final deve destacar "${input.joaoStrategy.recommendedCta}" como ação visual principal.`,
    "O botão ou card final deve ter o maior contraste da peça, com área de respiro exclusiva.",
    "Reforçar benefício imediatamente antes do CTA, sem inserir nova promessa ou novo assunto.",
    "Logo/domínio pode aparecer como assinatura, mas nunca competir com o CTA.",
  ];
}

function buildReelsCoverRules(input: BiancaDesignRequestInput): string[] {
  if (!containsAny(normalize(input.format), ["reels cover", "capa de reels", "capa do reels", "reels"])) {
    return ["Regras de Reels Cover não aplicáveis ao formato solicitado."];
  }
  return [
    "Título essencial deve ficar na metade superior ou centro visual, longe da área inferior de legenda e botões do Instagram.",
    "Manter rosto/produto/elemento principal fora das bordas e com contraste suficiente para thumbnail.",
    "Evitar CTA pequeno na capa; a capa deve vender o clique/visualização, não tentar explicar tudo.",
  ];
}

/**
 * Fonte única de verdade para a contagem de slides: quando o Eduardo recomenda uma quantidade
 * (`recommendedSlideCount`, a mesma usada para o `imageCount` do Pedro), ela é respeitada
 * integralmente. Antes desta correção, Bianca calculava sua própria contagem apenas a partir de
 * `keyMessages.length`, ignorando o Eduardo — divergindo do `imageCount` do Pedro sempre que os
 * dois números não coincidiam, e fazendo Pedro cortar (via `slice`) os últimos slides, incluindo
 * o de Fechamento/CTA, sem qualquer aviso.
 */
function resolveSlideCount(input: BiancaDesignRequestInput): number {
  const recommended = input.recommendedSlideCount;
  if (typeof recommended === "number" && Number.isFinite(recommended) && recommended > 0) {
    return Math.min(10, Math.max(1, Math.round(recommended)));
  }
  const messageCount = Math.max(1, input.joaoStrategy.keyMessages?.length ?? 1);
  return Math.max(3, Math.min(10, messageCount + 2));
}

function buildSlides(input: BiancaDesignRequestInput): BiancaSlideDesign[] {
  if (!isCarouselFormat(input.format)) {
    return [buildSingleSlide(input)];
  }

  const slideCount = resolveSlideCount(input);
  if (slideCount <= 1) {
    return [buildSingleSlide(input)];
  }

  const slides: BiancaSlideDesign[] = [buildHookSlide(input, 1)];

  for (let index = 0; index < slideCount - 2; index += 1) {
    const message = input.joaoStrategy.keyMessages?.[index] ?? input.sofiaDirection.visualConcept;
    slides.push(buildMessageSlide(index + 2, message));
  }

  slides.push(buildCtaSlide(input, slideCount));
  return slides;
}

/**
 * Bianca decidindo como Diretora de Arte, não só como diagramadora — um bloco por papel de
 * slide (peça única, gancho, mensagem de apoio, fechamento), sempre determinístico para que todo
 * slide já nasça com julgamento de direção de arte, mesmo sem apoio de IA.
 */
function buildArtDirectorAssessment(
  role: "single" | "hook" | "message" | "cta",
  dominantElement: string,
): BiancaArtDirectorAssessment {
  switch (role) {
    case "single":
      return {
        dominantElement,
        dominantElementScreenShare: "55%-65% da área útil — precisa vencer a concorrência do feed sozinho.",
        eyeFlowFirstFocus: "Elemento visual principal primeiro, headline em seguida, CTA por último.",
        emotionBeforeReading: "A emoção da peça precisa ser sentida antes de qualquer palavra ser lida.",
        timeToUnderstand: "Menos de 2 segundos.",
        visualTension: "Moderada — um único foco, sem elementos concorrentes disputando atenção.",
        balance: "Centralizado e simétrico, coerente com uma peça que precisa se sustentar sozinha.",
        contrastAssessment: "Alto contraste entre elemento principal, fundo e CTA — os três níveis precisam ser distinguíveis à distância.",
      };
    case "hook":
      return {
        dominantElement,
        dominantElementScreenShare: "60%-70% da área útil — é o slide de maior impacto do carrossel.",
        eyeFlowFirstFocus: "Elemento visual/cena primeiro, headline de impacto logo em seguida.",
        emotionBeforeReading: "Curiosidade ou tensão imediata, antes de qualquer leitura.",
        timeToUnderstand: "Menos de 1 segundo — precisa parar o dedo no scroll.",
        visualTension: "Alta — contraste entre o elemento visual e o espaço vazio ao redor cria tensão de leitura.",
        balance: "Assimétrico intencional — o peso visual não fica no centro geométrico, para gerar dinamismo.",
        contrastAssessment: "Alto contraste entre elemento principal e fundo; nenhum elemento secundário pode competir.",
      };
    case "message":
      return {
        dominantElement,
        dominantElementScreenShare: "35%-45% da área útil — apoia a mensagem sem repetir o protagonismo do gancho.",
        eyeFlowFirstFocus: "Elemento visual/ícone de apoio primeiro, texto da mensagem em seguida.",
        emotionBeforeReading: "Continuidade emocional do slide anterior, sem reiniciar a curva de atenção.",
        timeToUnderstand: "Cerca de 2 segundos — permite um pouco mais de leitura que o gancho.",
        visualTension: "Baixa a moderada — o objetivo aqui é sustentar o ritmo, não competir pelo pico de atenção.",
        balance: "Consistente com os demais slides intermediários, mesmo eixo de leitura para criar ritmo ao arrastar.",
        contrastAssessment: "Contraste suficiente para leitura rápida, sem ser tão dominante quanto o gancho.",
      };
    case "cta":
      return {
        dominantElement,
        dominantElementScreenShare: "50%-60% da área útil — precisa fechar com o mesmo impacto que o gancho abriu.",
        eyeFlowFirstFocus: "Botão/destaque de CTA primeiro — é o único elemento que precisa converter em ação.",
        emotionBeforeReading: "Convite e confiança — sensação de fechamento consolidado da marca.",
        timeToUnderstand: "Menos de 2 segundos, com o CTA identificável mesmo em miniatura.",
        visualTension: "Baixa — o fechamento precisa transmitir resolução, não mais tensão.",
        balance: "Centralizado, com o CTA como âncora visual inferior.",
        contrastAssessment: "O maior contraste de toda a peça — o CTA precisa ser o elemento mais destacado do carrossel inteiro.",
      };
  }
}

function buildSingleSlide(input: BiancaDesignRequestInput): BiancaSlideDesign {
  return {
    slideIndex: 1,
    role: "Peça única: comunicar a promessa central e converter em uma única tela.",
    focalPoint: `Elemento visual principal representando "${input.sofiaDirection.visualConcept}".`,
    visualWeightOrder: ["1. Elemento visual principal", "2. Headline", "3. CTA", "4. Logo"],
    headlineSize: "Grande, principal ponto de entrada de leitura.",
    subheadlineSize: "Médio, complementando a headline sem competir com ela.",
    bodyTextSize: "Pequeno, apenas se necessário para reforçar a mensagem.",
    alignment: "Centralizado, salvo indicação contrária do elemento visual principal.",
    margins: "Margem consistente nas quatro bordas, respeitando a área segura do canal.",
    breathingRoom: "Alta — a peça única precisa competir por atenção sozinha no feed.",
    supportingElements: ["CTA em destaque", "Logo discreto"],
    emphasis: `A promessa central: "${input.sofiaDirection.visualConcept}".`,
    secondaryElements: "Elementos decorativos de apoio, sempre em segundo plano.",
    logoPlacement: "Canto inferior, pequeno e discreto.",
    ctaPlacement: "Metade inferior, centralizado, alto contraste com o fundo, com área de respiro exclusiva ao redor.",
    artDirection: buildArtDirectorAssessment("single", `Elemento visual principal representando "${input.sofiaDirection.visualConcept}"`),
  };
}

function buildHookSlide(input: BiancaDesignRequestInput, slideIndex: number): BiancaSlideDesign {
  return {
    slideIndex,
    role: "Gancho: capturar atenção nos primeiros segundos de rolagem.",
    focalPoint: `Elemento visual que represente "${input.joaoStrategy.centralPromise}".`,
    visualWeightOrder: ["1. Headline de impacto", "2. Elemento visual principal", "3. Logo discreto"],
    headlineSize: "Grande, ocupando a maior área de destaque do slide, peso forte, alto contraste com o fundo.",
    subheadlineSize: "Pequeno ou ausente — o gancho depende de uma única frase de impacto.",
    bodyTextSize: "Ausente neste slide.",
    alignment: "Centralizado, para máxima legibilidade em qualquer dispositivo.",
    margins: "Margem generosa nas quatro bordas para não cortar em miniatura.",
    breathingRoom: "Alta — poucos elementos competindo por atenção.",
    supportingElements: ["Indicador de arraste (seta ou \"arraste para o lado\")."],
    emphasis: "A frase de gancho e o elemento visual principal.",
    secondaryElements: "Logo e qualquer marca d'água, sempre discretos.",
    logoPlacement: "Canto inferior, pequeno e discreto.",
    artDirection: buildArtDirectorAssessment("hook", `Elemento visual que represente "${input.joaoStrategy.centralPromise}"`),
  };
}

function buildMessageSlide(slideIndex: number, message: string): BiancaSlideDesign {
  return {
    slideIndex,
    role: `Mensagem de apoio: comunicar "${message}".`,
    focalPoint: `Elemento visual ou ícone que ilustre "${message}".`,
    visualWeightOrder: ["1. Elemento visual ou ícone de apoio", "2. Texto da mensagem", "3. Indicador de progresso do carrossel"],
    headlineSize: "Médio — menor que o gancho, mantendo hierarquia clara com o primeiro slide.",
    subheadlineSize: "Pequeno, usado apenas se a mensagem precisar de contexto adicional.",
    bodyTextSize: "Pequeno a médio, limitado a 1-2 linhas para manter escaneabilidade.",
    alignment: "Mesmo alinhamento em todos os slides intermediários, para consistência.",
    margins: "Mesma margem do primeiro slide, para manter o grid consistente entre slides.",
    breathingRoom: "Média — espaço suficiente entre texto e elemento de apoio.",
    supportingElements: ["Ícone ou pequeno elemento gráfico de apoio", "Numeração do slide dentro do carrossel"],
    emphasis: `A mensagem "${message}".`,
    secondaryElements: "Elementos decorativos de fundo, sempre discretos.",
    logoPlacement: "Mesmo canto usado no primeiro slide, para consistência.",
    artDirection: buildArtDirectorAssessment("message", `Elemento visual ou cena que ilustre "${message}"`),
  };
}

function buildCtaSlide(input: BiancaDesignRequestInput, slideIndex: number): BiancaSlideDesign {
  return {
    slideIndex,
    role: "Fechamento: converter atenção em ação.",
    focalPoint: `Chamada para ação: "${input.joaoStrategy.recommendedCta}".`,
    visualWeightOrder: ["1. Botão ou destaque de CTA", "2. Reforço da promessa central", "3. Logo"],
    headlineSize: "Grande, comparável ao gancho, para fechar o carrossel com o mesmo impacto que abriu.",
    subheadlineSize: "Médio, reforçando o benefício antes do CTA.",
    bodyTextSize: "Pequeno, apenas se houver texto de apoio.",
    alignment: "Centralizado, com o CTA como último elemento antes da borda inferior.",
    margins: "Mesma margem dos demais slides.",
    breathingRoom: "Alta ao redor do botão de CTA, para que ele nunca dispute atenção com outro elemento.",
    supportingElements: ["Botão ou card de destaque para o CTA", "Elemento de marca ou domínio do site quando aplicável"],
    emphasis: "O botão ou destaque de CTA.",
    secondaryElements: "Qualquer texto legal ou complementar, sempre em tamanho reduzido.",
    logoPlacement: "Mesmo canto usado nos slides anteriores.",
    ctaPlacement: "Metade inferior do slide de fechamento, centralizado, maior contraste da peça, com área de respiro exclusiva ao redor.",
    artDirection: buildArtDirectorAssessment("cta", `Chamada para ação: "${input.joaoStrategy.recommendedCta}"`),
  };
}

function buildCarouselFlow(input: BiancaDesignRequestInput, slides: BiancaSlideDesign[]): BiancaCarouselFlow | undefined {
  if (!isCarouselFormat(input.format)) return undefined;
  return {
    totalSlides: slides.length,
    readingFlow: "Da esquerda para a direita: gancho, mensagens de apoio (uma por slide), chamada para ação.",
    sequenceNotes: slides.map((slide) => `Slide ${slide.slideIndex}: ${slide.role}`),
    consistencyRules: [
      "Manter a mesma paleta, tipografia e posição de logo em todos os slides.",
      "Manter a mesma margem e grid em todos os slides para uma transição suave ao arrastar.",
      "Repetir o mesmo estilo de numeração ou indicador de progresso em todos os slides intermediários.",
    ],
  };
}

function buildDesignConstraints(publishing?: ClaraKnowledgeRecord<"PublishingContext">): string[] {
  const constraints: string[] = [];
  if (publishing?.payload.approvalFlow) constraints.push(`Respeitar fluxo de aprovação configurado: ${publishing.payload.approvalFlow}.`);
  constraints.push("Manter área segura (safe zone) livre de elementos essenciais nas bordas, respeitando a interface do canal.");
  return constraints;
}

function buildDesignRisks(input: BiancaDesignRequestInput, identity?: ClaraKnowledgeRecord<"IdentityContext">): string[] {
  const risks: string[] = [];
  if (!identity?.payload.logoUri) risks.push("Nenhuma logo registrada na Clara; posicionamento de logo é apenas uma reserva de área até o ativo real ser cadastrado.");
  if ((input.joaoStrategy.keyMessages?.length ?? 0) > 5 && isCarouselFormat(input.format)) {
    risks.push("Número elevado de mensagens principais pode exigir mais slides do que o recomendado para retenção; considerar priorizar as mensagens mais fortes.");
  }
  risks.push("Validar o layout final com o time de marca antes de encaminhar ao Pedro para geração das imagens.");
  return risks;
}

function buildObservations(input: BiancaDesignRequestInput, context: ClaraContextResponse): string[] {
  const observations: string[] = [];
  if (!context.modules.PublishingContext?.length) observations.push("Nenhuma regra de publicação registrada na Clara; seguir boas práticas gerais de área segura do canal.");
  observations.push(`Layout planejado para ${isCarouselFormat(input.format) ? "carrossel" : "peça única"} no canal ${input.channel}.`);
  return observations;
}

function buildNextSteps(input: BiancaDesignRequestInput): string[] {
  return [
    "Encaminhar o briefing estruturado para o Pedro gerar as imagens finais.",
    "Validar o layout com o time de marca antes da geração final.",
    `Reavaliar o layout caso o canal ${input.channel} ou o formato ${input.format} mudem.`,
  ];
}

function buildTechnicalJustification(input: BiancaDesignRequestInput, slides: BiancaSlideDesign[]): string {
  const slideStrategy = isCarouselFormat(input.format)
    ? `O carrossel foi estruturado em ${slides.length} slides para abrir com gancho, desenvolver uma mensagem por tela e fechar com CTA visual forte.`
    : "A peça única concentra promessa, protagonista visual e CTA em uma única hierarquia para reduzir fricção de leitura.";
  return [
    "Justificativa técnica para auditoria do Lucas:",
    slideStrategy,
    `A direção preserva o conceito da Sofia ("${input.sofiaDirection.visualConcept}") sem reinterpretar paleta, tipografia ou emoção.`,
    `A hierarquia segue o ângulo do João ("${input.joaoStrategy.angle}") e protege legibilidade mobile com área segura, contraste mínimo e pouco texto na imagem.`,
    "As regras de composição orientam o Pedro a executar imagens premium com grid, respiro, alinhamento, CTA e padronização consistentes.",
  ].join(" ");
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

export function createBiancaSocialMediaDesignSkill(
  dependencies: Partial<BiancaSocialMediaDesignSkillDependencies> = {},
): BiancaSocialMediaDesignSkill {
  return new BiancaSocialMediaDesignSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    icaro: dependencies.icaro,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
  });
}
