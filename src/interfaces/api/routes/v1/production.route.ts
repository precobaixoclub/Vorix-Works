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

const REFERENCE_ASSET_ROLES = ["product_photo", "screenshot", "logo", "reference_style", "other"] as const;

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
    // Migração "GPT como motor criativo único" (PR 7/9) — os 3 campos abaixo são lidos só pelo
    // motor GPT (ver `content-request.schema.ts`); ausentes/omitidos, o comportamento é idêntico
    // ao de antes deles existirem, inclusive para o motor legado.
    aspectRatio: { type: "string", enum: ["1:1", "4:5", "9:16", "16:9"] },
    referenceAssets: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        required: ["url", "role"],
        additionalProperties: false,
        properties: {
          url: { type: "string", minLength: 1, maxLength: 2000 },
          role: { type: "string", enum: REFERENCE_ASSET_ROLES as unknown as string[] },
          description: { type: "string", maxLength: 300 },
        },
      },
    },
    forbiddenElements: { type: "array", items: { type: "string", minLength: 1, maxLength: 100 }, maxItems: 20 },
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
 * conversacional completo (ver `generate-visual-from-idea.ts`). Esta rota faz o setup rápido
 * (briefing sintético + planning/runtime automáticos + criação da execução) na própria
 * requisição, mas dispara `startExecution` em BACKGROUND — devolve o `executionRunId` na hora,
 * sem esperar o pipeline inteiro terminar.
 *
 * Achado ao vivo (Rodada 2, Fatia 3): a versão anterior desta rota rodava tudo (planning →
 * copy → design → imagem → Repair Loop → Quality Gate, às vezes 2x quando a 1ª tentativa era
 * reprovada) dentro da MESMA requisição HTTP síncrona — minutos com a conexão parada sem nenhum
 * byte de resposta. Isso se mostrou frágil demais contra timeouts de rede fora do nosso controle
 * (o "erro de conexão" reportado em produção — confirmado ao vivo: o backend terminava
 * normalmente minutos depois, mas a conexão do cliente já tinha caído, e a resposta nunca chegava
 * a ser enviada). O cliente agora consulta `GET /execution-runs/:id` (endpoint que já existe)
 * até o estado terminar — inclusive a decisão de regenerar automaticamente uma vez quando a causa
 * foi reprovação de qualidade (antes decidida aqui) migrou pro cliente, que já vê o resultado de
 * cada tentativa via poll.
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

    const { runtimePlanId } = await generateVisualFromIdea(deps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      name: body.name,
      objective: body.objective,
      ideaText: body.ideaText,
      format: body.format,
      channel: body.channel,
      targetAudience: body.targetAudience,
      referenceImageUrls: body.referenceImages,
      aspectRatio: body.aspectRatio,
      referenceAssets: body.referenceAssets,
      forbiddenElements: body.forbiddenElements,
    });

    const idempotencyKey = `production-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const run = await createExecution(deps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      runtimePlanId,
      idempotencyKey,
      executionMode: "real",
    }).catch(translateExecutionError);

    // Fire-and-forget deliberado — o pipeline real (copy/design/imagem/Repair Loop/Quality Gate)
    // roda por conta própria depois que a resposta HTTP já voltou. Erro aqui só pode ser
    // logado, nunca propagado (a resposta já foi decidida) — o estado final sempre fica visível
    // via `GET /execution-runs/:id`, que é a única fonte de verdade que o cliente consulta.
    //
    // Achado ao vivo em produção: um erro NESTE catch (ex.: colisão de id do
    // `PostgresIcaroLogger`, já corrigida na origem, mas qualquer outra falha antes do pipeline
    // ter chance de marcar sua própria tarefa como "failed" tem o mesmo efeito) só era logado —
    // a run ficava travada em "running"/"created" para sempre, sem nenhum jeito de o usuário
    // saber ou tentar de novo. `replaceRunState` aqui é a rede de segurança: sobrescreve
    // incondicionalmente (nunca falha por otimistic-lock, propositalmente — é o último recurso)
    // pra "failed", e é ela mesma best-effort (nunca pode lançar por cima do catch original).
    startExecution(deps, { tenantId: principal.tenantId, workspaceId: body.workspaceId, id: run.id }).catch(async (error) => {
      request.log.error({ err: error instanceof Error ? error.message : String(error), executionRunId: run.id }, "Falha ao iniciar execução de produção em background.");
      try {
        await deps.executionRepository.replaceRunState({ id: run.id, state: "failed", finishedAt: new Date().toISOString() });
      } catch (reapError) {
        request.log.error(
          { err: reapError instanceof Error ? reapError.message : String(reapError), executionRunId: run.id },
          "Não foi possível marcar a execução travada como falha (rede de segurança).",
        );
      }
    });

    return successEnvelope({ executionRunId: run.id, state: "running" as const }, request.id);
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
  aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9";
  referenceAssets?: Array<{ url: string; role: (typeof REFERENCE_ASSET_ROLES)[number]; description?: string }>;
  forbiddenElements?: string[];
};

