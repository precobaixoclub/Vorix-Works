import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import Fastify from "fastify";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {defaultProductDetails} from "../dist/domain/products/product-details.js";
import {siteContentSchema,siteThemeSchema} from "../dist/domain/sites/site.model.js";
import {publishSite,publicSite} from "../dist/application/sites/site-use-cases.js";
import {generateVariantGrid} from "../dist/application/sales/catalog-use-cases.js";
import {resolveProductCommerce,defaultSiteCommerceSettings,siteCommerceSettingsSchema,extractSalesIntentReference,newSalesIntentReference,salesIntentWhatsappMessage} from "../dist/domain/sites/site-commerce.js";
import {startProductWhatsapp,resolveSalesIntentRedirect,setPublicCartItem,setPublicCartCoupon,getPublicCart,checkoutPublicCartToWhatsapp,saveSiteCommerceSettings,recordPublicSiteEvent} from "../dist/application/sites/site-commerce-use-cases.js";
import {addDealItem} from "../dist/application/sales/deal-commercial-use-cases.js";
import {commercialRuleSchema} from "../dist/domain/commerce/commercial-rules.js";
import {convertSalesIntentFromInbound,attachAttendanceToConvertedIntent,processSiteFormLead,processSiteCartLead} from "../dist/application/commercial-bridge/site-lead-use-cases.js";
import {searchConversationProducts,sendProductToConversation,addProductToConversationOpportunity} from "../dist/application/commercial-bridge/conversation-product-use-cases.js";
import {getSharedProduct} from "../dist/application/commercial-bridge/public-product-use-cases.js";
import {createProductShareCodec} from "../dist/shared/utils/product-share-token.js";
import {registerPublicProductsRoutes} from "../dist/interfaces/api/routes/v1/public-products.route.js";
import {registerErrorHandler} from "../dist/interfaces/api/http/error-handler.js";
import sharp from "sharp";
import {registerInboundMessage,applyInboundServiceRules} from "../dist/application/inbox/inbox-use-cases.js";
import {createTeam} from "../dist/application/identity/team-use-cases.js";
import {registerSiteCommerceRoutes} from "../dist/interfaces/api/routes/v1/site-commerce.route.js";
import {PostgresSiteCommerceRepository} from "../dist/infrastructure/storage/postgres/postgres-site-commerce-repository.js";
import {getPublicSelection,submitPublicSelection} from "../dist/application/sites/site-selection-use-cases.js";
import {PostgresMessagingConnectionRepository} from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import {PostgresInboxContactRepository} from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import {PostgresInboxConversationRepository} from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import {PostgresInboxConversationEventRepository} from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import {PostgresInboxMessageRepository} from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import {PostgresInboxServiceSettingsRepository} from "../dist/infrastructure/storage/postgres/postgres-inbox-service-settings-repository.js";
import {PostgresInboxAttendanceRepository} from "../dist/infrastructure/storage/postgres/postgres-inbox-attendance-repository.js";
import {PostgresTeamRepository,PostgresTeamMembershipRepository} from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import {PostgresContactIdentityRepository} from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import {PostgresNotificationRepository} from "../dist/infrastructure/storage/postgres/postgres-notification-repository.js";

let db;before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(async()=>{await db?.stop();});
const WHATSAPP="5511988887777";
const visible=(value={})=>({...defaultProductDetails(),siteVisible:true,...value});
const count=async(sql,params)=>Number((await db.pool.query(sql,params)).rows[0].n);

/** Workspace com Site publicado, catálogo (A geral, B vestuário P/M/G), WhatsApp conectado e CRM real. */
async function commerce({whatsapp=WHATSAPP}={}){
 const c=await productSiteContext(db.pool);
 const commerceRepository=new PostgresSiteCommerceRepository(db.pool);
 const siteDeps={...c.siteDeps,commerceRepository};
 const site=await c.siteDeps.repository.create({...c.scope,slug:"loja-"+randomUUID().slice(0,8),draft:{content:siteContentSchema.parse({name:"Loja Fixture",...(whatsapp?{whatsapp}:{}),blocks:[{id:"catalog",type:"catalog",title:"Catálogo"}]}),theme:siteThemeSchema.parse({})}});
 await publishSite(siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});
 const productA=await c.product({name:"Camiseta Basic Preta",priceCents:5990,details:visible({slug:"camiseta-basic"})});
 const productB=await c.product({name:"Calça Jeans",priceCents:15990,trackStock:true,details:visible({type:"APPAREL",slug:"calca-jeans",options:[{key:"size",name:"Tamanho",values:["P","M","G"]}]})});
 const variants=await generateVariantGrid(c.d,{...c.scope,productId:productB.id});
 const variantM=variants.find(variant=>variant.optionValues.size==="M"),variantG=variants.find(variant=>variant.optionValues.size==="G");
 await c.d.productEngineRepository.move({...c.scope,productId:productB.id,variantId:variantM.id,kind:"IN",quantity:5,operationKey:randomUUID(),userId:c.actor.userId});
 const inbox={
  workspaceRepository:c.workspaceRepository,connectionRepository:new PostgresMessagingConnectionRepository(db.pool),contactRepository:new PostgresInboxContactRepository(db.pool),
  conversationRepository:new PostgresInboxConversationRepository(db.pool),conversationEventRepository:new PostgresInboxConversationEventRepository(db.pool),messageRepository:new PostgresInboxMessageRepository(db.pool),
  serviceSettingsRepository:new PostgresInboxServiceSettingsRepository(db.pool),attendanceRepository:new PostgresInboxAttendanceRepository(db.pool),
  teamRepository:new PostgresTeamRepository(db.pool),teamMembershipRepository:new PostgresTeamMembershipRepository(db.pool),
  outboundQueue:{published:[],async publish(input){this.published.push(input);}},providers:{wuzapi:{async sendText(){return {externalMessageId:"x"};}}},
 };
 const connection=await inbox.connectionRepository.create({...c.scope,provider:"wuzapi",displayName:"WhatsApp"});
 await inbox.connectionRepository.updateStatus(connection.id,{status:"connected",externalSessionId:`sess-${connection.id}`});
 const crmBridge={inboxContactRepository:inbox.contactRepository,inboxMessageRepository:inbox.messageRepository,contact:{contactRepository:c.d.contactRepository,contactIdentityRepository:new PostgresContactIdentityRepository(db.pool),timelineEventRepository:c.d.timelineEventRepository}};
 const sales={...c.d};
 const siteLead={commerceRepository,siteRepository:c.siteDeps.repository,crm:{dealRepository:c.d.dealRepository,pipelineRepository:c.d.pipelineRepository,pipelineStageRepository:c.d.pipelineStageRepository,timelineEventRepository:c.d.timelineEventRepository,sales},sales,teamMembershipRepository:inbox.teamMembershipRepository,notification:{notificationRepository:new PostgresNotificationRepository(db.pool)},inbox,crmBridge};
 /** Mesmo caminho do worker: registra a mensagem, converte a intenção, aplica as regras e grava o atendimento. */
 const inbound=async(body,{phone="+5511912345678",externalMessageId=randomUUID(),tenantId=c.tenantId,workspaceId=c.workspaceId,lead=siteLead,conn=connection}={})=>{
  const {contact,conversation,message,wasCreated}=await registerInboundMessage(inbox,{tenantId,workspaceId,connectionId:conn.id,chatId:`${phone.slice(1)}@s.whatsapp.net`,chatPhoneE164:phone,isGroup:false,fromMe:false,senderId:phone,senderName:"Maria Cliente",externalMessageId,type:"text",body,occurredAt:new Date().toISOString()});
  const result=wasCreated?await convertSalesIntentFromInbound(lead,{tenantId,workspaceId,conversation,inboxContact:contact,messageBody:message.body}):{status:"duplicate"};
  if(wasCreated)await applyInboundServiceRules(inbox,{tenantId,workspaceId,conversationId:conversation.id,messageId:message.id});
  if(result.status==="converted")await attachAttendanceToConvertedIntent(lead,{intentId:result.intentId,conversationId:conversation.id});
  return {result,conversation,contact};
 };
 const lookup={slug:site.slug};
 return {...c,site,siteDeps,commerceRepository,productA,productB,variantM,variantG,inbox,connection,siteLead,inbound,lookup};
}
const dealsOf=c=>count("select count(*) n from deals where workspace_id=$1",[c.workspaceId]);
const contactsOf=c=>count("select count(*) n from contacts where workspace_id=$1",[c.workspaceId]);
const selectionDeps=c=>({...c.siteDeps,registerCartLead:input=>processSiteCartLead(c.siteLead,input),selectionDealOpen:async id=>(await c.d.dealRepository.getById(id))?.status==="open"});
const selectionLines=view=>view.snapshot.items.map(({productId,variantId,quantity})=>({productId,variantId,quantity}));

