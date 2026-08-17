import type { IcaroBrainPort } from "../../application/ai/icaro-brain.contract.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { extractJson, normalize, normalizeStringArray } from "../../shared/utils/skill-parsing.js";
import { buildDeveloperAiPendingResponse, isDeveloperAssistancePending } from "../../shared/utils/developer-ai-assistance.js";
import type { DeveloperAssistancePendingOutput } from "../../application/ai/developer-assistance.types.js";
import { resolveContentQualityProfile, type ContentQualityProfile } from "../../shared/utils/content-quality-profile.js";
import { detectGenericPhrases } from "../../shared/utils/generic-phrase-detector.js";
import { mariaCopywritingManifest } from "./maria.manifest.js";
import type { MariaLogAction, MariaLoggerPort } from "./maria-log.contract.js";
import type {
  MariaAttemptReport,
  MariaCopyBriefing,
  MariaCopyStrategy,
  MariaCopywritingOutput,
  MariaQualityIssue,
  MariaQualityReport,
  MariaStructuredCopy,
} from "./maria-copywriting.types.js";

export type MariaIdGenerator = {
  create(prefix: string): string;
};

export type MariaCopywritingSkillDependencies = {
  icaro: IcaroBrainPort;
  logger?: MariaLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: MariaIdGenerator;
  now?: () => Date;
  maxAttempts?: number;
  minimumQualityScore?: number;
};

class SequentialMariaIdGenerator implements MariaIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopMariaLogger implements MariaLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class MissingIcaroBrain implements IcaroBrainPort {
  async request(): Promise<never> {
    throw new Error("IcaroBrainPort não configurado para Maria.");
  }
}

/** Une a saída normal de Maria à pausa aguardando IA desenvolvedora, mesmo padrão de `PedroSkillOutput`. */
export type MariaSkillOutput = MariaCopywritingOutput | DeveloperAssistancePendingOutput;

export class MariaCopywritingSkill implements Skill<MariaCopyBriefing, MariaSkillOutput> {
  readonly manifest = mariaCopywritingManifest;

  private readonly icaro: IcaroBrainPort;
  private readonly logger: MariaLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: MariaIdGenerator;
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private readonly minimumQualityScore: number;

  constructor(dependencies: MariaCopywritingSkillDependencies) {
    this.icaro = dependencies.icaro;
    this.logger = dependencies.logger ?? new NoopMariaLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialMariaIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
    this.maxAttempts = dependencies.maxAttempts ?? 3;
    this.minimumQualityScore = dependencies.minimumQualityScore ?? 82;
  }

  async execute(request: SkillRequest<MariaCopyBriefing>): Promise<SkillResponse<MariaSkillOutput>> {
    const briefingValidation = validateBriefing(request.input);
    if (briefingValidation.length > 0) {
      await this.log("ValidationFailed", "Briefing estruturado inválido.", request, undefined, { errors: briefingValidation });
      await this.emit("CopyGenerationFailed", request, { reason: "INVALID_BRIEFING", errors: briefingValidation });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: briefingValidation,
        error: {
          code: "INVALID_BRIEFING",
          message: briefingValidation.join("; "),
          recoverable: true,
        },
      };
    }

