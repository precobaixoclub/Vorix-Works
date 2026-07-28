import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse, ClaraKnowledgeRecord } from "../../application/knowledge/clara.types.js";
import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, latest, normalizeStringArray } from "../../shared/utils/skill-parsing.js";
import { buildDeveloperAiPendingResponse, isDeveloperAssistancePending } from "../../shared/utils/developer-ai-assistance.js";
import { deriveCampaignCreativeDNA, type CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import {
  enrichEditingDecision,
  selectMusicTrack,
  selectSoundEffectsForScene,
  type SceneNarrativeRole,
} from "../../shared/utils/cinematic-reference-library.js";
import type { DeveloperAssistancePendingOutput } from "../../application/ai/developer-assistance.types.js";
import { diegoVideoEditingManifest } from "./diego.manifest.js";
import type { DiegoLogAction, DiegoLoggerPort } from "./diego-log.contract.js";
import type {
  DiegoBrunoScene,
  DiegoEditingCore,
  DiegoEditingEnhancement,
  DiegoEditingSceneDecision,
  DiegoNarrativeIntensity,
  DiegoEditingOutput,
  DiegoEditingRequestInput,
  DiegoRafaBriefing,
  DiegoTimelineEntry,
  DiegoVanessaDirectionSummary,
  DiegoVanessaSceneDirection,
} from "./diego-video-editing.types.js";

export type DiegoIdGenerator = {
  create(prefix: string): string;
};

export type DiegoVideoEditingSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  icaro?: IcaroBrainPort;
  logger?: DiegoLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: DiegoIdGenerator;
  now?: () => Date;
};

class SequentialDiegoIdGenerator implements DiegoIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopDiegoLogger implements DiegoLoggerPort {
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
      throw new Error(`${portName} não configurado para Diego.`);
    },
  });
}

/** Une a saída normal de Diego à pausa aguardando IA desenvolvedora, mesmo padrão de `PedroSkillOutput`. */
export type DiegoSkillOutput = DiegoEditingOutput | DeveloperAssistancePendingOutput;