test("finalizar WhatsApp sem cadastro registra oportunidade, identifica o contato pela mensagem e não duplica no reenvio",async()=>{
 const c=await commerce(),deps=selectionDeps(c);
 await db.pool.query("insert into users(id,email,password_hash,name,status,created_at,updated_at) values($1,$2,'x','Responsável inicial','active',now(),now())",[c.actor.userId,`${c.actor.userId}@default-team.test`]);
 await db.pool.query("insert into tenant_members(id,user_id,tenant_id,role,created_at,updated_at) values($1,$2,$3,'owner',now(),now())",[`membership-${c.actor.userId}`,c.actor.userId,c.tenantId]);
 const defaultTeam=await c.inbox.teamRepository.getDefaultForWorkspace(c.scope);
 await saveSiteCommerceSettings(deps,{site:c.site,settings:{mode:"WHATSAPP_CART",cartLead:true},actorUserId:c.actor.userId});
 const cart=await setPublicCartItem(deps,{lookup:c.lookup,productId:c.productA.id,quantity:2});
 const app=Fastify();registerErrorHandler(app);await registerSiteCommerceRoutes(app,{...deps,workspaceRepository:c.workspaceRepository});
 const payload={token:cart.token,requestKey:randomUUID(),finalize:true};
 const response=await app.inject({method:"POST",url:`/public/sites/${c.site.slug}/cart/checkout`,payload});
 assert.equal(response.statusCode,200,response.body);const result=response.json().data;
 assert.equal(result.finalized,true);assert.match(result.whatsappUrl,/^https:\/\/wa.me\//);assert.ok(decodeURIComponent(result.whatsappUrl).includes(result.selectionPath));
 const intent=await c.commerceRepository.getIntentByReference(result.reference);
 assert.ok(intent.selectionSubmittedAt);assert.ok(intent.dealId);assert.equal(intent.contactId,undefined);assert.equal(intent.selectionCustomer,undefined);
 assert.equal(await contactsOf(c),0);assert.equal(await dealsOf(c),1);
 const assigned=await c.d.dealRepository.getById(intent.dealId);
 assert.equal(assigned.ownerUserId,c.actor.userId);assert.equal(assigned.teamId,defaultTeam.id);
 const repeated=await app.inject({method:"POST",url:`/public/sites/${c.site.slug}/cart/checkout`,payload});assert.equal(repeated.statusCode,200);assert.equal(repeated.json().data.reference,result.reference);assert.equal(await dealsOf(c),1);
 const inbound=await c.inbound(new URL(result.whatsappUrl).searchParams.get("text"));
 assert.equal(inbound.result.dealId,intent.dealId);assert.equal(await contactsOf(c),1);assert.equal(await dealsOf(c),1);
 assert.equal(inbound.conversation.currentTeamId,defaultTeam.id);assert.equal(inbound.conversation.assignedUserId,c.actor.userId);
 const linked=await c.commerceRepository.getIntent(intent.id);assert.ok(linked.contactId);assert.equal((await c.d.dealRepository.getById(intent.dealId)).contactId,linked.contactId);
 await app.close();
});

test("finalização direta do produto e edição da seleção dispensam nome e telefone",async()=>{
 const c=await commerce(),deps=selectionDeps(c),app=Fastify();registerErrorHandler(app);await registerSiteCommerceRoutes(app,{...deps,workspaceRepository:c.workspaceRepository});
 const response=await app.inject({method:"POST",url:`/public/sites/${c.site.slug}/whatsapp-intents`,payload:{productId:c.productA.id,requestKey:randomUUID(),finalize:true}});
 assert.equal(response.statusCode,200,response.body);const result=response.json().data;
 assert.equal(result.finalized,true);const token=result.selectionPath.split("/").at(-1),view=await getPublicSelection(deps,token);
 const edited=await submitPublicSelection(deps,{token,revision:view.revision,items:[{productId:c.productA.id,quantity:3}]});
 assert.equal(edited.syncPending,false);assert.equal(edited.snapshot.items[0].quantity,3);assert.equal(await contactsOf(c),0);assert.equal(await dealsOf(c),1);
 await app.close();
});

test("seleção visual: confirmação cria contato e oportunidade antes do WhatsApp, link não revela dados pessoais e mensagem posterior reutiliza o negócio",async()=>{
 const c=await commerce(),deps=selectionDeps(c);
 const result=await startProductWhatsapp(deps,{lookup:c.lookup,productId:c.productA.id,requestKey:randomUUID(),sessionId:"selection-browser"});
 assert.match(result.selectionPath,/^\/selecao\/[a-f0-9]{64}$/);
 const token=result.selectionPath.split("/").at(-1),view=await getPublicSelection(deps,token);
 assert.equal(view.snapshot.items[0].name,c.productA.name);assert.equal(view.submittedAt,undefined);assert.equal(await contactsOf(c),0);
 const confirmed=await submitPublicSelection(deps,{token,revision:view.revision,items:selectionLines(view),customer:{name:"Ana da seleção",phone:"(11) 97777-6666"}});
 assert.ok(confirmed.submittedAt);assert.equal(confirmed.syncPending,false);assert.equal(confirmed.revision,2);
 const intent=await c.commerceRepository.getIntentByReference(result.reference);
 assert.ok(intent.contactId);assert.ok(intent.dealId);assert.equal(await contactsOf(c),1);assert.equal(await dealsOf(c),1);
 assert.equal(intent.status,"CONVERTED");
 assert.equal(await count("select count(*) n from site_analytics_identities where site_id=$1 and contact_id=$2",[c.site.id,intent.contactId]),1);
 const json=JSON.stringify(confirmed);for(const privateValue of [c.tenantId,c.workspaceId,intent.contactId,intent.dealId,"Ana da seleção","97777"]){assert.equal(json.includes(privateValue),false,`não expõe ${privateValue}`);}
 assert.match(decodeURIComponent(confirmed.whatsappUrl),/Ver pedido com fotos/);
 assert.match(decodeURIComponent(confirmed.whatsappUrl),new RegExp(token));
 const inbound=await c.inbound(`Ref: ${result.reference}`,{phone:"+5511977776666"});
 assert.equal(inbound.result.dealId,intent.dealId);assert.equal(await contactsOf(c),1);assert.equal(await dealsOf(c),1);
 assert.equal(await count("select count(*) n from site_events where sales_intent_id=$1 and type='SALES_INTENT_CONVERTED'",[intent.id]),1);
});

test("seleção: edições preservam itens acrescentados pelo vendedor, inclusive do mesmo produto",async()=>{
 const c=await commerce(),deps=selectionDeps(c);
 const result=await startProductWhatsapp(deps,{lookup:c.lookup,productId:c.productA.id,requestKey:randomUUID()}),token=result.selectionPath.split("/").at(-1);
 await submitPublicSelection(deps,{token,revision:1,items:[{productId:c.productA.id,quantity:1}],customer:{name:"Cliente",phone:"+5511966663333"}});
 const intent=await c.commerceRepository.getIntentByReference(result.reference);
 const extra=await addDealItem(c.d,c.actor,{workspaceId:c.workspaceId,dealId:intent.dealId,productId:c.productA.id,quantity:1});
 await submitPublicSelection(deps,{token,revision:2,items:[{productId:c.productB.id,variantId:c.variantM.id,quantity:2}]});
 const items=await c.d.dealItemRepository.listByDeal(intent.dealId);
 assert.equal(items.length,2);assert.equal(items.find(item=>item.id===extra.id).quantity,1);assert.ok(items.some(item=>item.productId===c.productB.id));
});

test("seleção: cupom do carrinho é preservado na confirmação e recalculado ao editar; loja sem WhatsApp registra normalmente",async()=>{
 const c=await commerce({whatsapp:""});
 await saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"WHATSAPP_CART",cartLead:true},actorUserId:c.actor.userId});
 const rule={...commercialRuleSchema.parse({name:"Cupom de teste",active:true,channels:["WHATSAPP"],scope:{type:"STORE"},trigger:{type:"QUANTITY",count:"ELIGIBLE",minimum:1},benefit:{type:"PERCENT",basisPoints:1000},couponCode:"BEMVINDO"}),id:"coupon-selection",tenantId:c.tenantId,workspaceId:c.workspaceId,siteId:c.site.id,revision:1};
 const deps={...selectionDeps(c),commercialRules:{list:async()=>[rule]}};
 const cart=await setPublicCartItem(deps,{lookup:c.lookup,productId:c.productA.id,quantity:2});
 await setPublicCartCoupon(deps,{lookup:c.lookup,token:cart.token,code:"BEMVINDO"});
 const result=await checkoutPublicCartToWhatsapp(deps,{lookup:c.lookup,token:cart.token,requestKey:randomUUID(),review:true}),token=result.selectionPath.split("/").at(-1);
 const view=await getPublicSelection(deps,token);assert.equal(view.snapshot.subtotalCents,10782);
 const submitted=await submitPublicSelection(deps,{token,revision:1,items:selectionLines(view),customer:{name:"Cliente sem WhatsApp da loja",phone:"+5511955551111"}});
 assert.equal(submitted.syncPending,false);assert.equal(submitted.whatsappUrl,undefined);assert.equal(submitted.snapshot.subtotalCents,10782);
 const edited=await submitPublicSelection(deps,{token,revision:2,items:[{productId:c.productA.id,quantity:3}]});
 assert.equal(edited.snapshot.subtotalCents,16173);assert.equal(await dealsOf(c),1);
});

