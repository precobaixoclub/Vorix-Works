import type { Briefing, BriefingStatus, BriefingType } from "../../domain/briefing/briefing.model.js";

export type CreateBriefingInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  type: BriefingType;
  schemaVersion: number;
};

export type BriefingRepositoryPort = {
  create(input: CreateBriefingInput): Promise<Briefing>;
  getById(id: string): Promise<Briefing | undefined>;
  /** Único briefing "vivo" (qualquer status exceto completed/cancelled/expired) por conversa —
   * usado tanto para retomar quanto para detectar que já existe um em andamento. */
  getActiveByConversation(conversationId: string): Promise<Briefing | undefined>;
  updateStatus(id: string, status: BriefingStatus): Promise<Briefing>;
  /** Incrementa `revision` em 1 — chamado só em correções pós-`awaiting_confirmation` (Fase 8/9). */
  incrementRevision(id: string): Promise<Briefing>;
};
