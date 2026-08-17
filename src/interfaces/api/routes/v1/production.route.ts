import type { FastifyInstance } from "fastify";
import { createExecution, startExecution, type ExecutionUseCaseDeps } from "../../../../application/execution/execution-use-cases.js";
import { generateVisualFromIdea, type GenerateVisualFromIdeaDeps } from "../../../../application/production/generate-visual-from-idea.js";
import { NotImplementedError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { translateExecutionError } from "./execution-error-translator.js";

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
  },
} as const;

export type ProductionRoutesDeps = GenerateVisualFromIdeaDeps &
  ExecutionUseCaseDeps & {
    ensureHouseTenantProfile(tenantId: string): Promise<void>;
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
    const body = request.body as {
      workspaceId: string;
      name: string;
      objective: string;
      ideaText: string;
      format: "single_image" | "carousel";
      channel: string;
      targetAudience?: string;
    };

    await deps.ensureHouseTenantProfile(principal.tenantId);

    const { runtimePlanId } = await generateVisualFromIdea(deps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      name: body.name,
      objective: body.objective,
      ideaText: body.ideaText,
      format: body.format,
      channel: body.channel,
      targetAudience: body.targetAudience,
    });

    const idempotencyKey = `production-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const run = await createExecution(deps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      runtimePlanId,
      idempotencyKey,
      executionMode: "real",
    }).catch(translateExecutionError);
    const started = await startExecution(deps, { tenantId: principal.tenantId, workspaceId: body.workspaceId, id: run.id }).catch(translateExecutionError);

    // A execução real roda de ponta a ponta dentro desta mesma requisição (nada é assíncrono em
    // background) — por isso já sabemos aqui, sem poll nenhum, se terminou em falha. Devolver isso
    // já pronto evita que o cliente precise descobrir sozinho (ou pior, navegar para uma tela de
    // revisão como se tivesse dado certo quando na verdade falhou).
    let failureMessage: string | undefined;
    if (started.state === "failed") {
      const detail = await deps.executionRepository.getDetail(started.id);
      const failedAttempt = [...(detail?.attempts ?? [])].reverse().find((attempt) => attempt.failure);
      failureMessage = failedAttempt?.failure?.message;
    }

    return successEnvelope({ executionRunId: started.id, state: started.state, failureMessage }, request.id);
  });
}