test("seleção editável: troca itens na mesma oportunidade, preserva revisões e impede sobrescrita concorrente",async()=>{
 const c=await commerce(),deps=selectionDeps(c);
 const result=await startProductWhatsapp(deps,{lookup:c.lookup,productId:c.productA.id,requestKey:randomUUID()});
 const token=result.selectionPath.split("/").at(-1);
 await submitPublicSelection(deps,{token,revision:1,items:[{productId:c.productA.id,quantity:1}],customer:{name:"Cliente edição",phone:"+5511955553333"}});
 const first=await c.commerceRepository.getIntentByReference(result.reference);
 const updated=await submitPublicSelection(deps,{token,revision:2,items:[{productId:c.productB.id,variantId:c.variantM.id,quantity:2}]});
 assert.equal(updated.syncPending,false);assert.equal(updated.snapshot.subtotalCents,31980);assert.equal(updated.revision,3);
 const same=await c.commerceRepository.getIntentByReference(result.reference);assert.equal(same.dealId,first.dealId);assert.equal(await dealsOf(c),1);
 assert.equal(same.selectionHistory[1].snapshot.items[0].productId,c.productA.id);
 const lines=await c.d.dealItemRepository.listByDeal(same.dealId);assert.equal(lines.length,1);assert.equal(lines[0].variantId,c.variantM.id);assert.equal(Number(lines[0].quantity),2);
 assert.equal((await c.d.dealRepository.getById(same.dealId)).valueCents,31980);
 const attempts=await Promise.allSettled([1,3].map(quantity=>submitPublicSelection(deps,{token,revision:3,items:[{productId:c.productB.id,variantId:c.variantM.id,quantity}]})));
 assert.equal(attempts.filter(item=>item.status==="fulfilled").length,1);assert.equal((await getPublicSelection(deps,token)).revision,4);
 assert.equal(await count("select count(*) n from product_stock_movements where product_id=$1 and kind='RESERVATION'",[c.productB.id]).catch(()=>0),0);
});

test("seleção: falha após criar oportunidade mantém pedido e permite reparar sem duplicar contato, negócio ou itens",async()=>{
 const c=await commerce(),deps=selectionDeps(c);
 const result=await startProductWhatsapp(deps,{lookup:c.lookup,productId:c.productA.id,requestKey:randomUUID()}),token=result.selectionPath.split("/").at(-1);
 const failed=await submitPublicSelection({...deps,registerCartLead:async input=>{await processSiteCartLead(c.siteLead,input);throw Error("CRM temporariamente indisponível");}},{token,revision:1,items:[{productId:c.productA.id,quantity:2}],customer:{name:"Cliente recuperação",phone:"+5511944443333"}});
 assert.equal(failed.syncPending,true);assert.equal(failed.snapshot.items[0].quantity,2);assert.ok(failed.submittedAt);
 const repaired=await submitPublicSelection(deps,{token,revision:failed.revision,items:selectionLines(failed)});
 assert.equal(repaired.syncPending,false);assert.equal(await contactsOf(c),1);assert.equal(await dealsOf(c),1);
 const intent=await c.commerceRepository.getIntentByReference(result.reference);assert.equal((await c.d.dealItemRepository.listByDeal(intent.dealId)).length,1);
});

test("seleção: carrinho híbrido envia só itens assistidos; compra online continua no carrinho, sem reservas pela solicitação",async()=>{
 const c=await commerce();await saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"HYBRID",cartLead:true},actorUserId:c.actor.userId});
 await c.d.productRepository.update(c.productB.id,{details:visible({type:"APPAREL",saleMode:"WHATSAPP_CART",options:[{key:"size",name:"Tamanho",values:["P","M","G"]}]})});
 const deps={...selectionDeps(c),checkoutStatus:async()=>({ready:true,missing:[]})};
 const cart=await setPublicCartItem(deps,{lookup:c.lookup,productId:c.productA.id,quantity:1});
 await setPublicCartItem(deps,{lookup:c.lookup,token:cart.token,productId:c.productB.id,variantId:c.variantM.id,quantity:1});
 const result=await checkoutPublicCartToWhatsapp(deps,{lookup:c.lookup,token:cart.token,requestKey:randomUUID(),review:true});
 const view=await getPublicSelection(deps,result.selectionPath.split("/").at(-1));assert.equal(view.snapshot.items.length,1);assert.equal(view.snapshot.items[0].productId,c.productB.id);
 const remaining=await getPublicCart(deps,{lookup:c.lookup,token:cart.token});assert.equal(remaining.items.length,1);assert.equal(remaining.items[0].productId,c.productA.id);assert.equal(remaining.items[0].channel,"checkout");
 assert.equal(await dealsOf(c),0);
});

test("seleção: token, preço e tenant adulterados são recusados; oportunidade encerrada e prazo vencido bloqueiam edição",async()=>{
 const c=await commerce(),other=await commerce(),deps=selectionDeps(c);
 const result=await startProductWhatsapp(deps,{lookup:c.lookup,productId:c.productA.id,requestKey:randomUUID()}),token=result.selectionPath.split("/").at(-1);
 await assert.rejects(getPublicSelection(deps,"a".repeat(64)),/SITE_NOT_FOUND/);
 await assert.rejects(submitPublicSelection(deps,{token,revision:1,items:[{productId:other.productA.id,quantity:1}],customer:{name:"Cliente",phone:"+5511944443333"}}),/SITE_NOT_FOUND/);
 const app=Fastify();registerErrorHandler(app);await registerSiteCommerceRoutes(app,{...deps,workspaceRepository:c.workspaceRepository});
 const response=await app.inject({method:"POST",url:`/public/site-selections/${token}`,payload:{revision:1,items:[{productId:c.productA.id,quantity:1,unitPriceCents:1}],customer:{name:"Cliente",phone:"+5511944443333"}}});assert.equal(response.statusCode,400);
 const get=await app.inject({method:"GET",url:`/public/site-selections/${token}`});assert.equal(get.statusCode,200);assert.equal(get.headers["cache-control"],"no-store");
 const confirmed=await submitPublicSelection(deps,{token,revision:1,items:[{productId:c.productA.id,quantity:1}],customer:{name:"Cliente",phone:"+5511944443333"}});
 const intent=await c.commerceRepository.getIntentByReference(result.reference);await db.pool.query("update deals set status='won' where id=$1",[intent.dealId]);
 assert.equal((await getPublicSelection(deps,token)).editable,false);
 await assert.rejects(submitPublicSelection(deps,{token,revision:confirmed.revision,items:[{productId:c.productA.id,quantity:2}]}),/SITE_VALIDATION/);
 const expired=await getPublicSelection({...deps,now:()=>new Date(Date.now()+15*86400000)},token);assert.equal(expired.editable,false);assert.equal(expired.snapshot.items[0].quantity,1);
 await app.close();
});

