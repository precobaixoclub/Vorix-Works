import type { FastifyInstance } from "fastify";
import { createContact, getContact, getContactTimeline, linkContactIdentity, listContacts, updateContact } from "../../../../application/crm/contact-use-cases.js";
import type { ContactUseCaseDeps } from "../../../../application/crm/contact-use-cases.js";
import { getLeadScore } from "../../../../application/crm/lead-scoring-use-cases.js";
import type { LeadScoringUseCaseDeps } from "../../../../application/crm/lead-scoring-use-cases.js";
import { CONTACT_CHANNELS } from "../../../../domain/crm/crm.model.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    search: { type: "string" },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
    cursor: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 200 },
  },
} as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const CREATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "name"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 200 },
    company: { type: "string", maxLength: 200 },
    document: { type: "string", maxLength: 32 },
    origin: { type: "string", maxLength: 60 },
    ownerUserId: { type: "string" },
    teamId: { type: "string" },
    tags: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 20 },
    customFields: { type: "object" },
    notes: { type: "string", maxLength: 4000 },
  },
} as const;
const UPDATE_BODY_SCHEMA = { ...CREATE_BODY_SCHEMA, required: ["workspaceId"] } as const;
const LINK_IDENTITY_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "channel", "externalId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    channel: { type: "string", enum: [...CONTACT_CHANNELS] },
    externalId: { type: "string", minLength: 1 },
    connectionId: { type: "string" },
  },
} as const;

function translateContactError(error: unknown): never {
  if (error instanceof Error && error.message.startsWith("CONTACT_NOT_FOUND")) throw new NotFoundError(error.message);
  throw error;
}

export async function registerContactsRoutes(app: FastifyInstance, deps: ContactUseCaseDeps & LeadScoringUseCaseDeps): Promise<void> {
  app.get("/contacts", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "contact:read");
    const { workspaceId, search, ownerUserId, teamId, cursor, limit } = request.query as { workspaceId: string; search?: string; ownerUserId?: string; teamId?: string; cursor?: string; limit?: number };
    const contacts = await listContacts(deps, { tenantId: principal.tenantId, workspaceId, search, ownerUserId, teamId, cursor, limit });
    return successEnvelope(contacts, request.id);
  });

  app.post("/contacts", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "contact:manage");
    const body = request.body as Record<string, unknown> & { workspaceId: string; name: string };
    const contact = await createContact(deps, { tenantId: principal.tenantId, ...body } as never);
    reply.code(201);
    return successEnvelope(contact, request.id);
  });

  app.get("/contacts/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "contact:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const contact = await getContact(deps, { contactId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(contact, request.id);
    } catch (error) {
      translateContactError(error);
    }
  });

  app.patch("/contacts/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "contact:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, ...patch } = request.body as { workspaceId: string } & Record<string, unknown>;
    try {
      const contact = await updateContact(deps, { contactId: id, tenantId: principal.tenantId, workspaceId, patch: patch as never });
      return successEnvelope(contact, request.id);
    } catch (error) {
      translateContactError(error);
    }
  });

  app.get("/contacts/:id/timeline", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "contact:read");
    const { id } = request.params as { id: string };
    const { workspaceId, limit } = request.query as { workspaceId: string; limit?: number };
    try {
      const timeline = await getContactTimeline(deps, { contactId: id, tenantId: principal.tenantId, workspaceId, limit });
      return successEnvelope(timeline, request.id);
    } catch (error) {
      translateContactError(error);
    }
  });

  app.get("/contacts/:id/lead-score", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "contact:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const leadScore = await getLeadScore(deps, { contactId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(leadScore, request.id);
    } catch (error) {
      translateContactError(error);
    }
  });

  app.post("/contacts/:id/identities", { schema: { params: ID_PARAMS_SCHEMA, body: LINK_IDENTITY_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "contact:manage");
    const { id } = request.params as { id: string };
    const { workspaceId, channel, externalId, connectionId } = request.body as { workspaceId: string; channel: (typeof CONTACT_CHANNELS)[number]; externalId: string; connectionId?: string };
    try {
      const result = await linkContactIdentity(deps, { contactId: id, tenantId: principal.tenantId, workspaceId, channel, externalId, connectionId });
      if (result.conflictsWithAnotherContact) {
        throw new ValidationError(`CONTACT_IDENTITY_CONFLICT: esta identidade de ${channel} já está ligada a outro contato — sem fusão automática, resolva manualmente.`);
      }
      reply.code(result.wasCreated ? 201 : 200);
      return successEnvelope(result.identity, request.id);
    } catch (error) {
      translateContactError(error);
    }
  });
}
