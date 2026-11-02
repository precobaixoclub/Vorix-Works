import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {startTestPostgres} from './helpers/pglite-test-db.mjs';
import {productSiteContext} from './helpers/product-site-context.mjs';
import {applyMigrations} from '../dist/infrastructure/storage/postgres/migration-runner.js';
import {acceptPublicProposal,sendProposal,applyProposalAcceptanceToDeal} from '../dist/application/crm/proposal-use-cases.js';
import {createProposalFromDeal,invoiceAcceptedProposal,proposalAcceptanceHandler} from '../dist/application/sales/proposal-sales-use-cases.js';
import {addDealItem,reopenDeal,loseDeal,winDeal} from '../dist/application/sales/deal-commercial-use-cases.js';
import {moveDealStage} from '../dist/application/crm/deal-use-cases.js';
import {contactLabel,humanContactName} from '../dist/domain/crm/contact-presentation.js';
import {registerSalesEngineRoutes} from '../dist/interfaces/api/routes/v1/sales-engine.route.js';
import {registerErrorHandler} from '../dist/interfaces/api/http/error-handler.js';
import Fastify from 'fastify';
import {PostgresNotificationRepository} from '../dist/infrastructure/storage/postgres/postgres-notification-repository.js';
import {PostgresCommerceOrderRepository} from '../dist/infrastructure/storage/postgres/postgres-commerce-order-repository.js';
import {registerPublicProposalsRoutes} from '../dist/interfaces/api/routes/v1/public-proposals.route.js';
let db;
before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),'db/migrations'));});
after(async()=>{await db?.stop();});
async function setup(){
 const c=await productSiteContext(db.pool),contact=await c.d.contactRepository.create({...c.scope,name:'Lead 123',customFields:{phone:'+5546999999999'}});
 const deal=await c.deal();await c.d.dealRepository.update(deal.id,{contactId:contact.id});
 const product=await c.product({trackStock:true,stockQuantity:10});
 await addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,productId:product.id,quantity:2});
 const {proposal,rawToken}=await createProposalFromDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id});
 await sendProposal(c.d.proposal,{...c.scope,proposalId:proposal.id});
 const accept=()=>acceptPublicProposal(c.d.proposal,rawToken);
 const invoice=()=>invoiceAcceptedProposal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,proposalId:proposal.id});
 return {...c,contact,deal,product,proposal,rawToken,accept,invoice};
}

