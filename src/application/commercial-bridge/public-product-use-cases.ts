import type { ProductRepositoryPort } from "../ports/product-repository.port.js";
import type { SalesCatalogRepositoryPort } from "../ports/sales-engine-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import type { ObjectStoragePort } from "../ports/object-storage.port.js";
import type { ProductShareCodec } from "../../shared/utils/product-share-token.js";
import { classifyObjectKeyOwner, parseOwnedObjectUrl, signOwnedUrl, OBJECT_URL_TTL } from "../../shared/utils/object-url-signing.js";
import type { Product } from "../../domain/crm/crm.model.js";

export function productImageUrl(product: Pick<Product, "tenantId" | "workspaceId">, url: string | undefined, storage?: ObjectStoragePort): string | undefined {
  if (!url) return undefined;
  const key = parseOwnedObjectUrl(url, storage?.resolvePublicUrl(""))?.key;
  if (!key) return undefined;
  const owner = classifyObjectKeyOwner(key);
  if (owner?.kind !== "workspace" || owner.tenantId !== product.tenantId || owner.workspaceId !== product.workspaceId) return undefined;
  return signOwnedUrl(url, OBJECT_URL_TTL.preview);
}

export type PublicProductDeps = {
  productRepository: ProductRepositoryPort;
  salesCatalogRepository: SalesCatalogRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
  shareLinks?: ProductShareCodec;
  objectStorage?: ObjectStoragePort;
};
export async function getSharedProduct(deps: PublicProductDeps, token: string) {
  const identity = deps.shareLinks?.read(token);
  const missing = () => new Error("PUBLIC_PRODUCT_NOT_FOUND");
  if (!identity) throw missing();
  const product = await deps.productRepository.getById(identity.productId);
  if (!product?.active || product.tenantId !== identity.tenantId || product.workspaceId !== identity.workspaceId) throw missing();
  const workspace = await deps.workspaceRepository.getById(identity.workspaceId);
  if (!workspace || workspace.tenantId !== identity.tenantId || workspace.status === "archived") throw missing();
  const variants = (await deps.salesCatalogRepository.listVariants(product.id)).filter(v => v.active && v.tenantId === identity.tenantId && v.workspaceId === identity.workspaceId);
  const selected = identity.variantId ? variants.find(v => v.id === identity.variantId) : undefined;
  if (identity.variantId && !selected) throw missing();
  const images = [...new Set([selected?.imageUrl, ...product.imageUrls, ...variants.map(v => v.imageUrl)].map(url => productImageUrl(product, url, deps.objectStorage)).filter((url): url is string => !!url))];
  // Lista fechada: custo, margem, estoque interno, impostos e identidades nunca são expostos.
  return {
    name: product.name, description: product.description ?? "", sku: selected?.code ?? product.code,
    priceCents: selected && selected.priceOverride !== false ? selected.listPriceCents : product.priceCents,
    currency: product.currency, issuerName: workspace.name, images,
    selectedVariant: selected?.name,
    variants: variants.map(v => ({ label: v.name, priceCents: v.priceOverride === false ? product.priceCents : v.listPriceCents })),
  };
}
