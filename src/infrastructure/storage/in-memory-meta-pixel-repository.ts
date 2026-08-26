import type { MetaPixel, MetaPixelRepositoryPort, UpsertMetaPixelInput } from "../../application/ports/meta-pixel-repository.port.js";

function buildId(adAccountId: string, pixelId: string): string {
  return `mpx-${adAccountId}-${pixelId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class InMemoryMetaPixelRepository implements MetaPixelRepositoryPort {
  private readonly pixels = new Map<string, MetaPixel>();

  async upsertPixel(input: UpsertMetaPixelInput): Promise<MetaPixel> {
    const id = input.id ?? buildId(input.adAccountId, input.pixelId);
    const now = new Date().toISOString();
    const existing = this.pixels.get(id);
    const record: MetaPixel = { ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now, lastSyncedAt: now };
    this.pixels.set(id, record);
    return record;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; adAccountId?: string }): Promise<MetaPixel[]> {
    return [...this.pixels.values()]
      .filter((pixel) => pixel.tenantId === input.tenantId && pixel.workspaceId === input.workspaceId)
      .filter((pixel) => !input.adAccountId || pixel.adAccountId === input.adAccountId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getById(id: string): Promise<MetaPixel | undefined> {
    return this.pixels.get(id);
  }
}
