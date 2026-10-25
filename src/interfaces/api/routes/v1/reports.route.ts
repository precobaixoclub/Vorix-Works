import type { FastifyInstance } from "fastify";
import {
  analyzeReportWithAi,
  createReportTemplate,
  deleteReportTemplate,
  draftReportTemplateWithAi,
  listReportTemplates,
  updateReportTemplate,
  type ReportUseCaseDeps,
} from "../../../../application/reports/report-use-cases.js";
import { AppError, ForbiddenError, NotFoundError, PaymentRequiredError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WS = { type: "string", minLength: 1 } as const;
const SECTIONS = { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 60 } } as const;

function translate(error: unknown): never {
  if (!(error instanceof Error)) throw error;
  const message = error.message;
  if (message.startsWith("REPORT_TEMPLATE_NOT_FOUND")) throw new NotFoundError(message);
  if (message.startsWith("REPORT_TEMPLATE_FORBIDDEN")) throw new ForbiddenError(message.replace(/^[A-Z_]+:\s*/, ""));
  if (message.startsWith("REPORT_TEMPLATE_INVALID") || message.startsWith("REPORT_ANALYSIS_EMPTY")) throw new ValidationError(message);
  if (message.startsWith("REPORT_AI_FAILED(quota_exceeded)") || message.startsWith("REPORT_AI_FAILED(account_blocked)")) {
    throw new PaymentRequiredError("Seus créditos de IA acabaram. Compre mais créditos em Plano e cobrança para continuar.", { reason: "ai_credits" });
  }
  if (message.startsWith("REPORT_AI_")) throw new AppError({ code: "REPORT_AI_UNAVAILABLE", message: "Não foi possível gerar com IA agora. Tente novamente em instantes.", statusCode: 503, recoverable: true });
  throw error;
}

/** `/v1/report-templates` e `/v1/reports/ai-analysis` — Relatórios do Conversas (modelos + IA). */
export async function registerReportsRoutes(app: FastifyInstance, deps: ReportUseCaseDeps): Promise<void> {
  const actorOf = (request: Parameters<typeof requirePermission>[0]) => {
    const principal = requirePermission(request, "deal:read");
    return { tenantId: principal.tenantId, userId: principal.userId, role: principal.role, permissions: principal.permissions, permissionRevokes: principal.permissionRevokes };
  };

  app.get("/report-templates", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS } } } }, async (request) => {
    const actor = actorOf(request);
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await listReportTemplates(deps, actor, { workspaceId }), request.id);
  });

  app.post("/report-templates", {
    schema: { body: { type: "object", required: ["workspaceId", "name", "sections"], additionalProperties: false, properties: {
      workspaceId: WS, name: { type: "string", minLength: 1, maxLength: 80 }, description: { type: "string", maxLength: 300 }, sections: SECTIONS,
      source: { type: "string", enum: ["manual", "ai"] }, aiRequest: { type: "string", maxLength: 1000 },
    } } },
  }, async (request, reply) => {
    const actor = actorOf(request);
    const body = request.body as Parameters<typeof createReportTemplate>[2];
    const template = await createReportTemplate(deps, actor, body).catch(translate);
    reply.code(201);
    return successEnvelope(template, request.id);
  });

  app.patch("/report-templates/:id", {
    schema: {
      params: { type: "object", required: ["id"], properties: { id: WS } },
      body: { type: "object", required: ["workspaceId"], additionalProperties: false, properties: { workspaceId: WS, name: { type: "string", minLength: 1, maxLength: 80 }, description: { type: ["string", "null"], maxLength: 300 }, sections: SECTIONS } },
    },
  }, async (request) => {
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; name?: string; description?: string | null; sections?: string[] };
    return successEnvelope(await updateReportTemplate(deps, actor, { ...body, id }).catch(translate), request.id);
  });

  app.delete("/report-templates/:id", { schema: { params: { type: "object", required: ["id"], properties: { id: WS } }, querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS } } } }, async (request, reply) => {
    const actor = actorOf(request);
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    await deleteReportTemplate(deps, actor, { workspaceId, id }).catch(translate);
    reply.code(204);
    return null;
  });

  app.post("/report-templates/ai-draft", {
    schema: { body: { type: "object", required: ["workspaceId", "request"], additionalProperties: false, properties: { workspaceId: WS, request: { type: "string", minLength: 1, maxLength: 1000 } } } },
  }, async (request) => {
    const actor = actorOf(request);
    const body = request.body as { workspaceId: string; request: string };
    return successEnvelope(await draftReportTemplateWithAi(deps, actor, body).catch(translate), request.id);
  });

  app.post("/reports/ai-analysis", {
    schema: { body: { type: "object", required: ["workspaceId", "reportName", "periodLabel", "sections"], additionalProperties: false, properties: {
      workspaceId: WS, reportName: { type: "string", minLength: 1, maxLength: 80 }, periodLabel: { type: "string", minLength: 1, maxLength: 80 }, focus: { type: "string", maxLength: 300 },
      sections: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", required: ["title", "lines"], additionalProperties: false, properties: { title: { type: "string", minLength: 1, maxLength: 80 }, lines: { type: "array", maxItems: 40, items: { type: "string", maxLength: 200 } } } } },
    } } },
  }, async (request) => {
    const actor = actorOf(request);
    const body = request.body as Parameters<typeof analyzeReportWithAi>[2];
    return successEnvelope(await analyzeReportWithAi(deps, actor, body).catch(translate), request.id);
  });
}
