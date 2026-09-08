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
};
