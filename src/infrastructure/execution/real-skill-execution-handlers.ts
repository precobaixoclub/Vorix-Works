import type { ExecutionTaskHandlerPort, ExecutionTaskHandlerRequest, ExecutionTaskHandlerResult, ExecutionTaskInputs } from "../../application/execution/execution-handler.port.js";
import { createDefaultExecutionContractRegistry, type ExecutionContract } from "../../application/execution/execution-contract-registry.js";
import { mapExecutionCapabilityToSkillCapability } from "../../application/execution/capability-mapping.js";
import type { HelenaSkillManagerPort } from "../../application/skills/helena.contract.js";
import type { PreparedCommandRepositoryPort } from "../../application/ports/prepared-command-repository.port.js";
import type { RuntimeRepositoryPort } from "../../application/ports/runtime-repository.port.js";
import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { SkillArtifact, SkillResponse } from "../../domain/skills/skill.contract.js";
import type { ExecutionCapability, TaskType } from "../../domain/planning/planning.model.js";

type SkillCallResult = {
  output: Record<string, unknown>;
  artifacts: Record<string, unknown>[];
  warnings: string[];
  skillId: string;
  taskId: string;
};

const contractRegistry = createDefaultExecutionContractRegistry();

export class SingleSkillExecutionTaskHandler implements ExecutionTaskHandlerPort {
  constructor(
    private readonly deps: {
      helena: HelenaSkillManagerPort;
      capability: ExecutionCapability;
      taskType: TaskType;
      skillCapability: string;
      outputPort: string;
      provider?: string;
    },
  ) {}

  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability === this.deps.capability && taskType === this.deps.taskType;
  }

  async validateAvailability(): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    return validateSkillsAvailable(this.deps.helena, [this.deps.skillCapability]);
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") return failure("REAL_HANDLER_REQUIRES_REAL_MODE", "Handler real só executa em mode real.", "policy_violation");
    const contract = requireContract(request.task.capability, request.task.type);
    try {
      const skillInput = buildSingleSkillInput(request, this.deps.skillCapability);
      const result = await callSkill(this.deps.helena, this.deps.skillCapability, skillInput, request);
      const invalid = validateOutputContract(contract, result.output);
      if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");
      return {
        ok: true,
        value: {
          outputs: [{
            outputPort: this.deps.outputPort,
            payload: buildExecutionPayload(result, request.inputs, this.deps.provider ?? "helena"),
          }],
          warnings: result.warnings,
        },
      };
    } catch (error) {
      return { ok: false, error: classifySkillError(error) };
    }
  }
}

export class VisualPipelineExecutionTaskHandler implements ExecutionTaskHandlerPort {
  constructor(private readonly deps: { helena: HelenaSkillManagerPort; provider?: string }) {}

  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability === "visual_design" && taskType === "visual_generation";
  }

  async validateAvailability(): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    return validateSkillsAvailable(this.deps.helena, ["art_direction", "social_media_design", "image_generation"]);
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") return failure("REAL_HANDLER_REQUIRES_REAL_MODE", "Handler real só executa em mode real.", "policy_violation");
    const contract = requireContract(request.task.capability, request.task.type);
    try {
      const structure = unwrapExecutionPayload(firstPayload(request.inputs, "structure"));
      const sofia = await callSkill(this.deps.helena, "art_direction", buildSofiaInput(request, structure), request);
      const bianca = await callSkill(this.deps.helena, "social_media_design", buildBiancaInput(request, structure, sofia.output), request);
      const pedro = await callSkill(this.deps.helena, "image_generation", buildPedroInput(request, structure, suppressUnauthorizedCta(bianca.output)), request);
      const invalid = validateOutputContract(contract, pedro.output);
      if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");
      const warnings = [...sofia.warnings, ...bianca.warnings, ...pedro.warnings];
      return {
        ok: true,
        value: {
          outputs: [{
            outputPort: contract.outputPort,
            payload: {
              ...buildExecutionPayload(pedro, request.inputs, this.deps.provider ?? "helena"),
              visualPipeline: {
                artDirection: sofia.output,
                designSpec: bianca.output,
                imageGeneration: pedro.output,
                skillIds: [sofia.skillId, bianca.skillId, pedro.skillId],
              },
            },
          }],
          warnings,
        },
      };
    } catch (error) {
      return { ok: false, error: classifySkillError(error) };
    }
  }
}

