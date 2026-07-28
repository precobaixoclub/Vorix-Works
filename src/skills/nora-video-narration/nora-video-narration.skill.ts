import { extname } from "node:path";
import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse } from "../../application/knowledge/clara.types.js";
import type { ArtifactDeliveryPort } from "../../application/ports/artifact-delivery.port.js";
import type { NarrationProviderPort } from "../../application/ports/narration-provider.port.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { Skill, SkillArtifact, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { latest } from "../../shared/utils/skill-parsing.js";
import { deriveCampaignCreativeDNA, type CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import { noraVideoNarrationManifest } from "./nora.manifest.js";
import type { NoraLogAction, NoraLoggerPort } from "./nora-log.contract.js";
import type {
  NoraAssistedGenerationOutput,
  NoraAssistedNarrationRequest,
  NoraDiegoTimelineEntry,
  NoraGeneratedNarrationAudio,
  NoraNarrativeIntensity,
  NoraNarrationAudioValidation,
  NoraNarrationSegment,
  NoraRafaBriefing,
  NoraVideoNarrationOutput,
  NoraVideoNarrationRequestInput,
  NoraVoiceProfile,
} from "./nora-video-narration.types.js";

export type NoraSkillOutput = NoraVideoNarrationOutput | NoraAssistedGenerationOutput;

export type NoraIdGenerator = {
  create(prefix: string): string;
};

export type NoraVideoNarrationSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  artifactDelivery?: ArtifactDeliveryPort;
  narrationProvider?: NarrationProviderPort;
  logger?: NoraLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: NoraIdGenerator;
  now?: () => Date;
};

class SequentialNoraIdGenerator implements NoraIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopNoraLogger implements NoraLoggerPort {
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
      throw new Error(`${portName} não configurado para Nora.`);
    },
  });
}

const EXPECTED_NARRATION_RELATIVE_PATH = "audio/narration.wav";
const SCRIPT_RELATIVE_PATH = "audio/narration-script.txt";
const WORK_PACKAGE_RELATIVE_PATH = "audio/narration-work-package.json";
const SUPPORTED_AUDIO_MIME_TYPES = ["audio/wav", "audio/mpeg", "audio/mp4", "audio/aac"];

