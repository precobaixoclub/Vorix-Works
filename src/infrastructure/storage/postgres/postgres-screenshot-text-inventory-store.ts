import type { Pool } from "pg";
import type { ScreenshotTextInventoryStorePort } from "../../../application/ports/screenshot-text-inventory-store.port.js";
import type { ScreenshotTextInventory, ScreenshotTextInventoryEntry } from "../../../application/creative-engine/screenshot-text-inventory.js";

type ScreenshotTextInventoryRow = {
  tenant_id: string;
  workspace_id: string;
  asset_sha256: string;
  inventory_version: number;
  inventory_source: ScreenshotTextInventory["inventorySource"];
  status: ScreenshotTextInventory["status"];
  texts: ScreenshotTextInventoryEntry[];
  provider: string | null;
  model: string | null;
  first_asset_url: string;
  scanned_at: Date;
};

/** Adapter Postgres de `ScreenshotTextInventoryStorePort` — `db/migrations/0139_screenshot_text_inventories.sql`.
 * Toda leitura filtra por tenant E workspace: a chave nunca é só o hash. */
export class PostgresScreenshotTextInventoryStore implements ScreenshotTextInventoryStorePort {
  constructor(private readonly pool: Pool) {}

  async get(key: { tenantId: string; workspaceId: string; assetSha256: string; version: number }): Promise<ScreenshotTextInventory | undefined> {
    const result = await this.pool.query<ScreenshotTextInventoryRow>(
      "select * from screenshot_text_inventories where tenant_id = $1 and workspace_id = $2 and asset_sha256 = $3 and inventory_version = $4",
      [key.tenantId, key.workspaceId, key.assetSha256, key.version],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      source: "VERIFIED_SCREENSHOT",
      inventorySource: row.inventory_source,
      status: row.status,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      assetUrl: row.first_asset_url,
      assetSha256: row.asset_sha256,
      version: row.inventory_version,
      ...(row.provider ? { provider: row.provider } : {}),
      ...(row.model ? { model: row.model } : {}),
      scannedAt: row.scanned_at.toISOString(),
      texts: row.texts,
    };
  }

  async save(inventory: ScreenshotTextInventory): Promise<void> {
    await this.pool.query(
      `insert into screenshot_text_inventories (id, tenant_id, workspace_id, asset_sha256, inventory_version, inventory_source, status, texts, provider, model, first_asset_url, scanned_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
       on conflict (tenant_id, workspace_id, asset_sha256, inventory_version) do nothing`,
      [
        `screenshot-inventory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        inventory.tenantId,
        inventory.workspaceId,
        inventory.assetSha256,
        inventory.version,
        inventory.inventorySource,
        inventory.status,
        JSON.stringify(inventory.texts),
        inventory.provider ?? null,
        inventory.model ?? null,
        inventory.assetUrl,
        inventory.scannedAt,
      ],
    );
  }
}
