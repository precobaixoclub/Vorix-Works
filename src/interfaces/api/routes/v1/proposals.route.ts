import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  addProposalRecipient,
  cancelProposal,
  createProposal,
  createProposalVersion,
  getProposal,
  getProposalTimeline,
  listProposalEvents,
  listProposals,
  regenerateProposalLink,
  revokeProposalLink,
  sendProposal,
  updateProposal,
} from "../../../../application/crm/proposal-use-cases.js";
import type { ProposalUseCaseDeps } from "../../../../application/crm/proposal-use-cases.js";
import {
  deliverProposalThroughInbox,
  getProposalTracking,
  listConversationProposals,
  sendProposalReminderThroughInbox,
  type ProposalDeliveryDeps,
} from "../../../../application/commercial/proposal-delivery-use-cases.js";
import { createProposalFromDeal, type SalesProposalDeps } from "../../../../application/sales/proposal-sales-use-cases.js";
import { loadCommercialSettings, resolveVisibility } from "../../../../application/sales/sales-context.js";
import { PROPOSAL_STATUSES, type Proposal } from "../../../../domain/crm/crm.model.js";
import { ConflictError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const ITEM_SCHEMA = {
  type: "object",
  required: ["name", "quantity", "unitPriceCents"],
  additionalProperties: false,
  properties: {
    productId: { type: "string" },
    variantId: { type: "string" },
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 2000 },
    quantity: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
    unitPriceCents: { type: "integer", minimum: 0 },
    billingType: { type: "string", enum: ["one_time", "monthly", "quarterly", "annual", "per_unit", "per_hour", "custom"] },
    listPriceCents: { type: "integer", minimum: 0 },
  },
} as const;
const LIST_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, dealId: { type: "string" }, contactId: { type: "string" }, status: { type: "string", enum: [...PROPOSAL_STATUSES] } },
} as const;
const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const CONTENT_PROPERTIES = {
  title: { type: "string", minLength: 1, maxLength: 200 },
  introduction: { type: "string", maxLength: 4000 },
  validUntil: { type: "string", format: "date" },
  conditions: { type: "string", maxLength: 4000 },
  notes: { type: "string", maxLength: 4000 },
  terms: { type: "string", maxLength: 8000 },
} as const;
const CREATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "title", "items"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    dealId: { type: "string" },
    contactId: { type: "string" },
    items: { type: "array", items: ITEM_SCHEMA, minItems: 1, maxItems: 100 },
    discountCents: { type: "integer", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    ...CONTENT_PROPERTIES,
  },
} as const;
const UPDATE_BODY_SCHEMA = { ...CREATE_BODY_SCHEMA, required: ["workspaceId"], properties: { ...CREATE_BODY_SCHEMA.properties, items: { type: "array", items: ITEM_SCHEMA, minItems: 1, maxItems: 100 } } } as const;
const SEND_BODY_SCHEMA = {
  type: "object", required: ["workspaceId", "conversationId", "idempotencyKey"], additionalProperties: false,
  properties: { workspaceId: { type: "string" }, conversationId: { type: "string" }, message: { type: "string", maxLength: 4000 }, idempotencyKey: { type: "string", minLength: 8, maxLength: 200 } },
} as const;

const VALIDATION = ["PROPOSAL_NOT_EDITABLE", "PROPOSAL_NOT_SENDABLE", "PROPOSAL_LINK_NOT_AVAILABLE", "PROPOSAL_CONTEXT_INVALID", "PROPOSAL_SEND_", "DEAL_CLOSED"];
function translateProposalError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("PROPOSAL_NOT_FOUND") || error.message.startsWith("DEAL_NOT_FOUND") || error.message.startsWith("PROPOSAL_TEMPLATE_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("COMMERCIAL_APPROVAL_REQUIRED")) throw new ConflictError(error.message);
    if (VALIDATION.some((code) => error.message.startsWith(code))) throw new ValidationError(error.message);
  }
  throw error;
}

export type ProposalsRoutesDeps = ProposalUseCaseDeps & { delivery?: ProposalDeliveryDeps; sales?: SalesProposalDeps };

