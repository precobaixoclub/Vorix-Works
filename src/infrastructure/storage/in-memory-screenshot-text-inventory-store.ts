import type { ScreenshotTextInventoryStorePort } from "../../application/ports/screenshot-text-inventory-store.port.js";
import type { AssetTextInventoryKind, ScreenshotTextInventory } from "../../application/creative-engine/screenshot-text-inventory.js";

export class InMemoryScreenshotTextInventoryStore implements ScreenshotTextInventoryStorePort {
  private readonly byKey = new Map<string, ScreenshotTextInventory>();

  private static key(input: { tenantId: string; workspaceId: string; assetSha256: string; version: number; kind?: AssetTextInventoryKind }): string {
    return `${input.tenantId}|${input.workspaceId}|${input.assetSha256}|${input.version}|${input.kind ?? "screenshot"}`;
  }

  async get(key: { tenantId: string; workspaceId: string; assetSha256: string; version: number; kind?: AssetTextInventoryKind }): Promise<ScreenshotTextInventory | undefined> {
    return this.byKey.get(InMemoryScreenshotTextInventoryStore.key(key));
  }

  async save(inventory: ScreenshotTextInventory): Promise<void> {
    const key = InMemoryScreenshotTextInventoryStore.key({ ...inventory, kind: inventory.source === "VERIFIED_LOGO" ? "logo" : "screenshot" });
    if (!this.byKey.has(key)) this.byKey.set(key, { ...inventory });
  }
}
