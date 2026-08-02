/**
 * Porta estreita de LEITURA para o Context Resolver (Sprint 07, Fase 4) — nunca o
 * `ClaraKnowledgePort` completo (create/update/remove/get/list/search/requestContext). O único
 * adapter real hoje, `NotConnectedCompanyKnowledgeSource`, sempre devolve `[]`: a ponte
 * `Workspace.knowledge.clientId -> Clara` continua sendo a dívida arquitetural documentada desde
 * a Sprint 03, nunca resolvida — nenhuma fonte disponível não pode quebrar o turno (Fase 4), então
 * o resolver trata isso como "sem sugestão desta fonte", nunca como erro.
 */
export type CompanyKnowledgeFieldSuggestion = {
  fieldKey: string;
  value: string;
  confidence: number;
};

export type CompanyKnowledgeSourcePort = {
  suggestFields(params: { workspaceId: string; fieldKeys: readonly string[] }): Promise<CompanyKnowledgeFieldSuggestion[]>;
};
