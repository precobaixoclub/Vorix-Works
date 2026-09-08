import type { AutomationRunLog } from "../../domain/crm/crm.model.js";

export type RecordAutomationRunLogInput = {
  tenantId: string;
  workspaceId: string;
  ruleId: string;
  contactId?: string;
  dealId?: string;
  matched: boolean;
  actionTaken: boolean;
  error?: string;
};

export type AutomationRunLogRepositoryPort = {
  record(input: RecordAutomationRunLogInput): Promise<AutomationRunLog>;
  listByRule(ruleId: string, limit?: number): Promise<AutomationRunLog[]>;
};
