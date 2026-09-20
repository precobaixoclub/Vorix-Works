import type { Proposal, ProposalItem, ProposalStatus } from "../../domain/crm/crm.model.js";

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
};

export type UpdateProposalInput = Partial<Omit<CreateProposalInput, "tenantId" | "workspaceId" | "publicTokenHash">>;

export type ListProposalsFilter = {
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
  recordView(id: string, viewedAt: string): Promise<Proposal>;
  setRejection(id: string, input: { reason?: string; comment?: string }): Promise<Proposal>;
  reserveDelivery(input: { id: string; tenantId: string; workspaceId: string; proposalId: string; conversationId: string; idempotencyKey: string }): Promise<"reserved" | "pending" | "queued">;
  completeDelivery(input: { tenantId: string; workspaceId: string; idempotencyKey: string; inboxMessageId: string; queuedAt: string }): Promise<void>;
  failDelivery(input: { tenantId: string; workspaceId: string; idempotencyKey: string; errorMessage: string }): Promise<void>;
};
