import type { ClaraKnowledgePort } from "../../application/knowledge/clara-knowledge.port.js";
import type { ClaraContextResponse, ClaraKnowledgeRecord } from "../../application/knowledge/clara.types.js";
import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { ValentinaTenantPort } from "../../application/tenancy/valentina-tenant.port.js";
import type { TenantClientContext } from "../../application/tenancy/valentina.types.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, latest, normalize, normalizeStringArray } from "../../shared/utils/skill-parsing.js";
import { areAspectRatiosEquivalent } from "../../shared/utils/aspect-ratio.js";
import { buildDeveloperAiPendingResponse, isDeveloperAssistancePending } from "../../shared/utils/developer-ai-assistance.js";
import type { DeveloperAssistancePendingOutput } from "../../application/ai/developer-assistance.types.js";
import { resolveContentQualityProfile, type ContentQualityProfile } from "../../shared/utils/content-quality-profile.js";
import { deriveCampaignCreativeDNA, isWeddingOrganizationTheme } from "../../shared/utils/creative-director-engine.js";
import { MIN_ACCEPTABLE_HUMAN_COVERAGE, MIN_ACCEPTABLE_ASSET_VARIETY } from "../../shared/utils/coverage/requirement-evaluator.js";
import { detectGenericPhrases } from "../../shared/utils/generic-phrase-detector.js";
import { detectUnconfirmedCommercialClaims } from "../../shared/utils/commercial-hallucination-detector.js";
import { hasStrongCommercialFact } from "../../shared/utils/reference-intelligence.types.js";
import { lucasQualityReviewManifest } from "./lucas.manifest.js";
import type { LucasLogAction, LucasLoggerPort } from "./lucas-log.contract.js";
import type {
  LucasChecklistItem,
  LucasIssue,
  LucasIssueCode,
  LucasIssueSeverity,
  LucasQualityReviewOutput,
  LucasQualityReviewRequestInput,
  LucasReviewEnhancement,
  LucasReviewStatus,
  LucasSuggestion,
} from "./lucas-quality-review.types.js";

export type LucasIdGenerator = {
  create(prefix: string): string;
};

export type LucasQualityReviewSkillDependencies = {
  valentina: ValentinaTenantPort;
  clara: ClaraKnowledgePort;
  icaro?: IcaroBrainPort;
  logger?: LucasLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: LucasIdGenerator;
  now?: () => Date;
  approvalScoreThreshold?: number;
  warningScoreThreshold?: number;
  adjustmentScoreThreshold?: number;
};

const BLOCKING_ISSUE_CODES = new Set<LucasIssueCode>([
  "NO_IMAGES_GENERATED",
  "FORBIDDEN_WORD_FOUND",
  "FORBIDDEN_HASHTAG_FOUND",
  "NO_VIDEO_FILE",
  "VIDEO_INTERNAL_TEXT_VISIBLE",
  "VIDEO_NARRATION_MISSING",
  "VIDEO_NARRATION_AUDIO_INVALID",
  // Prova estrutural de "parece slideshow": as mesmas cenas de desenvolvimento saíram com decisão
  // de edição byte-idêntica (transição, animação de texto, máscara, glow, blur) — nunca deveria
  // acontecer com o rateio por `beatIndex` (ver cinematic-reference-library.ts); se acontecer,
  // é sinal de regressão real, não apenas de nota baixa.
  "VIDEO_SCENE_DECISIONS_DUPLICATED",
  // Excesso de mockup estático dominando o vídeo é, por si só, a definição de "parece apresentação".
  "VIDEO_MOCKUP_PRESENTATION",
  // PRODUCTION READINESS — "Caso qualquer índice esteja abaixo do mínimo: Reprovar
  // automaticamente." Qualquer um dos cinco reprova, independente da nota agregada.
  "PRODUCTION_READINESS_LOW",
  "PRODUCTION_ASSET_DIVERSITY_LOW",
  "PRODUCTION_HUMAN_PRESENCE_LOW",
  "PRODUCTION_SCENE_VARIETY_LOW",
  "PRODUCTION_SHOT_VARIETY_LOW",
  // PRODUCT COMPOSITING ENGINE — tela colada/deformada, funcionalidade errada ou origem sem
  // licença nunca podem passar só porque a nota geral ficou alta.
  "COMPOSITED_SCREEN_PERSPECTIVE_INCOHERENT",
  "COMPOSITED_SCREEN_FUNCTIONALITY_MISMATCH",
  "COMPOSITED_SCREEN_ORIGIN_UNLICENSED",
  // INTENT-BASED FOOTAGE ACQUISITION — um Shot cuja intenção real não foi atendida nunca deveria
  // passar só porque a nota geral do vídeo ficou alta.
  "SHOT_INTENT_NOT_SATISFIED",
  // REFERENCE INTELLIGENCE — requisito "REJECT_AUTOMATICALLY" para falha crítica de fidelidade ao
  // produto de referência ou alucinação comercial. A peça não deve chegar ao usuário nesses casos,
  // independente da nota agregada.
  "PRODUCT_FIDELITY_MISMATCH",
  "COMMERCIAL_HALLUCINATION_DETECTED",
]);

const SEVERITY_PENALTY: Record<LucasIssueSeverity, number> = {
  high: 20,
  medium: 10,
  low: 5,
};

// Mesmo limiar que Rafa já usa para rejeitar placeholders de vídeo (MP4_MIN_SIZE_BYTES em
// rafa-video-rendering.skill.ts) — Lucas reaplica a mesma checagem de defesa em profundidade,
// sem importar nada do Rafa (ADR 0002).
const MIN_VIDEO_SIZE_BYTES = 100 * 1024;
const MAX_ON_SCREEN_TEXT_LENGTH = 52;
// Espelha por convenção o limite de palavras que Bruno já aplica ao gerar `onScreenText`/
// `captionText` (ONSCREEN_HEADLINE_MAX_WORDS/ONSCREEN_COMPLEMENT_MAX_WORDS em
// bruno-video-script.skill.ts) — Lucas reaplica o mesmo limite em profundidade, sem importar
// nada do Bruno (ADR 0002), para pegar excesso de texto que escapou de qualquer etapa.
const MAX_ON_SCREEN_HEADLINE_WORDS = 4;
const MAX_ON_SCREEN_COMPLEMENT_WORDS = 6;

class SequentialLucasIdGenerator implements LucasIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopLucasLogger implements LucasLoggerPort {
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
      throw new Error(`${portName} não configurado para Lucas.`);
    },
  });
}

/** Une a saída normal de Lucas à pausa aguardando IA desenvolvedora, mesmo padrão de `PedroSkillOutput`. */
export type LucasSkillOutput = LucasQualityReviewOutput | DeveloperAssistancePendingOutput;

export class LucasQualityReviewSkill implements Skill<LucasQualityReviewRequestInput, LucasSkillOutput> {
  readonly manifest = lucasQualityReviewManifest;

  private readonly valentina: ValentinaTenantPort;
  private readonly clara: ClaraKnowledgePort;
  private readonly icaro?: IcaroBrainPort;
  private readonly logger: LucasLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: LucasIdGenerator;
  private readonly now: () => Date;
  private readonly approvalScoreThreshold: number;
  private readonly warningScoreThreshold: number;
  private readonly adjustmentScoreThreshold: number;

  constructor(dependencies: LucasQualityReviewSkillDependencies) {
    this.valentina = dependencies.valentina;
    this.clara = dependencies.clara;
    this.icaro = dependencies.icaro;
    this.logger = dependencies.logger ?? new NoopLucasLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialLucasIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
    this.approvalScoreThreshold = dependencies.approvalScoreThreshold ?? 90;
    this.warningScoreThreshold = dependencies.warningScoreThreshold ?? 70;
    this.adjustmentScoreThreshold = dependencies.adjustmentScoreThreshold ?? 40;
  }

