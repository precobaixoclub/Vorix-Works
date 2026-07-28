import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse, ClaraKnowledgeRecord } from "../../application/knowledge/clara.types.js";
import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, latest, normalize } from "../../shared/utils/skill-parsing.js";
import { buildDeveloperAiPendingResponse, isDeveloperAssistancePending } from "../../shared/utils/developer-ai-assistance.js";
import { enrichCinematicScene, type CinematicSceneDecision, type SceneNarrativeRole, type Shot, type ShotPurpose, type TransitionStyle } from "../../shared/utils/cinematic-reference-library.js";
import { deriveCampaignCreativeDNA, type CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import type { DeveloperAssistancePendingOutput } from "../../application/ai/developer-assistance.types.js";
import { vanessaVideoDirectionManifest } from "./vanessa.manifest.js";
import type { VanessaLogAction, VanessaLoggerPort } from "./vanessa-log.contract.js";
import type {
  VanessaBrunoScene,
  VanessaBrunoScriptSummary,
  VanessaDiegoBriefing,
  VanessaDirectionEnhancement,
  VanessaDirectionRequestInput,
  VanessaJoaoStrategySummary,
  VanessaSceneDirection,
  VanessaShotDirection,
  VanessaVisualAssetPriority,
  VanessaVisualSceneDesign,
  VanessaVideoDirectionCore,
  VanessaVideoDirectionOutput,
} from "./vanessa-video-direction.types.js";

export type VanessaIdGenerator = {
  create(prefix: string): string;
};

export type VanessaVideoDirectionSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  icaro?: IcaroBrainPort;
  logger?: VanessaLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: VanessaIdGenerator;
  now?: () => Date;
};

class SequentialVanessaIdGenerator implements VanessaIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopVanessaLogger implements VanessaLoggerPort {
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
      throw new Error(`${portName} não configurado para Vanessa.`);
    },
  });
}

/** Une a saída normal de Vanessa à pausa aguardando IA desenvolvedora, mesmo padrão de `PedroSkillOutput`. */
export type VanessaSkillOutput = VanessaVideoDirectionOutput | DeveloperAssistancePendingOutput;

