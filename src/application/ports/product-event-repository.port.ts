import type { ProductEvent, ProductEventName, ProductEventSource } from "../../domain/product-analytics/product-analytics.model.js";

export type RecordProductEventInput = {
  eventName: ProductEventName;
  occurredAt?: string;
  anonymousId?: string;
  userId?: string;
  tenantId?: string;
  workspaceId?: string;
  sessionId?: string;
  source: ProductEventSource;
  properties?: Record<string, unknown>;
};

export type CountByEventNameInput = { eventName: ProductEventName; tenantId?: string; since?: string; until?: string };
export type CountDistinctByEventNameInput = CountByEventNameInput & { distinctBy: "tenantId" | "workspaceId" | "anonymousId" };

export type ProductEventRepositoryPort = {
  record(input: RecordProductEventInput): Promise<ProductEvent>;
  /** `true` só na PRIMEIRA vez que este `(workspaceId, eventName)` é marcado — idempotência dos
   * eventos "first_*" (seção 8), nunca um índice único na tabela de alto volume. */
  markFirstOccurrence(input: { tenantId: string; workspaceId: string; eventName: ProductEventName }): Promise<boolean>;
  countByEventName(input: CountByEventNameInput): Promise<number>;
  countDistinctByEventName(input: CountDistinctByEventNameInput): Promise<number>;
};