test('12 etapas: aceite pendente, faturamento único com usuário/data, ganho, reabertura e perda mantêm histórico e estoque',async()=>{
 const c=await setup(),recorded=[],first=new Set();
 c.d.productAnalytics={enabled:true,productEventRepository:{markFirstOccurrence:async input=>{if(first.has(input.eventName))return false;first.add(input.eventName);return true;},record:async input=>{recorded.push(input);return input;}}};
 c.d.proposal.productAnalytics=c.d.productAnalytics;
 const accepted=await c.accept();assert.equal(accepted.status,'accepted');assert.equal(recorded.filter(e=>e.eventName==='first_deal_won').length,0);
 await applyProposalAcceptanceToDeal({...c.d,acceptanceHandler:proposalAcceptanceHandler(c.d)},accepted);
 let deal=await c.d.dealRepository.getById(c.deal.id);
 assert.equal(deal.status,'open');assert.equal(deal.billingProposalId,c.proposal.id);assert.equal(deal.wonAt,undefined);
 assert.equal((await c.d.pipelineStageRepository.getById(deal.stageId)).isAwaitingBilling,true);
 assert.equal((await c.d.productRepository.getById(c.product.id)).stockQuantity,10);
 await assert.rejects(winDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id}),/PROPOSAL_BILLING_INVALID/);
 await assert.rejects(moveDealStage({...c.d,sales:c.d},{...c.scope,dealId:deal.id,targetStageId:c.deal.stageId}),/PROPOSAL_BILLING_INVALID/);
 await assert.rejects(c.d.dealRepository.moveStage(deal.id,{stageId:c.deal.stageId}),/PROPOSAL_BILLING_INVALID/);
 await assert.rejects(db.pool.query("update deals set status='won',closure_source='proposal_acceptance' where id=$1",[deal.id]),/PROPOSAL_BILLING_INVALID/);
 const results=await Promise.all([c.invoice(),c.invoice()]);assert.ok(results.every(d=>d.status==='won'));
 assert.equal(recorded.filter(e=>e.eventName==='first_deal_won').length,1);
 const billed=await c.d.proposalRepository.getById(c.proposal.id);deal=await c.d.dealRepository.getById(deal.id);
 assert.equal(billed.status,'invoiced');assert.equal(billed.billedByUserId,c.actor.userId);assert.equal(billed.billedAt,deal.closedAt);assert.equal(deal.wonAt,billed.billedAt);
 assert.equal((await c.d.productRepository.getById(c.product.id)).stockQuantity,8);
 await c.invoice();assert.equal((await c.d.productRepository.getById(c.product.id)).stockQuantity,8);
 let events=await c.d.timelineEventRepository.listByEntity({entityType:'deal',entityId:deal.id});assert.equal(events.filter(e=>e.eventType==='deal_won').length,1);
 const firstClosed=deal.firstClosedAt;
 const target=(await c.d.pipelineStageRepository.listByPipeline(deal.pipelineId)).find(s=>s.name==='Negociação');
 const reopened=await reopenDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,targetStageId:target.id});
 assert.equal(reopened.status,'open');assert.equal(reopened.stageId,target.id);assert.equal(reopened.billingProposalId,undefined);assert.equal(reopened.firstClosedAt,firstClosed);
 assert.equal((await c.d.productRepository.getById(c.product.id)).stockQuantity,10);
 const cancelled=await c.d.proposalRepository.getById(c.proposal.id);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.billedAt,billed.billedAt);assert.ok(cancelled.billingVoidedAt);
 const lost=await loseDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:deal.id,lossReason:'Cliente desistiu'});assert.equal(lost.status,'lost');
 events=await c.d.timelineEventRepository.listByEntity({entityType:'deal',entityId:deal.id});assert.ok(events.find(e=>e.eventType==='deal_reopened').payload.previousClosure);assert.equal(events.filter(e=>e.eventType==='deal_won').length,1);assert.ok(events.some(e=>e.eventType==='deal_lost'));
 const pevents=await c.d.proposalRepository.listEvents(c.proposal.id);for(const type of ['accepted','invoiced','billing_voided'])assert.equal(pevents.filter(e=>e.eventType===type).length,1);
 await assert.rejects(c.invoice(),/PROPOSAL_BILLING_INVALID/);
});

test('perda direta após ganho/faturamento reverte estoque, cancela operacionalmente e mantém snapshot anterior na auditoria',async()=>{
 const c=await setup();await c.accept();await c.invoice();
 const lost=await loseDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:c.deal.id,lossReason:'Cliente desistiu'});assert.equal(lost.status,'lost');
 const audit=(await c.d.timelineEventRepository.listByEntity({entityType:'deal',entityId:c.deal.id})).find(e=>e.eventType==='deal_lost');assert.ok(audit.payload.previousClosure);assert.equal(audit.payload.previousWonProposalId,c.proposal.id);
 assert.equal((await c.d.productRepository.getById(c.product.id)).stockQuantity,10);
 assert.equal((await c.d.proposalRepository.getById(c.proposal.id)).status,'cancelled');
});

test('perda antes de faturar não baixa estoque; isolamento e segunda proposta aceita não substituem o vínculo',async()=>{
 const c=await setup();await c.accept();
 await assert.rejects(invoiceAcceptedProposal(c.d,{...c.actor,tenantId:'other'},{workspaceId:c.workspaceId,dealId:c.deal.id}),/DEAL_NOT_FOUND/);
 const second=await c.d.proposalRepository.create({...c.scope,dealId:c.deal.id,contactId:c.contact.id,title:'Outra',items:c.proposal.items,totalCents:c.proposal.totalCents,publicTokenHash:'second-'+c.proposal.id,status:'sent'});
 await assert.rejects(c.d.proposalRepository.setStatus(second.id,{status:'accepted'}),/PROPOSAL_BILLING_INVALID/);
 await loseDeal(c.d,c.actor,{workspaceId:c.workspaceId,dealId:c.deal.id,lossReason:'Cliente desistiu'});
 assert.equal((await c.d.proposalRepository.getById(c.proposal.id)).status,'cancelled');assert.equal((await c.d.productRepository.getById(c.product.id)).stockQuantity,10);
});

