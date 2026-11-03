import type { Pool } from "pg";
import type { ProductMutation } from "../../../application/crm/product-use-cases.js";
import { PostgresProductRepository } from "./postgres-product-repository.js";
import { PostgresProductEngineRepository } from "./postgres-product-engine-repository.js";
import { PostgresSalesCatalogRepository } from "./postgres-sales-engine-repositories.js";
import { transactionScopedPool } from "./transaction-scoped-pool.js";

export function productMutation(pool: Pool): ProductMutation {
  return async (scope, work) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`product:${scope.tenantId}:${scope.workspaceId}:${scope.productId ?? "new"}`]);
      // Mesma ordem dos movimentos de estoque: produto antes das combinações.
      if (scope.productId) await client.query("select id from products where id=$1 and tenant_id=$2 and workspace_id=$3 for update", [scope.productId,scope.tenantId,scope.workspaceId]);
      const scoped = transactionScopedPool(client);
      const result = await work({productRepository:new PostgresProductRepository(scoped),productEngineRepository:new PostgresProductEngineRepository(scoped),salesCatalogRepository:new PostgresSalesCatalogRepository(scoped)});
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  };
}