export class NoraVideoNarrationSkill implements Skill<NoraVideoNarrationRequestInput, NoraSkillOutput> {
  readonly manifest = noraVideoNarrationManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly artifactDelivery?: ArtifactDeliveryPort;
  private readonly narrationProvider?: NarrationProviderPort;
  private readonly logger: NoraLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: NoraIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: NoraVideoNarrationSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.artifactDelivery = dependencies.artifactDelivery;
    this.narrationProvider = dependencies.narrationProvider;
    this.logger = dependencies.logger ?? new NoopNoraLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialNoraIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<NoraVideoNarrationRequestInput>): Promise<SkillResponse<NoraSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de narração inválida.", request, { errors: validationErrors });
      await this.emit("VideoNarrationFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: validationErrors,
        error: { code: "INVALID_REQUEST", message: validationErrors.join("; "), recoverable: true },
      };
    }

    try {
      return await this.runNarration(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante a narração.";
      await this.log("Error", `Erro inesperado em Nora. ${message}`, request, { error: message });
      await this.emit("VideoNarrationFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runNarration(request: SkillRequest<NoraVideoNarrationRequestInput>): Promise<SkillResponse<NoraSkillOutput>> {
    const startedAt = this.now().getTime();
    await this.log("RequestReceived", "Solicitação de narração recebida por Nora.", request, {
      channel: request.input.channel,
      format: request.input.format,
    });
    await this.emit("VideoNarrationStarted", request, {
      channel: request.input.channel,
      format: request.input.format,
    });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("VideoNarrationFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: { code: "CLIENT_NOT_FOUND", message, recoverable: true },
      };
    }

    await this.log("ClientResolved", `Cliente ${tenant.clientId} resolvido pela Valentina.`, request, {
      clientId: tenant.clientId,
      tenantId: tenant.tenantId,
    });

    const claraContext = await this.clara.requestContext({
      requester: { id: this.manifest.id, type: "specialist", name: "Nora" },
      clientId: tenant.clientId,
      modules: ["BrandContext", "AudienceContext", "PublishingContext", "AIContext"],
      reason: "Definir identidade verbal, tom de voz e instruções de narração para vídeo.",
    });

    await this.log("ContextConsulted", `Contexto consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
    });
    await this.emit("VideoNarrationContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
    });

    const plan = buildNarrationPlan(request.input, claraContext);
    await this.log("NarrationPlanBuilt", "Plano de narração estruturado por cena.", request, {
      segmentCount: plan.segments.length,
      durationSeconds: request.input.diegoEditingPlan.totalDurationSeconds,
      expectedRelativePath: EXPECTED_NARRATION_RELATIVE_PATH,
    });
    await this.emit("VideoNarrationPlanBuilt", request, {
      segmentCount: plan.segments.length,
      expectedRelativePath: EXPECTED_NARRATION_RELATIVE_PATH,
    });

    if (this.narrationProvider) {
      const generated = await this.narrationProvider.generate({
        executionId: request.context.executionId,
        language: plan.voiceProfile.language,
        voiceProfile: plan.voiceProfile,
        narrationScript: plan.narrationScript,
        segments: plan.segments,
        expectedRelativePath: EXPECTED_NARRATION_RELATIVE_PATH,
        providerInstructions: plan.providerInstructions,
      });
      if (generated.status === "failed") {
        return {
          skillId: this.manifest.id,
          taskId: request.context.taskId,
          status: "failed",
          artifacts: [],
          warnings: generated.warnings,
          error: generated.error ?? { code: "NARRATION_PROVIDER_FAILED", message: "Provider de narração falhou.", recoverable: true },
        };
      }
    }

    return this.runDeveloperAssistedNarration({
      request,
      tenant,
      plan,
      startedAt,
    });
  }

  private async runDeveloperAssistedNarration(input: {
    request: SkillRequest<NoraVideoNarrationRequestInput>;
    tenant: TenantClientContext;
    plan: BuiltNarrationPlan;
    startedAt: number;
  }): Promise<SkillResponse<NoraSkillOutput>> {
    const { request, tenant, plan, startedAt } = input;
    if (!this.artifactDelivery) {
      const message = "Nora exige ArtifactDeliveryPort configurada para solicitar e validar a narração salva em disco.";
      await this.log("Error", message, request, { clientId: tenant.clientId });
      await this.emit("VideoNarrationFailed", request, { reason: "ASSISTED_MODE_REQUIRES_ARTIFACT_DELIVERY", clientId: tenant.clientId });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: { code: "ASSISTED_MODE_REQUIRES_ARTIFACT_DELIVERY", message, recoverable: false },
      };
    }

    const validationErrors: string[] = [];
    const existing = await this.artifactDelivery.readFile({
      executionId: request.context.executionId,
      relativePath: EXPECTED_NARRATION_RELATIVE_PATH,
    });

    if (existing) {
      const validation = validateNarrationAudio(existing.data, existing.relativePath, request.input.diegoEditingPlan.totalDurationSeconds);
      if (validation.valid) {
        const audio = buildGeneratedAudio(existing, validation);
        const output = buildCompletedOutput({
          request: request.input,
          plan,
          audio,
          executionDurationMs: Math.max(0, this.now().getTime() - startedAt),
        });
        const artifact: SkillArtifact = {
          id: this.idGenerator.create("artifact"),
          type: "file",
          name: "Narração final validada pela Nora",
          status: "ready",
          uri: audio.relativePath,
          file: {
            mimeType: audio.mimeType,
            extension: audio.extension,
            sizeBytes: audio.sizeBytes,
            localPath: audio.absolutePath,
          },
          metadata: {
            clientId: tenant.clientId,
            durationSeconds: audio.durationSeconds,
            sampleRateHz: audio.sampleRateHz,
            clippingRisk: audio.validation.clippingRisk,
          },
        };

        await this.log("AssistedAudioAccepted", `Arquivo de narração validado em ${existing.relativePath}.`, request, {
          clientId: tenant.clientId,
          relativePath: existing.relativePath,
          sizeBytes: existing.sizeBytes,
          durationSeconds: validation.durationSeconds,
          sampleRateHz: validation.sampleRateHz,
        });
        await this.emit("VideoNarrationGenerated", request, {
          clientId: tenant.clientId,
          relativePath: existing.relativePath,
          durationSeconds: validation.durationSeconds,
        });

        return {
          skillId: this.manifest.id,
          taskId: request.context.taskId,
          status: "completed",
          output,
          artifacts: [artifact],
          warnings: output.warnings,
        };
      }
      validationErrors.push(validation.reason ?? `${existing.relativePath}: áudio inválido.`);
      await this.log("AssistedAudioValidationFailed", `Arquivo de narração inválido: ${validation.reason}`, request, {
        clientId: tenant.clientId,
        relativePath: existing.relativePath,
        reason: validation.reason,
      });
    }

    const scriptFile = await this.artifactDelivery.writeFile({
      executionId: request.context.executionId,
      relativePath: SCRIPT_RELATIVE_PATH,
      content: plan.narrationScript,
      mimeType: "text/plain",
    });
    const workPackage = await this.artifactDelivery.writeFile({
      executionId: request.context.executionId,
      relativePath: WORK_PACKAGE_RELATIVE_PATH,
      content: JSON.stringify({
        skill: this.manifest.id,
        expectedRelativePath: EXPECTED_NARRATION_RELATIVE_PATH,
        voiceProfile: plan.voiceProfile,
        narrationScript: plan.narrationScript,
        segments: plan.segments,
        providerInstructions: plan.providerInstructions,
        validationRules: [
          "Salvar um arquivo real em WAV, MP3, M4A ou AAC no caminho solicitado.",
          "Preferir WAV PCM 44.1kHz ou 48kHz, voz feminina pt-BR, natural e acolhedora.",
          "Evitar voz robótica, leitura acelerada, ruído, silêncio longo e clipping.",
          "A duração deve caber no vídeo e acompanhar os tempos dos segmentos.",
        ],
      }, null, 2),
      mimeType: "application/json",
    });

    const pendingNarrations: NoraAssistedNarrationRequest[] = [
      {
        index: 0,
        fileName: "narration.wav",
        expectedRelativePath: EXPECTED_NARRATION_RELATIVE_PATH,
        mimeTypes: SUPPORTED_AUDIO_MIME_TYPES,
        durationSeconds: request.input.diegoEditingPlan.totalDurationSeconds,
        prompt: buildAssistedNarrationPrompt(plan, request.input),
        voiceProfile: plan.voiceProfile,
        segments: plan.segments,
      },
    ];
    const resumeCommand = buildAssistedResumeCommand(request.context.executionId);

    await this.log("AssistedGenerationRequested", "Nora aguarda geração assistida do arquivo de voz.", request, {
      clientId: tenant.clientId,
      expectedRelativePath: EXPECTED_NARRATION_RELATIVE_PATH,
      scriptFile: scriptFile.relativePath,
      workPackage: workPackage.relativePath,
    });
    await this.emit("VideoNarrationAwaitingAssistedInput", request, {
      clientId: tenant.clientId,
      expectedRelativePath: EXPECTED_NARRATION_RELATIVE_PATH,
    });

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "needs_assisted_generation",
      output: {
        mode: "developer_assisted",
        instruction: "Gere a narração real usando o roteiro abaixo e salve o arquivo no caminho exato indicado. Depois retome o workflow.",
        pendingNarrations,
        narrationScript: plan.narrationScript,
        voiceProfile: plan.voiceProfile,
        resumeCommand,
        validationErrors,
      },
      artifacts: [
        {
          id: this.idGenerator.create("artifact"),
          type: "file",
          name: "Roteiro de narração",
          status: "ready",
          uri: scriptFile.relativePath,
          file: { mimeType: scriptFile.mimeType, extension: "txt", sizeBytes: scriptFile.sizeBytes, localPath: scriptFile.absolutePath },
        },
        {
          id: this.idGenerator.create("artifact"),
          type: "file",
          name: "Pacote de trabalho de narração",
          status: "ready",
          uri: workPackage.relativePath,
          file: { mimeType: workPackage.mimeType, extension: "json", sizeBytes: workPackage.sizeBytes, localPath: workPackage.absolutePath },
        },
      ],
      warnings: validationErrors,
    };
  }

  private async resolveClient(input: NoraVideoNarrationRequestInput): Promise<TenantClientContext> {
    if (input.tenantId?.trim()) return this.valentina.getClientContext(input.tenantId);
    const tenant = await this.valentina.getTenant({ clientId: input.clientId, status: "all" });
    if (!tenant) throw new Error(`Valentina não encontrou o cliente ${input.clientId}.`);
    return this.valentina.getClientContext(tenant.id);
  }

  private async log(
    action: NoraLogAction,
    message: string,
    request: SkillRequest<NoraVideoNarrationRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("nora-log"),
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

  private async emit(name: ZunoEventName, request: SkillRequest<NoraVideoNarrationRequestInput>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: { source: "nora", ...payload },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

type BuiltNarrationPlan = {
  voiceProfile: NoraVoiceProfile;
  narrationScript: string;
  segments: NoraNarrationSegment[];
  providerInstructions: string[];
  creativeDna: CampaignCreativeDNA;
};

type ArtifactRead = {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  data: Uint8Array;
};

function validateRequestInput(input: NoraVideoNarrationRequestInput): string[] {
  const errors: string[] = [];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!input.joaoStrategy) errors.push("joaoStrategy é obrigatório.");
  if (!input.brunoScript?.scenes?.length) errors.push("brunoScript.scenes é obrigatório.");
  if (!input.vanessaDirection?.sceneDirections?.length) errors.push("vanessaDirection.sceneDirections é obrigatório.");
  if (!input.diegoEditingPlan?.editingTimeline?.length) errors.push("diegoEditingPlan.editingTimeline é obrigatório.");
  if ((input.diegoEditingPlan?.totalDurationSeconds ?? 0) <= 0) errors.push("diegoEditingPlan.totalDurationSeconds precisa ser maior que zero.");
  return errors;
}

export function buildNarrationPlan(input: NoraVideoNarrationRequestInput, context: ClaraContextResponse): BuiltNarrationPlan {
  const brand = latest(context.modules.BrandContext);
  const audience = latest(context.modules.AudienceContext);
  const tone = [
    brand?.payload.toneOfVoice,
    input.joaoStrategy.toneOfVoice,
    "acolhedor elegante confiante",
  ].filter(Boolean).join(", ");

  const voiceProfile: NoraVoiceProfile = {
    language: input.language ?? "pt-BR",
    genderPreference: "female",
    tone: normalizeTone(tone),
    pace: 0.96,
  };

  const rawSegments = input.diegoEditingPlan.editingTimeline.map((entry) => buildSegment(input, entry));
  // Respiração natural entre falas: uma fala anterior longa pede um fôlego real antes da próxima,
  // distinto do silêncio dramático (que marca impacto, não a necessidade física de respirar).
  const segments = rawSegments.map((segment, index) => ({ ...segment, breathBeforeMs: breathBeforeMsFor(rawSegments[index - 1]) }));
  const narrationScript = segments.map((segment) => segment.text).join(" ");

  // Creative Director Engine: mesmos campos de estratégia que Bruno/Vanessa/Diego já usaram —
  // chega ao mesmo Creative DNA por construção (função pura), sem nenhum dado novo precisar fluir
  // entre Skills. Nora usa a emoção dominante/sentimento desejado para orientar a ENTREGA da voz,
  // nunca o texto falado em si (isso continua vindo do roteiro de Bruno).
  const creativeDna = deriveCampaignCreativeDNA({
    originalRequest: input.originalRequest,
    centralPromise: input.joaoStrategy.centralPromise,
    valueProposition: input.joaoStrategy.valueProposition,
    toneOfVoice: input.joaoStrategy.toneOfVoice,
    targetAudience: input.joaoStrategy.targetAudience,
    keyMessages: input.joaoStrategy.keyMessages,
  });

  const providerInstructions = [
    "Usar voz feminina em português do Brasil, natural, acolhedora, elegante e confiante.",
    "Não ler como anúncio gritado; soar como uma orientação carinhosa para noivos.",
    "Respeitar pausas entre cenas e dar ênfase apenas às palavras marcadas.",
    "Manter ritmo levemente abaixo do acelerado para caber no Reels sem parecer robótico.",
    `Público principal: ${audience?.payload.targetAudience ?? input.joaoStrategy.targetAudience}.`,
    "Exportar arquivo final sem música, sem efeitos e sem ruído de fundo; Rafa fará a mixagem.",
    "Na mixagem do Rafa, manter a voz em primeiro plano e aplicar ducking da música durante cada fala.",
    `Emoção dominante da campanha (Creative DNA): ${creativeDna.dominantEmotion}. Sentimento que o público deve sentir: ${creativeDna.desiredAudienceFeeling}`,
  ];

  return { voiceProfile, narrationScript, segments, providerInstructions, creativeDna };
}

function buildSegment(input: NoraVideoNarrationRequestInput, entry: NoraDiegoTimelineEntry): NoraNarrationSegment {
  const scene = input.brunoScript.scenes.find((candidate) => candidate.order === entry.order);
  const intensity = entry.narrativeIntensity ?? scene?.narrativeIntensity ?? "beneficio";
  const rawText = scene?.spokenText ?? entry.publicVisibleText ?? entry.onScreenText ?? input.joaoStrategy.centralPromise;
  const adaptedText = adaptSpokenText(rawText, entry, scene, input);
  const maxWords = Math.max(4, Math.floor(entry.durationSeconds * 2.55));
  const text = fitSpokenTextToDuration(adaptedText, maxWords, input, entry, scene);
  const startTime = roundSeconds(entry.startSeconds);
  const endTime = roundSeconds(Math.min(entry.endSeconds, entry.startSeconds + entry.durationSeconds));
  const estimatedDurationSeconds = estimateSpeechDurationSeconds(text, speechPaceFor(intensity));
  const shotSyncMarkers = buildShotSyncMarkers(entry, text);

  return {
    sceneId: `scene-${String(entry.order).padStart(2, "0")}`,
    sceneOrder: entry.order,
    sceneName: entry.name,
    startTime,
    endTime,
    estimatedDurationSeconds,
    text,
    emotion: emotionFor(intensity, scene?.featureFocus),
    emphasis: chooseEmphasis(text, input.joaoStrategy.keyMessages),
    pauseAfterMs: pauseFor(intensity),
    speed: speechPaceFor(intensity),
    volume: intensity === "cta" ? 0.96 : 0.9,
    pronunciationHints: pronunciationHintsFor(text),
    intensity,
    smile: smileFor(intensity),
    surprise: surpriseFor(intensity),
    silenceBeforeMs: silenceBeforeMsFor(intensity),
    // Preenchido em um segundo passo por `buildNarrationPlan`, que precisa do texto do segmento
    // ANTERIOR (só disponível depois que todos os segmentos existem) — ver `breathBeforeMsFor`.
    breathBeforeMs: 0,
    shotSyncMarkers,
  };
}

/**
 * AGENCY FILM PIPELINE 2.0 — Nora nunca lê um bloco inteiro enquanto a imagem permanece parada.
 * Este helper fatiar a fala de uma cena em porções alinhadas com cada Shot que Diego entregou,
 * gerando marcadores de sincronia (`NoraShotSyncMarker`). Rafa usa isso para respirar/mudar tom
 * exatamente onde o Shot troca, transformando o vídeo em filme (não em locução sobre imagem parada).
 */
function buildShotSyncMarkers(entry: NoraDiegoTimelineEntry, text: string): NoraNarrationSegment["shotSyncMarkers"] {
  const shots = entry.shotTimeline ?? [];
  if (shots.length === 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const totalDuration = Math.max(0.1, entry.durationSeconds);
  let cursorWord = 0;
  return shots.map((shot, index) => {
    const proportion = shot.durationSeconds / totalDuration;
    const isLast = index === shots.length - 1;
    const wordsForShot = isLast ? words.length - cursorWord : Math.max(1, Math.round(words.length * proportion));
    const slice = words.slice(cursorWord, cursorWord + wordsForShot).join(" ");
    cursorWord += wordsForShot;
    return {
      shotId: shot.shotId,
      shotOrder: shot.shotOrder,
      startSeconds: shot.startSeconds,
      endSeconds: shot.endSeconds,
      textSlice: slice,
      breathOnEnterMs: index === 0 ? 0 : 120,
    };
  });
}

function breathBeforeMsFor(previousSegment: NoraNarrationSegment | undefined): number {
  if (!previousSegment) return 0;
  const wordCount = previousSegment.text.split(/\s+/).filter(Boolean).length;
  return wordCount > 8 ? 180 : 0;
}

function adaptSpokenText(
  rawText: string,
  entry: NoraDiegoTimelineEntry,
  scene: NoraVideoNarrationRequestInput["brunoScript"]["scenes"][number] | undefined,
  input: NoraVideoNarrationRequestInput,
): string {
  const visible = normalizeComparable(entry.publicVisibleText ?? entry.onScreenText ?? "");
  const raw = normalizeWhitespace(rawText);
  if (normalizeComparable(raw) === visible || visible.includes(normalizeComparable(raw))) {
    if (scene?.featureFocus?.includes("rsvp")) return "Com o RSVP, as confirmações ficam simples e sem mensagens perdidas.";
    if (scene?.featureFocus?.includes("presente")) return "A lista de presentes também entra no mesmo lugar, com Pix direto para o casal.";
    if (scene?.featureFocus?.includes("album")) return "As fotos dos convidados ficam reunidas, sem precisar pedir uma por uma depois.";
    if (scene?.featureFocus?.includes("cronograma")) return "Cronograma, local e horários ficam claros antes da festa começar.";
    if ((scene?.narrativeIntensity ?? entry.narrativeIntensity) === "cta") return input.joaoStrategy.recommendedCta || "Conheça o Rumo ao Altar.";
    return input.joaoStrategy.centralPromise || raw;
  }
  return raw;
}

function fitSpokenTextToDuration(
  text: string,
  maxWords: number,
  input: NoraVideoNarrationRequestInput,
  entry: NoraDiegoTimelineEntry,
  scene?: NoraVideoNarrationRequestInput["brunoScript"]["scenes"][number],
): string {
  const normalized = normalizeWhitespace(text);
  if (countWords(normalized) <= maxWords) return normalized;

  const fallback = conciseNarrationForScene(input, entry, scene);
  if (countWords(fallback) <= maxWords) return fallback;

  return limitWords(fallback, maxWords);
}

function conciseNarrationForScene(
  input: NoraVideoNarrationRequestInput,
  entry: NoraDiegoTimelineEntry,
  scene?: NoraVideoNarrationRequestInput["brunoScript"]["scenes"][number],
): string {
  const intensity = scene?.narrativeIntensity ?? entry.narrativeIntensity;
  const searchable = normalizeComparable([
    scene?.featureFocus,
    scene?.name,
    scene?.narrativePurpose,
    scene?.spokenText,
    entry.name,
    entry.publicVisibleText,
    entry.publicSubtitle,
  ].filter(Boolean).join(" "));
  const hasToken = (token: string) => new RegExp(`(?:^|\\s)${token}(?:\\s|$)`, "u").test(searchable);

  if (intensity === "convite" || searchable.includes("compartilhe") || searchable.includes("link")) {
    return "Compartilhe o link e deixe tudo claro para cada convidado.";
  }

  if (intensity === "cta" || hasToken("cta")) {
    return ensureSentence(input.joaoStrategy.recommendedCta || input.brunoScript.finalCta || "Conheça o Rumo ao Altar");
  }

  if (searchable.includes("rsvp") || searchable.includes("confirmacao") || searchable.includes("presenca")) {
    return "O RSVP fica simples, claro e sem mensagens perdidas.";
  }

  if ((searchable.includes("presente") && searchable.includes("album")) || searchable.includes("informacao")) {
    return "Presentes, fotos e detalhes ficam conectados ao mesmo site.";
  }

  if (searchable.includes("presente") || searchable.includes("pix") || searchable.includes("taxa")) {
    return "A lista de presentes recebe Pix direto para o casal.";
  }

  if (searchable.includes("album") || searchable.includes("foto")) {
    return "As fotos dos convidados ficam reunidas em um só lugar.";
  }

  if (searchable.includes("cronograma") || searchable.includes("horario") || searchable.includes("local")) {
    return "Cronograma, local e horários reduzem dúvidas antes da festa.";
  }

  if (searchable.includes("site") && (intensity === "descoberta" || entry.order > 1)) {
    return "Tudo fica em um só lugar para orientar cada convidado.";
  }

  if (searchable.includes("site") || searchable.includes("oficial") || entry.order === 1) {
    return "Seu casamento merece um site oficial e fácil de compartilhar.";
  }

  return "Tudo fica organizado em um só lugar, com mais tranquilidade.";
}

function buildCompletedOutput(input: {
  request: NoraVideoNarrationRequestInput;
  plan: BuiltNarrationPlan;
  audio: NoraGeneratedNarrationAudio;
  executionDurationMs: number;
}): NoraVideoNarrationOutput {
  const warnings: string[] = [];
  if (input.audio.validation.clippingRisk === "medium") warnings.push("Narração validada, mas com risco médio de clipping; recomenda-se revisar volume antes de publicar.");
  if (input.audio.validation.clippingRisk === "unknown") warnings.push("Narração validada por assinatura de arquivo, mas duração/clipping não puderam ser medidos com precisão neste formato.");

  const rafaBriefing: NoraRafaBriefing = {
    narrationScript: input.plan.narrationScript,
    segments: input.plan.segments,
    voiceProfile: input.plan.voiceProfile,
    providerInstructions: input.plan.providerInstructions,
    audio: input.audio,
    textReductionGuidance: [
      "Quando houver voz, não repetir na tela a frase inteira da locução.",
      "Usar apenas headline curta e palavra-chave; subtítulo só quando necessário.",
      "Sincronizar entrada de texto com palavras enfatizadas pela Nora.",
      "Dar prioridade à voz no mix; música deve fazer ducking durante fala.",
    ],
  };

  return {
    generationSummary: `Narração validada para ${input.request.format} em ${input.plan.voiceProfile.language}.`,
    voiceProfile: input.plan.voiceProfile,
    narrationScript: input.plan.narrationScript,
    segments: input.plan.segments,
    providerInstructions: input.plan.providerInstructions,
    expectedRelativePath: EXPECTED_NARRATION_RELATIVE_PATH,
    audio: input.audio,
    rafaBriefing,
    warnings,
    creativeDna: input.plan.creativeDna,
  };
}

function buildGeneratedAudio(existing: ArtifactRead, validation: NoraNarrationAudioValidation): NoraGeneratedNarrationAudio {
  const extension = extname(existing.relativePath).replace(".", "").toLowerCase() || validation.format || "wav";
  return {
    expectedRelativePath: EXPECTED_NARRATION_RELATIVE_PATH,
    relativePath: existing.relativePath,
    absolutePath: existing.absolutePath,
    fileName: existing.relativePath.split(/[\\/]/).pop() ?? "narration.wav",
    mimeType: mimeTypeForExtension(extension),
    extension,
    sizeBytes: existing.sizeBytes,
    durationSeconds: validation.durationSeconds,
    sampleRateHz: validation.sampleRateHz,
    validation,
  };
}

export function validateNarrationAudio(bytes: Uint8Array, relativePath: string, expectedDurationSeconds: number): NoraNarrationAudioValidation {
  if (bytes.byteLength < 4096) {
    return { valid: false, reason: "Arquivo de narração muito pequeno; provável placeholder ou arquivo vazio." };
  }

  const extension = extname(relativePath).toLowerCase();
  if (extension === ".wav") return validateWavAudio(bytes, expectedDurationSeconds);
  if (extension === ".mp3") return hasMp3Header(bytes)
    ? { valid: true, format: "mp3", clippingRisk: "unknown" }
    : { valid: false, reason: "Arquivo MP3 sem assinatura válida." };
  if (extension === ".m4a") return hasMp4AudioHeader(bytes)
    ? { valid: true, format: "m4a", clippingRisk: "unknown" }
    : { valid: false, reason: "Arquivo M4A sem assinatura MP4/ftyp válida." };
  if (extension === ".aac") return hasAacHeader(bytes)
    ? { valid: true, format: "aac", clippingRisk: "unknown" }
    : { valid: false, reason: "Arquivo AAC sem assinatura ADTS válida." };

  return { valid: false, reason: `Extensão de narração não suportada: ${extension || "(sem extensão)"}.` };
}

function validateWavAudio(bytes: Uint8Array, expectedDurationSeconds: number): NoraNarrationAudioValidation {
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    return { valid: false, reason: "Arquivo WAV inválido: cabeçalho RIFF/WAVE ausente." };
  }
  const sampleRateHz = readUInt32LE(bytes, 24);
  const byteRate = readUInt32LE(bytes, 28);
  if (sampleRateHz < 16000 || sampleRateHz > 96000) {
    return { valid: false, format: "wav", sampleRateHz, reason: `Sample rate inválido (${sampleRateHz}Hz).` };
  }
  if (byteRate <= 0) {
    return { valid: false, format: "wav", sampleRateHz, reason: "Byte rate inválido no WAV." };
  }
  const dataOffset = findWavDataOffset(bytes);
  if (!dataOffset) {
    return { valid: false, format: "wav", sampleRateHz, reason: "Chunk data ausente no WAV." };
  }
  const durationSeconds = dataOffset.dataSize / byteRate;
  if (durationSeconds < 1) {
    return { valid: false, format: "wav", sampleRateHz, durationSeconds, reason: "Narração curta demais para ser um áudio real." };
  }
  if (durationSeconds > expectedDurationSeconds + 4) {
    return {
      valid: false,
      format: "wav",
      sampleRateHz,
      durationSeconds,
      reason: `Narração (${durationSeconds.toFixed(1)}s) excede a duração planejada do vídeo (${expectedDurationSeconds}s).`,
    };
  }
  if (!hasAudibleWavSignal(bytes, dataOffset.offset, dataOffset.dataSize)) {
    return { valid: false, format: "wav", sampleRateHz, durationSeconds, reason: "Áudio de narração sem sinal audível suficiente; provável silêncio ou placeholder." };
  }
  const clippingRisk = estimateWavClippingRisk(bytes, dataOffset.offset, dataOffset.dataSize);
  if (clippingRisk === "high") {
    return { valid: false, format: "wav", sampleRateHz, durationSeconds, clippingRisk, reason: "Clipping excessivo detectado na narração." };
  }
  return { valid: true, format: "wav", sampleRateHz, durationSeconds, clippingRisk };
}

function findWavDataOffset(bytes: Uint8Array): { offset: number; dataSize: number } | undefined {
  let offset = 12;
  while (offset + 8 < bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = readUInt32LE(bytes, offset + 4);
    if (chunkId === "data") return { offset: offset + 8, dataSize: Math.min(chunkSize, bytes.byteLength - offset - 8) };
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return undefined;
}

function hasAudibleWavSignal(bytes: Uint8Array, offset: number, dataSize: number): boolean {
  let samples = 0;
  let audibleSamples = 0;
  const end = Math.min(bytes.byteLength - 1, offset + dataSize);
  for (let index = offset; index + 1 < end; index += 2) {
    const sample = Math.abs(readInt16LE(bytes, index));
    samples += 1;
    if (sample > 64) audibleSamples += 1;
  }
  return samples > 0 && audibleSamples / samples > 0.01;
}

function estimateWavClippingRisk(bytes: Uint8Array, offset: number, dataSize: number): NoraNarrationAudioValidation["clippingRisk"] {
  let samples = 0;
  let clipped = 0;
  const end = Math.min(bytes.byteLength - 1, offset + dataSize);
  for (let index = offset; index + 1 < end; index += 2) {
    const sample = readInt16LE(bytes, index);
    samples += 1;
    if (Math.abs(sample) > 32100) clipped += 1;
  }
  if (samples === 0) return "unknown";
  const ratio = clipped / samples;
  if (ratio > 0.03) return "high";
  if (ratio > 0.008) return "medium";
  return "low";
}

function buildAssistedNarrationPrompt(plan: BuiltNarrationPlan, input: NoraVideoNarrationRequestInput): string {
  const lines = [
    "Você é a IA desenvolvedora responsável por gerar a voz real da Nora para o vídeo do Zuno.",
    "",
    "OBJETIVO",
    `Gerar uma narração natural em ${plan.voiceProfile.language}, acolhedora, elegante e confiante, para o vídeo: ${input.videoObjective}.`,
    "",
    "PERFIL DE VOZ",
    `- Preferência: ${plan.voiceProfile.genderPreference}`,
    `- Tom: ${plan.voiceProfile.tone}`,
    `- Ritmo: ${plan.voiceProfile.pace}`,
    "",
    "ROTEIRO COMPLETO",
    plan.narrationScript,
    "",
    "SEGMENTOS POR CENA",
    ...plan.segments.map((segment) => [
      `Cena ${segment.sceneOrder} (${segment.startTime}s-${segment.endTime}s): ${segment.text}`,
      `  Emoção: ${segment.emotion} (intensidade: ${segment.intensity})`,
      `  Ênfase: ${segment.emphasis.join(", ") || "nenhuma"}`,
      `  Sorriso na voz: ${segment.smile ? "sim" : "não"}`,
      `  Surpresa/descoberta: ${segment.surprise ? "sim" : "não"}`,
      segment.silenceBeforeMs > 0 ? `  Silêncio dramático antes: ${segment.silenceBeforeMs}ms` : undefined,
      segment.breathBeforeMs > 0 ? `  Respiração antes (fala anterior longa): ${segment.breathBeforeMs}ms` : undefined,
      `  Pausa após: ${segment.pauseAfterMs}ms`,
    ].filter((line): line is string => Boolean(line)).join("\n")),
    "",
    "INSTRUÇÕES",
    ...plan.providerInstructions.map((instruction) => `- ${instruction}`),
    "",
    `SALVAR EXATAMENTE EM: artifacts/<executionId>/${EXPECTED_NARRATION_RELATIVE_PATH}`,
    "Formato recomendado: WAV PCM 44.1kHz ou 48kHz, sem música e sem efeitos.",
  ];
  return lines.join("\n");
}

function buildAssistedResumeCommand(executionId: string): string {
  return `npm run zuno -- --continue ${executionId}`;
}

function normalizeTone(text: string): string {
  const words = text
    .split(/[,\s]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(words)].slice(0, 8);
  return unique.join(", ") || "acolhedor, elegante e confiante";
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeComparable(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function limitWords(text: string, maxWords: number): string {
  const words = normalizeWhitespace(text).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return normalizeWhitespace(text);
  return ensureSentence(removeDanglingEnding(words.slice(0, maxWords)).join(" "));
}

function countWords(text: string): number {
  return normalizeWhitespace(text).split(/\s+/).filter(Boolean).length;
}

function removeDanglingEnding(words: string[]): string[] {
  const danglingWords = new Set(["a", "as", "ao", "aos", "com", "da", "das", "de", "do", "dos", "e", "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por", "que", "sem", "um", "uma"]);
  const cleaned = [...words];
  while (cleaned.length > 1) {
    const last = normalizeComparable(cleaned[cleaned.length - 1].replace(/[^\p{L}\p{N}]+/gu, ""));
    if (!danglingWords.has(last)) break;
    cleaned.pop();
  }
  return cleaned;
}

function ensureSentence(text: string): string {
  const sentence = normalizeWhitespace(text).replace(/\s+([,.!?;:])/g, "$1");
  return /[.!?]$/u.test(sentence) ? sentence : `${sentence}.`;
}

function estimateSpeechDurationSeconds(text: string, pace: number): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return roundSeconds(words / (2.45 * pace));
}

function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100;
}

function emotionFor(intensity: NoraNarrativeIntensity, featureFocus?: string): string {
  if (intensity === "impacto") return "curiosidade";
  if (intensity === "descoberta") return "encantamento";
  if (intensity === "demonstracao") return featureFocus?.includes("rsvp") ? "clareza" : "confiança";
  if (intensity === "beneficio") return "alívio";
  if (intensity === "prova") return "tranquilidade";
  if (intensity === "convite") return "proximidade";
  return "confiança";
}

function speechPaceFor(intensity: NoraNarrativeIntensity): number {
  if (intensity === "impacto") return 1.02;
  if (intensity === "demonstracao" || intensity === "beneficio") return 0.98;
  if (intensity === "prova") return 0.92;
  if (intensity === "cta") return 0.9;
  return 0.96;
}

function pauseFor(intensity: NoraNarrativeIntensity): number {
  if (intensity === "impacto") return 220;
  if (intensity === "prova") return 360;
  if (intensity === "cta") return 420;
  return 280;
}

function smileFor(intensity: NoraNarrativeIntensity): boolean {
  return intensity === "descoberta" || intensity === "beneficio" || intensity === "convite";
}

function surpriseFor(intensity: NoraNarrativeIntensity): boolean {
  return intensity === "impacto" || intensity === "descoberta";
}

function silenceBeforeMsFor(intensity: NoraNarrativeIntensity): number {
  if (intensity === "impacto") return 300;
  if (intensity === "cta") return 250;
  return 0;
}

function chooseEmphasis(text: string, keyMessages: string[]): string[] {
  const candidates = ["casamento", "site", "oficial", "Rumo ao Altar", "RSVP", "Pix", "presentes", "fotos", "cronograma", "convidados"];
  const normalizedText = normalizeComparable(text);
  const emphasis = candidates.filter((candidate) => normalizedText.includes(normalizeComparable(candidate))).slice(0, 3);
  if (emphasis.length > 0) return emphasis;
  return keyMessages.flatMap((message) => message.split(/\s+/)).filter((word) => word.length > 6).slice(0, 2);
}

function pronunciationHintsFor(text: string): Record<string, string> {
  const hints: Record<string, string> = {};
  if (/RSVP/i.test(text)) hints.RSVP = "érre ésse vê pê";
  if (/Pix/i.test(text)) hints.Pix = "píquis";
  if (/Rumo ao Altar/i.test(text)) hints["Rumo ao Altar"] = "Rumo ao Altar";
  if (/rumoaoaltar\.com\.br/i.test(text)) hints["rumoaoaltar.com.br"] = "rumo ao altar ponto com ponto bê erre";
  return hints;
}

function mimeTypeForExtension(extension: string): string {
  if (extension === "wav") return "audio/wav";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "aac") return "audio/aac";
  return "application/octet-stream";
}

function hasMp3Header(bytes: Uint8Array): boolean {
  return readAscii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

function hasMp4AudioHeader(bytes: Uint8Array): boolean {
  return readAscii(bytes, 4, 4) === "ftyp";
}

function hasAacHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.slice(offset, offset + length)).toString("ascii");
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return Buffer.from(bytes.slice(offset, offset + 4)).readUInt32LE(0);
}

function readInt16LE(bytes: Uint8Array, offset: number): number {
  return Buffer.from(bytes.slice(offset, offset + 2)).readInt16LE(0);
}

export function createNoraVideoNarrationSkill(dependencies: Record<string, unknown> = {}): NoraVideoNarrationSkill {
  return new NoraVideoNarrationSkill({
    valentina: (dependencies.valentina as ValentinaTenantPort | undefined) ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: (dependencies.clara as ClaraKnowledgePort | undefined) ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    artifactDelivery: dependencies.artifactDelivery as ArtifactDeliveryPort | undefined,
    narrationProvider: dependencies.narrationProvider as NarrationProviderPort | undefined,
    logger: dependencies.noraLogger as NoraLoggerPort | undefined,
    eventRecorder: dependencies.eventRecorder as ZunoEventRecorderPort | undefined,
    idGenerator: dependencies.noraIdGenerator as NoraIdGenerator | undefined,
    now: dependencies.now as (() => Date) | undefined,
  });
}