  async execute(request: SkillRequest<LucasQualityReviewRequestInput>): Promise<SkillResponse<LucasSkillOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de revisão de qualidade inválida.", request, { errors: validationErrors });
      await this.emit("QualityReviewFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
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
      return await this.runReview(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante a revisão de qualidade.";
      await this.log("Error", `Erro inesperado em Lucas. ${message}`, request, { error: message });
      await this.emit("QualityReviewFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runReview(request: SkillRequest<LucasQualityReviewRequestInput>): Promise<SkillResponse<LucasSkillOutput>> {
    await this.log("RequestReceived", "Solicitação de revisão de qualidade recebida por Lucas.", request, {
      channel: request.input.channel,
      format: request.input.format,
    });
    await this.emit("QualityReviewStarted", request, { channel: request.input.channel });

    let tenant: TenantClientContext;
    try {
      tenant = await this.resolveClient(request.input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao resolver cliente na Valentina.";
      await this.log("ClientNotFound", message, request, { error: message });
      await this.emit("QualityReviewFailed", request, { reason: "CLIENT_NOT_FOUND", error: message });
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
      requester: { id: this.manifest.id, type: "specialist", name: "Lucas" },
      clientId: tenant.clientId,
      modules: ["BrandContext", "IdentityContext", "PublishingContext"],
      reason: "Revisão de qualidade do pacote de publicação antes da aprovação humana.",
    });

    await this.log("ContextConsulted", `Contexto de marca consultado na Clara para o cliente ${tenant.clientId}.`, request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });
    await this.emit("QualityContextLoaded", request, {
      clientId: tenant.clientId,
      totalRecords: claraContext.records.length,
      modules: Object.keys(claraContext.modules),
    });

    const completeness = evaluateBrandContextCompleteness(claraContext);
    if (!completeness.sufficient) {
      await this.log("ContextIncomplete", "Contexto de marca insuficiente na Clara para revisar com segurança.", request, {
        clientId: tenant.clientId,
        missing: completeness.missing,
      });
      await this.emit("QualityReviewFailed", request, {
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
          `Contexto de marca insuficiente na Clara para o cliente ${tenant.clientId}.`,
          ...completeness.missing.map((item) => `Faltando na Clara: ${item}.`),
        ],
      };
    }

    await this.log("ReviewStarted", "Revisão de qualidade iniciada.", request, { clientId: tenant.clientId });

    // Checagem REAL de fidelidade visual (requisito "o produto gerado corresponde ao produto
    // enviado?") — roda ANTES do baseline pra entrar como mais um sinal na mesma passada síncrona
    // de scoring/status/checklist, em vez de precisar recalcular tudo depois. Best-effort: sem
    // `icaro`, sem `referenceIntelligence` ou sem imagem gerada, fica `undefined` — "não verificado"
    // nunca é tratado como "reprovado".
    const productFidelityVerdict = await this.checkProductFidelity(request);

    let review = buildBaselineReview(request.input, claraContext, {
      approvalScoreThreshold: this.approvalScoreThreshold,
      warningScoreThreshold: this.warningScoreThreshold,
      adjustmentScoreThreshold: this.adjustmentScoreThreshold,
    }, productFidelityVerdict);

    await this.log("ChecklistValidated", "Checklist de revisão validado.", request, {
      clientId: tenant.clientId,
      checklistPassed: review.checklist.filter((item) => item.passed).length,
      checklistTotal: review.checklist.length,
    });
    await this.emit("QualityChecklistValidated", request, {
      clientId: tenant.clientId,
      score: review.overallScore,
      status: review.reviewStatus,
    });

    let aiSupportUsed = false;
    let aiProviderId: string | undefined;
    if (this.icaro) {
      await this.log("AISupportRequested", "Apoio de IA solicitado ao Ícaro para complementar a revisão.", request, { clientId: tenant.clientId });
      await this.emit("AIGenerationStarted", request, { clientId: tenant.clientId, channel: request.input.channel });

      try {
        const prompt = buildIcaroReviewPrompt(request.input, review);
        const aiResponse = await this.icaro.request({
          taskType: "review",
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
            "Não alterar copy, imagem, score, status ou checklist; apenas complementar observações e sugestões.",
          ],
          expectedOutput: "json",
          priority: "quality",
          temperature: 0.5,
          maxTokens: 900,
        });

        if (aiResponse.status !== "completed") {
          throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para Lucas.");
        }

        const enhancement = parseReviewEnhancement(String(aiResponse.content ?? ""));
        review = mergeReviewEnhancement(review, enhancement);
        aiSupportUsed = true;
        aiProviderId = aiResponse.provider.id;

        await this.log("AISupportApplied", "Apoio de IA aplicado à revisão.", request, { clientId: tenant.clientId });
        await this.emit("AIGenerationFinished", request, {
          clientId: tenant.clientId,
          provider: aiResponse.provider,
          model: aiResponse.model,
        });
      } catch (error) {
        if (isDeveloperAssistancePending(error)) {
          return buildDeveloperAiPendingResponse(this.manifest.id, request.context.taskId, error);
        }
        const message = error instanceof Error ? error.message : "Erro desconhecido no apoio de IA solicitado por Lucas.";
        await this.log("AISupportFailed", `Apoio de IA falhou; revisão segue apenas com a checklist heurística. ${message}`, request, {
          clientId: tenant.clientId,
          error: message,
        });
      }
    } else {
      await this.log("AISupportSkipped", "Ícaro não foi configurado; revisão segue apenas com a checklist heurística.", request, {
        clientId: tenant.clientId,
      });
    }

    await this.log("ReviewFinished", "Revisão de qualidade finalizada.", request, {
      clientId: tenant.clientId,
      status: review.reviewStatus,
      score: review.overallScore,
    });
    await this.emit("QualityReviewFinished", request, {
      clientId: tenant.clientId,
      status: review.reviewStatus,
      score: review.overallScore,
      approvalRecommended: review.approvalRecommended,
    });

    const output: LucasQualityReviewOutput = { ...review, aiSupportUsed, aiProviderId };

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "completed",
      output,
      artifacts: [
        {
          id: this.idGenerator.create("artifact"),
          type: "plan",
          name: "Relatório de revisão de qualidade de Lucas",
          status: review.reviewStatus === "rejected" ? "failed" : "ready",
          metadata: {
            clientId: tenant.clientId,
            channel: request.input.channel,
            reviewStatus: review.reviewStatus,
            overallScore: review.overallScore,
          },
        },
      ],
      warnings: review.issues.filter((issue) => issue.severity === "high").map((issue) => issue.message),
    };
  }

  private async resolveClient(input: LucasQualityReviewRequestInput): Promise<TenantClientContext> {
    if (input.tenantId?.trim()) {
      return this.valentina.getClientContext(input.tenantId);
    }

    const tenant = await this.valentina.getTenant({ clientId: input.clientId, status: "all" });
    if (!tenant) {
      throw new Error(`Valentina não encontrou o cliente ${input.clientId}.`);
    }

    return this.valentina.getClientContext(tenant.id);
  }

  /**
   * Checagem REAL de fidelidade visual: compara a imagem GERADA com a(s) imagem(ns) de
   * REFERÊNCIA de verdade, via visão (`imageUrls` no pedido ao Ícaro — ver `AIProviderRequest.
   * imageUrls`/`OpenAiIcaroTextProvider`), não um proxy estrutural. Best-effort: qualquer falha
   * (sem `icaro`, sem referência, sem imagem gerada, erro de rede, resposta ilegível) devolve
   * `undefined` — "não foi possível verificar" nunca vira "reprovado automaticamente", só
   * `PRODUCT_FIDELITY_MISMATCH` (um veredito EXPLÍCITO de incompatibilidade) reprova.
   */
  private async checkProductFidelity(request: SkillRequest<LucasQualityReviewRequestInput>): Promise<{ mismatch: boolean; reasoning?: string } | undefined> {
    const referenceIntelligence = request.input.referenceIntelligence;
    const generatedImageUrl = request.input.pedroImages?.images?.[0]?.uri;
    if (!this.icaro || !referenceIntelligence || !generatedImageUrl) return undefined;

    const referenceImageUrl = typeof request.input.workflowContext?.referenceImageUrl === "string" ? request.input.workflowContext.referenceImageUrl : undefined;
    if (!referenceImageUrl) return undefined;

    try {
      const facts = referenceIntelligence.verifiedFacts;
      const productLabel = facts.productName ?? facts.productType ?? "o produto da primeira imagem";
      const prompt = [
        `Compare as DUAS imagens anexadas: a PRIMEIRA é a imagem de REFERÊNCIA real do produto (${productLabel}); a SEGUNDA é uma imagem GERADA por IA que deveria retratar fielmente o MESMO produto.`,
        "Responda apenas com JSON válido, sem markdown, no formato exato: {\"mismatch\": true|false, \"reasoning\": \"1 frase objetiva\"}.",
        "\"mismatch\": true quando a imagem gerada mostra um produto de cor, formato, categoria ou marca claramente DIFERENTE do produto de referência (ex.: cor errada, tipo de produto errado, modelo diferente). \"mismatch\": false quando o produto gerado é reconhecivelmente o MESMO produto, mesmo com cenário/fundo/composição diferentes (isso é esperado e correto).",
      ].join("\n");

      const response = await this.icaro.request({
        taskType: "review",
        prompt,
        specialistId: this.manifest.id,
        executionId: request.context.executionId,
        taskId: request.context.taskId,
        correlationId: request.context.correlationId,
        context: { skillId: this.manifest.id, clientId: request.input.clientId },
        imageUrls: [referenceImageUrl, generatedImageUrl],
        expectedOutput: "json",
        priority: "quality",
        temperature: 0.2,
        maxTokens: 200,
        timeoutMs: 25_000,
      });

      if (response.status !== "completed") return undefined;
      const parsed = JSON.parse(extractJson(String(response.content ?? ""), "Lucas (fidelidade de produto)")) as { mismatch?: unknown; reasoning?: unknown };
      if (typeof parsed.mismatch !== "boolean") return undefined;
      return { mismatch: parsed.mismatch, reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined };
    } catch {
      return undefined;
    }
  }

  private async log(
    action: LucasLogAction,
    message: string,
    request: SkillRequest<LucasQualityReviewRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("lucas-log"),
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
    request: SkillRequest<LucasQualityReviewRequestInput>,
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
        source: "lucas",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateRequestInput(input: LucasQualityReviewRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de revisão é obrigatória."];
  if (!input.clientId?.trim() && !input.tenantId?.trim()) errors.push("clientId ou tenantId é obrigatório.");
  if (!input.originalRequest?.trim()) errors.push("originalRequest é obrigatório.");
  if (!input.channel?.trim()) errors.push("channel é obrigatório.");
  if (!input.format?.trim()) errors.push("format é obrigatório.");
  if (!input.joaoStrategy || typeof input.joaoStrategy !== "object" || !input.joaoStrategy.objective?.trim()) {
    errors.push("joaoStrategy é obrigatório e precisa conter ao menos objective.");
  }
  if (!input.mariaCopy || typeof input.mariaCopy !== "object") {
    errors.push("mariaCopy é obrigatório.");
  }

  // sofiaDirection/biancaDesign/pedroImages só existem quando o plano de Arthur incluiu etapas
  // visuais (Sofia/Bianca/Pedro) — uma campanha somente-texto nunca as recebe, e isso não é um
  // erro. Se qualquer uma vier preenchida, porém, as três precisam vir completas: dado parcial
  // indicaria uma falha real de encadeamento entre as etapas.
  if (hasVisualComponent(input)) {
    if (!input.sofiaDirection || typeof input.sofiaDirection !== "object" || !input.sofiaDirection.visualConcept?.trim()) {
      errors.push("sofiaDirection é obrigatório e precisa conter ao menos visualConcept quando há componente visual.");
    }
    if (!input.biancaDesign || typeof input.biancaDesign !== "object" || !input.biancaDesign.designConcept?.trim()) {
      errors.push("biancaDesign é obrigatório e precisa conter ao menos designConcept quando há componente visual.");
    }
    if (!input.pedroImages || typeof input.pedroImages !== "object" || !Array.isArray(input.pedroImages.images)) {
      errors.push("pedroImages é obrigatório e precisa conter a lista de imagens quando há componente visual.");
    }
  }

  // brunoScript/vanessaDirection/diegoEditingPlan só existem quando o comando aciona a pipeline
  // de vídeo — mesmo raciocínio do componente visual (hasVisualComponent). rafaVideo é a exceção
  // deliberada: sua ausência é um cenário de revisão válido (vídeo ainda não renderizado/salvo),
  // não um erro de validação — ver NO_VIDEO_FILE em evaluateVideoFile.
  if (hasVideoComponent(input)) {
    if (!input.brunoScript || typeof input.brunoScript !== "object" || !Array.isArray(input.brunoScript.scenes) || input.brunoScript.scenes.length === 0) {
      errors.push("brunoScript é obrigatório e precisa conter ao menos uma cena quando há componente de vídeo.");
    }
    if (!input.vanessaDirection || typeof input.vanessaDirection !== "object" || !Array.isArray(input.vanessaDirection.sceneDirections) || input.vanessaDirection.sceneDirections.length === 0) {
      errors.push("vanessaDirection é obrigatório e precisa conter ao menos uma direção de cena quando há componente de vídeo.");
    }
    if (!input.diegoEditingPlan || typeof input.diegoEditingPlan !== "object" || !Array.isArray(input.diegoEditingPlan.editingTimeline) || input.diegoEditingPlan.editingTimeline.length === 0) {
      errors.push("diegoEditingPlan é obrigatório e precisa conter ao menos um trecho de timeline quando há componente de vídeo.");
    }
  }
  return errors;
}

/** Verdadeiro quando ao menos um artefato visual (Sofia/Bianca/Pedro) foi recebido. */
function hasVisualComponent(input: LucasQualityReviewRequestInput): boolean {
  return Boolean(input.sofiaDirection || input.biancaDesign || input.pedroImages);
}

/** Verdadeiro quando ao menos um artefato da pipeline de vídeo (Bruno/Vanessa/Diego/Rafa) foi recebido. */
function hasVideoComponent(input: LucasQualityReviewRequestInput): boolean {
  return Boolean(input.brunoScript || input.vanessaDirection || input.diegoEditingPlan || input.rafaVideo);
}

function evaluateBrandContextCompleteness(context: ClaraContextResponse): { sufficient: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!context.modules.IdentityContext?.length) missing.push("IdentityContext");
  if (!context.modules.BrandContext?.length) missing.push("BrandContext");

  return {
    sufficient: !(missing.includes("IdentityContext") && missing.includes("BrandContext")),
    missing,
  };
}

type ReviewThresholds = {
  approvalScoreThreshold: number;
  warningScoreThreshold: number;
  adjustmentScoreThreshold: number;
};

type LucasReviewCore = Omit<LucasQualityReviewOutput, "aiSupportUsed">;

export function buildBaselineReview(
  input: LucasQualityReviewRequestInput,
  context: ClaraContextResponse,
  thresholds: ReviewThresholds,
  productFidelityVerdict?: { mismatch: boolean; reasoning?: string },
): LucasReviewCore {
  const brand = latest(context.modules.BrandContext);
  const issues: LucasIssue[] = [];
  const qualityProfile = resolveContentQualityProfile(input.format);

  evaluateStrategy(input, issues);
  evaluateCopy(input, issues);
  evaluateVisual(input, issues);
  evaluateImages(input, issues);
  evaluateCoherence(input, issues);
  evaluateProductFidelity(productFidelityVerdict, issues);
  evaluateCommercialHallucination(input, issues);
  evaluateCommercialFactUtilization(input, issues);
  evaluateCopySpecificity(input, issues);
  evaluateTone(input, brand, issues);
  evaluateCta(input, issues);
  evaluateBrandRules(input, brand, issues);
  evaluateRisks(input, issues);
  evaluateFormatProfile(input, qualityProfile, issues);
  evaluateVideoCoherence(input, issues);
  evaluateVideoDuration(input, issues);
  evaluateVideoFormat(input, issues);
  evaluateVideoHook(input, issues);
  evaluateVideoCta(input, issues);
  evaluateVideoRhythm(input, issues);
  evaluateVideoThemePreservation(input, issues);
  evaluateCreativeDnaIdentity(input, issues);
  evaluateVideoInternalTextLeak(input, issues);
  evaluateVideoEndCard(input, issues);
  evaluateVideoOnScreenTextLegibility(input, issues);
  evaluateVideoSceneDesign(input, issues);
  evaluateVideoMotionDesign(input, issues);
  evaluateProductionReadinessGate(input, issues);
  evaluateCompositedProductFootageGate(input, issues);
  evaluateShotIntentGate(input, issues);
  evaluateCompositingVerificationGate(input, issues);
  evaluateVideoSceneDecisionsDuplicated(input, issues);
  evaluateVideoRhythmMonotonous(input, issues);
  evaluateVideoSceneTooLong(input, issues);
  evaluateVideoFramingRepetitive(input, issues);
  evaluateVideoNarration(input, issues);
  evaluateVideoFile(input, issues);
  evaluateAgencyFilmPipelineShots(input, issues);

  const overallScore = computeScore(issues);
  const reviewStatus = determineReviewStatus(overallScore, issues, thresholds);
  const approvalRecommended = reviewStatus === "approved" || reviewStatus === "approved_with_warnings";
  const checklist = buildChecklist(issues, overallScore, thresholds, qualityProfile);
  const suggestions = buildSuggestions(issues);
  const risks = buildRisks(input, issues);
  const observations = buildObservations(input, context);
  const nextSteps = buildNextSteps(reviewStatus);

  return {
    reviewStatus,
    overallScore,
    approvalRecommended,
    issues,
    suggestions,
    risks,
    checklist,
    observations,
    nextSteps,
    qualityProfile,
  };
}

/**
 * Critérios próprios de cada formato — a mudança central deste refinamento. Story não é penalizado
 * pelos critérios de Feed (legenda longa, CTA extenso, 15+ hashtags, convite para comentar/salvar —
 * ver `evaluateCopy`/o score que a Maria já reporta em `mariaCopy.qualityScore`, agora também
 * sensível a formato); aqui Lucas cobre o que é da sua própria alçada de revisão (progressão entre
 * slides, presença do pacote de vídeo) em vez de duplicar toda a heurística textual da Maria.
 */
function evaluateFormatProfile(input: LucasQualityReviewRequestInput, profile: ContentQualityProfile, issues: LucasIssue[]): void {
  if (profile === "story") {
    const captionLength = input.mariaCopy.caption?.trim().length ?? 0;
    const ctaLength = input.mariaCopy.cta?.trim().length ?? 0;
    if (captionLength > 300) {
      issues.push(issue("STORY_CAPTION_TOO_LONG", "copy", `Legenda longa demais para Story (${captionLength} caracteres); Story pede texto curto e leitura imediata.`, "medium"));
    }
    if (ctaLength > 40) {
      issues.push(issue("STORY_CTA_TOO_LONG", "cta", `CTA longo demais para Story (${ctaLength} caracteres); Story pede CTA curto.`, "medium"));
    }
    const caption = input.mariaCopy.caption ?? "";
    if (caption.trim() && !caption.includes("?") && !hasCuriosityKeyword(caption)) {
      issues.push(issue("STORY_MISSING_CURIOSITY", "copy", "Legenda de Story não gera curiosidade imediata.", "low"));
    }
  }

  if (profile === "carrossel") {
    const slideCount = input.pedroImages?.imageCount ?? input.biancaDesign?.slides.length ?? 0;
    if (slideCount > 0 && slideCount < 3) {
      issues.push(issue("CARROSSEL_INSUFFICIENT_PROGRESSION", "visual", `Carrossel com apenas ${slideCount} slide(s); progressão entre slides pede ao menos 3.`, "medium"));
    }
    if (!input.mariaCopy.cta?.trim()) {
      issues.push(issue("CARROSSEL_MISSING_FINAL_CTA", "cta", "Carrossel sem CTA final definido para fechar a progressão entre slides.", "medium"));
    }
  }

  if ((profile === "reels" || profile === "video") && !hasVideoComponent(input)) {
    issues.push(issue(
      "MISSING_VIDEO_PACKAGE_FOR_FORMAT",
      "coherence",
      `Formato ${profile === "reels" ? "Reels" : "vídeo"} sem pacote de roteiro/direção/edição (Bruno/Vanessa/Diego) para avaliar hook, ritmo e encerramento.`,
      "medium",
    ));
  }
}

