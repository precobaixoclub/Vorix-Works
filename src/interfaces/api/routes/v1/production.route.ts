import type { FastifyInstance } from "fastify";
import { createExecution, decideExecutionGateUseCase, startExecution, type ExecutionUseCaseDeps } from "../../../../application/execution/execution-use-cases.js";
import { generateVisualFromIdea, type GenerateVisualFromIdeaDeps } from "../../../../application/production/generate-visual-from-idea.js";
import type { QualityFeedbackCategory, QualityFeedbackPort } from "../../../../application/quality-feedback/index.js";
import { NotImplementedError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { translateExecutionError } from "./execution-error-translator.js";

// Motivos de rejeição estruturada da tela de Revisão (requisito "registrar o motivo sempre que
// disponível, para usar nas próximas gerações") — subconjunto de `QUALITY_FEEDBACK_CATEGORIES`
// (quality-feedback.types.ts) relevante para rejeição de uma peça (as demais categorias servem a
// outros fluxos de avaliação, ex. vídeo/roteiro, fora de escopo aqui).
const REJECTION_REASONS = [
  "imagem_ruim",
  "muito_texto_na_imagem",
  "copy_generica",
  "estilo_visual_nao_gostei",
  "produto_incorreto",
  "informacao_incorreta",
  "conteudo_repetitivo",
  "cta_fraco",
] as const;

const REJECT_PARAMS_SCHEMA = {
  type: "object",
  required: ["runId"],
  properties: { runId: { type: "string", minLength: 1 } },
} as const;

const REJECT_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "gateId", "reasons"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    gateId: { type: "string", minLength: 1 },
    reasons: { type: "array", items: { type: "string", enum: REJECTION_REASONS as unknown as string[] }, minItems: 1, maxItems: REJECTION_REASONS.length },
    comment: { type: "string", maxLength: 500 },
  },
} as const;

// Achado ao vivo (Rodada 2, Fatia 3): uma reprovação por oclusão semântica sobre rosto/olhos que
// o Repair Loop já tentou reposicionar e não resolveu (ver `evaluateSemanticOcclusion`,
// `lucas-quality-review.skill.ts` — mensagem no formato exato abaixo) tem baixa chance de ser
// corrigida só regenerando copy/estratégia do zero: o problema é a COMPOSIÇÃO FOTOGRÁFICA (rosto
// grande/dominante demais para qualquer posição alternativa fixa de texto escapar), não o texto
// em si. Disparar uma 2ª tentativa inteira nesse caso específico só soma outros ~2 minutos numa
// única requisição HTTP síncrona sem ganho real — foi isso que causou "erro de conexão" percebido
// pelo usuário (a requisição combinada passou de 4 minutos). Nas OUTRAS causas de reprovação
// (alucinação comercial, tipografia, etc.) a 2ª tentativa continua rodando normalmente, porque
// regenerar copy/imagem ali pode genuinamente resolver.
const SEMANTIC_OCCLUSION_FACE_FAILURE_PATTERN = /Elemento "[^"]+" sobre "(face|eyes)"/;

export function isUnrecoverableSemanticOcclusionFailure(failureMessage: string | undefined): boolean {
  return typeof failureMessage === "string" && SEMANTIC_OCCLUSION_FACE_FAILURE_PATTERN.test(failureMessage);
}

const GENERATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "name", "objective", "ideaText", "format", "channel"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    objective: { type: "string", minLength: 3, maxLength: 300 },
    ideaText: { type: "string", minLength: 2, maxLength: 2000 },
    format: { type: "string", enum: ["single_image", "carousel"] },
    channel: { type: "string", minLength: 1 },
    targetAudience: { type: "string", maxLength: 300 },
    referenceImages: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
} as const;

export type ProductionRoutesDeps = GenerateVisualFromIdeaDeps &
  ExecutionUseCaseDeps & {
    ensureHouseTenantProfile(tenantId: string, workspaceId: string): Promise<void>;
    qualityFeedback: QualityFeedbackPort;
  };

/**
 * Ponte HTTP entre uma ideia do tanque de Produção e o pipeline de execução real — a única forma
 * de gerar uma peça visual de verdade hoje é via `runtimePlanId`, que só nasce de um briefing
 * conversacional completo (ver `generate-visual-from-idea.ts`). Esta rota faz o caminho inteiro
 * numa chamada só: ideia → briefing sintético → planning/runtime (automáticos) → execução real
 * criada, iniciada e rodada até o fim (aprovação ou falha) — nada continua em background depois
 * que a resposta HTTP volta. Devolve `state` já resolvido para o cliente decidir na hora (sem
 * poll) se marca a ideia como usada e navega para Revisão, ou mostra erro e mantém o usuário em
 * Produção.
 */
