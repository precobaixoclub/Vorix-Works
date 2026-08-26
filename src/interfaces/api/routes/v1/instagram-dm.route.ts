import type { FastifyInstance } from "fastify";
import type { InstagramDmConversationRepositoryPort } from "../../../../application/ports/instagram-dm-conversation-repository.port.js";
import type { InstagramDmMessageRepositoryPort } from "../../../../application/ports/instagram-dm-message-repository.port.js";
import type { InstagramDmAutomationRuleRepositoryPort } from "../../../../application/ports/instagram-dm-automation-rule-repository.port.js";
import type { PublicationRepositoryPort } from "../../../../application/ports/publication-repository.port.js";
import type { PublicationSecretStoragePort } from "../../../../application/publication/publication-secret-store.js";
import { sendInstagramDm } from "../../../../application/instagram-dm/send-instagram-dm.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/** Inbox de DM do Instagram + regras de automação — módulo Instagram DM Automation, Fase 5. */

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, instagramBusinessAccountId: { type: "string" } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const WORKSPACE_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const SEND_MESSAGE_BODY_SCHEMA = { type: "object", required: ["workspaceId", "text"], properties: { workspaceId: { type: "string", minLength: 1 }, text: { type: "string", minLength: 1 } } } as const;
const MUTE_BODY_SCHEMA = { type: "object", required: ["workspaceId", "muted"], properties: { workspaceId: { type: "string", minLength: 1 }, muted: { type: "boolean" } } } as const;

const AUTOMATION_RULE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "instagramBusinessAccountId", "name", "matchType", "keywords", "replyMode"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    instagramBusinessAccountId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    matchType: { type: "string", enum: ["contains", "exact", "starts_with"] },
    keywords: { type: "array", items: { type: "string" }, minItems: 1 },
    replyMode: { type: "string", enum: ["fixed", "ai"] },
    replyText: { type: "string" },
    aiInstructions: { type: "string" },
    priority: { type: "number" },
  },
} as const;

const UPDATE_AUTOMATION_RULE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    matchType: { type: "string", enum: ["contains", "exact", "starts_with"] },
    keywords: { type: "array", items: { type: "string" }, minItems: 1 },
    replyMode: { type: "string", enum: ["fixed", "ai"] },
    replyText: { type: "string" },
    aiInstructions: { type: "string" },
    priority: { type: "number" },
  },
} as const;

const INSTAGRAM_DM_ERROR_STATUS: Record<string, number> = {
  INSTAGRAM_DM_CREDENTIAL_NOT_ACTIVE: 409,
  INSTAGRAM_DM_TOKEN_MISSING: 409,
  INSTAGRAM_DM_TEXT_EMPTY: 422,
  INSTAGRAM_DM_TEXT_TOO_LONG: 422,
};

function rethrowInstagramDmError(error: unknown): never {
  if (error instanceof Error) {
    const [code, ...rest] = error.message.split(": ");
    const statusCode = INSTAGRAM_DM_ERROR_STATUS[code];
    if (statusCode !== undefined) {
      throw new AppError({ code, message: rest.join(": ") || error.message, statusCode, recoverable: true });
    }
  }
  throw error;
}

export type InstagramDmRoutesDeps = {
  conversationRepository: InstagramDmConversationRepositoryPort;
  messageRepository: InstagramDmMessageRepositoryPort;
  automationRuleRepository: InstagramDmAutomationRuleRepositoryPort;
  publicationRepository: PublicationRepositoryPort;
  publicationSecretStore: PublicationSecretStoragePort;
};

