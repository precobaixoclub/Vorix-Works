import { randomUUID } from "node:crypto";
import type { InstagramDmAutomationRule, InstagramDmAutomationRuleRepositoryPort, UpsertInstagramDmAutomationRuleInput } from "../../application/ports/instagram-dm-automation-rule-repository.port.js";

export class InMemoryInstagramDmAutomationRuleRepository implements InstagramDmAutomationRuleRepositoryPort {
  private readonly rules = new Map<string, InstagramDmAutomationRule>();

  async upsertRule(input: UpsertInstagramDmAutomationRuleInput): Promise<InstagramDmAutomationRule> {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const existing = this.rules.get(id);
    const record: InstagramDmAutomationRule = { ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.rules.set(id, record);
    return record;
  }

  async listByAccount(input: { tenantId: string; workspaceId: string; instagramBusinessAccountId: string; onlyEnabled?: boolean }): Promise<InstagramDmAutomationRule[]> {
    return [...this.rules.values()]
      .filter((rule) => rule.tenantId === input.tenantId && rule.workspaceId === input.workspaceId && rule.instagramBusinessAccountId === input.instagramBusinessAccountId)
      .filter((rule) => !input.onlyEnabled || rule.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  async getById(id: string): Promise<InstagramDmAutomationRule | undefined> {
    return this.rules.get(id);
  }

  async delete(id: string): Promise<void> {
    this.rules.delete(id);
  }
}
