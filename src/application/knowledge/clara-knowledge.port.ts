import type {
  ClaraContextRequest,
  ClaraContextResponse,
  ClaraCreateKnowledgeInput,
  ClaraDeleteKnowledgeInput,
  ClaraKnowledgeModule,
  ClaraKnowledgeQuery,
  ClaraKnowledgeRecord,
  ClaraKnowledgeSearchQuery,
  ClaraKnowledgeVersion,
  ClaraUpdateKnowledgeInput,
} from "./clara.types.js";

export type ClaraKnowledgePort = {
  create<TModule extends ClaraKnowledgeModule>(input: ClaraCreateKnowledgeInput<TModule>): Promise<ClaraKnowledgeRecord<TModule>>;
  update<TModule extends ClaraKnowledgeModule>(input: ClaraUpdateKnowledgeInput<TModule>): Promise<ClaraKnowledgeRecord<TModule>>;
  remove(input: ClaraDeleteKnowledgeInput): Promise<ClaraKnowledgeRecord>;
  get(query: ClaraKnowledgeQuery): Promise<ClaraKnowledgeRecord | undefined>;
  list(query: ClaraKnowledgeQuery): Promise<ClaraKnowledgeRecord[]>;
  search(query: ClaraKnowledgeSearchQuery): Promise<ClaraKnowledgeRecord[]>;
  getVersion(id: string, version: number): Promise<ClaraKnowledgeVersion | undefined>;
  requestContext(request: ClaraContextRequest): Promise<ClaraContextResponse>;
};
