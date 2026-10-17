import type { Product } from "../../domain/crm/crm.model.js";

export type CreateProductInput = {
  tenantId: string;
  workspaceId: string;
  name: string;
  description?: string;
  priceCents: number;
  currency?: string;
  code?: string | null;
  category?: string | null;
  itemType?: Product["itemType"];
  unit?: string | null;
  billingType?: Product["billingType"];
  costCents?: number | null;
  minimumPriceCents?: number | null;
  commissionType?: Product["commissionType"] | null;
  commissionValue?: number | null;
  taxMetadata?: Record<string, unknown>;
  trackStock?: boolean;
  stockQuantity?: number;
  stockAlertThreshold?: number | null;
  imageUrls?: string[];
};

export type UpdateProductInput = Partial<Omit<CreateProductInput, "tenantId" | "workspaceId">> & { active?: boolean };

export type StockMovementReason = "manual" | "deal_won" | "deal_reverted";
export type AdjustStockInput = { productId: string; delta: number; reason: StockMovementReason; dealId?: string; userId?: string };

export type ProductRepositoryPort = {
  create(input: CreateProductInput): Promise<Product>;
  getById(id: string): Promise<Product | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; search?: string; activeOnly?: boolean }): Promise<Product[]>;
  update(id: string, input: UpdateProductInput): Promise<Product>;
  delete(id: string): Promise<void>;
  /** Soma `delta` ao estoque de forma atômica e registra o movimento; devolve o produto atualizado
   * (`undefined` se o produto não existir ou não controlar estoque). */
  adjustStock(input: AdjustStockInput): Promise<Product | undefined>;
  /** Saldo líquido de movimentos por produto causados por uma oportunidade (negativo = baixa feita). */
  netStockByDeal(dealId: string): Promise<{ productId: string; delta: number }[]>;
  /** Quantidade pedida em oportunidades ABERTAS, por oportunidade e produto com controle de estoque. */
  listOpenStockDemand(input: { tenantId: string; workspaceId: string }): Promise<{ dealId: string; productId: string; quantity: number }[]>;
};