export class DiegoVideoEditingSkill implements Skill<DiegoEditingRequestInput, DiegoSkillOutput> {
  readonly manifest = diegoVideoEditingManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly icaro?: IcaroBrainPort;
  private readonly logger: DiegoLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: DiegoIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: DiegoVideoEditingSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.icaro = dependencies.icaro;
    this.logger = dependencies.logger ?? new NoopDiegoLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialDiegoIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<DiegoEditingRequestInput>): Promise<SkillResponse<DiegoSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de plano de edição inválida.", request, { errors: validationErrors });
      await this.emit("VideoEditingFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
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
      return await this.runEditingPlan(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante o plano de edição.";
      await this.log("Error", `Erro inesperado em Diego. ${message}`, request, { error: message });
      await this.emit("VideoEditingFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runEditingPlan(request: SkillRequest<DiegoEditingRequestInput>): Promise<SkillResponse<DiegoSkillOutput>> {
    await this.log("RequestReceived", "Solicitação de plano de edição recebida por Diego.", request, {
      channel: request.input.channel,
      format: request.input.format,
      videoObjective: request.input.videoObjective,
    });
    await this.emit("VideoEditingStarted", request, {
      channel: request.input.channel,
      videoObjective: request.input.videoObjective,
    });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("VideoEditingFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
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
      requester: { id: this.manifest.id, type: "specialist", name: "Diego" },
      clientId: tenant.clientId,
      modules: ["BrandContext", "AudienceContext", "ContentContext", "IdentityContext", "PublishingContext"],
      reason: "Construção de plano técnico de edição a partir do roteiro de Bruno e da direção audiovisual de Vanessa.",
    });

    await this.log("ContextConsulted", `Contexto consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });
    await this.emit("VideoEditingContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    const completeness = evaluateContextCompleteness(claraContext);
    if (!completeness.sufficient) {
      await this.log("ContextIncomplete", "Contexto insuficiente na Clara para construir o plano de edição com segurança.", request, {
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      await this.emit("VideoEditingFailed", request, {
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

    await this.log("EditingPlanStarted", "Construção do plano de edição iniciada.", request, { clientId: tenant.clientId });

    let plan = buildBaselineEditingPlan(request.input, claraContext);
    let aiSupportUsed = false;
    let aiProviderId: string | undefined;

    if (this.icaro) {
      await this.log("AISupportRequested", "Apoio de IA solicitado ao Ícaro para aprimorar o plano de edição.", request, { clientId: tenant.clientId });
      await this.emit("AIGenerationStarted", request, { clientId: tenant.clientId, channel: request.input.channel });

      try {
        const prompt = buildIcaroEditingPrompt(request.input, plan, claraContext);
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
            "Não criar roteiro nem dirigir vídeo; roteiro e direção já foram definidos por Bruno e Vanessa e não devem ser alterados.",
            "Não renderizar ou publicar vídeo, e não gere vídeo final ou imagens.",
            "Não redefinir a timeline, ordem das cenas, cortes, duração de cada trecho, legendas por cena ou textos na tela — isso é responsabilidade determinística de Diego.",
            "Aprimorar apenas o plano de trilha, os assets necessários, as instruções de edição e o checklist técnico.",
          ],
          expectedOutput: "json",
          priority: "quality",
          temperature: 0.6,
          maxTokens: 1200,
        });

        if (aiResponse.status !== "completed") {
          throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para Diego.");
        }

        const enhancement = parseEditingEnhancement(String(aiResponse.content ?? ""));
        plan = mergeEditingEnhancement(plan, enhancement);
        aiSupportUsed = true;
        aiProviderId = aiResponse.provider.id;

        await this.log("AISupportApplied", "Apoio de IA aplicado ao plano de edição.", request, { clientId: tenant.clientId });
        await this.emit("AIGenerationFinished", request, {
          clientId: tenant.clientId,
          provider: aiResponse.provider,
          model: aiResponse.model,
        });
      } catch (error) {
        if (isDeveloperAssistancePending(error)) {
          return buildDeveloperAiPendingResponse(this.manifest.id, request.context.taskId, error);
        }
        const message = error instanceof Error ? error.message : "Erro desconhecido no apoio de IA solicitado por Diego.";
        await this.log("AISupportFailed", `Apoio de IA falhou; plano de edição segue apenas com heurística e contexto da Clara. ${message}`, request, {
          clientId: tenant.clientId,
          error: message,
        });
      }
    } else {
      await this.log("AISupportSkipped", "Ícaro não foi configurado; plano de edição segue apenas com heurística e contexto da Clara.", request, {
        clientId: tenant.clientId,
      });
    }

    await this.log("EditingPlanFinalized", "Plano de edição finalizado.", request, {
      clientId: tenant.clientId,
      totalDurationSeconds: plan.totalDurationSeconds,
    });
    await this.emit("VideoEditingGenerated", request, { clientId: tenant.clientId, aiSupportUsed });

    const rafaBriefing = buildRafaBriefing(plan, request.input);

    await this.log("RafaBriefingCreated", "Briefing de plano de edição para Rafa criado.", request, {
      clientId: tenant.clientId,
      channel: rafaBriefing.channel,
    });
    await this.emit("RafaBriefingCreated", request, { clientId: tenant.clientId, channel: rafaBriefing.channel });

    const output: DiegoEditingOutput = {
      ...plan,
      rafaBriefing,
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
          name: "Plano de edição estruturado de Diego",
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

  private async resolveClient(input: DiegoEditingRequestInput): Promise<TenantClientContext> {
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
    action: DiegoLogAction,
    message: string,
    request: SkillRequest<DiegoEditingRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("diego-log"),
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

  private async emit(name: ZunoEventName, request: SkillRequest<DiegoEditingRequestInput>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "diego",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: DiegoEditingRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de plano de edição é obrigatória."];
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
  if (
    !input.vanessaDirection ||
    typeof input.vanessaDirection !== "object" ||
    !Array.isArray(input.vanessaDirection.sceneDirections) ||
    input.vanessaDirection.sceneDirections.length === 0
  ) {
    errors.push("vanessaDirection é obrigatório e precisa conter ao menos uma direção de cena.");
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

export function buildBaselineEditingPlan(
  input: DiegoEditingRequestInput,
  context: ClaraContextResponse,
): DiegoEditingCore {
  const identity = latest(context.modules.IdentityContext);
  const content = latest(context.modules.ContentContext);

  // Creative Director Engine: mesmos campos de estratégia que Bruno/Vanessa já usaram — chega ao
  // mesmo Creative DNA por construção (função pura), sem nenhum dado novo precisar fluir entre Skills.
  const creativeDna = deriveCampaignCreativeDNA({
    originalRequest: input.originalRequest,
    centralPromise: input.joaoStrategy.centralPromise,
    valueProposition: input.joaoStrategy.valueProposition,
    toneOfVoice: input.joaoStrategy.toneOfVoice,
    targetAudience: input.joaoStrategy.targetAudience,
    keyMessages: input.joaoStrategy.keyMessages,
  });

  const musicTrack = selectMusicTrack(
    input.joaoStrategy.toneOfVoice,
    input.joaoStrategy.angle,
    input.originalRequest,
    input.vanessaDirection.musicDirection,
  );
  const editingTimeline = buildEditingTimeline(input.brunoScript.scenes, input.vanessaDirection.sceneDirections);
  const totalDurationSeconds = input.brunoScript.totalDurationSeconds;
  const musicTrackPlan = buildMusicTrackPlan(input.vanessaDirection, musicTrack, totalDurationSeconds);
  const requiredAssets = buildRequiredAssets(input, identity);
  const editingInstructions = buildEditingInstructions(input.vanessaDirection, creativeDna);
  const technicalChecklist = buildTechnicalChecklist(input, totalDurationSeconds);
  const risks = buildRisks(input, Boolean(identity));
  const observations = buildObservations(context, content);
  const nextSteps = buildNextSteps(input);

  return {
    editingTimeline,
    totalDurationSeconds,
    musicTrackPlan,
    musicTrack,
    requiredAssets,
    editingInstructions,
    technicalChecklist,
    risks,
    observations,
    nextSteps,
    creativeDna,
  };
}

export function buildIcaroEditingPrompt(
  input: DiegoEditingRequestInput,
  plan: DiegoEditingCore,
  context: ClaraContextResponse,
): string {
  return [
    "Você é o apoio de IA de Diego, Editor Profissional do Zuno (não apenas montador de timeline) — cada cena já recebeu, de forma determinística, um pacote completo de decisões de edição (tipo e velocidade de corte, ritmo, ponto de respiração, transição, zoom/pan/push-in/pull-out/speed-ramp/whip/fade/blur/glow/mask/motion-blur, animação de texto, entrada/saída de CTA, easing, tempo de animação e sincronismo — ver `editingTimeline[].editingDecision`), além de trilha e efeitos sonoros locais selecionados automaticamente.",
    "Aprimore apenas o plano de trilha, os assets necessários, as instruções de edição e o checklist técnico.",
    "Não crie roteiro nem dirija vídeo (roteiro e direção já foram definidos por Bruno e Vanessa) e não renderize ou publique vídeo, nem crie imagens.",
    "Não redefina a timeline, ordem das cenas, cortes, duração de cada trecho, legendas por cena, textos na tela ou o pacote de decisões de `editingDecision`/`selectedSoundEffects`/`musicTrack` — isso é responsabilidade determinística de Diego.",
    "Retorne apenas JSON válido, sem markdown.",
    "",
    "PADRÃO DE QUALIDADE OBRIGATÓRIO:",
    [
      "- plano de trilha coerente com a direção musical já definida por Vanessa;",
      "- assets necessários completos o suficiente para um editor iniciar o trabalho sem perguntas adicionais;",
      "- checklist técnico específico e verificável, não genérico.",
    ].join("\n"),
    "",
    "RESTRIÇÕES NEGATIVAS:",
    [
      "- não sugerir cores, luz ou composição fora do que Vanessa já definiu;",
      "- não propor instruções de edição incompatíveis com a duração total do roteiro de Bruno.",
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
    "DIREÇÃO AUDIOVISUAL DE VANESSA:",
    JSON.stringify(input.vanessaDirection, null, 2),
    "",
    "PLANO DE EDIÇÃO BASE:",
    JSON.stringify(plan, null, 2),
    "",
    "MÓDULOS DE CONHECIMENTO DISPONÍVEIS NA CLARA:",
    JSON.stringify(Object.keys(context.modules), null, 2),
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify(
      {
        musicTrackPlan: plan.musicTrackPlan,
        requiredAssets: plan.requiredAssets,
        editingInstructions: plan.editingInstructions,
        technicalChecklist: plan.technicalChecklist,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function parseEditingEnhancement(content: string): DiegoEditingEnhancement {
  const parsed = JSON.parse(extractJson(content, "Diego")) as Partial<Record<keyof DiegoEditingEnhancement, unknown>>;
  return {
    musicTrackPlan: typeof parsed.musicTrackPlan === "string" && parsed.musicTrackPlan.trim() ? parsed.musicTrackPlan : undefined,
    requiredAssets: normalizeStringArray(parsed.requiredAssets),
    editingInstructions: normalizeStringArray(parsed.editingInstructions),
    technicalChecklist: normalizeStringArray(parsed.technicalChecklist),
  };
}

export function mergeEditingEnhancement(
  plan: DiegoEditingCore,
  enhancement: DiegoEditingEnhancement,
): DiegoEditingCore {
  return {
    ...plan,
    musicTrackPlan: enhancement.musicTrackPlan ?? plan.musicTrackPlan,
    requiredAssets: enhancement.requiredAssets?.length ? enhancement.requiredAssets : plan.requiredAssets,
    editingInstructions: enhancement.editingInstructions?.length ? enhancement.editingInstructions : plan.editingInstructions,
    technicalChecklist: enhancement.technicalChecklist?.length ? enhancement.technicalChecklist : plan.technicalChecklist,
  };
}

export function buildRafaBriefing(plan: DiegoEditingCore, input: DiegoEditingRequestInput): DiegoRafaBriefing {
  return {
    status: "preliminary",
    editingTimeline: plan.editingTimeline,
    totalDurationSeconds: plan.totalDurationSeconds,
    musicTrackPlan: plan.musicTrackPlan,
    musicTrack: plan.musicTrack,
    requiredAssets: plan.requiredAssets,
    editingInstructions: plan.editingInstructions,
    technicalChecklist: plan.technicalChecklist,
    channel: input.channel,
    notes: [
      "Este briefing cobre exclusivamente o plano técnico de edição (timeline, cortes, legendas, textos na tela, transições, efeitos, trilha, assets, instruções de edição e checklist técnico).",
      "Renderização e publicação do vídeo são responsabilidade das próximas Skills da pipeline de vídeo (Rafa e Ana).",
      `Canal solicitado: ${input.channel}.`,
      `Formato solicitado: ${input.format}.`,
    ],
  };
}

function narrativeRoleFor(sceneName: string): SceneNarrativeRole {
  if (sceneName === "Gancho") return "hook";
  if (sceneName === "CTA final") return "cta";
  return "development";
}

function buildEditingTimeline(scenes: DiegoBrunoScene[], sceneDirections: DiegoVanessaSceneDirection[]): DiegoTimelineEntry[] {
  const directionsByOrder = new Map(sceneDirections.map((direction) => [direction.order, direction]));
  const hasCta = scenes.some((scene) => scene.name === "CTA final");
  let developmentBeatIndex = 0;

  return scenes.map((scene) => {
    const direction = directionsByOrder.get(scene.order);
    const role = narrativeRoleFor(scene.name);
    const beatIndex = role === "development" ? developmentBeatIndex++ : 0;
    const editingDecision = adaptEditingDecisionForNarrativeIntensity(
      enrichEditingDecision(role, scene.rhythm, hasCta, beatIndex),
      scene.narrativeIntensity,
    );
    const publicVisibleText = sanitizePublicVideoText(scene.publicVisibleText ?? scene.onScreenText, role === "cta" ? 52 : 46, 7);
    const publicSubtitle = sanitizePublicVideoText(scene.publicSubtitle, 64, 12);
    const shotTimeline = buildShotTimelineForScene(scene, direction);
    return {
      order: scene.order,
      name: scene.name,
      startSeconds: scene.startSeconds,
      endSeconds: scene.startSeconds + scene.durationSeconds,
      durationSeconds: scene.durationSeconds,
      captionText: publicSubtitle ?? "",
      onScreenText: publicVisibleText,
      publicVisibleText,
      publicSubtitle,
      narrativeIntensity: scene.narrativeIntensity,
      cutType: buildCutType(scene.name, editingDecision.cutType, editingDecision.cutSpeed),
      transitionToNext: direction?.transitionToNext,
      visualEffects: direction?.visualEffects ?? [],
      soundEffectSuggestions: scene.soundEffectSuggestions,
      editingDecision,
      selectedSoundEffects: selectSoundEffectsForScene(role, editingDecision.transition),
      visualAssetRequirement: direction?.visualAssetRequirement,
      visualSceneDesign: direction?.visualSceneDesign,
      shotTimeline,
    };
  });
}

/**
 * AGENCY FILM PIPELINE 2.0 — Diego costura Shots. Para cada Shot que Bruno criou (e que Vanessa
 * dirigiu), gera uma entrada de timeline por Shot com transições de entrada/saída, continuidade
 * e sync com narração. Rafa renderiza consumindo esta lista shot a shot.
 */
function buildShotTimelineForScene(scene: DiegoBrunoScene, direction: DiegoVanessaSceneDirection | undefined): DiegoTimelineEntry["shotTimeline"] {
  const shotDirectionsById = new Map((direction?.shotDirections ?? []).map((shotDirection) => [shotDirection.shotId, shotDirection]));
  return scene.shots.map((shot, index) => {
    const shotDirection = shotDirectionsById.get(shot.id);
    const previousShotEnd = index === 0 ? "início da cena" : "corte imediato do Shot anterior";
    const photographyBrief = shotDirection
      ? `${shotDirection.framing} | ${shotDirection.lighting} | ${shotDirection.cameraMovement}`
      : `${shot.cinematography.shotType} | ${shot.cinematography.lighting} | ${shot.cinematography.cameraMovement}`;
    return {
      shotId: shot.id,
      shotOrder: shot.order,
      sceneOrder: shot.sceneOrder,
      purpose: shot.purpose,
      startSeconds: shot.startSeconds,
      endSeconds: Number.parseFloat((shot.startSeconds + shot.durationSeconds).toFixed(2)),
      durationSeconds: shot.durationSeconds,
      action: shot.action,
      entranceTransition: shot.transitionFromPrevious,
      exitTransition: shot.transitionToNext,
      continuityFromPreviousShot: `${previousShotEnd} — ${shot.continuityFromPrevious}`,
      syncNotes: `Shot ${shot.order}/${scene.shots.length} — a narração desta seção deve começar exatamente no início deste Shot (${shot.startSeconds}s) e nunca continuar enquanto a imagem permanece parada.`,
      photographyBrief,
      // Se Vanessa entregou requirement por Shot, usa-o; senão, usa o de Bruno (com os campos que
      // Diego consegue mapear sem inventar o que Vanessa deveria decidir).
      visualAssetRequirement: shotDirection?.visualAssetRequirement ?? {
        whatShouldAppear: shot.assetRequirement.whatShouldAppear,
        emotion: shot.assetRequirement.emotion,
        imageType: "photo",
        framing: shot.assetRequirement.framing,
        movement: shot.assetRequirement.movement,
        lighting: shot.assetRequirement.lighting,
        narrativeFunction: shot.assetRequirement.narrativeFunction,
        tags: shot.assetRequirement.tags,
        forbiddenTags: shot.assetRequirement.forbiddenTags,
        sequenceRole: shot.assetRequirement.sequenceRole,
        preferredMediaKind: shot.assetRequirement.preferredMediaKind,
      },
    };
  });
}

function adaptEditingDecisionForNarrativeIntensity(
  decision: DiegoEditingSceneDecision,
  intensity: DiegoNarrativeIntensity | undefined,
): DiegoEditingSceneDecision {
  if (!intensity) return decision;
  if (intensity === "impacto") {
    return { ...decision, transition: "cut", textAnimation: "pop", pushIn: true, pan: false, easing: "back_out", animationTimingSeconds: 0.22 };
  }
  if (intensity === "descoberta") {
    return { ...decision, transition: "dissolve", textAnimation: "fade_in", pan: true, pushIn: false, easing: "ease_in_out", animationTimingSeconds: 0.38 };
  }
  if (intensity === "demonstracao") {
    return { ...decision, transition: "slide", textAnimation: "slide_up", pan: false, pushIn: true, mask: true, easing: "ease_out", animationTimingSeconds: 0.32 };
  }
  if (intensity === "beneficio") {
    return { ...decision, transition: "wipe", textAnimation: "slide_up", pan: true, glow: true, easing: "ease_out", animationTimingSeconds: 0.36 };
  }
  if (intensity === "prova") {
    return { ...decision, transition: "fade", textAnimation: "fade_in", pullOut: true, pushIn: false, breathingPoint: true, easing: "ease_in_out", animationTimingSeconds: 0.42 };
  }
  if (intensity === "convite") {
    return { ...decision, transition: "whip", textAnimation: "pop", pan: true, motionBlur: true, easing: "ease_out", animationTimingSeconds: 0.28 };
  }
  return { ...decision, transition: "glow", textAnimation: "typewriter", glow: true, breathingPoint: true, easing: "back_out", animationTimingSeconds: 0.34 };
}

const INTERNAL_VIDEO_TEXT_PATTERNS = [
  /desenvolver\s+a\s+mensagem-chave/i,
  /abertura\s+de\s+impacto/i,
  /conectad[ao]\s+ao\s+ângulo/i,
  /conectad[ao]\s+ao\s+angulo/i,
  /estrat[eé]g/i,
  /observa[cç][aã]o/i,
  /dire[cç][aã]o/i,
  /technical/i,
  /justificativa/i,
  /narrativePurpose/i,
  /internalDescription/i,
];

function sanitizePublicVideoText(text: string | undefined, maxLength: number, maxWords: number): string | undefined {
  const trimmed = text?.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  if (INTERNAL_VIDEO_TEXT_PATTERNS.some((pattern) => pattern.test(trimmed))) return undefined;
  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordLimited = words.slice(0, maxWords).join(" ");
  if (wordLimited.length <= maxLength && words.length <= maxWords) return wordLimited;
  let result = "";
  for (const word of words.slice(0, maxWords)) {
    const candidate = result ? `${result} ${word}` : word;
    if (candidate.length > maxLength - 1) break;
    result = candidate;
  }
  return result ? `${result}…` : trimmed.slice(0, maxLength - 1).trim() + "…";
}

function buildCutType(sceneName: string, cutType: string, cutSpeed: string): string {
  if (sceneName === "Gancho") {
    return `Corte seco de entrada (0 frames), sem fade — a cena precisa começar com impacto imediato. (${cutType}, ${cutSpeed})`;
  }
  if (sceneName === "CTA final") {
    return `Corte seco final, sem fade de saída — encerramento abrupto para reforçar a urgência do CTA. (${cutType}, ${cutSpeed})`;
  }
  return `Corte dinâmico sincronizado com a batida da narração, com fade curto de 2 a 3 quadros entre cenas. (${cutType}, ${cutSpeed})`;
}

function buildMusicTrackPlan(
  vanessaDirection: DiegoVanessaDirectionSummary,
  musicTrack: ReturnType<typeof selectMusicTrack>,
  totalDurationSeconds: number,
): string {
  return `${vanessaDirection.musicDirection} Trilha selecionada automaticamente da biblioteca local: "${musicTrack.name}" (categoria ${musicTrack.category}) — ${musicTrack.description} Iniciar a trilha no timecode 0:00 com fade-in de 1 segundo; manter em plano de fundo durante toda a narração; aplicar fade-out final nos últimos 2 segundos do vídeo (encerrando por volta de ${totalDurationSeconds}s); volume normalizado e com ducking automático sob cada efeito sonoro pontual.`;
}

function buildRequiredAssets(input: DiegoEditingRequestInput, identity?: ClaraKnowledgeRecord<"IdentityContext">): string[] {
  const assets = [
    "Arquivo de trilha sonora definida no plano de trilha, em formato compatível com o editor.",
    "Assets visuais por cena resolvidos automaticamente pelo Asset Resolver (biblioteca local, provedor gratuito configurado ou Developer Assisted Mode), nunca placeholders.",
    "Arquivo de fonte para legendas e textos na tela, conforme o estilo de legenda definido pela Vanessa.",
    "Efeitos sonoros listados por cena, em arquivos separados e sincronizáveis.",
  ];
  if (identity?.payload.colors?.length) {
    assets.push(`Logo e elementos gráficos da marca nas cores registradas na Clara (${identity.payload.colors.join(", ")}) para o destaque visual do CTA final.`);
  } else {
    assets.push("Logo e elementos gráficos da marca para o destaque visual do CTA final, a confirmar assim que a identidade visual for cadastrada na Clara.");
  }
  assets.push(`LUT ou preset de color grading compatível com a direção de cor definida para o canal ${input.channel}.`);
  return assets;
}

function buildEditingInstructions(vanessaDirection: DiegoVanessaDirectionSummary, creativeDna: CampaignCreativeDNA): string[] {
  return [
    "Editar em proporção vertical 9:16 (1080x1920), com taxa de quadros mínima de 30fps.",
    `Aplicar o estilo de legenda definido pela Vanessa ("${vanessaDirection.captionStyle}") em todas as cenas com legenda.`,
    "Sincronizar cada corte exatamente no timecode de início da cena seguinte, sem sobreposição ou lacuna.",
    `Aplicar color grading consistente com a direção de cor da Vanessa ("${vanessaDirection.colorDirection}") em todas as cenas.`,
    // Creative Director Engine: o ritmo narrativo da campanha (não só o ritmo derivado de cada
    // cena isolada) precisa guiar a sensação geral de montagem.
    `Respeitar o ritmo narrativo da campanha (Creative DNA): ${creativeDna.narrativePace}`,
  ];
}

function buildTechnicalChecklist(input: DiegoEditingRequestInput, totalDurationSeconds: number): string[] {
  return [
    `Confirmar que a soma das durações das cenas bate exatamente com a duração total do roteiro (${totalDurationSeconds}s).`,
    "Confirmar que todas as legendas estão sincronizadas com a fala, cena a cena.",
    "Confirmar que os efeitos sonoros não competem em volume com a narração e a trilha.",
    `Confirmar resolução, proporção e taxa de quadros corretas para o canal ${input.channel}.`,
    "Confirmar que o vídeo final não ultrapassa a duração máxima recomendada para o formato solicitado.",
  ];
}

function buildRisks(input: DiegoEditingRequestInput, hasIdentity: boolean): string[] {
  const risks: string[] = [];
  if (!hasIdentity) risks.push("Nenhuma identidade visual registrada na Clara; risco de inconsistência nos assets de marca do plano de edição.");
  risks.push(`Validar se o plano de edição é compatível com as práticas recomendadas do canal ${input.channel} antes da renderização.`);
  risks.push("Plano de edição depende de revisão humana antes da renderização final, pois Diego não valida o resultado renderizado.");
  return risks;
}

function buildObservations(context: ClaraContextResponse, content?: ClaraKnowledgeRecord<"ContentContext">): string[] {
  const observations: string[] = [];
  if (!context.modules.AudienceContext?.length) observations.push("Nenhum público detalhado na Clara; considerar enriquecer o conhecimento do cliente.");
  if (content?.payload.publicationHistory?.length) {
    observations.push(`Histórico de publicações disponível (${content.payload.publicationHistory.length} publicações) para referência de ritmo de edição.`);
  } else {
    observations.push("Nenhum histórico de publicações encontrado na Clara para referência de ritmo de edição.");
  }
  return observations;
}

function buildNextSteps(input: DiegoEditingRequestInput): string[] {
  return [
    "Encaminhar o plano de edição estruturado para a futura Rafa renderizar o vídeo final.",
    "Validar o plano de edição com o time de marca antes da renderização.",
    `Reavaliar o plano de edição caso o canal ${input.channel} ou o objetivo do vídeo mudem.`,
  ];
}

export function createDiegoVideoEditingSkill(
  dependencies: Partial<DiegoVideoEditingSkillDependencies> = {},
): DiegoVideoEditingSkill {
  return new DiegoVideoEditingSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    icaro: dependencies.icaro,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
  });
}
