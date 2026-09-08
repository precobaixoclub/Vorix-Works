import type { Product } from "../../domain/crm/crm.model.js";

export type CreateProductInput = {
  tenantId: string;
  workspaceId: string;
  name: string;
  description?: string;
  priceCents: number;
  currency?: string;
};

export type UpdateProductInput = Partial<Omit<CreateProductInput, "tenantId" | "workspaceId">> & { active?: boolean };

export type ProductRepositoryPort = {
  create(input: CreateProductInput): Promise<Product>;
  getById(id: string): Promise<Product | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; search?: string; activeOnly?: boolean }): Promise<Product[]>;
  update(id: string, input: UpdateProductInput): Promise<Product>;
  delete(id: string): Promise<void>;
};