function hasCuriosityKeyword(text: string): boolean {
  return /(sabia|sera que|descubra|imagina|adivinha|curioso|curiosidade)/.test(normalize(text));
}

function evaluateStrategy(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!input.joaoStrategy.keyMessages || input.joaoStrategy.keyMessages.length === 0) {
    issues.push(issue("WEAK_STRATEGY_KEY_MESSAGES", "strategy", "A estratégia não possui mensagens principais definidas.", "medium"));
  }
}

function evaluateCopy(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!input.mariaCopy.title?.trim()) issues.push(issue("COPY_MISSING_TITLE", "copy", "A copy não possui título.", "high"));
  if (!input.mariaCopy.caption?.trim()) issues.push(issue("COPY_MISSING_CAPTION", "copy", "A copy não possui legenda.", "high"));
  if (typeof input.mariaCopy.qualityScore === "number" && input.mariaCopy.qualityScore < 70) {
    issues.push(issue("COPY_LOW_QUALITY_SCORE", "copy", `A copy foi entregue pela Maria com score de qualidade baixo (${input.mariaCopy.qualityScore}).`, "medium"));
  }
}

function evaluateVisual(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!input.sofiaDirection) return;
  if (!input.sofiaDirection.visualConcept?.trim()) {
    issues.push(issue("VISUAL_CONCEPT_MISSING", "visual", "A direção visual não possui conceito definido.", "high"));
  }
}

function evaluateImages(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!input.pedroImages) return;
  if (input.pedroImages.imageCount <= 0 || input.pedroImages.images.length === 0) {
    issues.push(issue("NO_IMAGES_GENERATED", "visual", "Nenhuma imagem foi gerada pelo Pedro para este pacote.", "high"));
    return;
  }
  if (input.pedroImages.images.length !== input.pedroImages.imageCount) {
    issues.push(issue("IMAGE_COUNT_MISMATCH", "visual", `Foram declaradas ${input.pedroImages.imageCount} imagem(ns), mas ${input.pedroImages.images.length} foram recebidas.`, "medium"));
  }
}

function evaluateCoherence(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (input.sofiaDirection && normalize(input.sofiaDirection.recommendedFormat) !== normalize(input.format)) {
    issues.push(issue("FORMAT_MISMATCH", "coherence", `Formato recomendado pela Sofia ("${input.sofiaDirection.recommendedFormat}") diverge do formato solicitado ("${input.format}").`, "low"));
  }
  if (normalize(input.joaoStrategy.channel) !== normalize(input.channel)) {
    issues.push(issue("CHANNEL_MISMATCH", "coherence", `Canal da estratégia do João ("${input.joaoStrategy.channel}") diverge do canal solicitado ("${input.channel}").`, "medium"));
  }
  const firstImage = input.pedroImages?.images[0];
  if (
    firstImage?.aspectRatio &&
    input.sofiaDirection?.recommendedAspectRatio &&
    !areAspectRatiosEquivalent(firstImage.aspectRatio, input.sofiaDirection.recommendedAspectRatio)
  ) {
    issues.push(issue("ASPECT_RATIO_MISMATCH", "coherence", `Proporção da imagem gerada ("${firstImage.aspectRatio}") diverge da proporção recomendada pela Sofia ("${input.sofiaDirection.recommendedAspectRatio}").`, "low"));
  }
}

// REFERENCE INTELLIGENCE — requisito "quality gate obrigatório": fidelidade ao produto, alucinação
// comercial, fato comercial ignorado e genericidade da copy. Todas com guarda de ausência no
// início (mesmo padrão de `evaluateVisual`/`sofiaDirection`) — sem Reference Intelligence
// disponível, nenhuma delas dispara, comportamento idêntico a antes desta funcionalidade existir.

/** Fidelidade ao produto (checagem REAL de visão, não proxy) — `verdict` vem de
 * `LucasQualityReviewSkill.checkProductFidelity`, já resolvido de forma best-effort antes de
 * `buildBaselineReview` ser chamado. `undefined` = não foi possível verificar (sem Ícaro, sem
 * Reference Intelligence, sem imagem gerada, ou a própria chamada falhou) — nunca tratado como
 * reprovação, só um veredito EXPLÍCITO de incompatibilidade reprova. */
function evaluateProductFidelity(verdict: { mismatch: boolean; reasoning?: string } | undefined, issues: LucasIssue[]): void {
  if (!verdict?.mismatch) return;
  issues.push(issue(
    "PRODUCT_FIDELITY_MISMATCH",
    "fidelity",
    `O produto na imagem gerada não corresponde ao produto da imagem de referência${verdict.reasoning ? `: ${verdict.reasoning}` : "."}`,
    "high",
  ));
}

/** Alucinação comercial: condição comercial afirmada na copy sem confirmação (estoque limitado,
 * garantia, frete grátis sem evidência, avaliações, etc.) — proibido inventar. */
function evaluateCommercialHallucination(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  const facts = input.referenceIntelligence?.commercialFacts;
  const found = [
    ...detectUnconfirmedCommercialClaims(input.mariaCopy.title, facts),
    ...detectUnconfirmedCommercialClaims(input.mariaCopy.caption, facts),
  ];
  if (found.length === 0) return;
  issues.push(issue(
    "COMMERCIAL_HALLUCINATION_DETECTED",
    "commercial",
    `Condição comercial não confirmada na copy, sem evidência na referência: "${found[0]}".`,
    "high",
  ));
}

/** Fato comercial ignorado: havia um argumento comercial forte (preço/desconto/oferta) disponível
 * na referência, mas o título/legenda ficou genérico em vez de usar o dado concreto — requisito de
 * hierarquia de fatos comerciais ("nunca usar manchete genérica quando existir argumento comercial
 * concreto muito mais forte"). */
function evaluateCommercialFactUtilization(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  const facts = input.referenceIntelligence?.commercialFacts;
  if (!hasStrongCommercialFact(facts)) return;

  const titleAndCaption = `${input.mariaCopy.title} ${input.mariaCopy.caption}`;
  const mentionsCommercialFact = [facts?.currentPrice, facts?.discountPercent, facts?.promotion]
    .filter((value): value is string => Boolean(value))
    .some((value) => titleAndCaption.includes(value));
  if (mentionsCommercialFact) return;

  issues.push(issue(
    "COMMERCIAL_FACT_IGNORED",
    "commercial",
    "Havia um fato comercial forte disponível na referência (preço/desconto/oferta), mas a copy não o utilizou.",
    "high",
  ));
}

/** Teste da "logo removida": título/legenda dominados por clichê e sem nenhuma especificidade de
 * produto/marca poderiam pertencer a qualquer outra empresa — reaproveita `detectGenericPhrases`
 * (já usado pela Maria no próprio loop de regeneração; aqui é a segunda camada, no quality gate). */
function evaluateCopySpecificity(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  const genericPhrases = [...detectGenericPhrases(input.mariaCopy.title), ...detectGenericPhrases(input.mariaCopy.caption)];
  if (genericPhrases.length === 0) return;
  issues.push(issue(
    "GENERIC_CLICHE_IN_COPY",
    "copy",
    `Copy genérica detectada — poderia pertencer a qualquer outra empresa: "${genericPhrases[0]}".`,
    "high",
  ));
}

function evaluateTone(input: LucasQualityReviewRequestInput, brand: ClaraKnowledgeRecord<"BrandContext"> | undefined, issues: LucasIssue[]): void {
  const expectedTone = brand?.payload.toneOfVoice ?? input.joaoStrategy.toneOfVoice;
  if (!expectedTone || !input.mariaCopy.toneUsed) return;
  if (!containsAnyComparable(input.mariaCopy.toneUsed, expectedTone.split(/\s+/))) {
    issues.push(issue("TONE_INCONSISTENT", "tone", `Tom de voz usado na copy ("${input.mariaCopy.toneUsed}") não parece consistente com o tom esperado ("${expectedTone}").`, "medium"));
  }
}

function evaluateCta(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!input.mariaCopy.cta || !input.joaoStrategy.recommendedCta) return;
  if (!containsComparable(input.mariaCopy.cta, input.joaoStrategy.recommendedCta) && !containsComparable(input.joaoStrategy.recommendedCta, input.mariaCopy.cta)) {
    issues.push(issue("CTA_DIVERGENT", "cta", `CTA da copy ("${input.mariaCopy.cta}") diverge do CTA recomendado pela estratégia ("${input.joaoStrategy.recommendedCta}").`, "medium"));
  }
}

function evaluateBrandRules(input: LucasQualityReviewRequestInput, brand: ClaraKnowledgeRecord<"BrandContext"> | undefined, issues: LucasIssue[]): void {
  const combinedText = `${input.mariaCopy.title ?? ""} ${input.mariaCopy.caption ?? ""} ${collectVideoText(input)}`;
  for (const forbiddenWord of brand?.payload.forbiddenWords ?? []) {
    if (containsComparable(combinedText, forbiddenWord)) {
      issues.push(issue("FORBIDDEN_WORD_FOUND", "brand", `Termo proibido pela marca encontrado na copy: "${forbiddenWord}".`, "high"));
    }
  }
  for (const forbiddenHashtag of brand?.payload.forbiddenHashtags ?? []) {
    if ((input.mariaCopy.hashtags ?? []).some((hashtag) => containsComparable(hashtag, forbiddenHashtag))) {
      issues.push(issue("FORBIDDEN_HASHTAG_FOUND", "brand", `Hashtag proibida pela marca encontrada: "${forbiddenHashtag}".`, "high"));
    }
  }
  for (const mandatoryWord of brand?.payload.mandatoryWords ?? []) {
    if (!containsComparable(combinedText, mandatoryWord)) {
      issues.push(issue("MANDATORY_WORD_MISSING", "brand", `Termo obrigatório da marca não encontrado na copy: "${mandatoryWord}".`, "low"));
    }
  }
}

function evaluateRisks(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  const documented =
    (input.joaoStrategy.risks?.length ?? 0) > 0 ||
    (input.sofiaDirection?.visualRisks?.length ?? 0) > 0 ||
    (input.biancaDesign?.designRisks?.length ?? 0) > 0;
  if (!documented) {
    issues.push(issue("NO_RISKS_DOCUMENTED", "risk", "Nenhum risco foi documentado pelas etapas anteriores (João, Sofia ou Bianca).", "low"));
  }
}

/** Concatena o texto falado e o texto na tela de todas as cenas do roteiro de Bruno, para checagem de regras de marca (palavras proibidas/obrigatórias, hashtags proibidas). */
function collectVideoText(input: LucasQualityReviewRequestInput): string {
  if (!input.brunoScript) return "";
  return [
    ...input.brunoScript.scenes.map((scene) => `${scene.spokenText ?? ""} ${scene.onScreenText ?? ""}`),
    ...(input.noraNarration?.segments ?? []).map((segment) => segment.text),
  ].join(" ");
}

/** Coerência estrutural entre roteiro (Bruno), direção (Vanessa) e plano de edição (Diego): o número de cenas precisa bater entre as três etapas. */
function evaluateVideoCoherence(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  const brunoCount = input.brunoScript?.scenes.length;
  const vanessaCount = input.vanessaDirection?.sceneDirections.length;
  const diegoCount = input.diegoEditingPlan?.editingTimeline.length;
  const counts = [brunoCount, vanessaCount, diegoCount].filter((value): value is number => typeof value === "number");
  if (counts.length >= 2 && new Set(counts).size > 1) {
    issues.push(issue(
      "VIDEO_COHERENCE_MISMATCH",
      "coherence",
      `Número de cenas divergente entre roteiro (${brunoCount ?? "-"}), direção (${vanessaCount ?? "-"}) e plano de edição (${diegoCount ?? "-"}).`,
      "high",
    ));
  }
}

/** Duração do vídeo final (Rafa) precisa bater com a duração planejada (Diego, herdada de Bruno). */
function evaluateVideoDuration(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  const specs = input.rafaVideo?.specs;
  const plannedDuration = input.diegoEditingPlan?.totalDurationSeconds ?? input.brunoScript?.totalDurationSeconds;
  if (!specs || plannedDuration === undefined) return;
  if (specs.durationSeconds <= 0 || specs.durationSeconds !== plannedDuration) {
    issues.push(issue(
      "VIDEO_DURATION_MISMATCH",
      "coherence",
      `Duração do vídeo final (${specs.durationSeconds}s) não corresponde à duração planejada (${plannedDuration}s).`,
      "medium",
    ));
  }
}

/** Formato vertical e proporção 9:16, obrigatórios para Reels/TikTok/Shorts. */
function evaluateVideoFormat(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  const specs = input.rafaVideo?.specs;
  if (!specs) return;
  if (specs.width >= specs.height) {
    issues.push(issue("VIDEO_NOT_VERTICAL", "coherence", `O vídeo final não está em formato vertical (${specs.width}x${specs.height}).`, "high"));
    return;
  }
  if (specs.aspectRatio !== "9:16") {
    issues.push(issue(
      "VIDEO_ASPECT_RATIO_INVALID",
      "coherence",
      `Proporção do vídeo final ("${specs.aspectRatio}") diverge da proporção obrigatória para vídeos curtos ("9:16").`,
      "medium",
    ));
  }
}

