import type { Pool } from "pg";
import type { SecretManagerPort } from "../../application/ports/secret-manager.port.js";
import { MarketplaceService } from "../../application/marketplaces/marketplace-service.js";
import { effectivePermissions } from "../../domain/identity/identity.model.js";
import { PostgresTenantMembershipRepository } from "../storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresWorkspaceRepository } from "../storage/postgres/postgres-workspace-repository.js";
import { PostgresProductRepository } from "../storage/postgres/postgres-product-repository.js";
import { PostgresProductEngineRepository } from "../storage/postgres/postgres-product-engine-repository.js";
import { PostgresSalesCatalogRepository } from "../storage/postgres/postgres-sales-engine-repositories.js";
import { MercadoLivreProvider,type MercadoLivreConfig } from "./mercado-livre-provider.js";
import { PostgresMarketplaceRepository } from "./postgres-marketplace-repository.js";
export function buildMarketplaceService(pool:Pool,config:MercadoLivreConfig,secrets:SecretManagerPort){
 const repository=new PostgresMarketplaceRepository(pool),memberships=new PostgresTenantMembershipRepository(pool),workspaces=new PostgresWorkspaceRepository(pool);
 const service=new MarketplaceService({repository,secrets,provider:new MercadoLivreProvider(config),applicationId:config.clientId,
  catalog:{productRepository:new PostgresProductRepository(pool),productEngineRepository:new PostgresProductEngineRepository(pool),salesCatalogRepository:new PostgresSalesCatalogRepository(pool)},
  canManageActor:async(actor,permissions=[])=>{
   const member=await memberships.getByUserAndTenant(actor.userId,actor.tenantId),workspace=await workspaces.getById(actor.workspaceId);
   const effective=member?effectivePermissions(member.role,member.permissionGrants,member.permissionRevokes):[];
   return !!member&&member.status!=="disabled"&&workspace?.tenantId===actor.tenantId&&["marketplace:manage",...permissions].every(p=>effective.includes(p as typeof effective[number]));
  }});
 return {service,repository};
}
