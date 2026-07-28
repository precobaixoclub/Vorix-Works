import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse } from "../../application/knowledge/clara.types.js";
import type { ArtifactDeliveryPort } from "../../application/ports/artifact-delivery.port.js";
import type {
  VisualAssetCreationPackage,
  VisualAssetKind,
  VisualAssetResolved,
  VisualAssetResolverPort,
  VisualAssetSearchQuery,
  VisualSequenceRole,
} from "../../application/ports/visual-asset-provider.port.js";
import type { AssetQualityProfile } from "../../application/ports/asset-quality-profile.js";
import { evaluateAssetDiversityGate, buildAssistedPackagesForFlaggedShots } from "../../shared/utils/asset-diversity-gate.js";
import { evaluateProductionReadiness } from "../../shared/utils/production-readiness.js";
// NARRATIVE TIMING REBALANCING — reaproveita o motor de realocação (shared/utils, sem I/O);
// Rafa é o único ponto com acesso simultâneo ao déficit estruturado do resolver (`timingDeficits`)
// E à timeline completa de Diego (todos os Shots candidatos a doador), então a orquestração vive
// aqui, nunca dentro do resolver genérico.
import {
  applyRebalancePlan,
  buildRebalancePlan,
  buildRebalanceRecord,
  findDonorCandidates,
  type RebalancePlan,
  type RebalanceRecord,
} from "../../shared/utils/timing-rebalancing/timing-rebalancer.js";
import type { TimingShotInput } from "../../shared/utils/timing-rebalancing/timing-constraint-model.js";
import type {
  VideoAssetCandidate,
  VideoAssetResolution,
  VideoAudioTrack,
  VideoMotionAnimation,
  VideoMotionComposition,
  VideoMotionElement,
  VideoRenderAsset,
  VideoRenderRequest,
  VideoRenderResult,
  VideoRenderScene,
  VideoRenderShot,
  VideoRenderingPort,
  VideoSceneBackground,
  VideoSceneOverlay,
  VideoSceneTransition,
} from "../../application/ports/video-rendering.port.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillArtifact, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { resolveAspectRatio, resolutionForAspectRatio } from "../../shared/utils/aspect-ratio.js";
import { latest } from "../../shared/utils/skill-parsing.js";
import { deriveCampaignCreativeDNA, type CampaignCreativeDNA } from "../../shared/utils/creative-director-engine.js";
import { rafaVideoRenderingManifest } from "./rafa.manifest.js";
import type { RafaLogAction, RafaLoggerPort } from "./rafa-log.contract.js";
import type {
  RafaAssistedGenerationOutput,
  RafaAssistedVideoRequest,
  RafaGeneratedVideo,
  RafaLocalAssetsInput,
  RafaVideoMotionSummary,
  RafaVideoRenderingOutput,
  RafaVideoRenderingRequestInput,
  RafaVideoSpecs,
} from "./rafa-video-rendering.types.js";

export type RafaSkillOutput = RafaVideoRenderingOutput | RafaAssistedGenerationOutput;

type AcceptedVideo = {
  request: RafaAssistedVideoRequest;
  sizeBytes: number;
  majorBrand: string;
  absolutePath: string;
  relativePath: string;
};

export type RafaIdGenerator = {
  create(prefix: string): string;
};

export type RafaVideoRenderingSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  artifactDelivery?: ArtifactDeliveryPort;
  /**
   * Opcional, como `artifactDelivery` — quando ausente, Rafa se comporta exatamente como antes
   * (100% Developer Assisted Mode). Quando presente, Rafa tenta renderizar localmente primeiro
   * (ver `attemptLocalRendering`) e só cai para o modo assistido se os assets explicitamente
   * pedidos por `localAssets` não existirem, ou se a renderização falhar.
   */
  videoRendering?: VideoRenderingPort;
  /**
   * Resolve automaticamente assets visuais reais por cena antes da renderização local. É opcional
   * para preservar compatibilidade; quando ausente, Rafa mantém o comportamento anterior.
   */
  visualAssetResolver?: VisualAssetResolverPort;
  /**
   * ASSET DIVERSITY GATE — perfil de qualidade sob o qual Rafa resolve assets visuais e decide
   * se a diversidade da execução é suficiente para renderizar (ver
   * `src/application/ports/asset-quality-profile.ts`). Ausente preserva o comportamento legado
   * (`"standard"`: limita repetição, mas nunca bloqueia a renderização).
   */
  assetQualityProfile?: AssetQualityProfile;
  /**
   * ASSET DIVERSITY GATE — raiz de `artifacts/` usada exclusivamente para MONTAR o
   * `expectedAbsolutePath` (texto informativo) dos pacotes de criação assistida gerados pelo
   * Diversity Gate — mesma raiz que `VisualAssetResolver` já recebe via `artifactsRootDir`. Rafa
   * nunca lê/escreve neste caminho diretamente (isso continua exclusivo de `ArtifactDeliveryPort`
   * e do próprio resolver); ausente apenas deixa o caminho absoluto informado menos preciso.
   */
  artifactsRootDir?: string;
  logger?: RafaLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: RafaIdGenerator;
  now?: () => Date;
};

class SequentialRafaIdGenerator implements RafaIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopRafaLogger implements RafaLoggerPort {
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
      throw new Error(`${portName} não configurado para Rafa.`);
    },
  });
}

