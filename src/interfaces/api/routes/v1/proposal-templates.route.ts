import type { FastifyInstance } from "fastify";
import { createProposalTemplate, deleteProposalTemplate, duplicateProposalTemplate, listProposalTemplates, updateProposalTemplate, type ProposalTemplateUseCaseDeps } from "../../../../application/crm/proposal-template-use-cases.js";
import type { ProposalTemplateValues } from "../../../../application/ports/proposal-template-repository.port.js";
import { NotFoundError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const ITEM = { type: "object", required: ["name", "quantity", "unitPriceCents"], additionalProperties: false, properties: { productId: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 200 }, quantity: { type: "integer", minimum: 1 }, unitPriceCents: { type: "integer", minimum: 0 }, subtotalCents: { type: "integer", minimum: 0 } } } as const;
const VALUES = { name: { type: "string", minLength: 1, maxLength: 120 }, defaultTitle: { type: "string", minLength: 1, maxLength: 200 }, defaultItems: { type: "array", items: ITEM, minItems: 1, maxItems: 100 }, defaultConditions: { type: "string", maxLength: 4000 }, defaultValidDays: { type: "integer", minimum: 1, maximum: 3650 }, active: { type: "boolean" } } as const;
const ID = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

function translate(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("PROPOSAL_TEMPLATE_NOT_FOUND")) throw new NotFoundError(error.message);
  throw error;
}

export async function registerProposalTemplatesRoutes(app: FastifyInstance, deps: ProposalTemplateUseCaseDeps): Promise<void> {
  app.get("/proposal-templates", { schema: { querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, activeOnly: { type: "boolean" } } } } }, async (request) => {
    const principal = requirePermission(request, "proposal:read");
    const query = request.query as { workspaceId: string; activeOnly?: boolean };
    return successEnvelope(await listProposalTemplates(deps, { tenantId: principal.tenantId, ...query }), request.id);
  });

  app.post("/proposal-templates", { schema: { body: { type: "object", required: ["workspaceId", "name", "defaultTitle", "defaultItems", "defaultValidDays"], additionalProperties: false, properties: { workspaceId: { type: "string" }, ...VALUES } } } }, async (request, reply) => {
    const principal = requirePermission(request, "proposal:manage");
    const body = request.body as ProposalTemplateValues & { workspaceId: string };
    const created = await createProposalTemplate(deps, { tenantId: principal.tenantId, ...body });
    reply.code(201);
    return successEnvelope(created, request.id);
  });

  app.patch("/proposal-templates/:id", { schema: { params: ID, body: { type: "object", required: ["workspaceId"], additionalProperties: false, properties: { workspaceId: { type: "string" }, ...VALUES } } } }, async (request) => {
    const principal = requirePermission(request, "proposal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try { return successEnvelope(await updateProposalTemplate(deps, { id, tenantId: principal.tenantId, workspaceId, patch: patch as never }), request.id); } catch (error) { translate(error); }
  });

  app.post("/proposal-templates/:id/duplicate", { schema: { params: ID, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request, reply) => {
    const principal = requirePermission(request, "proposal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try { const copy = await duplicateProposalTemplate(deps, { id, tenantId: principal.tenantId, workspaceId }); reply.code(201); return successEnvelope(copy, request.id); } catch (error) { translate(error); }
  });

  app.delete("/proposal-templates/:id", { schema: { params: ID, querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" } } } } }, async (request, reply) => {
    const principal = requirePermission(request, "proposal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try { await deleteProposalTemplate(deps, { id, tenantId: principal.tenantId, workspaceId }); reply.code(204).send(); } catch (error) { translate(error); }
  });
}
