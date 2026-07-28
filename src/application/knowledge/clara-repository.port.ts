import type { ClaraKnowledgeRecord, ClaraKnowledgeSearchQuery } from "./clara.types.js";

export type ClaraKnowledgeRepositoryPort = {
  save(record: ClaraKnowledgeRecord): Promise<void>;
  findById(id: string): Promise<ClaraKnowledgeRecord | undefined>;
  list(): Promise<ClaraKnowledgeRecord[]>;
  search(query: ClaraKnowledgeSearchQuery): Promise<ClaraKnowledgeRecord[]>;
};
