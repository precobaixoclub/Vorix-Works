import type { FastifyInstance } from "fastify";
import {
  acceptCommercialSuggestion,
  dismissCommercialSuggestion,
  generateCommercialSuggestions,
  listCommercialSuggestions,
} from "../../../../application/crm/commercial-copilot-use-cases.js";
import type { CommercialCopilotUseCaseDeps } from "../../../../application/crm/commercial-copilot-use-cases.js";
import { COMMERCIAL_SUGGESTION_STATUSES } from "../../../../domain/crm/crm.model.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const LIST_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, contactId: { type: "string" }, status: { type: "string", enum: [...COMMERCIAL_SUGGESTION_STATUSES] } },
} as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const CONTACT_ID_PARAMS_SCHEMA = { type: "object", required: ["contactId"], properties: { contactId: { type: "string", minLength: 1 } } } as const;

function translateCommercialSuggestionError(error: unknown): never {
  if (error instanceof Error && (error.message.startsWith("CONTACT_NOT_FOUND") || error.message.startsWith("COMMERCIAL_SUGGESTION_NOT_FOUND"))) {
    throw new NotFoundError(error.message);
  }
  if (error instanceof Error && (error.message.startsWith("COMMERCIAL_COPILOT_UNAVAILABLE") || error.message.startsWith("COMMERCIAL_SUGGESTION_ALREADY_RESOLVED"))) {
    throw new ValidationError(error.message);
  }
  throw error;
}

export async function registerCommercialSuggestionsRoutes(app: FastifyInstance, deps: CommercialCopilotUseCaseDeps): Promise<void> {
  app.get("/commercial-suggestions", { schema: { querystring: LIST_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "contact:read");
    const { workspaceId, contactId, status } = request.query as { workspaceId: string; contactId?: string; status?: (typeof COMMERCIAL_SUGGESTION_STATUSES)[number] };
    const suggestions = await listCommercialSuggestions(deps, { tenantId: principal.tenantId, workspaceId, contactId, status });
    return successEnvelope(suggestions, request.id);
  });

  app.post("/contacts/:contactId/commercial-suggestions/generate", { schema: { params: CONTACT_ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "contact:manage");
    const { contactId } = request.params as { contactId: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const suggestions = await generateCommercialSuggestions(deps, { contactId, tenantId: principal.tenantId, workspaceId });
      reply.code(201);
      return successEnvelope(suggestions, request.id);
    } catch (error) {
      translateCommercialSuggestionError(error);
    }
  });

  app.post("/commercial-suggestions/:id/accept", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "contact:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const suggestion = await acceptCommercialSuggestion(deps, { suggestionId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(suggestion, request.id);
    } catch (error) {
      translateCommercialSuggestionError(error);
    }
  });

  app.post("/commercial-suggestions/:id/dismiss", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "contact:manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const suggestion = await dismissCommercialSuggestion(deps, { suggestionId: id, tenantId: principal.tenantId, workspaceId });
      return successEnvelope(suggestion, request.id);
    } catch (error) {
      translateCommercialSuggestionError(error);
    }
  });
}