test("modo comercial: vitrine, WhatsApp, carrinho, híbrido, override por produto, sem estoque e checkout ainda indisponível",()=>{
 const settings=mode=>siteCommerceSettingsSchema.parse({mode});
 const general={type:"GENERAL",trackStock:false};
 const resolve=(mode,product=general,extra={})=>resolveProductCommerce({settings:settings(mode),hasWhatsapp:true,contactForm:true,product,...extra});
 assert.equal(resolve("SHOWCASE").saleMode,"SHOW_ONLY");
 assert.deepEqual(resolve("SHOWCASE").allowedActions,["inquiry"]);
 assert.equal(resolve("SHOWCASE").ctaLabel,"Tenho interesse");
 assert.equal(resolve("WHATSAPP").saleMode,"WHATSAPP_DIRECT");
 assert.deepEqual(resolve("WHATSAPP_CART").allowedActions,["add_to_cart","whatsapp","inquiry"]);
 assert.equal(resolve("HYBRID",{type:"APPAREL",trackStock:false}).saleMode,"WHATSAPP_CART");
 assert.equal(resolve("HYBRID",{type:"REAL_ESTATE",trackStock:false}).saleMode,"WHATSAPP_DIRECT");
 assert.equal(resolve("HYBRID",{type:"GENERAL",itemType:"service",trackStock:false}).saleMode,"WHATSAPP_DIRECT");
 // Override do produto vence o modo do site.
 assert.equal(resolve("WHATSAPP_CART",{...general,saleMode:"SHOW_ONLY"}).saleMode,"SHOW_ONLY");
 assert.equal(resolve("SHOWCASE",{...general,saleMode:"WHATSAPP_CART"}).saleMode,"WHATSAPP_CART");
 // Checkout online não é oferecido antes da Fase 2: vira conversa, nunca botão de compra.
 for(const value of [resolve("ONLINE_CHECKOUT"),resolve("WHATSAPP",{...general,saleMode:"ONLINE_CHECKOUT"})]){assert.equal(value.saleMode,"WHATSAPP_DIRECT");assert.equal(value.checkoutAvailable,false);assert.ok(!value.allowedActions.includes("checkout"));}
 // Sem WhatsApp configurado: só vitrine.
 assert.equal(resolve("WHATSAPP_CART",general,{hasWhatsapp:false}).saleMode,"SHOW_ONLY");
 // Sem estoque: nunca finge compra.
 const empty={type:"GENERAL",trackStock:true,availableQuantity:0};
 const ask=resolve("WHATSAPP_CART",empty);assert.deepEqual(ask.allowedActions,["whatsapp","inquiry"]);assert.equal(ask.ctaLabel,"Consultar disponibilidade");assert.equal(ask.availability,"unavailable");
 assert.deepEqual(resolveProductCommerce({settings:siteCommerceSettingsSchema.parse({mode:"WHATSAPP_CART",outOfStock:"HIDE_CTA"}),hasWhatsapp:true,contactForm:true,product:empty}).allowedActions,[]);
 assert.deepEqual(resolveProductCommerce({settings:siteCommerceSettingsSchema.parse({mode:"WHATSAPP_CART",outOfStock:"SHOW_UNAVAILABLE"}),hasWhatsapp:true,contactForm:true,product:empty}).allowedActions,["inquiry"]);
 // Site antigo sem configuração preserva o comportamento anterior.
 assert.equal(defaultSiteCommerceSettings(true).mode,"WHATSAPP");assert.equal(defaultSiteCommerceSettings(false).mode,"SHOWCASE");
});

test("referência curta: formato, não sequencial, encontrada no texto (inclusive minúscula) e sem falso positivo",()=>{
 const refs=new Set(Array.from({length:500},()=>newSalesIntentReference()));
 assert.equal(refs.size,500);for(const ref of refs)assert.match(ref,/^VX-[23456789A-HJKMNP-Z]{6}$/);
 assert.equal(extractSalesIntentReference("Olá! Tenho interesse.\n\nRef: VX-A8F2KM"),"VX-A8F2KM");
 assert.equal(extractSalesIntentReference("ref vx-a8f2km obrigado"),"VX-A8F2KM");
 assert.equal(extractSalesIntentReference("VX-A8F2"),undefined);
 assert.equal(extractSalesIntentReference("XVX-A8F2KMZ"),undefined);
 assert.equal(extractSalesIntentReference("VX-O0I1LA"),undefined);
 const message=salesIntentWhatsappMessage({type:"CART_WHATSAPP",reference:"VX-A8F2KM",snapshot:{items:[{productId:"a",name:"Camiseta",quantity:2,unitPriceCents:5990,currency:"BRL"},{productId:"b",name:"Calça",variantLabel:"Tamanho: M",quantity:1,unitPriceCents:15990,currency:"BRL"}],subtotalCents:27970,currency:"BRL"}});
 assert.match(message,/2x Camiseta/);assert.match(message,/Calça \(Tamanho: M\)/);assert.match(message,/Total estimado: R\$\s?279,70/);assert.match(message,/Ref: VX-A8F2KM$/);
});

test("vitrine pública recebe a decisão comercial do backend; SEO e checkout antigo preservados",async()=>{
 const c=await commerce();
 let data=await publicSite(c.siteDeps,c.lookup);
 assert.equal(data.commerce.mode,"WHATSAPP");assert.equal(data.commerce.checkoutAvailable,false);assert.equal(data.commerceEnabled,false);
 const a=data.products.find(product=>product.id===c.productA.id);
 assert.equal(a.commerce.saleMode,"WHATSAPP_DIRECT");assert.equal(a.canPurchaseOnline,false);assert.equal(a.slug,"camiseta-basic");
 await saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"WHATSAPP_CART"},actorUserId:c.actor.userId});
 await c.d.productRepository.update(c.productA.id,{details:visible({slug:"camiseta-basic",saleMode:"SHOW_ONLY"})});
 data=await publicSite(c.siteDeps,c.lookup);
 assert.equal(data.commerce.cartEnabled,true);
 assert.equal(data.products.find(product=>product.id===c.productA.id).commerce.saleMode,"SHOW_ONLY");
 assert.equal(data.products.find(product=>product.id===c.productB.id).commerce.saleMode,"WHATSAPP_CART");
 await assert.rejects(saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"QUALQUER"},actorUserId:c.actor.userId}));
});

