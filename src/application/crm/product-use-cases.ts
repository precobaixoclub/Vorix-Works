import type { CreateProductInput, ProductRepositoryPort, UpdateProductInput } from "../ports/product-repository.port.js";
import type { Product } from "../../domain/crm/crm.model.js";
import { validateProductExtension } from "../products/product-engine-use-cases.js";

export type ProductUseCaseDeps = {
  productEngineRepository?: import("../ports/product-engine-repository.port.js").ProductEngineRepositoryPort;
  salesCatalogRepository?: import("../ports/sales-engine-repository.port.js").SalesCatalogRepositoryPort;
  productRepository: ProductRepositoryPort;
};

/** Guard de tenant/workspace — nunca 403, sempre 404. */
export async function mustProductBelongToTenantAndWorkspace(deps: ProductUseCaseDeps, productId: string, tenantId: string, workspaceId: string): Promise<Product> {
  const product = await deps.productRepository.getById(productId);
  if (!product || product.tenantId !== tenantId || product.workspaceId !== workspaceId) {
    throw new Error(`PRODUCT_NOT_FOUND: produto "${productId}" não existe.`);
  }
  return product;
}

export async function createProduct(deps: ProductUseCaseDeps, input: CreateProductInput): Promise<Product> {
  await validateProductExtension(deps,input,input);
  return deps.productRepository.create(input);
}

export async function listProducts(deps: ProductUseCaseDeps, input: { tenantId: string; workspaceId: string; search?: string; activeOnly?: boolean }): Promise<Product[]> {
  return deps.productRepository.listByWorkspace(input);
}

export async function getProduct(deps: ProductUseCaseDeps, input: { productId: string; tenantId: string; workspaceId: string }): Promise<Product> {
  return mustProductBelongToTenantAndWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
}

export async function updateProduct(deps: ProductUseCaseDeps, input: { productId: string; tenantId: string; workspaceId: string; patch: UpdateProductInput }): Promise<Product> {
  const existing=await mustProductBelongToTenantAndWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  await validateProductExtension(deps,input.patch,input,existing);
  return deps.productRepository.update(input.productId, input.patch);
}

export async function deleteProduct(deps: ProductUseCaseDeps, input: { productId: string; tenantId: string; workspaceId: string }): Promise<void> {
  await mustProductBelongToTenantAndWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  try {
    await deps.productRepository.delete(input.productId);
  } catch (error) {
    // ON DELETE RESTRICT (anúncio de marketplace vinculado) é 23001; FK comum é 23503 — nunca vaza erro cru do Postgres.
    if (["23503", "23001"].includes(String((error as { code?: string }).code))) throw new Error("PRODUCT_VALIDATION: este produto está vinculado a anúncios de marketplace ou a registros. Desative-o para preservar o histórico.");
    throw error;
  }
}
