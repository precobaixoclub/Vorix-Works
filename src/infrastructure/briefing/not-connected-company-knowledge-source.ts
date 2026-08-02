import type {
  CompanyKnowledgeFieldSuggestion,
  CompanyKnowledgeSourcePort,
} from "../../application/ports/company-knowledge-source.port.js";

/** Único adapter real nesta sprint — sempre `[]`. Ver comentário do Port. */
export class NotConnectedCompanyKnowledgeSource implements CompanyKnowledgeSourcePort {
  async suggestFields(_params: { workspaceId: string; fieldKeys: readonly string[] }): Promise<CompanyKnowledgeFieldSuggestion[]> {
    return [];
  }
}

export function createNotConnectedCompanyKnowledgeSource(): NotConnectedCompanyKnowledgeSource {
  return new NotConnectedCompanyKnowledgeSource();
}
