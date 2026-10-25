import type { Proposal, ProposalDelivery, ProposalEvent, ProposalEventType, ProposalItem, ProposalRecipient, ProposalStatus } from "../../domain/crm/crm.model.js";

export type CreateProposalInput = {
  tenantId: string;
  workspaceId: string;
  dealId?: string;
  contactId?: string;
  title: string;
  items: readonly ProposalItem[];
  discountCents?: number;
  totalCents: number;
  currency?: string;
  validUntil?: string;
  conditions?: string;
  publicTokenHash: string;
  number?: string;
  version?: number;
  rootProposalId?: string;
  supersedesProposalId?: string;
  introduction?: string;
  notes?: string;
  terms?: string;
  listTotalCents?: number;
  createdByUserId?: string;
  status?: ProposalStatus;
};

export type UpdateProposalInput = Partial<Omit<CreateProposalInput, "tenantId" | "workspaceId" | "publicTokenHash" | "number" | "version" | "rootProposalId" | "supersedesProposalId" | "createdByUserId" | "status">>;

export type ListProposalsFilter = { ownUserId?: string; ownerUserIdsIn?: readonly string[]; teamIdsIn?: readonly string[];
  tenantId: string;
  workspaceId: string;
  dealId?: string;
  contactId?: string;
  status?: ProposalStatus;
  cursor?: string;
  limit?: number;
};

export type ProposalRepositoryPort = {
  create(input: CreateProposalInput): Promise<Proposal>;
  getById(id: string): Promise<Proposal | undefined>;
  getByTokenHash(tokenHash: string): Promise<Proposal | undefined>;
  listByWorkspace(filter: ListProposalsFilter): Promise<Proposal[]>;
  update(id: string, input: UpdateProposalInput): Promise<Proposal>;
  setStatus(id: string, input: { status: ProposalStatus; sentAt?: string | null; viewedAt?: string | null; respondedAt?: string | null }): Promise<Proposal>;
  rotatePublicToken(id: string, tokenHash: string): Promise<Proposal>;
  revokePublicToken(id: string, revokedAt: string): Promise<Proposal>;
  recordView(id: string, viewedAt: string, recipientId?: string): Promise<Proposal>;
  setRejection(id: string, input: { reason?: string; comment?: string }): Promise<Proposal>;
  reserveDelivery(input: { id: string; tenantId: string; workspaceId: string; proposalId: string; conversationId: string; idempotencyKey: string }): Promise<"reserved" | "pending" | "queued">;
  completeDelivery(input: { tenantId: string; workspaceId: string; idempotencyKey: string; inboxMessageId: string; queuedAt: string }): Promise<void>;
  failDelivery(input: { tenantId: string; workspaceId: string; idempotencyKey: string; errorMessage: string }): Promise<void>;
  // Sales Engine — versionamento, envio, aceite auditado, eventos, destinatários e follow-up.
  /** Próximo número sequencial do workspace no ano (PROP-AAAA-NNN). */
  nextNumber(workspaceId: string, year: number): Promise<string>;
  listVersions(rootProposalId: string): Promise<Proposal[]>;
  markSent(id: string, input: { sentAt: string; sentByUserId?: string; channel?: string; conversationId?: string; messageId?: string }): Promise<Proposal>;
  markSuperseded(id: string, input: { supersededByProposalId: string; at: string }): Promise<Proposal | undefined>;
  markCancelled(id: string, at: string): Promise<Proposal | undefined>;
  setAcceptance(id: string, input: { contentHash: string; ipHash?: string; userAgent?: string; version: number }): Promise<Proposal>;
  addViewSeconds(id: string, seconds: number): Promise<void>;
  /** Marca um follow-up automático uma única vez (devolve false se já marcado — idempotente). */
  claimFollowUp(id: string, kind: "unviewed" | "unanswered" | "expiry", at: string): Promise<boolean>;
  listFollowUpCandidates(input: { sentBefore: string; viewedBefore: string; expiringUntil: string; limit: number }): Promise<Proposal[]>;
  appendEvent(input: { tenantId: string; workspaceId: string; proposalId: string; eventType: ProposalEventType; recipientId?: string; occurredAt?: string; payload?: Record<string, unknown> }): Promise<ProposalEvent | undefined>;
  listEvents(proposalId: string): Promise<ProposalEvent[]>;
  createRecipient(input: { tenantId: string; workspaceId: string; proposalId: string; contactId?: string; name: string; tokenHash: string }): Promise<ProposalRecipient>;
  listRecipients(proposalId: string): Promise<ProposalRecipient[]>;
  getRecipientByTokenHash(tokenHash: string): Promise<(ProposalRecipient & { proposalId: string }) | undefined>;
  recordRecipientView(recipientId: string, viewedAt: string): Promise<void>;
  listDeliveries(proposalId: string): Promise<ProposalDelivery[]>;
  listDeliveriesByConversation(input: { tenantId: string; workspaceId: string; conversationId: string }): Promise<(ProposalDelivery & { proposal: Proposal })[]>;
};
