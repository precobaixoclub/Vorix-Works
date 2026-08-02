import type { BriefingSource, BriefingType, PreparedCommand } from "../../domain/briefing/briefing.model.js";
import type { UserIntentType } from "../../domain/conversation/conversation.model.js";

export type CreatePreparedCommandInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  briefingId: string;
  briefingRevision: number;
  type: BriefingType;
  intent: UserIntentType;
  validatedInputs: Record<string, string>;
  sourceReferences: Record<string, BriefingSource>;
  unresolvedOptionalFields: readonly string[];
};

export type PreparedCommandRepositoryPort = {
  create(input: CreatePreparedCommandInput): Promise<PreparedCommand>;
  getById(id: string): Promise<PreparedCommand | undefined>;
  /** Unicidade lógica `briefingId + briefingRevision + type` (Fase 9) — confirmação repetida sem
   * alteração devolve o MESMO comando em vez de criar um duplicado. */
  getByBriefingRevision(briefingId: string, briefingRevision: number, type: BriefingType): Promise<PreparedCommand | undefined>;
  markSuperseded(id: string): Promise<PreparedCommand>;
};
