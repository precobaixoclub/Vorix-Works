import type { AutomationActionConfig, AutomationActionType, AutomationCondition, AutomationRule, AutomationTrigger } from "../../domain/crm/crm.model.js";

export type CreateAutomationRuleInput = {
  tenantId: string;
  workspaceId: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: readonly AutomationCondition[];
  action: AutomationActionType;
  actionConfig: AutomationActionConfig;
};

export type UpdateAutomationRuleInput = Partial<Omit<CreateAutomationRuleInput, "tenantId" | "workspaceId">> & { active?: boolean };

export type AutomationRuleRepositoryPort = {
  create(input: CreateAutomationRuleInput): Promise<AutomationRule>;
  getById(id: string): Promise<AutomationRule | undefined>;
  listByWorkspace(tenantId: string, workspaceId: string): Promise<AutomationRule[]>;
  listActiveByTrigger(tenantId: string, workspaceId: string, trigger: AutomationTrigger): Promise<AutomationRule[]>;
  update(id: string, input: UpdateAutomationRuleInput): Promise<AutomationRule>;
  delete(id: string): Promise<void>;
};
