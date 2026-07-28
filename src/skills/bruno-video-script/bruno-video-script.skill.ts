import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse, ClaraKnowledgeRecord } from "../../application/knowledge/clara.types.js";
import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, latest, normalize, normalizeStringArray } from "../../shared/utils/skill-parsing.js";
import { buildDeveloperAiPendingResponse, isDeveloperAssistancePending } from "../../shared/utils/developer-ai-assistance.js";
import type { DeveloperAssistancePendingOutput } from "../../application/ai/developer-assistance.types.js";
import { brunoVideoScriptManifest } from "./bruno.manifest.js";
import type { BrunoLogAction, BrunoLoggerPort } from "./bruno-log.contract.js";
import { deriveCampaignCreativeDNA, type CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import {
  MIN_SHOTS_PER_SCENE,
  planShotsForScene,
  type SceneNarrativeRole,
} from "../../shared/utils/cinematic-reference-library.js";
import type {
  BrunoJoaoStrategySummary,
  BrunoSceneFunction,
  BrunoSceneRhythm,
  BrunoScriptEnhancement,
  BrunoScriptRequestInput,
  BrunoVanessaBriefing,
  BrunoVideoScene,
  BrunoVideoScriptCore,
  BrunoVideoScriptOutput,
} from "./bruno-video-script.types.js";

export type BrunoIdGenerator = {
  create(prefix: string): string;
};

export type BrunoVideoScriptSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  icaro?: IcaroBrainPort;
  logger?: BrunoLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: BrunoIdGenerator;
  now?: () => Date;
};

class SequentialBrunoIdGenerator implements BrunoIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopBrunoLogger implements BrunoLoggerPort {
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
      throw new Error(`${portName} não configurado para Bruno.`);
    },
  });
}

/** Une a saída normal de Bruno à pausa aguardando IA desenvolvedora, mesmo padrão de `PedroSkillOutput`. */
export type BrunoSkillOutput = BrunoVideoScriptOutput | DeveloperAssistancePendingOutput;

