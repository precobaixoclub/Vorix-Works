import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Product } from "../../domain/crm/crm.model.js";
import { validateVariantSelection, type ProductDetails } from "../../domain/products/product-details.js";
import type { ProductVariant } from "../../domain/sales/sales.model.js";
import type { ProductEngineRepositoryPort } from "../ports/product-engine-repository.port.js";
import type { SalesCatalogRepositoryPort, UpdateProductVariantInput } from "../ports/sales-engine-repository.port.js";
import { stripObjectUrlSignature } from "../../shared/utils/object-url-signing.js";
import { assertProductPricing } from "../sales/catalog-use-cases.js";

/**
 * Combinações enviadas junto com o produto (cadastro em etapas): a tela monta tudo em memória e um
 * único "Salvar" grava produto, fotos e combinações — sem salvar, reabrir e gerar combinações à parte.
 * `id` identifica uma combinação já existente (renomear um valor preserva vendas e histórico);
 * `priceCents: null` faz a combinação seguir o preço do produto.
 */
export const variantDraftSchema = z.object({
  id: z.string().min(1).max(160).optional(),
  optionValues: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().trim().min(1).max(160)),
  code: z.string().trim().max(60).nullable().optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  costCents: z.number().int().min(0).nullable().optional(),
  minimumPriceCents: z.number().int().min(0).nullable().optional(),
  stockQuantity: z.number().min(0).max(1e9).optional(),
  imageUrl: z.string().max(2000).nullable().optional(),
  active: z.boolean().default(true),
}).strict();
export const variantDraftsSchema = z.array(variantDraftSchema).max(500);
export type VariantDraft = z.infer<typeof variantDraftSchema>;

export type VariantSyncDeps = { salesCatalogRepository: SalesCatalogRepositoryPort; productEngineRepository?: ProductEngineRepositoryPort };
type Access = { canViewCost: boolean; isManager: boolean; canManageInventory: boolean };

const signature = (values: Record<string, string>) => JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
const variantName = (options: ProductDetails["options"], values: Record<string, string>) => options.map((option) => `${option.name}: ${values[option.key]}`).join(" / ");

/** Valida as combinações contra as opções e a galeria que serão gravadas, antes de tocar em qualquer registro. */
export function validateVariantDrafts(drafts: VariantDraft[], details: ProductDetails, imageUrls: readonly string[]): VariantDraft[] {
  const seen = new Set<string>();
  return drafts.map((draft) => {
    validateVariantSelection(details.options, draft.optionValues);
    const key = signature(draft.optionValues);
    if (seen.has(key)) throw Error("PRODUCT_VALIDATION: há combinações repetidas.");
    seen.add(key);
    const imageUrl = draft.imageUrl ? stripObjectUrlSignature(draft.imageUrl) : draft.imageUrl;
    if (imageUrl && !imageUrls.includes(imageUrl)) throw Error("PRODUCT_VALIDATION: use uma foto da galeria do produto.");
    if (draft.priceCents !== undefined && draft.priceCents !== null && draft.minimumPriceCents !== undefined && draft.minimumPriceCents !== null) assertProductPricing({ priceCents: draft.priceCents, minimumPriceCents: draft.minimumPriceCents });
    return { ...draft, imageUrl };
  });
}

/**
 * Antes de gravar o produto: remove as combinações que saíram e renomeia as mantidas. Sem isso as
 * opções novas não validam contra as combinações antigas (era o motivo de precisar apagar e voltar).
 * Combinações sem nenhuma opção (cadastro antigo, preço por nome) nunca são tocadas.
 */