test("WhatsApp de um produto: intenção com snapshot e UTM, idempotente, redireciona com referência — e clique sem mensagem não cria nada no CRM",async()=>{
 const c=await commerce();
 const requestKey=randomUUID();
 const first=await startProductWhatsapp(c.siteDeps,{lookup:c.lookup,productId:c.productA.id,requestKey,sessionId:"sess-visitante-1",pageUrl:"https://loja.exemplo.com/produto/camiseta-basic?utm_source=ig&x=1#topo",utm:{source:"instagram",medium:"social",campaign:"verao"}});
 const again=await startProductWhatsapp(c.siteDeps,{lookup:c.lookup,productId:c.productA.id,requestKey,sessionId:"sess-visitante-1"});
 assert.equal(again.reference,first.reference,"duplo clique devolve a mesma intenção");
 assert.equal(first.redirectPath,`/i/${first.reference}`);
 const intent=await c.commerceRepository.getIntentByReference(first.reference);
 assert.equal(intent.type,"PRODUCT_WHATSAPP");assert.equal(intent.status,"OPEN");assert.equal(intent.siteId,c.site.id);
 assert.equal(intent.snapshot.items[0].name,"Camiseta Basic Preta");assert.equal(intent.snapshot.items[0].unitPriceCents,5990);
 assert.deepEqual(intent.utm,{source:"instagram",medium:"social",campaign:"verao"});
 assert.equal(intent.pageUrl,"https://loja.exemplo.com/produto/camiseta-basic","sem query/fragmento");
 const redirect=await resolveSalesIntentRedirect(c.siteDeps,first.reference);
 assert.equal(redirect.status,"redirect");assert.ok(redirect.url.startsWith(`https://wa.me/${WHATSAPP}?text=`));
 assert.match(decodeURIComponent(redirect.url),new RegExp(`Camiseta Basic Preta[\\s\\S]*Ref: ${first.reference}`));
 assert.equal((await c.commerceRepository.getIntent(intent.id)).clickCount,1);
 // E2E 53 — clicou e não mandou mensagem: nenhum contato, conversa, atendimento ou oportunidade.
 assert.equal(await contactsOf(c),0);assert.equal(await dealsOf(c),0);
 assert.equal(await count("select count(*) n from inbox_conversations where workspace_id=$1",[c.workspaceId]),0);
 assert.equal(await count("select count(*) n from site_events where site_id=$1 and type in ('PRODUCT_WHATSAPP_CLICK','SALES_INTENT_CREATED')",[c.site.id]),2);
 // Variação obrigatória; produto oculto não vaza.
 await assert.rejects(startProductWhatsapp(c.siteDeps,{lookup:c.lookup,productId:c.productB.id,requestKey:randomUUID()}),/SITE_VALIDATION/);
 const hidden=await c.product({name:"Oculto",details:defaultProductDetails()});
 await assert.rejects(startProductWhatsapp(c.siteDeps,{lookup:c.lookup,productId:hidden.id,requestKey:randomUUID()}),/SITE_NOT_FOUND/);
 assert.equal((await resolveSalesIntentRedirect(c.siteDeps,"VX-ZZZZZZ")).status,"not_found");
 assert.equal((await resolveSalesIntentRedirect(c.siteDeps,"nada")).status,"not_found");
});

test("E2E 51 — mensagem com a referência cria contato, conversa, atendimento e oportunidade com o produto; reentrega não duplica",async()=>{
 const c=await commerce();
 const {reference}=await startProductWhatsapp(c.siteDeps,{lookup:c.lookup,productId:c.productA.id,quantity:3,requestKey:randomUUID(),sessionId:"sess-visitante-51",utm:{source:"google",campaign:"busca"}});
 await recordPublicSiteEvent(c.siteDeps,{lookup:c.lookup,type:"PRODUCT_VIEW",productId:c.productA.id,sessionId:"sess-visitante-51"});
 const externalMessageId=randomUUID();
 const {result,conversation}=await c.inbound(`Olá! Tenho interesse em Camiseta Basic Preta, quantidade 3.\n\nRef: ${reference}`,{externalMessageId});
 assert.equal(result.status,"converted");
 const intent=await c.commerceRepository.getIntentByReference(reference);
 assert.equal(intent.status,"CONVERTED");assert.ok(intent.convertedAt);
 assert.equal(intent.conversationId,conversation.id);assert.ok(intent.contactId);assert.ok(intent.dealId);assert.ok(intent.attendanceId);
 const contact=await c.d.contactRepository.getById(intent.contactId);assert.equal(contact.origin,"site");
 const deal=await c.d.dealRepository.getById(intent.dealId);assert.equal(deal.origin,"site");assert.equal(deal.contactId,intent.contactId);assert.equal(deal.status,"open");
 const items=await c.d.dealItemRepository.listByDeal(deal.id);
 assert.equal(items.length,1);assert.equal(items[0].productId,c.productA.id);assert.equal(Number(items[0].quantity),3);assert.equal(items[0].proposedUnitPriceCents,5990);
 const attendance=await c.inbox.attendanceRepository.getOpenByConversation(conversation.id);assert.equal(attendance.id,intent.attendanceId);
 // Eventos anônimos da sessão passam a apontar para o contato conhecido.
 assert.ok(await count("select count(*) n from site_events where site_id=$1 and anonymous_session_id='sess-visitante-51' and contact_id is null",[c.site.id])>0,"eventos anônimos históricos são preservados");
 assert.equal(await count("select count(*) n from site_analytics_identities where site_id=$1 and anonymous_session_id='sess-visitante-51' and contact_id is not null and not ambiguous",[c.site.id]),1);
 assert.equal(await count("select count(*) n from site_events where site_id=$1 and type='SALES_INTENT_CONVERTED'",[c.site.id]),1);
 // Webhook duplicado (mesmo id do provedor) e nova mensagem com a mesma referência: nada duplica.
 assert.equal((await c.inbound(`Ref: ${reference}`,{externalMessageId})).result.status,"duplicate");
 assert.equal((await c.inbound(`Oi de novo, Ref: ${reference}`)).result.status,"already_converted");
 assert.equal(await convertSalesIntentFromInbound(c.siteLead,{tenantId:c.tenantId,workspaceId:c.workspaceId,conversation,inboxContact:(await c.inbox.contactRepository.getById(conversation.contactId)),messageBody:`Ref: ${reference}`}).then(r=>r.status),"already_converted");
 assert.equal(await dealsOf(c),1);assert.equal(await contactsOf(c),1);
 assert.equal(await count("select count(*) n from inbox_attendances where conversation_id=$1",[conversation.id]),1);
});

test("E2E 52 — carrinho com variação vira uma oportunidade com todos os itens, sem duplicar",async()=>{
 const c=await commerce();
 await saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"WHATSAPP_CART"},actorUserId:c.actor.userId});
 let cart=await setPublicCartItem(c.siteDeps,{lookup:c.lookup,productId:c.productA.id,quantity:1,sessionId:"sess-carrinho"});
 const token=cart.token;assert.ok(token);
 cart=await setPublicCartItem(c.siteDeps,{lookup:c.lookup,token,productId:c.productA.id,quantity:2,sessionId:"sess-carrinho"});
 cart=await setPublicCartItem(c.siteDeps,{lookup:c.lookup,token,productId:c.productB.id,variantId:c.variantM.id,quantity:1,sessionId:"sess-carrinho"});
 assert.equal(cart.items.length,2);assert.equal(cart.itemCount,3);assert.equal(cart.subtotalCents,5990*2+15990);
 assert.equal(cart.items.find(item=>item.variantId===c.variantM.id).variantLabel,"Tamanho: M");
 // Persistência: outra página, mesmo token.
 assert.equal((await getPublicCart(c.siteDeps,{lookup:c.lookup,token})).items.length,2);
 // Variação sem estoque e quantidade acima do saldo são recusadas com a disponibilidade real.
 await assert.rejects(setPublicCartItem(c.siteDeps,{lookup:c.lookup,token,productId:c.productB.id,variantId:c.variantG.id,quantity:1}),/indisponível/);
 await assert.rejects(setPublicCartItem(c.siteDeps,{lookup:c.lookup,token,productId:c.productB.id,variantId:c.variantM.id,quantity:6}),/só temos 5/);
 await assert.rejects(setPublicCartItem(c.siteDeps,{lookup:c.lookup,token,productId:c.productB.id,quantity:1}),/escolha todas as opções/);
 // Remover e voltar.
 cart=await setPublicCartItem(c.siteDeps,{lookup:c.lookup,token,productId:c.productA.id,quantity:0});assert.equal(cart.items.length,1);
 cart=await setPublicCartItem(c.siteDeps,{lookup:c.lookup,token,productId:c.productA.id,quantity:2});assert.equal(cart.items.length,2);
 // Carrinho não reserva estoque.
 assert.equal(await count("select count(*) n from product_stock_movements where product_id=$1 and kind='RESERVATION'",[c.productB.id]).catch(()=>0),0);
 const requestKey=randomUUID();
 const checkout=await checkoutPublicCartToWhatsapp(c.siteDeps,{lookup:c.lookup,token,requestKey,sessionId:"sess-carrinho",utm:{source:"meta",campaign:"black"}});
 assert.equal((await checkoutPublicCartToWhatsapp(c.siteDeps,{lookup:c.lookup,token,requestKey})).reference,checkout.reference,"finalizar de novo devolve a mesma intenção");
 const text=decodeURIComponent(checkout.whatsappUrl);assert.match(text,/• 2x Camiseta Basic Preta — R\$\s?119,80/);assert.match(text,/• 1x Calça Jeans \(Tamanho: M\) — R\$\s?159,90/);assert.match(text,/Total estimado: R\$\s?279,70[\s\S]+https:\/\/vorixworks.com\/selecao\/[a-f0-9]{64}[\s\S]+Ref: VX-/);
 const fresh=await setPublicCartItem(c.siteDeps,{lookup:c.lookup,token,productId:c.productA.id,quantity:1});assert.notEqual(fresh.token,token,"carrinho finalizado não é reaproveitado");
 const {result}=await c.inbound(`Olá! Gostaria de comprar estes itens.\nRef: ${checkout.reference}`,{phone:"+5511955554444"});
 assert.equal(result.status,"converted");
 const intent=await c.commerceRepository.getIntentByReference(checkout.reference);
 assert.equal(intent.type,"CART_WHATSAPP");assert.deepEqual(intent.utm,{source:"meta",campaign:"black"});
 const items=await c.d.dealItemRepository.listByDeal(intent.dealId);
 assert.deepEqual(items.map(item=>[item.productId,item.variantId??null,Number(item.quantity)]).sort(),[[c.productA.id,null,2],[c.productB.id,c.variantM.id,1]].sort());
 assert.equal((await c.d.dealRepository.getById(intent.dealId)).valueCents,5990*2+15990);
 await c.inbound(`Ref: ${checkout.reference}`,{phone:"+5511955554444"});
 assert.equal(await dealsOf(c),1);
});

