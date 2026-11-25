import type pg from "pg";
import { createHash } from "node:crypto";
import type { BusinessKind, ReferenceCandidate } from "../../../application/creative-engine/reference-roles.js";
import { inferBusinessKind, type SoftwareFeature } from "../../../application/creative-engine/visual-intent.js";
import { stripObjectUrlSignature } from "../../../shared/utils/object-url-signing.js";

/**
 * Contexto criativo de uma pauta, só por METADADOS (sem baixar imagens): de onde vem cada material
 * anexado (catálogo → produto/variante; Biblioteca → tipo cadastrado; envio solto), quais capturas
 * reais de software a marca tem, e o tipo de negócio. Alimenta a prévia "como a arte será
 * produzida" do Bolsão — a mesma decisão que o motor toma na geração.
 *
 * Configuração opcional por workspace, sem migração: `workspaces.settings.creativeEngine`
 * = { businessKind?, softwareFeatures? }. Sem ela, o tipo de negócio é inferido (catálogo físico,
 * capturas de software, notas da identidade).
 */

export type EditorialCreativeContext = {
  businessKind: BusinessKind;
  softwareFeatures?: SoftwareFeature[];
  ideaReferences: ReferenceCandidate[];
  libraryCaptures: ReferenceCandidate[];
  /** URL exibível de cada referência (para miniatura), por id. */
  urls: Record<string, string>;
};

const keyOf = (url: string) => {
  try {
    return decodeURIComponent(new URL(stripObjectUrlSignature(url)).pathname.replace(/^\/uploads\//, ""));
  } catch {
    return url;
  }
};
const variantName = (color: string | null | undefined) => String(color ?? "").replace(/\s*-\s*Logo.*$/i, "").trim();

export async function loadEditorialCreativeContext(pool: pg.Pool, input: { tenantId: string; workspaceId: string; referenceImages: readonly string[] }): Promise<EditorialCreativeContext> {
  const { tenantId, workspaceId } = input;
  const [workspace, brand, catalogCount, variants, assets] = await Promise.all([
    pool.query<{ settings: Record<string, unknown> | null }>("select settings from workspaces where id=$1 and tenant_id=$2", [workspaceId, tenantId]),
    pool.query<{ notes: string | null }>("select profile->'identity'->>'notes' as notes from brand_visual_profiles where workspace_id=$1", [workspaceId]).catch(() => ({ rows: [] as Array<{ notes: string | null }> })),
    pool.query<{ total: number }>("select count(*)::int as total from products where tenant_id=$1 and workspace_id=$2 and active", [tenantId, workspaceId]).catch(() => ({ rows: [{ total: 0 }] })),
    input.referenceImages.length
      ? pool.query<{ code: string; color: string | null; url: string }>(`select p.code, v.option_values->>'color' as color, v.image_url as url from products p
          join product_variants v on v.product_id=p.id and v.workspace_id=p.workspace_id and v.tenant_id=p.tenant_id
          where p.tenant_id=$1 and p.workspace_id=$2 and v.image_url = any($3::text[])`, [tenantId, workspaceId, input.referenceImages.map(stripObjectUrlSignature)]).catch(() => ({ rows: [] as Array<{ code: string; color: string | null; url: string }> }))
      : Promise.resolve({ rows: [] as Array<{ code: string; color: string | null; url: string }> }),
    pool.query<{ id: string; name: string; tags: string[]; material_type: string | null; ai_instructions: string | null; key: string | null }>(`select a.id, a.name, a.tags, a.material_type, a.ai_instructions, a.storage_ref->>'objectKey' as key
      from assets a join asset_libraries l on l.id=a.library_id where l.workspace_id=$1 and a.status='active'`, [workspaceId]).catch(() => ({ rows: [] as Array<{ id: string; name: string; tags: string[]; material_type: string | null; ai_instructions: string | null; key: string | null }> })),
  ]);
  const config = (workspace.rows[0]?.settings?.creativeEngine ?? {}) as { businessKind?: BusinessKind; softwareFeatures?: SoftwareFeature[] };
  const captureRows = assets.rows.filter((row) => row.material_type === "screenshot_app" || row.material_type === "screenshot_site");
  const businessKind = inferBusinessKind({ explicit: config.businessKind, physicalCatalogCount: catalogCount.rows[0]?.total ?? 0, softwareCaptureCount: captureRows.filter((row) => row.material_type === "screenshot_app").length, brandNotes: brand.rows[0]?.notes ?? undefined });
  const byCatalogUrl = new Map(variants.rows.map((row) => [stripObjectUrlSignature(row.url), row]));
  const byAssetKey = new Map(assets.rows.filter((row) => row.key).map((row) => [row.key!, row]));
  const urls: Record<string, string> = {};
  const ideaReferences: ReferenceCandidate[] = [];
  for (const url of input.referenceImages) {
    const catalog = byCatalogUrl.get(stripObjectUrlSignature(url));
    const asset = byAssetKey.get(keyOf(url));
    const id = catalog ? `produto:${catalog.code}:${variantName(catalog.color)}` : asset ? asset.id : `pauta:${createHash("sha256").update(stripObjectUrlSignature(url)).digest("hex").slice(0, 12)}`;
    urls[id] = url;
    if (catalog) {
      ideaReferences.push({ id, source: "catalog", productCode: catalog.code, variantLabel: variantName(catalog.color), ...(ideaReferences.some((item) => item.productCode === catalog.code) ? { explicitRole: "product_variant" as const } : {}) });
    } else if (asset) {
      ideaReferences.push({ id, source: "brand_library", materialType: asset.material_type ?? undefined, name: asset.name, tags: asset.tags, notes: asset.ai_instructions ?? undefined });
    } else {
      ideaReferences.push({ id, source: "idea_upload" });
    }
  }
  const libraryCaptures: ReferenceCandidate[] = captureRows.map((row) => ({
    id: row.id, source: "brand_library", materialType: row.material_type ?? undefined, name: row.name, tags: row.tags, notes: row.ai_instructions ?? undefined,
    form: row.tags.includes("form:mobile") ? "mobile" : "desktop",
  }));
  return { businessKind, ...(config.softwareFeatures?.length ? { softwareFeatures: config.softwareFeatures } : {}), ideaReferences, libraryCaptures, urls };
}
