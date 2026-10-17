import type { Pool } from "pg";
import type { AdjustStockInput, CreateProductInput, ProductRepositoryPort, UpdateProductInput } from "../../../application/ports/product-repository.port.js";
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
  code: string | null;
  category: string | null;
  item_type: Product["itemType"];
  unit: string | null;
  billing_type: Product["billingType"];
  cost_cents: string | null;
  minimum_price_cents: string | null;
  commission_type: Product["commissionType"] | null;
  commission_value: string | null;
  tax_metadata: Record<string, unknown> | null;
  track_stock: boolean;
  stock_quantity: string;
  stock_alert_threshold: string | null;
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
    code: row.code ?? undefined,
    category: row.category ?? undefined,
    itemType: row.item_type,
    unit: row.unit ?? undefined,
    billingType: row.billing_type,
    costCents: row.cost_cents === null ? undefined : Number(row.cost_cents),
    minimumPriceCents: row.minimum_price_cents === null ? undefined : Number(row.minimum_price_cents),
    commissionType: row.commission_type ?? undefined,
    commissionValue: row.commission_value === null ? undefined : Number(row.commission_value),
    taxMetadata: row.tax_metadata ?? {},
    trackStock: row.track_stock,
    stockQuantity: Number(row.stock_quantity),
    stockAlertThreshold: row.stock_alert_threshold === null ? undefined : Number(row.stock_alert_threshold),
  };
}

export class PostgresProductRepository implements ProductRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateProductInput): Promise<Product> {
    const result = await this.pool.query<ProductRow>(
      `insert into products (id, tenant_id, workspace_id, name, description, price_cents, currency, code, category, item_type, unit, billing_type,
         cost_cents, minimum_price_cents, commission_type, commission_value, tax_metadata, track_stock, stock_quantity, stock_alert_threshold)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) returning *`,
      [
        productId(), input.tenantId, input.workspaceId, input.name, input.description ?? null, input.priceCents, input.currency ?? "BRL",
        input.code ?? null, input.category ?? null, input.itemType ?? "product", input.unit ?? null, input.billingType ?? "one_time",
        input.costCents ?? null, input.minimumPriceCents ?? null, input.commissionType ?? null, input.commissionValue ?? null, JSON.stringify(input.taxMetadata ?? {}),
        input.trackStock ?? false, input.stockQuantity ?? 0, input.stockAlertThreshold ?? null,
      ],
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
      conditions.push(`(name ilike $${params.length} or code ilike $${params.length} or category ilike $${params.length})`);
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
      `update products set name = $2, description = $3, price_cents = $4, currency = $5, active = $6, code = $7, category = $8, item_type = $9,
         unit = $10, billing_type = $11, cost_cents = $12, minimum_price_cents = $13, commission_type = $14, commission_value = $15,
         tax_metadata = $16, track_stock = $17, stock_quantity = $18, stock_alert_threshold = $19, updated_at = now()
       where id = $1 returning *`,
      [
        id,
        input.name ?? existing.name,
        input.description !== undefined ? input.description : existing.description ?? null,
        input.priceCents ?? existing.priceCents,
        input.currency ?? existing.currency,
        input.active ?? existing.active,
        input.code !== undefined ? input.code : existing.code ?? null,
        input.category !== undefined ? input.category : existing.category ?? null,
        input.itemType ?? existing.itemType,
        input.unit !== undefined ? input.unit : existing.unit ?? null,
        input.billingType ?? existing.billingType,
        input.costCents !== undefined ? input.costCents : existing.costCents ?? null,
        input.minimumPriceCents !== undefined ? input.minimumPriceCents : existing.minimumPriceCents ?? null,
        input.commissionType !== undefined ? input.commissionType : existing.commissionType ?? null,
        input.commissionValue !== undefined ? input.commissionValue : existing.commissionValue ?? null,
        JSON.stringify(input.taxMetadata ?? existing.taxMetadata),
        input.trackStock ?? existing.trackStock,
        input.stockQuantity ?? existing.stockQuantity,
        input.stockAlertThreshold !== undefined ? input.stockAlertThreshold : existing.stockAlertThreshold ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from products where id = $1", [id]);
  }

  async netStockByDeal(dealId: string): Promise<{ productId: string; delta: number }[]> {
    const result = await this.pool.query<{ product_id: string; delta: string }>(
      "select product_id, sum(delta) as delta from product_stock_movements where deal_id = $1 group by product_id",
      [dealId],
    );
    return result.rows.map((row) => ({ productId: row.product_id, delta: Number(row.delta) }));
  }

  async adjustStock(input: AdjustStockInput): Promise<Product | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<ProductRow>(
        "update products set stock_quantity = stock_quantity + $2, updated_at = now() where id = $1 and track_stock returning *",
        [input.productId, input.delta],
      );
      const row = result.rows[0];
      if (row) {
        await client.query(
          `insert into product_stock_movements (id, tenant_id, workspace_id, product_id, delta, quantity_after, reason, deal_id, user_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [`stock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, row.tenant_id, row.workspace_id, row.id, input.delta, row.stock_quantity, input.reason, input.dealId ?? null, input.userId ?? null],
        );
      }
      await client.query("commit");
      return row ? toDomain(row) : undefined;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