/** Clareza do gancho inicial definido pelo roteiro de Bruno. */
function evaluateVideoHook(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!input.brunoScript) return;
  if (!input.brunoScript.hook?.trim()) {
    issues.push(issue("VIDEO_HOOK_UNCLEAR", "coherence", "O roteiro não define um gancho inicial claro.", "medium"));
  }
}

/** Presença e consistência do CTA final do roteiro de vídeo com o CTA recomendado pela estratégia. */
function evaluateVideoCta(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!input.brunoScript) return;
  if (!input.brunoScript.finalCta?.trim()) {
    issues.push(issue("VIDEO_CTA_MISSING", "cta", "O roteiro de vídeo não define um CTA final.", "high"));
    return;
  }
  if (
    input.joaoStrategy.recommendedCta
    && !containsComparable(input.brunoScript.finalCta, input.joaoStrategy.recommendedCta)
    && !containsComparable(input.joaoStrategy.recommendedCta, input.brunoScript.finalCta)
  ) {
    issues.push(issue(
      "VIDEO_CTA_DIVERGENT",
      "cta",
      `CTA final do vídeo ("${input.brunoScript.finalCta}") diverge do CTA recomendado pela estratégia ("${input.joaoStrategy.recommendedCta}").`,
      "medium",
    ));
  }
}

/** Ritmo visual definido pela direção audiovisual de Vanessa. */
function evaluateVideoRhythm(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!input.vanessaDirection) return;
  if (!input.vanessaDirection.visualRhythm?.trim()) {
    issues.push(issue("VIDEO_RHYTHM_UNDEFINED", "visual", "A direção audiovisual não define o ritmo visual do vídeo.", "low"));
  }
}

function evaluateVideoThemePreservation(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.brunoScript) return;
  const requestText = normalize(`${input.originalRequest} ${input.joaoStrategy.objective ?? ""}`);
  if (!containsAnyComparable(requestText, ["site oficial", "site do casamento", "casamento merece um site"])) return;

  const publicVideoText = normalize(collectPublicVideoText(input));
  const requiredConcepts = ["site", "rsvp", "presente", "album", "cronograma"];
  const missing = requiredConcepts.filter((concept) => !publicVideoText.includes(normalize(concept)));
  const albumMentions = countMatches(publicVideoText, ["album", "foto", "fotos", "google drive", "qr code"]);
  const siteMentions = countMatches(publicVideoText, ["site", "oficial", "rumo ao altar", "rumoaoaltar"]);

  if (missing.length > 1 || albumMentions > siteMentions + 3) {
    issues.push(issue(
      "VIDEO_THEME_DRIFT",
      "coherence",
      `Tema principal "site oficial" não foi preservado de forma equilibrada. Conceitos ausentes ou fracos: ${missing.join(", ") || "nenhum"}; menções de álbum/fotos podem estar dominando a narrativa.`,
      "high",
    ));
  }
}

const CREATIVE_DNA_STOPWORDS = new Set([
  "para", "como", "quando", "onde", "sobre", "entre", "nunca", "sempre", "muito", "pouco", "isso",
  "esse", "essa", "este", "esta", "seus", "suas", "outra", "outro", "sendo", "estar", "ficar",
]);

function significantDnaWords(text: string): string[] {
  const words = normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5 && !CREATIVE_DNA_STOPWORDS.has(word));
  return Array.from(new Set(words));
}

function keywordSurvives(keywords: string[], haystack: string): boolean {
  if (keywords.length === 0) return true;
  return keywords.some((word) => haystack.includes(word));
}

/**
 * Valida se a identidade criativa da campanha (Creative Director Engine, ver
 * `creative-director-engine.ts`) sobreviveu até o conteúdo realmente produzido — não se o DNA foi
 * citado literalmente (nenhuma Skill deveria colar o DNA como texto público), mas se as palavras
 * significativas de Hero Scene/Hero Frame/Metáfora Visual/Emoção Dominante aparecem em algum lugar
 * do conteúdo público (copy, roteiro, narração, direção de cena). Só roda para arquétipos
 * criativos específicos e reconhecidos (`isWeddingOrganizationTheme`): o DNA genérico é paráfrase
 * template (sem vocabulário próprio garantido), então checar presença literal dele geraria ruído
 * sem sinal real — mesmo raciocínio de escopo estreito já usado por `evaluateVideoThemePreservation`.
 */
function evaluateCreativeDnaIdentity(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.brunoScript) return;

  const dnaInput = {
    originalRequest: input.originalRequest,
    objective: input.joaoStrategy.objective,
    centralPromise: input.joaoStrategy.centralPromise,
    valueProposition: input.joaoStrategy.valueProposition,
    toneOfVoice: input.joaoStrategy.toneOfVoice,
    targetAudience: input.joaoStrategy.targetAudience,
    keyMessages: input.joaoStrategy.keyMessages,
  };
  if (!isWeddingOrganizationTheme(dnaInput)) return;

  const creativeDna = deriveCampaignCreativeDNA(dnaInput);
  const sceneDesignText = (input.vanessaDirection?.sceneDirections ?? [])
    .flatMap((scene) => [
      scene.visualSceneDesign?.mainElement,
      scene.visualSceneDesign?.secondaryElement,
      scene.visualSceneDesign?.backgroundPlane,
      scene.visualSceneDesign?.foregroundPlane,
      scene.visualSceneDesign?.atmosphere,
      scene.visualSceneDesign?.emotion,
    ])
    .filter(Boolean)
    .join(" ");
  const combinedText = normalize([
    collectPublicVideoText(input),
    input.noraNarration?.narrationScript ?? "",
    (input.noraNarration?.segments ?? []).map((segment) => `${segment.text} ${segment.emotion}`).join(" "),
    input.mariaCopy.caption,
    input.mariaCopy.summary,
    sceneDesignText,
  ].join(" "));

  const heroSceneFound = keywordSurvives(significantDnaWords(creativeDna.heroScene), combinedText);
  const heroFrameFound = keywordSurvives(significantDnaWords(creativeDna.heroFrame), combinedText);
  const metaphorFound = keywordSurvives(significantDnaWords(creativeDna.visualMetaphor), combinedText);
  const emotionFound = keywordSurvives(
    [normalize(creativeDna.dominantEmotion), ...creativeDna.narrativeKeywords.map(normalize)],
    combinedText,
  );

  if (!heroSceneFound) {
    issues.push(issue(
      "CREATIVE_DNA_HERO_SCENE_MISSING",
      "coherence",
      `A Hero Scene do Creative DNA ("${creativeDna.heroScene}") não parece ter se refletido no conteúdo produzido.`,
      "low",
    ));
  }
  if (!heroFrameFound) {
    issues.push(issue(
      "CREATIVE_DNA_HERO_FRAME_MISSING",
      "coherence",
      `O Hero Frame do Creative DNA ("${creativeDna.heroFrame}") não parece ter se refletido no conteúdo produzido.`,
      "low",
    ));
  }
  if (!metaphorFound) {
    issues.push(issue(
      "CREATIVE_DNA_VISUAL_METAPHOR_MISSING",
      "coherence",
      `A metáfora visual do Creative DNA ("${creativeDna.visualMetaphor}") não parece ter se refletido no conteúdo produzido.`,
      "low",
    ));
  }
  if (!emotionFound) {
    issues.push(issue(
      "CREATIVE_DNA_EMOTION_NOT_PERCEIVED",
      "coherence",
      `A emoção dominante do Creative DNA ("${creativeDna.dominantEmotion}") não parece perceptível no conteúdo produzido.`,
      "low",
    ));
  }

  const missingCount = [!heroSceneFound, !heroFrameFound, !metaphorFound, !emotionFound].filter(Boolean).length;
  if (missingCount >= 3) {
    issues.push(issue(
      "CREATIVE_DNA_IDENTITY_DRIFT",
      "coherence",
      "A campanha parece ter perdido a identidade criativa (Creative DNA) ao longo do fluxo: a maior parte dos elementos definidos (cena principal, frame, metáfora visual, emoção dominante) não se reflete no conteúdo final produzido.",
      "medium",
    ));
  }
}

function evaluateVideoInternalTextLeak(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input)) return;
  const publicFields = [
    ...(input.brunoScript?.scenes ?? []).flatMap((scene) => [scene.spokenText, scene.onScreenText, scene.publicVisibleText, scene.publicSubtitle]),
    ...(input.diegoEditingPlan?.editingTimeline ?? []).flatMap((entry) => [entry.onScreenText, entry.publicVisibleText, entry.publicSubtitle, entry.captionText]),
  ].filter((value): value is string => Boolean(value?.trim()));

  const leaked = publicFields.filter(hasInternalVideoText);
  if (leaked.length > 0) {
    issues.push(issue(
      "VIDEO_INTERNAL_TEXT_VISIBLE",
      "visual",
      `Texto interno de planejamento apareceu em campos públicos do vídeo (${leaked.length} ocorrência(s)). Exemplo: "${leaked[0]}".`,
      "high",
    ));
  }
}

function evaluateVideoEndCard(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.brunoScript) return;
  const lastScene = input.brunoScript.scenes[input.brunoScript.scenes.length - 1];
  const lastTimeline = input.diegoEditingPlan?.editingTimeline[input.diegoEditingPlan.editingTimeline.length - 1];
  const endCardText = normalize([
    lastScene?.name,
    lastScene?.spokenText,
    lastScene?.onScreenText,
    lastScene?.publicVisibleText,
    lastScene?.publicSubtitle,
    lastTimeline?.onScreenText,
    lastTimeline?.publicVisibleText,
    lastTimeline?.publicSubtitle,
    lastTimeline?.captionText,
    input.brunoScript.finalCta,
  ].filter(Boolean).join(" "));

  if (!endCardText.includes("rumo ao altar") || !endCardText.includes(normalize("rumoaoaltar.com.br"))) {
    issues.push(issue(
      "VIDEO_END_CARD_INCOMPLETE",
      "cta",
      "End card de vídeo não contém simultaneamente marca Rumo ao Altar e URL rumoaoaltar.com.br em campos públicos.",
      "high",
    ));
  }
}

/** Legibilidade dos textos na tela: cenas com texto longo demais prejudicam leitura rápida em vídeo curto. */
function evaluateVideoOnScreenTextLegibility(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  const entries = input.diegoEditingPlan?.editingTimeline;
  if (!entries) return;
  const tooLong = entries.filter((entry) => {
    const headline = entry.publicVisibleText ?? entry.onScreenText ?? "";
    const subtitle = entry.publicSubtitle ?? entry.captionText ?? "";
    return (
      headline.length > MAX_ON_SCREEN_TEXT_LENGTH
      || subtitle.length > 72
      || wordCount(headline) > MAX_ON_SCREEN_HEADLINE_WORDS
      || wordCount(subtitle) > MAX_ON_SCREEN_COMPLEMENT_WORDS
    );
  });
  if (tooLong.length > 0) {
    issues.push(issue(
      "VIDEO_ON_SCREEN_TEXT_TOO_LONG",
      "visual",
      `${tooLong.length} cena(s) com texto na tela longo demais para leitura rápida (limite recomendado: ${MAX_ON_SCREEN_TEXT_LENGTH} caracteres).`,
      "low",
    ));
  }
}

/**
 * Prova estrutural de "parece slideshow": compara a decisão de edição (transição, animação de
 * texto, máscara, glow, blur) das cenas de desenvolvimento (todas exceto a primeira/gancho e a
 * última/CTA) e rejeita quando duas ou mais saem byte-idênticas. Nunca deveria acontecer com o
 * rateio por `beatIndex` de Vanessa/Diego (ver cinematic-reference-library.ts) — se acontecer, é
 * sinal de regressão real, não apenas de nota baixa.
 */
function evaluateVideoSceneDecisionsDuplicated(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.diegoEditingPlan) return;
  const timeline = input.diegoEditingPlan.editingTimeline;
  if (timeline.length < 4) return;

  const developmentEntries = timeline.slice(1, -1).filter((entry) => entry.editingDecision);
  if (developmentEntries.length < 2) return;

  const signatureFor = (entry: (typeof developmentEntries)[number]) => JSON.stringify({
    transition: entry.editingDecision?.transition,
    textAnimation: entry.editingDecision?.textAnimation,
    mask: entry.editingDecision?.mask,
    glow: entry.editingDecision?.glow,
    blur: entry.editingDecision?.blur,
  });

  const seen = new Map<string, number>();
  for (const entry of developmentEntries) {
    const signature = signatureFor(entry);
    seen.set(signature, (seen.get(signature) ?? 0) + 1);
  }
  const duplicatedCount = [...seen.values()].filter((count) => count > 1).reduce((total, count) => total + count, 0);
  if (duplicatedCount > 0) {
    issues.push(issue(
      "VIDEO_SCENE_DECISIONS_DUPLICATED",
      "visual",
      `${duplicatedCount} cena(s) de desenvolvimento possuem decisão de edição idêntica (transição, animação de texto, máscara, glow e blur), reforçando aparência de slideshow.`,
      "high",
    ));
  }
}

/**
 * Ritmo monótono: quando todas as cenas do vídeo têm exatamente a mesma duração, não há sensação
 * de progressão (corte rápido, respiro, impacto) — apenas um metrônomo constante, característico
 * de apresentação automática em vez de edição comercial.
 */
