import type { PlanLimitResource } from "../../domain/platform-billing/plan-entitlements.model.js";
import type { UsageCounter } from "../../domain/platform-billing/usage-counter.model.js";

export type UsageCounterRepositoryPort = {
  get(input: { tenantId: string; resource: PlanLimitResource; period: string }): Promise<UsageCounter | undefined>;
  /** `delta` pode ser negativo (ex.: liberar armazenamento). Sempre `INSERT ... ON CONFLICT DO
   * UPDATE ... SET used = usage_counters.used + delta` — nunca lê-modifica-escreve na aplicação
   * (evita corrida sob concorrência real). */
  increment(input: { tenantId: string; workspaceId?: string; resource: PlanLimitResource; period: string; delta: number }): Promise<UsageCounter>;
};
