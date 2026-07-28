import type { CompanyKnowledgeBase } from "../../domain/company-intelligence/company-intelligence.model.js";

/**
 * Porta de persistência da base de conhecimento de empresa — mesmo espírito de
 * `ClaraKnowledgeRepositoryPort`: a Company Intelligence Engine (infraestrutura) depende só
 * desta interface, nunca de um arquivo concreto, para poder trocar a implementação em teste.
 */

export type CompanyKnowledgeRepositoryPort = {
  save(base: CompanyKnowledgeBase): Promise<void>;
  findByDomain(domain: string): Promise<CompanyKnowledgeBase | undefined>;
  list(): Promise<CompanyKnowledgeBase[]>;
};