const NO_CTA_INSTRUCTION = "Nenhum — não incluir nenhum botão, texto ou elemento de CTA nesta peça. Comunicar apenas por composição visual, sem nenhum texto legível.";

/**
 * Bianca sempre projeta um CTA visível (`ctaPlacement`, `typographyScale.cta` — campos
 * obrigatórios em `evaluateProductionReadiness`, Pedro nunca aceita omiti-los) porque seu design
 * pressupõe que sempre existe uma copy real definindo o texto do botão. Hoje NENHUM pipeline real
 * (nem o reduzido `content_request`, nem `campaign_creation`) alimenta `workflowContext.mariaCopy`
 * de verdade — não existe copy autorizada em lugar nenhum ainda — então um CTA sempre acaba sendo
 * texto inventado renderizado na imagem (achado ao vivo: gerou um botão "Saiba mais" sem que
 * ninguém tivesse pedido isso). Sobrescreve só os campos de CTA com uma instrução explícita de "não
 * incluir", preservando o resto do design de Bianca (grid, cor, logo, tipografia) intacto. Reavaliar
 * quando um pipeline real de copy existir — aí o CTA autorizado deveria fluir por aqui de verdade,
 * não ser suprimido.
 */
function suppressUnauthorizedCta(design: Record<string, unknown>): Record<string, unknown> {
  const typographyScale = normalizeObject(design.typographyScale);
  return {
    ...design,
    ctaPlacement: NO_CTA_INSTRUCTION,
    ...(Object.keys(typographyScale).length > 0 ? { typographyScale: { ...typographyScale, cta: "Sem CTA nesta peça" } } : {}),
  };
}

/**
 * Empacota `PreparedCommand.validatedInputs` (o que o usuário realmente digitou — objective,
 * offerOrSubject, targetAudience, channel, contentFormat) num "structure" no mesmo formato que
 * `campaign_structure` produz, sem chamar nenhuma Skill nem IA. Existe só para o pipeline reduzido
 * `content_request-visual-only-v1` (ver `arthur-planner.ts`) — permite `VisualPipelineExecutionTaskHandler`
 * funcionar sem depender de `campaign_structure`/`REAL_PLANNING_ENABLED`, e é também a correção do
 * problema mais profundo descoberto nesta sprint: os outros handlers "reais" deste arquivo nunca
 * liam o conteúdo de verdade do usuário (`buildResearchInput`/`buildStrategyInput` usam texto fixo)
 * — este handler lê `PreparedCommand.validatedInputs` de verdade via `runtimeRepository`/
 * `preparedCommandRepository` (a cadeia `RuntimeTask.runtimePlanId` → `RuntimePlan.sourceContext.
 * preparedCommandId` → `PreparedCommand.validatedInputs`, já modelada desde a Sprint 10).
 */
export class ContentBriefExecutionTaskHandler implements ExecutionTaskHandlerPort {
  constructor(private readonly deps: { runtimeRepository: RuntimeRepositoryPort; preparedCommandRepository: PreparedCommandRepositoryPort }) {}

  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability === "content_brief" && taskType === "content_brief";
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    if (request.context.mode !== "real") return failure("REAL_HANDLER_REQUIRES_REAL_MODE", "Handler real só executa em mode real.", "policy_violation");
    const contract = requireContract(request.task.capability, request.task.type);
    const runtimePlan = await this.deps.runtimeRepository.getById(request.task.runtimePlanId);
    if (!runtimePlan) {
      return { ok: false, error: { code: "CONTENT_BRIEF_RUNTIME_PLAN_NOT_FOUND", message: `RuntimePlan "${request.task.runtimePlanId}" não encontrado.`, category: "internal", retryable: false } };
    }
    const preparedCommand = await this.deps.preparedCommandRepository.getById(runtimePlan.sourceContext.preparedCommandId);
    if (!preparedCommand) {
      return { ok: false, error: { code: "CONTENT_BRIEF_PREPARED_COMMAND_NOT_FOUND", message: `PreparedCommand "${runtimePlan.sourceContext.preparedCommandId}" não encontrado.`, category: "internal", retryable: false } };
    }