function evaluateVideoRhythmMonotonous(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.diegoEditingPlan) return;
  const durations = input.diegoEditingPlan.editingTimeline
    .map((entry) => entry.durationSeconds)
    .filter((value): value is number => typeof value === "number" && value > 0);
  if (durations.length < 3) return;

  const distinct = new Set(durations.map((value) => Math.round(value * 10) / 10));
  if (distinct.size === 1) {
    issues.push(issue(
      "VIDEO_RHYTHM_MONOTONOUS",
      "visual",
      `Todas as ${durations.length} cenas têm exatamente a mesma duração (${durations[0]}s); falta progressão de ritmo (corte rápido, respiro, impacto).`,
      "medium",
    ));
  }
}

/**
 * Nenhuma cena isolada deve dominar o vídeo — um comercial de poucos segundos que passa 40%+ do
 * tempo (ou mais de 12s corridos) numa única cena para de parecer edição de agência e passa a
 * parecer um vídeo institucional arrastado. Limiar relativo (nunca absoluto sozinho) para não
 * penalizar legitimamente a cena de payoff, que é deliberadamente a mais longa do vídeo.
 */
function evaluateVideoSceneTooLong(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.diegoEditingPlan) return;
  const totalDurationSeconds = input.diegoEditingPlan.totalDurationSeconds;
  if (!totalDurationSeconds || totalDurationSeconds <= 0) return;
  const threshold = Math.max(10, totalDurationSeconds * 0.4);
  const tooLong = input.diegoEditingPlan.editingTimeline.filter(
    (entry) => typeof entry.durationSeconds === "number" && entry.durationSeconds > threshold,
  );
  if (tooLong.length > 0) {
    issues.push(issue(
      "VIDEO_SCENE_TOO_LONG",
      "visual",
      `${tooLong.length} cena(s) ultrapassam ${threshold.toFixed(1)}s (mais de 40% da duração total do vídeo) — nenhuma cena isolada deveria dominar um comercial curto assim.`,
      "medium",
    ));
  }
}

/**
 * Enquadramento repetido: compara `cinematography.composition` (decisão explícita de Vanessa,
 * varia por beat de desenvolvimento — ver `DEVELOPMENT_BEAT_VARIANTS` na biblioteca cinematográfica
 * compartilhada) entre as cenas de desenvolvimento (todas exceto a primeira/gancho e a
 * última/CTA, que legitimamente repetem o mesmo eixo visual entre si). Duas cenas de
 * desenvolvimento com a mesma composição reforçam aparência de slideshow tanto quanto decisão de
 * edição duplicada.
 */
function evaluateVideoFramingRepetitive(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.vanessaDirection) return;
  const directions = input.vanessaDirection.sceneDirections;
  if (directions.length < 4) return;
  const developmentDirections = directions.slice(1, -1).filter((direction) => direction.cinematography?.composition);
  if (developmentDirections.length < 2) return;

  const seen = new Map<string, number>();
  for (const direction of developmentDirections) {
    const composition = direction.cinematography!.composition!;
    seen.set(composition, (seen.get(composition) ?? 0) + 1);
  }
  const duplicatedCount = [...seen.values()].filter((count) => count > 1).reduce((total, count) => total + count, 0);
  if (duplicatedCount > 0) {
    issues.push(issue(
      "VIDEO_FRAMING_REPETITIVE",
      "visual",
      `${duplicatedCount} cena(s) de desenvolvimento compartilham exatamente o mesmo enquadramento/composição — cada cena precisa de um ponto de vista visual próprio.`,
      "medium",
    ));
  }
}

function evaluateVideoMotionDesign(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.rafaVideo) return;
  const summary = input.rafaVideo.motionSummary;
  if (!summary) {
    issues.push(issue(
      "VIDEO_MOTION_COMPOSITION_WEAK",
      "visual",
      "Rafa não registrou métricas de Motion Composer; não é possível comprovar movimento interno por elemento.",
      "medium",
    ));
    return;
  }

  const minimumElements = Math.max(3, summary.scenes * 3);
  if (summary.totalIndependentAnimations < minimumElements || summary.averageAnimatedElementsPerScene < 3) {
    issues.push(issue(
      "VIDEO_MOTION_COMPOSITION_WEAK",
      "visual",
      `Composição de motion fraca: ${summary.totalIndependentAnimations} animação(ões) independente(s), média ${summary.averageAnimatedElementsPerScene} elemento(s) por cena.`,
      "medium",
    ));
  }

  if (summary.mockupElements > 0 && summary.maxStaticMockupSeconds > 1.5) {
    issues.push(issue(
      "VIDEO_MOCKUP_STATIC",
      "visual",
      `Mockups permanecem estáticos por até ${summary.maxStaticMockupSeconds}s; mockup de vídeo curto precisa ter movimento interno contínuo.`,
      "medium",
    ));
  }

  if (summary.simultaneousEntryWarnings > 0) {
    issues.push(issue(
      "VIDEO_ELEMENTS_SIMULTANEOUS",
      "visual",
      `${summary.simultaneousEntryWarnings} cena(s) possuem mais de dois elementos entrando simultaneamente, o que reforça aparência de slide.`,
      "low",
    ));
  }

  if (summary.elementAnimations.length < 3 || summary.transitionTypes.length < 3) {
    issues.push(issue(
      "VIDEO_ANIMATION_REPETITIVE",
      "visual",
      `Pouca variedade de motion: ${summary.elementAnimations.length} animação(ões) de elemento e ${summary.transitionTypes.length} transição(ões) diferentes.`,
      "low",
    ));
  }

  if ((summary.averageDepthLayers ?? 0) > 0 && (summary.averageDepthLayers ?? 0) < 4) {
    issues.push(issue(
      "VIDEO_VISUAL_DEPTH_WEAK",
      "visual",
      `Profundidade visual fraca: média de ${summary.averageDepthLayers} camada(s) por cena. Vídeo premium precisa de background, foreground, produto/texto e respiro.`,
      "medium",
    ));
  }

  if ((summary.repeatedLayoutWarnings ?? 0) > 1) {
    issues.push(issue(
      "VIDEO_LAYOUT_REPETITIVE",
      "visual",
      `${summary.repeatedLayoutWarnings} repetição(ões) de padrão de layout detectadas; isso reforça aparência de apresentação.`,
      "medium",
    ));
  }

  if ((summary.mockupOnlySceneRatio ?? 0) > 0.55) {
    issues.push(issue(
      "VIDEO_MOCKUP_PRESENTATION",
      "visual",
      `Excesso de cenas baseadas apenas em mockup (${Math.round((summary.mockupOnlySceneRatio ?? 0) * 100)}%). Alternar pessoas, contexto, produto, detalhes e interface.`,
      "high",
    ));
  }

  const assetRoles = summary.assetRoles ?? [];
  if (assetRoles.length > 0 && !assetRoles.includes("main_image")) {
    issues.push(issue(
      "VIDEO_MOCKUP_PRESENTATION",
      "visual",
      "Nenhuma cena usa imagem principal/humana; o vídeo tende a parecer apresentação de mockups.",
      "high",
    ));
  }
}

// PRODUCTION READINESS — mesmo espírito de "defesa em profundidade" de evaluateVideoFile
// (MIN_VIDEO_SIZE_BYTES): Lucas não recalcula o Production Plan inteiro (isso pertence só a
// src/shared/utils/production-readiness.ts, chamado por Rafa), mas aplica seu próprio piso
// independente sobre a nota já calculada e mirrorizada em `input.rafaVideo.productionReadiness` —
// para que um vídeo com cobertura humana/de cena/de asset claramente insuficiente nunca passe
// batido só porque o perfil de qualidade usado por Rafa não bloqueava (`standard`/`draft`).
// UNIFIED COVERAGE MODEL (seção 10) — os pisos agora vêm de `shared/utils/coverage/
// requirement-evaluator.ts` (mesmo valor antes hardcoded aqui E, coincidentemente, também em
// `blocker-classifier.ts`) — Lucas continua tendo o direito de aplicar um piso independente do
// perfil (defesa em profundidade), mas o NÚMERO em si não é mais duplicado.

function evaluateProductionReadinessGate(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.rafaVideo) return;
  const score = input.rafaVideo.productionReadiness;
  const plan = input.rafaVideo.productionPlan;
  if (!score || !plan) return;

  if (!score.meetsMinimum) {
    issues.push(issue(
      "PRODUCTION_READINESS_LOW",
      "visual",
      `Production Readiness em ${Math.round(score.overall * 100)}%, abaixo do mínimo aceitável de ${Math.round(score.minimumAcceptable * 100)}% — a campanha não tinha material real suficiente para virar um comercial publicável.`,
      "high",
    ));
  }

  if (!plan.varietySufficient) {
    issues.push(issue(
      "PRODUCTION_ASSET_DIVERSITY_LOW",
      "visual",
      `Diversidade de assets insuficiente: ${plan.assetsFound} Shot(s) resolvido(s) com ${plan.repeatedAssetCount} reuso(s) de arquivo físico já usado em outro Shot.`,
      "high",
    ));
  }

  if (score.humanCoverage < MIN_ACCEPTABLE_HUMAN_COVERAGE) {
    issues.push(issue(
      "PRODUCTION_HUMAN_PRESENCE_LOW",
      "visual",
      `Presença humana insuficiente: apenas ${Math.round(score.humanCoverage * 100)}% dos Shots que exigem pessoa/casal receberam um asset humano real (${plan.humanAssetCount} asset(s) humano(s) no total).`,
      "high",
    ));
  }

  if (!plan.diversitySufficient) {
    issues.push(issue(
      "PRODUCTION_SCENE_VARIETY_LOW",
      "visual",
      "Variedade de cena insuficiente: Shots consecutivos repetem o mesmo arquivo físico, o mesmo enquadramento, a mesma composição, o mesmo casal ou o mesmo mockup.",
      "medium",
    ));
  }

  if (score.assetVariety < MIN_ACCEPTABLE_ASSET_VARIETY) {
    issues.push(issue(
      "PRODUCTION_SHOT_VARIETY_LOW",
      "visual",
      `Variedade de Shot insuficiente: apenas ${Math.round(score.assetVariety * 100)}% de variedade bruta de asset ao longo do vídeo (${plan.shotsCount} Shot(s), ${plan.assetsFound} resolvido(s)).`,
      "medium",
    ));
  }
}

/**
 * PRODUCT COMPOSITING ENGINE (seção 11) — checagens aditivas para Shots que usam
 * `compositedProductFootage`. Nunca decide sozinho se a composição é boa (isso já foi calculado
 * pelo engine antes de chegar aqui) — só lê os fatos objetivos já computados e reprova quando
 * algum deles falha. Ausente (`undefined`) quando a produção não usou composição nenhuma —
 * nesse caso não gera nenhum issue, exatamente como `evaluateProductionReadinessGate` se comporta
 * quando `rafaVideo` não tem plano de produção.
 */
function evaluateCompositedProductFootageGate(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.rafaVideo) return;
  const checks = input.rafaVideo.compositedProductFootage;
  if (!checks || checks.length === 0) return;

  for (const check of checks) {
    const shotLabel = check.shotId ?? check.assetId;

    if (!check.legible) {
      issues.push(issue(
        "COMPOSITED_SCREEN_ILLEGIBLE",
        "visual",
        `Shot ${shotLabel}: a tela de produto composta ("${check.functionality}") não está legível — texto/interface ilegível não conta como Product Coverage real.`,
        "high",
      ));
    }
    if (!check.perspectiveCoherent) {
      issues.push(issue(
        "COMPOSITED_SCREEN_PERSPECTIVE_INCOHERENT",
        "visual",
        `Shot ${shotLabel}: a tela composta parece "colada" — perspectiva não acompanha o ângulo real do dispositivo na filmagem.`,
        "high",
      ));
    }
    if (check.hasLeakageOutsideDevice) {
      issues.push(issue(
        "COMPOSITED_SCREEN_LEAKAGE",
        "visual",
        `Shot ${shotLabel}: a composição vaza para fora da área do aparelho (fundo ou mão cobertos pela tela composta).`,
        "high",
      ));
    }
    if (!check.isStableAcrossFrames) {
      issues.push(issue(
        "COMPOSITED_SCREEN_UNSTABLE",
        "visual",
        `Shot ${shotLabel}: a tela composta treme/pula entre frames em vez de acompanhar o dispositivo de forma estável.`,
        "medium",
      ));
    }
    if (check.coversFaceOrKeyElement) {
      issues.push(issue(
        "COMPOSITED_SCREEN_COVERS_KEY_ELEMENT",
        "visual",
        `Shot ${shotLabel}: a composição encobre o rosto da pessoa ou outro elemento-chave da cena.`,
        "high",
      ));
    }
    if (check.requiredFunctionality && check.requiredFunctionality !== check.functionality) {
      issues.push(issue(
        "COMPOSITED_SCREEN_FUNCTIONALITY_MISMATCH",
        "coherence",
        `Shot ${shotLabel}: o Shot pedia a funcionalidade "${check.requiredFunctionality}", mas a tela composta mostra "${check.functionality}" — interface não corresponde à narrativa.`,
        "high",
      ));
    }
    if (!check.usesRealInterface) {
      issues.push(issue(
        "COMPOSITED_SCREEN_NOT_REAL_INTERFACE",
        "brand",
        `Shot ${shotLabel}: a tela composta não é reconhecida como interface real do produto — nunca inventar interface.`,
        "high",
      ));
    }
    if (!check.originLicenseRegistered) {
      issues.push(issue(
        "COMPOSITED_SCREEN_ORIGIN_UNLICENSED",
        "risk",
        `Shot ${shotLabel}: a filmagem original usada na composição não tem origem/licença registrada — não pode ser publicada.`,
        "high",
      ));
    }
  }
}