    try {
      return await this.runGeneration(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado durante a geração de copy.";
      await this.log("Error", `Erro inesperado em Maria. ${message}`, request, undefined, { error: message });
      await this.emit("CopyGenerationFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
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

  private async runGeneration(request: SkillRequest<MariaCopyBriefing>): Promise<SkillResponse<MariaSkillOutput>> {
    await this.log("BriefingReceived", "Briefing estruturado recebido pela Maria.", request, undefined, {
      channel: request.input.channel,
      objective: request.input.objective,
    });
    await this.log("GenerationStarted", "Geração de copy iniciada.", request);
    await this.emit("CopyGenerationStarted", request, { channel: request.input.channel });

    const strategy = createCopyStrategy(request.input);
    const attempts: MariaAttemptReport[] = [];
    let bestAttempt: MariaAttemptReport | undefined;
    let previousIssues: MariaQualityIssue[] = [];
    let lastProviderError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await this.log("AttemptStarted", `Tentativa ${attempt} iniciada.`, request, attempt);
      const prompt = buildMariaPrompt(request.input, strategy, previousIssues, attempt);
      await this.log("PromptBuilt", `Prompt criado para tentativa ${attempt}.`, request, attempt, { prompt });
      await this.emit("PromptBuilt", request, { attempt, prompt });
      await this.emit("AIGenerationStarted", request, { attempt });

      try {
        const aiResponse = await this.icaro.request({
          taskType: "text_generation",
          prompt,
          specialistId: this.manifest.id,
          executionId: request.context.executionId,
          taskId: request.context.taskId,
          correlationId: request.context.correlationId,
          context: {
            skillId: this.manifest.id,
            channel: request.input.channel,
            objective: request.input.objective,
            attempt,
          },
          constraints: [
            "Retornar apenas JSON válido.",
            "Não criar imagem, vídeo, campanha ou publicação.",
            "Respeitar contrato de saída estruturado da Maria.",
          ],
          expectedOutput: "json",
          priority: "quality",
          temperature: 0.78,
          maxTokens: 2400,
        });
        if (aiResponse.status !== "completed") {
          throw new Error(aiResponse.error?.message ?? "Ícaro não retornou uma resposta concluída para Maria.");
        }

        await this.emit("AIGenerationFinished", request, {
          attempt,
          provider: aiResponse.provider,
          model: aiResponse.model,
          tokens: aiResponse.tokens,
          cost: aiResponse.cost,
        });

        const copy = parseStructuredCopy(String(aiResponse.content ?? ""), request.input);
        const quality = evaluateCopyQuality(copy, request.input, attempt, this.minimumQualityScore);
        const attemptReport: MariaAttemptReport = {
          attempt,
          prompt,
          providerModel: [aiResponse.provider.id, aiResponse.model.id].filter(Boolean).join("/") || undefined,
          copy,
          quality,
        };
        attempts.push(attemptReport);
        bestAttempt = chooseBestAttempt(bestAttempt, attemptReport);
        previousIssues = quality.issues;

        await this.log("QualityEvaluated", `Qualidade avaliada na tentativa ${attempt}.`, request, attempt, {
          score: quality.score,
          passed: quality.passed,
          issues: quality.issues,
        });
        await this.emit("CopyValidated", request, { attempt, score: quality.score, passed: quality.passed, issues: quality.issues });

        if (quality.passed) {
          await this.log("CopyApproved", "Copy aprovada pela autoavaliação da Maria.", request, attempt, { score: quality.score });
          return this.deliver(request, attemptReport, attempts, false);
        }
      } catch (error) {
        if (isDeveloperAssistancePending(error)) {
          // Diferente de uma falha real do Ícaro, "aguardando IA desenvolvedora" não é motivo
          // para consumir tentativas do loop de qualidade — pausa o workflow imediatamente.
          return buildDeveloperAiPendingResponse(this.manifest.id, request.context.taskId, error);
        }
        lastProviderError = error instanceof Error ? error : new Error("Erro desconhecido no Ícaro.");
        await this.log("ProviderError", `Ícaro falhou na tentativa ${attempt}.`, request, attempt, {
          error: lastProviderError.message,
        });
      }
    }

    if (bestAttempt?.copy) {
      return this.deliver(request, bestAttempt, attempts, true);
    }

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "failed",
      artifacts: [],
      warnings: ["Nenhuma tentativa retornou uma copy estruturada aproveitável."],
      error: {
        code: "AI_PROVIDER_FAILURE",
        message: lastProviderError?.message ?? "Ícaro não retornou uma resposta válida.",
        recoverable: true,
      },
    };
  }

  private async deliver(
    request: SkillRequest<MariaCopyBriefing>,
    selectedAttempt: MariaAttemptReport,
    attempts: MariaAttemptReport[],
    deliveredBestEffort: boolean,
  ): Promise<SkillResponse<MariaCopywritingOutput>> {
    if (!selectedAttempt.copy) {
      throw new Error("Tentativa selecionada não possui copy.");
    }

    const output: MariaCopywritingOutput = {
      ...selectedAttempt.copy,
      quality: selectedAttempt.quality,
      attempts,
      deliveredBestEffort,
      aiProviderId: selectedAttempt.providerModel?.split("/")[0],
    };

    await this.log("CopyDelivered", "Copy estruturada devolvida pela Maria.", request, selectedAttempt.attempt, {
      deliveredBestEffort,
      score: selectedAttempt.quality.score,
    });
    await this.emit("CopyDelivered", request, {
      attempt: selectedAttempt.attempt,
      deliveredBestEffort,
      score: selectedAttempt.quality.score,
    });

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "completed",
      output,
      artifacts: [
        {
          id: this.idGenerator.create("artifact"),
          type: "text",
          name: "Copy estruturada da Maria",
          metadata: {
            channel: request.input.channel,
            score: selectedAttempt.quality.score,
            deliveredBestEffort,
          },
        },
      ],
      warnings: deliveredBestEffort ? selectedAttempt.quality.issues.map((issue) => issue.message) : [],
    };
  }

