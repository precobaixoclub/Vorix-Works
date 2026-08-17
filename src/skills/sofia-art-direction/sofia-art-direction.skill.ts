import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse, ClaraKnowledgeRecord } from "../../application/knowledge/clara.types.js";
import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, latest, normalize, normalizeStringArray } from "../../shared/utils/skill-parsing.js";
import { resolveAspectRatio } from "../../shared/utils/aspect-ratio.js";
import { buildDeveloperAiPendingResponse, isDeveloperAssistancePending } from "../../shared/utils/developer-ai-assistance.js";
import {
  ANTI_GENERIC_VISUAL_CONSTRAINTS,
  enrichVisualConcept,
  inferVisualEmotionHint,
  VISUAL_REFERENCE_LIBRARY,
} from "../../shared/utils/visual-reference-library.js";
import type { DeveloperAssistancePendingOutput } from "../../application/ai/developer-assistance.types.js";
import { sofiaArtDirectionManifest } from "./sofia.manifest.js";
import type { SofiaLogAction, SofiaLoggerPort } from "./sofia-log.contract.js";
import type {
  SofiaArtDirectionCore,
  SofiaArtDirectionOutput,
  SofiaArtDirectionRequestInput,
  SofiaBiancaBriefing,
  SofiaDirectionEnhancement,
  SofiaSupportedChannel,
} from "./sofia-art-direction.types.js";

export type SofiaIdGenerator = {
  create(prefix: string): string;
};

export type SofiaArtDirectionSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  icaro?: IcaroBrainPort;
  logger?: SofiaLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: SofiaIdGenerator;
  now?: () => Date;
};

class SequentialSofiaIdGenerator implements SofiaIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopSofiaLogger implements SofiaLoggerPort {
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
      throw new Error(`${portName} não configurado para Sofia.`);
    },
  });
}

/** Une a saída normal de Sofia à pausa aguardando IA desenvolvedora, mesmo padrão de `PedroSkillOutput`. */
export type SofiaSkillOutput = SofiaArtDirectionOutput | DeveloperAssistancePendingOutput;