/**
 * INTENT-BASED FOOTAGE ACQUISITION (seção LUCAS) — "Shot Intent atendido? Product Integration
 * possível? Screen Visibility? Device Orientation? Narrativa preservada?" Mais amplo que
 * `evaluateCompositedProductFootageGate` (cobre todo Shot que exigia dispositivo/tela, não só os
 * já compostos). Só `intentSatisfied=false` bloqueia automaticamente — os demais ficam como aviso
 * (a intenção pode não ter sido satisfeita por um motivo já capturado em outro issue).
 */
function evaluateShotIntentGate(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.rafaVideo) return;
  const checks = input.rafaVideo.shotIntentChecks;
  if (!checks || checks.length === 0) return;

  for (const check of checks) {
    const shotLabel = check.shotId ?? "Shot sem id";

    if (!check.intentSatisfied) {
      issues.push(issue(
        "SHOT_INTENT_NOT_SATISFIED",
        "coherence",
        `Shot ${shotLabel}: a intenção real do Shot não foi atendida${check.detail ? ` — ${check.detail}` : ""}. Não basta o asset ser bonito; precisa resolver o objetivo do Shot.`,
        "high",
      ));
    }
    if (!check.productIntegrationPossible) {
      issues.push(issue(
        "SHOT_INTENT_PRODUCT_INTEGRATION_IMPOSSIBLE",
        "visual",
        `Shot ${shotLabel}: Product Integration não é possível nesta filmagem (screenVisible=${check.screenVisible ?? "desconhecido"}, deviceOrientation=${check.deviceOrientation ?? "desconhecida"}).`,
        "medium",
      ));
    }
    if (!check.narrativePreserved) {
      issues.push(issue(
        "SHOT_INTENT_NARRATIVE_DRIFT",
        "coherence",
        `Shot ${shotLabel}: o asset escolhido diverge da narrativa pretendida para este Shot.`,
        "medium",
      ));
    }
  }
}

/**
 * FOOTAGE VISUAL VALIDATION 2.0 (seção 11) — "Somente candidatos humanamente aprovados contam
 * integralmente para verifiedCompositingCoverage." Não bloqueante (governança, não defeito de
 * conteúdo): sinaliza quando o pipeline automático encontrou candidatos geometricamente prontos
 * para composição (`compositingGeometryCoverage > 0`) mas NENHUM foi revisado/aprovado por um
 * humano ainda (`verifiedCompositingCoverage === 0`) — lembrete de que "compositing_ready" nunca
 * significa aprovado (seção 1/8), nunca um veredito novo sobre a filmagem em si.
 */
function evaluateCompositingVerificationGate(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input) || !input.rafaVideo) return;
  const coverage = input.rafaVideo.compositingReadiness;
  if (!coverage) return;

  if (coverage.compositingGeometryCoverage > 0 && coverage.verifiedCompositingCoverage === 0) {
    issues.push(issue(
      "PRODUCT_COMPOSITING_UNVERIFIED_CLAIM",
      "visual",
      `O pipeline automático marcou ${Math.round(coverage.compositingGeometryCoverage * 100)}% dos Shots de produto como geometricamente prontos para composição, mas 0% foi humanamente aprovado — nenhum candidato pode ser usado em produção real sem revisão humana explícita (--footage-review-approve).`,
      "medium",
    ));
  }
}

function evaluateVideoSceneDesign(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input)) return;
  const directions = input.vanessaDirection?.sceneDirections ?? [];
  if (directions.length === 0) return;
  const incomplete = directions.filter((direction) => {
    const design = direction.visualSceneDesign;
    if (!design) return true;
    return [
      design.mainElement,
      design.secondaryElement,
      design.backgroundPlane,
      design.foregroundPlane,
      design.depth,
      design.lighting,
      design.atmosphere,
      design.eyeFocus,
      design.composition,
      design.productIntegration,
    ].some((value) => !value?.trim());
  });
  if (incomplete.length > 0) {
    issues.push(issue(
      "VIDEO_SCENE_DESIGN_MISSING",
      "visual",
      `${incomplete.length} cena(s) sem direção de arte completa de Vanessa (elementos, planos, profundidade, luz, foco e integração do produto).`,
      "medium",
    ));
  }
}

function evaluateVideoNarration(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input)) return;

  const narration = input.noraNarration;
  if (!narration) {
    issues.push(issue(
      "VIDEO_NARRATION_MISSING",
      "coherence",
      "Pipeline de vídeo sem plano de narração da Nora; vídeos com o novo fluxo precisam validar voz antes de Rafa e Lucas.",
      "high",
    ));
    return;
  }

  const timeline = input.diegoEditingPlan?.editingTimeline ?? [];
  const segments = narration.segments ?? [];
  if (segments.length === 0) {
    issues.push(issue("VIDEO_NARRATION_TIMING_INVALID", "coherence", "Nora não entregou segmentos de narração por cena.", "high"));
  }

  if (timeline.length > 0 && segments.length > 0 && timeline.length !== segments.length) {
    issues.push(issue(
      "VIDEO_NARRATION_TIMING_INVALID",
      "coherence",
      `Quantidade de segmentos de narração (${segments.length}) diverge da timeline de Diego (${timeline.length}).`,
      "medium",
    ));
  }

  const timingProblems = segments.filter((segment) => {
    const sceneDuration = Math.max(0, segment.endTime - segment.startTime);
    return (
      segment.startTime < -0.05
      || segment.endTime <= segment.startTime
      || segment.estimatedDurationSeconds <= 0
      || segment.estimatedDurationSeconds > sceneDuration + 0.65
    );
  });
  if (timingProblems.length > 0) {
    issues.push(issue(
      "VIDEO_NARRATION_TIMING_INVALID",
      "coherence",
      `${timingProblems.length} segmento(s) de narração não cabem no tempo da cena ou possuem marcação inválida.`,
      "medium",
    ));
  }

  const audio = narration.audio;
  if (!audio?.relativePath && !audio?.absolutePath) {
    issues.push(issue("VIDEO_NARRATION_AUDIO_INVALID", "risk", "Nora não registrou arquivo físico de voz para mixagem no Rafa.", "high"));
  } else if (audio.validation?.valid === false) {
    issues.push(issue("VIDEO_NARRATION_AUDIO_INVALID", "risk", "Arquivo de narração foi registrado, mas a validação da Nora marcou o áudio como inválido.", "high"));
  }

  if (audio?.validation?.clippingRisk === "high") {
    issues.push(issue("VIDEO_NARRATION_CLIPPING", "risk", "Narração apresenta risco alto de clipping; a voz pode distorcer no MP4 final.", "high"));
  }

  if (input.rafaVideo) {
    if (input.rafaVideo.narrationApplied !== true) {
      issues.push(issue("VIDEO_NARRATION_AUDIO_INVALID", "risk", "Rafa não confirmou a narração como mixada no MP4 final.", "high"));
    }
    if (input.rafaVideo.audioApplied !== true) {
      issues.push(issue("VIDEO_NARRATION_AUDIO_INVALID", "risk", "Rafa não confirmou áudio aplicado no MP4 final.", "high"));
    }
    if (input.rafaVideo.narrationApplied === true && input.rafaVideo.musicDuckingApplied === false) {
      issues.push(issue("VIDEO_AUDIO_DUCKING_MISSING", "risk", "Narração foi aplicada, mas não há confirmação de ducking da trilha durante a fala.", "medium"));
    }
  }

  const redundant = segments.filter((segment) => {
    const timelineEntry = timeline.find((entry) => entry.order === segment.sceneOrder) ?? timeline[segment.sceneOrder - 1];
    const visibleText = normalize([timelineEntry?.publicVisibleText, timelineEntry?.publicSubtitle].filter(Boolean).join(" "));
    const spoken = normalize(segment.text);
    return visibleText.length > 16 && spoken.length > 16 && (spoken.includes(visibleText) || visibleText.includes(spoken));
  });
  if (redundant.length > 0) {
    issues.push(issue(
      "VIDEO_VOICE_TEXT_REDUNDANT",
      "visual",
      `${redundant.length} cena(s) repetem na tela praticamente o mesmo conteúdo falado pela Nora; com voz, a tela deve usar palavras-chave e headlines curtas.`,
      "low",
    ));
  }
}

function wordCount(text: string | undefined): number {
  return text?.split(/\s+/).filter(Boolean).length ?? 0;
}

function collectPublicVideoText(input: LucasQualityReviewRequestInput): string {
  return [
    input.brunoScript?.hook,
    input.brunoScript?.finalCta,
    ...(input.brunoScript?.scenes ?? []).flatMap((scene) => [
      scene.spokenText,
      scene.onScreenText,
      scene.publicVisibleText,
      scene.publicSubtitle,
    ]),
    ...(input.diegoEditingPlan?.editingTimeline ?? []).flatMap((entry) => [
      entry.onScreenText,
      entry.publicVisibleText,
      entry.publicSubtitle,
      entry.captionText,
    ]),
  ].filter(Boolean).join(" ");
}

const INTERNAL_VIDEO_TEXT_PATTERNS = [
  /desenvolver\s+a\s+mensagem-chave/i,
  /abertura\s+de\s+impacto/i,
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

function hasInternalVideoText(text: string): boolean {
  return INTERNAL_VIDEO_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

function countMatches(text: string, terms: string[]): number {
  return terms.reduce((total, term) => total + (text.includes(normalize(term)) ? 1 : 0), 0);
}

/**
 * AGENCY FILM PIPELINE 2.0 — Lucas reprova automaticamente vídeos que não seguem a filosofia
 * de "filme, não slideshow". Regras (calibradas para vídeos curtos 3-8 cenas):
 *
 * - Menos de 6 Shots no vídeo inteiro → `VIDEO_FEW_SHOTS`
 * - Alguma cena com menos de 2 Shots → `VIDEO_SCENE_SINGLE_SHOT`
 * - Mais de 30% dos Shots parecem slideshow (static hold + cut in/out + duração >=1.5s) → `VIDEO_SLIDESHOW_LIKE`
 * - Sequência de 3+ Shots com mesmo shotType → `VIDEO_SHOT_FRAMING_REPETITIVE`
 * - Menos de 3 propósitos distintos entre todos os Shots → `VIDEO_SHOT_PURPOSE_MONOTONOUS`
 * - Menos de 3 tipos distintos de movimento entre todos os Shots → `VIDEO_SHOT_MOTION_MONOTONOUS`
 * - Mais de 50% dos Shots pedindo `mockup`/`graphic` como mídia preferida → `VIDEO_EXCESS_MOCKUP_SHOTS`
 * - Mais de 60% das cenas com `publicVisibleText` visível na tela → `VIDEO_EXCESS_ON_SCREEN_TEXT`
 *
 * As regras só disparam quando há pacote de vídeo real (brunoScript + shots). Quando os shots
 * não estão disponíveis (pipeline legada), Lucas não reprova — a validação é aditiva.
 */
function evaluateAgencyFilmPipelineShots(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input)) return;
  const scenes = input.brunoScript?.scenes ?? [];
  if (scenes.length === 0) return;
  const scenesWithShots = scenes.filter((scene) => Array.isArray(scene.shots) && scene.shots.length > 0);
  if (scenesWithShots.length === 0) return;

  // 1. Cenas com um único Shot — proibidas pela sprint.
  for (const scene of scenesWithShots) {
    if ((scene.shots?.length ?? 0) < 2) {
      issues.push(issue(
        "VIDEO_SCENE_SINGLE_SHOT",
        "visual",
        `Cena ${scene.order} (${scene.name}) tem apenas ${scene.shots?.length ?? 0} Shot — AGENCY FILM PIPELINE 2.0 proíbe cenas compostas por um único plano.`,
        "high",
      ));
    }
  }

  const allShots = scenesWithShots.flatMap((scene) => scene.shots ?? []);
  const totalShots = allShots.length;

  // 2. Vídeo com poucos Shots no total.
  if (totalShots > 0 && totalShots < 6) {
    issues.push(issue(
      "VIDEO_FEW_SHOTS",
      "visual",
      `Vídeo tem apenas ${totalShots} Shot(s) no total — muito pouco para parecer um filme; mínimo esperado é 6 para vídeos curtos.`,
      "high",
    ));
  }

  if (totalShots === 0) return;

  // 3. Slideshow-like ratio.
  const slideshowLike = allShots.filter((shot) =>
    shot.motion?.action === "static_hold" &&
    shot.motion?.entrance === "cut_in" &&
    shot.motion?.exit === "cut_out" &&
    (shot.durationSeconds ?? 0) >= 1.5,
  );
  const slideshowRatio = slideshowLike.length / totalShots;
  if (slideshowRatio > 0.3) {
    issues.push(issue(
      "VIDEO_SLIDESHOW_LIKE",
      "visual",
      `${slideshowLike.length}/${totalShots} Shots (${Math.round(slideshowRatio * 100)}%) têm cara de slideshow (estáticos, sem transição, >=1.5s) — o vídeo se parece com apresentação, não filme.`,
      "high",
    ));
  }

  // 4. Repetição de shotType em sequência (3+ consecutivos com o mesmo tipo).
  let runStart = 0;
  for (let i = 1; i <= allShots.length; i++) {
    const brokeRun = i === allShots.length || allShots[i].cinematography?.shotType !== allShots[i - 1].cinematography?.shotType;
    if (brokeRun) {
      const runLength = i - runStart;
      if (runLength >= 3) {
        issues.push(issue(
          "VIDEO_SHOT_FRAMING_REPETITIVE",
          "visual",
          `Sequência de ${runLength} Shots com o mesmo enquadramento "${allShots[runStart].cinematography?.shotType}" (Shots ${runStart + 1} a ${i}) — falta variação de plano.`,
          "medium",
        ));
      }
      runStart = i;
    }
  }

  // 5. Diversidade de propósitos.
  const distinctPurposes = new Set(allShots.map((shot) => shot.purpose)).size;
  if (distinctPurposes < 3 && totalShots >= 4) {
    issues.push(issue(
      "VIDEO_SHOT_PURPOSE_MONOTONOUS",
      "visual",
      `Apenas ${distinctPurposes} propósito(s) distinto(s) entre ${totalShots} Shots — o filme precisa alternar establishing/detail/human_interaction/product/reaction/closing.`,
      "medium",
    ));
  }

  // 6. Diversidade de movimento.
  const distinctMotions = new Set(allShots.map((shot) => shot.motion?.action).filter(Boolean)).size;
  if (distinctMotions < 3 && totalShots >= 4) {
    issues.push(issue(
      "VIDEO_SHOT_MOTION_MONOTONOUS",
      "visual",
      `Apenas ${distinctMotions} tipo(s) de movimento entre ${totalShots} Shots — a câmera precisa se mover de formas diferentes ao longo do filme.`,
      "medium",
    ));
  }

  // 7. Excesso de mockup — mais da metade dos Shots pedindo mockup/graphic é apresentação, não filme.
  const mockupShots = allShots.filter((shot) => {
    const kind = shot.assetRequirement?.preferredMediaKind ?? "";
    return kind === "mockup" || kind === "graphic";
  });
  if (mockupShots.length / totalShots > 0.5) {
    issues.push(issue(
      "VIDEO_EXCESS_MOCKUP_SHOTS",
      "visual",
      `${mockupShots.length}/${totalShots} Shots (${Math.round((mockupShots.length / totalShots) * 100)}%) pedem mockup/graphic — o vídeo precisa priorizar vídeo/b-roll/cinemagraph e pessoas usando o produto, não apresentar telas isoladas.`,
      "high",
    ));
  }

  // 8. Excesso de texto — mais de 60% das cenas com texto público visível domina a tela.
  const textualScenes = scenesWithShots.filter((scene) => Boolean(scene.publicVisibleText?.trim() || scene.onScreenText?.trim()));
  if (textualScenes.length / scenesWithShots.length > 0.6 && scenesWithShots.length >= 3) {
    issues.push(issue(
      "VIDEO_EXCESS_ON_SCREEN_TEXT",
      "visual",
      `${textualScenes.length}/${scenesWithShots.length} cenas exibem texto na tela — o texto deve reforçar imagem/movimento/narração, não dominar. Priorizar remover texto de cenas de reação/closing.`,
      "medium",
    ));
  }
}