test("carrinho registrado no Vorix: pede nome e WhatsApp, cria contato e oportunidade na hora (sem WhatsApp conectado) e a mensagem só vincula",async()=>{
 const c=await commerce();
 await saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"WHATSAPP_CART",cartLead:true},actorUserId:c.actor.userId});
 const deps={...c.siteDeps,registerCartLead:input=>processSiteCartLead(c.siteLead,input)};
 let cart=await setPublicCartItem(deps,{lookup:c.lookup,productId:c.productA.id,quantity:2});const token=cart.token;
 cart=await setPublicCartItem(deps,{lookup:c.lookup,token,productId:c.productB.id,variantId:c.variantM.id,quantity:1});
 await assert.rejects(checkoutPublicCartToWhatsapp(deps,{lookup:c.lookup,token,requestKey:randomUUID()}),/nome e WhatsApp/);
 const requestKey=randomUUID();
 const checkout=await checkoutPublicCartToWhatsapp(deps,{lookup:c.lookup,token,requestKey,customer:{name:"Ana Compradora",phone:"+5511977776666"}});
 assert.ok(checkout.whatsappUrl);
 await checkoutPublicCartToWhatsapp(deps,{lookup:c.lookup,token,requestKey,customer:{name:"Ana Compradora",phone:"+5511977776666"}});
 const intent=await c.commerceRepository.getIntentByReference(checkout.reference);
 assert.ok(intent.contactId);assert.ok(intent.dealId);assert.equal(await dealsOf(c),1);
 const items=await c.d.dealItemRepository.listByDeal(intent.dealId);
 assert.deepEqual(items.map(item=>[item.productId,item.variantId??null,Number(item.quantity)]).sort(),[[c.productA.id,null,2],[c.productB.id,c.variantM.id,1]].sort());
 assert.equal((await c.d.dealRepository.getById(intent.dealId)).contactId,intent.contactId);
 // A mensagem com a referência, se chegar, usa a mesma oportunidade.
 const {result}=await c.inbound(`Ref: ${checkout.reference}`,{phone:"+5511977776666"});
 assert.equal(result.dealId,intent.dealId);assert.equal(await dealsOf(c),1);
});

test("carrinho registrado no Vorix sem número no site: pedido recebido, sem redirecionar",async()=>{
 const c=await commerce({whatsapp:""});
 await saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"WHATSAPP_CART",cartLead:true},actorUserId:c.actor.userId});
 const deps={...c.siteDeps,registerCartLead:input=>processSiteCartLead(c.siteLead,input)};
 const cart=await setPublicCartItem(deps,{lookup:c.lookup,productId:c.productA.id,quantity:1});
 const checkout=await checkoutPublicCartToWhatsapp(deps,{lookup:c.lookup,token:cart.token,requestKey:randomUUID(),customer:{name:"Bruno",phone:"+5511966665555"}});
 assert.equal(checkout.received,true);assert.equal(checkout.whatsappUrl,undefined);assert.equal(await dealsOf(c),1);
});

test("referência expirada não converte; referência de outro tenant é ignorada",async()=>{
 const c=await commerce(),other=await commerce();
 const later=new Date(Date.now()+15*24*60*60*1000);
 const {reference}=await startProductWhatsapp(c.siteDeps,{lookup:c.lookup,productId:c.productA.id,requestKey:randomUUID()});
 assert.equal((await resolveSalesIntentRedirect({...c.siteDeps,now:()=>later},reference)).status,"expired");
 assert.equal((await c.inbound(`Ref: ${reference}`,{lead:{...c.siteLead,now:()=>later}})).result.reason,"expired");
 // A mesma referência chegando no WhatsApp de OUTRA empresa nunca converte nem vaza.
 const foreign=await other.inbound(`Ref: ${reference}`);
 assert.equal(foreign.result.reason,"unknown_reference");
 assert.equal((await c.commerceRepository.getIntentByReference(reference)).status,"OPEN");
 assert.equal(await dealsOf(other),0);
 // Carrinho de um site não abre em outro.
 await saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"WHATSAPP_CART"},actorUserId:c.actor.userId});
 const {token}=await setPublicCartItem(c.siteDeps,{lookup:c.lookup,productId:c.productA.id,quantity:1});
 assert.equal((await getPublicCart(other.siteDeps,{lookup:other.lookup,token})).items.length,0);
 await assert.rejects(setPublicCartItem(other.siteDeps,{lookup:other.lookup,token,productId:c.productA.id,quantity:1}),/SITE_NOT_FOUND/);
});

test("equipe do Site recebe o lead pela distribuição da própria equipe e é notificada; sem opção de oportunidade, não cria",async()=>{
 const c=await commerce();
 const team=await createTeam({teamRepository:c.inbox.teamRepository,teamMembershipRepository:c.inbox.teamMembershipRepository,workspaceRepository:c.workspaceRepository},{...c.scope,name:"Vendas Site"});
 await db.pool.query("insert into users (id,email,password_hash,name,status,created_at,updated_at) values ($1,$2,'x',$1,'active',now(),now()) on conflict do nothing",["user-vendedora","vendedora@site.test"]);
 await db.pool.query("insert into tenant_members (id,user_id,tenant_id,role,created_at,updated_at) values ($1,'user-vendedora',$2,'editor',now(),now())",[`${c.tenantId}-vendedora`,c.tenantId]);
 await c.inbox.teamMembershipRepository.add({teamId:team.id,userId:"user-vendedora",role:"editor"});
 await saveSiteCommerceSettings({...c.siteDeps,teamBelongsToWorkspace:async()=>true},{site:c.site,settings:{mode:"WHATSAPP",teamId:team.id,createOpportunityFromWhatsapp:false},actorUserId:c.actor.userId});
 const {reference}=await startProductWhatsapp(c.siteDeps,{lookup:c.lookup,productId:c.productA.id,requestKey:randomUUID()});
 const {result,conversation}=await c.inbound(`Ref: ${reference}`,{phone:"+5511933332222"});
 assert.equal(result.status,"converted");assert.equal(result.assignedUserId,"user-vendedora");
 const routed=await c.inbox.conversationRepository.getById(conversation.id);
 assert.equal(routed.currentTeamId,team.id);assert.equal(routed.assignedUserId,"user-vendedora");
 assert.equal(await dealsOf(c),0,"oportunidade automática desligada");
 assert.equal((await c.commerceRepository.getIntentByReference(reference)).status,"CONVERTED");
 assert.equal(await count("select count(*) n from notifications where user_id='user-vendedora' and source_type='site_lead'"),1);
});