    const structure = buildContentBriefStructure(preparedCommand.validatedInputs);
    const invalid = validateOutputContract(contract, structure);
    if (invalid) return failure("SKILL_OUTPUT_SCHEMA_INVALID", invalid, "invalid_output");

    return {
      ok: true,
      value: {
        outputs: [{
          outputPort: contract.outputPort,
          payload: {
            skillId: "content-brief-deterministic",
            taskId: request.task.id,
            output: structure,
            artifacts: [],
            warnings: [],
            upstreamInputs: request.inputs,
            provider: "helena",
            real: true,
          },
        }],
      },
    };
  }
}

function buildContentBriefStructure(validatedInputs: Record<string, string>): Record<string, unknown> {
  const objective = stringValue(validatedInputs.objective, "Criar peça visual atrativa.");
  const offerOrSubject = stringValue(validatedInputs.offerOrSubject, objective);
  // Descrição derivada por visão computacional das imagens de referência anexadas na ideia (ver
  // `generate-visual-from-idea.ts`, `describeReferenceImages`) — sem isto, a IA nunca sabia o que
  // as imagens de referência mostravam (ex.: "tênis unissex"), só o texto da ideia. Dobrado em
  // `offerOrSubject`/`objective` porque são exatamente os campos que `buildSofiaInput`
  // (`real-skill-execution-handlers.ts`) usa como `visualObjective`/`angle` — a base real da cena
  // que Sofia descreve para Pedro.
  const referenceContext = validatedInputs.referenceContext?.trim();
  const subject = referenceContext ? `${offerOrSubject} (referência visual: ${referenceContext})` : offerOrSubject;
  const targetAudience = stringValue(validatedInputs.targetAudience, "público principal do workspace");
  const channel = stringValue(validatedInputs.channel, "instagram");
  const format = stringValue(validatedInputs.contentFormat, "image");
  const centralPromise = `${subject} — ${objective}`;
  // Escrito por IA (`OpenAiCopywriter`, ver `generate-visual-from-idea.ts`) — nunca o texto bruto
  // que o usuário digitou como ideia/sugestão (achado ao vivo: "não era pra ser aplicado
  // exatamente o que escrevi"). `adTitle` vira o único texto autorizado na própria imagem
  // (`displayTitle`/`buildPedroInput`); `adDescription` é a legenda pronta pra postar, exposta só
  // no artefato para a tela de Revisão mostrar — nunca chega no prompt de imagem. Cai para
  // `offerOrSubject` bruto só se a chamada de copy falhar (best-effort, nunca trava a geração).
  const adTitle = validatedInputs.adTitle?.trim() || offerOrSubject.slice(0, 50);
  const adDescription = validatedInputs.adDescription?.trim() || objective;
  return {
    overallStrategy: `Gerar peça visual para "${subject}" com foco em: ${objective}.`,
    objective,
    targetAudience,
    channel,
    format,
    // Vira o único texto autorizado que Pedro pode escrever na peça (ver
    // `buildPedroInput`/`extractVisibleTextContext`). Sem isto, ou é texto nenhum, ou o modelo
    // inventa CTA/headline por conta própria — as duas coisas já dando problema ao vivo.
    displayTitle: adTitle,
    adDescription,
    toneOfVoice: "claro e persuasivo",
    angle: subject,
    centralPromise,
    valueProposition: subject,
    keyMessages: [objective, subject].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index),
    // Nunca "Saiba mais" (ou qualquer CTA de verdade) aqui — este valor propaga verbatim para
    // Sofia E Bianca (as duas recebem `joaoStrategy` inteiro), e sem uma etapa de copy real
    // autorizando um CTA de verdade, qualquer texto aqui vira botão/texto renderizado na imagem
    // (achado ao vivo: "Saiba mais" apareceu na peça sem que ninguém tivesse pedido). Ver também
    // `suppressUnauthorizedCta` (rede de segurança adicional no output final de Bianca).
    recommendedCta: NO_CTA_INSTRUCTION,
    recommendedSlideCount: format === "carousel" ? 4 : undefined,
    sofiaBriefing: {
      status: "ready",
      channel,
      format,
      angle: subject,
      centralPromise,
      keyMessages: [objective],
      visualDirectionNotes: [] as string[],
      brandIdentityNotes: [] as string[],
      notes: ["Peça gerada a partir de uma ideia real informada pelo usuário — sem etapa de pesquisa/estratégia."],
    },
  };
}

