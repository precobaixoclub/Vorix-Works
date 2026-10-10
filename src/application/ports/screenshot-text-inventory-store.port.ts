import type { ScreenshotTextInventory } from "../creative-engine/screenshot-text-inventory.js";

/**
 * Cache persistente do inventário de texto de um screenshot verificado
 * (`db/migrations/0139_screenshot_text_inventories.sql`). A chave é SEMPRE tenant + workspace +
 * hash dos bytes do asset + versão do inventário: o mesmo screenshot em outro workspace nunca
 * reaproveita o inventário (isolamento), e um screenshot alterado tem outro hash. Só inventários
 * AVAILABLE são gravados — falha de leitura nunca vira cache.
 */
export type ScreenshotTextInventoryStorePort = {
  get(key: { tenantId: string; workspaceId: string; assetSha256: string; version: number }): Promise<ScreenshotTextInventory | undefined>;
  save(inventory: ScreenshotTextInventory): Promise<void>;
};