test("formulário do Site: regras configuráveis, idempotente; sem configuração mantém só o contato",async()=>{
 const c=await commerce();
 const submit=async(requestKey,phone="+5511977776666")=>{
  const saved=await c.siteDeps.repository.addInquiry({site:c.site,name:"João Lead",phone,message:"Quero orçamento",productId:c.productA.id,requestKey});
  return processSiteFormLead(c.siteLead,{siteId:c.site.id,tenantId:c.tenantId,workspaceId:c.workspaceId,inquiryId:saved.id,contactId:saved.contactId,name:"João Lead",phone,productId:c.productA.id,item:{productId:c.productA.id,name:"Camiseta Basic Preta",quantity:1,unitPriceCents:5990,currency:"BRL"},requestKey,anonymousSessionId:"sess-form",utm:{source:"newsletter"}});
 };
 const legacy=await submit(randomUUID());
 assert.equal(legacy.dealId,undefined);assert.equal(await dealsOf(c),0);assert.equal(await contactsOf(c),1);
 await saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"WHATSAPP",form:{createOpportunity:true,openAttendance:true}},actorUserId:c.actor.userId});
 const key=randomUUID();
 const first=await submit(key,"+5511966665555");
 assert.ok(first.dealId);assert.ok(first.conversationId,"atendimento aberto na conversa do WhatsApp do telefone");
 const again=await submit(key,"+5511966665555");
 assert.equal(again.dealId,first.dealId);assert.equal(await dealsOf(c),1);
 assert.equal(await count("select count(*) n from inbox_attendances where conversation_id=$1 and status='open'",[first.conversationId]),1);
 assert.equal(await count("select count(*) n from site_events where site_id=$1 and type='CONTACT_FORM_SUBMITTED'",[c.site.id]),2);
 const items=await c.d.dealItemRepository.listByDeal(first.dealId);assert.equal(items[0].productId,c.productA.id);
 assert.equal((await c.d.dealRepository.getById(first.dealId)).origin,"site");
 // Double submit racing past the request-key lookup: only the request that created the intent goes on.
 const burst=randomUUID(),results=await Promise.allSettled([submit(burst,"+5511955554444"),submit(burst,"+5511955554444")]);
 assert.ok(results.some(r=>r.status==="fulfilled"));
 assert.equal(await dealsOf(c),2,"one opportunity for the simultaneous pair");
});

test("multi-site: configuração, intenções e carrinhos sempre amarrados ao siteId",async()=>{
 const a=await commerce(),b=await commerce();
 await saveSiteCommerceSettings(a.siteDeps,{site:a.site,settings:{mode:"SHOWCASE"},actorUserId:a.actor.userId});
 assert.equal((await publicSite(b.siteDeps,b.lookup)).commerce.mode,"WHATSAPP");
 await assert.rejects(startProductWhatsapp(a.siteDeps,{lookup:a.lookup,productId:a.productA.id,requestKey:randomUUID()}),/não está disponível/);
 const {reference}=await startProductWhatsapp(b.siteDeps,{lookup:b.lookup,productId:b.productA.id,requestKey:randomUUID()});
 assert.equal((await b.commerceRepository.getIntentByReference(reference)).siteId,b.site.id);
 for(const table of ["sales_intents","site_carts","site_events","site_commerce_settings"])assert.equal(await count("select count(*) n from information_schema.columns where table_name=$1 and column_name='site_id'",[table]),1);
});

test("rotas HTTP: públicas validam site/produto; configuração comercial exige commerce:manage",async()=>{
 const c=await commerce();
 const app=Fastify();app.decorateRequest("zunoContext",null);
 app.addHook("onRequest",async request=>{const header=request.headers.authorization;request.zunoContext={principal:header?{tenantId:c.tenantId,role:header,userId:c.actor.userId}:undefined};});
 await registerSiteCommerceRoutes(app,{...c.siteDeps,workspaceRepository:c.workspaceRepository});
 const intent=await app.inject({method:"POST",url:`/public/sites/${c.site.slug}/whatsapp-intents`,payload:{productId:c.productA.id,requestKey:randomUUID(),sessionId:"sess-http-1",utm:{source:"tiktok"}}});
 assert.equal(intent.statusCode,200,intent.body);assert.match(intent.json().data.reference,/^VX-/);
 assert.equal((await app.inject({method:"POST",url:`/public/sites/${c.site.slug}/whatsapp-intents`,payload:{productId:"produto-inexistente",requestKey:randomUUID()}})).statusCode,404);
 assert.equal((await app.inject({method:"POST",url:`/public/sites/nao-existe/cart`,payload:{}})).statusCode,404);
 assert.equal((await app.inject({method:"POST",url:`/public/sites/${c.site.slug}/whatsapp-intents`,payload:{productId:c.productA.id,requestKey:"x",tenantId:"outro"}})).statusCode,400);
 assert.equal((await app.inject({method:"POST",url:`/public/sites/${c.site.slug}/events`,payload:{type:"SITE_VIEW",sessionId:"sess-http-1"}})).statusCode,204);
 assert.equal((await app.inject({method:"POST",url:`/public/sites/${c.site.slug}/events`,payload:{type:"SALES_INTENT_CONVERTED"}})).statusCode,400,"evento de servidor não pode ser forjado pelo navegador");
 const redirect=await app.inject({method:"GET",url:`/public/sales-intents/${intent.json().data.reference}`});
 assert.equal(redirect.json().data.status,"redirect");assert.equal(redirect.json().data.tenantId,undefined);
 const url=`/sites/${c.site.id}/commerce?workspaceId=${c.workspaceId}`;
 assert.equal((await app.inject({method:"GET",url,headers:{authorization:"editor"}})).json().data.settings.mode,"WHATSAPP");
 assert.equal((await app.inject({method:"PUT",url,headers:{authorization:"editor"},payload:{settings:{mode:"WHATSAPP_CART"}}})).statusCode,403,"Atendente não muda a configuração comercial");
 const saved=await app.inject({method:"PUT",url,headers:{authorization:"admin"},payload:{settings:{mode:"WHATSAPP_CART",notifyTeam:true}}});
 assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().data.settings.mode,"WHATSAPP_CART");assert.equal(saved.json().data.configured,true);
 assert.equal((await app.inject({method:"GET",url:`/sites/${c.site.id}/sales-intents?workspaceId=${c.workspaceId}`,headers:{authorization:"viewer"}})).json().data.length,1);
 const other=await commerce();
 assert.equal((await app.inject({method:"GET",url:`/sites/${other.site.id}/commerce?workspaceId=${c.workspaceId}`,headers:{authorization:"admin"}})).statusCode,404,"site de outro tenant");
 await app.close();
});

test("produto na conversa: busca no catálogo, envia card sem copiar nada e leva para a oportunidade respeitando a regra",async()=>{
 const c=await commerce();
 const {conversation}=await c.inbound("Oi, vocês têm calça?",{phone:"+5511944443333"});
 const deps={inbox:c.inbox,productRepository:c.d.productRepository,salesCatalogRepository:c.d.salesCatalogRepository,productEngineRepository:c.d.productEngineRepository,siteRepository:c.siteDeps.repository,publicBaseDomain:"sites.vorix.test",crmBridge:c.siteLead.crmBridge,sales:c.siteLead.sales,crm:c.siteLead.crm};
 const found=await searchConversationProducts(deps,{...c.scope,search:"calça"});
 assert.equal(found.length,1);assert.equal(found[0].requiresVariant,true);assert.equal(found[0].variants.length,3);
 assert.equal(found[0].siteUrl,`https://${c.site.slug}.sites.vorix.test/produto/calca-jeans`);
 const message=await sendProductToConversation(deps,{...c.scope,conversationId:conversation.id,userId:c.actor.userId,productId:c.productB.id,variantId:c.variantM.id,withImage:true});
 assert.equal(message.direction,"outbound");
 assert.match(message.body,/\*Calça Jeans — M\*/);assert.match(message.body,/R\$\s?159,90/);assert.match(message.body,/Veja mais: https:\/\/.+\/produto\/calca-jeans/);
 const actor={tenantId:c.tenantId,userId:c.actor.userId,role:"owner"};
 assert.equal((await addProductToConversationOpportunity(deps,actor,{workspaceId:c.workspaceId,conversationId:conversation.id,productId:c.productB.id,variantId:c.variantM.id,quantity:1})).status,"no_deal","sem oportunidade: só cria quando pedido");
 await assert.rejects(addProductToConversationOpportunity(deps,{tenantId:c.tenantId,userId:"user-leitura",role:"viewer"},{workspaceId:c.workspaceId,conversationId:conversation.id,productId:c.productB.id,variantId:c.variantM.id,quantity:1,createIfMissing:true}),/permissão/);
 const created=await addProductToConversationOpportunity(deps,actor,{workspaceId:c.workspaceId,conversationId:conversation.id,productId:c.productB.id,variantId:c.variantM.id,quantity:1,createIfMissing:true});
 assert.equal(created.status,"added");assert.equal(created.created,true);
 const added=await addProductToConversationOpportunity(deps,actor,{workspaceId:c.workspaceId,conversationId:conversation.id,productId:c.productA.id,quantity:2});
 assert.equal(added.dealId,created.dealId);assert.equal(added.created,false);
 assert.equal((await c.d.dealItemRepository.listByDeal(created.dealId)).length,2);
 const other=await commerce();
 await assert.rejects(sendProductToConversation(deps,{...c.scope,conversationId:conversation.id,userId:c.actor.userId,productId:other.productA.id,withImage:false}),/CONVERSATION_PRODUCT_NOT_FOUND/);
});