test('nome+telefone, somente telefone, Lead/IDs e espelho web usam a mesma apresentação',()=>{
 assert.equal(contactLabel({name:'João da Silva',phone:'+5546999999999'}),'João da Silva · (46) 99999-9999');
 for(const name of ['Lead','Lead 123','Lead123','lead_xxx','contact-123','intent-123','conversation-456','+5546999999999','.'])assert.equal(contactLabel({name,phone:'+5546999999999'}),'(46) 99999-9999',name);
 assert.equal(contactLabel({name:'Lead 123'}),'Contato sem telefone');assert.equal(humanContactName('Maria Eduarda'),'Maria Eduarda');
 const source=readFileSync('src/shared/utils/contact-presentation.ts','utf8');assert.ok(readFileSync('web/features/crm/contact-presentation.ts','utf8').endsWith(source));
});

test('proposta e oportunidade antigas resolvem contato atualizado sem reescrever título/snapshot nem depender da primeira página',async()=>{
 const c=await setup();
 await db.pool.query("update contacts set name='Lead 123' where id=$1",[c.contact.id]);
 assert.equal((await c.d.proposalRepository.getById(c.proposal.id)).contactDisplayName,'(46) 99999-9999');
 assert.equal((await c.d.contactRepository.getById(c.contact.id)).name,'Lead 123','leitura não apaga dado legado de auditoria');
 await c.d.contactRepository.update(c.contact.id,{name:'João da Silva',customFields:{phone:'+5546999999999'}});
 await db.pool.query("update proposals set title='lead_legacy_snapshot' where id=$1",[c.proposal.id]);
 await db.pool.query("update deals set title='lead_old_deal' where id=$1",[c.deal.id]);
 const p=await c.d.proposalRepository.getById(c.proposal.id),d=await c.d.dealRepository.getById(c.deal.id);
 assert.equal(p.contactDisplayName,'João da Silva · (46) 99999-9999');assert.equal(d.contactDisplayName,p.contactDisplayName);
 assert.equal(p.title,'lead_legacy_snapshot');assert.equal(d.title,'lead_old_deal');
 assert.equal((await c.d.proposalRepository.listByWorkspace(c.scope)).find(p=>p.id===c.proposal.id).contactDisplayName,p.contactDisplayName);
 for(const search of ['João da Silva','(46) 99999-9999',p.number])assert.equal((await c.d.proposalRepository.listByWorkspace({...c.scope,search}))[0]?.id,p.id,search);
 assert.equal((await c.d.contactRepository.listByWorkspace({...c.scope,search:'(46) 99999-9999'}))[0]?.id,c.contact.id);
 assert.equal((await c.d.proposalRepository.listByWorkspace({...c.scope,search:'Sem correspondência'})).length,0);
 await assert.rejects(c.d.contactRepository.create({...c.scope,name:'Sem número'}),/CONTACT_PHONE_REQUIRED/);
});

