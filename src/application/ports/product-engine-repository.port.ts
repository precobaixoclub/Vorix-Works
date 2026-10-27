import type { AttributeDefinition, ProductBrand, ProductCategory } from "../../domain/products/product-details.js";
export type ProductScope = { tenantId: string; workspaceId: string };
export type ProductMetadata = { categories: ProductCategory[]; brands: ProductBrand[]; attributes: AttributeDefinition[] };
export type ProductEngineRepositoryPort = {
  metadata(scope: ProductScope): Promise<ProductMetadata>;
  saveCategory(input: ProductCategory): Promise<ProductCategory>;
  saveBrand(input: ProductBrand): Promise<ProductBrand>;
  saveAttribute(input: AttributeDefinition): Promise<AttributeDefinition>;
  movements(input: ProductScope & { productId: string; variantId?: string }): Promise<Record<string, unknown>[]>;
  move(input: ProductScope & { productId: string; variantId?: string; kind: "IN" | "OUT" | "ADJUSTMENT" | "RESERVATION" | "RELEASE" | "SALE" | "RETURN"; quantity: number; operationKey: string; userId: string; /** SALE que consome uma reserva na MESMA transação (checkout pago): baixa saldo e reservado juntos. */ consumeReservation?: boolean }): Promise<{ quantity: number; reserved: number; replay: boolean }>;
};