export async function registerProductionRoutes(app: FastifyInstance, deps: ProductionRoutesDeps): Promise<void> {
  app.post("/production/ideas/generate", { schema: { body: GENERATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:create");
    // Sem isso, `createExecution` aceitaria a requisição e silenciosamente rebaixaria
    // `executionMode: "real"` para `dry_run` (ver `execution-engine.ts`) — o cliente pensaria que
    // pediu uma geração de verdade e receberia um resultado determinístico/vazio sem nenhum aviso.
    // Falhar aqui, cedo e com mensagem clara, é melhor que fingir sucesso.
    if (!deps.featureFlags?.realExecutionEnabled || !deps.featureFlags.realVisualEnabled) {
      throw new NotImplementedError("Geração real de imagem ainda não está ligada neste servidor (REAL_EXECUTION_ENABLED/REAL_VISUAL_ENABLED).");
    }
    const body = request.body as GenerateBody;

    await deps.ensureHouseTenantProfile(principal.tenantId, body.workspaceId);

    const attempt1 = await runOneGenerationAttempt(deps, principal.tenantId, body);
    // Regeneração automática (requisito "se não atingir o padrão mínimo, gerar novamente"): o
    // quality gate (Lucas) roda DEPOIS de `visual_generation` já ter produzido seu único artefato
    // por task — não há como "consertar e reemitir" a peça de dentro da própria task de revisão
    // (ver comentário em `QualityGateExecutionTaskHandler`), então a regeneração de verdade é uma
    // execução NOVA e inteira, do zero, no máximo 1 vez, só quando a causa da falha foi
    // especificamente reprovação de qualidade (nunca para erro de configuração/provider/timeout,
    // onde tentar de novo com o mesmo problema só gastaria uma chamada paga da OpenAI à toa).
    const shouldRetry = attempt1.failureCode === "QUALITY_GATE_NOT_PASSED" && !isUnrecoverableSemanticOcclusionFailure(attempt1.failureMessage);
    const result = shouldRetry ? await runOneGenerationAttempt(deps, principal.tenantId, body) : attempt1;

    return successEnvelope({ executionRunId: result.started.id, state: result.started.state, failureMessage: result.failureMessage }, request.id);
  });

  // Rejeição estruturada (requisito "registrar o motivo sempre que disponível... usar esse
  // feedback nas próximas gerações daquele workspace") — substitui o texto livre por motivos
  // fechados, reaproveitando o gate já existente (`decideExecutionGateUseCase`, mesmo caminho de
  // `POST /execution-runs/:runId/gates/:gateId/decision`) e o módulo Quality Feedback já existente
  // (`QualityFeedbackPort`, antes nunca ligado à API/produção). O registro de feedback é
  // best-effort: uma falha aqui nunca deveria impedir a rejeição do gate de valer.
  app.post("/production/executions/:runId/reject", { schema: { params: REJECT_PARAMS_SCHEMA, body: REJECT_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:approve");
    const { runId } = request.params as { runId: string };
    const body = request.body as { workspaceId: string; gateId: string; reasons: (typeof REJECTION_REASONS)[number][]; comment?: string };

    const run = await decideExecutionGateUseCase(deps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      runId,
      gateId: body.gateId,
      decision: "rejected",
      decidedByUserId: principal.userId,
    }).catch(translateExecutionError);

    await deps.qualityFeedback
      .record({
        executionId: runId,
        clientId: body.workspaceId,
        contentType: "visual_generation",
        format: "content_request",
        skillsUsed: ["lucas-quality-review"],
        rating: { kind: "score", value: 1 },
        categoriesNeedingImprovement: body.reasons as unknown as QualityFeedbackCategory[],
        comment: body.comment,
      })
      .catch(() => undefined);

    return successEnvelope(run, request.id);
  });
}

type GenerateBody = {
  workspaceId: string;
  name: string;
  objective: string;
  ideaText: string;
  format: "single_image" | "carousel";
  channel: string;
  targetAudience?: string;
  referenceImages?: string[];
};

async function runOneGenerationAttempt(deps: ProductionRoutesDeps, tenantId: string, body: GenerateBody) {
  const { runtimePlanId } = await generateVisualFromIdea(deps, {
    tenantId,
    workspaceId: body.workspaceId,
    name: body.name,
    objective: body.objective,
    ideaText: body.ideaText,
    format: body.format,
    channel: body.channel,
    targetAudience: body.targetAudience,
    referenceImageUrls: body.referenceImages,
  });

  const idempotencyKey = `production-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const run = await createExecution(deps, {
    tenantId,
    workspaceId: body.workspaceId,
    runtimePlanId,
    idempotencyKey,
    executionMode: "real",
  }).catch(translateExecutionError);
  const started = await startExecution(deps, { tenantId, workspaceId: body.workspaceId, id: run.id }).catch(translateExecutionError);

  // A execução real roda de ponta a ponta dentro desta mesma requisição (nada é assíncrono em
  // background) — por isso já sabemos aqui, sem poll nenhum, se terminou em falha. Devolver isso
  // já pronto evita que o cliente precise descobrir sozinho (ou pior, navegar para uma tela de
  // revisão como se tivesse dado certo quando na verdade falhou).
  let failureMessage: string | undefined;
  let failureCode: string | undefined;
  if (started.state === "failed") {
    const detail = await deps.executionRepository.getDetail(started.id);
    const failedAttempt = [...(detail?.attempts ?? [])].reverse().find((candidate) => candidate.failure);
    failureMessage = failedAttempt?.failure?.message;
    failureCode = failedAttempt?.failure?.code;
  }

  return { started, failureMessage, failureCode };
}