  private async log(
    action: MariaLogAction,
    message: string,
    request: SkillRequest<MariaCopyBriefing>,
    attempt?: number,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("maria-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      executionId: request.context.executionId,
      taskId: request.context.taskId,
      attempt,
      metadata,
    });
  }

  private async emit(name: ZunoEventName, request: SkillRequest<MariaCopyBriefing>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "maria",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export function createCopyStrategy(briefing: MariaCopyBriefing): MariaCopyStrategy {
  const platformGuidance = platformGuidanceFor(briefing);
  const constraints = [
    `Canal: ${briefing.channel}`,
    `Tom de voz: ${briefing.toneOfVoice}`,
    `CTA obrigatório: ${briefing.cta}`,
    "Legenda precisa soar humana, específica e pronta para publicação.",
    "Usar hook forte, dor, benefício, solução, curiosidade e CTA convincente.",
    "Estimular comentários, salvamentos e compartilhamentos sem soar forçado.",
    "Gerar entre 15 e 25 hashtags relevantes, sem duplicar.",
    ...(briefing.forbiddenTerms ?? []).map((term) => `Evitar termo: ${term}`),
    ...(briefing.mandatoryWords ?? []).map((word) => `Incluir obrigatoriamente: ${word}`),
    ...(briefing.preferredHashtags?.length ? [`Priorizar estas hashtags da marca: ${briefing.preferredHashtags.join(", ")}`] : []),
  ];

  return {
    objective: briefing.objective,
    channel: briefing.channel,
    audience: briefing.targetAudience,
    tone: briefing.toneOfVoice,
    cta: briefing.cta,
    hookAngle: inferHookAngle(briefing),
    valueProposition: briefing.offer
      ? `${briefing.keyMessage} Oferta ou destaque: ${briefing.offer}.`
      : briefing.keyMessage,
    platformGuidance,
    constraints,
  };
}

export function buildMariaPrompt(
  briefing: MariaCopyBriefing,
  strategy: MariaCopyStrategy,
  previousIssues: MariaQualityIssue[] = [],
  attempt = 1,
): string {
  const issueGuidance = previousIssues.length
    ? previousIssues.map((issue) => `- Corrigir: ${issue.message}`).join("\n")
    : "- Primeira geração: priorizar clareza, fluidez, CTA forte e saída JSON válida.";

  return [
    "Você é Maria, Especialista em Copywriting do Zuno.",
    "Crie exclusivamente texto de marketing. Não crie imagem, vídeo, campanha ou publicação.",
    "Retorne apenas JSON válido, sem markdown.",
    "",
    "PADRÃO DE QUALIDADE OBRIGATÓRIO:",
    [
      "- legenda natural, humana e específica, sem parecer texto gerado por IA;",
      "- gancho forte nas duas primeiras linhas, criando curiosidade ou identificação imediata;",
      "- estrutura persuasiva com dor, benefício e solução (AIDA, PAS ou variação adequada ao objetivo);",
      "- emojis equilibrados e contextuais: usar de 2 a 5 emojis no total, sem poluir a leitura;",
      "- convite explícito para comentar, salvar e compartilhar quando fizer sentido para o canal;",
      "- CTA claro, convincente e separado da legenda, nunca implícito;",
      "- hashtags entre 15 e 25, misturando grandes, médias e nichadas, sempre relacionadas ao conteúdo;",
      "- incluir hashtags da marca quando preferredHashtags existir e criar variações de nicho relacionadas ao briefing;",
      "- tom de voz consistente do início ao fim, sem mudança de registro;",
      "- zero repetição excessiva de palavras e zero hashtag duplicada;",
      "- evitar frases genéricas, clichês e construções repetidas (ex.: \"descubra um novo jeito de\", \"qualidade e estilo para você\", \"não perca essa oportunidade\") — só usar uma frase desse tipo se ela for literalmente justificada pelo briefing.",
    ].join("\n"),
    "",
    "SEPARAÇÃO DE FUNÇÃO ENTRE OS TEXTOS (obrigatório, não repetir a mesma mensagem em dois lugares):",
    [
      "- imageHeadline: texto CURTO (no máximo ~6 palavras) que vai DENTRO da imagem gerada — uma mensagem só, sem parágrafo, impacto imediato. NUNCA repete title literalmente e nunca é uma frase completa com sujeito+predicado longo.",
      "- title: complementa a imagem e gera interesse por conta própria — nunca copia imageHeadline.",
      "- caption: desenvolve a ideia, contextualiza, apresenta o benefício/oferta quando existir, e termina com o cta.",
      "- cta: relacionado ao objetivo real da publicação (ver marketingObjective abaixo), nunca genérico.",
    ].join("\n"),
    "",
    "RESTRIÇÕES NEGATIVAS:",
    [
      "- nunca usar qualquer termo listado em forbiddenTerms, em nenhuma variação;",
      "- nunca omitir uma palavra listada em mandatoryWords — cada uma precisa aparecer no título ou na legenda;",
      "- nunca inventar oferta, preço, prazo ou garantia que não estejam no briefing;",
      "- ao escolher hashtags, priorizar preferredHashtags quando existirem, antes de sugerir novas.",
      "- não colocar hashtags dentro do campo caption; hashtags devem ficar somente no campo hashtags;",
      "- não colocar o CTA dentro do campo hashtags; CTA deve ficar somente no campo cta e na publication.",
    ].join("\n"),
    "",
    "BRIEFING ESTRUTURADO:",
    JSON.stringify(briefing, null, 2),
    "",
    "ESTRATÉGIA DE COPY:",
    JSON.stringify(strategy, null, 2),
    "",
    ...(briefing.avoidRepeating
      ? ["MEMÓRIA EDITORIAL — evitar repetir headline, CTA ou conceito recentes deste cliente:", briefing.avoidRepeating, ""]
      : []),
    `TENTATIVA: ${attempt}`,
    "AJUSTES NECESSÁRIOS:",
    issueGuidance,
    "",
    "FORMATO OBRIGATÓRIO DO JSON:",
    JSON.stringify({
      title: "Título curto e forte, complementar à imagem",
      imageHeadline: "Texto curtíssimo para dentro da imagem, diferente do título",
      caption: "Legenda pronta para o canal",
      cta: briefing.cta,
      hashtags: ["#exemplo1", "#exemplo2", "#exemplo3", "#exemplo4", "#exemplo5", "#exemplo6", "#exemplo7", "#exemplo8", "#exemplo9", "#exemplo10", "#exemplo11", "#exemplo12", "#exemplo13", "#exemplo14", "#exemplo15"],
      publication: "Legenda completa\\n\\nCTA\\n\\n#hashtags",
      keywords: briefing.keywords ?? [],
      summary: "Resumo da intenção da copy",
      objective: briefing.objective,
      toneUsed: briefing.toneOfVoice,
      identifiedAudience: briefing.targetAudience,
      futureSuggestions: ["Sugestão futura"],
      observations: ["Observação relevante"],
    }, null, 2),
  ].join("\n");
}

export function evaluateCopyQuality(
  copy: MariaStructuredCopy,
  briefing: MariaCopyBriefing,
  attempt: number,
  minimumQualityScore = 82,
): MariaQualityReport {
  const issues: MariaQualityIssue[] = [];
  const profile = resolveContentQualityProfile(briefing.format);
  const rules = MARIA_QUALITY_PROFILE_RULES[profile];
  const captionLength = copy.caption.trim().length;
  const maxCaptionLength = briefing.platformLimitations?.maxCaptionLength ?? rules.maxCaptionLength ?? defaultMaxCaptionLength(briefing.channel);
  const hashtagRange = hashtagRangeFor(briefing, rules);
  const maxHashtags = hashtagRange.max;

  if (!copy.title.trim()) issues.push(issue("MISSING_TITLE", "Título ausente.", "high"));
  if (!copy.caption.trim()) issues.push(issue("MISSING_CAPTION", "Legenda ausente.", "high"));
  if (!copy.cta.trim()) issues.push(issue("MISSING_CTA", "CTA ausente.", "high"));
  if (!copy.publication.trim()) {
    issues.push(issue("MISSING_PUBLICATION", "Versão completa da publicação ausente.", "high"));
  } else if (!publicationMatches(copy)) {
    issues.push(issue("MISSING_PUBLICATION", "publication não combina legenda, CTA e hashtags na estrutura final esperada.", "high"));
  }
  if (captionLength > maxCaptionLength) {
    issues.push(issue("CAPTION_TOO_LONG", `Legenda excede o limite recomendado de ${maxCaptionLength} caracteres para o formato ${rules.label}.`, "high"));
  }
  if (rules.minCaptionLength !== undefined && captionLength < rules.minCaptionLength) {
    issues.push(issue("CAPTION_TOO_SHORT", `Legenda curta demais para o formato ${rules.label}: mínimo recomendado de ${rules.minCaptionLength} caracteres para sustentar hook, dor, benefício e solução.`, "medium"));
  }
  if (rules.requireCtaInCaption && !containsComparable(copy.caption, copy.cta) && !containsComparable(copy.cta, briefing.cta)) {
    issues.push(issue("WEAK_CTA", "CTA não aparece com força suficiente na legenda.", "high"));
  }
  if (rules.maxCtaLength !== undefined && copy.cta.trim().length > rules.maxCtaLength) {
    issues.push(issue("CTA_TOO_LONG_FOR_FORMAT", `CTA longo demais para o formato ${rules.label}: máximo recomendado de ${rules.maxCtaLength} caracteres para leitura imediata.`, "medium"));
  }
  if (!containsAnyComparable(copy.toneUsed, briefing.toneOfVoice.split(/\s+/)) && !containsAnyComparable(copy.caption, briefing.toneOfVoice.split(/\s+/))) {
    issues.push(issue("TONE_INCONSISTENT", "Tom de voz declarado não parece consistente com o briefing.", "medium"));
  }
  if (hasExcessiveRepetition(copy.caption)) issues.push(issue("EXCESSIVE_REPETITION", "Há repetição excessiva de termos na legenda.", "medium"));
  if (hasDuplicatedHashtags(copy.hashtags)) issues.push(issue("DUPLICATED_HASHTAGS", "Há hashtags duplicadas.", "medium"));
  if (copy.hashtags.length < hashtagRange.min) {
    issues.push(issue("TOO_FEW_HASHTAGS", `Quantidade de hashtags abaixo do mínimo recomendado de ${hashtagRange.min} para o formato ${rules.label}.`, "medium"));
  }
  if (copy.hashtags.length > maxHashtags) {
    issues.push(issue("TOO_MANY_HASHTAGS", `Quantidade de hashtags acima do recomendado (${maxHashtags}) para o formato ${rules.label}.`, "medium"));
  }
  if (countEmojis(copy.caption) < rules.minEmojis) {
    issues.push(issue("TOO_FEW_EMOJIS", `Legenda quase não usa emojis contextuais; usar pelo menos ${rules.minEmojis} de forma equilibrada.`, "low"));
  }
  if (rules.requireCommentPrompt && !hasCommentPrompt(copy.caption)) {
    issues.push(issue("MISSING_COMMENT_PROMPT", "Legenda não estimula comentários de forma clara.", "medium"));
  }
  if (rules.requireSaveSharePrompt && !hasSaveOrSharePrompt(copy.caption)) {
    issues.push(issue("MISSING_SAVE_SHARE_PROMPT", "Legenda não estimula salvamento ou compartilhamento.", "medium"));
  }
  if (rules.requireHook && !hasHook(copy.caption)) {
    issues.push(issue("MISSING_HOOK", `Legenda não abre com um gancho curto e direto, esperado para o formato ${rules.label}.`, "medium"));
  }
  if (rules.requireCuriosity && !hasCuriosityTrigger(copy.caption)) {
    issues.push(issue("MISSING_CURIOSITY_TRIGGER", `Legenda não gera curiosidade imediata, esperado para o formato ${rules.label}.`, "low"));
  }

  for (const forbiddenTerm of briefing.forbiddenTerms ?? []) {
    if (containsComparable(copy.caption, forbiddenTerm) || containsComparable(copy.title, forbiddenTerm)) {
      issues.push(issue("FORBIDDEN_TERM", `Termo proibido encontrado: ${forbiddenTerm}.`, "high"));
    }
  }

  for (const mandatoryWord of briefing.mandatoryWords ?? []) {
    if (!containsComparable(copy.caption, mandatoryWord) && !containsComparable(copy.title, mandatoryWord)) {
      issues.push(issue("MISSING_MANDATORY_WORD", `Palavra obrigatória da marca ausente: ${mandatoryWord}.`, "high"));
    }
  }

  if (hasBasicGrammarRisk(copy.caption)) {
    issues.push(issue("SPELLING_GRAMMAR_RISK", "A copy apresenta possível risco básico de ortografia, gramática ou pontuação.", "medium"));
  }

  const genericPhrases = [...detectGenericPhrases(copy.title), ...detectGenericPhrases(copy.caption)];
  if (genericPhrases.length > 0) {
    issues.push(issue("GENERIC_CLICHE_PHRASE_DETECTED", `Frase genérica/clichê detectada, sem justificativa no briefing: "${genericPhrases[0]}".`, "medium"));
  }

  if (copy.imageHeadline?.trim() && isSameMessage(copy.imageHeadline, copy.title)) {
    issues.push(issue("IMAGE_HEADLINE_DUPLICATES_TITLE", "imageHeadline repete o título literalmente — texto da imagem e título precisam cumprir funções diferentes.", "medium"));
  }

  const score = Math.max(0, 100 - issues.reduce((total, current) => {
    if (current.severity === "high") return total + 18;
    if (current.severity === "medium") return total + 10;
    return total + 5;
  }, 0));

  return {
    passed: score >= minimumQualityScore && issues.filter((current) => current.severity === "high").length === 0,
    score,
    attempt,
    issues,
    profile,
  };
}

type MariaQualityProfileRules = {
  label: string;
  /** `undefined` = sem verificação de mínimo (perfis curtos como Story não penalizam texto curto). */
  minCaptionLength?: number;
  /** `undefined` = usa o limite por canal já existente (`defaultMaxCaptionLength`), preservando o comportamento do perfil "feed". */
  maxCaptionLength?: number;
  hashtagMin: number;
  /** `undefined` = usa o limite por canal já existente (`defaultMaxHashtags`), preservando o comportamento do perfil "feed". */
  hashtagMax?: number;
  minEmojis: number;
  requireCommentPrompt: boolean;
  requireSaveSharePrompt: boolean;
  requireCtaInCaption: boolean;
  requireHook: boolean;
  requireCuriosity: boolean;
  maxCtaLength?: number;
};

/**
 * Um perfil por formato (Feed, Story, Carrossel, Reels, Vídeo curto), cada um com critérios
 * próprios — a mudança central deste refinamento. "feed" e "carrossel" preservam exatamente os
 * limiares universais que já existiam antes desta separação (280 caracteres mínimos, 15-25
 * hashtags, 2 emojis, convite para comentar/salvar obrigatório), garantindo que nenhum briefing
 * existente sem `format` definido (perfil padrão, ver `resolveContentQualityProfile`) mude de
 * comportamento. Story, Reels e Vídeo têm critérios deliberadamente diferentes.
 */
const MARIA_QUALITY_PROFILE_RULES: Record<ContentQualityProfile, MariaQualityProfileRules> = {
  feed: {
    label: "feed",
    minCaptionLength: 280,
    hashtagMin: 15,
    minEmojis: 2,
    requireCommentPrompt: true,
    requireSaveSharePrompt: true,
    requireCtaInCaption: true,
    requireHook: false,
    requireCuriosity: false,
  },
  carrossel: {
    label: "carrossel",
    minCaptionLength: 280,
    hashtagMin: 15,
    minEmojis: 2,
    requireCommentPrompt: true,
    requireSaveSharePrompt: true,
    requireCtaInCaption: true,
    requireHook: false,
    requireCuriosity: false,
  },
  story: {
    label: "story",
    maxCaptionLength: 300,
    hashtagMin: 0,
    hashtagMax: 5,
    minEmojis: 0,
    requireCommentPrompt: false,
    requireSaveSharePrompt: false,
    requireCtaInCaption: false,
    requireHook: false,
    requireCuriosity: true,
    maxCtaLength: 40,
  },
  reels: {
    label: "reels",
    minCaptionLength: 40,
    maxCaptionLength: 900,
    hashtagMin: 5,
    hashtagMax: 15,
    minEmojis: 1,
    requireCommentPrompt: false,
    requireSaveSharePrompt: true,
    requireCtaInCaption: true,
    requireHook: true,
    requireCuriosity: false,
  },
  video: {
    label: "vídeo",
    minCaptionLength: 60,
    maxCaptionLength: 1200,
    hashtagMin: 3,
    hashtagMax: 10,
    minEmojis: 1,
    requireCommentPrompt: false,
    requireSaveSharePrompt: false,
    requireCtaInCaption: true,
    requireHook: true,
    requireCuriosity: false,
  },
};

function validateBriefing(briefing: MariaCopyBriefing): string[] {
  const errors: string[] = [];
  if (!briefing || typeof briefing !== "object") return ["Briefing estruturado obrigatório."];
  if (!briefing.objective?.trim()) errors.push("objective é obrigatório.");
  if (!briefing.channel?.trim()) errors.push("channel é obrigatório.");
  if (!briefing.targetAudience?.trim()) errors.push("targetAudience é obrigatório.");
  if (!briefing.toneOfVoice?.trim()) errors.push("toneOfVoice é obrigatório.");
  if (!briefing.cta?.trim()) errors.push("cta é obrigatório.");
  if (!briefing.keyMessage?.trim()) errors.push("keyMessage é obrigatório.");
  return errors;
}

function parseStructuredCopy(content: string, briefing: MariaCopyBriefing): MariaStructuredCopy {
  const parsed = JSON.parse(extractJson(content, "Maria")) as Partial<MariaStructuredCopy>;
  const caption = String(parsed.caption ?? "");
  const cta = String(parsed.cta ?? briefing.cta);
  const hashtags = normalizeHashtags(parsed.hashtags);
  return {
    title: String(parsed.title ?? ""),
    imageHeadline: typeof parsed.imageHeadline === "string" && parsed.imageHeadline.trim() ? parsed.imageHeadline.trim() : undefined,
    caption,
    cta,
    hashtags,
    publication: buildFullPublication({ caption, cta, hashtags }),
    keywords: normalizeStringArray(parsed.keywords?.length ? parsed.keywords : briefing.keywords),
    summary: String(parsed.summary ?? ""),
    objective: String(parsed.objective ?? briefing.objective),
    toneUsed: String(parsed.toneUsed ?? briefing.toneOfVoice),
    identifiedAudience: String(parsed.identifiedAudience ?? briefing.targetAudience),
    futureSuggestions: normalizeStringArray(parsed.futureSuggestions),
    observations: normalizeStringArray(parsed.observations),
  };
}

function chooseBestAttempt(current: MariaAttemptReport | undefined, candidate: MariaAttemptReport): MariaAttemptReport {
  if (!current) return candidate;
  return candidate.quality.score > current.quality.score ? candidate : current;
}

function platformGuidanceFor(briefing: MariaCopyBriefing): string[] {
  const base = [`Respeitar canal ${briefing.channel}.`];
  if (briefing.channel === "instagram") return [...base, "Usar legenda escaneável, CTA claro e hashtags relevantes sem excesso."];
  if (briefing.channel === "linkedin") return [...base, "Valorizar clareza profissional, autoridade e aprendizado."];
  if (briefing.channel === "facebook") return [...base, "Usar linguagem direta, contexto suficiente e convite para interação."];
  if (briefing.channel === "tiktok") return [...base, "Priorizar gancho rápido e linguagem dinâmica."];
  return [...base, "Adequar tamanho, CTA e tom à plataforma."];
}

function inferHookAngle(briefing: MariaCopyBriefing): string {
  const objective = normalize(briefing.objective);
  if (objective.includes("vender") || objective.includes("conversao")) return "Ângulo de conversão com benefício direto e CTA forte.";
  if (objective.includes("educar") || objective.includes("explicar")) return "Ângulo educativo com clareza e exemplo prático.";
  if (objective.includes("engajar")) return "Ângulo de identificação e interação com o público.";
  return "Ângulo de valor percebido, clareza e convite para ação.";
}

function defaultMaxCaptionLength(channel: string): number {
  if (channel === "instagram") return 2200;
  if (channel === "facebook") return 3000;
  if (channel === "linkedin") return 3000;
  if (channel === "threads") return 500;
  if (channel === "tiktok") return 2200;
  return 2200;
}

function defaultMaxHashtags(channel: string): number {
  if (channel === "linkedin") return 20;
  return 25;
}

function hashtagRangeFor(briefing: MariaCopyBriefing, rules: MariaQualityProfileRules): { min: number; max: number } {
  const min = rules.hashtagMin;
  const ceiling = rules.hashtagMax ?? 25;
  const configuredMax = briefing.platformLimitations?.maxHashtags;
  const defaultMax = rules.hashtagMax ?? defaultMaxHashtags(briefing.channel);
  const max = typeof configuredMax === "number" && configuredMax >= min
    ? Math.min(configuredMax, ceiling)
    : Math.min(defaultMax, ceiling);
  return { min, max: Math.max(min, max) };
}

function issue(code: MariaQualityIssue["code"], message: string, severity: MariaQualityIssue["severity"]): MariaQualityIssue {
  return { code, message, severity };
}

function normalizeHashtags(value: unknown): string[] {
  const tags = normalizeStringArray(value)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.startsWith("#") ? tag : `#${tag}`)
    .map((tag) => tag.replace(/\s+/g, ""))
    .filter((tag) => /^#[\p{L}\p{N}_]+$/u.test(tag));

  const seen = new Set<string>();
  const uniqueTags: string[] = [];
  for (const tag of tags) {
    const key = normalize(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTags.push(tag);
  }
  return uniqueTags;
}

function buildFullPublication(copy: Pick<MariaStructuredCopy, "caption" | "cta" | "hashtags">): string {
  return [
    copy.caption.trim(),
    copy.cta.trim(),
    copy.hashtags.join(" ").trim(),
  ].filter(Boolean).join("\n\n");
}

function publicationMatches(copy: MariaStructuredCopy): boolean {
  const expected = normalizeLineBreaks(buildFullPublication(copy));
  return normalizeLineBreaks(copy.publication) === expected;
}

function normalizeLineBreaks(value: string): string {
  return value.trim().replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function countEmojis(text: string): number {
  return [...text.matchAll(/\p{Extended_Pictographic}/gu)].length;
}

function hasCommentPrompt(text: string): boolean {
  return /(comenta|conte aqui|me conta|responde|qual seria|qual voc[eê]|voc[eê] prefere|j[aá] passou|j[aá] pensou)/i.test(text);
}

function hasSaveOrSharePrompt(text: string): boolean {
  return /(salva|guarda|compartilha|envia|manda para|marque|marca algu[eé]m|mostra para)/i.test(text);
}

/** Gancho curto e direto: a primeira linha/frase da legenda precisa ir direto ao ponto (Reels/Vídeo). */
function hasHook(caption: string): boolean {
  const trimmed = caption.trim();
  if (!trimmed) return false;
  const breakIndex = trimmed.search(/\n|(?<=[.!?])\s/);
  const opening = (breakIndex === -1 ? trimmed : trimmed.slice(0, breakIndex)).trim();
  return opening.length > 0 && opening.length <= 90;
}

/** Gatilho de curiosidade: pergunta explícita ou palavra que sinaliza curiosidade (Story). */
function hasCuriosityTrigger(caption: string): boolean {
  if (caption.includes("?")) return true;
  const normalized = normalize(caption);
  return /(sabia|sera que|descubra|imagina|adivinha|curioso|curiosidade)/.test(normalized);
}

function hasDuplicatedHashtags(hashtags: string[]): boolean {
  const normalized = hashtags.map((tag) => normalize(tag));
  return new Set(normalized).size !== normalized.length;
}

function hasExcessiveRepetition(text: string): boolean {
  const words = normalize(text).split(" ").filter((word) => word.length > 3);
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return Array.from(counts.values()).some((count) => count >= 6);
}

function hasBasicGrammarRisk(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (!/[.!?]$/.test(trimmed)) return true;
  if (/\s{2,}/.test(trimmed)) return true;
  if (/[,.!?]{2,}/.test(trimmed)) return true;
  return false;
}

/** Considera "mesma mensagem" quando um texto contém o outro por inteiro (após normalização) — a
 * checagem que importa é literal-idêntico ou um-contido-no-outro, não similaridade semântica. */
function isSameMessage(left: string, right: string): boolean {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function containsComparable(text: string, expected: string): boolean {
  return normalize(text).includes(normalize(expected));
}

function containsAnyComparable(text: string, expectedTerms: string[]): boolean {
  const normalized = normalize(text);
  return expectedTerms.map(normalize).filter(Boolean).some((term) => normalized.includes(term));
}

export function createMariaCopywritingSkill(dependencies: Partial<MariaCopywritingSkillDependencies> = {}): MariaCopywritingSkill {
  return new MariaCopywritingSkill({
    icaro: dependencies.icaro ?? new MissingIcaroBrain(),
    logger: dependencies.logger,
    eventRecorder: dependencies.eventRecorder,
    idGenerator: dependencies.idGenerator,
    now: dependencies.now,
    maxAttempts: dependencies.maxAttempts,
    minimumQualityScore: dependencies.minimumQualityScore,
  });
}
