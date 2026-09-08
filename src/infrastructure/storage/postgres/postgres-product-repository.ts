import type { Pool } from "pg";
import type { CreateProductInput, ProductRepositoryPort, UpdateProductInput } from "../../../application/ports/product-repository.port.js";
import type { Product } from "../../../domain/crm/crm.model.js";

const productId = () => `product-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type ProductRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  price_cents: string;
  currency: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: ProductRow): Product {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description ?? undefined,
    priceCents: Number(row.price_cents),
    currency: row.currency,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresProductRepository implements ProductRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateProductInput): Promise<Product> {
    const result = await this.pool.query<ProductRow>(
      `insert into products (id, tenant_id, workspace_id, name, description, price_cents, currency)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [productId(), input.tenantId, input.workspaceId, input.name, input.description ?? null, input.priceCents, input.currency ?? "BRL"],
    );
    return toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Product | undefined> {
    const result = await this.pool.query<ProductRow>("select * from products where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; search?: string; activeOnly?: boolean }): Promise<Product[]> {
    const conditions: string[] = ["tenant_id = $1", "workspace_id = $2"];
    const params: unknown[] = [input.tenantId, input.workspaceId];
    if (input.search) {
      params.push(`%${input.search}%`);
      conditions.push(`name ilike $${params.length}`);
    }
    if (input.activeOnly) conditions.push("active");
    const result = await this.pool.query<ProductRow>(
      `select * from products where ${conditions.join(" and ")} order by name asc`,
      params,
    );
    return result.rows.map(toDomain);
  }

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`PRODUCT_NOT_FOUND: produto "${id}" não existe.`);
    const result = await this.pool.query<ProductRow>(
      `update products set name = $2, description = $3, price_cents = $4, currency = $5, active = $6, updated_at = now()
       where id = $1 returning *`,
      [
        id,
        input.name ?? existing.name,
        input.description !== undefined ? input.description : existing.description ?? null,
        input.priceCents ?? existing.priceCents,
        input.currency ?? existing.currency,
        input.active ?? existing.active,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from products where id = $1", [id]);
  }
}