/** Qualidade técnica mínima do arquivo de vídeo final registrado pelo Rafa. */
function evaluateVideoFile(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): void {
  if (!hasVideoComponent(input)) return;
  if (!input.rafaVideo || !input.rafaVideo.specs) {
    issues.push(issue("NO_VIDEO_FILE", "visual", "Nenhum arquivo de vídeo final foi registrado pelo Rafa para este pacote.", "high"));
    return;
  }
  const sizeBytes = input.rafaVideo.sizeBytes ?? 0;
  const extension = normalize(input.rafaVideo.extension ?? "");
  if (sizeBytes < MIN_VIDEO_SIZE_BYTES || extension !== "mp4") {
    issues.push(issue(
      "VIDEO_TECHNICAL_QUALITY_LOW",
      "visual",
      `O arquivo de vídeo final não atende ao padrão técnico mínimo esperado (tamanho ${sizeBytes} byte(s), extensão "${input.rafaVideo.extension ?? "-"}").`,
      "high",
    ));
  }
}

function computeScore(issues: LucasIssue[]): number {
  const penalty = issues.reduce((total, current) => total + SEVERITY_PENALTY[current.severity], 0);
  return Math.max(0, 100 - penalty);
}

function determineReviewStatus(score: number, issues: LucasIssue[], thresholds: ReviewThresholds): LucasReviewStatus {
  const hasBlocking = issues.some((current) => BLOCKING_ISSUE_CODES.has(current.code));
  if (hasBlocking) return "rejected";

  const hasHigh = issues.some((current) => current.severity === "high");
  if (score >= thresholds.approvalScoreThreshold && !hasHigh) return "approved";
  if (score >= thresholds.warningScoreThreshold) return "approved_with_warnings";
  if (score >= thresholds.adjustmentScoreThreshold) return "needs_adjustments";
  return "rejected";
}

function buildChecklist(
  issues: LucasIssue[],
  overallScore: number,
  thresholds: ReviewThresholds,
  qualityProfile: ContentQualityProfile,
): LucasChecklistItem[] {
  const hasIssue = (code: LucasIssueCode) => issues.some((current) => current.code === code);

  const checklist: LucasChecklistItem[] = [
    { item: "Estratégia presente e coerente com o objetivo", passed: !hasIssue("WEAK_STRATEGY_KEY_MESSAGES") },
    { item: "Copy presente e alinhada ao objetivo", passed: !hasIssue("COPY_MISSING_TITLE") && !hasIssue("COPY_MISSING_CAPTION") },
    { item: "Direção visual presente e coerente com a estratégia", passed: !hasIssue("VISUAL_CONCEPT_MISSING") },
    { item: "Imagens geradas e compatíveis com a direção visual", passed: !hasIssue("NO_IMAGES_GENERATED") && !hasIssue("IMAGE_COUNT_MISMATCH") },
    { item: "Coerência entre texto e visual", passed: !hasIssue("FORMAT_MISMATCH") && !hasIssue("CHANNEL_MISMATCH") && !hasIssue("ASPECT_RATIO_MISMATCH") },
    { item: "Tom de voz consistente com a marca", passed: !hasIssue("TONE_INCONSISTENT") },
    { item: "CTA presente e consistente entre estratégia e copy", passed: !hasIssue("CTA_DIVERGENT") },
    { item: "Regras da marca respeitadas", passed: !hasIssue("FORBIDDEN_WORD_FOUND") && !hasIssue("FORBIDDEN_HASHTAG_FOUND") },
    { item: "Riscos identificados e documentados", passed: !hasIssue("NO_RISKS_DOCUMENTED") },
    { item: "Coerência entre roteiro, direção, edição e vídeo final", passed: !hasIssue("VIDEO_COHERENCE_MISMATCH") },
    { item: "Duração do vídeo compatível com o planejado", passed: !hasIssue("VIDEO_DURATION_MISMATCH") },
    { item: "Vídeo em formato vertical", passed: !hasIssue("VIDEO_NOT_VERTICAL") },
    { item: "Proporção do vídeo em 9:16", passed: !hasIssue("VIDEO_ASPECT_RATIO_INVALID") },
    { item: "CTA presente e consistente no vídeo", passed: !hasIssue("VIDEO_CTA_MISSING") && !hasIssue("VIDEO_CTA_DIVERGENT") },
    { item: "Gancho inicial claro no roteiro", passed: !hasIssue("VIDEO_HOOK_UNCLEAR") },
    { item: "Ritmo visual definido pela direção", passed: !hasIssue("VIDEO_RHYTHM_UNDEFINED") },
    { item: "Textos na tela legíveis", passed: !hasIssue("VIDEO_ON_SCREEN_TEXT_TOO_LONG") },
    { item: "Campos públicos do vídeo sem notas internas", passed: !hasIssue("VIDEO_INTERNAL_TEXT_VISIBLE") },
    { item: "Tema principal preservado até a entrega de vídeo", passed: !hasIssue("VIDEO_THEME_DRIFT") },
    { item: "End card com marca, URL e CTA", passed: !hasIssue("VIDEO_END_CARD_INCOMPLETE") },
    { item: "Motion por elemento com ritmo e variedade", passed: !hasIssue("VIDEO_MOTION_COMPOSITION_WEAK") && !hasIssue("VIDEO_ANIMATION_REPETITIVE") },
    { item: "Mockups com movimento interno", passed: !hasIssue("VIDEO_MOCKUP_STATIC") },
    { item: "Elementos entram em timeline escalonada", passed: !hasIssue("VIDEO_ELEMENTS_SIMULTANEOUS") },
    { item: "Cenas com direção de arte completa", passed: !hasIssue("VIDEO_SCENE_DESIGN_MISSING") },
    { item: "Variação entre pessoas, produto, contexto e interface", passed: !hasIssue("VIDEO_MOCKUP_PRESENTATION") },
    { item: "Profundidade visual e layout não repetitivo", passed: !hasIssue("VIDEO_VISUAL_DEPTH_WEAK") && !hasIssue("VIDEO_LAYOUT_REPETITIVE") },
    { item: "Cenas de desenvolvimento com decisão de edição própria (sem duplicidade)", passed: !hasIssue("VIDEO_SCENE_DECISIONS_DUPLICATED") },
    { item: "Ritmo com progressão de duração entre cenas", passed: !hasIssue("VIDEO_RHYTHM_MONOTONOUS") },
    { item: "Nenhuma cena isolada domina o vídeo", passed: !hasIssue("VIDEO_SCENE_TOO_LONG") },
    { item: "Enquadramento/composição não se repete entre cenas de desenvolvimento", passed: !hasIssue("VIDEO_FRAMING_REPETITIVE") },
    {
      item: "Identidade criativa da campanha (Creative DNA) preservada no conteúdo final",
      passed: !hasIssue("CREATIVE_DNA_HERO_SCENE_MISSING")
        && !hasIssue("CREATIVE_DNA_HERO_FRAME_MISSING")
        && !hasIssue("CREATIVE_DNA_VISUAL_METAPHOR_MISSING")
        && !hasIssue("CREATIVE_DNA_EMOTION_NOT_PERCEIVED")
        && !hasIssue("CREATIVE_DNA_IDENTITY_DRIFT"),
    },
    { item: "Narração sincronizada com as cenas", passed: !hasIssue("VIDEO_NARRATION_MISSING") && !hasIssue("VIDEO_NARRATION_TIMING_INVALID") },
    { item: "Voz validada e mixada em primeiro plano", passed: !hasIssue("VIDEO_NARRATION_AUDIO_INVALID") && !hasIssue("VIDEO_NARRATION_CLIPPING") && !hasIssue("VIDEO_AUDIO_DUCKING_MISSING") },
    { item: "Texto na tela não repete integralmente a narração", passed: !hasIssue("VIDEO_VOICE_TEXT_REDUNDANT") },
    { item: "Qualidade técnica mínima do arquivo de vídeo", passed: !hasIssue("VIDEO_TECHNICAL_QUALITY_LOW") && !hasIssue("NO_VIDEO_FILE") },
    {
      item: "Production Readiness: campanha tinha material real suficiente para virar um comercial",
      passed: !hasIssue("PRODUCTION_READINESS_LOW")
        && !hasIssue("PRODUCTION_ASSET_DIVERSITY_LOW")
        && !hasIssue("PRODUCTION_HUMAN_PRESENCE_LOW")
        && !hasIssue("PRODUCTION_SCENE_VARIETY_LOW")
        && !hasIssue("PRODUCTION_SHOT_VARIETY_LOW"),
    },
    { item: "Qualidade geral aceitável", passed: overallScore >= thresholds.warningScoreThreshold, notes: `Score geral: ${overallScore}.` },
  ];

  if (qualityProfile === "story") {
    checklist.push(
      { item: "Texto curto e leitura imediata (perfil Story)", passed: !hasIssue("STORY_CAPTION_TOO_LONG") },
      { item: "CTA curto (perfil Story)", passed: !hasIssue("STORY_CTA_TOO_LONG") },
      { item: "Gera curiosidade (perfil Story)", passed: !hasIssue("STORY_MISSING_CURIOSITY") },
    );
  }
  if (qualityProfile === "carrossel") {
    checklist.push(
      { item: "Progressão entre slides (perfil Carrossel)", passed: !hasIssue("CARROSSEL_INSUFFICIENT_PROGRESSION") },
      { item: "Fechamento forte com CTA final (perfil Carrossel)", passed: !hasIssue("CARROSSEL_MISSING_FINAL_CTA") },
    );
  }
  if (qualityProfile === "reels" || qualityProfile === "video") {
    checklist.push({
      item: `Pacote de vídeo completo (hook, ritmo, CTA, encerramento) para ${qualityProfile === "reels" ? "Reels" : "Vídeo"}`,
      passed: !hasIssue("MISSING_VIDEO_PACKAGE_FOR_FORMAT"),
    });
  }

  return checklist;
}

function buildSuggestions(issues: LucasIssue[]): LucasSuggestion[] {
  return issues.map((current) => ({ relatedIssueCode: current.code, message: suggestionFor(current) }));
}