export class BrunoVideoScriptSkill implements Skill<BrunoScriptRequestInput, BrunoSkillOutput> {
  readonly manifest = brunoVideoScriptManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly icaro?: IcaroBrainPort;
  private readonly logger: BrunoLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: BrunoIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: BrunoVideoScriptSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.icaro = dependencies.icaro;
    this.logger = dependencies.logger ?? new NoopBrunoLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialBrunoIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<BrunoScriptRequestInput>): Promise<SkillResponse<BrunoSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de roteiro de vídeo inválida.", request, { errors: validationErrors });
      await this.emit("VideoScriptFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
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
      return await this.runScript(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante a roteirização de vídeo.";
      await this.log("Error", `Erro inesperado em Bruno. ${message}`, request, { error: message });
      await this.emit("VideoScriptFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runScript(request: SkillRequest<BrunoScriptRequestInput>): Promise<SkillResponse<BrunoSkillOutput>> {
    await this.log("RequestReceived", "Solicitação de roteiro de vídeo recebida por Bruno.", request, {
      channel: request.input.channel,
      format: request.input.format,
      videoObjective: request.input.videoObjective,
    });
    await this.emit("VideoScriptStarted", request, {
      channel: request.input.channel,
      videoObjective: request.input.videoObjective,
    });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("VideoScriptFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
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
      requester: { id: this.manifest.id, type: "specialist", name: "Bruno" },
      clientId: tenant.clientId,
      modules: ["BrandContext", "AudienceContext", "ContentContext", "PublishingContext"],
      reason: "Construção de roteiro de vídeo curto a partir da estratégia de marketing do João.",
    });

    await this.log("ContextConsulted", `Contexto consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });
    await this.emit("VideoScriptContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    const completeness = evaluateContextCompleteness(claraContext);
    if (!completeness.sufficient) {
      await this.log("ContextIncomplete", "Contexto insuficiente na Clara para construir o roteiro com segurança.", request, {
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      await this.emit("VideoScriptFailed", request, {
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

    await this.log("ScriptStarted", "Construção do roteiro de vídeo iniciada.", request, { clientId: tenant.clientId });

    let script = buildBaselineScript(request.input, claraContext);
    const totalShots = script.scenes.reduce((total, scene) => total + scene.shots.length, 0);
    await this.log(
      "ShotPlanningCompleted",
      `Shot planning concluído: ${script.scenes.length} cena(s), ${totalShots} Shot(s) — nenhuma cena com menos de 2 planos.`,
      request,
      { clientId: tenant.clientId, sceneCount: script.scenes.length, totalShots },
    );
    let aiSupportUsed = false;
    let aiProviderId: string | undefined;

    if (this.icaro) {
      await this.log("AISupportRequested", "Apoio de IA solicitado ao Ícaro para aprimorar o roteiro.", request, { clientId: tenant.clientId });
      await this.emit("AIGenerationStarted", request, { clientId: tenant.clientId, channel: request.input.channel });

      try {
        const prompt = buildIcaroScriptPrompt(request.input, script, claraContext);
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
            "Não gerar, editar, renderizar ou publicar vídeo; apenas aprimorar texto do roteiro.",
            "Não redefinir cenas, tempo por cena, B-roll, enquadramentos, movimentos de câmera, pausas, transições ou efeitos sonoros — isso é responsabilidade determinística de Bruno.",
            "Aprimorar apenas estrutura narrativa, gancho inicial, ritmo geral, sugestões de trilha e CTA final.",
          ],
          expectedOutput: "json",
          priority: "quality",
          temperature: 0.6,
          maxTokens: 1200,
        });

        if (aiResponse.status !== "completed") {
          throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para Bruno.");
        }

        const enhancement = parseScriptEnhancement(String(aiResponse.content ?? ""));
        script = mergeScriptEnhancement(script, enhancement);
        aiSupportUsed = true;
        aiProviderId = aiResponse.provider.id;

        await this.log("AISupportApplied", "Apoio de IA aplicado ao roteiro.", request, { clientId: tenant.clientId });
        await this.emit("AIGenerationFinished", request, {
          clientId: tenant.clientId,
          provider: aiResponse.provider,
          model: aiResponse.model,
        });
      } catch (error) {
        if (isDeveloperAssistancePending(error)) {
          return buildDeveloperAiPendingResponse(this.manifest.id, request.context.taskId, error);
        }
        const message = error instanceof Error ? error.message : "Erro desconhecido no apoio de IA solicitado por Bruno.";
        await this.log("AISupportFailed", `Apoio de IA falhou; roteiro segue apenas com heurística e contexto da Clara. ${message}`, request, {
          clientId: tenant.clientId,
          error: message,
        });
      }
    } else {
      await this.log("AISupportSkipped", "Ícaro não foi configurado; roteiro segue apenas com heurística e contexto da Clara.", request, {
        clientId: tenant.clientId,
      });
    }

    await this.log("ScriptFinalized", "Roteiro de vídeo finalizado.", request, { clientId: tenant.clientId, hook: script.hook });
    await this.emit("VideoScriptGenerated", request, { clientId: tenant.clientId, aiSupportUsed });

    const vanessaBriefing = buildVanessaBriefing(script, request.input);

    await this.log("VanessaBriefingCreated", "Briefing de roteiro para Vanessa criado.", request, {
      clientId: tenant.clientId,
      channel: vanessaBriefing.channel,
    });
    await this.emit("VanessaBriefingCreated", request, { clientId: tenant.clientId, channel: vanessaBriefing.channel });

    const output: BrunoVideoScriptOutput = {
      ...script,
      vanessaBriefing,
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
          name: "Roteiro de vídeo estruturado de Bruno",
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

  private async resolveClient(input: BrunoScriptRequestInput): Promise<TenantClientContext> {
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
    action: BrunoLogAction,
    message: string,
    request: SkillRequest<BrunoScriptRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("bruno-log"),
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

  private async emit(name: ZunoEventName, request: SkillRequest<BrunoScriptRequestInput>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "bruno",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: BrunoScriptRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de roteiro de vídeo é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!input.channel?.trim()) errors.push("channel é obrigatório.");
  if (!input.format?.trim()) errors.push("format é obrigatório.");
  if (!input.videoObjective?.trim()) errors.push("videoObjective é obrigatório.");
  if (!input.joaoStrategy || typeof input.joaoStrategy !== "object" || !input.joaoStrategy.angle?.trim()) {
    errors.push("joaoStrategy é obrigatório e precisa conter ao menos angle.");
  }
  if (input.desiredDurationSeconds !== undefined && (!Number.isFinite(input.desiredDurationSeconds) || input.desiredDurationSeconds <= 0)) {
    errors.push("desiredDurationSeconds, quando informado, precisa ser um número positivo.");
  }
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

export function buildBaselineScript(input: BrunoScriptRequestInput, context: ClaraContextResponse): BrunoVideoScriptCore {
  const brand = latest(context.modules.BrandContext);
  const content = latest(context.modules.ContentContext);

  const totalDurationSeconds = resolveTotalDuration(input);
  const narrativeStructure = buildNarrativeStructure(input.joaoStrategy);
  // Creative Director Engine: mesma função pura que Eduardo/João já chamaram, com os mesmos
  // campos de estratégia — chega ao mesmo Creative DNA por construção, sem nenhum dado novo
  // precisar fluir entre Skills.
  const creativeDna = deriveCampaignCreativeDNA({
    originalRequest: input.originalRequest,
    centralPromise: input.joaoStrategy.centralPromise,
    valueProposition: input.joaoStrategy.valueProposition,
    toneOfVoice: input.joaoStrategy.toneOfVoice,
    targetAudience: input.joaoStrategy.targetAudience,
    keyMessages: input.joaoStrategy.keyMessages,
  });
  const hook = buildHook(input.joaoStrategy, creativeDna);
  const scenesWithoutShots = buildScenes(input, totalDurationSeconds);
  const scenes = planShotsForScenes(scenesWithoutShots);
  const overallRhythm = buildOverallRhythm(input.joaoStrategy);
  const musicSuggestions = buildMusicSuggestions(input.joaoStrategy);
  const finalCta = input.joaoStrategy.recommendedCta;
  const recordingNotes = buildRecordingNotes(input, creativeDna);
  const editingNotes = buildEditingNotes();
  const risks = buildRisks(input, Boolean(brand));
  const observations = buildObservations(context, content);
  const nextSteps = buildNextSteps(input);

  return {
    narrativeStructure,
    hook,
    totalDurationSeconds,
    scenes,
    overallRhythm,
    musicSuggestions,
    finalCta,
    recordingNotes,
    editingNotes,
    risks,
    observations,
    nextSteps,
    creativeDna,
  };
}

export function buildIcaroScriptPrompt(
  input: BrunoScriptRequestInput,
  script: BrunoVideoScriptCore,
  context: ClaraContextResponse,
): string {
  return [
    "Você é o apoio de IA de Bruno, Especialista em Estratégia e Roteirização de Vídeos Curtos do Zuno.",
    "Aprimore apenas estrutura narrativa, gancho inicial, ritmo geral, sugestões de trilha e CTA final.",
    "Não gere, edite, renderize ou publique vídeo, e não crie imagens.",
    "Não redefina cenas, tempo por cena, texto falado/na tela por cena, B-roll, enquadramentos, movimentos de câmera, pausas, transições ou efeitos sonoros — isso é responsabilidade determinística de Bruno.",
    "Retorne apenas JSON válido, sem markdown.",
    "",
    "PADRÃO DE QUALIDADE OBRIGATÓRIO:",
    [
      "- gancho específico e memorável, capaz de prender atenção nos primeiros 3 segundos;",
      "- estrutura narrativa coerente com o ângulo estratégico e o tom de voz da marca;",
      "- CTA final claro, direto e coerente com o objetivo do vídeo.",
    ].join("\n"),
    "",
    "RESTRIÇÕES NEGATIVAS:",
    [
      "- não sugerir trilha ou tom fora do que o tom de voz da marca já define;",
      "- não propor estrutura narrativa incompatível com o canal ou formato solicitado.",
    ].join("\n"),
    "",
    "SOLICITAÇÃO ORIGINAL:",
    input.originalRequest,
    "",
    "ESTRATÉGIA DO JOÃO:",
    JSON.stringify(input.joaoStrategy, null, 2),
    "",
    "ROTEIRO BASE:",
    JSON.stringify(script, null, 2),
    "",
    "MÓDULOS DE CONHECIMENTO DISPONÍVEIS NA CLARA:",
    JSON.stringify(Object.keys(context.modules), null, 2),
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify(
      {
        narrativeStructure: script.narrativeStructure,
        hook: script.hook,
        overallRhythm: script.overallRhythm,
        musicSuggestions: script.musicSuggestions,
        finalCta: script.finalCta,
      },
      null,
      2,
    ),
  ].join("\n");
}

export function parseScriptEnhancement(content: string): BrunoScriptEnhancement {
  const parsed = JSON.parse(extractJson(content, "Bruno")) as Partial<Record<keyof BrunoScriptEnhancement, unknown>>;
  return {
    narrativeStructure: typeof parsed.narrativeStructure === "string" && parsed.narrativeStructure.trim() ? parsed.narrativeStructure : undefined,
    hook: typeof parsed.hook === "string" && parsed.hook.trim() ? parsed.hook : undefined,
    overallRhythm: typeof parsed.overallRhythm === "string" && parsed.overallRhythm.trim() ? parsed.overallRhythm : undefined,
    musicSuggestions: normalizeStringArray(parsed.musicSuggestions),
    finalCta: typeof parsed.finalCta === "string" && parsed.finalCta.trim() ? parsed.finalCta : undefined,
  };
}

export function mergeScriptEnhancement(
  script: BrunoVideoScriptCore,
  enhancement: BrunoScriptEnhancement,
): BrunoVideoScriptCore {
  const finalCta = enhancement.finalCta ?? script.finalCta;
  // `buildScenes()` já baqueou a cena de CTA final com o `recommendedCta` original de João, ANTES
  // do apoio de Ícaro rodar. Se o apoio de IA sobrescrever `finalCta` aqui, a cena de CTA precisa
  // ser sincronizada de volta — sem isso, `scenes` e `finalCta` divergiam silenciosamente (Vanessa,
  // Diego, Rafa e Lucas todos leem `finalCta` do topo, mas a cena renderizada usava o valor antigo).
  const scenes = finalCta === script.finalCta
    ? script.scenes
    : script.scenes.map((scene) =>
        scene.name === "CTA final"
          ? { ...scene, spokenText: `${finalCta}.`, publicVisibleText: conciseHeadline(finalCta), onScreenText: conciseHeadline(finalCta) }
          : scene,
      );
  return {
    ...script,
    narrativeStructure: enhancement.narrativeStructure ?? script.narrativeStructure,
    hook: enhancement.hook ?? script.hook,
    overallRhythm: enhancement.overallRhythm ?? script.overallRhythm,
    musicSuggestions: enhancement.musicSuggestions?.length ? enhancement.musicSuggestions : script.musicSuggestions,
    finalCta,
    scenes,
  };
}

export function buildVanessaBriefing(script: BrunoVideoScriptCore, input: BrunoScriptRequestInput): BrunoVanessaBriefing {
  return {
    status: "preliminary",
    narrativeStructure: script.narrativeStructure,
    hook: script.hook,
    totalDurationSeconds: script.totalDurationSeconds,
    scenes: script.scenes,
    overallRhythm: script.overallRhythm,
    musicSuggestions: script.musicSuggestions,
    finalCta: script.finalCta,
    recordingNotes: script.recordingNotes,
    editingNotes: script.editingNotes,
    channel: input.channel,
    notes: [
      "Este briefing cobre exclusivamente roteiro (estrutura narrativa, cenas, texto falado, texto na tela, B-roll, enquadramento, movimento de câmera, ritmo, pausas, transições, efeitos sonoros, trilha e CTA final).",
      "Produção, filmagem, edição, renderização e publicação do vídeo são responsabilidade das próximas Skills da pipeline de vídeo (Vanessa, Diego, Rafa), ainda não implementadas.",
      `Canal solicitado: ${input.channel}.`,
      `Formato solicitado: ${input.format}.`,
    ],
  };
}

function resolveTotalDuration(input: BrunoScriptRequestInput): number {
  if (input.desiredDurationSeconds && input.desiredDurationSeconds > 0) return Math.round(input.desiredDurationSeconds);
  return 30;
}

function buildNarrativeStructure(strategy: BrunoJoaoStrategySummary): string {
  const normalizedAngle = normalize(strategy.angle);
  if (containsAny(normalizedAngle, ["conversao", "beneficio", "direto"])) {
    return "Problema → Solução → Prova → CTA: abre expondo uma dor ou necessidade, apresenta a solução, reforça com prova ou benefício concreto e fecha com chamada direta para ação.";
  }
  if (containsAny(normalizedAngle, ["educativo", "clareza", "autoridade"])) {
    return "Pergunta → Explicação → Exemplo → CTA: abre com uma pergunta ou afirmação que gera curiosidade, explica o conceito com clareza, ilustra com um exemplo prático e fecha convidando para o próximo passo.";
  }
  if (containsAny(normalizedAngle, ["identificacao", "proxima", "comunidade"])) {
    return "Identificação → Conexão → Convite: abre com uma situação reconhecível pelo público, aprofunda a conexão emocional e fecha convidando o espectador a fazer parte.";
  }
  if (containsAny(normalizedAngle, ["novidade", "lancamento", "expectativa"])) {
    return "Revelação → Detalhes → Expectativa → CTA: abre revelando a novidade, detalha o que muda na prática, constrói expectativa e fecha com chamada para ação.";
  }
  return "Gancho → Desenvolvimento → CTA: estrutura padrão de vídeo curto, com abertura de impacto, desenvolvimento das mensagens-chave e fechamento com chamada para ação.";
}

function buildHook(strategy: BrunoJoaoStrategySummary, creativeDna: CampaignCreativeDNA): string {
  return `Capturar atenção nos primeiros 3 segundos com "${strategy.centralPromise}", conectado ao ângulo "${strategy.angle}". Gancho emocional do Creative DNA: ${creativeDna.emotionalHook}`;
}

/**
 * Deriva o papel narrativo do Shot Planner a partir da função de comercial da cena. Bruno
 * escreve com `sceneFunction` (hook/build/payoff/release/cta), mas o planner de Shots pensa em
 * `SceneNarrativeRole` (hook/development/cta) — o mapa aqui é 1:1 sem perda de informação, e o
 * beatIndex (0=build, 1=payoff, 2=release) é o mesmo já usado por Vanessa/Diego para variar
 * decisão cinematográfica.
 */
function shotPlannerRoleFor(sceneFunction: BrunoSceneFunction | undefined): { role: SceneNarrativeRole; beatIndex: number } {
  if (sceneFunction === "hook") return { role: "hook", beatIndex: 0 };
  if (sceneFunction === "cta") return { role: "cta", beatIndex: 0 };
  if (sceneFunction === "build") return { role: "development", beatIndex: 0 };
  if (sceneFunction === "payoff") return { role: "development", beatIndex: 1 };
  if (sceneFunction === "release") return { role: "development", beatIndex: 2 };
  return { role: "development", beatIndex: 0 };
}

/**
 * Preenche `shots` para cada cena chamando o planner determinístico da shared library. Nenhuma
 * cena sai daqui com menos de `MIN_SHOTS_PER_SCENE` Shots — se por qualquer motivo o planner
 * devolvesse menos, este helper lança erro imediatamente para que Bruno falhe com
 * `INVALID_SHOT_PLAN` em vez de deixar passar uma cena com um único plano (o que a sprint AGENCY
 * FILM PIPELINE 2.0 proíbe).
 */
function planShotsForScenes(drafts: BrunoSceneDraft[]): BrunoVideoScene[] {
  return drafts.map((draft) => {
    const { role, beatIndex } = shotPlannerRoleFor(draft.sceneFunction);
    const plan = planShotsForScene({
      sceneOrder: draft.order,
      sceneName: draft.name,
      sceneRole: role,
      sceneRhythm: draft.rhythm,
      sceneStartSeconds: draft.startSeconds,
      sceneDurationSeconds: draft.durationSeconds,
      sceneAction: draft.spokenText,
      beatIndex,
      featureFocus: draft.featureFocus,
    });
    if (plan.shots.length < MIN_SHOTS_PER_SCENE) {
      throw new Error(
        `INVALID_SHOT_PLAN: cena ${draft.order} (${draft.name}) recebeu ${plan.shots.length} Shots do planner; mínimo aceito é ${MIN_SHOTS_PER_SCENE}.`,
      );
    }
    return { ...draft, shots: plan.shots };
  });
}

/**
 * Tipo interno usado por `buildScenes` / `buildSiteOfficialScenes` — a cena narrativa antes de
 * receber seus Shots. `planShotsForScenes()` transforma cada `BrunoSceneDraft` em `BrunoVideoScene`
 * completa preenchendo `shots`. Isso mantém a lógica de composição narrativa (função de
 * comércial, ritmo, texto, duração) separada da lógica de shot planning (câmera, motion, asset).
 */
type BrunoSceneDraft = Omit<BrunoVideoScene, "shots">;

function buildScenes(input: BrunoScriptRequestInput, totalDurationSeconds: number): BrunoSceneDraft[] {
  const strategy = input.joaoStrategy;
  const siteOfficialScenes = buildSiteOfficialScenes(input, totalDurationSeconds);
  if (siteOfficialScenes.length > 0) return siteOfficialScenes;

  const developmentMessages = (strategy.keyMessages.length ? strategy.keyMessages : [strategy.centralPromise]).slice(0, 3);
  const developmentFunctions = developmentFunctionsFor(developmentMessages.length);
  const rawDurations = distributeDurationsByFunction(totalDurationSeconds, ["hook", ...developmentFunctions, "cta"]);

  const scenes: BrunoSceneDraft[] = [];
  let cursor = 0;

  const hookBeat = narrativeBeatFor("hook", 0);
  scenes.push({
    order: 1,
    name: "Gancho",
    startSeconds: cursor,
    durationSeconds: rawDurations[0],
    spokenText: publicVoiceover(strategy.centralPromise),
    publicVisibleText: conciseHeadline(strategy.centralPromise),
    publicSubtitle: conciseSubtitle(strategy.valueProposition),
    narrativePurpose: "Gancho público: apresentar a promessa central sem revelar notas estratégicas.",
    featureFocus: "promessa central",
    sceneFunction: "hook",
    internalNotes: [`Ângulo estratégico preservado internamente: ${strategy.angle}`],
    emotionalGoal: hookBeat.emotionalGoal,
    tension: hookBeat.tension,
    reward: hookBeat.reward,
    expectation: hookBeat.expectation,
    payoff: hookBeat.payoff,
    onScreenText: conciseHeadline(strategy.centralPromise),
    brollSuggestions: [`Plano de abertura de forte impacto visual relacionado à promessa central: ${strategy.centralPromise}.`],
    framing: "Close-up no rosto, direto para a câmera",
    cameraMovement: "Estático ou leve handheld para transmitir proximidade",
    rhythm: "acelerado",
    pauseNotes: "Sem pausas — os primeiros segundos precisam prender a atenção imediatamente.",
    transitionToNext: "Corte seco para a cena seguinte",
    soundEffectSuggestions: ["Efeito de impacto sonoro (whoosh ou batida) para reforçar o gancho."],
  });
  cursor += rawDurations[0];

  developmentMessages.forEach((message, index) => {
    const duration = rawDurations[index + 1];
    const isLastDevelopmentScene = index === developmentMessages.length - 1;
    const beat = narrativeBeatFor("development", index);
    scenes.push({
      order: scenes.length + 1,
      name: `Desenvolvimento ${index + 1}`,
      startSeconds: cursor,
      durationSeconds: duration,
      spokenText: publicVoiceover(message),
      publicVisibleText: conciseHeadline(message),
      publicSubtitle: conciseSubtitle(message),
      narrativePurpose: "Prova pública do benefício central, sem transformar funcionalidade secundária no tema do vídeo.",
      featureFocus: inferFeatureFocus(message),
      sceneFunction: developmentFunctions[index],
      internalNotes: [`Mensagem estratégica original: ${message}`],
      emotionalGoal: beat.emotionalGoal,
      tension: beat.tension,
      reward: beat.reward,
      expectation: beat.expectation,
      payoff: beat.payoff,
      onScreenText: conciseHeadline(message),
      brollSuggestions: [`Imagens de apoio que ilustrem: ${message}`],
      framing: "Plano médio, ambiente relacionado ao produto ou serviço",
      cameraMovement: "Movimento suave (pan ou leve zoom) para manter dinamismo sem distrair",
      // Alterna moderado/dinâmico por beat (não mais fixo em "moderado" para todas as cenas de
      // desenvolvimento): sem essa alternância, Vanessa e Diego recebiam o mesmo `rhythm` em toda
      // cena de desenvolvimento e (antes da rotação de beat na biblioteca cinematográfica
      // compartilhada) produziam decisões de câmera/edição idênticas — ver
      // `docs/video-pipeline-agency-premium-report.md`.
      rhythm: beat.rhythm,
      pauseNotes: isLastDevelopmentScene ? "Pausa breve de meio segundo antes da virada para o CTA final." : undefined,
      transitionToNext: "Corte dinâmico acompanhando o ritmo da narração",
      soundEffectSuggestions: [],
    });
    cursor += duration;
  });

  const ctaDuration = rawDurations[rawDurations.length - 1];
  const ctaBeat = narrativeBeatFor("cta", 0);
  scenes.push({
    order: scenes.length + 1,
    name: "CTA final",
    startSeconds: cursor,
    durationSeconds: ctaDuration,
    spokenText: `${strategy.recommendedCta}.`,
    publicVisibleText: conciseHeadline(strategy.recommendedCta),
    publicSubtitle: "rumoaoaltar.com.br",
    narrativePurpose: "Converter a atenção em visita ao site, com end card profissional.",
    featureFocus: "cta",
    sceneFunction: "cta",
    internalNotes: ["End card deve usar logo oficial sem deformação e, quando disponível, mockup/screenshot real do site."],
    emotionalGoal: ctaBeat.emotionalGoal,
    tension: ctaBeat.tension,
    reward: ctaBeat.reward,
    expectation: ctaBeat.expectation,
    payoff: ctaBeat.payoff,
    onScreenText: conciseHeadline(strategy.recommendedCta),
    brollSuggestions: ["End card profissional com logo oficial, URL rumoaoaltar.com.br e mockup real do site em destaque."],
    framing: "Close-up, direto para a câmera",
    cameraMovement: "Estático",
    rhythm: "moderado",
    soundEffectSuggestions: ["Música sobe de volume para reforçar o CTA final."],
  });

  return scenes;
}

/**
 * Peso relativo de duração por função de comercial — a duração nasce da narrativa, nunca da
 * quantidade de cenas (COMMERCIAL ENGINE v1). O gancho é deliberadamente curto (urgência); o
 * payoff é a cena mais generosa (é onde a prova precisa respirar); o release é um respiro breve
 * antes do CTA. Antes desta evolução todo o bloco de desenvolvimento dividia o tempo restante em
 * fatias iguais, o que produzia cenas com duração idêntica mesmo variando cinematografia/edição.
 */
const WEIGHT_BY_FUNCTION: Record<BrunoSceneFunction, number> = {
  hook: 0.12,
  build: 0.22,
  payoff: 0.30,
  release: 0.16,
  cta: 0.20,
};

/** As 3 funções do bloco de desenvolvimento, na ordem, repetindo apenas quando `count` excede 3 (nunca duas adjacentes iguais). */
function developmentFunctionsFor(count: number): BrunoSceneFunction[] {
  const order: BrunoSceneFunction[] = ["build", "payoff", "release"];
  return Array.from({ length: count }, (_, index) => order[index % order.length]);
}

/** Distribui a duração total proporcionalmente ao peso de cada função (nunca em fatias iguais), com piso de 3s por cena e a última cena absorvendo o arredondamento. */
function distributeDurationsByFunction(totalDurationSeconds: number, functions: BrunoSceneFunction[]): number[] {
  const weights = functions.map((sceneFunction) => WEIGHT_BY_FUNCTION[sceneFunction]);
  const weightSum = weights.reduce((total, weight) => total + weight, 0);
  const rawDurations = weights.map((weight) => Math.max(3, Math.round((weight / weightSum) * totalDurationSeconds)));
  const sumWithoutLast = rawDurations.slice(0, -1).reduce((total, value) => total + value, 0);
  rawDurations[rawDurations.length - 1] = Math.max(3, totalDurationSeconds - sumWithoutLast);
  return rawDurations;
}

type NarrativeBeatRole = "hook" | "development" | "cta";
type NarrativeBeat = {
  emotionalGoal: string;
  tension: string;
  reward: string;
  expectation: string;
  payoff: string;
  rhythm: BrunoSceneRhythm;
};

/**
 * Cada cena de um roteiro de comercial existe por um motivo — "por que essa cena existe?"
 * (objetivo emocional, tensão, recompensa, expectativa, payoff), nunca só para transmitir uma
 * informação. `beatIndex` (0-based, só relevante para `role: "development"`) alterna entre 3
 * variantes de beat narrativo para que cenas de desenvolvimento consecutivas não tenham o mesmo
 * propósito — e alterna também `rhythm` (moderado/dinâmico), que é o campo que a Vanessa e o Diego
 * usam para variar câmera/edição cena a cena (ver `cinematic-reference-library.ts`).
 */
function narrativeBeatFor(role: NarrativeBeatRole, beatIndex: number): NarrativeBeat {
  if (role === "hook") {
    return {
      emotionalGoal: "Gerar reconhecimento imediato e curiosidade — a promessa central precisa soar familiar em menos de 1 segundo.",
      tension: "A dor/desconforto que a promessa resolve ainda não foi mostrada — só sugerida.",
      reward: "Nenhuma ainda — o gancho existe para gerar desejo de saber mais, não para entregar.",
      expectation: "O espectador passa a esperar descobrir como essa promessa se cumpre na prática.",
      payoff: "N/A nesta cena — o payoff do gancho é justamente não entregar tudo de uma vez.",
      rhythm: "acelerado",
    };
  }

  if (role === "cta") {
    return {
      emotionalGoal: "Converter toda a tensão e expectativa acumuladas em uma ação simples e clara.",
      tension: "A última hesitação antes de agir — 'será que vale a pena parar pra fazer isso agora?'.",
      reward: "Resolução: saber exatamente o que fazer a seguir, sem ambiguidade.",
      expectation: "Um convite direto, sem mais nenhuma informação nova a processar.",
      payoff: "Ação concreta — visitar o site — encerrando o ciclo aberto pelo gancho.",
      rhythm: "moderado",
    };
  }

  const beats: NarrativeBeat[] = [
    {
      emotionalGoal: "Mostrar a virada: a tensão do gancho começa a se resolver com uma prova concreta.",
      tension: "Ainda existe dúvida se a promessa é real ou só uma alegação de marketing.",
      reward: "Uma prova específica e tangível, não uma afirmação vaga.",
      expectation: "Antecipar como essa solução funciona na prática, no dia a dia.",
      payoff: "A mensagem-chave desta cena entrega a primeira prova concreta da promessa.",
      rhythm: "moderado",
    },
    {
      emotionalGoal: "Ampliar a confiança mostrando o contexto humano ao redor da solução.",
      tension: "Será que isso funciona pra mim, na minha situação específica?",
      reward: "Identificação — o espectador se reconhece na cena.",
      expectation: "Esperar reconhecer a própria situação no que está sendo mostrado.",
      payoff: "Sensação de pertencimento: 'isso poderia ser sobre mim'.",
      rhythm: "dinamico",
    },
    {
      emotionalGoal: "Aprofundar em um detalhe específico que reforça a credibilidade da promessa.",
      tension: "Esse detalhe parece bom demais para ser verdade.",
      reward: "Validação concreta e sensorial do detalhe prometido.",
      expectation: "Esperar uma confirmação prática, não mais uma alegação.",
      payoff: "Confiança reforçada por especificidade — o detalhe certo convence mais que o discurso geral.",
      rhythm: "moderado",
    },
  ];

  return beats[((beatIndex % beats.length) + beats.length) % beats.length];
}

function buildSiteOfficialScenes(input: BrunoScriptRequestInput, totalDurationSeconds: number): BrunoSceneDraft[] {
  const strategy = input.joaoStrategy;
  const text = normalize(`${input.originalRequest} ${strategy.objective} ${strategy.centralPromise} ${strategy.keyMessages.join(" ")}`);
  if (!containsAny(text, ["site oficial", "site do casamento", "casamento merece um site"])) return [];

  const siteOfficialFunctions: BrunoSceneFunction[] = ["hook", ...developmentFunctionsFor(5), "cta"];
  const sceneDurations = distributeDurationsByFunction(totalDurationSeconds, siteOfficialFunctions);
  const scenes: Array<Omit<BrunoVideoScene, "order" | "startSeconds" | "durationSeconds" | "shots">> = [
    {
      name: "Gancho",
      spokenText: "Seu casamento merece um site oficial, elegante e fácil de compartilhar.",
      publicVisibleText: "Site oficial do casamento.",
      publicSubtitle: "Tudo começa organizado.",
      narrativePurpose: "Apresentar o conceito central do vídeo: site oficial como centro da experiência.",
      featureFocus: "site oficial",
      narrativeIntensity: "impacto",
      internalNotes: ["Preservar o tema principal em toda a pipeline; funcionalidades são provas, não o assunto dominante."],
      onScreenText: "Site oficial do casamento.",
      brollSuggestions: ["Casal recém-noivo vendo o site do casamento no celular ou notebook, com clima elegante e tranquilo."],
      framing: "Plano próximo do casal usando celular/notebook",
      cameraMovement: "Push-in suave para aproximar o espectador do produto",
      rhythm: "acelerado",
      pauseNotes: "Entrada direta, sem parágrafo explicativo.",
      transitionToNext: "Corte limpo para demonstração do produto",
      soundEffectSuggestions: ["Whoosh curto e discreto no primeiro corte."],
    },
    {
      name: "Descoberta",
      spokenText: "Em um só lugar, os convidados encontram tudo o que precisam para o grande dia.",
      publicVisibleText: "Tudo em um lugar.",
      publicSubtitle: "Convite, detalhes e experiência.",
      narrativePurpose: "Mostrar o site como hub central antes de listar funcionalidades.",
      featureFocus: "site oficial",
      narrativeIntensity: "descoberta",
      internalNotes: ["Priorizar screenshot/mockup real da home do site."],
      onScreenText: "Tudo em um lugar.",
      brollSuggestions: ["Mockup de celular exibindo a página inicial do site de casamento Rumo ao Altar."],
      framing: "Plano detalhe do celular na mão do casal",
      cameraMovement: "Pan lateral curto acompanhando a tela",
      rhythm: "moderado",
      transitionToNext: "Transição por slide sutil acompanhando a interface",
      soundEffectSuggestions: [],
    },
    {
      name: "Demonstração RSVP",
      spokenText: "A confirmação de presença fica simples, clara e sem mensagens perdidas.",
      publicVisibleText: "RSVP sem bagunça.",
      publicSubtitle: "Confirmações organizadas.",
      narrativePurpose: "Provar organização por meio do RSVP, sem fugir do conceito de site oficial.",
      featureFocus: "rsvp",
      narrativeIntensity: "demonstracao",
      internalNotes: ["Usar asset real de RSVP ou pausar para Developer Assisted Mode."],
      onScreenText: "RSVP sem bagunça.",
      brollSuggestions: ["Tela real ou mockup do RSVP no celular, com confirmação de presença clara."],
      framing: "Close-up de interface",
      cameraMovement: "Zoom suave de interface",
      rhythm: "dinamico",
      transitionToNext: "Corte com micro movimento de interface",
      soundEffectSuggestions: ["Click discreto de confirmação."],
    },
    {
      name: "Benefícios",
      spokenText: "A lista de presentes, o álbum colaborativo e as informações ficam conectados ao mesmo endereço.",
      publicVisibleText: "Presentes, fotos e detalhes.",
      publicSubtitle: "Tudo conectado ao site.",
      narrativePurpose: "Apresentar funcionalidades secundárias como provas equilibradas do hub central.",
      featureFocus: "presentes album informações",
      narrativeIntensity: "beneficio",
      internalNotes: ["Não deixar álbum colaborativo dominar a narrativa; incluir lista de presentes e detalhes do evento."],
      onScreenText: "Presentes, fotos e detalhes.",
      brollSuggestions: ["Montagem de cards do site com lista de presentes, álbum colaborativo e informações aos convidados."],
      framing: "Plano médio com cards/mockups sobrepostos",
      cameraMovement: "Parallax leve entre cards",
      rhythm: "dinamico",
      transitionToNext: "Wipe elegante entre cards",
      soundEffectSuggestions: [],
    },
    {
      name: "Prova de tranquilidade",
      spokenText: "Cronograma, local, horários e orientações reduzem dúvidas antes da festa.",
      publicVisibleText: "Menos dúvidas. Mais tranquilidade.",
      publicSubtitle: "Cronograma e informações claras.",
      narrativePurpose: "Conectar organização prática à emoção de tranquilidade dos noivos.",
      featureFocus: "cronograma informações convidados",
      narrativeIntensity: "prova",
      internalNotes: ["Visual deve sugerir calma e controle, não decoração genérica."],
      onScreenText: "Menos dúvidas. Mais tranquilidade.",
      brollSuggestions: ["Mockup de cronograma e informações para convidados em tela de celular, com contexto humano ao fundo."],
      framing: "Plano médio com celular e ambiente de casamento",
      cameraMovement: "Pull-out suave para sensação de alívio",
      rhythm: "moderado",
      pauseNotes: "Pequena respiração antes do CTA final.",
      transitionToNext: "Dissolve curto para end card",
      soundEffectSuggestions: [],
    },
    {
      name: "Convite",
      spokenText: "Depois é só compartilhar o link e deixar cada convidado encontrar o caminho.",
      publicVisibleText: "Compartilhe o link.",
      publicSubtitle: "Os convidados entendem tudo.",
      narrativePurpose: "Mostrar a facilidade de distribuir a experiência sem transformar o vídeo em tutorial.",
      featureFocus: "convidados informações site oficial",
      narrativeIntensity: "convite",
      internalNotes: ["Criar cena humana, com contexto de casal ou convidados recebendo o link; evitar só mockup isolado."],
      onScreenText: "Compartilhe o link.",
      brollSuggestions: ["Casal enviando o link do site oficial para convidados, com celular integrado à cena e interface real como apoio."],
      framing: "Plano médio com mãos, celular e contexto de casamento",
      cameraMovement: "Pan suave acompanhando o gesto de compartilhar",
      rhythm: "dinamico",
      pauseNotes: "Cena curta para preparar o CTA final.",
      transitionToNext: "Push elegante para end card",
      soundEffectSuggestions: ["Click discreto de compartilhamento."],
    },
    {
      name: "CTA final",
      spokenText: "Conheça o Rumo ao Altar.",
      publicVisibleText: "Conheça Rumo ao Altar.",
      publicSubtitle: "rumoaoaltar.com.br",
      narrativePurpose: "Encerrar com marca, URL e benefício central com ótima leitura.",
      featureFocus: "cta",
      narrativeIntensity: "cta",
      internalNotes: ["End card de 2 a 3 segundos com logo oficial, URL, CTA e mockup/screenshot real quando disponível."],
      onScreenText: "Conheça Rumo ao Altar.",
      brollSuggestions: ["End card profissional com logo oficial do Rumo ao Altar, mockup real do site e URL rumoaoaltar.com.br."],
      framing: "Composição centralizada de marca e produto",
      cameraMovement: "Estático com micro animação de entrada",
      rhythm: "moderado",
      soundEffectSuggestions: ["Subida musical discreta no CTA."],
    },
  ];

  let cursor = 0;
  return scenes.map((scene, index) => {
    const durationSeconds = sceneDurations[index] ?? 4;
    const built: BrunoSceneDraft = {
      order: index + 1,
      startSeconds: cursor,
      durationSeconds,
      sceneFunction: siteOfficialFunctions[index],
      ...scene,
    };
    cursor += durationSeconds;
    return built;
  });
}

function publicVoiceover(text: string): string {
  const cleaned = text
    .replace(/^desenvolver\s+a\s+mensagem-chave\s*:\s*/i, "")
    .replace(/^abertura\s+de\s+impacto.*?:\s*/i, "")
    .trim();
  return cleaned.endsWith(".") || cleaned.endsWith("!") || cleaned.endsWith("?") ? cleaned : `${cleaned}.`;
}

/**
 * Headline pública máxima de 4 palavras — a narração conta a história, a tela só reforça (ver
 * COMMERCIAL ENGINE v1). Vinha de 5 (e antes disso 8) — texto demais compete com a narração real
 * por cima da imagem em vez de reforçá-la.
 */
const ONSCREEN_HEADLINE_MAX_WORDS = 4;
/** Complemento público máximo de 6 palavras — nunca mais que a headline mais o dobro. */
const ONSCREEN_COMPLEMENT_MAX_WORDS = 6;

function conciseHeadline(text: string): string {
  const cleaned = summarize(text.replace(/^desenvolver\s+a\s+mensagem-chave\s*:\s*/i, ""), 54);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= ONSCREEN_HEADLINE_MAX_WORDS) return cleaned;
  return `${words.slice(0, ONSCREEN_HEADLINE_MAX_WORDS).join(" ")}…`;
}

function conciseSubtitle(text: string): string | undefined {
  const cleaned = summarize(text, 64);
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 4) return undefined;
  return words.slice(0, ONSCREEN_COMPLEMENT_MAX_WORDS).join(" ");
}

function inferFeatureFocus(text: string): string {
  const normalized = normalize(text);
  const features: string[] = [];
  if (containsAny(normalized, ["site", "oficial"])) features.push("site oficial");
  if (containsAny(normalized, ["rsvp", "presenca", "presença", "confirmacao", "confirmação"])) features.push("rsvp");
  if (containsAny(normalized, ["presente", "presentes", "pix", "taxa"])) features.push("presentes");
  if (containsAny(normalized, ["album", "álbum", "foto", "fotos"])) features.push("album");
  if (containsAny(normalized, ["cronograma", "horario", "horário", "local"])) features.push("cronograma");
  if (containsAny(normalized, ["convidado", "convidados", "informacoes", "informações"])) features.push("informações aos convidados");
  return features.length ? features.join(" ") : "benefício central";
}

function summarize(text: string, maxLength = 60): string {
  const trimmed = text.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function buildOverallRhythm(strategy: BrunoJoaoStrategySummary): string {
  return `Ritmo acelerado no gancho para prender atenção nos primeiros segundos, moderado durante o desenvolvimento das mensagens-chave e retomada de energia no CTA final, mantendo coerência com o tom de voz "${strategy.toneOfVoice}".`;
}

function buildMusicSuggestions(strategy: BrunoJoaoStrategySummary): string[] {
  const normalizedTone = normalize(strategy.toneOfVoice);
  const suggestions: string[] = [];
  if (containsAny(normalizedTone, ["leve", "divertido", "humor"])) {
    suggestions.push("Trilha upbeat e descontraída, compatível com o tom leve e divertido da marca.");
  } else if (containsAny(normalizedTone, ["serio", "profissional", "consultivo"])) {
    suggestions.push("Trilha instrumental discreta, com clima confiável e profissional.");
  } else {
    suggestions.push(`Trilha alinhada ao tom de voz "${strategy.toneOfVoice}" da marca, sem competir com a narração.`);
  }
  suggestions.push("Priorizar faixas de bibliotecas com uso liberado para redes sociais, evitando problemas de direitos autorais.");
  return suggestions;
}

function buildRecordingNotes(input: BrunoScriptRequestInput, creativeDna: CampaignCreativeDNA): string[] {
  return [
    "Gravar em enquadramento vertical 9:16, nativo do canal, sem depender de corte de um formato horizontal.",
    "Garantir áudio limpo, sem ruído de fundo, com microfone lapela ou direcional sempre que possível.",
    "Usar luz natural ou luz de preenchimento suave, evitando sombras fortes no rosto.",
    `Repetir a fala do gancho em pelo menos duas tomadas para garantir naturalidade na etapa de edição do canal ${input.channel}.`,
    // Creative Director Engine: a Hero Scene e a metáfora visual da campanha precisam sobreviver
    // até a gravação real, não só até o roteiro — nunca renderizadas, só orientação de produção.
    `Hero Scene do Creative DNA (buscar aproximar a captação real disso): ${creativeDna.heroScene}`,
    `Evitar durante a gravação: ${creativeDna.thingsToAvoid.join(" ")}`,
  ];
}

function buildEditingNotes(): string[] {
  return [
    "Inserir legendas embutidas (burned-in captions) em todas as cenas com fala, para acessibilidade e consumo sem áudio.",
    "Respeitar as zonas seguras do canal (a UI de reels/stories cobre parte inferior e lateral direita do quadro) ao posicionar texto na tela.",
    "Manter os cortes no ritmo da narração, evitando quedas de energia entre cenas.",
    "Aplicar padronização visual (cor e fonte do texto na tela) consistente com as demais peças da marca.",
  ];
}

function buildRisks(input: BrunoScriptRequestInput, hasBrandContext: boolean): string[] {
  const risks: string[] = [];
  if (!hasBrandContext) risks.push("Nenhum tom de voz de marca registrado na Clara; risco de inconsistência de narração.");
  risks.push(`Validar se a duração total é compatível com as práticas recomendadas do canal ${input.channel} antes da gravação.`);
  risks.push("Roteiro depende de revisão humana antes da gravação, pois Bruno não valida performance real do vídeo.");
  return risks;
}

function buildObservations(context: ClaraContextResponse, content?: ClaraKnowledgeRecord<"ContentContext">): string[] {
  const observations: string[] = [];
  if (!context.modules.AudienceContext?.length) observations.push("Nenhum público detalhado na Clara; considerar enriquecer o conhecimento do cliente.");
  if (content?.payload.publicationHistory?.length) {
    observations.push(`Histórico de publicações disponível (${content.payload.publicationHistory.length} publicações) para referência de tom e ritmo.`);
  } else {
    observations.push("Nenhum histórico de publicações encontrado na Clara para referência de tom e ritmo.");
  }
  return observations;
}

function buildNextSteps(input: BrunoScriptRequestInput): string[] {
  return [
    "Encaminhar o roteiro estruturado para a futura Vanessa transformar em produção e filmagem.",
    "Validar o roteiro com o time de marca antes da gravação.",
    `Reavaliar o roteiro caso o canal ${input.channel} ou o objetivo do vídeo mudem.`,
  ];
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

export function createBrunoVideoScriptSkill(
  dependencies: Partial<BrunoVideoScriptSkillDependencies> = {},
): BrunoVideoScriptSkill {
  return new BrunoVideoScriptSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    icaro: dependencies.icaro,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
  });
}
