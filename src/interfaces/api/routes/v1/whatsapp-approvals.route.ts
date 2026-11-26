import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WhatsappApprovalService } from "../../../../application/approvals/whatsapp-approval-service.js";
import { ForbiddenError, NotImplementedError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Aprovação de publicações pelo WhatsApp — configuração da CONTA (número que envia os pedidos) e de cada
 * MARCA (exige aprovação, quem aprova, o que fazer sem resposta). Leitura para quem aprova publicações;
 * alteração só para dono/administrador da conta.
 */
export type WhatsappApprovalsRoutesDeps = { service?: WhatsappApprovalService };

const SETTINGS_BODY = {
  type: "object", additionalProperties: false, required: ["enabled"],
  properties: { enabled: { type: "boolean" }, connectionId: { anyOf: [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }] } },
} as const;
const RULE_BODY = {
  type: "object", additionalProperties: false, required: ["enabled", "onTimeout"],
  properties: {
    enabled: { type: "boolean" },
    approverUserId: { anyOf: [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }] },
    approverPhone: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
    onTimeout: { type: "string", enum: ["skip", "publish"] },
    onReject: { type: "string", enum: ["redo", "return"] },
  },
} as const;
const WORKSPACE_PARAMS = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1, maxLength: 120 } } } as const;
const TEST_BODY = { type: "object", additionalProperties: false, required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1, maxLength: 120 } } } as const;

function requireManager(request: FastifyRequest) {
  const principal = requirePermission(request, "publication:approve");
  if (principal.role !== "owner" && principal.role !== "admin") throw new ForbiddenError("Só o dono ou um administrador da conta altera as aprovações por WhatsApp.");
  return principal;
}

async function translate<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /^(WHATSAPP_APPROVAL_[A-Z_]+):\s*(.*)$/.exec(message);
    if (match) throw new ValidationError(match[2], { code: match[1] });
    if (/conexão do WhatsApp indisponível|envio de WhatsApp indisponível/.test(message)) throw new ValidationError(`Não foi possível enviar pelo WhatsApp: ${message}.`);
    throw error;
  }
}

export async function registerWhatsappApprovalsRoutes(app: FastifyInstance, deps: WhatsappApprovalsRoutesDeps): Promise<void> {
  const service = () => {
    if (!deps.service) throw new NotImplementedError("Aprovação por WhatsApp indisponível neste servidor.");
    return deps.service;
  };

  app.get("/whatsapp-approvals", async (request) => {
    const principal = requirePermission(request, "publication:approve");
    return successEnvelope({ ...(await service().overview(principal.tenantId)), canManage: principal.role === "owner" || principal.role === "admin" }, request.id);
  });

  app.put("/whatsapp-approvals/settings", { schema: { body: SETTINGS_BODY } }, async (request) => {
    const principal = requireManager(request);
    const body = request.body as { enabled: boolean; connectionId?: string | null };
    return successEnvelope(await translate(() => service().saveSettings({ tenantId: principal.tenantId, enabled: body.enabled, connectionId: body.connectionId ?? undefined, actorUserId: principal.userId })), request.id);
  });

  app.put("/whatsapp-approvals/rules/:workspaceId", { schema: { params: WORKSPACE_PARAMS, body: RULE_BODY } }, async (request) => {
    const principal = requireManager(request);
    const { workspaceId } = request.params as { workspaceId: string };
    const body = request.body as { enabled: boolean; approverUserId?: string | null; approverPhone?: string | null; onTimeout: "skip" | "publish"; onReject?: "redo" | "return" };
    return successEnvelope(await translate(() => service().saveRule({
      tenantId: principal.tenantId, workspaceId, enabled: body.enabled, approverUserId: body.approverUserId ?? undefined,
      approverPhone: body.approverPhone ?? undefined, onTimeout: body.onTimeout, ...(body.onReject ? { onReject: body.onReject } : {}), actorUserId: principal.userId,
    })), request.id);
  });

  app.post("/whatsapp-approvals/test", { schema: { body: TEST_BODY } }, async (request) => {
    const principal = requireManager(request);
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await translate(() => service().sendTest({ tenantId: principal.tenantId, workspaceId })), request.id);
  });
}