export class VanessaVideoDirectionSkill implements Skill<VanessaDirectionRequestInput, VanessaSkillOutput> {
  readonly manifest = vanessaVideoDirectionManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly icaro?: IcaroBrainPort;
  private readonly logger: VanessaLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: VanessaIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: VanessaVideoDirectionSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.icaro = dependencies.icaro;
    this.logger = dependencies.logger ?? new NoopVanessaLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialVanessaIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<VanessaDirectionRequestInput>): Promise<SkillResponse<VanessaSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de direção audiovisual inválida.", request, { errors: validationErrors });
      await this.emit("VideoDirectionFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
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
      const message = error instanceof Error ? error.message : "Erro inesperado durante a direção audiovisual.";
      await this.log("Error", `Erro inesperado em Vanessa. ${message}`, request, { error: message });
      await this.emit("VideoDirectionFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runDirection(request: SkillRequest<VanessaDirectionRequestInput>): Promise<SkillResponse<VanessaSkillOutput>> {
    await this.log("RequestReceived", "Solicitação de direção audiovisual recebida por Vanessa.", request, {
      channel: request.input.channel,
      format: request.input.format,
      videoObjective: request.input.videoObjective,
    });
    await this.emit("VideoDirectionStarted", request, {
      channel: request.input.channel,
      videoObjective: request.input.videoObjective,
    });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("VideoDirectionFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
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
      requester: { id: this.manifest.id, type: "specialist", name: "Vanessa" },
      clientId: tenant.clientId,
      modules: ["BrandContext", "AudienceContext", "ContentContext", "IdentityContext", "PublishingContext"],
      reason: "Construção de direção audiovisual a partir do roteiro de vídeo de Bruno.",
    });

    await this.log("ContextConsulted", `Contexto consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });
    await this.emit("VideoDirectionContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    const completeness = evaluateContextCompleteness(claraContext);
    if (!completeness.sufficient) {
      await this.log("ContextIncomplete", "Contexto insuficiente na Clara para construir a direção audiovisual com segurança.", request, {
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      await this.emit("VideoDirectionFailed", request, {
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

    await this.log("DirectionStarted", "Construção da direção audiovisual iniciada.", request, { clientId: tenant.clientId });

    let direction = buildBaselineDirection(request.input, claraContext);
    let aiSupportUsed = false;
    let aiProviderId: string | undefined;

    if (this.icaro) {
      await this.log("AISupportRequested", "Apoio de IA solicitado ao Ícaro para aprimorar a direção audiovisual.", request, { clientId: tenant.clientId });
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
            "Não criar roteiro; o roteiro já foi definido por Bruno e não deve ser alterado.",
            "Não gerar, editar, renderizar ou publicar vídeo, e não crie imagens.",
            "Não redefinir o mapa de cenas, enquadramentos, composição visual por cena, movimentos de câmera, transições ou efeitos visuais por cena — isso é responsabilidade determinística de Vanessa.",
            "Aprimorar apenas ritmo visual, estilo de legenda, trilha recomendada, direção de luz e direção de cor.",
          ],
          expectedOutput: "json",
          priority: "quality",
          temperature: 0.6,
          maxTokens: 1200,
        });

        if (aiResponse.status !== "completed") {
          throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para Vanessa.");
        }

        const enhancement = parseDirectionEnhancement(String(aiResponse.content ?? ""));
        direction = mergeDirectionEnhancement(direction, enhancement);
        aiSupportUsed = true;
        aiProviderId = aiResponse.provider.id;

        await this.log("AISupportApplied", "Apoio de IA aplicado à direção audiovisual.", request, { clientId: tenant.clientId });
        await this.emit("AIGenerationFinished", request, {
          clientId: tenant.clientId,
          provider: aiResponse.provider,
          model: aiResponse.model,
        });
      } catch (error) {
        if (isDeveloperAssistancePending(error)) {
          return buildDeveloperAiPendingResponse(this.manifest.id, request.context.taskId, error);
        }
        const message = error instanceof Error ? error.message : "Erro desconhecido no apoio de IA solicitado por Vanessa.";
        await this.log("AISupportFailed", `Apoio de IA falhou; direção audiovisual segue apenas com heurística e contexto da Clara. ${message}`, request, {
          clientId: tenant.clientId,
          error: message,
        });
      }
    } else {
      await this.log("AISupportSkipped", "Ícaro não foi configurado; direção audiovisual segue apenas com heurística e contexto da Clara.", request, {
        clientId: tenant.clientId,
      });
    }

    await this.log("DirectionFinalized", "Direção audiovisual finalizada.", request, { clientId: tenant.clientId, visualRhythm: direction.visualRhythm });
    await this.emit("VideoDirectionGenerated", request, { clientId: tenant.clientId, aiSupportUsed });

    const diegoBriefing = buildDiegoBriefing(direction, request.input);

    await this.log("DiegoBriefingCreated", "Briefing de direção audiovisual para Diego criado.", request, {
      clientId: tenant.clientId,
      channel: diegoBriefing.channel,
    });
    await this.emit("DiegoBriefingCreated", request, { clientId: tenant.clientId, channel: diegoBriefing.channel });

    const output: VanessaVideoDirectionOutput = {
      ...direction,
      diegoBriefing,
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
          name: "Direção audiovisual estruturada de Vanessa",
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

  private async resolveClient(input: VanessaDirectionRequestInput): Promise<TenantClientContext> {
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
    action: VanessaLogAction,
    message: string,
    request: SkillRequest<VanessaDirectionRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("vanessa-log"),
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

  private async emit(name: ZunoEventName, request: SkillRequest<VanessaDirectionRequestInput>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "vanessa",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: VanessaDirectionRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de direção audiovisual é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!input.channel?.trim()) errors.push("channel é obrigatório.");
  if (!input.format?.trim()) errors.push("format é obrigatório.");
  if (!input.videoObjective?.trim()) errors.push("videoObjective é obrigatório.");
  if (!input.joaoStrategy || typeof input.joaoStrategy !== "object" || !input.joaoStrategy.angle?.trim()) {
    errors.push("joaoStrategy é obrigatório e precisa conter ao menos angle.");
  }
  if (!input.brunoScript || typeof input.brunoScript !== "object" || !Array.isArray(input.brunoScript.scenes) || input.brunoScript.scenes.length === 0) {
    errors.push("brunoScript é obrigatório e precisa conter ao menos uma cena.");
  }
  return errors;
}

function evaluateContextCompleteness(context: ClaraContextResponse): { sufficient: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!context.modules.IdentityContext?.length) missing.push("IdentityContext");
  if (!context.modules.BrandContext?.length) missing.push("BrandContext");

  return {
    sufficient: !(missing.includes("IdentityContext") && missing.includes("BrandContext")),
    missing,
  };
}

export function buildBaselineDirection(
  input: VanessaDirectionRequestInput,
  context: ClaraContextResponse,
): VanessaVideoDirectionCore {
  const identity = latest(context.modules.IdentityContext);
  const brand = latest(context.modules.BrandContext);
  const content = latest(context.modules.ContentContext);

  // Creative Director Engine: mesmos campos de estratégia que Bruno já usou — chega ao mesmo
  // Creative DNA por construção (função pura), sem nenhum dado novo precisar fluir entre Skills.
  const creativeDna = deriveCampaignCreativeDNA({
    originalRequest: input.originalRequest,
    centralPromise: input.joaoStrategy.centralPromise,
    valueProposition: input.joaoStrategy.valueProposition,
    toneOfVoice: input.joaoStrategy.toneOfVoice,
    targetAudience: input.joaoStrategy.targetAudience,
    keyMessages: input.joaoStrategy.keyMessages,
  });

  const sceneDirections = buildSceneDirections(input.brunoScript.scenes);
  const visualRhythm = buildVisualRhythm(input.brunoScript);
  const captionStyle = buildCaptionStyle(input.joaoStrategy);
  const soundDesignGuidance = buildSoundDesignGuidance();
  const musicDirection = buildMusicDirection(input.joaoStrategy, input.brunoScript);
  const brollGuidance = buildBrollGuidance();
  const lightDirection = buildLightDirection(identity, creativeDna);
  const colorDirection = buildColorDirection(identity, creativeDna);
  const recordingGuidance = buildRecordingGuidance();
  const editingGuidance = buildEditingGuidance();
  const risks = buildRisks(input, Boolean(identity), Boolean(brand));
  const observations = buildObservations(context, content);
  const nextSteps = buildNextSteps(input);

  return {
    sceneDirections,
    visualRhythm,
    captionStyle,
    soundDesignGuidance,
    musicDirection,
    brollGuidance,
    lightDirection,
    colorDirection,
    recordingGuidance,
    editingGuidance,
    risks,
    observations,
    nextSteps,
    creativeDna,
  };
}

export function buildIcaroDirectionPrompt(
  input: VanessaDirectionRequestInput,
  direction: VanessaVideoDirectionCore,
  context: ClaraContextResponse,
): string {
  return [
    "Você é o apoio de IA de Vanessa, Diretora de Comerciais do Zuno (não apenas storyboard) — cada cena já recebeu, de forma determinística, 18 decisões cinematográficas explícitas (tipo de plano, posição e altura de câmera, lente simulada, profundidade de campo, foco, luz, temperatura de cor, emoção, ritmo, movimento e velocidade de câmera, duração ideal, composição, regra dos terços, direção do olhar, sensação e motivo narrativo — ver `sceneDirections[].cinematography`). O objetivo é construir momentos memoráveis, não apenas cenas.",
    "Aprimore apenas ritmo visual, estilo de legenda, trilha recomendada, direção de luz e direção de cor.",
    "Não crie roteiro (o roteiro já foi definido por Bruno) e não gere, edite, renderize ou publique vídeo, nem crie imagens.",
    "Não redefina o mapa de cenas, enquadramentos, composição visual por cena, movimentos de câmera, transições, efeitos visuais por cena ou as 18 decisões cinematográficas de `cinematography` — isso é responsabilidade determinística de Vanessa.",
    "Retorne apenas JSON válido, sem markdown.",
    "",
    "PADRÃO DE QUALIDADE OBRIGATÓRIO:",
    [
      "- ritmo visual coerente com o ritmo narrativo já definido por Bruno;",
      "- estilo de legenda e direção de cor coerentes com o tom de voz e a identidade visual da marca;",
      "- trilha recomendada compatível com a emoção do roteiro.",
    ].join("\n"),
    "",
    "RESTRIÇÕES NEGATIVAS:",
    [
      "- não sugerir cor ou luz fora do que a identidade visual da marca já define;",
      "- não propor ritmo visual incompatível com a duração total do roteiro de Bruno.",
    ].join("\n"),
    "",
    "SOLICITAÇÃO ORIGINAL:",
    input.originalRequest,
    "",
    "ESTRATÉGIA DO JOÃO:",
    JSON.stringify(input.joaoStrategy, null, 2),
    "",
    "ROTEIRO DE BRUNO:",
    JSON.stringify(input.brunoScript, null, 2),
    "",
    "DIREÇÃO AUDIOVISUAL BASE:",
    JSON.stringify(direction, null, 2),
    "",
    "MÓDULOS DE CONHECIMENTO DISPONÍVEIS NA CLARA:",
    JSON.stringify(Object.keys(context.modules), null, 2),
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify(
      {
        visualRhythm: direction.visualRhythm,
        captionStyle: direction.captionStyle,
        musicDirection: direction.musicDirection,
        lightDirection: direction.lightDirection,
        colorDirection: direction.colorDirection,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function parseDirectionEnhancement(content: string): VanessaDirectionEnhancement {
  const parsed = JSON.parse(extractJson(content, "Vanessa")) as Partial<Record<keyof VanessaDirectionEnhancement, unknown>>;
  return {
    visualRhythm: typeof parsed.visualRhythm === "string" && parsed.visualRhythm.trim() ? parsed.visualRhythm : undefined,
    captionStyle: typeof parsed.captionStyle === "string" && parsed.captionStyle.trim() ? parsed.captionStyle : undefined,
    musicDirection: typeof parsed.musicDirection === "string" && parsed.musicDirection.trim() ? parsed.musicDirection : undefined,
    lightDirection: typeof parsed.lightDirection === "string" && parsed.lightDirection.trim() ? parsed.lightDirection : undefined,
    colorDirection: typeof parsed.colorDirection === "string" && parsed.colorDirection.trim() ? parsed.colorDirection : undefined,
  };
}

export function mergeDirectionEnhancement(
  direction: VanessaVideoDirectionCore,
  enhancement: VanessaDirectionEnhancement,
): VanessaVideoDirectionCore {
  return {
    ...direction,
    visualRhythm: enhancement.visualRhythm ?? direction.visualRhythm,
    captionStyle: enhancement.captionStyle ?? direction.captionStyle,
    musicDirection: enhancement.musicDirection ?? direction.musicDirection,
    lightDirection: enhancement.lightDirection ?? direction.lightDirection,
    colorDirection: enhancement.colorDirection ?? direction.colorDirection,
  };
}

export function buildDiegoBriefing(direction: VanessaVideoDirectionCore, input: VanessaDirectionRequestInput): VanessaDiegoBriefing {
  return {
    status: "preliminary",
    sceneDirections: direction.sceneDirections,
    visualRhythm: direction.visualRhythm,
    captionStyle: direction.captionStyle,
    soundDesignGuidance: direction.soundDesignGuidance,
    musicDirection: direction.musicDirection,
    brollGuidance: direction.brollGuidance,
    lightDirection: direction.lightDirection,
    colorDirection: direction.colorDirection,
    recordingGuidance: direction.recordingGuidance,
    editingGuidance: direction.editingGuidance,
    channel: input.channel,
    notes: [
      "Este briefing cobre exclusivamente direção audiovisual (mapa de cenas, enquadramento, composição visual, movimento de câmera, ritmo visual, transições, legenda, efeitos visuais e sonoros, trilha, B-roll, luz e cor).",
      "Gravação, edição, renderização e publicação do vídeo são responsabilidade das próximas Skills da pipeline de vídeo (Diego, Rafa), ainda não implementadas.",
      `Canal solicitado: ${input.channel}.`,
      `Formato solicitado: ${input.format}.`,
    ],
  };
}

/**
 * AGENCY FILM PIPELINE 2.0 — Vanessa dirige a fotografia por Shot. Este helper transforma cada
 * `Shot` que Bruno criou (com cinematografia, motion e assetRequirement já preenchidos pela
 * shared library) em uma `VanessaShotDirection` — a direção final de fotografia que Diego/Rafa
 * consomem. Vanessa nunca redefine cinematografia do Shot; apenas ADICIONA a decisão dela sobre
 * iluminação, composição e enquadramento em cima da base já existente, e refina o pedido de
 * asset com vocabulário específico dela.
 */
function buildShotDirectionsForScene(scene: VanessaBrunoScene, baseDirection: VanessaSceneDirectionDraft): VanessaShotDirection[] {
  const sceneAssetPriority = baseDirection.visualSceneDesign?.assetPriority ?? "context_photo";
  const sceneLightingBase = baseDirection.visualSceneDesign?.lighting ?? baseDirection.cinematography.lighting;
  const sceneCompositionBase = baseDirection.visualSceneDesign?.composition ?? baseDirection.cinematography.composition;
  const featureFocusTags = scene.featureFocus ? [normalize(scene.featureFocus).replace(/\s+/g, "_")] : [];
  return scene.shots.map((shot) => {
    const framing = `${shot.cinematography.shotType} — ${shot.assetRequirement.framing}`;
    const lighting = `${shot.cinematography.lighting} (Vanessa refina: ${sceneLightingBase})`;
    const composition = `${shot.cinematography.composition} (${sceneCompositionBase})`;
    const cameraMovement = `${shot.cinematography.cameraMovement} — ${shot.motion.action} (${shot.motion.motivation})`;
    const eyeFocus = shot.cinematography.gazeDirection;
    return {
      shotId: shot.id,
      shotOrder: shot.order,
      purpose: shot.purpose,
      framing,
      lighting,
      composition,
      cameraMovement,
      eyeFocus,
      visualAssetRequirement: {
        whatShouldAppear: shot.assetRequirement.whatShouldAppear,
        emotion: shot.assetRequirement.emotion,
        // Vanessa converte o `preferredMediaKind` do Shot em `imageType` do vocabulário legado
        // dela — o resolver aprende o kind exato pelo `preferredMediaKind` abaixo.
        imageType: mapMediaKindToImageType(shot.assetRequirement.preferredMediaKind),
        framing: shot.assetRequirement.framing,
        movement: shot.assetRequirement.movement,
        lighting: shot.assetRequirement.lighting,
        narrativeFunction: `${shot.assetRequirement.narrativeFunction} — Shot ${shot.order}/${scene.shots.length}, propósito ${shot.purpose}`,
        tags: [...shot.assetRequirement.tags, ...featureFocusTags],
        forbiddenTags: shot.assetRequirement.forbiddenTags,
        assetPriority: sceneAssetPriority,
        sequenceRole: shot.assetRequirement.sequenceRole,
        preferredMediaKind: shot.assetRequirement.preferredMediaKind,
      },
      transitionToNextShot: shot.transitionToNext,
      continuityFromPreviousShot: shot.continuityFromPrevious,
    };
  });
}

function mapMediaKindToImageType(kind: Shot["assetRequirement"]["preferredMediaKind"]): "photo" | "illustration" | "mockup" | "graphic" {
  // Vanessa mantém o vocabulário legado `imageType` (apenas 4 opções) para preservar contrato com
  // Diego/Rafa; o kind real (vídeo/b-roll/cinemagraph) segue no `preferredMediaKind` do requirement.
  if (kind === "mockup") return "mockup";
  if (kind === "graphic") return "graphic";
  if (kind === "illustration") return "illustration";
  return "photo";
}

function buildSceneDirections(scenes: VanessaBrunoScene[]): VanessaSceneDirection[] {
  let developmentBeatIndex = 0;
  return scenes.map((scene) => {
    const role = narrativeRoleFor(scene.name);
    const beatIndex = role === "development" ? developmentBeatIndex++ : 0;
    const baseDirection = buildSceneDirection(scene, beatIndex);
    // AGENCY FILM PIPELINE 2.0 — Vanessa dirige por Shot. Toda cena deve sair daqui com uma
    // shotDirection para cada Shot que Bruno criou (mesma order, mesmo id). Nenhuma cena aceita
    // menos de 2 direções; se Bruno mandou apenas 1 Shot (não deveria acontecer, pois Bruno
    // valida com MIN_SHOTS_PER_SCENE), aqui geramos erro imediatamente.
    const shotDirections = buildShotDirectionsForScene(scene, baseDirection);
    if (shotDirections.length < 2) {
      throw new Error(
        `VANESSA_INSUFFICIENT_SHOT_DIRECTIONS: cena ${scene.order} (${scene.name}) recebeu ${shotDirections.length} Shots de Bruno; Vanessa exige pelo menos 2.`,
      );
    }
    return { ...baseDirection, shotDirections };
  });
}

function narrativeRoleFor(sceneName: string): SceneNarrativeRole {
  if (sceneName === "Gancho") return "hook";
  if (sceneName === "CTA final") return "cta";
  return "development";
}

/**
 * `beatIndex` é a posição desta cena dentro do bloco de cenas de desenvolvimento (0-based; sempre
 * 0 para gancho/CTA). Existe para que `enrichCinematicScene` varie composição/enquadramento/foco
 * entre cenas de desenvolvimento que, de outra forma, receberiam o mesmo `rhythm` de Bruno e
 * sairiam com a cinematografia idêntica — ver `DEVELOPMENT_BEAT_VARIANTS` na biblioteca compartilhada.
 */
type VanessaSceneDirectionDraft = Omit<VanessaSceneDirection, "shotDirections">;

function buildSceneDirection(scene: VanessaBrunoScene, beatIndex = 0): VanessaSceneDirectionDraft {
  const cinematography = enrichCinematicScene(narrativeRoleFor(scene.name), scene.rhythm, scene.durationSeconds, beatIndex);
  const visualSceneDesign = buildVisualSceneDesign(scene, cinematography);
  const visualAssetRequirement = buildVisualAssetRequirement(scene, cinematography, visualSceneDesign.assetPriority);

  if (scene.name === "Gancho") {
    return {
      order: scene.order,
      name: scene.name,
      framing: "Close-up direto para a câmera, enquadramento centralizado, pouco espaço negativo ao redor do rosto para reforçar urgência.",
      visualComposition: "Regra dos terços com o rosto no terço superior do quadro, fundo desfocado para não competir com o gancho.",
      cameraMovement: scene.cameraMovement,
      transitionToNext: "Corte seco, sem efeito de transição, para preservar o impacto do gancho.",
      visualEffects: ["Leve punch-in (zoom digital sutil) no início da fala para reforçar o gancho."],
      cinematography,
      visualAssetRequirement,
      visualSceneDesign,
    };
  }

  if (scene.name === "CTA final") {
    return {
      order: scene.order,
      name: scene.name,
      framing: "End card vertical com logo oficial em tamanho controlado, mockup/screenshot do site e URL legível.",
      visualComposition: "Composição limpa com respiro: logo oficial no topo, headline no centro, mockup/screenshot do site como prova visual e URL/CTA em área segura.",
      cameraMovement: "Micro push-in no mockup, sem deformar a marca.",
      transitionToNext: undefined,
      visualEffects: ["Card/gradiente escuro sutil para garantir contraste do texto.", "Nunca reconstruir, ampliar ou ornamentar a logo como fundo abstrato."],
      cinematography,
      visualAssetRequirement,
      visualSceneDesign,
    };
  }

  if (scene.featureFocus?.includes("rsvp")) {
    return {
      order: scene.order,
      name: scene.name,
      framing: "Close-up de interface em celular, com RSVP claramente visível.",
      visualComposition: "Mockup de celular ocupando o terço central, com espaço escuro/limpo para headline curta.",
      cameraMovement: "Zoom suave de interface, sem tremer.",
      transitionToNext: "Corte por movimento de tela, rápido e limpo.",
      visualEffects: ["Realce discreto no botão/estado de confirmação."],
      cinematography,
      visualAssetRequirement,
      visualSceneDesign,
    };
  }

  if (scene.featureFocus?.includes("presentes") || scene.featureFocus?.includes("album") || scene.featureFocus?.includes("cronograma")) {
    return {
      order: scene.order,
      name: scene.name,
      framing: "Composição de cards reais do produto em celular, alternando escala entre detalhe e visão geral.",
      visualComposition: "Cards de interface com hierarquia clara, não foto genérica; fundo humano/casamento apenas como apoio desfocado.",
      cameraMovement: scene.name.includes("Benefícios") ? "Parallax leve entre cards" : "Pull-out suave para revelar organização.",
      transitionToNext: scene.transitionToNext ?? "Dissolve curto para manter elegância.",
      visualEffects: ["Scrim sutil atrás de texto público.", "Animação curta de entrada dos cards."],
      cinematography,
      visualAssetRequirement,
      visualSceneDesign,
    };
  }

  return {
    order: scene.order,
    name: scene.name,
    framing: "Plano médio com pessoa usando o produto em celular ou notebook.",
    visualComposition: "Sujeito levemente descentralizado e interface real/mockup ocupando área central segura.",
    cameraMovement: scene.cameraMovement,
    transitionToNext: scene.transitionToNext ?? "Corte dinâmico sincronizado com o ritmo da narração.",
    visualEffects: ["Inserção de mockup/screenshot real do produto; fotografia genérica só como apoio desfocado."],
    cinematography,
    visualAssetRequirement,
    visualSceneDesign,
  };
}

function buildVisualAssetRequirement(
  scene: VanessaBrunoScene,
  cinematography: CinematicSceneDecision,
  assetPriority: VanessaVisualAssetPriority,
): NonNullable<VanessaSceneDirection["visualAssetRequirement"]> {
  const text = `${scene.name} ${scene.spokenText} ${scene.publicVisibleText ?? ""} ${scene.publicSubtitle ?? ""} ${scene.featureFocus ?? ""} ${scene.onScreenText ?? ""} ${scene.brollSuggestions.join(" ")}`.toLowerCase();
  const tags = inferSceneTags(text, scene.name, assetPriority);
  const isCta = scene.name === "CTA final";
  const imageType = assetPriorityToImageType(assetPriority, isCta);
  return {
    whatShouldAppear: buildWhatShouldAppear(scene, tags),
    emotion: cinematography.emotion,
    imageType,
    framing: cinematography.shotType,
    movement: cinematography.cameraMovement,
    lighting: cinematography.lighting,
    narrativeFunction: cinematography.narrativeMotive,
    tags,
    assetPriority,
  };
}

function assetPriorityToImageType(assetPriority: VanessaVisualAssetPriority, isCta: boolean): NonNullable<VanessaSceneDirection["visualAssetRequirement"]>["imageType"] {
  if (isCta || assetPriority === "brand_end_card") return "graphic";
  if (assetPriority === "product_mockup" || assetPriority === "screenshot") return "mockup";
  return "photo";
}

function buildVisualSceneDesign(scene: VanessaBrunoScene, cinematography: CinematicSceneDecision): VanessaVisualSceneDesign {
  const assetPriority = visualAssetPriorityFor(scene);
  const intensity = scene.narrativeIntensity ?? "beneficio";

  if (scene.name === "CTA final") {
    return {
      mainElement: "Logo oficial do Rumo ao Altar com headline e URL em leitura imediata.",
      secondaryElement: "Mockup elegante do site oficial como prova visual, menor que a marca e sem competir com o CTA.",
      backgroundPlane: "Gradiente suave nas cores da marca, com área limpa e contraste alto.",
      foregroundPlane: "CTA e URL em cartão translúcido com respiro amplo.",
      depth: "Camadas separadas: fundo escuro, mockup em perspectiva, logo e CTA em primeiro plano.",
      lighting: "Brilho suave atrás do mockup e sombra elegante sob os cartões.",
      atmosphere: "Premium, romântica, confiante e comercial.",
      emotion: cinematography.emotion,
      visualRhythm: "Entrada separada de logo, mockup, headline, benefício e URL.",
      eyeFocus: "Primeiro a marca, depois o mockup, por fim o endereço do site.",
      composition: "End card com regra dos terços, espaço negativo e área segura respeitada.",
      productIntegration: "Usar somente logo oficial e mockup/screenshot real, nunca reconstruir marca ou criar ornamentos abstratos.",
      assetPriority,
    };
  }

  if (assetPriority === "person_using_product") {
    return {
      mainElement: "Casal real usando celular ou notebook com o site do casamento visível.",
      secondaryElement: "Mockup ou interface real integrada ao dispositivo, como parte natural da cena.",
      backgroundPlane: "Ambiente de casamento desfocado, com flores, convite ou mesa elegante como contexto.",
      foregroundPlane: "Mãos, celular e detalhes de aliança criando profundidade no primeiro plano.",
      depth: "Camadas claras: detalhe em foreground, casal/produto no meio e fundo romântico desfocado.",
      lighting: "Luz natural suave, sombras macias e reflexo discreto no dispositivo.",
      atmosphere: "Cinematográfica, humana e tranquila.",
      emotion: cinematography.emotion,
      visualRhythm: intensity === "impacto" ? "Entrada rápida com hero shot e movimento de aproximação." : "Movimento suave para descoberta do produto.",
      eyeFocus: "Olhar começa no casal e termina na interface do produto.",
      composition: "Hero shot com regra dos terços, espaço negativo para headline curta e interface legível.",
      productIntegration: "O mockup deve parecer dentro do celular/notebook, nunca um bloco solto sobre o fundo.",
      assetPriority,
    };
  }

  if (assetPriority === "context_photo") {
    return {
      mainElement: "Contexto humano do casamento transmitindo organização e tranquilidade.",
      secondaryElement: "Interface do site como detalhe de apoio, sem dominar o quadro.",
      backgroundPlane: "Cena real de preparação, convidados ou mesa do casamento com profundidade.",
      foregroundPlane: "Detalhe de convite, flor, aliança ou celular desfocado criando camada frontal.",
      depth: "Profundidade cinematográfica com primeiro plano suave e fundo com bokeh.",
      lighting: "Iluminação natural quente, elegante e sem excesso de contraste.",
      atmosphere: "Calma, organizada e aspiracional.",
      emotion: cinematography.emotion,
      visualRhythm: "Respiração visual com pan lento e pequenos reveals.",
      eyeFocus: "Olhar guiado do detalhe emocional para o benefício do produto.",
      composition: "Composição assimétrica, espaço negativo e texto no terço central seguro.",
      productIntegration: "Produto aparece como facilitador dentro do contexto, não como apresentação isolada.",
      assetPriority,
    };
  }

  return {
    mainElement: "Interface real do Rumo ao Altar em mockup premium.",
    secondaryElement: "Cartão translúcido ou recorte de funcionalidade reforçando a prova da cena.",
    backgroundPlane: "Fundo com fotografia de casamento desfocada ou gradiente da marca.",
    foregroundPlane: "Cards leves, brilho ou detalhe visual pequeno para criar camada frontal.",
    depth: "Mockup em perspectiva com sombra realista, cards em camadas e fundo desfocado.",
    lighting: "Light sweep sutil e sombra elegante para destacar a interface.",
    atmosphere: "Moderna, organizada e premium.",
    emotion: cinematography.emotion,
    visualRhythm: intensity === "demonstracao" ? "Reveal de interface com micro interação." : "Cards entrando em sequência, sem simultaneidade.",
    eyeFocus: "Olhar entra pela headline e desce para a funcionalidade demonstrada.",
    composition: "Mockup no terço oposto ao texto, cartão translúcido e área segura livre.",
    productIntegration: "A interface deve ser prova visual do benefício central, não um print solto.",
    assetPriority,
  };
}

function visualAssetPriorityFor(scene: VanessaBrunoScene): VanessaVisualAssetPriority {
  if (scene.name === "CTA final") return "brand_end_card";
  if (scene.narrativeIntensity === "impacto" || scene.narrativeIntensity === "convite") return "person_using_product";
  if (scene.narrativeIntensity === "prova") return "context_photo";
  if (scene.featureFocus?.includes("rsvp") || scene.featureFocus?.includes("presentes") || scene.featureFocus?.includes("album")) return "product_mockup";
  if (scene.featureFocus?.includes("cronograma")) return "screenshot";
  return "person_using_product";
}

function buildWhatShouldAppear(scene: VanessaBrunoScene, tags: string[]): string {
  if (scene.name === "CTA final") return "End card profissional com logo oficial do Rumo ao Altar, URL rumoaoaltar.com.br, CTA claro e mockup/screenshot real do site oficial.";
  if (tags.includes("pessoa-usando-produto")) return "Casal real usando celular ou notebook com o site oficial do casamento integrado à cena, com profundidade, luz natural e interface legível.";
  if (tags.includes("contexto-humano")) return "Cena humana de casamento com detalhe de celular/site como apoio, mostrando organização e tranquilidade sem parecer tela de apresentação.";
  if (tags.includes("overview")) return "Screenshot ou mockup real de visão geral do site Rumo ao Altar, mostrando RSVP, presentes, álbum e cronograma como experiência única.";
  if (tags.includes("rsvp")) return "Screenshot ou mockup real do RSVP do Rumo ao Altar em celular, mostrando confirmação de presença de forma clara.";
  if (tags.includes("presentes") && tags.includes("album")) return "Mockup real do site do Rumo ao Altar com cards de lista de presentes, álbum colaborativo e informações aos convidados.";
  if (tags.includes("presentes")) return "Screenshot ou mockup real da lista de presentes do Rumo ao Altar, destacando Pix e organização sem taxa.";
  if (tags.includes("album")) return "Screenshot ou mockup real do álbum colaborativo do Rumo ao Altar, com envio de fotos por convidados.";
  if (tags.includes("cronograma")) return "Screenshot ou mockup real de cronograma e informações para convidados dentro do site Rumo ao Altar.";
  if (tags.includes("celular") || tags.includes("site")) return "Casal recém-noivo usando celular ou notebook com mockup/screenshot real do site oficial do casamento Rumo ao Altar.";
  return scene.brollSuggestions[0] ?? scene.spokenText;
}

function inferSceneTags(text: string, sceneName: string, assetPriority: VanessaVisualAssetPriority): string[] {
  const tags = new Set(["casamento", "rumo-ao-altar"]);
  if (sceneName === "Gancho") tags.add("casal");
  if (sceneName === "Descoberta") tags.add("overview");
  if (sceneName === "CTA final") tags.add("cta");
  if (sceneName === "CTA final") tags.add("logo");
  if (containsAny(text, ["celular", "site", "oficial", "whatsapp", "mensagens"])) {
    tags.add("celular");
    tags.add("site");
    tags.add("casal");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(text, ["rsvp", "presença", "presenca", "confirmam", "confirmacao", "confirmação"])) {
    tags.add("rsvp");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(text, ["presente", "presentes", "pix", "taxa"])) {
    tags.add("presentes");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(text, ["album", "álbum", "foto", "fotos"])) {
    tags.add("album");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(text, ["cronograma", "horario", "horário"])) {
    tags.add("cronograma");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(text, ["convite", "convidado", "convidados", "informacoes", "informações"])) tags.add("convidados");
  if (assetPriority === "person_using_product") {
    tags.add("pessoa");
    tags.add("casal");
    tags.add("celular");
    tags.add("pessoa-usando-produto");
  }
  if (assetPriority === "context_photo") {
    tags.add("pessoa");
    tags.add("contexto-humano");
    tags.add("foto-contexto");
  }
  if (assetPriority === "product_mockup") {
    tags.add("mockup-produto");
    tags.add("produto-real");
    tags.add("interface");
  }
  if (assetPriority === "screenshot") {
    tags.add("screenshot");
    tags.add("interface");
    tags.add("produto-real");
  }
  if (assetPriority === "brand_end_card") {
    tags.add("end-card");
    tags.add("logo-oficial");
    tags.add("mockup-produto");
  }
  return [...tags];
}

function buildVisualRhythm(brunoScript: VanessaBrunoScriptSummary): string {
  return `Ritmo visual acompanha o ritmo narrativo do roteiro (${brunoScript.overallRhythm.charAt(0).toLowerCase()}${brunoScript.overallRhythm.slice(1)}), com cortes mais curtos no gancho e no CTA final e cortes um pouco mais espaçados durante o desenvolvimento, sem nunca deixar o quadro parado por mais de alguns segundos.`;
}

function buildCaptionStyle(strategy: VanessaJoaoStrategySummary): string {
  const normalizedTone = normalize(strategy.toneOfVoice);
  if (containsAny(normalizedTone, ["leve", "divertido", "humor"])) {
    return "Legendas com fonte arredondada e peso bold, aparecendo palavra a palavra em sincronia com a fala, com destaque de cor nas palavras-chave.";
  }
  if (containsAny(normalizedTone, ["serio", "profissional", "consultivo"])) {
    return "Legendas com fonte limpa e discreta, aparecendo em blocos de frase completos, sem animação exagerada.";
  }
  return `Legendas com fonte legível e consistente com o tom de voz "${strategy.toneOfVoice}" da marca, sempre posicionadas fora das zonas seguras de UI do canal.`;
}

function buildSoundDesignGuidance(): string[] {
  return [
    "Sincronizar efeitos sonoros exatamente nos pontos de corte, nunca antes ou depois do movimento visual.",
    "Manter os efeitos sonoros sempre abaixo do volume da narração e da trilha, nunca competindo com a fala.",
  ];
}

function buildMusicDirection(strategy: VanessaJoaoStrategySummary, brunoScript: VanessaBrunoScriptSummary): string {
  const toneNote = brunoScript.musicSuggestions[0] ? ` (${brunoScript.musicSuggestions[0].charAt(0).toLowerCase()}${brunoScript.musicSuggestions[0].slice(1)})` : "";
  return `Trilha coerente com o tom de voz "${strategy.toneOfVoice}"${toneNote}, com entrada sutil no gancho, mantida em segundo plano durante a narração e leve subida de volume no CTA final.`;
}

function buildBrollGuidance(): string[] {
  return [
    "Capturar B-roll em pelo menos 1,5x a duração necessária de cada cena para dar liberdade de corte na edição.",
    "Priorizar planos de B-roll que reforcem visualmente as mensagens-chave da narração, nunca aleatórios ou genéricos.",
  ];
}

function buildLightDirection(identity: ClaraKnowledgeRecord<"IdentityContext"> | undefined, creativeDna: CampaignCreativeDNA): string {
  const base = identity?.payload.imageStyle
    ? `Luz natural e suave, evitando sombras duras no rosto, coerente com o estilo visual "${identity.payload.imageStyle}" da marca.`
    : "Luz natural difusa, evitando sombras duras no rosto, até a identidade visual real ser cadastrada na Clara.";
  return `${base} Hero Lighting do Creative DNA: ${creativeDna.heroLighting}`;
}

function buildColorDirection(identity: ClaraKnowledgeRecord<"IdentityContext"> | undefined, creativeDna: CampaignCreativeDNA): string {
  const base = identity?.payload.colors?.length
    ? `Grade de cor com leve realce nas cores da marca (${identity.payload.colors.join(", ")}), mantendo tons de pele naturais.`
    : "Grade de cor neutra e natural, mantendo tons de pele fiéis, até a identidade visual real ser cadastrada na Clara.";
  return `${base} Hero Color Mood do Creative DNA: ${creativeDna.heroColorMood}`;
}

function buildRecordingGuidance(): string[] {
  return [
    "Manter consistência de enquadramento entre todas as cenas para preservar unidade visual do vídeo.",
    "Gravar takes extras de cada cena com pequenas variações de expressão para dar opções na edição.",
    "Confirmar continuidade de figurino e cenário entre tomadas da mesma cena.",
  ];
}

function buildEditingGuidance(): string[] {
  return [
    "Sincronizar os cortes exatamente com os pontos de transição definidos por cena.",
    "Aplicar color grading consistente com a direção de cor em todas as cenas antes da entrega.",
    "Verificar que as legendas seguem o estilo definido em todas as cenas com fala.",
  ];
}

function buildRisks(input: VanessaDirectionRequestInput, hasIdentity: boolean, hasBrand: boolean): string[] {
  const risks: string[] = [];
  if (!hasIdentity) risks.push("Nenhuma identidade visual registrada na Clara; risco de inconsistência visual com a marca.");
  if (!hasBrand) risks.push("Nenhum tom de voz de marca registrado na Clara; risco de inconsistência na direção de legenda e trilha.");
  risks.push(`Validar se a direção audiovisual é compatível com as práticas recomendadas do canal ${input.channel} antes da gravação.`);
  risks.push("Direção depende de revisão humana antes da gravação, pois Vanessa não valida performance real do vídeo.");
  return risks;
}

function buildObservations(context: ClaraContextResponse, content?: ClaraKnowledgeRecord<"ContentContext">): string[] {
  const observations: string[] = [];
  if (!context.modules.AudienceContext?.length) observations.push("Nenhum público detalhado na Clara; considerar enriquecer o conhecimento do cliente.");
  if (content?.payload.publicationHistory?.length) {
    observations.push(`Histórico de publicações disponível (${content.payload.publicationHistory.length} publicações) para referência de estilo visual.`);
  } else {
    observations.push("Nenhum histórico de publicações encontrado na Clara para referência de estilo visual.");
  }
  return observations;
}

function buildNextSteps(input: VanessaDirectionRequestInput): string[] {
  return [
    "Encaminhar a direção audiovisual estruturada para o futuro Diego transformar em gravação.",
    "Validar a direção audiovisual com o time de marca antes da gravação.",
    `Reavaliar a direção audiovisual caso o canal ${input.channel} ou o objetivo do vídeo mudem.`,
  ];
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

export function createVanessaVideoDirectionSkill(
  dependencies: Partial<VanessaVideoDirectionSkillDependencies> = {},
): VanessaVideoDirectionSkill {
  return new VanessaVideoDirectionSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    icaro: dependencies.icaro,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
  });
}
