import { randomUUID } from "node:crypto";
import type { MetaCapiEventRecord, MetaCapiEventRepositoryPort, RecordMetaCapiEventInput } from "../../application/ports/meta-capi-event-repository.port.js";

export class InMemoryMetaCapiEventRepository implements MetaCapiEventRepositoryPort {
  private readonly events: MetaCapiEventRecord[] = [];

  async record(input: RecordMetaCapiEventInput): Promise<MetaCapiEventRecord> {
    const record: MetaCapiEventRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.events.unshift(record);
    return record;
  }

  async listByPixel(input: { tenantId: string; workspaceId: string; metaPixelId: string; limit?: number }): Promise<MetaCapiEventRecord[]> {
    const filtered = this.events.filter((event) => event.tenantId === input.tenantId && event.workspaceId === input.workspaceId && event.metaPixelId === input.metaPixelId);
    return filtered.slice(0, input.limit ?? 50);
  }
}