export async function prepareVariantSync(deps: VariantSyncDeps, product: Product, drafts: VariantDraft[]): Promise<VariantDraft[]> {
  const existing = (await deps.salesCatalogRepository.listVariants(product.id)).filter((variant) => Object.keys(variant.optionValues ?? {}).length);
  const byId = new Map(existing.map((variant) => [variant.id, variant]));
  const bySignature = new Map(existing.map((variant) => [signature(variant.optionValues!), variant]));
  const claimed = new Set<string>();
  const resolved = drafts.map((draft) => {
    if (draft.id && !byId.has(draft.id)) throw Error("PRODUCT_VALIDATION: uma combinação não pertence mais a este produto. Recarregue o produto.");
    const match = draft.id ?? bySignature.get(signature(draft.optionValues))?.id;
    if (!match || claimed.has(match)) return { ...draft, id: undefined };
    claimed.add(match);
    return { ...draft, id: match };
  });
  for (const variant of existing.filter((item) => !claimed.has(item.id))) {
    try { await deps.salesCatalogRepository.deleteVariant(variant.id); }
    catch (error) { if (["23503", "23001"].includes(String((error as { code?: string }).code))) throw Error(`PRODUCT_VALIDATION: ${variant.name} já tem histórico de estoque, vendas ou anúncios e não pode ser removida. Mantenha o valor e desative a combinação.`); throw error; }
  }
  // Renomeia em duas passadas: trocar dois valores de lugar não pode colidir no índice único da combinação.
  const renamed = resolved.filter((draft) => draft.id && signature(byId.get(draft.id)!.optionValues!) !== signature(draft.optionValues));
  for (const draft of renamed) await deps.salesCatalogRepository.updateVariant(draft.id!, { optionValues: { sync: `pending-${randomUUID()}` } });
  for (const draft of renamed) await deps.salesCatalogRepository.updateVariant(draft.id!, { optionValues: draft.optionValues });
  return resolved;
}

/** Depois de gravar o produto: cria as combinações novas e aplica SKU, preço, custo, foto, status e estoque. */
export async function applyVariantSync(deps: VariantSyncDeps, product: Product, drafts: VariantDraft[], access: Access, actor: { userId: string }): Promise<ProductVariant[]> {
  const options = product.details?.options ?? [];
  const existing = new Map((await deps.salesCatalogRepository.listVariants(product.id)).map((variant) => [variant.id, variant]));
  const autoCode = (values: Record<string, string>, index: number) => product.code ? `${product.code.slice(0, 25)}-${Object.values(values).join("-").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "").slice(0, 25)}-${index + 1}`.slice(0, 60) : undefined;
  const effectivePrice = (draft: VariantDraft) => draft.priceCents ?? product.priceCents;
  for (const [index, draft] of drafts.entries()) {
    const current = draft.id ? existing.get(draft.id) : undefined;
    const minimum = access.isManager ? draft.minimumPriceCents : undefined;
    assertProductPricing({ priceCents: effectivePrice(draft), minimumPriceCents: minimum === undefined ? current?.minimumPriceCents ?? product.minimumPriceCents : minimum ?? product.minimumPriceCents });
    if (!current) {
      await deps.salesCatalogRepository.createVariant({
        tenantId: product.tenantId, workspaceId: product.workspaceId, productId: product.id,
        name: variantName(options, draft.optionValues), code: draft.code || autoCode(draft.optionValues, index),
        listPriceCents: effectivePrice(draft), priceOverride: draft.priceCents !== undefined && draft.priceCents !== null,
        ...(access.canViewCost && draft.costCents !== undefined && draft.costCents !== null ? { costCents: draft.costCents } : {}),
        ...(minimum !== undefined && minimum !== null ? { minimumPriceCents: minimum } : {}),
        optionValues: draft.optionValues, imageUrl: draft.imageUrl ?? undefined, active: draft.active, position: index,
        stockQuantity: product.trackStock && access.canManageInventory ? draft.stockQuantity ?? 0 : 0,
      });
      continue;
    }
    const patch: UpdateProductVariantInput = { name: variantName(options, draft.optionValues), position: index, active: draft.active };
    if (draft.code !== undefined) patch.code = draft.code || current.code || autoCode(draft.optionValues, index);
    if (draft.priceCents !== undefined) { patch.priceOverride = draft.priceCents !== null; patch.listPriceCents = effectivePrice(draft); }
    if (access.canViewCost && draft.costCents !== undefined) patch.costCents = draft.costCents;
    if (minimum !== undefined) patch.minimumPriceCents = minimum;
    if (draft.imageUrl !== undefined) patch.imageUrl = draft.imageUrl;
    await deps.salesCatalogRepository.updateVariant(current.id, patch);
    // Saldo muda por movimento de ajuste (auditável), nunca por sobrescrita direta.
    if (product.trackStock && draft.stockQuantity !== undefined && draft.stockQuantity !== (current.stockQuantity ?? 0)) {
      if (!access.canManageInventory || !deps.productEngineRepository) throw Error("PRODUCT_VALIDATION: seu perfil não pode ajustar o estoque.");
      await deps.productEngineRepository.move({ tenantId: product.tenantId, workspaceId: product.workspaceId, productId: product.id, variantId: current.id, kind: "ADJUSTMENT", quantity: draft.stockQuantity, operationKey: `variant-sync-${randomUUID()}`, userId: actor.userId });
    }
  }
  return deps.salesCatalogRepository.listVariants(product.id);
}
