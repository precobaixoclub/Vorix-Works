import type { ProposalItem, ProposalTemplate } from "../../domain/crm/crm.model.js";

export type ProposalTemplateValues = {
  name: string;
  defaultTitle: string;
  defaultItems: readonly ProposalItem[];
  defaultConditions?: string;
  defaultValidDays: number;
  active?: boolean;
};

export type ProposalTemplateRepositoryPort = {
  create(input: ProposalTemplateValues & { tenantId: string; workspaceId: string }): Promise<ProposalTemplate>;
  getById(id: string): Promise<ProposalTemplate | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; activeOnly?: boolean }): Promise<ProposalTemplate[]>;
  update(id: string, patch: Partial<ProposalTemplateValues>): Promise<ProposalTemplate>;
  delete(id: string): Promise<void>;
};
