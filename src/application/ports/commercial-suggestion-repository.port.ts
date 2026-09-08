import type { CommercialSuggestion, CommercialSuggestionAction, CommercialSuggestionStatus } from "../../domain/crm/crm.model.js";

export type CreateCommercialSuggestionInput = {
  tenantId: string;
  workspaceId: string;
  contactId: string;
  dealId?: string;
  title: string;
  rationale: string;
  evidence: string;
  confidence: number;
  suggestedAction: CommercialSuggestionAction;
};

export type ListCommercialSuggestionsFilter = {
  tenantId: string;
  workspaceId: string;
  contactId?: string;
  status?: CommercialSuggestionStatus;
};

export type CommercialSuggestionRepositoryPort = {
  create(input: CreateCommercialSuggestionInput): Promise<CommercialSuggestion>;
  getById(id: string): Promise<CommercialSuggestion | undefined>;
  listByWorkspace(filter: ListCommercialSuggestionsFilter): Promise<CommercialSuggestion[]>;
  setStatus(id: string, status: CommercialSuggestionStatus, resolvedAt: string | null): Promise<CommercialSuggestion>;
};
