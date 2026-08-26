/** Regras de resposta automática por palavra-chave — módulo Instagram DM Automation, Fase 5. Ver
 * `db/migrations/0079_instagram_dm_automation_rules.sql`. */

export type InstagramDmAutomationMatchType = "contains" | "exact" | "starts_with";
export type InstagramDmAutomationReplyMode = "fixed" | "ai";

export type InstagramDmAutomationRule = {
  id: string;
  tenantId: string;
  workspaceId: string;
  instagramBusinessAccountId: string;
  name: string;
  enabled: boolean;
  matchType: InstagramDmAutomationMatchType;
  keywords: readonly string[];
  replyMode: InstagramDmAutomationReplyMode;
  replyText?: string;
  aiInstructions?: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

export type UpsertInstagramDmAutomationRuleInput = Omit<InstagramDmAutomationRule, "id" | "createdAt" | "updatedAt"> & { id?: string };

export type InstagramDmAutomationRuleRepositoryPort = {
  upsertRule(input: UpsertInstagramDmAutomationRuleInput): Promise<InstagramDmAutomationRule>;
  listByAccount(input: { tenantId: string; workspaceId: string; instagramBusinessAccountId: string; onlyEnabled?: boolean }): Promise<InstagramDmAutomationRule[]>;
  getById(id: string): Promise<InstagramDmAutomationRule | undefined>;
  delete(id: string): Promise<void>;
};
