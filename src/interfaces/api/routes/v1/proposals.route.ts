import type { FastifyInstance } from "fastify";
import {
  createProposal,
  getProposal,
  getProposalTimeline,
  listProposals,
  sendProposal,
  updateProposal,
} from "../../../../application/crm/proposal-use-cases.js";
import type { ProposalUseCaseDeps } from "../../../../application/crm/proposal-use-cases.js";
import { PROPOSAL_STATUSES } from "../../../../domain/crm/crm.model.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const ITEM_SCHEMA = {
  type: "object",
  required: ["name", "quantity", "unitPriceCents"],
  additionalProperties: false,
  properties: {
    productId: { type: "string" },
    name: { type: "string", minLength: 1, maxLength: 200 },
    quantity: { type: "integer", minimum: 1 },
    unitPriceCents: { type: "integer", minimum: 0 },
  },
} as const;
const LIST_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, dealId: { type: "string" }, contactId: { type: "string" }, status: { type: "string", enum: [...PROPOSAL_STATUSES] } },
} as const;
const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const CREATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "title", "items"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    dealId: { type: "string" },
    contactId: { type: "string" },
    title: { type: "string", minLength: 1, maxLength: 200 },
    items: { type: "array", items: ITEM_SCHEMA, minItems: 1, maxItems: 100 },
    discountCents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    validUntil: { type: "string", format: "date" },
    conditions: { type: "string", maxLength: 4000 },
  },
} as const;
const UPDATE_BODY_SCHEMA = { ...CREATE_BODY_SCHEMA, required: ["workspaceId"], properties: { ...CREATE_BODY_SCHEMA.properties, items: { type: "array", items: ITEM_SCHEMA, minItems: 1, maxItems: 100 } } } as const;

function translateProposalError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("PROPOSAL_NOT_FOUND")) throw new NotFoundError(error.message);
  if (error instanceof Error && (error.message.startsWith("PROPOSAL_NOT_EDITABLE") || error.message.startsWith("PROPOSAL_ALREADY_SENT"))) {
    throw new ValidationError(error.message);
  }
  throw error;
}

export async function registerProposalsRoutes(app: FastifyInstance, deps: ProposalUseCaseDeps): Promise<void> {
  app.get("/proposals", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:read");
    const { workspaceId, dealId, contactId } = request.query as { workspaceId: string; dealId?: string; contactId?: string };
    const proposals = await listProposals(deps, { tenantId: principal.tenantId, workspaceId, dealId, contactId });
    return successEnvelope(proposals, request.id);
  });

  app.post("/proposals", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "proposal:manage");
    const body = request.body as Record<string, unknown> & { workspaceId: string; title: string; items: unknown[] };
    const { proposal, rawToken } = await createProposal(deps, { tenantId: principal.tenantId, ...body } as never);
    reply.code(201);
    return successEnvelope({ ...proposal, publicToken: rawToken }, request.id);
  });

  app.get("/proposals/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const proposal = await getProposal(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(proposal, request.id);
    } catch (error) {
      translateProposalError(error);
    }
  });

  app.patch("/proposals/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const proposal = await updateProposal(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId, patch: patch as never });
      return successEnvelope(proposal, request.id);
    } catch (error) {
      translateProposalError(error);
    }
  });

  app.post("/proposals/:id/send", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:send");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const proposal = await sendProposal(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(proposal, request.id);
    } catch (error) {
      translateProposalError(error);
    }
  });

  app.get("/proposals/:id/timeline", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const timeline = await getProposalTimeline(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(timeline, request.id);
    } catch (error) {
      translateProposalError(error);
    }
  });
}
