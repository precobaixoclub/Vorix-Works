import type { FastifyInstance } from "fastify";
import { getContactPhones, previewLidCleanup, runLidCleanup, type ContactPhoneDeps } from "../../../../application/crm/contact-phone-use-cases.js";
import { ForbiddenError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WS = { type: "string", minLength: 1 } as const;

/** Celular dos contatos (lista) e limpeza dos contatos só com LID do WhatsApp (prévia + execução). */
export async function registerContactPhonesRoutes(app: FastifyInstance, deps: ContactPhoneDeps): Promise<void> {
  app.get("/contacts/phones", { schema: { querystring: { type: "object", required: ["workspaceId", "ids"], properties: { workspaceId: WS, ids: { type: "string", maxLength: 20_000 } } } } }, async (request) => {
    const principal = requirePermission(request, "contact:read");
    const { workspaceId, ids } = request.query as { workspaceId: string; ids: string };
    const contactIds = ids.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 500);
    return successEnvelope(await getContactPhones(deps, { tenantId: principal.tenantId, workspaceId, contactIds }), request.id);
  });

  app.get("/contacts/lid-cleanup", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: WS } } } }, async (request) => {
    const principal = requirePermission(request, "contact:manage");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await previewLidCleanup(deps, { tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/contacts/lid-cleanup", { schema: { body: { type: "object", required: ["workspaceId", "confirm"], additionalProperties: false, properties: { workspaceId: WS, confirm: { const: true } } } } }, async (request) => {
    const principal = requirePermission(request, "contact:manage");
    const { workspaceId } = request.body as { workspaceId: string };
    const result = await runLidCleanup(deps, { tenantId: principal.tenantId, workspaceId, role: principal.role }).catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith("CONTACT_CLEANUP_FORBIDDEN")) throw new ForbiddenError(error.message.replace(/^[A-Z_]+:\s*/, ""));
      throw error;
    });
    return successEnvelope(result, request.id);
  });
}
