import type { Pool } from "pg";
import type { SecretManagerPort } from "../../application/ports/secret-manager.port.js";
import type { MarketplaceProvider } from "../../application/ports/marketplace-provider.port.js";
import type { ContactChannel } from "../../domain/crm/crm.model.js";
import { MarketplaceService } from "../../application/marketplaces/marketplace-service.js";
import { effectivePermissions } from "../../domain/identity/identity.model.js";
import { PostgresTenantMembershipRepository } from "../storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresWorkspaceRepository } from "../storage/postgres/postgres-workspace-repository.js";
import { PostgresProductRepository } from "../storage/postgres/postgres-product-repository.js";
import { PostgresProductEngineRepository } from "../storage/postgres/postgres-product-engine-repository.js";
import { PostgresSalesCatalogRepository } from "../storage/postgres/postgres-sales-engine-repositories.js";
import { PostgresCommerceOrderRepository } from "../storage/postgres/postgres-commerce-order-repository.js";
import { PostgresContactRepository } from "../storage/postgres/postgres-contact-repository.js";
import { PostgresContactIdentityRepository } from "../storage/postgres/postgres-contact-identity-repository.js";
import { PostgresMarketplaceRepository } from "./postgres-marketplace-repository.js";

/** Um serviço para todos os canais configurados; pedidos externos entram no mesmo pedido/estoque do Site. */
export function buildMarketplaceService(pool:Pool,providers:readonly MarketplaceProvider[],secrets:SecretManagerPort){
 const repository=new PostgresMarketplaceRepository(pool),memberships=new PostgresTenantMembershipRepository(pool),workspaces=new PostgresWorkspaceRepository(pool);
 const contactRepository=new PostgresContactRepository(pool),identities=new PostgresContactIdentityRepository(pool);
 const service=new MarketplaceService({repository,secrets,providers:Object.fromEntries(providers.map(p=>[p.id,p])),
  catalog:{productRepository:new PostgresProductRepository(pool),productEngineRepository:new PostgresProductEngineRepository(pool),salesCatalogRepository:new PostgresSalesCatalogRepository(pool)},
  orders:new PostgresCommerceOrderRepository(pool),
  orderDeps:{
   contacts:{
    findByIdentity:async({channel,externalId})=>(await identities.findByChannelAndExternalId(channel as ContactChannel,externalId))?.contactId,
    create:async input=>{
     const contact=await contactRepository.create({tenantId:input.tenantId,workspaceId:input.workspaceId,name:input.name,origin:input.origin});
     await identities.create({contactId:contact.id,tenantId:input.tenantId,workspaceId:input.workspaceId,channel:input.channel as ContactChannel,externalId:input.externalId});
     return contact.id;
    },
   },
   log:(event,data)=>console.warn(JSON.stringify({event,...data})),
  },
  canManageActor:async(actor,permissions=[])=>{
   const member=await memberships.getByUserAndTenant(actor.userId,actor.tenantId),workspace=await workspaces.getById(actor.workspaceId);
   const effective=member?effectivePermissions(member.role,member.permissionGrants,member.permissionRevokes):[];
   return !!member&&member.status!=="disabled"&&workspace?.tenantId===actor.tenantId&&["marketplace:manage",...permissions].every(p=>effective.includes(p as typeof effective[number]));
  }});
 return {service,repository};
}
