import {PostgresWorkspaceRepository} from "../../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import {PostgresProductRepository} from "../../dist/infrastructure/storage/postgres/postgres-product-repository.js";
import {PostgresProductEngineRepository} from "../../dist/infrastructure/storage/postgres/postgres-product-engine-repository.js";
import {PostgresSiteRepository} from "../../dist/infrastructure/storage/postgres/postgres-site-repository.js";
import {PostgresPipelineRepository,PostgresPipelineStageRepository} from "../../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import {PostgresDealRepository} from "../../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import {PostgresTimelineEventRepository} from "../../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import {PostgresSalesCatalogRepository,PostgresDealItemRepository,PostgresSalesConfigRepository,PostgresCommercialApprovalRepository} from "../../dist/infrastructure/storage/postgres/postgres-sales-engine-repositories.js";
import {PostgresContactRepository} from "../../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import {PostgresTaskRepository} from "../../dist/infrastructure/storage/postgres/postgres-task-repository.js";
import {PostgresTeamMembershipRepository} from "../../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import {PostgresProposalRepository} from "../../dist/infrastructure/storage/postgres/postgres-proposal-repository.js";
import {PostgresProposalTemplateRepository} from "../../dist/infrastructure/storage/postgres/postgres-proposal-template-repository.js";
import {ensureDefaultPipeline} from "../../dist/application/crm/pipeline-use-cases.js";
import {createDeal} from "../../dist/application/crm/deal-use-cases.js";
import {createProduct} from "../../dist/application/crm/product-use-cases.js";
import {defaultProductDetails} from "../../dist/domain/products/product-details.js";
import {randomUUID} from "node:crypto";

export async function productSiteContext(pool){
 const tenantId="tenant-fixture-"+randomUUID();
 const workspaceRepository=new PostgresWorkspaceRepository(pool);
 const workspace=await workspaceRepository.create({tenantId,name:"Empresa de fixture"});
 const scope={tenantId,workspaceId:workspace.id};const actor={tenantId,userId:"fixture-owner-"+randomUUID(),role:"owner"};
 const d={
  productRepository:new PostgresProductRepository(pool),productEngineRepository:new PostgresProductEngineRepository(pool),
  salesCatalogRepository:new PostgresSalesCatalogRepository(pool),dealItemRepository:new PostgresDealItemRepository(pool),
  dealRepository:new PostgresDealRepository(pool),pipelineRepository:new PostgresPipelineRepository(pool),pipelineStageRepository:new PostgresPipelineStageRepository(pool),
  timelineEventRepository:new PostgresTimelineEventRepository(pool),salesConfigRepository:new PostgresSalesConfigRepository(pool),approvalRepository:new PostgresCommercialApprovalRepository(pool),
  contactRepository:new PostgresContactRepository(pool),taskRepository:new PostgresTaskRepository(pool),teamMembershipRepository:new PostgresTeamMembershipRepository(pool),
  proposalRepository:new PostgresProposalRepository(pool),proposalTemplateRepository:new PostgresProposalTemplateRepository(pool),
  membershipRepository:{getByUserAndTenant:async(userId,tenant)=>tenant===tenantId?{id:"fixture-member",userId,tenantId,role:"owner"}:undefined,listByTenant:async()=>[],listByUser:async()=>[]},
 };
 const {pipeline,stages}=await ensureDefaultPipeline(d,tenantId,workspace.id);
 d.proposal={proposalRepository:d.proposalRepository,timelineEventRepository:d.timelineEventRepository,contactRepository:d.contactRepository,dealRepository:d.dealRepository};
 const deal=()=>createDeal(d,{...scope,title:"Oportunidade de fixture",pipelineId:pipeline.id,stageId:stages.find(stage=>!stage.isWon&&!stage.isLost).id,valueCents:0,currency:"BRL",ownerUserId:actor.userId});
 const product=(input={})=>createProduct(d,{...scope,name:"Produto de fixture",priceCents:10000,costCents:4000,minimumPriceCents:8000,details:defaultProductDetails(),...input});
 const allowed=new Set([tenantId]);
 const siteDeps={repository:new PostgresSiteRepository(pool),productRepository:d.productRepository,productEngineRepository:d.productEngineRepository,salesCatalogRepository:d.salesCatalogRepository,hasAccess:async tenant=>allowed.has(tenant),canPublish:async()=>true,resolveTxt:async()=>[]};
 return {...scope,scope,workspace,workspaceRepository,actor,d,deal,product,allowed,siteDeps};
}
