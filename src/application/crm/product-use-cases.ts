import type { CreateProductInput, ProductRepositoryPort, UpdateProductInput } from "../ports/product-repository.port.js";
import type { Product } from "../../domain/crm/crm.model.js";

export type ProductUseCaseDeps = {
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
  return deps.productRepository.create(input);
}

export async function listProducts(deps: ProductUseCaseDeps, input: { tenantId: string; workspaceId: string; search?: string; activeOnly?: boolean }): Promise<Product[]> {
  return deps.productRepository.listByWorkspace(input);
}

export async function getProduct(deps: ProductUseCaseDeps, input: { productId: string; tenantId: string; workspaceId: string }): Promise<Product> {
  return mustProductBelongToTenantAndWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
}

export async function updateProduct(deps: ProductUseCaseDeps, input: { productId: string; tenantId: string; workspaceId: string; patch: UpdateProductInput }): Promise<Product> {
  await mustProductBelongToTenantAndWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  return deps.productRepository.update(input.productId, input.patch);
}

export async function deleteProduct(deps: ProductUseCaseDeps, input: { productId: string; tenantId: string; workspaceId: string }): Promise<void> {
  await mustProductBelongToTenantAndWorkspace(deps, input.productId, input.tenantId, input.workspaceId);
  await deps.productRepository.delete(input.productId);
}