test("compartilhar produto sem Site: texto integral, link opaco, preço/foto da variação e página sem dados internos",async()=>{
 const c=await commerce(),{conversation}=await c.inbound("Quero detalhes",{phone:"+5511966665555"});
 const description="INFORMAÇÕES TÉCNICAS\n"+"Potência 4 W. Vidro âmbar. Dimensões completas.\n".repeat(45)+"FIM DA DESCRIÇÃO SEM CORTE";
 await c.d.productRepository.update(c.productB.id,{description,details:{...c.productB.details,siteVisible:false}});
 const key=`assets/${c.tenantId}/${c.workspaceId}/products/foto-variante.webp`;
 const original=await sharp({create:{width:40,height:80,channels:3,background:{r:180,g:30,b:10}}}).webp().toBuffer();
 const imageUrl=`https://storage.fixture/uploads/${key}`;
 await c.d.salesCatalogRepository.updateVariant(c.variantM.id,{imageUrl,priceOverride:true,listPriceCents:17990,costCents:5000});
 const photos=[];
 const objectStorage={resolvePublicUrl:key=>`https://storage.fixture/uploads/${key}`,read:async requested=>{assert.equal(requested,key);return original;}};
 const shareLinks=createProductShareCodec("product-sharing-fixture-secret-32-chars");
 const deps={inbox:{...c.inbox,inboxMediaStorage:{put:async input=>photos.push(input)}},productRepository:c.d.productRepository,salesCatalogRepository:c.d.salesCatalogRepository,productEngineRepository:c.d.productEngineRepository,objectStorage,appBaseUrl:"https://vorix.fixture",shareLinks};
 const found=await searchConversationProducts(deps,{...c.scope,search:"calça"});
 assert.equal(found[0].description,description);assert.equal(found[0].hasDetailsLink,true);assert.equal(found[0].siteUrl,undefined);
 const message=await sendProductToConversation(deps,{...c.scope,conversationId:conversation.id,userId:c.actor.userId,productId:c.productB.id,variantId:c.variantM.id,withImage:true});
 assert.equal(message.type,"text");assert.ok(message.body.includes(description));assert.match(message.body,/R\$\s?179,90/);
 const url=message.body.match(/Veja mais: (\S+)/)[1],token=new URL(url).pathname.split("/").pop();
 assert.ok(url.startsWith("https://vorix.fixture/produto/"));assert.ok(!token.includes(c.productB.id));
 assert.equal(photos.length,1);assert.equal(photos[0].contentType,"image/jpeg");
 const dimensions=await sharp(photos[0].body).metadata();assert.equal(dimensions.width,40);assert.equal(dimensions.height,80,"a foto não é cortada");
 const outbound=(await c.inbox.messageRepository.listByConversation({...c.scope,conversationId:conversation.id,limit:20})).filter(m=>m.direction==="outbound");
 assert.equal(outbound.length,2);assert.ok(outbound.find(m=>m.type==="image").body.length<=1024);
 const publicDeps={...deps,workspaceRepository:c.workspaceRepository};
 const publicProduct=await getSharedProduct(publicDeps,token);
 assert.equal(publicProduct.description,description);assert.equal(publicProduct.priceCents,17990);assert.equal(publicProduct.selectedVariant,c.variantM.name);assert.equal(publicProduct.images[0],imageUrl);
 for(const privateField of ["id","tenantId","workspaceId","costCents","minimumPriceCents","stockQuantity","taxMetadata"])assert.equal(privateField in publicProduct,false);
 assert.equal(JSON.stringify(publicProduct).includes("costCents"),false);
 const app=Fastify();registerErrorHandler(app);await registerPublicProductsRoutes(app,publicDeps);
 try{const response=await app.inject(`/public/products?token=${token}`);assert.equal(response.statusCode,200);assert.equal(response.headers["cache-control"],"private, no-store");assert.equal((await app.inject(`/public/products?token=${token.slice(0,-3)}bad`)).statusCode,404);}finally{await app.close();}
 const wrongScope=shareLinks.create({...c.scope,tenantId:"tenant-other",productId:c.productB.id});await assert.rejects(getSharedProduct(publicDeps,wrongScope),/PUBLIC_PRODUCT_NOT_FOUND/);
 const textOnly=await sendProductToConversation(deps,{...c.scope,conversationId:conversation.id,userId:c.actor.userId,productId:c.productB.id,variantId:c.variantM.id,withImage:false});
 assert.equal(textOnly.type,"text");assert.ok(textOnly.body.includes(description));assert.match(textOnly.body,/Veja mais: https:\/\/vorix.fixture\/produto\//);assert.equal(photos.length,1);
 await c.d.productRepository.update(c.productB.id,{active:false});await assert.rejects(getSharedProduct(publicDeps,token),/PUBLIC_PRODUCT_NOT_FOUND/);
});

test("link de produto: autenticação do token, persistência entre instâncias e rejeição de adulteração",()=>{
 const secret="secret-product-link-test-more-than-32";
 const a=createProductShareCodec(secret),b=createProductShareCodec(secret),other=createProductShareCodec("different-product-link-secret-32-chars");
 const identity={tenantId:"tenant-a",workspaceId:"ws-a",productId:"p-a",variantId:"v-a"},token=a.create(identity);
 assert.deepEqual(b.read(token),identity);assert.equal(other.read(token),undefined);
 assert.equal(a.read(token.slice(0,-8)+"AAAAAAAA"),undefined);assert.equal(a.read("invalid"),undefined);assert.equal(a.read("a".repeat(2100)),undefined);
 assert.notEqual(a.create(identity),token);
});

test("intenções comerciais: só global vê tudo; anônima segue a equipe de roteamento do site; outra equipe não vê",async()=>{
 const c=await commerce();
 await startProductWhatsapp(c.siteDeps,{lookup:c.lookup,productId:c.productA.id,requestKey:randomUUID()});
 const list=visibility=>c.commerceRepository.listIntents({tenantId:c.tenantId,workspaceId:c.workspaceId,siteId:c.site.id,limit:50,visibility});
 assert.equal((await list({global:true,teamIds:[],ownerUserIds:[]})).length,1);
 assert.equal((await list({global:false,teamIds:["team-routing"],ownerUserIds:["user-x"]})).length,0,"sem equipe de roteamento configurada ninguém de equipe vê");
 await saveSiteCommerceSettings(c.siteDeps,{site:c.site,settings:{mode:"WHATSAPP"},actorUserId:c.actor.userId});
 await db.pool.query("update site_commerce_settings set settings=jsonb_set(settings,'{teamId}','\"team-routing\"') where site_id=$1",[c.site.id]);
 assert.equal((await list({global:false,teamIds:["team-routing"],ownerUserIds:[]})).length,1,"anônima: equipe de roteamento do site");
 assert.equal((await list({global:false,teamIds:["outra-equipe"],ownerUserIds:["user-x"]})).length,0,"outra equipe não vê");
});