function suggestionFor(current: LucasIssue): string {
  switch (current.code) {
    case "NO_IMAGES_GENERATED": return "Solicitar ao Pedro a geração das imagens antes de prosseguir.";
    case "IMAGE_COUNT_MISMATCH": return "Confirmar com o Pedro a quantidade correta de imagens geradas.";
    case "WEAK_STRATEGY_KEY_MESSAGES": return "Pedir ao João para detalhar as mensagens principais da estratégia.";
    case "COPY_MISSING_TITLE": return "Pedir à Maria um título para a copy.";
    case "COPY_MISSING_CAPTION": return "Pedir à Maria uma legenda para a copy.";
    case "COPY_LOW_QUALITY_SCORE": return "Revisar a copy com a Maria antes de aprovar.";
    case "VISUAL_CONCEPT_MISSING": return "Pedir à Sofia um conceito visual definido.";
    case "FORMAT_MISMATCH": return "Alinhar o formato entre a direção visual e a solicitação original.";
    case "CHANNEL_MISMATCH": return "Alinhar o canal entre a estratégia e a solicitação original.";
    case "ASPECT_RATIO_MISMATCH": return "Ajustar a proporção da imagem para bater com a recomendação da Sofia.";
    case "CTA_DIVERGENT": return "Alinhar o CTA da copy com o CTA recomendado pela estratégia.";
    case "TONE_INCONSISTENT": return "Revisar o tom de voz da copy para bater com o tom da marca.";
    case "FORBIDDEN_WORD_FOUND": return "Remover o termo proibido da copy antes de qualquer publicação.";
    case "FORBIDDEN_HASHTAG_FOUND": return "Remover a hashtag proibida da copy antes de qualquer publicação.";
    case "MANDATORY_WORD_MISSING": return "Incluir o termo obrigatório da marca na copy.";
    case "NO_RISKS_DOCUMENTED": return "Pedir ao João, à Sofia ou à Bianca para documentar riscos.";
    case "NO_VIDEO_FILE": return "Aguardar o Rafa renderizar e registrar o vídeo final antes de revisar novamente.";
    case "VIDEO_TECHNICAL_QUALITY_LOW": return "Pedir ao Rafa para confirmar que o vídeo final salvo é um arquivo real, não um placeholder.";
    case "VIDEO_NOT_VERTICAL": return "Corrigir a orientação do vídeo para vertical antes de prosseguir.";
    case "VIDEO_ASPECT_RATIO_INVALID": return "Ajustar a proporção do vídeo final para 9:16.";
    case "VIDEO_DURATION_MISMATCH": return "Confirmar com o Diego e o Rafa a duração final correta do vídeo.";
    case "VIDEO_HOOK_UNCLEAR": return "Pedir ao Bruno um gancho inicial mais claro no roteiro.";
    case "VIDEO_CTA_MISSING": return "Pedir ao Bruno um CTA final para o roteiro de vídeo.";
    case "VIDEO_CTA_DIVERGENT": return "Alinhar o CTA final do vídeo com o CTA recomendado pela estratégia.";
    case "VIDEO_RHYTHM_UNDEFINED": return "Pedir à Vanessa para definir o ritmo visual do vídeo.";
    case "VIDEO_ON_SCREEN_TEXT_TOO_LONG": return "Pedir ao Diego para encurtar os textos na tela das cenas apontadas.";
    case "VIDEO_INTERNAL_TEXT_VISIBLE": return "Bloquear a renderização/publicação e corrigir Bruno/Diego/Rafa para renderizar somente campos explicitamente públicos.";
    case "VIDEO_THEME_DRIFT": return "Pedir ao Bruno para reequilibrar o roteiro e tratar cada funcionalidade como prova do tema central, não como tema dominante.";
    case "VIDEO_END_CARD_INCOMPLETE": return "Pedir à Vanessa/Diego/Rafa uma end card com logo oficial, CTA e URL rumoaoaltar.com.br em área segura.";
    case "VIDEO_COHERENCE_MISMATCH": return "Confirmar com Bruno, Vanessa e Diego que o número de cenas está alinhado entre roteiro, direção e edição.";
    case "VIDEO_MOTION_COMPOSITION_WEAK": return "Pedir ao Rafa para compor a cena com elementos independentes animados, em vez de apenas imagem + texto + zoom.";
    case "VIDEO_MOCKUP_STATIC": return "Pedir ao Rafa para aplicar movimento interno/float/scroll no mockup durante a cena.";
    case "VIDEO_ELEMENTS_SIMULTANEOUS": return "Pedir ao Rafa para escalonar a entrada de background, imagem, headline, complemento e CTA na timeline.";
    case "VIDEO_ANIMATION_REPETITIVE": return "Pedir ao Diego/Rafa para variar animações e transições de acordo com a função narrativa de cada cena.";
    case "VIDEO_VISUAL_DEPTH_WEAK": return "Pedir à Vanessa/Rafa para compor cenas com camadas reais: fundo, primeiro plano, produto integrado e texto em área segura.";
    case "VIDEO_LAYOUT_REPETITIVE": return "Pedir ao Diego/Rafa para variar padrões de layout entre cenas, evitando a mesma estrutura imagem + texto.";
    case "VIDEO_MOCKUP_PRESENTATION": return "Pedir à Vanessa/VisualAssetResolver para alternar pessoa usando produto, mockup, screenshot, contexto humano e end card.";
    case "VIDEO_SCENE_DESIGN_MISSING": return "Pedir à Vanessa para preencher direção de arte completa por cena antes da edição/renderização.";
    case "VIDEO_NARRATION_MISSING": return "Executar Nora antes do Rafa para criar, validar e entregar o arquivo real de narração.";
    case "VIDEO_NARRATION_TIMING_INVALID": return "Pedir à Nora para reajustar os segmentos falados ao tempo real da timeline do Diego.";
    case "VIDEO_NARRATION_AUDIO_INVALID": return "Gerar novamente o arquivo de voz no caminho solicitado pela Nora e retomar o workflow com --continue.";
    case "VIDEO_NARRATION_CLIPPING": return "Normalizar ou regerar a voz com menor ganho antes de mixar no Rafa.";
    case "VIDEO_AUDIO_DUCKING_MISSING": return "Pedir ao Rafa para aplicar ducking da trilha musical durante os segmentos falados.";
    case "VIDEO_VOICE_TEXT_REDUNDANT": return "Pedir ao Diego/Rafa para reduzir textos na tela quando a Nora já narra a informação.";
    case "VIDEO_SCENE_DECISIONS_DUPLICATED": return "Pedir ao Diego/Vanessa para variar transição, animação de texto, máscara, glow e blur entre as cenas de desenvolvimento apontadas.";
    case "VIDEO_RHYTHM_MONOTONOUS": return "Pedir ao Bruno/Diego para variar a duração das cenas, alternando corte rápido, respiro e impacto.";
    case "VIDEO_SCENE_TOO_LONG": return "Pedir ao Bruno para redistribuir a duração da cena apontada — nenhuma cena isolada deveria dominar um comercial curto.";
    case "VIDEO_FRAMING_REPETITIVE": return "Pedir à Vanessa para variar composição/enquadramento entre as cenas de desenvolvimento apontadas.";
    case "CREATIVE_DNA_HERO_SCENE_MISSING": return "Pedir ao Bruno/Vanessa para aproximar a cena real da Hero Scene definida pelo Creative DNA da campanha.";
    case "CREATIVE_DNA_HERO_FRAME_MISSING": return "Pedir à Vanessa/Rafa para compor ao menos uma cena próxima do Hero Frame definido pelo Creative DNA.";
    case "CREATIVE_DNA_VISUAL_METAPHOR_MISSING": return "Pedir à Vanessa para reforçar a metáfora visual do Creative DNA na composição das cenas.";
    case "CREATIVE_DNA_EMOTION_NOT_PERCEIVED": return "Pedir à Nora/Bruno para reforçar a emoção dominante do Creative DNA na narração e no roteiro.";
    case "CREATIVE_DNA_IDENTITY_DRIFT": return "Revisar o pacote inteiro contra o Creative DNA da campanha antes de prosseguir; a identidade criativa parece ter se perdido ao longo do fluxo.";
    case "STORY_CAPTION_TOO_LONG": return "Pedir à Maria para encurtar a legenda do Story para leitura imediata.";
    case "STORY_CTA_TOO_LONG": return "Pedir à Maria um CTA mais curto e direto para o Story.";
    case "STORY_MISSING_CURIOSITY": return "Pedir à Maria para reforçar a curiosidade na legenda do Story.";
    case "CARROSSEL_INSUFFICIENT_PROGRESSION": return "Solicitar mais slides ao Pedro/Bianca para sustentar a progressão do carrossel.";
    case "CARROSSEL_MISSING_FINAL_CTA": return "Pedir à Maria um CTA final claro para fechar o carrossel.";
    case "MISSING_VIDEO_PACKAGE_FOR_FORMAT": return "Confirmar com Bruno, Vanessa, Diego e Rafa que o pacote de vídeo foi produzido para este formato.";
    case "PRODUCTION_READINESS_LOW": return "Não aprovar: pedir ao Rafa/VisualAssetResolver para criar os assets do Production Plan em falta e retomar antes de renderizar de novo.";
    case "PRODUCTION_ASSET_DIVERSITY_LOW": return "Pedir ao VisualAssetResolver assets físicos novos para os Shots que reutilizam arquivo já usado em outro Shot.";
    case "PRODUCTION_HUMAN_PRESENCE_LOW": return "Pedir ao VisualAssetResolver mais assets com pessoa/casal real para os Shots que exigem presença humana.";
    case "PRODUCTION_SCENE_VARIETY_LOW": return "Pedir ao VisualAssetResolver para variar enquadramento, composição, casal e mockup entre Shots consecutivos.";
    case "PRODUCTION_SHOT_VARIETY_LOW": return "Pedir ao VisualAssetResolver mais arquivos físicos distintos — a variedade bruta de asset está abaixo do aceitável para o vídeo inteiro.";
    default: return "Revisar o item apontado antes de aprovar.";
  }
}

function buildRisks(input: LucasQualityReviewRequestInput, issues: LucasIssue[]): string[] {
  const risks = new Set<string>([
    ...(input.joaoStrategy.risks ?? []),
    ...(input.sofiaDirection?.visualRisks ?? []),
    ...(input.biancaDesign?.designRisks ?? []),
  ]);
  for (const current of issues) {
    if (current.severity === "high") risks.add(current.message);
  }
  return Array.from(risks);
}

function buildObservations(input: LucasQualityReviewRequestInput, context: ClaraContextResponse): string[] {
  const observations: string[] = [];
  if (!context.modules.PublishingContext?.length) {
    observations.push("Nenhum fluxo de publicação registrado na Clara; confirmar processo de aprovação manualmente.");
  }
  if (input.mariaCopy.qualityPassed === false) {
    observations.push("A Maria não considerou a própria copy aprovada em sua autoavaliação de qualidade.");
  }
  return observations;
}

function buildNextSteps(status: LucasReviewStatus): string[] {
  if (status === "approved") {
    return ["Encaminhar o pacote para aprovação humana.", "Nenhum ajuste obrigatório identificado."];
  }
  if (status === "approved_with_warnings") {
    return ["Encaminhar o pacote para aprovação humana com os avisos registrados.", "Considerar os ajustes sugeridos antes da publicação."];
  }
  if (status === "needs_adjustments") {
    return ["Retornar o pacote para ajustes antes de seguir para aprovação humana.", "Tratar as sugestões listadas antes de nova revisão."];
  }
  return ["Bloquear o pacote até que os problemas críticos sejam corrigidos.", "Não encaminhar para aprovação humana ou publicação neste estado."];
}

export function buildIcaroReviewPrompt(input: LucasQualityReviewRequestInput, review: LucasReviewCore): string {
  return [
    "Você é o apoio de IA de Lucas, Especialista em Revisão de Qualidade do Zuno.",
    "Complemente apenas observações e sugestões adicionais; não altere copy, imagem, score, status ou checklist.",
    "Retorne apenas JSON válido, sem markdown.",
    "",
    "PADRÃO DE QUALIDADE OBRIGATÓRIO:",
    [
      "- observações específicas e acionáveis, nunca genéricas ou repetindo o que a revisão heurística já disse;",
      "- sugestões devem apontar exatamente qual Skill anterior (João, Maria, Sofia, Bianca, Pedro, Bruno, Vanessa, Diego ou Rafa) precisa ajustar o quê.",
    ].join("\n"),
    "",
    "RESTRIÇÕES NEGATIVAS:",
    [
      "- não inventar problema que não esteja refletido na revisão heurística já calculada;",
      "- não sugerir mudança de score, status ou checklist — isso é exclusivo da heurística determinística.",
    ].join("\n"),
    "",
    "SOLICITAÇÃO ORIGINAL:",
    input.originalRequest,
    "",
    "REVISÃO HEURÍSTICA JÁ CALCULADA:",
    JSON.stringify(review, null, 2),
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify({ additionalObservations: ["Observação complementar"], additionalSuggestions: ["Sugestão complementar"] }, null, 2),
  ].join("\n");
}

export function parseReviewEnhancement(content: string): LucasReviewEnhancement {
  const parsed = JSON.parse(extractJson(content, "Lucas")) as Partial<Record<keyof LucasReviewEnhancement, unknown>>;
  return {
    additionalObservations: normalizeStringArray(parsed.additionalObservations),
    additionalSuggestions: normalizeStringArray(parsed.additionalSuggestions),
  };
}

export function mergeReviewEnhancement(review: LucasReviewCore, enhancement: LucasReviewEnhancement): LucasReviewCore {
  return {
    ...review,
    observations: [...review.observations, ...(enhancement.additionalObservations ?? [])],
    suggestions: [
      ...review.suggestions,
      ...(enhancement.additionalSuggestions ?? []).map((message) => ({ message })),
    ],
  };
}

function issue(code: LucasIssueCode, category: LucasIssue["category"], message: string, severity: LucasIssueSeverity): LucasIssue {
  return { code, category, message, severity };
}

function containsComparable(text: string, expected: string): boolean {
  return normalize(text).includes(normalize(expected));
}

function containsAnyComparable(text: string, expectedTerms: string[]): boolean {
  const normalized = normalize(text);
  return expectedTerms.map(normalize).filter(Boolean).some((term) => normalized.includes(term));
}

export function createLucasQualityReviewSkill(
  dependencies: Partial<LucasQualityReviewSkillDependencies> = {},
): LucasQualityReviewSkill {
  return new LucasQualityReviewSkill({
    valentina: dependencies.valentina ?? missingPort<ValentinaTenantPort>("ValentinaTenantPort"),
    clara: dependencies.clara ?? missingPort<ClaraKnowledgePort>("ClaraKnowledgePort"),
    icaro: dependencies.icaro,
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
    approvalScoreThreshold: dependencies.approvalScoreThreshold,
    warningScoreThreshold: dependencies.warningScoreThreshold,
    adjustmentScoreThreshold: dependencies.adjustmentScoreThreshold,
  });
}