export async function registerInstagramDmRoutes(app: FastifyInstance, deps: InstagramDmRoutesDeps): Promise<void> {
  app.get("/instagram-dm/conversations", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "instagram_dm:read");
    const { workspaceId, instagramBusinessAccountId } = request.query as { workspaceId: string; instagramBusinessAccountId?: string };
    const conversations = await deps.conversationRepository.listByWorkspace({ tenantId: principal.tenantId, workspaceId, instagramBusinessAccountId });
    return successEnvelope({ conversations }, request.id);
  });

  app.get("/instagram-dm/conversations/:id/messages", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "instagram_dm:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const conversation = await deps.conversationRepository.getById(id);
    if (!conversation || conversation.tenantId !== principal.tenantId || conversation.workspaceId !== workspaceId) {
      throw new AppError({ code: "INSTAGRAM_DM_CONVERSATION_NOT_FOUND", message: "Conversa não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    const messages = await deps.messageRepository.listByConversation({ tenantId: principal.tenantId, workspaceId, conversationId: id });
    return successEnvelope({ messages }, request.id);
  });

  app.post("/instagram-dm/conversations/:id/read", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "instagram_dm:reply");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    const conversation = await deps.conversationRepository.getById(id);
    if (!conversation || conversation.tenantId !== principal.tenantId || conversation.workspaceId !== workspaceId) {
      throw new AppError({ code: "INSTAGRAM_DM_CONVERSATION_NOT_FOUND", message: "Conversa não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    await deps.conversationRepository.markRead(id);
    return successEnvelope({ read: true }, request.id);
  });

  app.post("/instagram-dm/conversations/:id/mute", { schema: { params: ID_PARAMS_SCHEMA, body: MUTE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "instagram_dm:reply");
    const { id } = request.params as { id: string };
    const { workspaceId, muted } = request.body as { workspaceId: string; muted: boolean };
    const conversation = await deps.conversationRepository.getById(id);
    if (!conversation || conversation.tenantId !== principal.tenantId || conversation.workspaceId !== workspaceId) {
      throw new AppError({ code: "INSTAGRAM_DM_CONVERSATION_NOT_FOUND", message: "Conversa não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    await deps.conversationRepository.setAutomationMuted(id, muted);
    return successEnvelope({ automationMuted: muted }, request.id);
  });

  app.post("/instagram-dm/conversations/:id/messages", { schema: { params: ID_PARAMS_SCHEMA, body: SEND_MESSAGE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "instagram_dm:reply");
    const { id } = request.params as { id: string };
    const { workspaceId, text } = request.body as { workspaceId: string; text: string };
    const conversation = await deps.conversationRepository.getById(id);
    if (!conversation || conversation.tenantId !== principal.tenantId || conversation.workspaceId !== workspaceId) {
      throw new AppError({ code: "INSTAGRAM_DM_CONVERSATION_NOT_FOUND", message: "Conversa não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const message = await sendInstagramDm(
        { messageRepository: deps.messageRepository, conversationRepository: deps.conversationRepository, publicationRepository: deps.publicationRepository, publicationSecretStore: deps.publicationSecretStore },
        { tenantId: principal.tenantId, workspaceId, conversation, text, sender: "page" },
      );
      return successEnvelope(message, request.id);
    } catch (error) {
      rethrowInstagramDmError(error);
    }
  });

  app.get("/instagram-dm/automation-rules", { schema: { querystring: { type: "object", required: ["workspaceId", "instagramBusinessAccountId"], properties: { workspaceId: { type: "string", minLength: 1 }, instagramBusinessAccountId: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "instagram_dm:read");
    const { workspaceId, instagramBusinessAccountId } = request.query as { workspaceId: string; instagramBusinessAccountId: string };
    const rules = await deps.automationRuleRepository.listByAccount({ tenantId: principal.tenantId, workspaceId, instagramBusinessAccountId });
    return successEnvelope({ rules }, request.id);
  });

  app.post("/instagram-dm/automation-rules", { schema: { body: AUTOMATION_RULE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "instagram_dm:automation_manage");
    const body = request.body as {
      workspaceId: string; instagramBusinessAccountId: string; name: string; enabled?: boolean; matchType: "contains" | "exact" | "starts_with";
      keywords: string[]; replyMode: "fixed" | "ai"; replyText?: string; aiInstructions?: string; priority?: number;
    };
    const rule = await deps.automationRuleRepository.upsertRule({
      tenantId: principal.tenantId, workspaceId: body.workspaceId, instagramBusinessAccountId: body.instagramBusinessAccountId,
      name: body.name, enabled: body.enabled ?? true, matchType: body.matchType, keywords: body.keywords, replyMode: body.replyMode,
      replyText: body.replyText, aiInstructions: body.aiInstructions, priority: body.priority ?? 0,
    });
    return successEnvelope(rule, request.id);
  });

  app.patch("/instagram-dm/automation-rules/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_AUTOMATION_RULE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "instagram_dm:automation_manage");
    const { id } = request.params as { id: string };
    const body = request.body as {
      workspaceId: string; name?: string; enabled?: boolean; matchType?: "contains" | "exact" | "starts_with";
      keywords?: string[]; replyMode?: "fixed" | "ai"; replyText?: string; aiInstructions?: string; priority?: number;
    };
    const existing = await deps.automationRuleRepository.getById(id);
    if (!existing || existing.tenantId !== principal.tenantId || existing.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "INSTAGRAM_DM_AUTOMATION_RULE_NOT_FOUND", message: "Regra não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    const rule = await deps.automationRuleRepository.upsertRule({
      ...existing,
      name: body.name ?? existing.name,
      enabled: body.enabled ?? existing.enabled,
      matchType: body.matchType ?? existing.matchType,
      keywords: body.keywords ?? existing.keywords,
      replyMode: body.replyMode ?? existing.replyMode,
      replyText: body.replyText ?? existing.replyText,
      aiInstructions: body.aiInstructions ?? existing.aiInstructions,
      priority: body.priority ?? existing.priority,
    });
    return successEnvelope(rule, request.id);
  });

  app.delete("/instagram-dm/automation-rules/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "instagram_dm:automation_manage");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const existing = await deps.automationRuleRepository.getById(id);
    if (!existing || existing.tenantId !== principal.tenantId || existing.workspaceId !== workspaceId) {
      throw new AppError({ code: "INSTAGRAM_DM_AUTOMATION_RULE_NOT_FOUND", message: "Regra não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    await deps.automationRuleRepository.delete(id);
    return successEnvelope({ deleted: true }, request.id);
  });
}
