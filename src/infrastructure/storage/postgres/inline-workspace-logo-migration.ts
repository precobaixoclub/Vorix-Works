import sharp from "sharp";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ObjectStoragePort } from "../../../application/ports/object-storage.port.js";

/** Logos are shown at most ~200px wide; 512px covers high-density screens. */
export const WORKSPACE_LOGO_MAX_PX = 512;

/** Normalizes any supported image into a compact WEBP (keeps transparency). */
export async function optimizeWorkspaceLogo(body: Buffer): Promise<Buffer> {
  return sharp(body, { limitInputPixels: 32_000_000 }).rotate().resize({ width: WORKSPACE_LOGO_MAX_PX, height: WORKSPACE_LOGO_MAX_PX, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
}

export function workspaceLogoKey(tenantId: string, workspaceId: string): string {
  return `assets/${tenantId}/${workspaceId}/logo-${randomUUID()}.webp`;
}

/**
 * Older clients saved the workspace logo inline (base64 `data:` URL, up to 1 MB) inside
 * `workspaces.settings`. Every workspace read then pulled the image out of TOAST — tens of GB a week
 * of Postgres reads for two workspaces. This moves each inline logo to object storage once and keeps
 * only its URL. Idempotent and compare-and-set: a logo changed meanwhile is left untouched.
 */
export async function migrateInlineWorkspaceLogos(pool: Pool, storage: ObjectStoragePort, log: (message: string, details?: Record<string, unknown>) => void = () => undefined): Promise<number> {
  const { rows } = await pool.query<{ id: string; tenant_id: string; logo: string }>(
    "select id, tenant_id, settings->>'logoUrl' as logo from workspaces where left(settings->>'logoUrl', 5) = 'data:'",
  );
  let migrated = 0;
  for (const row of rows) {
    try {
      const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(row.logo);
      if (!match) throw Error("unsupported inline logo");
      const body = await optimizeWorkspaceLogo(Buffer.from(match[1]!, "base64"));
      const { url } = await storage.put({ key: workspaceLogoKey(row.tenant_id, row.id), body, contentType: "image/webp" });
      const updated = await pool.query(
        "update workspaces set settings = jsonb_set(settings, '{logoUrl}', to_jsonb($2::text)), updated_at = now() where id = $1 and settings->>'logoUrl' = $3",
        [row.id, url, row.logo],
      );
      if (updated.rowCount) migrated += 1;
    } catch (error) {
      log("logo inline do workspace não migrado", { workspaceId: row.id, error: error instanceof Error ? error.message.slice(0, 120) : "erro" });
    }
  }
  if (migrated) log("logos inline de workspace movidos para o storage", { migrated });
  return migrated;
}
