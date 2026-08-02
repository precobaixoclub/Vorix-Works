import type { Conversation, ConversationEvent } from "../../domain/conversation/conversation.model.js";
import type { BriefingUseCaseDeps } from "../briefing/briefing-use-cases.js";
import type { AiGatewayPort } from "../ports/ai-gateway.port.js";
import type { AssetMetadataSourcePort } from "../ports/asset-metadata-source.port.js";
import type { CompanyKnowledgeSourcePort } from "../ports/company-knowledge-source.port.js";
import type { ConversationEventRepositoryPort } from "../ports/conversation-event-repository.port.js";
import type { ConversationMemoryRepositoryPort } from "../ports/conversation-memory-repository.port.js";
import type { ConversationRepositoryPort } from "../ports/conversation-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import { processMessage, type ProcessMessageResult } from "./conversation-engine.js";

/**
 * Casos de uso de Conversation — Sprint 06 (Fase 5, camada `application`). Mesmo padrão de
 * `application/workspace/workspace-use-cases.ts` (Sprint 03): `tenantId` sempre vem de fora
 * (contexto de autenticação), nunca do corpo da requisição; erros são `Error` com prefixo
 * reconhecível, traduzidos para status HTTP na borda (`conversations.route.ts`).
 *
 * Isolamento "sempre por Tenant E Workspace" (PROMPT 06, Fase 5): toda operação sobre uma
 * conversa existente confere `tenantId` E `workspaceId`, não só o primeiro — uma conversa de um
 * Workspace nunca aparece/é alterável a partir de outro Workspace do MESMO tenant.
 */
export type ConversationUseCaseDeps = {
  conversationRepository: ConversationRepositoryPort;
  eventRepository: ConversationEventRepositoryPort;
  memoryRepository: ConversationMemoryRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
} & BriefingUseCaseDeps & {
    companyKnowledgeSource: CompanyKnowledgeSourcePort;
    assetMetadataSource: AssetMetadataSourcePort;
    aiGateway: AiGatewayPort;
    aiExtractionEnabled: boolean;
  };

async function mustBelongToTenantAndWorkspace(
  repository: ConversationRepositoryPort,
  id: string,
  tenantId: string,
  workspaceId: string,
): Promise<Conversation> {
  const conversation = await repository.getById(id);
  if (!conversation || conversation.tenantId !== tenantId || conversation.workspaceId !== workspaceId) {
    throw new Error(`CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
  }
  return conversation;
}

export type CreateConversationUseCaseInput = { tenantId: string; workspaceId: string; title?: string };

export async function createConversation(deps: ConversationUseCaseDeps, input: CreateConversationUseCaseInput): Promise<Conversation> {
  const workspace = await deps.workspaceRepository.getById(input.workspaceId);
  if (!workspace || workspace.tenantId !== input.tenantId) {
    throw new Error(`CONVERSATION_WORKSPACE_NOT_FOUND: workspace "${input.workspaceId}" não existe.`);
  }
  return deps.conversationRepository.create({ tenantId: input.tenantId, workspaceId: input.workspaceId, title: input.title });
}

export type ListConversationsUseCaseInput = { tenantId: string; workspaceId: string };

export async function listConversations(deps: ConversationUseCaseDeps, input: ListConversationsUseCaseInput): Promise<Conversation[]> {
  return deps.conversationRepository.listByWorkspace(input.tenantId, input.workspaceId);
}

export type GetConversationUseCaseInput = { tenantId: string; workspaceId: string; id: string };

export async function getConversation(deps: ConversationUseCaseDeps, input: GetConversationUseCaseInput): Promise<Conversation> {
  return mustBelongToTenantAndWorkspace(deps.conversationRepository, input.id, input.tenantId, input.workspaceId);
}

export type SendMessageUseCaseInput = { tenantId: string; workspaceId: string; conversationId: string; content: string };

export async function sendMessage(deps: ConversationUseCaseDeps, input: SendMessageUseCaseInput): Promise<ProcessMessageResult> {
  await mustBelongToTenantAndWorkspace(deps.conversationRepository, input.conversationId, input.tenantId, input.workspaceId);
  const content = input.content?.trim();
  if (!content) {
    throw new Error("CONVERSATION_VALIDATION_ERROR: content é obrigatório.");
  }
  return processMessage(deps, { conversationId: input.conversationId, content });
}

export type GetHistoryUseCaseInput = { tenantId: string; workspaceId: string; conversationId: string };

export async function getHistory(deps: ConversationUseCaseDeps, input: GetHistoryUseCaseInput): Promise<ConversationEvent[]> {
  await mustBelongToTenantAndWorkspace(deps.conversationRepository, input.conversationId, input.tenantId, input.workspaceId);
  return deps.eventRepository.listByConversation(input.conversationId);
}