export class SofiaArtDirectionSkill implements Skill<SofiaArtDirectionRequestInput, SofiaSkillOutput> {
  readonly manifest = sofiaArtDirectionManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly icaro?: IcaroBrainPort;
  private readonly logger: SofiaLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: SofiaIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: SofiaArtDirectionSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.icaro = dependencies.icaro;
    this.logger = dependencies.logger ?? new NoopSofiaLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialSofiaIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<SofiaArtDirectionRequestInput>): Promise<SkillResponse<SofiaSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de direção de arte inválida.", request, { errors: validationErrors });
      await this.emit("ArtDirectionFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
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
      return await this.runDirection(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante a direção de arte.";
      await this.log("Error", `Erro inesperado em Sofia. ${message}`, request, { error: message });
      await this.emit("ArtDirectionFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runDirection(request: SkillRequest<SofiaArtDirectionRequestInput>): Promise<SkillResponse<SofiaSkillOutput>> {
    await this.log("RequestReceived", "Solicitação de direção de arte recebida por Sofia.", request, {
      channel: request.input.channel,
      format: request.input.format,
      visualObjective: request.input.visualObjective,
    });
    await this.emit("ArtDirectionStarted", request, {
      channel: request.input.channel,
      visualObjective: request.input.visualObjective,
    });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("ArtDirectionFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
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
      requester: { id: this.manifest.id, type: "specialist", name: "Sofia" },
      clientId: tenant.clientId,
      modules: ["BrandContext", "AudienceContext", "ContentContext", "IdentityContext", "PublishingContext"],
      reason: "Construção de direção visual a partir da estratégia de marketing do João.",
    });

    await this.log("VisualIdentityConsulted", `Identidade visual consultada na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });
    await this.emit("VisualContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    const completeness = evaluateVisualContextCompleteness(claraContext);
    if (!completeness.sufficient) {
      await this.log("ContextIncomplete", "Contexto visual insuficiente na Clara para construir a direção com segurança.", request, {
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      await this.emit("ArtDirectionFailed", request, {
        reason: "INSUFFICIENT_VISUAL_CONTEXT",
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "needs_more_context",
        artifacts: [],
        warnings: [
          `Contexto visual insuficiente na Clara para o cliente ${tenant.clientId}.`,
          ...completeness.missing.map((item) => `Faltando na Clara: ${item}.`),
        ],
      };
    }

    await this.log("DirectionStarted", "Construção da direção visual iniciada.", request, { clientId: tenant.clientId });

    let direction = buildBaselineDirection(request.input, claraContext);
    let aiSupportUsed = false;
    let aiProviderId: string | undefined;

    if (this.icaro) {
      await this.log("AISupportRequested", "Apoio de IA solicitado ao Ícaro para aprimorar a direção visual.", request, { clientId: tenant.clientId });
      await this.emit("AIGenerationStarted", request, { clientId: tenant.clientId, channel: request.input.channel });

      try {
        const prompt = buildIcaroDirectionPrompt(request.input, direction, claraContext);
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
            "Não gerar imagem final; apenas descrever direção visual em texto.",
            "Não definir layout, grid, hierarquia visual detalhada, espaçamentos ou posicionamento de elementos — isso é responsabilidade exclusiva de Bianca.",
            "Aprimorar apenas conceito visual, estilo recomendado, emoção, moodboard e referências de design.",
          ],
          expectedOutput: "json",
          priority: "quality",
          temperature: 0.6,
          maxTokens: 1200,
        });

        if (aiResponse.status !== "completed") {
          throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para Sofia.");
        }

        const enhancement = parseDirectionEnhancement(String(aiResponse.content ?? ""));
        direction = mergeDirectionEnhancement(direction, enhancement);
        aiSupportUsed = true;
        aiProviderId = aiResponse.provider.id;

        await this.log("AISupportApplied", "Apoio de IA aplicado à direção visual.", request, { clientId: tenant.clientId });
        await this.emit("AIGenerationFinished", request, {
          clientId: tenant.clientId,
          provider: aiResponse.provider,
          model: aiResponse.model,
        });
      } catch (error) {
        if (isDeveloperAssistancePending(error)) {
          return buildDeveloperAiPendingResponse(this.manifest.id, request.context.taskId, error);
        }
        const message = error instanceof Error ? error.message : "Erro desconhecido no apoio de IA solicitado por Sofia.";
        await this.log("AISupportFailed", `Apoio de IA falhou; direção visual segue apenas com heurística e contexto da Clara. ${message}`, request, {
          clientId: tenant.clientId,
          error: message,
        });
      }
    } else {
      await this.log("AISupportSkipped", "Ícaro não foi configurado; direção visual segue apenas com heurística e contexto da Clara.", request, {
        clientId: tenant.clientId,
      });
    }

    await this.log("DirectionFinalized", "Direção visual finalizada.", request, { clientId: tenant.clientId, style: direction.recommendedStyle });
    await this.emit("ArtDirectionGenerated", request, { clientId: tenant.clientId, aiSupportUsed });

    const biancaBriefing = buildBiancaBriefing(direction, request.input);

    await this.log("BiancaBriefingCreated", "Briefing de direção de arte para Bianca criado.", request, {
      clientId: tenant.clientId,
      channel: biancaBriefing.channel,
    });
    await this.emit("BiancaBriefingCreated", request, { clientId: tenant.clientId, channel: biancaBriefing.channel });

    const output: SofiaArtDirectionOutput = {
      ...direction,
      biancaBriefing,
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
          name: "Direção visual estruturada de Sofia",
          metadata: {
            clientId: tenant.clientId,
            channel: request.input.channel,
            aiSupportUsed,
          },
        },
      ],
      warnings: [],
    };
  }

  private async resolveClient(input: SofiaArtDirectionRequestInput): Promise<TenantClientContext> {
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
    action: SofiaLogAction,
    message: string,
    request: SkillRequest<SofiaArtDirectionRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("sofia-log"),
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

  private async emit(name: ZunoEventName, request: SkillRequest<SofiaArtDirectionRequestInput>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "sofia",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: SofiaArtDirectionRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de direção de arte é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!input.channel?.trim()) errors.push("channel é obrigatório.");
  if (!input.format?.trim()) errors.push("format é obrigatório.");
  if (!input.visualObjective?.trim()) errors.push("visualObjective é obrigatório.");
  if (!input.joaoStrategy || typeof input.joaoStrategy !== "object" || !input.joaoStrategy.objective?.trim()) {
    errors.push("joaoStrategy é obrigatório e precisa conter ao menos objective.");
  }
  if (!input.joaoSofiaBriefing || typeof input.joaoSofiaBriefing !== "object" || !input.joaoSofiaBriefing.angle?.trim()) {
    errors.push("joaoSofiaBriefing é obrigatório e precisa conter ao menos angle.");
  }
  return errors;
}

function evaluateVisualContextCompleteness(context: ClaraContextResponse): { sufficient: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!context.modules.IdentityContext?.length) missing.push("IdentityContext");
  if (!context.modules.BrandContext?.length) missing.push("BrandContext");

  return {
    sufficient: !(missing.includes("IdentityContext") && missing.includes("BrandContext")),
    missing,
  };
}

export function buildBaselineDirection(
  input: SofiaArtDirectionRequestInput,
  context: ClaraContextResponse,
): SofiaArtDirectionCore {
  const brand = latest(context.modules.BrandContext);
  const audience = latest(context.modules.AudienceContext);
  const identity = latest(context.modules.IdentityContext);
  const content = latest(context.modules.ContentContext);
  const publishing = latest(context.modules.PublishingContext);

  const visualConcept = buildVisualConcept(input, brand);
  const recommendedStyle = identity?.payload.imageStyle ?? inferStyle(input.joaoStrategy.angle);
  const emotionalTone = buildEmotionalTone(input, brand);
  const suggestedPalette = identity?.payload.colors?.length ? identity.payload.colors : defaultPaletteHint();
  const typography = buildTypography(identity);
  const moodboard = buildMoodboard(input, brand, audience);
  const designReferences = buildDesignReferences(input);
  const recommendedFormat = input.format;
  const recommendedAspectRatio = resolveAspectRatio(input.channel, input.format);
  const visualConstraints = buildVisualConstraints(identity, publishing);
  const visualRisks = buildVisualRisks(identity, input.channel, input.format);
  const observations = [
    ...buildObservations(context, content),
    ...(input.avoidRepeating ? [`Memória editorial — evitar repetir conceito/enquadramento: ${input.avoidRepeating}`] : []),
  ];
  const nextSteps = buildNextSteps(input);

  return {
    visualConcept,
    recommendedStyle,
    emotionalTone,
    suggestedPalette,
    typography,
    moodboard,
    designReferences,
    recommendedFormat,
    recommendedAspectRatio,
    visualConstraints,
    visualRisks,
    observations,
    nextSteps,
  };
}

export function buildIcaroDirectionPrompt(
  input: SofiaArtDirectionRequestInput,
  direction: SofiaArtDirectionCore,
  context: ClaraContextResponse,
): string {
  return [
    "Você é o apoio de IA de Sofia, Especialista em Direção de Arte do Zuno.",
    "Aprimore apenas conceito visual, estilo recomendado, emoção, moodboard e referências de design.",
    "Não gere imagem final e não defina layout, grid, hierarquia visual detalhada, espaçamentos ou posicionamento de elementos — isso é responsabilidade exclusiva de Bianca.",
    "Retorne apenas JSON válido, sem markdown.",
    "",
    "PADRÃO DE QUALIDADE OBRIGATÓRIO:",
    [
      "- pense em cena cinematográfica, nunca em conceito solto: não escreva \"caixa de presente\", escreva algo como \"Uma caixa de presente premium aberta sobre uma superfície elegante, iluminada por luz natural suave, enquanto notas reais escapam lentamente da embalagem criando uma sensação imediata de perda financeira.\";",
      "- toda cena precisa de protagonista, elemento secundário, plano de fundo, iluminação, profundidade de campo, enquadramento e emoção visual claros;",
      "- conceito visual específico e memorável, nunca genérico de banco de imagens;",
      "- estilo e emoção coerentes com o ângulo estratégico e o tom de voz da marca;",
      "- moodboard e referências de design concretas, aplicáveis por Bianca sem ambiguidade.",
    ].join("\n"),
    "",
    "RESTRIÇÕES NEGATIVAS:",
    [
      ...ANTI_GENERIC_VISUAL_CONSTRAINTS.map((item) => `- ${item};`),
      "- não sugerir paleta, tipografia ou grid fora do que a identidade visual da marca já define;",
      "- não propor referências de design incompatíveis com o canal ou formato solicitado.",
    ].join("\n"),
    "",
    "SOLICITAÇÃO ORIGINAL:",
    input.originalRequest,
    "",
    "ESTRATÉGIA DO JOÃO:",
    JSON.stringify(input.joaoStrategy, null, 2),
    "",
    "DIREÇÃO VISUAL BASE:",
    JSON.stringify(direction, null, 2),
    "",
    "MÓDULOS DE CONHECIMENTO DISPONÍVEIS NA CLARA:",
    JSON.stringify(Object.keys(context.modules), null, 2),
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify(
      {
        visualConcept: direction.visualConcept,
        recommendedStyle: direction.recommendedStyle,
        emotionalTone: direction.emotionalTone,
        moodboard: direction.moodboard,
        designReferences: direction.designReferences,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function parseDirectionEnhancement(content: string): SofiaDirectionEnhancement {
  const parsed = JSON.parse(extractJson(content, "Sofia")) as Partial<Record<keyof SofiaDirectionEnhancement, unknown>>;
  return {
    visualConcept: typeof parsed.visualConcept === "string" && parsed.visualConcept.trim() ? parsed.visualConcept : undefined,
    recommendedStyle: typeof parsed.recommendedStyle === "string" && parsed.recommendedStyle.trim() ? parsed.recommendedStyle : undefined,
    emotionalTone: typeof parsed.emotionalTone === "string" && parsed.emotionalTone.trim() ? parsed.emotionalTone : undefined,
    moodboard: normalizeStringArray(parsed.moodboard),
    designReferences: normalizeStringArray(parsed.designReferences),
  };
}

export function mergeDirectionEnhancement(
  direction: SofiaArtDirectionCore,
  enhancement: SofiaDirectionEnhancement,
): SofiaArtDirectionCore {
  return {
    ...direction,
    visualConcept: enhancement.visualConcept ?? direction.visualConcept,
    recommendedStyle: enhancement.recommendedStyle ?? direction.recommendedStyle,
    emotionalTone: enhancement.emotionalTone ?? direction.emotionalTone,
    moodboard: enhancement.moodboard?.length ? enhancement.moodboard : direction.moodboard,
    designReferences: enhancement.designReferences?.length ? enhancement.designReferences : direction.designReferences,
  };
}

export function buildBiancaBriefing(direction: SofiaArtDirectionCore, input: SofiaArtDirectionRequestInput): SofiaBiancaBriefing {
  return {
    status: "preliminary",
    visualConcept: direction.visualConcept,
    recommendedStyle: direction.recommendedStyle,
    emotionalTone: direction.emotionalTone,
    suggestedPalette: direction.suggestedPalette,
    typography: direction.typography,
    moodboard: direction.moodboard,
    designReferences: direction.designReferences,
    recommendedFormat: direction.recommendedFormat,
    recommendedAspectRatio: direction.recommendedAspectRatio,
    visualConstraints: direction.visualConstraints,
    channel: input.channel,
    notes: [
      "Este briefing cobre exclusivamente direção de arte (conceito, identidade visual, paleta, tipografia, moodboard, estilo e emoção).",
      "Layout, grid, hierarquia visual detalhada, espaçamentos, cards, ícones e posicionamento de elementos são responsabilidade da Bianca, não desta etapa.",
      `Canal solicitado: ${input.channel}.`,
      `Formato solicitado: ${input.format}.`,
    ],
  };
}

/**
 * Sofia nunca descreve um objeto isolado (ex.: "caixa de presente") — todo `visualObjective`
 * recebido passa pela mesma biblioteca de referências visuais/enriquecimento que Pedro usa
 * (`enrichVisualConcept`), garantindo que Sofia já pense em cena cinematográfica completa
 * (protagonista, luz, profundidade, emoção) desde a direção de arte, não só na geração da
 * imagem. Ver `docs/visual-enrichment-report.md` para exemplos reais de antes/depois.
 */
function buildVisualConcept(input: SofiaArtDirectionRequestInput, brand?: ClaraKnowledgeRecord<"BrandContext">): string {
  const brandNote = brand?.payload.promise ? ` reforçando a promessa da marca "${brand.payload.promise}"` : "";
  const emotionHint = inferVisualEmotionHint(input.joaoStrategy.angle, input.joaoStrategy.centralPromise, input.visualObjective);
  const scene = enrichVisualConcept(input.visualObjective, emotionHint);
  return (
    `${scene.sceneDescription} Cena alinhada ao ângulo "${input.joaoStrategy.angle}" e comunicando "${input.joaoStrategy.centralPromise}"${brandNote}. ` +
    `Referência de estilo: ${VISUAL_REFERENCE_LIBRARY[scene.referenceStyle]} Nunca clipart, ícone, desenho simples, vetor genérico ou aparência de template — sempre cena fotográfica de campanha premium.`
  );
}

function inferStyle(angle: string): string {
  const normalized = normalize(angle);
  if (containsAny(normalized, ["conversao", "beneficio", "direto"])) return "Estilo direto e comercial, com foco no produto ou oferta.";
  if (containsAny(normalized, ["educativo", "clareza", "autoridade"])) return "Estilo editorial e didático, com hierarquia clara de informação.";
  if (containsAny(normalized, ["identificacao", "proxima", "comunidade"])) return "Estilo próximo e humano, com fotografia natural e pouco produzida.";
  if (containsAny(normalized, ["novidade", "lancamento", "expectativa"])) return "Estilo impactante e contemporâneo, com forte contraste visual.";
  return "Estilo consistente com a identidade da marca, equilibrando clareza e apelo estético.";
}

function buildEmotionalTone(input: SofiaArtDirectionRequestInput, brand?: ClaraKnowledgeRecord<"BrandContext">): string {
  const toneNote = brand?.payload.toneOfVoice ? ` em sintonia com o tom de voz "${brand.payload.toneOfVoice}" da marca` : "";
  return `A peça deve transmitir a emoção associada a "${input.joaoStrategy.centralPromise}"${toneNote}, sem soar exagerada ou artificial.`;
}

function defaultPaletteHint(): string[] {
  return ["Paleta genérica: usar cores neutras de apoio até a identidade visual real ser registrada na Clara."];
}

function buildTypography(identity?: ClaraKnowledgeRecord<"IdentityContext">): string[] {
  if (identity?.payload.fonts?.length) {
    return identity.payload.fonts.map((font, index) => (index === 0 ? `Fonte principal (títulos): ${font}.` : `Fonte de apoio: ${font}.`));
  }
  return ["Nenhuma fonte de marca registrada na Clara; usar uma família tipográfica neutra e legível até a identidade visual real ser cadastrada."];
}

function buildMoodboard(
  input: SofiaArtDirectionRequestInput,
  brand?: ClaraKnowledgeRecord<"BrandContext">,
  audience?: ClaraKnowledgeRecord<"AudienceContext">,
): string[] {
  const emotionHint = inferVisualEmotionHint(input.joaoStrategy.angle, input.joaoStrategy.centralPromise, input.visualObjective);
  const scene = enrichVisualConcept(input.visualObjective, emotionHint);
  const moodboard: string[] = [`Referência de humor/tom visual alinhada ao ângulo "${input.joaoStrategy.angle}".`];
  if (brand?.payload.promise) moodboard.push(`Imagens que reforcem a promessa "${brand.payload.promise}".`);
  if (audience?.payload.targetAudience) moodboard.push(`Referências visuais próximas do público: ${audience.payload.targetAudience}.`);
  moodboard.push(`Sensação geral desejada: ${inferStyle(input.joaoStrategy.angle)}`);
  moodboard.push(`Estilo de referência: ${VISUAL_REFERENCE_LIBRARY[scene.referenceStyle]}`);
  return moodboard;
}

function buildDesignReferences(input: SofiaArtDirectionRequestInput): string[] {
  const normalizedFormat = normalize(input.format);
  const references = ["Referências de marcas do mesmo segmento com comunicação visual limpa e consistente."];
  if (containsAny(normalizedFormat, ["carrossel", "carousel", "slides"])) {
    references.push("Carrosséis editoriais de alta retenção, com identidade visual consistente entre slides.");
  }
  references.push(`Referências adequadas ao canal ${input.channel}.`);
  references.push(`Padrão de qualidade exigido: ${ANTI_GENERIC_VISUAL_CONSTRAINTS[ANTI_GENERIC_VISUAL_CONSTRAINTS.length - 1]}`);
  return references;
}

function isCarouselFormat(format: string): boolean {
  return containsAny(normalize(format), ["carrossel", "carousel", "slides"]);
}

function buildVisualConstraints(
  identity?: ClaraKnowledgeRecord<"IdentityContext">,
  publishing?: ClaraKnowledgeRecord<"PublishingContext">,
): string[] {
  const constraints: string[] = [];
  if (identity?.payload.visualGuidelines?.length) constraints.push(...identity.payload.visualGuidelines);
  if (identity?.payload.fonts?.length) constraints.push(`Usar fontes da marca: ${identity.payload.fonts.join(", ")}.`);
  if (publishing?.payload.approvalFlow) constraints.push(`Respeitar fluxo de aprovação configurado: ${publishing.payload.approvalFlow}.`);
  if (constraints.length === 0) constraints.push("Nenhuma restrição visual formal registrada na Clara; seguir bom senso de marca.");
  return constraints;
}

function buildVisualRisks(
  identity: ClaraKnowledgeRecord<"IdentityContext"> | undefined,
  channel: SofiaSupportedChannel,
  format: string,
): string[] {
  const risks: string[] = [];
  if (!identity) risks.push("Nenhuma identidade visual registrada na Clara; risco de inconsistência visual com a marca.");
  if (!identity?.payload.colors?.length) risks.push("Paleta sugerida é genérica; validar com a identidade visual real da marca antes da produção.");
  risks.push(`Validar aderência do conceito visual ao canal ${channel} e ao formato ${format} durante a etapa de design da Bianca.`);
  return risks;
}

function buildObservations(context: ClaraContextResponse, content?: ClaraKnowledgeRecord<"ContentContext">): string[] {
  const observations: string[] = [];
  if (!context.modules.AudienceContext?.length) observations.push("Nenhum público detalhado na Clara; considerar enriquecer o conhecimento do cliente.");
  if (content?.payload.publicationHistory?.length) {
    observations.push(`Histórico de publicações disponível (${content.payload.publicationHistory.length} publicações) para referência visual.`);
  } else {
    observations.push("Nenhum histórico de publicações encontrado na Clara para referência visual.");
  }
  return observations;
}

function buildNextSteps(input: SofiaArtDirectionRequestInput): string[] {
  return [
    "Encaminhar o briefing estruturado para Bianca transformar esta direção em layout detalhado.",
    "Validar a direção visual com o time de marca antes da produção.",
    `Reavaliar a direção visual caso o canal ${input.channel} ou o formato ${input.format} mudem.`,
  ];
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

export function createSofiaArtDirectionSkill(
  dependencies: Partial<SofiaArtDirectionSkillDependencies> = {},
): SofiaArtDirectionSkill {
  return new SofiaArtDirectionSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    icaro: dependencies.icaro,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
  });
}