test('API de faturamento exige permissão e escopo da oportunidade; não aceita ator/data enviados no corpo',async()=>{
 const c=await setup();await c.accept();let principal={...c.actor,permissions:[]};
 const app=Fastify();app.decorateRequest('zunoContext',null);app.addHook('preHandler',async req=>{req.zunoContext={principal};});registerErrorHandler(app);await registerSalesEngineRoutes(app,c.d);
 try{
  const request=body=>app.inject({method:'POST',url:`/deals/${c.deal.id}/invoice`,payload:body});
  assert.equal((await request({workspaceId:c.workspaceId})).statusCode,403);
  principal={...c.actor,role:'editor',userId:'other-owner'};
  assert.equal((await request({workspaceId:c.workspaceId})).statusCode,404);
  principal=c.actor;assert.equal((await request({workspaceId:'another-workspace'})).statusCode,404);
  assert.equal((await request({workspaceId:c.workspaceId,proposalId:'another-proposal'})).statusCode,400);
  principal=c.actor;assert.equal((await request({workspaceId:c.workspaceId,billedByUserId:'spoof'})).statusCode,200);
  assert.equal((await c.d.proposalRepository.getById(c.proposal.id)).billedByUserId,c.actor.userId);
  const ok=await request({workspaceId:c.workspaceId});assert.equal(ok.statusCode,200,ok.body);
 }finally{await app.close();}
});

test('tarefas, pedidos e notificações usam nome/telefone atuais, preservando o snapshot e vínculos originais',async()=>{
 const c=await setup(),orderId='order-'+c.proposal.id,notifications=new PostgresNotificationRepository(db.pool);
 const task=await c.d.taskRepository.create({...c.scope,dealId:c.deal.id,type:'follow_up',title:'Retornar'});
 await db.pool.query("insert into commerce_orders(id,tenant_id,workspace_id,number,public_token_hash,source,status,contact_id,customer,delivery,subtotal_cents,total_cents) values($1,$2,$3,1,$1,'MANUAL','PENDING',$4,$5,'{}',19000,19000)",[orderId,c.tenantId,c.workspaceId,c.contact.id,JSON.stringify({name:'Nome antigo',phone:'+5546999999999',email:'cliente@example.test'})]);
 const notice=await notifications.create({...c.scope,userId:c.actor.userId,title:'Pedido pago #1',body:'Nome antigo · R$ 190,00',sourceType:'commerce_order_paid',sourceId:orderId});
 const proposalNotice=await notifications.create({...c.scope,userId:c.actor.userId,title:'Lead 123 aceitou a proposta',body:'Aguardando faturamento',sourceType:'proposal_accepted',sourceId:c.proposal.id});
 await c.d.contactRepository.update(c.contact.id,{name:'Nome atual',customFields:{phone:'+5546999999999'}});
 const label='Nome atual · (46) 99999-9999';
 assert.equal((await c.d.taskRepository.getById(task.id)).contactDisplayName,label);
 const order=await new PostgresCommerceOrderRepository(db.pool).get(orderId);assert.equal(order.customerDisplayName,label);assert.equal(order.customer.name,'Nome antigo');
 const read=await notifications.listActive({...c.scope,userId:c.actor.userId,limit:20});
 assert.equal(read.find(n=>n.id===notice.id).body,label+' · R$ 190,00');
 assert.equal(read.find(n=>n.id===proposalNotice.id).title,label+' aceitou a proposta');
 assert.equal((await db.pool.query('select body from notifications where id=$1',[notice.id])).rows[0].body,'Nome antigo · R$ 190,00');
});

test('proposta pública resolve contato pelo negócio e nunca expõe contato de outro tenant/workspace',async()=>{
 const c=await setup(),other=await productSiteContext(db.pool);
 await db.pool.query('update proposals set contact_id=null where id=$1',[c.proposal.id]);
 const app=Fastify();await registerPublicProposalsRoutes(app,{...c.d,...c.d.proposal,workspaceRepository:c.workspaceRepository});
 try {
  let response=await app.inject({method:'GET',url:'/public/proposals/'+c.rawToken});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().data.customerName,'(46) 99999-9999');
  const foreign=await other.d.contactRepository.create({...other.scope,name:'Nome confidencial',company:'Empresa de outro tenant',customFields:{phone:'+5511987654321'}});
  await db.pool.query('update proposals set contact_id=$2 where id=$1',[c.proposal.id,foreign.id]);
  response=await app.inject({method:'GET',url:'/public/proposals/'+c.rawToken});assert.equal(response.statusCode,200,response.body);assert.equal(response.json().data.customerName,undefined);assert.equal(response.json().data.customerCompany,undefined);
 }finally{await app.close();}
});