async function validateSkillsAvailable(helena: HelenaSkillManagerPort, capabilities: readonly string[]): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  for (const capability of capabilities) {
    const record = await helena.findSkillByCapability(capability as SkillCapability);
    if (!record?.manifest || !record.skill) {
      return { ok: false, code: "SKILL_NOT_FOUND", message: `Nenhuma Skill pronta para capability "${capability}".` };
    }
  }
  return { ok: true };
}

async function callSkill(helena: HelenaSkillManagerPort, skillCapability: string, input: Record<string, unknown>, request: ExecutionTaskHandlerRequest): Promise<SkillCallResult> {
  const response = await helena.executeSkill<Record<string, unknown>, Record<string, unknown>>({
    requestedBy: "execution",
    capability: skillCapability as SkillCapability,
    input,
    context: {
      executionId: request.context.executionRunId,
      taskId: request.task.id,
      correlationId: request.context.executionRunId,
      locale: "pt-BR",
      tenantId: request.context.tenantId,
      dryRun: false,
      metadata: {
        runtimePlanId: request.task.runtimePlanId,
        runtimeTaskId: request.task.id,
        executionCapability: request.task.capability,
        skillCapability,
      },
    },
  });
  return convertSkillResponse(response.response as SkillResponse);
}

function convertSkillResponse(response: SkillResponse): SkillCallResult {
  if (response.status !== "completed") {
    const error = new Error(response.error?.message ?? `Skill retornou status "${response.status}".`);
    error.name = response.error?.code ?? response.status;
    throw error;
  }
  return {
    output: normalizeObject(response.output),
    artifacts: response.artifacts.map(convertSkillArtifact),
    warnings: response.warnings,
    skillId: response.skillId,
    taskId: response.taskId,
  };
}

function buildSingleSkillInput(request: ExecutionTaskHandlerRequest, skillCapability: string): Record<string, unknown> {
  if (request.task.capability === "editorial_research") return buildResearchInput(request);
  if (request.task.capability === "strategic_planning") return buildStrategyInput(request);
  if (request.task.capability === "copywriting") return buildCopyInput(request);
  if (request.task.capability === "distribution") return buildDistributionInput(request);
  return { ...baseInput(request), skillCapability, inputs: request.inputs };
}

function buildResearchInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    desiredChannel: "instagram",
    desiredObjective: "Criar campanha de marketing.",
  };
}

function buildStrategyInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  const editorialBrief = unwrapExecutionPayload(firstPayload(request.inputs, "context"));
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    desiredChannel: stringValue(editorialBrief.recommendedChannel, "instagram"),
    desiredFormat: stringValue(editorialBrief.recommendedFormatLabel, "carrossel"),
    desiredObjective: stringValue(editorialBrief.campaignObjective, "Criar campanha de marketing."),
    editorialBrief,
  };
}

function buildCopyInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  const strategy = unwrapExecutionPayload(firstPayload(request.inputs, "structure"));
  const briefing = normalizeObject(strategy.mariaBriefing);
  return {
    objective: stringValue(briefing.objective ?? strategy.objective, "Criar campanha de marketing."),
    channel: stringValue(briefing.channel ?? strategy.channel, "instagram"),
    format: stringValue(briefing.format ?? strategy.format, "carrossel"),
    targetAudience: stringValue(briefing.targetAudience ?? strategy.targetAudience, "público principal"),
    toneOfVoice: stringValue(briefing.toneOfVoice ?? strategy.toneOfVoice, "claro e persuasivo"),
    cta: stringValue(briefing.cta ?? strategy.recommendedCta, "Saiba mais"),
    keyMessage: stringValue(briefing.keyMessage ?? strategy.centralPromise, "Mensagem principal da campanha"),
    keywords: stringArray(briefing.keywords),
    forbiddenTerms: stringArray(briefing.forbiddenTerms),
    mandatoryWords: stringArray(briefing.mandatoryWords),
    preferredHashtags: stringArray(briefing.preferredHashtags),
    language: "pt-BR",
    additionalContext: JSON.stringify({ executionRunId: request.context.executionRunId }),
  };
}

function buildSofiaInput(request: ExecutionTaskHandlerRequest, strategy: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    joaoStrategy: strategy,
    joaoSofiaBriefing: normalizeObject(strategy.sofiaBriefing),
    channel: stringValue(strategy.channel, "instagram"),
    format: stringValue(strategy.format, "carrossel"),
    visualObjective: stringValue(strategy.objective, "Criar peça visual da campanha."),
  };
}

function buildBiancaInput(request: ExecutionTaskHandlerRequest, strategy: Record<string, unknown>, sofia: Record<string, unknown>): Record<string, unknown> {
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    joaoStrategy: strategy,
    sofiaDirection: sofia,
    sofiaBriefing: normalizeObject(sofia.biancaBriefing),
    channel: stringValue(strategy.channel, "instagram"),
    format: stringValue(strategy.format, "carrossel"),
    recommendedSlideCount: numberValue(strategy.recommendedSlideCount, undefined),
  };
}

function buildPedroInput(request: ExecutionTaskHandlerRequest, strategy: Record<string, unknown>, bianca: Record<string, unknown>): Record<string, unknown> {
  const imageCount = numberValue(strategy.recommendedSlideCount, 1) ?? 1;
  const displayTitle = stringValue(strategy.displayTitle, "");
  const base = baseInput(request);
  return {
    ...base,
    // `extractVisibleTextContext` (pedro-image-generation.skill.ts) só trata um texto como
    // "autorizado" se estiver aqui — sem isto, `hasAuthorizedVisibleText` fica falso e a peça sai
    // sem nenhum texto (ou, pior, o modelo inventa um CTA sozinho). Só `title`, de propósito — sem
    // `cta`, pra não reabrir o problema do botão inventado ("Saiba mais").
    workflowContext: { ...normalizeObject(base.workflowContext), ...(displayTitle ? { title: displayTitle } : {}) },
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    biancaDesign: bianca,
    biancaPedroBriefing: normalizeObject(bianca.pedroBriefing),
    channel: stringValue(strategy.channel, "instagram"),
    format: stringValue(strategy.format, "carrossel"),
    imageCount,
    desiredAspectRatio: stringValue(bianca.recommendedAspectRatio, "1:1"),
  };
}

function buildDistributionInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  const decision = unwrapExecutionPayload(firstPayload(request.inputs, "decision"));
  const reviewedInputs = normalizeObject(decision.reviewedInputs);
  const copyPayload = unwrapExecutionPayload(firstPayloadFromReviewed(reviewedInputs, "copy"));
  const visualPayload = unwrapExecutionPayload(firstPayloadFromReviewed(reviewedInputs, "visual"));
  const strategy = unwrapExecutionPayload(firstPayload(normalizeObject(copyPayload.upstreamInputs) as ExecutionTaskInputs, "structure"));
  return {
    ...baseInput(request),
    originalRequest: "Execution real controlada a partir de RuntimePlan validado.",
    joaoStrategy: strategy,
    mariaCopy: copyPayload.output ?? copyPayload,
    pedroImages: visualPayload.output ?? visualPayload,
    lucasReview: { reviewStatus: "approved", approvalRecommended: true, overallScore: 100 },
    humanApproval: { decision: decision.decision ?? "approved", approved: true },
    channels: ["instagram"],
    publishMode: "dry_run",
  };
}