export async function registerProposalsRoutes(app: FastifyInstance, deps: ProposalsRoutesDeps): Promise<void> {
  /** Custo dos itens (snapshot interno) só para quem pode ver custo. */
  async function present<T extends Proposal | Proposal[]>(request: FastifyRequest, workspaceId: string, value: T): Promise<T> {
    if (!deps.sales) return value;
    const principal = requirePermission(request, "proposal:read");
    const visibility = resolveVisibility({ tenantId: principal.tenantId, userId: principal.userId, role: principal.role }, await loadCommercialSettings(deps.sales, principal.tenantId, workspaceId));
    if (visibility.canViewCost) return value;
    const strip = (proposal: Proposal): Proposal => ({ ...proposal, items: proposal.items.map((item) => ({ ...item, unitCostCents: undefined })) });
    return (Array.isArray(value) ? value.map(strip) : strip(value)) as T;
  }

  app.get("/proposals", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:read");
    const { workspaceId, dealId, contactId, status } = request.query as { workspaceId: string; dealId?: string; contactId?: string; status?: (typeof PROPOSAL_STATUSES)[number] };
    const proposals = await listProposals(deps, { tenantId: principal.tenantId, workspaceId, dealId, contactId, status });
    return successEnvelope(await present(request, workspaceId, proposals), request.id);
  });

  app.post("/proposals", { schema: { body: CREATE_BODY_SCHEMA }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const principal = requirePermission(request, "proposal:manage");
    const body = request.body as Record<string, unknown> & { workspaceId: string; title: string; items: unknown[] };
    try {
      const { proposal, rawToken } = await createProposal(deps, { tenantId: principal.tenantId, ...body, createdByUserId: principal.userId } as never);
      reply.code(201);
      return successEnvelope({ ...(await present(request, body.workspaceId, proposal)), publicToken: rawToken }, request.id);
    } catch (error) {
      translateProposalError(error);
    }
  });

  /** Gerar proposta a partir da oportunidade — puxa cliente, itens, preços, descontos e totais. */
  app.post("/deals/:id/proposals", {
    schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1 }, templateId: { type: "string" }, justification: { type: "string", maxLength: 2000 }, ...CONTENT_PROPERTIES } } },
    config: { readOnlyGuard: true },
  }, async (request, reply) => {
    const principal = requirePermission(request, "proposal:manage");
    if (!deps.sales) throw new ValidationError("PROPOSAL_CONTEXT_INVALID: Sales Engine indisponível.");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const result = await createProposalFromDeal(deps.sales, { tenantId: principal.tenantId, userId: principal.userId, role: principal.role }, { ...body, dealId: id } as never);
      reply.code(201);
      return successEnvelope({ ...(await present(request, body.workspaceId, result.proposal)), publicToken: result.rawToken, approvalRequired: result.approvalRequired }, request.id);
    } catch (error) {
      translateProposalError(error);
    }
  });

  app.get("/proposals/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const proposal = await getProposal(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(await present(request, workspaceId, proposal), request.id);
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
      return successEnvelope(await present(request, workspaceId, proposal), request.id);
    } catch (error) {
      translateProposalError(error);
    }
  });

  app.post("/proposals/:id/versions", {
    schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1 }, items: { type: "array", items: ITEM_SCHEMA, minItems: 1, maxItems: 100 }, discountCents: { type: "integer", minimum: 0 }, ...CONTENT_PROPERTIES } } },
    config: { readOnlyGuard: true },
  }, async (request, reply) => {
    const principal = requirePermission(request, "proposal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...overrides } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const { proposal, rawToken } = await createProposalVersion(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId, actorUserId: principal.userId, overrides: overrides as never });
      reply.code(201);
      return successEnvelope({ ...(await present(request, workspaceId, proposal)), publicToken: rawToken }, request.id);
    } catch (error) {
      translateProposalError(error);
    }
  });

  app.post("/proposals/:id/cancel", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try { return successEnvelope(await cancelProposal(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId, actorUserId: principal.userId }), request.id); } catch (error) { translateProposalError(error); }
  });

  /** Envio por outro canal (link copiado): marca enviada passando pelo MESMO gate de aprovação. */
  app.post("/proposals/:id/mark-sent", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], additionalProperties: false, properties: { workspaceId: { type: "string" }, channel: { type: "string", enum: ["link", "email", "other"] } } } } }, async (request) => {
    const principal = requirePermission(request, "proposal:send");
    const { id } = request.params as { id: string };
    const { workspaceId, channel } = request.body as { workspaceId: string; channel?: string };
    try { return successEnvelope(await sendProposal(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId, actorUserId: principal.userId, channel: channel ?? "link" }), request.id); } catch (error) { translateProposalError(error); }
  });

  app.post("/proposals/:id/link/regenerate", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:send");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const { proposal, rawToken } = await regenerateProposalLink(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope({ ...(await present(request, workspaceId, proposal)), publicToken: rawToken }, request.id);
    } catch (error) {
      translateProposalError(error);
    }
  });

  app.post("/proposals/:id/link/revoke", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:send");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try { return successEnvelope(await revokeProposalLink(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId }), request.id); } catch (error) { translateProposalError(error); }
  });

  app.post("/proposals/:id/recipients", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId", "name"], additionalProperties: false, properties: { workspaceId: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 120 }, contactId: { type: "string" } } } } }, async (request, reply) => {
    const principal = requirePermission(request, "proposal:send");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; name: string; contactId?: string };
    try {
      const result = await addProposalRecipient(deps, { proposalId: id, tenantId: principal.tenantId, ...body });
      reply.code(201);
      return successEnvelope({ recipientId: result.recipientId, publicToken: result.rawToken }, request.id);
    } catch (error) { translateProposalError(error); }
  });

  app.post("/proposals/:id/send-whatsapp", { schema: { params: ID_PARAMS_SCHEMA, body: SEND_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:send");
    requirePermission(request, "inbox:reply");
    if (!deps.delivery) throw new ValidationError("PROPOSAL_SEND_UNAVAILABLE: o módulo Conversas está desabilitado.");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; conversationId: string; message?: string; idempotencyKey: string };
    try {
      const sent = await deliverProposalThroughInbox(deps.delivery, { proposalId: id, tenantId: principal.tenantId, workspaceId: body.workspaceId, conversationId: body.conversationId, message: body.message, idempotencyKey: body.idempotencyKey, sentByUserId: principal.userId });
      return successEnvelope(await present(request, body.workspaceId, sent), request.id);
    } catch (error) { translateProposalError(error); }
  });

  app.post("/proposals/:id/remind-whatsapp", { schema: { params: ID_PARAMS_SCHEMA, body: SEND_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:send");
    requirePermission(request, "inbox:reply");
    if (!deps.delivery) throw new ValidationError("PROPOSAL_SEND_UNAVAILABLE: o módulo Conversas está desabilitado.");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; conversationId: string; message?: string; idempotencyKey: string };
    try {
      const proposal = await sendProposalReminderThroughInbox(deps.delivery, { proposalId: id, tenantId: principal.tenantId, workspaceId: body.workspaceId, conversationId: body.conversationId, message: body.message, idempotencyKey: body.idempotencyKey, sentByUserId: principal.userId });
      return successEnvelope(await present(request, body.workspaceId, proposal), request.id);
    } catch (error) { translateProposalError(error); }
  });

  app.get("/proposals/:id/tracking", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      if (deps.delivery) {
        const tracking = await getProposalTracking(deps.delivery, { proposalId: id, tenantId: principal.tenantId, workspaceId });
        return successEnvelope({ ...tracking, proposal: await present(request, workspaceId, tracking.proposal) }, request.id);
      }
      const proposal = await getProposal(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId });
      const versions = await deps.proposalRepository.listVersions(proposal.rootProposalId);
      return successEnvelope({
        proposal: await present(request, workspaceId, proposal), deliveries: [], events: await listProposalEvents(deps, { proposalId: id, tenantId: principal.tenantId, workspaceId }),
        recipients: await deps.proposalRepository.listRecipients(proposal.id),
        versions: versions.map((version) => ({ id: version.id, version: version.version, status: version.status, sentAt: version.sentAt, totalCents: version.totalCents })),
      }, request.id);
    } catch (error) { translateProposalError(error); }
  });

  app.get("/inbox/conversations/:id/proposals", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "proposal:read");
    requirePermission(request, "inbox:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    if (!deps.delivery) return successEnvelope([], request.id);
    return successEnvelope(await listConversationProposals(deps.delivery, { tenantId: principal.tenantId, workspaceId, conversationId: id }), request.id);
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