export class RafaVideoRenderingSkill implements Skill<RafaVideoRenderingRequestInput, RafaSkillOutput> {
  readonly manifest = rafaVideoRenderingManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly artifactDelivery?: ArtifactDeliveryPort;
  private readonly videoRendering?: VideoRenderingPort;
  private readonly visualAssetResolver?: VisualAssetResolverPort;
  private readonly assetQualityProfile: AssetQualityProfile;
  private readonly artifactsRootDir: string;
  private readonly logger: RafaLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: RafaIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: RafaVideoRenderingSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.artifactDelivery = dependencies.artifactDelivery;
    this.videoRendering = dependencies.videoRendering;
    this.visualAssetResolver = dependencies.visualAssetResolver;
    this.assetQualityProfile = dependencies.assetQualityProfile ?? "standard";
    this.artifactsRootDir = dependencies.artifactsRootDir ?? "artifacts";
    this.logger = dependencies.logger ?? new NoopRafaLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialRafaIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<RafaVideoRenderingRequestInput>): Promise<SkillResponse<RafaSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de renderização de vídeo inválida.", request, { errors: validationErrors });
      await this.emit("VideoRenderingFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
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
      return await this.runRendering(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante a renderização de vídeo.";
      await this.log("Error", `Erro inesperado em Rafa. ${message}`, request, { error: message });
      await this.emit("VideoRenderingFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runRendering(request: SkillRequest<RafaVideoRenderingRequestInput>): Promise<SkillResponse<RafaSkillOutput>> {
    const startedAt = this.now().getTime();

    await this.log("RequestReceived", "Solicitação de renderização de vídeo recebida por Rafa.", request, {
      channel: request.input.channel,
      format: request.input.format,
      videoObjective: request.input.videoObjective,
    });
    await this.emit("VideoRenderingStarted", request, {
      channel: request.input.channel,
      videoObjective: request.input.videoObjective,
    });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("VideoRenderingFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
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
      requester: { id: this.manifest.id, type: "specialist", name: "Rafa" },
      clientId: tenant.clientId,
      modules: ["BrandContext", "IdentityContext", "PublishingContext"],
      reason: "Montagem do prompt técnico final de renderização a partir do plano de edição de Diego.",
    });

    await this.log("ContextConsulted", `Contexto consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });
    await this.emit("VideoRenderingContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    const completeness = evaluateContextCompleteness(claraContext);
    if (!completeness.sufficient) {
      await this.log("ContextIncomplete", "Contexto insuficiente na Clara para renderizar o vídeo com segurança.", request, {
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      await this.emit("VideoRenderingFailed", request, {
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

    const specs = buildVideoSpecs(request.input.diegoEditingPlan.totalDurationSeconds, request.input.channel, request.input.format);
    const finalPrompt = buildFinalVideoPrompt(request.input, specs, request.context.executionId);

    await this.log("PromptBuilt", "Prompt técnico final de renderização criado.", request, { clientId: tenant.clientId });
    await this.emit("VideoPromptBuilt", request, { clientId: tenant.clientId, prompt: finalPrompt, specs });

    let localRenderSkipReasons: string[] = [];
    if (this.videoRendering) {
      const localAttempt = await this.attemptLocalRendering({ request, tenant, claraContext, specs, finalPrompt, startedAt });
      if (localAttempt.response) return localAttempt.response;
      localRenderSkipReasons = localAttempt.skipReasons;
      if (localRenderSkipReasons.length > 0) {
        await this.log("LocalRenderingSkipped", "Renderização local automática não foi usada; caindo para Developer Assisted Mode.", request, {
          clientId: tenant.clientId,
          reasons: localRenderSkipReasons,
        });
      }
    }

    await this.log("RenderingStarted", "Renderização de vídeo iniciada em Developer Assisted Mode.", request, { clientId: tenant.clientId });

    const assistedResponse = await this.runAssistedGeneration({ request, tenant, finalPrompt, specs, startedAt });
    if (localRenderSkipReasons.length === 0) return assistedResponse;
    return { ...assistedResponse, warnings: [...assistedResponse.warnings, ...localRenderSkipReasons] };
  }

  /**
   * Tenta renderizar o vídeo localmente ANTES de cair no modo assistido (LOCAL_PRODUCTION prefere
   * renderização automática quando os assets pedidos existem). Só trata como "obrigatório" um
   * asset explicitamente referenciado por `request.input.localAssets` — sugestões em texto de
   * Bruno/Diego (`brollSuggestions`, `musicSuggestions`, `requiredAssets`) NUNCA são tratadas
   * como caminho de arquivo aqui. A logo (`IdentityContext.logoUri` da Clara) é sempre opcional:
   * sua ausência nunca bloqueia a renderização local, só gera um aviso (mesmo padrão que Bianca já
   * usa para imagens). Devolve `{ response }` em caso de sucesso (a chamar diretamente como
   * resultado de `execute`) ou `{ skipReasons }` para o chamador decidir cair no modo assistido.
   */
  private async attemptLocalRendering(input: {
    request: SkillRequest<RafaVideoRenderingRequestInput>;
    tenant: TenantClientContext;
    claraContext: ClaraContextResponse;
    specs: RafaVideoSpecs;
    finalPrompt: string;
    startedAt: number;
  }): Promise<{ response?: SkillResponse<RafaSkillOutput>; skipReasons: string[] }> {
    const { request, tenant, claraContext, specs, finalPrompt, startedAt } = input;

    if (!this.videoRendering || !this.artifactDelivery) return { skipReasons: [] };

    const timeline = request.input.diegoEditingPlan.editingTimeline;
    const localAssets = request.input.localAssets;
    const identity = latest(claraContext.modules.IdentityContext)?.payload;
    const brandColors = identity?.colors?.length ? identity.colors : DEFAULT_BRAND_COLORS;
    const logoUri = identity?.logoUri;

    const candidates = buildAssetCandidates({ timeline, localAssets, logoUri, noraNarration: request.input.noraNarration });
    const resolution = candidates.length > 0 ? await this.videoRendering.resolveAssets({ candidates }) : { resolutions: [] };
    const resolvedById = new Map(resolution.resolutions.map((entry) => [entry.id, entry]));

    const missingRequired = candidates.filter((candidate) => candidate.required && !resolvedById.get(candidate.id)?.resolved);
    if (missingRequired.length > 0) {
      const reasons = missingRequired.map((candidate) => {
        const resolved = resolvedById.get(candidate.id);
        const reason = resolved && !resolved.resolved ? resolved.reason : "não resolvido";
        return `Asset obrigatório ausente (${candidate.sourceDescription}): ${reason}`;
      });
      return { skipReasons: reasons };
    }

    const warnings: string[] = [];
    if (!identity?.colors?.length) {
      warnings.push("Nenhuma cor de marca registrada na Clara (IdentityContext.colors); usando paleta neutra padrão para a renderização local.");
    }
    if (!logoUri) {
      warnings.push("Nenhuma logo registrada na Clara (IdentityContext.logoUri); renderização local seguiu sem logo.");
    } else if (!resolvedById.get("logo")?.resolved) {
      const resolvedLogo = resolvedById.get("logo");
      const reason = resolvedLogo && !resolvedLogo.resolved ? resolvedLogo.reason : "não resolvida";
      warnings.push(`Logo registrada na Clara não pôde ser usada (${reason}); renderização local seguiu sem logo.`);
    }

    let visualAssets: VisualAssetResolved[] = [];
    let visualAssetReportPath: string | undefined;
    let diversityGate: ReturnType<typeof evaluateAssetDiversityGate> | undefined;
    let productionReadiness: ReturnType<typeof evaluateProductionReadiness> | undefined;
    // NARRATIVE TIMING REBALANCING — `effectiveTimeline` começa igual à timeline de Diego e só é
    // substituída por uma cópia com durações realocadas quando um plano de realocação válido é
    // encontrado (seção 14: a timeline original nunca é mutada, só substituída por uma cópia).
    let effectiveTimeline = timeline;
    if (this.visualAssetResolver) {
      const visualQueries = buildVisualAssetQueries({
        executionId: request.context.executionId,
        input: request.input,
        specs,
        timeline: effectiveTimeline,
        qualityProfile: this.assetQualityProfile,
      });
      let visualResolution = await this.visualAssetResolver.resolve({
        executionId: request.context.executionId,
        scenes: visualQueries,
      });

      // NARRATIVE TIMING REBALANCING (seção 16) — tentado ANTES de aceitar qualquer Shot pendente
      // por déficit temporal: déficit -> realocação -> recalcular composição -> nova resolução.
      // Só reexecuta `resolve()` quando um plano de realocação REAL foi encontrado (nunca às
      // cegas) — nenhuma Skill anterior (Bruno/Vanessa/Diego/Nora) é reexecutada.
      const timingDeficits = visualResolution.timingDeficits ?? [];
      if (timingDeficits.length > 0) {
        const rebalance = attemptTimingRebalance({ timeline: effectiveTimeline, timingDeficits });
        if (rebalance) {
          effectiveTimeline = rebalance.timeline;
          const rebalancedQueries = buildVisualAssetQueries({
            executionId: request.context.executionId,
            input: request.input,
            specs,
            timeline: effectiveTimeline,
            qualityProfile: this.assetQualityProfile,
          });
          visualResolution = await this.visualAssetResolver.resolve({
            executionId: request.context.executionId,
            scenes: rebalancedQueries,
          });
          warnings.push(`Narrative Timing Rebalancing aplicado: ${rebalance.records.map((record) => `${record.receiverShotId} recebeu de ${record.donorShotIds.join(", ")} (${record.reason})`).join(" | ")}`);
          if (rebalance.unresolvedShotIds.length > 0) {
            warnings.push(`TIMING_REBALANCE_NOT_POSSIBLE para: ${rebalance.unresolvedShotIds.join(", ")} — nenhum Shot doador válido encontrado; Developer Assisted Mode mantido para estes.`);
          }
          // Seção 14 — persistência auditável via a MESMA porta que qualquer outro artefato desta
          // execução usa (`ArtifactDeliveryPort`), nunca I/O bruto dentro da Skill.
          if (this.artifactDelivery) {
            await this.artifactDelivery.writeFile({
              executionId: request.context.executionId,
              relativePath: "visual-assets/timing-rebalance-report.json",
              content: JSON.stringify({ executionId: request.context.executionId, generatedAt: new Date().toISOString(), records: rebalance.records, unresolvedShotIds: rebalance.unresolvedShotIds }, null, 2),
              mimeType: "application/json",
            });
          }
        } else {
          warnings.push(`TIMING_REBALANCE_NOT_POSSIBLE para: ${timingDeficits.map((deficit) => deficit.shotId).join(", ")} — nenhum Shot doador válido encontrado; Developer Assisted Mode mantido.`);
        }
      }

      visualAssets = visualResolution.resolved;
      visualAssetReportPath = visualResolution.reportRelativePath;
      warnings.push(...visualResolution.warnings);

      // ASSET DIVERSITY GATE — mesmo quando o resolver conseguiu ALGUM asset para todo Shot
      // (`pending.length === 0`), a composição do vídeo INTEIRO ainda pode não atender ao perfil
      // de qualidade pedido (poucos arquivos físicos distintos, um asset dominando os Shots, 0
      // vídeo real, etc.). Avaliado depois do `pending` do resolver de propósito: só faz sentido
      // julgar diversidade sobre um conjunto de Shots já totalmente resolvido.
      diversityGate = evaluateAssetDiversityGate(visualAssets, this.assetQualityProfile);
      const diversityAssistedPackages = diversityGate.passed
        ? []
        : buildAssistedPackagesForFlaggedShots(diversityGate.flaggedShots, this.artifactsRootDir, request.context.executionId);

      // PRODUCTION READINESS — pergunta mais ampla que o Diversity Gate: não "este Shot tem um
      // arquivo aceitável?", mas "esta campanha inteira tem material real para virar um comercial
      // publicável?". Roda sempre, mesmo quando o Diversity Gate já passou, porque cobre sinais que
      // o gate não cobre (enquadramento/composição repetidos, mesmo casal/mockup reaproveitado em
      // qualquer ponto do vídeo, cobertura por função narrativa) e é a única fonte do Production
      // Plan e da nota composta reportados ao desenvolvedor e a Lucas.
      productionReadiness = evaluateProductionReadiness(visualAssets, visualResolution.pending, this.assetQualityProfile);
      const productionAssistedPackages = productionReadiness.blocked
        ? buildAssistedPackagesForFlaggedShots(productionReadiness.flaggedEntries, this.artifactsRootDir, request.context.executionId)
        : [];

      const allPending = [...visualResolution.pending, ...diversityAssistedPackages, ...productionAssistedPackages];

      // STANDARD (e qualquer perfil que não bloqueia): diversidade/readiness insuficiente vira
      // warning explícito na saída, nunca pausa a renderização — só PREMIUM bloqueia.
      if (diversityGate.failures.length > 0 && diversityAssistedPackages.length === 0) {
        warnings.push(`Diversidade visual abaixo do ideal para o perfil "${this.assetQualityProfile}" (não bloqueante): ${diversityGate.failures.join(" ")}`);
      }
      if (!productionReadiness.score.meetsMinimum && !productionReadiness.blocked) {
        warnings.push(`Production Readiness em ${Math.round(productionReadiness.score.overall * 100)}%, abaixo do mínimo aceitável de ${Math.round(productionReadiness.requirements.minProductionReadiness * 100)}% para o perfil "${this.assetQualityProfile}" (não bloqueante).`);
      }

      if (allPending.length > 0) {
        const resumeCommand = buildAssistedResumeCommand(request.context.executionId);
        await this.log("AssistedGenerationRequested", `Rafa aguarda ${allPending.length} asset(s) visual(is) real(is).`, request, {
          clientId: tenant.clientId,
          pendingVisualAssets: allPending.map((asset) => asset.expectedRelativePath),
          visualAssetReportPath,
          diversityGatePassed: diversityGate.passed,
          diversityGateFailures: diversityGate.failures,
          productionReadinessBlocked: productionReadiness.blocked,
          productionReadinessScore: productionReadiness.score.overall,
        });
        await this.emit("VideoRenderingAwaitingAssistedInput", request, {
          clientId: tenant.clientId,
          pendingVisualAssets: allPending.map((asset) => asset.expectedRelativePath),
          visualAssetReportPath,
          diversityGatePassed: diversityGate.passed,
          productionReadinessBlocked: productionReadiness.blocked,
        });

        const instructionParts = [
          "Crie os assets visuais reais abaixo e salve exatamente nos caminhos indicados.",
          diversityAssistedPackages.length > 0 ? `Diversidade visual insuficiente para o perfil "${this.assetQualityProfile}": ${diversityGate.failures.join(" ")}` : undefined,
          productionReadiness.blocked ? productionReadiness.blockExplanation : undefined,
          "Depois retome o workflow para Rafa renderizar o vídeo localmente com esses arquivos.",
        ];
        const instruction = instructionParts.filter(Boolean).join("\n\n");

        return {
          response: {
            skillId: this.manifest.id,
            taskId: request.context.taskId,
            status: "needs_assisted_generation",
            output: {
              mode: "developer_assisted",
              instruction,
              pendingVideos: [],
              pendingVisualAssets: allPending,
              resumeCommand,
              diversitySummary: diversityAssistedPackages.length > 0 ? {
                qualityProfile: this.assetQualityProfile,
                passed: diversityGate.passed,
                failures: diversityGate.failures,
                totalShots: diversityGate.metrics.totalShots,
                distinctPhysicalFiles: diversityGate.metrics.distinctPhysicalFiles,
                minDistinctPhysicalFiles: diversityGate.requirements.minDistinctPhysicalFiles,
                videoRatio: diversityGate.metrics.videoRatio,
                minVideoRatio: diversityGate.requirements.minVideoRatio,
              } : undefined,
              productionPlan: productionReadiness.blocked ? productionReadiness.plan : undefined,
              productionReadinessScore: productionReadiness.blocked ? productionReadiness.score : undefined,
            },
            artifacts: [],
            warnings,
          },
          skipReasons: [],
        };
      }
    } else {
      warnings.push("Nenhum VisualAssetResolverPort configurado; renderização local preservou o comportamento legado com fundos gerados por código quando não há imagem explícita.");
    }

    const { scenes, assets, audioTracks, textSuggestionWarnings, audioSummary, motionSummary } = buildRenderPlan({
      timeline: effectiveTimeline,
      brandColors,
      resolvedById,
      candidates,
      visualAssets,
      noraNarration: request.input.noraNarration,
      brunoScenes: request.input.brunoScript.scenes,
    });
    warnings.push(...textSuggestionWarnings);
    if (!localAssets?.musicTrackPath) {
      warnings.push(
        request.input.noraNarration
          ? "Nenhuma música local informada (use --music \"<caminho>\" para incluir uma trilha sonora); vídeo renderizado com narração, mas sem trilha musical."
          : "Nenhuma música local informada (use --music \"<caminho>\" para incluir uma trilha sonora); vídeo renderizado sem áudio.",
      );
    }

    const renderRequest: VideoRenderRequest = {
      executionId: request.context.executionId,
      outputRelativePath: "videos/final-video.mp4",
      width: specs.width,
      height: specs.height,
      fps: specs.fps,
      totalDurationSeconds: specs.durationSeconds,
      scenes,
      assets,
      audioTracks,
      assetQualityProfile: this.assetQualityProfile,
      assetDiversitySnapshot: diversityGate && {
        distinctAssetIds: diversityGate.metrics.distinctAssetIds,
        distinctPhysicalFiles: diversityGate.metrics.distinctPhysicalFiles,
        physicalFileHashes: diversityGate.metrics.physicalFileHashes,
        reuseRatio: diversityGate.metrics.reuseRatio,
        maxUsagePerPhysicalFile: diversityGate.metrics.maxUsagePerPhysicalFile,
        consecutiveReuseViolations: diversityGate.metrics.consecutiveReuseViolations,
        videoRatio: diversityGate.metrics.videoRatio,
        humanAssetCount: diversityGate.metrics.humanAssetCount,
        productAssetCount: diversityGate.metrics.productAssetCount,
        contextAssetCount: diversityGate.metrics.contextAssetCount,
        diversityGatePassed: diversityGate.passed,
        diversityGateFailures: diversityGate.failures,
      },
    };

    let renderResult: VideoRenderResult;
    try {
      renderResult = await this.videoRendering.render(renderRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido na renderização local.";
      await this.log("LocalRenderingFailed", message, request, { clientId: tenant.clientId });
      await this.emit("VideoRenderingAwaitingAssistedInput", request, { clientId: tenant.clientId, reason: "LOCAL_RENDERING_FAILED" });
      return { skipReasons: [`Renderização local falhou: ${message}`] };
    }

    const readBack = await this.artifactDelivery.readFile({
      executionId: request.context.executionId,
      relativePath: renderResult.relativePath,
    });
    if (!readBack) {
      return { skipReasons: ["Renderização local reportou sucesso, mas o arquivo não foi encontrado ao reler pela ArtifactDeliveryPort."] };
    }
    const validation = validateMp4Bytes(readBack.data, renderResult.relativePath);
    if (!validation.valid) {
      return { skipReasons: [`Arquivo renderizado localmente não passou na validação de MP4 real: ${validation.reason}`] };
    }

    await this.log("LocalRenderingCompleted", "Renderização local automática concluída e validada.", request, {
      clientId: tenant.clientId,
      relativePath: readBack.relativePath,
      sizeBytes: readBack.sizeBytes,
      renderTimeMs: renderResult.renderTimeMs,
    });

    const accepted: AcceptedVideo = {
      request: {
        index: 0,
        fileName: "final-video.mp4",
        expectedRelativePath: renderResult.relativePath,
        mimeType: "video/mp4",
        specs,
        prompt: finalPrompt,
      },
      sizeBytes: readBack.sizeBytes,
      majorBrand: validation.majorBrand,
      absolutePath: readBack.absolutePath,
      relativePath: readBack.relativePath,
    };

    const finalizedSpecs: RafaVideoSpecs = {
      ...specs,
      width: renderResult.width,
      height: renderResult.height,
      durationSeconds: renderResult.durationSeconds,
      fps: renderResult.fps,
      videoCodec: renderResult.videoCodec,
      audioCodec: renderResult.audioCodec,
      hasAudio: renderResult.hasAudio,
    };

    const response = await this.finalizeRendering({
      request,
      tenant,
      finalPrompt,
      specs: finalizedSpecs,
      startedAt,
      accepted,
      validationWarnings: [...warnings, ...renderResult.warnings],
      generationMode: "local_render",
      renderTimeMs: renderResult.renderTimeMs,
      renderLogsSummary: renderResult.logsSummary,
      audioSummary: {
        applied: audioSummary.applied,
        source: audioSummary.source,
        filename: audioSummary.filename,
        narrationApplied: audioSummary.narrationApplied,
        narrationSource: audioSummary.narrationSource,
        narrationFilename: audioSummary.narrationFilename,
        narrationDuration: audioSummary.narrationDuration,
        musicDuckingApplied: audioSummary.musicDuckingApplied,
        codec: finalizedSpecs.audioCodec,
        durationSeconds: audioSummary.applied ? finalizedSpecs.durationSeconds : undefined,
      },
      visualAssets,
      visualAssetReportPath,
      motionSummary,
      productionReadiness,
    });

    return { response, skipReasons: [] };
  }

  /**
   * "Developer Assisted Mode" para vídeo, no mesmo espírito do Pedro: Rafa nunca chama nenhum
   * provider ou API externa de vídeo. Monta o prompt técnico e o caminho exato onde o vídeo deve
   * ser salvo, verifica se o arquivo já existe em disco (via `ArtifactDeliveryPort.readFile`,
   * nunca via `child_process` ou qualquer comando externo), valida como um MP4 real e plausível,
   * e só então continua o fluxo. Enquanto o arquivo esperado não existir (ou não for válido),
   * devolve `needs_assisted_generation` para que Caio pause o workflow até a retomada.
   */
  private async runAssistedGeneration(input: {
    request: SkillRequest<RafaVideoRenderingRequestInput>;
    tenant: TenantClientContext;
    finalPrompt: string;
    specs: RafaVideoSpecs;
    startedAt: number;
  }): Promise<SkillResponse<RafaSkillOutput>> {
    const { request, tenant, finalPrompt, specs, startedAt } = input;

    if (!this.artifactDelivery) {
      const message = "Rafa exige ArtifactDeliveryPort configurada para verificar o vídeo salvo em disco.";
      await this.log("Error", message, request, { clientId: tenant.clientId });
      await this.emit("VideoRenderingFailed", request, { reason: "ASSISTED_MODE_REQUIRES_ARTIFACT_DELIVERY", clientId: tenant.clientId });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: { code: "ASSISTED_MODE_REQUIRES_ARTIFACT_DELIVERY", message, recoverable: false },
      };
    }

    const expectedVideos = buildAssistedVideoRequests(finalPrompt, specs);
    const pendingVideos: RafaAssistedVideoRequest[] = [];
    const validationWarnings: string[] = [];
    let acceptedVideo: AcceptedVideo | undefined;

    for (const expected of expectedVideos) {
      const existing = await this.artifactDelivery.readFile({
        executionId: request.context.executionId,
        relativePath: expected.expectedRelativePath,
      });

      if (!existing) {
        pendingVideos.push(expected);
        continue;
      }

      const validation = validateMp4Bytes(existing.data, expected.expectedRelativePath);
      if (!validation.valid) {
        await this.log("AssistedVideoValidationFailed", `Arquivo em ${expected.expectedRelativePath} não é um vídeo válido: ${validation.reason}`, request, {
          clientId: tenant.clientId,
          relativePath: expected.expectedRelativePath,
          reason: validation.reason,
        });
        validationWarnings.push(`${expected.expectedRelativePath}: ${validation.reason}`);
        pendingVideos.push(expected);
        continue;
      }

      await this.log("AssistedVideoAccepted", `Vídeo assistido validado em ${expected.expectedRelativePath}.`, request, {
        clientId: tenant.clientId,
        relativePath: expected.expectedRelativePath,
        sizeBytes: existing.sizeBytes,
        majorBrand: validation.majorBrand,
      });

      acceptedVideo = {
        request: expected,
        sizeBytes: existing.sizeBytes,
        majorBrand: validation.majorBrand,
        absolutePath: existing.absolutePath,
        relativePath: existing.relativePath,
      };
    }

    if (pendingVideos.length > 0 || !acceptedVideo) {
      const resumeCommand = buildAssistedResumeCommand(request.context.executionId);
      await this.log("AssistedGenerationRequested", `Rafa aguarda intervenção assistida para ${pendingVideos.length} vídeo(s).`, request, {
        clientId: tenant.clientId,
        pendingCount: pendingVideos.length,
        paths: pendingVideos.map((video) => video.expectedRelativePath),
      });
      await this.emit("VideoRenderingAwaitingAssistedInput", request, {
        clientId: tenant.clientId,
        pendingCount: pendingVideos.length,
        paths: pendingVideos.map((video) => video.expectedRelativePath),
      });

      const output: RafaAssistedGenerationOutput = {
        mode: "developer_assisted",
        instruction: "Renderize o vídeo usando este prompt e salve neste caminho exato.",
        pendingVideos,
        resumeCommand,
      };

      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "needs_assisted_generation",
        output,
        artifacts: [],
        warnings: validationWarnings,
      };
    }

    return this.finalizeRendering({ request, tenant, finalPrompt, specs, startedAt, accepted: acceptedVideo, validationWarnings, generationMode: "developer_assisted" });
  }

  private async finalizeRendering(input: {
    request: SkillRequest<RafaVideoRenderingRequestInput>;
    tenant: TenantClientContext;
    finalPrompt: string;
    specs: RafaVideoSpecs;
    startedAt: number;
    accepted: AcceptedVideo;
    validationWarnings: string[];
    generationMode: RafaVideoRenderingOutput["generationMode"];
    renderTimeMs?: number;
    renderLogsSummary?: string[];
    audioSummary?: {
      applied: boolean;
      source?: string;
      filename?: string;
      narrationApplied?: boolean;
      narrationSource?: string;
      narrationFilename?: string;
      narrationDuration?: number;
      musicDuckingApplied?: boolean;
      codec?: string;
      durationSeconds?: number;
    };
    visualAssets?: VisualAssetResolved[];
    visualAssetReportPath?: string;
    motionSummary?: RafaVideoMotionSummary;
    productionReadiness?: ReturnType<typeof evaluateProductionReadiness>;
  }): Promise<SkillResponse<RafaSkillOutput>> {
    const { request, tenant, finalPrompt, specs, startedAt, accepted, generationMode } = input;
    const warnings = [...input.validationWarnings];
    const isLocalRender = generationMode === "local_render";
    const audioSummary = input.audioSummary ?? { applied: false };

    const video: RafaGeneratedVideo = {
      id: this.idGenerator.create("video"),
      index: accepted.request.index,
      fileName: accepted.request.fileName,
      mimeType: accepted.request.mimeType,
      extension: "mp4",
      specs,
      sizeBytes: accepted.sizeBytes,
      majorBrand: accepted.majorBrand,
      uri: accepted.relativePath,
      relativePath: accepted.relativePath,
      downloadHref: accepted.relativePath,
      localPath: accepted.absolutePath,
      prompt: accepted.request.prompt,
      motionSummary: input.motionSummary,
      audioApplied: audioSummary.applied,
      narrationApplied: audioSummary.narrationApplied,
      musicDuckingApplied: audioSummary.musicDuckingApplied,
      narrationDuration: audioSummary.narrationDuration,
      productionPlan: input.productionReadiness?.plan,
      productionReadinessScore: input.productionReadiness?.score,
    };

    const artifact: SkillArtifact = {
      id: this.idGenerator.create("artifact"),
      type: "video",
      name: isLocalRender ? "Vídeo final gerado por Rafa (renderização local automática)" : "Vídeo final gerado por Rafa (intervenção assistida)",
      status: "ready",
      uri: video.uri,
      file: {
        mimeType: video.mimeType,
        extension: video.extension,
        sizeBytes: video.sizeBytes,
        localPath: video.localPath,
      },
      dimensions: {
        width: specs.width,
        height: specs.height,
        aspectRatio: specs.aspectRatio,
      },
      generation: {
        prompt: video.prompt,
        provider: isLocalRender ? "local-render" : "developer-assisted",
        model: isLocalRender ? "zuno-video-rendering-port" : "claude-code-developer-assisted",
        cost: { estimated: 0, actual: 0, currency: "USD" },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: input.renderTimeMs ?? Math.max(0, this.now().getTime() - startedAt),
      },
      metadata: {
        clientId: tenant.clientId,
        channel: request.input.channel,
        durationSeconds: specs.durationSeconds,
        majorBrand: accepted.majorBrand,
      },
    };

    await this.log("ArtifactCreated", "Artefato de vídeo criado após validação do arquivo real.", request, {
      clientId: tenant.clientId,
      artifactId: artifact.id,
      sizeBytes: video.sizeBytes,
      relativePath: video.relativePath,
      generationMode,
    });
    await this.emit("VideoArtifactCreated", request, {
      clientId: tenant.clientId,
      artifactId: artifact.id,
      relativePath: video.relativePath,
      generationMode,
    });

    const executionDurationMs = Math.max(0, this.now().getTime() - startedAt);
    const observations = buildObservations(this.artifactDelivery, generationMode);
    const nextSteps = buildNextSteps(generationMode);
    const creativeDna = deriveCampaignCreativeDNA({
      originalRequest: request.input.originalRequest,
      centralPromise: request.input.joaoStrategy.centralPromise,
      valueProposition: request.input.joaoStrategy.valueProposition,
      toneOfVoice: request.input.joaoStrategy.toneOfVoice,
      targetAudience: request.input.joaoStrategy.targetAudience,
      keyMessages: request.input.joaoStrategy.keyMessages,
    });

    const output: RafaVideoRenderingOutput = {
      generationSummary: isLocalRender
        ? `Vídeo final renderizado automaticamente em modo local para o canal ${request.input.channel} no formato ${request.input.format}.`
        : `Vídeo final confirmado(s) via intervenção assistida para o canal ${request.input.channel} no formato ${request.input.format}.`,
      finalPrompt,
      expectedRelativePath: accepted.request.expectedRelativePath,
      specs,
      requiredAssets: request.input.diegoEditingPlan.requiredAssets,
      renderingInstructions: buildRenderingInstructions(specs, creativeDna),
      video,
      generationMode,
      executionDurationMs,
      warnings,
      observations,
      nextSteps,
      renderTimeMs: input.renderTimeMs,
      renderLogsSummary: input.renderLogsSummary,
      audioApplied: audioSummary.applied,
      musicSource: audioSummary.source,
      musicFilename: audioSummary.filename,
      narrationApplied: audioSummary.narrationApplied,
      narrationSource: audioSummary.narrationSource,
      narrationFilename: audioSummary.narrationFilename,
      narrationDuration: audioSummary.narrationDuration,
      musicDuckingApplied: audioSummary.musicDuckingApplied,
      audioCodec: audioSummary.codec,
      audioDuration: audioSummary.durationSeconds,
      visualAssets: input.visualAssets,
      visualAssetReportPath: input.visualAssetReportPath,
      motionSummary: input.motionSummary,
      creativeDna,
      productionPlan: input.productionReadiness?.plan,
      productionReadinessScore: input.productionReadiness?.score,
    };

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "completed",
      output,
      artifacts: [artifact],
      warnings,
    };
  }

  private async resolveClient(input: RafaVideoRenderingRequestInput): Promise<TenantClientContext> {
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
    action: RafaLogAction,
    message: string,
    request: SkillRequest<RafaVideoRenderingRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("rafa-log"),
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

  private async emit(name: ZunoEventName, request: SkillRequest<RafaVideoRenderingRequestInput>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "rafa",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: RafaVideoRenderingRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de renderização de vídeo é obrigatória."];
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
  if (
    !input.diegoEditingPlan ||
    typeof input.diegoEditingPlan !== "object" ||
    !Array.isArray(input.diegoEditingPlan.editingTimeline) ||
    input.diegoEditingPlan.editingTimeline.length === 0
  ) {
    errors.push("diegoEditingPlan é obrigatório e precisa conter ao menos um trecho de timeline.");
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

/**
 * A resolução/proporção vem da autoridade única compartilhada por canal/formato
 * (`resolveAspectRatio`/`resolutionForAspectRatio`, ver `src/shared/utils/aspect-ratio.ts`), a
 * mesma que Sofia/Pedro/Bianca já usam para imagens — cobre 9:16 (Reels/Stories/TikTok/Shorts),
 * 4:5 (feed vertical) e 1:1 (feed quadrado). `channel`/`format` são opcionais só para preservar
 * compatibilidade com chamadas antigas (assumem "instagram"/"reels", ou seja, 9:16, como antes).
 * `durationSeconds` vem diretamente do roteiro real de Bruno (via
 * `diegoEditingPlan.totalDurationSeconds`), nunca inventado por Rafa. `audioCodec: "AAC"` é o
 * valor pedido no prompt técnico para o Developer Assisted Mode — no modo de renderização local
 * automática, o `audioCodec`/`hasAudio` reais (que podem não ter trilha) vêm de
 * `VideoRenderResult`, não desta função.
 */
export function buildVideoSpecs(durationSeconds: number, channel: string = "instagram", format: string = "reels"): RafaVideoSpecs {
  const aspectRatio = resolveAspectRatio(channel, format);
  const { width, height } = resolutionForAspectRatio(aspectRatio);
  return {
    format: "mp4",
    width,
    height,
    resolution: `${width}x${height}`,
    aspectRatio,
    durationSeconds,
    fps: 30,
    videoCodec: "H.264 (libx264)",
    audioCodec: "AAC",
  };
}

export function buildFinalVideoPrompt(input: RafaVideoRenderingRequestInput, specs: RafaVideoSpecs, executionId: string): string {
  return [
    "Você é o renderizador de vídeo do Zuno, operado por Rafa, Especialista em Renderização/Geração de Vídeo — um renderizador de motion graphics, não apenas um montador de cenas estáticas.",
    "Renderizar somente o vídeo final. Não criar roteiro, não dirigir vídeo, não editar conceitualmente — siga exatamente o plano técnico de edição de Diego, incluindo `editingTimeline[].editingDecision` (corte, transição, zoom/pan/push-in/pull-out, animação de texto, easing) e `musicTrack`/`selectedSoundEffects` (trilha e efeitos sonoros locais já selecionados).",
    "Sua função é traduzir um plano de edição já aprovado em um arquivo de vídeo real, com movimento contínuo (nunca um slideshow estático, mesmo partindo só de imagens), pronto para revisão humana.",
    "Não chamar nenhuma API externa de vídeo nem de áudio; o vídeo deve ser produzido/renderizado localmente e salvo no caminho exato informado, usando apenas arquivos de áudio locais.",
    "Renderizar somente campos explicitamente públicos da timeline (`publicVisibleText`, `publicSubtitle`, `onScreenText` já sanitizado e `captionText` já sanitizado). Nunca renderizar notas internas, justificativas, objetivo narrativo, observações de estratégia, instruções de direção ou instruções técnicas.",
    "",
    "ESPECIFICAÇÕES TÉCNICAS OBRIGATÓRIAS:",
    JSON.stringify(specs, null, 2),
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
    "PLANO TÉCNICO DE EDIÇÃO DE DIEGO (timeline, cortes, legendas, transições, efeitos, trilha, assets, instruções, checklist):",
    JSON.stringify(input.diegoEditingPlan, null, 2),
    "",
    ...(input.noraNarration
      ? [
          "PLANO DE NARRAÇÃO DE NORA (voz real, segmentos, pausas, ênfases, pronúncias e arquivo de áudio):",
          JSON.stringify(input.noraNarration, null, 2),
          "",
          "REGRAS DE MIXAGEM COM NARRAÇÃO:",
          [
            "- voz sempre em primeiro plano;",
            "- música deve fazer ducking durante fala;",
            "- efeitos sonoros permanecem discretos e não cobrem a voz;",
            "- reduzir texto visual quando a fala já comunica a mensagem;",
            "- não repetir integralmente a narração na tela.",
          ].join("\n"),
          "",
        ]
      : []),
    "RESTRIÇÕES NEGATIVAS:",
    [
      "- não alterar a timeline, cortes, duração de cada trecho, legendas ou textos na tela definidos por Diego;",
      "- não alterar enquadramento, composição, movimento de câmera, luz ou cor definidos por Vanessa;",
      "- não alterar o texto falado, texto na tela ou estrutura narrativa definidos por Bruno;",
      "- não renderizar `strategyNotes`, `narrativePurpose`, `directionNotes`, `editorNotes`, `internalDescription`, `technicalJustification`, observações internas ou qualquer texto de planejamento;",
      "- não usar logo como fundo abstrato, não deformar marca, não ampliar símbolo pixelado e não criar ornamentos circulares com a marca;",
      "- não publicar o vídeo em nenhuma rede social;",
      "- não chamar nenhum provider ou API externa de geração de vídeo.",
    ].join("\n"),
    "",
    "CAMINHO EXATO ONDE O ARQUIVO FINAL DEVE SER SALVO:",
    `artifacts/${executionId}/videos/final-video.mp4`,
    "",
    "FORMATO OBRIGATÓRIO DE ENTREGA:",
    "Um único arquivo de vídeo MP4 real, com o codec de vídeo e áudio especificados acima, salvo exatamente no caminho informado — nunca um arquivo placeholder, vazio ou fake.",
  ].join("\n");
}

/**
 * Monta a lista de vídeos esperados para o modo assistido: nesta primeira versão sempre há
 * exatamente uma variação (`videos/final-video.mp4`), mas a função devolve uma lista — não um
 * único objeto — para comportar múltiplas variações futuras (ex.: cortes alternativos) sem
 * quebra de contrato.
 */
function buildAssistedVideoRequests(finalPrompt: string, specs: RafaVideoSpecs): RafaAssistedVideoRequest[] {
  const fileName = "final-video.mp4";
  return [
    {
      index: 0,
      fileName,
      expectedRelativePath: `videos/${fileName}`,
      mimeType: "video/mp4",
      specs,
      prompt: finalPrompt,
    },
  ];
}

function buildAssistedResumeCommand(executionId: string): string {
  return `npm run zuno -- --continue ${executionId}`;
}

const MP4_MIN_SIZE_BYTES = 100 * 1024;

type Mp4ValidationResult =
  | { valid: true; majorBrand: string }
  | { valid: false; reason: string };

/**
 * Valida que os bytes recebidos são um MP4 real e plausível — não apenas qualquer arquivo salvo
 * com extensão .mp4. Verifica a caixa `ftyp` (bytes 4-7 do arquivo, presente em todo container
 * ISO Base Media/MP4 real, sem nenhuma dependência externa) e rejeita arquivos pequenos demais
 * para serem um vídeo real, para que o modo assistido nunca aceite um placeholder como se fosse
 * o vídeo real pedido. Não faz parsing completo de metadados (duração/resolução reais exigiriam
 * um parser MP4 completo, fora do escopo desta primeira versão — ver limitações no relatório
 * técnico); a duração/resolução usadas no restante do fluxo vêm do plano de Diego, não do arquivo.
 */
function validateMp4Bytes(bytes: Uint8Array, relativePath: string): Mp4ValidationResult {
  if (!relativePath.toLowerCase().endsWith(".mp4")) {
    return { valid: false, reason: `extensão inválida: esperado .mp4, recebido "${relativePath}".` };
  }
  if (bytes.byteLength < MP4_MIN_SIZE_BYTES) {
    return {
      valid: false,
      reason: `arquivo com ${bytes.byteLength} byte(s) é pequeno demais para ser um vídeo real (mínimo ${MP4_MIN_SIZE_BYTES} bytes) — parece um placeholder, não um vídeo gerado de verdade.`,
    };
  }

  const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (box !== "ftyp") {
    return { valid: false, reason: "assinatura de arquivo não corresponde a um MP4 válido (caixa 'ftyp' ausente)." };
  }

  const majorBrand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).trim();
  return { valid: true, majorBrand };
}

function buildRenderingInstructions(specs: RafaVideoSpecs, creativeDna: CampaignCreativeDNA): string[] {
  return [
    `Exportar em ${specs.format.toUpperCase()} (${specs.videoCodec} / ${specs.audioCodec}), resolução ${specs.resolution}, ${specs.fps}fps.`,
    "Aplicar exatamente a timeline, cortes, transições e efeitos definidos por Diego, sem alterações.",
    `Verificar que a duração final bate com os ${specs.durationSeconds} segundos do roteiro antes de exportar.`,
    "Salvar o arquivo exatamente no caminho esperado informado no prompt.",
    `Calibrar intensidade visual (motion, cor, luz) pelo Creative DNA — mood: ${creativeDna.heroColorMood}; ritmo: ${creativeDna.narrativePace}.`,
  ];
}

function buildObservations(artifactDelivery: ArtifactDeliveryPort | undefined, generationMode: RafaVideoRenderingOutput["generationMode"]): string[] {
  const observations: string[] = [];
  if (!artifactDelivery) {
    observations.push("Nenhuma ArtifactDeliveryPort configurada; Rafa não conseguiu verificar nem registrar o vídeo final.");
  }
  if (generationMode === "local_render") {
    observations.push(
      "Renderização local automática: cobre exclusivamente motion graphics (fundos, texto, legendas, CTA, logo, transições simples, zoom/pan suaves) — nunca filmagem real ou geração de vídeo por IA.",
    );
  } else {
    observations.push(
      "Rafa não realiza parsing completo de metadados de vídeo (duração/resolução reais do arquivo); a duração usada no fluxo vem do plano de edição de Diego, não do arquivo renderizado.",
    );
  }
  return observations;
}

function buildNextSteps(generationMode: RafaVideoRenderingOutput["generationMode"]): string[] {
  const steps = ["Validar o vídeo final com o time de marca antes de qualquer uso.", "Encaminhar para revisão de qualidade antes de qualquer publicação.", "Nenhuma publicação deve ocorrer sem aprovação humana."];
  if (generationMode === "local_render") {
    steps.unshift("Se o roteiro pedir filmagem real (pessoas, produto físico), substituir este motion graphics pelo vídeo real antes de publicar.");
  }
  return steps;
}

export function createRafaVideoRenderingSkill(
  dependencies: Partial<RafaVideoRenderingSkillDependencies> = {},
): RafaVideoRenderingSkill {
  return new RafaVideoRenderingSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    artifactDelivery: dependencies.artifactDelivery,
    videoRendering: dependencies.videoRendering,
    visualAssetResolver: dependencies.visualAssetResolver,
    assetQualityProfile: dependencies.assetQualityProfile,
    artifactsRootDir: dependencies.artifactsRootDir,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
  });
}

const DEFAULT_BRAND_COLORS = ["#2B2B2B", "#FFFFFF"];

type LocalAssetCandidate = VideoAssetCandidate & { sceneOrder?: number };

function buildVisualAssetQueries(input: {
  executionId: string;
  input: RafaVideoRenderingRequestInput;
  specs: RafaVideoSpecs;
  timeline: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"];
  qualityProfile: AssetQualityProfile;
}): VisualAssetSearchQuery[] {
  const vanessaByOrder = new Map(input.input.vanessaDirection.sceneDirections.map((direction) => [direction.order, direction]));
  const brunoByOrder = new Map(input.input.brunoScript.scenes.map((scene) => [scene.order, scene]));
  let developmentBeatIndex = 0;
  // SHOT-LEVEL ASSET RESOLUTION — todas as queries geradas até agora nesta execução (todos os
  // Shots já visitados). O resolver usa este conjunto como `forbidAssetIds` implícito ao
  // processar cada nova query, forçando diversidade ao longo do vídeo todo (não só entre Shots
  // vizinhos da mesma cena). Ver `visual-asset-resolver.ts`.
  const allQueries: VisualAssetSearchQuery[] = [];
  for (const entry of input.timeline) {
    const isDevelopment = entry.name.startsWith("Desenvolvimento");
    const beatIndex = isDevelopment ? developmentBeatIndex++ : 0;
    const direction = vanessaByOrder.get(entry.order);
    const requirement = entry.visualAssetRequirement ?? direction?.visualAssetRequirement;
    const sceneDesign = entry.visualSceneDesign ?? direction?.visualSceneDesign;
    const assetPriority = requirement?.assetPriority ?? sceneDesign?.assetPriority;
    const rawRequirementTags = requirement?.tags ?? [];
    const isOverviewScene = rawRequirementTags.map(normalizeText).includes("overview");
    const requiredTags = normalizeTags([
      ...(requirement?.tags ?? []),
      ...tagsForAssetPriority(assetPriority),
      ...inferVisualTags(`${entry.name} ${entry.onScreenText ?? ""} ${entry.captionText} ${requirement?.whatShouldAppear ?? ""}`),
    ]).filter((tag) => !isOverviewScene || !SPECIFIC_FEATURE_TAGS_FOR_ASSET_QUERY.includes(tag));
    const requiresProductAsset = requiredTags.some((tag) => ["produto-real", "mockup", "mockup-produto", "interface", "screenshot", "rsvp", "presentes", "album", "cronograma", "site"].includes(tag));
    const baseQuery: VisualAssetSearchQuery = {
      executionId: input.executionId,
      sceneOrder: entry.order,
      sceneName: entry.name,
      theme: [
        requirement?.whatShouldAppear,
        sceneDesign?.mainElement,
        sceneDesign?.secondaryElement,
      ].filter(Boolean).join(" | ") || entry.onScreenText || entry.captionText,
      emotion: requirement?.emotion ?? input.input.joaoStrategy.toneOfVoice ?? "confiança",
      narrativeFunction: requirement?.narrativeFunction ?? entry.name,
      desiredKind: kindForAssetPriority(assetPriority, requirement?.imageType),
      framing: requirement?.framing ?? direction?.framing,
      movement: requirement?.movement ?? direction?.cameraMovement,
      lighting: requirement?.lighting ?? input.input.vanessaDirection.lightDirection,
      composition: sceneDesign?.composition ?? direction?.visualComposition,
      requiredTags,
      forbiddenTags: requiresProductAsset ? ["vela", "velas", "relogio", "relógio", "caixa", "camera", "câmera", "decoracao", "decoração", "generico", "genérico"] : undefined,
      targetWidth: input.specs.width,
      targetHeight: input.specs.height,
      targetAspectRatio: input.specs.aspectRatio,
      brandKeywords: ["Rumo ao Altar", "casamento", "noivos"],
      // Narrativa audiovisual em sequência (ver VisualAssetResolver), nunca só uma imagem isolada:
      // cada cena pede os papéis de sequência que fazem sentido pra sua posição na narrativa.
      // Gancho estabelece + conecta; cada beat de desenvolvimento pede uma combinação diferente
      // (nunca a mesma dos vizinhos); CTA final é só o encerramento (1 asset — o end card).
      sequenceRoles: sequenceRolesFor(entry.name, isDevelopment, beatIndex, entry.durationSeconds),
      // ASSET DIVERSITY GATE — herdado por todo Shot desta cena via `{...baseQuery}` em
      // `buildShotQuery`; o resolver usa isto para nunca aplicar `shot_reuse_fallback` em premium.
      qualityProfile: input.qualityProfile,
    };

    // SHOT-LEVEL ASSET RESOLUTION — quando a cena tem shotTimeline (SHOT RENDER ENGINE), expande
    // em N queries por Shot com `shotId`/`shotOrder`/`shotPurpose` preenchidos e `forbidAssetIds`
    // acumulado (todos os assets já resolvidos até este Shot). O resolver processa cada query
    // individualmente e devolve exatamente 1 asset por Shot — nunca herda o asset da cena.
    // Quando a cena não tem shotTimeline (execução legada), cai no modo cena (1 query/cena) para
    // preservar backward compat.
    const brunoScene = brunoByOrder.get(entry.order);
    const shotsInEntry = entry.shotTimeline;
    if (shotsInEntry && shotsInEntry.length > 0) {
      for (const diegoShot of shotsInEntry) {
        const brunoShot = brunoScene?.shots?.find((s) => s.id === diegoShot.shotId);
        allQueries.push(buildShotQuery({
          baseQuery,
          diegoShot,
          brunoShot,
          forbidAssetIds: buildForbidAssetIdsForShot(allQueries),
        }));
      }
    } else {
      allQueries.push(baseQuery);
    }
  }
  return allQueries;
}

/**
 * SHOT-LEVEL ASSET RESOLUTION — constrói a query específica de um Shot, herdando a base da
 * cena e ajustando: (a) `shotId`/`shotOrder`/`shotPurpose` ecoados; (b) `desiredKind` derivado
 * do `preferredMediaKind` que Diego/Bruno já decidiram para o Shot; (c) `requiredTags` refinadas
 * pelas tags do próprio Shot (nunca DELETADAS — sempre acrescidas às da cena, para preservar o
 * contexto do produto/marca da cena inteira); (d) `productRequirement`/`humanRequirement`
 * inferidos pelo propósito do Shot; (e) `sequenceRoles` removidos (modo Shot ignora sequência
 * da cena — cada Shot é 1 asset).
 */
function buildShotQuery(params: {
  baseQuery: VisualAssetSearchQuery;
  diegoShot: NonNullable<RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"][number]["shotTimeline"]>[number];
  brunoShot?: RafaVideoRenderingRequestInput["brunoScript"]["scenes"][number]["shots"] extends (infer S)[] | undefined ? S : never;
  forbidAssetIds: string[];
}): VisualAssetSearchQuery {
  const { baseQuery, diegoShot, brunoShot, forbidAssetIds } = params;
  const shotRequirement = diegoShot.visualAssetRequirement;
  const preferredMediaKind = shotRequirement?.preferredMediaKind;
  // SHOT-LEVEL ASSET RESOLUTION — `requiredTags` PRESERVA exatamente as tags da CENA. Tags
  // específicas do Shot (ex.: "detalhe", "reacao", "mao") NÃO entram como requisito estrito
  // — se entrassem, quebrariam a compatibilidade com bibliotecas locais que só carregam tags
  // de cena, e reduziriam o pool de candidatos elegíveis. O papel do Shot (`shotPurpose`) já
  // é usado pelo resolver para influenciar o scoring via `productRequirement`/`humanRequirement`
  // (abaixo) e pela finalidade da query. Diversidade entre Shots vem de `forbidAssetIds`, não
  // de tags mais restritivas.
  const shotForbiddenTags = normalizeTags([
    ...(shotRequirement?.forbiddenTags ?? []),
    ...(brunoShot?.assetRequirement?.forbiddenTags ?? []),
    ...(baseQuery.forbiddenTags ?? []),
  ]);
  const sequenceRole = diegoShot.purpose as VisualSequenceRole;
  const purposeRequiresHuman = ["human_interaction", "reaction"].includes(diegoShot.purpose);
  const purposeRequiresProduct = ["product", "detail"].includes(diegoShot.purpose)
    && (baseQuery.requiredTags.includes("produto-real") || baseQuery.requiredTags.includes("interface") || baseQuery.requiredTags.includes("site"));
  const purposeRequiresMockup = baseQuery.desiredKind === "mockup" && ["product", "detail"].includes(diegoShot.purpose);
  const isEndCardShot = baseQuery.sceneName === "CTA final" || sequenceRole === "closing";
  // ASSET DIVERSITY GATE / STRICT SELETIVO — strict:true sempre que o Shot exigir humano, produto,
  // mockup ou for o CTA/end card, em qualquer perfil que não seja draft; draft (só testes técnicos)
  // é o único perfil que ainda tolera fallback genérico para esses requisitos. Nunca decidido por
  // cena de fundo/transição/establishing abstrato, que nunca ganham requisito algum aqui.
  const qualityProfile: AssetQualityProfile = baseQuery.qualityProfile ?? "standard";
  const strict = qualityProfile !== "draft";
  return {
    ...baseQuery,
    // shotId/shotOrder ecoados — o resolver detecta modo Shot e devolve exatamente 1 asset por
    // query em vez de fanning-out por sequenceRoles.
    shotId: diegoShot.shotId,
    shotOrder: diegoShot.shotOrder,
    shotPurpose: sequenceRole,
    // Modo Shot ignora sequenceRoles/sequenceSize — cada Shot pede seu próprio asset único.
    sequenceRoles: undefined,
    sequenceSize: undefined,
    // desiredKind por Shot: mantemos o kind da CENA como base. O `preferredMediaKind` do Shot
    // (video/b-roll/cinemagraph > photo > mockup) INFORMA a preferência de mídia mas NÃO se
    // torna um filtro estrito — se fosse, uma biblioteca local que só tem mockups do produto
    // rejeitaria todos os Shots que pediram vídeo, sem ter chance de cair no mockup real do
    // produto. O scoring interno do resolver (`mediaPriorityForKind`) já favorece video > photo
    // quando ambos existem para as mesmas tags.
    desiredKind: baseQuery.desiredKind,
    requiredTags: baseQuery.requiredTags,
    forbiddenTags: shotForbiddenTags.length > 0 ? shotForbiddenTags : baseQuery.forbiddenTags,
    forbidAssetIds,
    productRequirement: (purposeRequiresProduct || isEndCardShot)
      ? { productName: isEndCardShot ? "Rumo ao Altar (end card)" : "Rumo ao Altar", strict }
      : undefined,
    humanRequirement: purposeRequiresHuman
      ? { subject: "casal recém-noivos", strict }
      : undefined,
    mockupRequirement: purposeRequiresMockup
      ? { what: "mockup/interface real do site Rumo ao Altar", strict }
      : undefined,
    // continuityWithPrevious vem do próprio Shot (Diego já preencheu). Quando presente, o
    // resolver PODE reutilizar o asset do Shot anterior mesmo se aparecer em `forbidAssetIds`
    // — a decisão fica com o resolver via `continuityGroup`.
    continuityWithPrevious: diegoShot.continuityFromPreviousShot,
    // Grupos de continuidade explícitos: Shots consecutivos com continuidade forte compartilham
    // grupo, permitindo reuso legítimo. Sem esse rótulo, o resolver força diversidade.
    continuityGroup: continuityGroupForShot(diegoShot),
    // COMPOSITE SHOT COVERAGE INTEGRATION — duração real do Shot, só para a checagem de
    // exposição mínima por segmento numa Composite Scene Resolution (seção 7). Nunca usada pela
    // resolução de asset único, que não muda.
    shotDurationSeconds: diegoShot.durationSeconds,
  };
}

/**
 * Heurística de continuidade: Shots com "mesmo casal", "mesmo momento", "mesma tela", "mesmo
 * ambiente" na `continuityFromPreviousShot` de Diego formam um grupo com o Shot anterior. Esse
 * agrupamento permite ao resolver reutilizar o mesmo asset para reforçar continuidade em vez
 * de forçar variação artificial.
 */
function continuityGroupForShot(diegoShot: { shotId: string; sceneOrder: number; continuityFromPreviousShot?: string }): string | undefined {
  const text = normalizeText(diegoShot.continuityFromPreviousShot ?? "");
  const wantsExplicitContinuity = ["mesmo casal", "mesmo momento", "mesma tela", "mesmo ambiente", "mesma cena"].some((phrase) => text.includes(phrase));
  return wantsExplicitContinuity ? `scene-${diegoShot.sceneOrder}-continuity` : undefined;
}

/**
 * Coleta ids de assets JÁ resolvidos pelas queries anteriores desta execução (todos os Shots
 * já visitados até aqui em `buildVisualAssetQueries`). Como a resolução acontece DEPOIS da
 * construção de todas as queries, aqui só sabemos as queries que fizemos — não os assets
 * escolhidos. Por isso o dedupe FINAL fica no resolver (via `selectedAssetIds` interno). Este
 * helper existe para o caso futuro em que Rafa quiser controlar diversidade globalmente.
 */
function buildForbidAssetIdsForShot(previousQueries: VisualAssetSearchQuery[]): string[] {
  // Por ora retorna array vazio — o dedupe efetivo é feito pelo resolver via `selectedAssetIds`
  // interno (que rastreia assets já retornados na mesma resolução). Manter este ponto de
  // extensão para o futuro (quando Rafa quiser injetar restrições explícitas por execução).
  void previousQueries;
  return [];
}

const DEVELOPMENT_SEQUENCE_ROLE_SETS: VisualSequenceRole[][] = [
  ["establishing", "detail", "human_interaction"],
  ["human_interaction", "reaction", "detail"],
  ["detail", "product", "closing"],
];

/** Papéis de sequência audiovisual pedidos por cena — ver `VisualSequenceRole`. Nunca pede mais do que a duração da cena comporta (cada slot precisa de tempo real em tela). */
function sequenceRolesFor(sceneName: string, isDevelopment: boolean, beatIndex: number, durationSeconds: number): VisualSequenceRole[] {
  if (sceneName === "Gancho") return durationSeconds >= 4 ? ["establishing", "human_interaction"] : ["establishing"];
  if (sceneName === "CTA final") return ["closing"];
  if (!isDevelopment) return ["establishing"];
  const roleSet = DEVELOPMENT_SEQUENCE_ROLE_SETS[beatIndex % DEVELOPMENT_SEQUENCE_ROLE_SETS.length];
  if (durationSeconds >= 8) return roleSet;
  if (durationSeconds >= 4) return roleSet.slice(0, 2);
  return roleSet.slice(0, 1);
}

function kindForAssetPriority(
  assetPriority: string | undefined,
  fallback: VisualAssetSearchQuery["desiredKind"] | undefined,
): VisualAssetSearchQuery["desiredKind"] {
  if (assetPriority === "brand_end_card") return "graphic";
  if (assetPriority === "product_mockup" || assetPriority === "screenshot") return "mockup";
  if (assetPriority === "person_using_product" || assetPriority === "context_photo" || assetPriority === "conceptual_photo") return "photo";
  return fallback ?? "photo";
}

function tagsForAssetPriority(assetPriority: string | undefined): string[] {
  if (assetPriority === "person_using_product") return ["pessoa", "casal", "celular", "pessoa-usando-produto", "produto-real"];
  if (assetPriority === "product_mockup") return ["mockup-produto", "mockup", "interface", "produto-real"];
  if (assetPriority === "screenshot") return ["screenshot", "interface", "produto-real"];
  if (assetPriority === "context_photo") return ["pessoa", "contexto-humano", "foto-contexto", "casamento"];
  if (assetPriority === "brand_end_card") return ["end-card", "logo-oficial", "mockup-produto", "cta"];
  return [];
}

const SPECIFIC_FEATURE_TAGS_FOR_ASSET_QUERY = ["rsvp", "presente", "presentes", "pix", "album", "foto", "fotos", "cronograma", "cta", "logo"];

function inferVisualTags(text: string): string[] {
  const normalized = normalizeText(text);
  const tags = new Set(["casamento", "rumo-ao-altar"]);
  if (containsAny(normalized, ["casal", "noivo", "noiva", "noivos", "recem-noivos", "recém-noivos"])) tags.add("casal");
  if (containsAny(normalized, ["celular", "smartphone", "telefone", "site", "oficial"])) {
    tags.add("celular");
    tags.add("site");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(normalized, ["rsvp", "presenca", "presença", "confirmacao", "confirmação"])) {
    tags.add("rsvp");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(normalized, ["presente", "presentes", "pix", "taxa", "lista"])) {
    tags.add("presentes");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(normalized, ["album", "álbum", "foto", "fotos", "galeria"])) {
    tags.add("album");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(normalized, ["cronograma", "agenda", "horario", "horário"])) {
    tags.add("cronograma");
    tags.add("produto-real");
    tags.add("mockup");
    tags.add("interface");
  }
  if (containsAny(normalized, ["convite", "convidado", "convidados"])) tags.add("convidados");
  if (containsAny(normalized, ["cta", "conheca", "conheça", "cadastro", "acesse", "rumoaoaltar"])) tags.add("cta");
  return [...tags];
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => normalizeText(tag.trim())).filter(Boolean)));
}

/** Monta os candidatos a assets locais reais a validar — nunca a partir de texto livre (ver comentário de `attemptLocalRendering`). */
function buildAssetCandidates(input: {
  timeline: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"];
  localAssets?: RafaLocalAssetsInput;
  logoUri?: string;
  noraNarration?: RafaVideoRenderingRequestInput["noraNarration"];
}): LocalAssetCandidate[] {
  const candidates: LocalAssetCandidate[] = [];

  if (input.logoUri) {
    candidates.push({ id: "logo", kind: "image", path: input.logoUri, sourceDescription: "IdentityContext.logoUri da Clara", required: false });
  }

  for (const entry of input.timeline) {
    const backgroundPath = input.localAssets?.backgroundImagePathBySceneOrder?.[entry.order];
    if (backgroundPath) {
      candidates.push({
        id: `bg-${entry.order}`,
        kind: "image",
        path: backgroundPath,
        sourceDescription: `localAssets.backgroundImagePathBySceneOrder[${entry.order}]`,
        required: true,
        sceneOrder: entry.order,
      });
    }
    const soundEffectPath = input.localAssets?.soundEffectPathBySceneOrder?.[entry.order];
    if (soundEffectPath) {
      candidates.push({
        id: `sfx-${entry.order}`,
        kind: "audio",
        path: soundEffectPath,
        sourceDescription: `localAssets.soundEffectPathBySceneOrder[${entry.order}]`,
        required: true,
        sceneOrder: entry.order,
      });
    }
  }

  if (input.localAssets?.musicTrackPath) {
    candidates.push({ id: "music", kind: "audio", path: input.localAssets.musicTrackPath, sourceDescription: "localAssets.musicTrackPath", required: true });
  }

  if (input.noraNarration?.audio.absolutePath) {
    candidates.push({
      id: "narration",
      kind: "audio",
      path: input.noraNarration.audio.absolutePath,
      sourceDescription: "noraNarration.audio.absolutePath",
      required: true,
    });
  }

  return candidates;
}

/**
 * Traduz a `editingTimeline` real de Diego (a única fonte de verdade sobre texto/tempo/transição
 * de cada cena) em um `VideoRenderRequest` completo: fundo procedural nas cores da marca (ou a
 * imagem local resolvida, se houver), overlays de texto (headline nas cenas intermediárias, CTA
 * na última cena — mesma convenção que Bruno já usa para nomear a cena final "CTA final"),
 * transição classificada a partir do texto de Diego, e assets/trilhas apenas quando realmente
 * resolvidos. `brollSuggestions`/`musicSuggestions`/`requiredAssets` (texto livre) nunca entram
 * aqui como caminho de arquivo — só geram um aviso informativo de que são sugestões, não arquivos.
 */
type RafaAudioSummary = {
  applied: boolean;
  source?: string;
  filename?: string;
  narrationApplied?: boolean;
  narrationSource?: string;
  narrationFilename?: string;
  narrationDuration?: number;
  musicDuckingApplied?: boolean;
};

/**
 * SHOT RENDER ENGINE — transporta o `shotTimeline` de Diego (que já espelha os Shots de Bruno)
 * para o `VideoRenderRequest.scenes[i].shotTimeline`. Correlaciona por `shotId` com as `Bruno.shots`
 * para trazer motion.action/entrance/exit, e traduz `entranceTransition`/`exitTransition` de Diego
 * para o vocabulário do renderer (`VideoSceneTransition`). Retorna `undefined` quando a cena não
 * tem shotTimeline em Diego — o compilador cai no fallback legado (uma cena, um clipe) com warning.
 */
/**
 * NARRATIVE TIMING REBALANCING — achata a timeline de Diego (todas as cenas, todos os Shots) no
 * formato mínimo/agnóstico de Skill que o rebalancer aceita (`TimingShotInput`). Única ponte
 * entre os tipos concretos de Diego e o motor de realocação genérico em `shared/utils`.
 */
function flattenTimelineForTiming(timeline: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"]): TimingShotInput[] {
  const shots: TimingShotInput[] = [];
  for (const entry of timeline) {
    for (const diegoShot of entry.shotTimeline ?? []) {
      shots.push({
        shotId: diegoShot.shotId,
        sceneOrder: diegoShot.sceneOrder,
        shotOrder: diegoShot.shotOrder,
        purpose: diegoShot.purpose,
        allocatedDuration: diegoShot.durationSeconds,
        entranceTransition: diegoShot.entranceTransition,
        exitTransition: diegoShot.exitTransition,
        tags: diegoShot.visualAssetRequirement?.tags ?? [],
        syncNotes: diegoShot.syncNotes,
      });
    }
  }
  return shots;
}

/**
 * NARRATIVE TIMING REBALANCING (seção 14) — aplica as durações realocadas de volta a uma CÓPIA
 * da timeline de Diego (nunca muta a original — auditável). Recalcula `startSeconds`/`endSeconds`
 * sequencialmente dentro de cada cena afetada para manter os Shots contíguos; cenas sem Shot
 * afetado saem byte-a-byte idênticas.
 */
function applyDurationAdjustmentsToTimeline(
  timeline: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"],
  adjustedDurationByShotId: Map<string, number>,
): RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"] {
  return timeline.map((entry) => {
    if (!entry.shotTimeline || !entry.shotTimeline.some((shot) => adjustedDurationByShotId.has(shot.shotId))) return entry;
    let cursor = entry.startSeconds;
    const shotTimeline = entry.shotTimeline.map((shot) => {
      const durationSeconds = adjustedDurationByShotId.get(shot.shotId) ?? shot.durationSeconds;
      const startSeconds = cursor;
      const endSeconds = Number.parseFloat((startSeconds + durationSeconds).toFixed(3));
      cursor = endSeconds;
      return { ...shot, durationSeconds, startSeconds, endSeconds };
    });
    return { ...entry, shotTimeline };
  });
}

/**
 * NARRATIVE TIMING REBALANCING — tenta resolver todo déficit temporal reportado pelo resolver
 * ANTES de aceitar Developer Assisted Mode (seção 16: déficit -> realocação -> recalcular
 * composição -> timeline final). Determinístico: um plano por déficit, aplicado em sequência;
 * nunca redistribui Shots sem déficit. Retorna `undefined` quando nenhum plano válido existe para
 * NENHUM déficit — o chamador segue exatamente como antes (Developer Assisted Mode).
 */
export function attemptTimingRebalance(input: {
  timeline: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"];
  timingDeficits: { shotId: string; sceneOrder: number; allocatedDuration: number; deficit: number }[];
}): { timeline: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"]; records: RebalanceRecord[]; unresolvedShotIds: string[] } | undefined {
  const timingShots = flattenTimelineForTiming(input.timeline);
  const shotOrderById = new Map(timingShots.map((shot) => [shot.shotId, shot.shotOrder]));

  let workingShots = timingShots;
  const plans: RebalancePlan[] = [];
  const unresolvedShotIds: string[] = [];
  for (const deficit of input.timingDeficits) {
    const donors = findDonorCandidates({
      receiverShotId: deficit.shotId,
      receiverSceneOrder: deficit.sceneOrder,
      receiverShotOrder: shotOrderById.get(deficit.shotId) ?? 0,
      allShots: workingShots,
    });
    const plan = buildRebalancePlan({
      receiverShotId: deficit.shotId,
      receiverSceneOrder: deficit.sceneOrder,
      receiverAllocatedDuration: deficit.allocatedDuration,
      deficit: deficit.deficit,
      donors,
    });
    if (!plan) {
      unresolvedShotIds.push(deficit.shotId);
      continue;
    }
    workingShots = applyRebalancePlan(workingShots, plan);
    plans.push(plan);
  }

  if (plans.length === 0) return undefined;

  // Só os Shots REALMENTE tocados por algum plano (receptor + doadores) entram no mapa — nunca
  // todos os Shots (mesmo com o mesmo valor), para que cenas sem nenhum Shot envolvido saiam
  // byte-a-byte idênticas da timeline ajustada (seção 15/16: nunca alterar Shot indevidamente).
  const touchedShotIds = new Set<string>();
  for (const plan of plans) {
    touchedShotIds.add(plan.receiverShotId);
    for (const transfer of plan.transfers) touchedShotIds.add(transfer.donorShotId);
  }
  const adjustedDurationByShotId = new Map(
    workingShots.filter((shot) => touchedShotIds.has(shot.shotId)).map((shot) => [shot.shotId, shot.allocatedDuration]),
  );
  const adjustedTimeline = applyDurationAdjustmentsToTimeline(input.timeline, adjustedDurationByShotId);
  const records = plans.map((plan) => buildRebalanceRecord(plan));
  return { timeline: adjustedTimeline, records, unresolvedShotIds };
}

export function buildShotTimelineForRender(input: {
  entry: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"][number];
  brunoScenes?: RafaVideoRenderingRequestInput["brunoScript"]["scenes"];
  motionVisualAssetId?: string;
  /**
   * SHOT-LEVEL ASSET RESOLUTION — mapa `shotId -> assetId real (com prefixo "visual-shot-...")`
   * já registrado como `VideoRenderAsset` na request. Quando presente para o Shot, este assetId
   * vira o background do clipe (unidade mínima de renderização). Quando ausente, cai no fallback
   * legado (`motionVisualAssetId`, que é o asset da cena) com warning explícito no shot-render-plan.
   */
  shotAssetIdByShotId?: Map<string, string>;
  /**
   * SHOT-LEVEL ASSET RESOLUTION — mapa `shotId -> VisualAssetResolved` para observabilidade.
   * O `VideoRenderShot.assetMetadata` traz esses dados para o `shot-render-plan.json` e o
   * `shot-asset-map.json` sem precisar de segunda passada no resolver.
   */
  visualAssetByShotId?: Map<string, VisualAssetResolved>;
}): VideoRenderShot[] | undefined {
  const diegoShotTimeline = input.entry.shotTimeline;
  if (!diegoShotTimeline || diegoShotTimeline.length === 0) return undefined;

  const brunoScene = input.brunoScenes?.find((scene) => scene.order === input.entry.order);
  const brunoShotsById = new Map((brunoScene?.shots ?? []).map((shot) => [shot.id, shot]));
  const shotAssetIdByShotId = input.shotAssetIdByShotId ?? new Map<string, string>();
  const visualAssetByShotId = input.visualAssetByShotId ?? new Map<string, VisualAssetResolved>();

  return diegoShotTimeline.flatMap<VideoRenderShot>((diegoShot) => {
    const brunoShot = brunoShotsById.get(diegoShot.shotId);
    const visualAsset = visualAssetByShotId.get(diegoShot.shotId);

    // COMPOSITE SHOT COVERAGE INTEGRATION (seção 8) — quando o resolver devolveu vários assets
    // para este Shot (um por requisito atômico), fanea o ÚNICO Diego-shot em N `VideoRenderShot`
    // sequenciais dentro da MESMA janela de tempo — o Shot Render Engine já trata cada entrada
    // do array como um clipe independente (não precisa saber que vieram de um só Shot original).
    // Duração de cada segmento = peso do requisito atômico (seção 3, Scene Coverage) × duração
    // real do Shot; `reflowClipStartsInPlace` (shot-render-planner.ts) recalcula os `startSeconds`
    // absolutos depois, então só a ORDEM e a DURAÇÃO relativa de cada segmento importam aqui.
    if (visualAsset?.resolutionType === "composite_scene" && visualAsset.compositeAssignments && visualAsset.compositeAssignments.length > 0) {
      const assignments = visualAsset.compositeAssignments;
      let cursor = diegoShot.startSeconds;
      return assignments.map<VideoRenderShot>((assignment, index) => {
        const segmentDuration = Number.parseFloat((diegoShot.durationSeconds * assignment.weight).toFixed(3));
        const segmentStart = cursor;
        cursor += segmentDuration;
        const isFirst = index === 0;
        const isLast = index === assignments.length - 1;
        return {
          shotId: `${diegoShot.shotId}::${assignment.microShotId}`,
          shotOrder: diegoShot.shotOrder,
          sceneOrder: diegoShot.sceneOrder,
          purpose: assignment.description,
          startSeconds: segmentStart,
          durationSeconds: segmentDuration,
          action: diegoShot.action,
          assetId: `visual-shot-${diegoShot.shotId}::${assignment.microShotId}`,
          motionAction: brunoShot?.motion?.action,
          motionEntrance: isFirst ? brunoShot?.motion?.entrance : undefined,
          motionExit: isLast ? brunoShot?.motion?.exit : undefined,
          entranceTransition: isFirst ? mapDiegoTransitionToRenderer(diegoShot.entranceTransition) : "dissolve",
          exitTransition: isLast ? mapDiegoTransitionToRenderer(diegoShot.exitTransition) : "dissolve",
          continuityFromPrevious: isFirst ? diegoShot.continuityFromPreviousShot : undefined,
          assetMetadata: {
            assetType: assignment.asset.kind,
            source: assignment.asset.origin,
            license: {
              name: assignment.asset.license.name,
              allowsCommercialUse: assignment.asset.license.allowsCommercialUse,
            },
            score: assignment.score,
            selectionReason: assignment.selectionReason,
            reusedFromShotId: undefined,
            continuityGroup: visualAsset.continuityGroup,
            wasDeveloperAssisted: assignment.asset.origin === "developer_assisted",
          },
        };
      });
    }

    // SHOT-LEVEL ASSET RESOLUTION — prioridade absoluta: asset resolvido para ESTE Shot pela
    // query per-Shot. Só cai para o asset da cena (`motionVisualAssetId`) se o resolver não
    // devolveu asset para o Shot (Developer Assisted Mode ou legado sem shotTimeline).
    const shotAssetId = shotAssetIdByShotId.get(diegoShot.shotId) ?? input.motionVisualAssetId;
    return [{
      shotId: diegoShot.shotId,
      shotOrder: diegoShot.shotOrder,
      sceneOrder: diegoShot.sceneOrder,
      purpose: diegoShot.purpose,
      startSeconds: diegoShot.startSeconds,
      durationSeconds: diegoShot.durationSeconds,
      action: diegoShot.action,
      assetId: shotAssetId,
      motionAction: brunoShot?.motion?.action,
      motionEntrance: brunoShot?.motion?.entrance,
      motionExit: brunoShot?.motion?.exit,
      entranceTransition: mapDiegoTransitionToRenderer(diegoShot.entranceTransition),
      exitTransition: mapDiegoTransitionToRenderer(diegoShot.exitTransition),
      continuityFromPrevious: diegoShot.continuityFromPreviousShot,
      assetMetadata: visualAsset
        ? {
            assetType: visualAsset.asset.kind,
            source: visualAsset.asset.origin,
            license: {
              name: visualAsset.asset.license.name,
              allowsCommercialUse: visualAsset.asset.license.allowsCommercialUse,
            },
            score: visualAsset.score,
            selectionReason: visualAsset.selectionReason,
            reusedFromShotId: visualAsset.reusedFromShotId,
            continuityGroup: visualAsset.continuityGroup,
            wasDeveloperAssisted: visualAsset.asset.origin === "developer_assisted",
          }
        : undefined,
    }];
  });
}

/**
 * Mapeia o vocabulário de transições de Diego (`TransitionStyle` do shared library) para o
 * vocabulário do renderer (`VideoSceneTransition`). Os dois são idênticos hoje, mas passamos por
 * este helper para: (a) validar tipagem, (b) permitir divergência futura sem quebrar o transport.
 */
function mapDiegoTransitionToRenderer(diegoTransition: string | undefined): VideoSceneTransition | undefined {
  if (!diegoTransition) return undefined;
  const allowed: VideoSceneTransition[] = ["cut", "fade", "dissolve", "slide", "wipe", "whip", "glow"];
  return (allowed as string[]).includes(diegoTransition) ? (diegoTransition as VideoSceneTransition) : undefined;
}

function buildRenderPlan(input: {
  timeline: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"];
  brandColors: string[];
  resolvedById: Map<string, VideoAssetResolution>;
  candidates: LocalAssetCandidate[];
  visualAssets?: VisualAssetResolved[];
  noraNarration?: RafaVideoRenderingRequestInput["noraNarration"];
  /**
   * SHOT RENDER ENGINE — cenas de Bruno com seus Shots (que carregam motion.action e transitionToNext
   * por Shot). Rafa correlaciona por `shotId` para enriquecer o `shotTimeline` do VideoRenderRequest
   * com dados de motion que Diego não transporta. Nunca cria/redefine Shots — apenas transporta
   * o que já existe em Bruno.
   */
  brunoScenes?: RafaVideoRenderingRequestInput["brunoScript"]["scenes"];
}): {
  scenes: VideoRenderScene[];
  assets: VideoRenderAsset[];
  audioTracks: VideoAudioTrack[];
  textSuggestionWarnings: string[];
  audioSummary: RafaAudioSummary;
  motionSummary: RafaVideoMotionSummary;
} {
  const { timeline, brandColors, resolvedById, candidates, noraNarration, brunoScenes } = input;
  const assets: VideoRenderAsset[] = [];
  const audioTracks: VideoAudioTrack[] = [];
  const textSuggestionWarnings: string[] = [];
  // Agrupado (não mais um único asset por cena): uma cena pode ter uma sequência visual real de
  // até 2 imagens (ver `sequenceSize` em `buildVisualAssetQueries`) — a primeira (sequenceIndex 0
  // ou ausente) continua sendo o fundo principal da cena, exatamente como antes; a segunda (quando
  // existe) vira um elemento "detail_image" complementar, nunca substitui nem domina a primeira.
  const visualAssetsBySceneOrder = new Map<number, VisualAssetResolved[]>();
  for (const asset of input.visualAssets ?? []) {
    const list = visualAssetsBySceneOrder.get(asset.sceneOrder) ?? [];
    list.push(asset);
    visualAssetsBySceneOrder.set(asset.sceneOrder, list);
  }
  for (const list of visualAssetsBySceneOrder.values()) list.sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
  const visualAssetBySceneOrder = new Map<number, VisualAssetResolved>(
    [...visualAssetsBySceneOrder.entries()].map(([order, list]) => [order, list[0]]),
  );

  // SHOT-LEVEL ASSET RESOLUTION — mapa `shotId -> videoRenderAssetId` para todos os Shots que
  // receberam asset próprio do resolver (queries per-Shot com `shotId` preenchido). Cada asset
  // aqui vira um `VideoRenderAsset` distinto (com id determinístico `visual-shot-<shotId>`) e
  // será usado como background do clipe correspondente no SHOT RENDER ENGINE.
  const shotAssetIdByShotId = new Map<string, string>();
  const visualAssetByShotId = new Map<string, VisualAssetResolved>();
  for (const resolvedShot of input.visualAssets ?? []) {
    if (!resolvedShot.shotId) continue;
    const shotAssetId = `visual-shot-${resolvedShot.shotId}`;
    // O mesmo asset físico pode ser reutilizado por Shots diferentes via continuityGroup
    // (`reusedFromShotId`): registramos um VideoRenderAsset distinto por resolvedShot para
    // preservar rastreabilidade, mas addUniqueRenderAsset garante que o compilador não duplica
    // inputs do renderizador quando o absolutePath já foi registrado por outro id.
    addUniqueRenderAsset(assets, {
      id: shotAssetId,
      kind: renderAssetKindFor(resolvedShot.asset.kind),
      absolutePath: resolvedShot.asset.absolutePath,
      sourceDurationSeconds: resolvedShot.asset.durationSeconds,
    });
    shotAssetIdByShotId.set(resolvedShot.shotId, shotAssetId);
    visualAssetByShotId.set(resolvedShot.shotId, resolvedShot);

    // COMPOSITE SHOT COVERAGE INTEGRATION — quando este Shot foi resolvido por vários assets
    // (um por requisito atômico), registra um VideoRenderAsset PRÓPRIO por segmento, além do
    // `shotAssetId` acima (que aponta só para o primeiro segmento, por compatibilidade com
    // consumidores que ainda leem 1 asset por Shot). `buildShotTimelineForRender` usa estes ids
    // para fanear o Shot em N clipes reais — nunca inventa um asset novo, só registra os que o
    // resolver já escolheu.
    if (resolvedShot.resolutionType === "composite_scene" && resolvedShot.compositeAssignments) {
      for (const assignment of resolvedShot.compositeAssignments) {
        addUniqueRenderAsset(assets, {
          id: `visual-shot-${resolvedShot.shotId}::${assignment.microShotId}`,
          kind: renderAssetKindFor(assignment.asset.kind),
          absolutePath: assignment.asset.absolutePath,
          sourceDurationSeconds: assignment.asset.durationSeconds,
        });
      }
    }
  }

  const logoResolution = resolvedById.get("logo");
  const hasLogo = logoResolution?.resolved === true;
  if (logoResolution?.resolved) assets.push({ id: "logo", kind: "image", absolutePath: logoResolution.absolutePath });

  // Pontos de ducking da trilha: início de cada efeito sonoro selecionado por Diego — a trilha
  // "abre espaço" automaticamente para cada efeito pontual, sem precisar de side-chain/compressor.
  const sfxDuckAtSeconds = timeline
    .filter((entry) => (entry.selectedSoundEffects?.length ?? 0) > 0)
    .map((entry) => entry.startSeconds);
  const narrationDuckWindows = (noraNarration?.segments ?? []).map((segment) => ({
    startSeconds: Math.max(0, segment.startTime - 0.08),
    durationSeconds: Math.max(0.35, segment.endTime - segment.startTime + 0.16),
  }));

  const narrationResolution = resolvedById.get("narration");
  const hasNarration = narrationResolution?.resolved === true;
  if (narrationResolution?.resolved) {
    assets.push({ id: "narration", kind: "audio", absolutePath: narrationResolution.absolutePath });
    audioTracks.push({
      assetId: "narration",
      role: "narration",
      startSeconds: 0,
      volume: 1,
      fadeInSeconds: 0.12,
      fadeOutSeconds: 0.18,
    });
  }

  const musicCandidate = candidates.find((candidate) => candidate.id === "music");
  const musicResolution = musicCandidate ? resolvedById.get("music") : undefined;
  let audioSummary: RafaAudioSummary = {
    applied: hasNarration,
    narrationApplied: hasNarration,
    narrationSource: narrationResolution?.resolved ? narrationResolution.absolutePath : undefined,
    narrationFilename: narrationResolution?.resolved ? extractFileName(narrationResolution.absolutePath) : undefined,
    narrationDuration: noraNarration?.audio.durationSeconds,
    musicDuckingApplied: false,
  };
  if (musicResolution?.resolved) {
    assets.push({ id: "music", kind: "audio", absolutePath: musicResolution.absolutePath });
    audioTracks.push({
      assetId: "music",
      role: "music",
      startSeconds: 0,
      volume: hasNarration ? 0.34 : 0.5,
      fadeInSeconds: 1,
      fadeOutSeconds: 2,
      duckAtSeconds: sfxDuckAtSeconds,
      duckWindows: narrationDuckWindows,
      duckAmount: hasNarration ? 0.68 : undefined,
      duckDurationSeconds: 0.6,
    });
    audioSummary = {
      ...audioSummary,
      applied: true,
      source: musicResolution.absolutePath,
      filename: extractFileName(musicResolution.absolutePath),
      musicDuckingApplied: hasNarration && narrationDuckWindows.length > 0,
    };
  }

  let previousVisualEntrance: VideoMotionAnimation | undefined;
  const scenes: VideoRenderScene[] = timeline.map((entry, index) => {
    const isLastScene = index === timeline.length - 1;
    const backgroundResolution = resolvedById.get(`bg-${entry.order}`);
    let logoAssetIdForScene: string | undefined;
    let motionVisualAssetId: string | undefined;
    const detailVisualAssetIds: string[] = [];
    let background: VideoSceneBackground;
    if (backgroundResolution?.resolved) {
      const assetId = `bg-${entry.order}`;
      addUniqueRenderAsset(assets, { id: assetId, kind: "image", absolutePath: backgroundResolution.absolutePath });
      motionVisualAssetId = assetId;
      background = buildProceduralBackground(brandColors, index);
    } else {
      const visualAsset = visualAssetBySceneOrder.get(entry.order);
      if (visualAsset) {
        const assetId = `visual-scene-${entry.order}`;
        const isLowResolutionBrandGraphic =
          isLastScene &&
          visualAsset.asset.kind === "graphic" &&
          Math.min(visualAsset.asset.width, visualAsset.asset.height) < 720;
        addUniqueRenderAsset(assets, {
          id: assetId,
          kind: renderAssetKindFor(visualAsset.asset.kind),
          absolutePath: visualAsset.asset.absolutePath,
          sourceDurationSeconds: visualAsset.asset.durationSeconds,
        });
        if (isLowResolutionBrandGraphic) {
          logoAssetIdForScene = assetId;
          background = buildProceduralBackground(brandColors, index);
        } else {
          motionVisualAssetId = assetId;
          background = buildProceduralBackground(brandColors, index);
        }
        // Sequência audiovisual da cena (ver VisualAssetResolver `sequenceRoles`): além do asset
        // principal, até 2 assets adicionais viram pequenos elementos "detail_image" em posições
        // e momentos distintos — nunca mais que isso, para não parecer colagem de miniaturas.
        const sequenceMembers = visualAssetsBySceneOrder.get(entry.order) ?? [];
        for (const detailAsset of sequenceMembers.slice(1, 3)) {
          if (detailAsset.asset.id === visualAsset.asset.id) continue;
          const detailAssetId = `visual-scene-${entry.order}-detail-${detailAsset.sequenceIndex ?? detailVisualAssetIds.length + 1}`;
          addUniqueRenderAsset(assets, {
            id: detailAssetId,
            kind: renderAssetKindFor(detailAsset.asset.kind),
            absolutePath: detailAsset.asset.absolutePath,
            sourceDurationSeconds: detailAsset.asset.durationSeconds,
          });
          detailVisualAssetIds.push(detailAssetId);
        }
      } else {
        background = buildProceduralBackground(brandColors, index);
      }
    }

    const overlays: VideoSceneOverlay[] = [];
    const safeHeadline = sanitizeRenderableText(entry.publicVisibleText ?? entry.onScreenText, isLastScene ? 52 : 46);
    const safeCaption = hasNarration && !isLastScene ? undefined : sanitizeRenderableText(entry.publicSubtitle ?? entry.captionText, isLastScene ? 32 : 64);
    if (safeHeadline) {
      overlays.push({ role: isLastScene ? "cta" : "headline", text: safeHeadline });
    } else if (entry.onScreenText?.trim()) {
      textSuggestionWarnings.push(`Cena ${entry.order}: texto principal ignorado por conter nota interna ou exceder regra pública segura.`);
    }
    if (safeCaption && safeCaption !== safeHeadline) {
      overlays.push({ role: "caption", text: safeCaption });
    } else if (entry.captionText?.trim() && entry.captionText.trim() !== entry.onScreenText?.trim()) {
      textSuggestionWarnings.push(`Cena ${entry.order}: complemento/legenda ignorado por conter nota interna, ser redundante ou exceder regra pública segura.`);
    }

    const soundEffectResolution = resolvedById.get(`sfx-${entry.order}`);
    if (soundEffectResolution?.resolved) {
      const assetId = `sfx-${entry.order}`;
      assets.push({ id: assetId, kind: "audio", absolutePath: soundEffectResolution.absolutePath });
      audioTracks.push({ assetId, role: "sound_effect", startSeconds: entry.startSeconds, volume: 0.8 });
    }

    const { zoom, pan } = resolveMotion(entry.editingDecision, index);
    const endCardLogoAssetId = logoAssetIdForScene ?? (hasLogo ? "logo" : undefined);
    const motion = buildMotionComposition({
      entry,
      index,
      isLastScene,
      visualAssetId: motionVisualAssetId,
      detailVisualAssetIds,
      logoAssetId: endCardLogoAssetId,
      brandColors,
      hasNarration,
      previousVisualEntrance,
    });
    previousVisualEntrance = motion.elements.find((element) => element.role === "mockup" || element.role === "main_image")?.entrance;

    // SHOT RENDER ENGINE — transporta o `shotTimeline` que Diego produziu (que já espelha os
    // Shots de Bruno) para o VideoRenderRequest. Rafa nunca inventa/redefine Shots — apenas
    // correlaciona por shotId com Bruno.shots para trazer motion.action/entrance/exit que Diego
    // não carrega, e traduz transições para o vocabulário do compilador.
    const shotTimelineForRender = buildShotTimelineForRender({
      entry,
      brunoScenes,
      motionVisualAssetId,
      shotAssetIdByShotId,
      visualAssetByShotId,
    });

    return {
      order: entry.order,
      startSeconds: entry.startSeconds,
      durationSeconds: entry.durationSeconds,
      background,
      overlays,
      transitionToNext: isLastScene ? undefined : resolveTransition(entry.editingDecision, entry.transitionToNext ?? entry.cutType),
      zoom,
      pan,
      logo: undefined,
      motion,
      shotTimeline: shotTimelineForRender,
    };
  });

  const hasAnyRequiredAssetResolved = candidates.some((candidate) => candidate.required);
  const hasVisualAssets = visualAssetBySceneOrder.size > 0;
  if (!hasAnyRequiredAssetResolved && !hasVisualAssets) {
    textSuggestionWarnings.push(
      "brollSuggestions/musicSuggestions/requiredAssets de Bruno/Diego são sugestões em texto, não caminhos de arquivo — a renderização local usou apenas texto/cores/logo, sem B-roll nem trilha real.",
    );
  }

  return { scenes, assets, audioTracks, textSuggestionWarnings, audioSummary, motionSummary: summarizeMotionCompositions(scenes) };
}

function addUniqueRenderAsset(assets: VideoRenderAsset[], asset: VideoRenderAsset): void {
  if (!assets.some((current) => current.id === asset.id)) assets.push(asset);
}

/** Vídeo/b-roll/cinemagraph viram um stream de vídeo real no VideoRenderRequest, nunca uma imagem estática — ver `VideoAssetKind`. */
function renderAssetKindFor(visualAssetKind: string): "image" | "video" {
  return visualAssetKind === "video" || visualAssetKind === "b_roll" || visualAssetKind === "cinemagraph" ? "video" : "image";
}

function buildMotionComposition(input: {
  entry: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"][number];
  index: number;
  isLastScene: boolean;
  visualAssetId?: string;
  detailVisualAssetIds?: string[];
  logoAssetId?: string;
  brandColors: string[];
  hasNarration?: boolean;
  previousVisualEntrance?: VideoMotionAnimation;
}): VideoMotionComposition {
  const { entry, index, isLastScene, visualAssetId, logoAssetId } = input;
  const detailVisualAssetIds = input.detailVisualAssetIds ?? [];
  const duration = Math.max(1, entry.durationSeconds);
  const easing = entry.editingDecision?.easing ?? "ease_out";
  const elements: VideoMotionElement[] = [];
  const headline = sanitizeRenderableText(entry.publicVisibleText ?? entry.onScreenText, isLastScene ? 52 : 46);
  const subtitle = input.hasNarration && !isLastScene ? undefined : sanitizeRenderableText(entry.publicSubtitle ?? entry.captionText, isLastScene ? 42 : 58);
  const textAnimation = mapTextAnimation(entry, index, isLastScene);
  const visualRole = visualLayerRoleFor(entry, isLastScene);
  const visualEntrance = visualRole === "main_image" ? (index % 2 === 0 ? "fade" : "parallax") : visualEntranceFor(entry, index, isLastScene, input.previousVisualEntrance);
  const layout = buildMotionLayout(index, isLastScene, visualRole);

  if (visualAssetId) {
    const isCinematicImage = visualRole === "main_image";
    elements.push({
      id: `${visualRole}-${entry.order}`,
      role: visualRole,
      assetId: visualAssetId,
      startSeconds: isCinematicImage ? 0 : isLastScene ? 0.3 : 0.18,
      durationSeconds: isCinematicImage ? duration : Math.max(1.2, duration - 0.45),
      exitStartSeconds: isCinematicImage ? duration : Math.max(0.9, duration - 0.34),
      exitDurationSeconds: isCinematicImage ? 0.45 : 0.28,
      entrance: visualEntrance,
      exit: isCinematicImage || isLastScene ? "fade" : "slide_left",
      easing,
      priority: 10,
      width: layout.visual.width,
      height: layout.visual.height,
      x: layout.visual.x,
      y: layout.visual.y,
      shadow: !isCinematicImage,
      opacity: isCinematicImage ? 0.68 : 1,
      syncToBeat: Boolean(entry.editingDecision?.syncNotes),
    });
  }

  // Até 2 assets adicionais da sequência audiovisual da cena (ver `sequenceRolesFor`), escalonados
  // no tempo e em posições opostas do quadro — nunca simultâneos no mesmo canto, para reforçar
  // continuidade em vez de parecer uma colagem de miniaturas estáticas.
  const DETAIL_SLOTS: Array<{ x?: number; y?: number; width?: number; entranceStartRatio: number }> = [
    { entranceStartRatio: 0.32 },
    { x: 56, y: 260, width: 410, entranceStartRatio: 0.6 },
  ];
  if (!isLastScene) {
    detailVisualAssetIds.slice(0, 2).forEach((detailAssetId, detailIndex) => {
      const slot = DETAIL_SLOTS[detailIndex];
      const detailEntrance = detailIndex % 2 === (entry.editingDecision?.mask ? 0 : 1) ? "mask_reveal" : "blur_reveal";
      const startSeconds = Math.max(0.5, duration * slot.entranceStartRatio);
      elements.push({
        id: `detail-${entry.order}-${detailIndex}`,
        role: "detail_image",
        assetId: detailAssetId,
        startSeconds,
        durationSeconds: Math.max(0.8, duration - startSeconds - 0.2),
        exitStartSeconds: duration,
        exitDurationSeconds: 0.3,
        entrance: detailEntrance,
        exit: "fade",
        easing,
        priority: 11,
        x: slot.x,
        y: slot.y,
        width: slot.width,
        shadow: true,
        syncToBeat: false,
      });
    });
  }

  if (isLastScene && logoAssetId) {
    elements.push({
      id: `logo-${entry.order}`,
      role: "logo",
      assetId: logoAssetId,
      startSeconds: 0.15,
      durationSeconds: Math.max(1.4, duration - 0.25),
      exitStartSeconds: duration,
      entrance: "pop",
      easing: "ease_out",
      priority: 12,
      width: 260,
      height: 150,
      x: layout.logo.x,
      y: layout.logo.y,
      shadow: true,
    });
  }

  if (headline) {
    elements.push({
      id: `headline-${entry.order}`,
      role: isLastScene ? "headline" : "headline",
      text: headline,
      startSeconds: isLastScene ? 0.62 : 0.46,
      durationSeconds: Math.max(1.1, duration - (isLastScene ? 0.92 : 0.86)),
      exitStartSeconds: isLastScene ? duration : Math.max(1, duration - 0.38),
      exitDurationSeconds: 0.26,
      entrance: textAnimation,
      exit: "fade",
      easing,
      priority: 20,
      x: layout.headline.x,
      y: layout.headline.y,
      shadow: true,
      glow: isLastScene,
      glass: isLastScene,
      syncToBeat: entry.name === "Gancho",
    });
  }

  // No end card, o subtítulo nunca vira um elemento próprio: seu conteúdo (a URL) já é carregado
  // pelo elemento de CTA abaixo — um elemento a mais repetindo a mesma frase é exatamente o
  // "fechamento técnico" que o end card premium deve evitar (poucos elementos, muito respiro:
  // logo, mockup, uma linha memorável e a URL — nada mais).
  if (subtitle && subtitle !== headline && !isLastScene) {
    elements.push({
      id: `subtitle-${entry.order}`,
      role: "subtitle",
      text: subtitle,
      startSeconds: isLastScene ? 1.05 : 1.08,
      durationSeconds: Math.max(1, duration - (isLastScene ? 1.35 : 1.38)),
      exitStartSeconds: isLastScene ? duration : Math.max(1.2, duration - 0.34),
      exitDurationSeconds: 0.24,
      entrance: index % 2 === 0 ? "slide_up" : "fade",
      exit: "fade",
      easing: "ease_out",
      priority: 30,
      x: layout.subtitle.x,
      y: layout.subtitle.y,
      shadow: true,
      glass: isLastScene,
    });
  }

  if (isLastScene) {
    const ctaText = subtitle && normalizeText(subtitle).includes("rumoaoaltar") ? subtitle : "rumoaoaltar.com.br";
    elements.push({
      id: `cta-${entry.order}`,
      role: "cta",
      text: ctaText,
      startSeconds: Math.max(1.45, duration - 2.45),
      durationSeconds: 2.35,
      exitStartSeconds: duration,
      entrance: "push",
      easing: "back_out",
      priority: 40,
      x: layout.cta.x,
      y: layout.cta.y,
      shadow: true,
      glow: true,
      glass: true,
      underline: true,
      syncToBeat: true,
    });
  }

  return {
    rhythm: classifyMotionRhythm(entry),
    elements,
    notes: [
      "Motion Composer ativo: cada elemento possui entrada própria, duração e easing.",
      `Direção de arte: ${entry.visualSceneDesign?.composition ?? "composição derivada da timeline"}.`,
      `Paleta de apoio preservada: ${input.brandColors.join(", ")}.`,
    ],
  };
}

function visualLayerRoleFor(
  entry: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"][number],
  isLastScene: boolean,
): VideoMotionElement["role"] {
  const priority = entry.visualSceneDesign?.assetPriority ?? entry.visualAssetRequirement?.assetPriority;
  if (isLastScene || priority === "brand_end_card") return "mockup";
  if (priority === "person_using_product" || priority === "context_photo" || priority === "conceptual_photo") return "main_image";
  return "mockup";
}

function buildMotionLayout(index: number, isLastScene: boolean, visualRole: VideoMotionElement["role"]): {
  visual: { x: number; y: number; width: number; height: number };
  headline: { x?: number; y: number };
  subtitle: { x?: number; y: number };
  cta: { x?: number; y: number };
  logo: { x?: number; y: number };
} {
  if (isLastScene) {
    // End card premium: mockup centralizado com margem simétrica (negative space real dos dois
    // lados), logo isolado no topo e headline/subtitle/CTA empilhados abaixo do mockup — nunca
    // sobrepostos a ele — deixando espaço negativo generoso ao final para não parecer lotado.
    return {
      visual: { x: 280, y: 320, width: 520, height: 680 },
      headline: { y: 1060 },
      subtitle: { y: 1320 },
      cta: { y: 1500 },
      logo: { x: 410, y: 110 },
    };
  }

  if (visualRole === "main_image") {
    const heroLayouts = [
      {
        visual: { x: 0, y: 0, width: 1080, height: 1920 },
        headline: { y: 205 },
        subtitle: { y: 335 },
        cta: { y: 1320 },
        logo: { y: 150 },
      },
      {
        visual: { x: 0, y: 0, width: 1080, height: 1920 },
        headline: { y: 185 },
        subtitle: { y: 315 },
        cta: { y: 1320 },
        logo: { y: 150 },
      },
      {
        visual: { x: 0, y: 0, width: 1080, height: 1920 },
        headline: { y: 1220 },
        subtitle: { y: 1360 },
        cta: { y: 1320 },
        logo: { y: 150 },
      },
    ];
    return heroLayouts[index % heroLayouts.length];
  }

  const layouts = [
    {
      visual: { x: 110, y: 330, width: 900, height: 1220 },
      headline: { y: 185 },
      subtitle: { y: 315 },
      cta: { y: 1320 },
      logo: { y: 150 },
    },
    {
      visual: { x: 285, y: 390, width: 720, height: 1110 },
      headline: { y: 210 },
      subtitle: { y: 345 },
      cta: { y: 1320 },
      logo: { y: 150 },
    },
    {
      visual: { x: 55, y: 405, width: 760, height: 1120 },
      headline: { y: 205 },
      subtitle: { y: 338 },
      cta: { y: 1320 },
      logo: { y: 150 },
    },
    {
      visual: { x: 250, y: 340, width: 780, height: 1160 },
      headline: { y: 230 },
      subtitle: { y: 365 },
      cta: { y: 1320 },
      logo: { y: 150 },
    },
    {
      visual: { x: 170, y: 430, width: 820, height: 1110 },
      headline: { y: 180 },
      subtitle: { y: 315 },
      cta: { y: 1320 },
      logo: { y: 150 },
    },
  ];

  return layouts[index % layouts.length];
}

/**
 * Antes desta evolução, `mask`/`glow`/`blur`/`motionBlur` (as 4 decisões booleanas "raras" de
 * Diego, nunca mais que uma ativa por cena — ver `DEVELOPMENT_EDIT_FLAVORS` na biblioteca
 * cinematográfica compartilhada) eram calculadas e devolvidas por `enrichEditingDecision`, mas
 * nunca chegavam a influenciar nada aqui — a escolha de entrada era só `index % 2`. Agora a
 * decisão real de Diego manda: cada flag mapeia para o efeito real correspondente implementado no
 * compilador (`timeline-to-filter-compiler.ts`), e só cai para a rotação por índice quando nenhuma
 * das quatro está ativa nesta cena.
 */
function mapTextAnimation(
  entry: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"][number],
  index: number,
  isLastScene: boolean,
): VideoMotionAnimation {
  if (entry.name === "Gancho") return "light_sweep";
  if (isLastScene) return "mask_reveal";
  const decision = entry.editingDecision;
  if (decision?.glow) return "glow_pulse";
  if (decision?.mask) return "mask_reveal";
  if (decision?.blur || decision?.motionBlur) return "blur_reveal";
  const animation = decision?.textAnimation;
  if (animation === "pop") return "pop";
  if (animation === "slide_up") return "slide_up";
  if (animation === "fade_in") return "fade";
  if (animation === "typewriter") return "mask_reveal";
  return index % 2 === 0 ? "slide_up" : "blur_reveal";
}

function visualEntranceFor(
  entry: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"][number],
  index: number,
  isLastScene: boolean,
  previousVisualEntrance?: VideoMotionAnimation,
): VideoMotionAnimation {
  if (isLastScene) return "slide_up";
  const decision = entry.editingDecision;
  if (decision?.glow) return "glow_pulse";
  if (decision?.mask) return "mask_reveal";
  if (decision?.whip) return "whip";
  if (decision?.pushIn) return "push";
  if (decision?.pullOut) return "pull";
  if (decision?.pan) return index % 2 === 0 ? "slide_left" : "slide_right";
  if (decision?.blur || decision?.motionBlur) return "blur_reveal";
  const rotation: VideoMotionAnimation[] = ["slide_up", "parallax", "blur_reveal"];
  const candidate = rotation[index % rotation.length];
  // Rede de segurança contra repetição: nunca deixa a MESMA entrada de duas cenas consecutivas
  // (mesmo que a rotação por índice coincida), sempre que houver uma alternativa na rotação.
  if (candidate !== previousVisualEntrance) return candidate;
  return rotation[(index + 1) % rotation.length];
}

function classifyMotionRhythm(entry: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"][number]): VideoMotionComposition["rhythm"] {
  const normalized = normalizeText(`${entry.name} ${entry.editingDecision?.rhythm ?? ""} ${entry.cutType ?? ""}`);
  if (normalized.includes("gancho") || normalized.includes("acelerado")) return "fast";
  if (normalized.includes("cta")) return "impact";
  if (normalized.includes("lento")) return "slow";
  return "medium";
}

function summarizeMotionCompositions(scenes: VideoRenderScene[]): RafaVideoMotionSummary {
  const elements = scenes.flatMap((scene) => scene.motion?.elements ?? []);
  const animatedElements = elements.filter((element) => element.entrance !== "none" || Boolean(element.exit));
  const sceneTransitions = scenes
    .map((scene) => scene.transitionToNext)
    .filter((value): value is VideoSceneTransition => Boolean(value));
  const transitionTypes = Array.from(new Set<string>([
    ...sceneTransitions,
    ...animatedElements.map((element) => element.entrance),
  ]));
  const elementAnimations = Array.from(new Set(animatedElements.map((element) => element.entrance)));
  const mockups = elements.filter((element) => element.role === "mockup");
  const assetRoles = Array.from(new Set(elements.filter((element) => element.assetId).map((element) => element.role)));
  const layoutPatterns = Array.from(new Set(scenes.map((scene) => layoutPatternForScene(scene))));
  const repeatedLayoutWarnings = Math.max(0, scenes.length - layoutPatterns.length);
  const maxHeadlineWords = Math.max(0, ...elements.filter((element) => element.role === "headline").map((element) => wordCount(element.text)));
  const maxSubtitleWords = Math.max(0, ...elements.filter((element) => element.role === "subtitle" || element.role === "caption").map((element) => wordCount(element.text)));
  const maxTextElementsPerScene = Math.max(0, ...scenes.map((scene) => (scene.motion?.elements ?? []).filter((element) => Boolean(element.text?.trim())).length));
  const mockupOnlySceneCount = scenes.filter((scene) => {
    const sceneAssetRoles = (scene.motion?.elements ?? []).filter((element) => element.assetId).map((element) => element.role);
    return sceneAssetRoles.length > 0 && sceneAssetRoles.every((role) => role === "mockup");
  }).length;
  const averageDepthLayers = scenes.length > 0
    ? Number((scenes.reduce((total, scene) => {
      const roles = new Set((scene.motion?.elements ?? []).map((element) => element.role));
      roles.add("background");
      return total + roles.size;
    }, 0) / scenes.length).toFixed(2))
    : 0;
  const simultaneousEntryWarnings = scenes.reduce((total, scene) => {
    const groups = new Map<string, number>();
    for (const element of scene.motion?.elements ?? []) {
      const key = element.startSeconds.toFixed(1);
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return total + [...groups.values()].filter((count) => count > 2).length;
  }, 0);

  return {
    scenes: scenes.length,
    totalAnimatedElements: animatedElements.length,
    totalIndependentAnimations: animatedElements.length,
    averageAnimatedElementsPerScene: scenes.length > 0 ? Number((animatedElements.length / scenes.length).toFixed(2)) : 0,
    transitionTypes,
    elementAnimations,
    maxStaticMockupSeconds: mockups.length > 0 ? 0.6 : Math.max(...scenes.map((scene) => scene.durationSeconds), 0),
    mockupElements: mockups.length,
    simultaneousEntryWarnings,
    assetRoles,
    layoutPatterns,
    repeatedLayoutWarnings,
    averageDepthLayers,
    maxHeadlineWords,
    maxSubtitleWords,
    maxTextElementsPerScene,
    mockupOnlySceneRatio: scenes.length > 0 ? Number((mockupOnlySceneCount / scenes.length).toFixed(2)) : 0,
  };
}

function layoutPatternForScene(scene: VideoRenderScene): string {
  const visualElement = (scene.motion?.elements ?? []).find((element) => Boolean(element.assetId) && element.role !== "logo");
  if (!visualElement) return "no-asset";
  const xBucket = Math.round((visualElement.x ?? 0) / 120);
  const yBucket = Math.round((visualElement.y ?? 0) / 120);
  const widthBucket = Math.round((visualElement.width ?? 0) / 120);
  return `${visualElement.role}:${xBucket}:${yBucket}:${widthBucket}`;
}

function wordCount(text: string | undefined): number {
  return text?.split(/\s+/).filter(Boolean).length ?? 0;
}

const INTERNAL_RENDER_TEXT_PATTERNS = [
  /desenvolver\s+a\s+mensagem-chave/i,
  /abertura\s+de\s+impacto/i,
  /conectad[ao]\s+ao\s+ângulo/i,
  /conectad[ao]\s+ao\s+angulo/i,
  /explica[cç][oõ]es?\s+estrat[eé]gicas?/i,
  /observa[cç][oõ]es?\s+de\s+roteiro/i,
  /instru[cç][oõ]es?\s+de\s+dire[cç][aã]o/i,
  /strategyNotes/i,
  /narrativePurpose/i,
  /directionNotes/i,
  /editorNotes/i,
  /internalDescription/i,
  /technicalJustification/i,
];

function sanitizeRenderableText(text: string | undefined, maxLength: number): string | undefined {
  const trimmed = text?.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  if (INTERNAL_RENDER_TEXT_PATTERNS.some((pattern) => pattern.test(trimmed))) return undefined;
  const words = trimmed.split(/\s+/).filter(Boolean);
  const maxWords = maxLength <= 52 ? 7 : 12;
  const limitedByWords = words.slice(0, maxWords).join(" ");
  const limited = limitedByWords.length <= maxLength ? limitedByWords : limitedByWords.slice(0, maxLength - 1).trim();
  return limited.length < trimmed.length ? `${limited}…` : limited;
}

/** Extrai só o nome do arquivo de um caminho absoluto, sem depender de `node:path` (Skills evitam módulos de I/O diretamente — ver ADR 0002). */
function extractFileName(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || absolutePath;
}

function buildProceduralBackground(colors: string[], index: number): VideoSceneBackground {
  const primary = colors[index % colors.length] ?? DEFAULT_BRAND_COLORS[0];
  return index % 2 === 0 ? { type: "gradient", colorTop: "#FFFFFF", colorBottom: primary } : { type: "solid", color: primary };
}

/**
 * Movimento de câmera nunca fica "none/none": mesmo quando Diego não decidiu explicitamente
 * push-in/pull-out/pan, Rafa aplica um zoom cinematográfico sutil por padrão — nenhum vídeo deve
 * parecer slideshow, mesmo partindo só de imagens estáticas. Quando `editingDecision` existe,
 * a decisão de Diego (push-in/pull-out/pan) é a autoridade; o índice da cena só decide a
 * variação (in/out, esquerda/direita) para dar ritmo entre cenas.
 */
function resolveMotion(
  decision: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"][number]["editingDecision"],
  index: number,
): { zoom: "in" | "out"; pan: "none" | "left_to_right" | "right_to_left" } {
  if (decision?.pushIn) return { zoom: "in", pan: "none" };
  if (decision?.pullOut) return { zoom: "out", pan: "none" };
  if (decision?.pan) return { zoom: "in", pan: index % 2 === 0 ? "left_to_right" : "right_to_left" };
  return { zoom: index % 2 === 0 ? "in" : "out", pan: "none" };
}

/**
 * Traduz a decisão explícita de transição de Diego (`editingDecision.transition`) para o tipo do
 * `VideoRenderingPort` — os valores já são idênticos por construção (`TransitionStyle` e
 * `VideoSceneTransition` compartilham o mesmo vocabulário). Só cai para a classificação por texto
 * livre quando `editingDecision` não estiver presente (compatibilidade com briefings antigos).
 */
function resolveTransition(
  decision: RafaVideoRenderingRequestInput["diegoEditingPlan"]["editingTimeline"][number]["editingDecision"],
  fallbackText: string | undefined,
): VideoSceneTransition {
  if (decision?.transition) return decision.transition as VideoSceneTransition;
  return classifyTransition(fallbackText);
}

function classifyTransition(text: string | undefined): VideoSceneTransition {
  if (!text) return "fade";
  const normalized = text.toLowerCase();
  if (normalized.includes("corte seco") || normalized.includes("sem fade") || normalized.includes("abrupto") || normalized.includes("corte final")) {
    return "cut";
  }
  return "fade";
}