function baseInput(request: ExecutionTaskHandlerRequest): Record<string, unknown> {
  return {
    tenantId: request.context.tenantId,
    workflowContext: {
      executionRunId: request.context.executionRunId,
      runtimePlanId: request.task.runtimePlanId,
      runtimeTaskId: request.task.id,
      executionCapability: request.task.capability,
    },
  };
}

function buildExecutionPayload(result: SkillCallResult, inputs: ExecutionTaskInputs, provider: string): Record<string, unknown> {
  return {
    skillId: result.skillId,
    taskId: result.taskId,
    output: result.output,
    artifacts: result.artifacts,
    warnings: result.warnings,
    upstreamInputs: inputs,
    provider,
    real: true,
  };
}

function requireContract(capability: ExecutionCapability, taskType: TaskType): ExecutionContract {
  const contract = contractRegistry.get({ capability, taskType });
  if (!contract) throw new Error(`EXECUTION_SKILL_CONTRACT_MISSING: ${capability}/${taskType}`);
  return contract;
}

function validateOutputContract(contract: ExecutionContract, output: Record<string, unknown>): string | undefined {
  const result = contractRegistry.validateSkillOutput(contract, output);
  return result.ok ? undefined : result.message;
}

function firstPayload(inputs: ExecutionTaskInputs, port: string): Record<string, unknown> {
  const payload = inputs[port]?.[0]?.payload;
  return normalizeObject(payload);
}

function firstPayloadFromReviewed(reviewedInputs: Record<string, unknown>, port: string): Record<string, unknown> {
  const entries = reviewedInputs[port];
  if (Array.isArray(entries) && entries[0] && typeof entries[0] === "object") return normalizeObject((entries[0] as { payload?: unknown }).payload);
  return {};
}

function unwrapExecutionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return normalizeObject(payload.output ?? payload);
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function convertSkillArtifact(artifact: SkillArtifact): Record<string, unknown> {
  return {
    id: artifact.id,
    type: artifact.type,
    name: artifact.name,
    status: artifact.status,
    uri: artifact.uri,
    file: artifact.file,
    dimensions: artifact.dimensions,
    metadata: artifact.metadata,
    items: artifact.items?.map(convertSkillArtifact),
  };
}

function classifySkillError(error: unknown) {
  const message = error instanceof Error ? error.message : "Erro desconhecido ao executar Skill.";
  const lower = message.toLowerCase();
  if (lower.includes("timeout")) return { code: "SKILL_TIMEOUT", message, category: "timeout" as const, retryable: true };
  if (lower.includes("rate")) return { code: "SKILL_RATE_LIMITED", message, category: "rate_limited" as const, retryable: true };
  if (lower.includes("auth") || lower.includes("unauthorized")) return { code: "SKILL_AUTHENTICATION_FAILED", message, category: "authentication" as const, retryable: false };
  if (lower.includes("schema") || lower.includes("output")) return { code: "SKILL_INVALID_OUTPUT", message, category: "invalid_output" as const, retryable: false };
  return { code: error instanceof Error && error.name !== "Error" ? error.name : "SKILL_INTERNAL_ERROR", message, category: "internal" as const, retryable: false };
}

function failure(code: string, message: string, category: "policy_violation" | "invalid_output"): ExecutionTaskHandlerResult {
  return { ok: false, error: { code, message, category, retryable: false } };
}

export function skillCapabilitiesForExecutionCapability(capability: ExecutionCapability): readonly string[] {
  if (capability === "visual_design") return ["art_direction", "social_media_design", "image_generation"];
  return [mapExecutionCapabilityToSkillCapability(capability).skillCapability];
}
