// Cenário multicanal controlado: Site + Mercado Livre + Shopee + TikTok Shop sobre o MESMO estoque central.
// Canais simulados implementam o contrato do provider (sem rede); o resto é o código real com PostgreSQL.
import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import Fastify from "fastify";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {PostgresMarketplaceRepository} from "../dist/infrastructure/marketplaces/postgres-marketplace-repository.js";
import {PostgresSecretManager} from "../dist/infrastructure/operations/postgres-secret-manager.js";
import {MarketplaceService} from "../dist/application/marketplaces/marketplace-service.js";
import {PostgresCommerceOrderRepository} from "../dist/infrastructure/storage/postgres/postgres-commerce-order-repository.js";
import {PostgresSiteCommerceRepository} from "../dist/infrastructure/storage/postgres/postgres-site-commerce-repository.js";
import {SandboxPaymentProvider} from "../dist/infrastructure/commerce/payment-providers.js";
import {receiveReturn} from "../dist/application/commerce/returns-use-cases.js";
import {registerCommerceRoutes} from "../dist/interfaces/api/routes/v1/commerce.route.js";
import {ROLE_PERMISSIONS,effectivePermissions} from "../dist/domain/identity/identity.model.js";
import {PostgresContactRepository} from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import {PostgresContactIdentityRepository} from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";

let db,repo,secrets;
before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));repo=new PostgresMarketplaceRepository(db.pool);secrets=new PostgresSecretManager(db.pool,"fixture-multichannel-key");});
after(async()=>{await db?.stop();});
const q=async(sql,params)=>(await db.pool.query(sql,params)).rows;
const SUPPORTED={listings:"SUPPORTED",publish:"SUPPORTED",priceSync:"SUPPORTED",stockSync:"SUPPORTED",orders:"SUPPORTED",shipments:"SUPPORTED",labels:"SUPPORTED",cancelOrder:"SUPPORTED",returns:"SUPPORTED",webhooks:"SUPPORTED"};

/** Canal simulado: guarda anúncios/pedidos/devoluções em memória e registra cada escrita de estoque. */
function channel(id,applicationId,capabilities={}){
 const listings=new Map(),orders=new Map(),returns=new Map(),writes=[];
 return {id,applicationId,pkce:false,capabilities:{...SUPPORTED,...capabilities},listings,orders,returns,writes,
  authorizationUrl:()=>"https://example.test/auth",connect:async()=>{throw Error("not used");},refreshConnection:async()=>{throw Error("not used");},disconnect:async()=>{},
  account:async()=>({id:"x",name:"x",siteId:"BR",userProducts:false}),listExternalProducts:async()=>({ids:[],total:0}),
  getListing:async(_auth,listingId)=>structuredClone(listings.get(listingId)),category:async()=>({id:"c",name:"c",leaf:true,allowed:true,attributes:[]}),validateListing:async()=>[],
  createListing:async()=>{throw Error("not used");},updateListing:async()=>{},setStatus:async(_a,lid,status)=>{listings.get(lid).status=status;},
  syncPrice:async(_a,lid,price)=>{listings.get(lid).priceCents=price;},syncStock:async(_a,lid,quantity)=>{writes.push([lid,quantity]);listings.get(lid).quantity=quantity;},
  listOrders:async()=>({ids:[...orders.keys()]}),getOrder:async(_a,oid)=>{const o=orders.get(oid);if(!o)throw Error("missing");return structuredClone(o);},getReturns:async(_a,oid)=>structuredClone(returns.get(oid)??[]),
  shippingLabel:async()=>({contentType:"application/pdf",base64:"JVBERi0=",filename:"etiqueta.pdf"}),
  cancelOrder:async(_a,o)=>{const stored=orders.get(o.id);stored.state="CANCELLED";stored.externalStatus="cancelled";stored.updatedAt=new Date(Date.now()+1000).toISOString();},
  parseNotification:({rawBody})=>{const b=JSON.parse(rawBody);return b.app===applicationId?{accountId:b.shop,eventId:b.event,topic:"order",kind:b.kind??"ORDER",resource:"order:"+b.order,externalOrderId:b.order}:undefined;}};
}
const listing=(id,sellerId,quantity=0)=>({id,sellerId,title:"Caneca",categoryId:"c",priceCents:2000,quantity,status:"active",currency:"BRL",pictures:[],attributes:[],variants:[],model:"LEGACY",stockWritable:true,priceWritable:true});
let seq=0;
const extOrder=(id,accountId,listingId,quantity,state="PAID",extra={})=>({id,accountId,state,externalStatus:state.toLowerCase(),createdAt:new Date().toISOString(),updatedAt:new Date(Date.now()+(++seq)*10).toISOString(),paidAt:state==="PENDING_PAYMENT"?undefined:new Date().toISOString(),
 currency:"BRL",items:[{externalItemId:listingId,title:"Caneca",quantity,unitPriceCents:2000}],subtotalCents:2000*quantity,discountCents:0,shippingCents:990,totalCents:2000*quantity+990,
 buyer:{id:"buyer-"+id,nickname:"COMPRADOR"+id},shipment:{externalId:"ship-"+id,state:"PENDING",externalStatus:"pending",labelAvailable:true,fulfilledByMarketplace:false},data:{},...extra});

async function world(){
 const c=await productSiteContext(db.pool);
 const product=await c.product({name:"Caneca central",priceCents:2000,trackStock:true});
 await c.d.productEngineRepository.move({...c.scope,productId:product.id,kind:"IN",quantity:10,operationKey:randomUUID(),userId:c.actor.userId});
 const ml=channel("MERCADO_LIVRE","ml-app"),sp=channel("SHOPEE","sp-app"),tt=channel("TIKTOK_SHOP","tt-app");
 const orders=new PostgresCommerceOrderRepository(db.pool);
 const service=new MarketplaceService({repository:repo,secrets,releasePolicy:Object.fromEntries([ml,sp,tt].map(p=>[p.id,{availability:"BETA",tenantIds:[c.scope.tenantId]}])),providers:{MERCADO_LIVRE:ml,SHOPEE:sp,TIKTOK_SHOP:tt},catalog:c.d,canManageActor:async()=>true,orders,orderDeps:{contacts:{
  findByIdentity:async({channel,externalId})=>(await new PostgresContactIdentityRepository(db.pool).findByChannelAndExternalId(channel,externalId))?.contactId,
  create:async input=>{const contact=await new PostgresContactRepository(db.pool).create({tenantId:input.tenantId,workspaceId:input.workspaceId,name:input.name,origin:input.origin});await new PostgresContactIdentityRepository(db.pool).create({contactId:contact.id,tenantId:input.tenantId,workspaceId:input.workspaceId,channel:input.channel,externalId:input.externalId});return contact.id;}}}});
 const conns={};
 for(const [p,account] of [[ml,"ML-"+randomUUID().slice(0,8)],[sp,"SP-"+randomUUID().slice(0,8)],[tt,"TT-"+randomUUID().slice(0,8)]]){
  const id="mpconn-"+randomUUID(),credentialsRef="marketplace/"+encodeURIComponent(c.tenantId)+"/"+encodeURIComponent(c.workspaceId)+"/"+id;
  await repo.saveConnection({...c.scope,id,credentialsRef,applicationId:p.applicationId,provider:p.id,externalAccountId:account,externalAccountName:p.id,siteId:"BR",userProducts:false,safetyStock:0,status:"CONNECTED",settings:{createContacts:true},metadata:{}});
  await secrets.put(credentialsRef,{value:{accessToken:"access-"+account,refreshToken:"refresh",expiresAt:new Date(Date.now()+3600000).toISOString(),userId:account}});
  await db.pool.query("update marketplace_connections set last_sync_at=now(),orders_synced_at=now() where id=$1",[id]);
  const externalId=p.id.slice(0,2)+"-"+randomUUID().slice(0,8);p.listings.set(externalId,listing(externalId,account,10));
  await repo.saveListing({...c.scope,id:"listing-"+randomUUID(),connectionId:id,productId:product.id,externalListingId:externalId,externalCategoryId:"c",status:"active",syncStatus:"SYNCED",variantLinks:[],lastSyncedQuantity:10,lastSyncedPrice:2000});
  conns[p.id]={id,account,listing:externalId,provider:p};
 }
 const drain=async()=>{for(let i=0;i<200;i++)if(!await service.runOnce())return;throw Error("jobs did not drain");};
 const stock=async(id=product.id)=>(await q("select stock_quantity::int s,reserved_quantity::int r from products where id=$1",[id]))[0];
 const published=()=>Object.fromEntries(Object.values(conns).map(x=>[x.provider.id,x.provider.listings.get(x.listing).quantity]));
 const notify=async(id,orderId,event=randomUUID(),kind)=>{const x=conns[id];
  if(id==="MERCADO_LIVRE")return service.notification({application_id:"ml-app",user_id:x.account,topic:"orders_v2",resource:"/orders/"+orderId,_id:event});
  return service.providerNotification(id,{headers:{},url:"",rawBody:JSON.stringify({app:x.provider.applicationId,shop:x.account,order:orderId,event,kind})});};
 const byExternal=(id,orderId)=>orders.getByExternal(conns[id].id,orderId);
 const actor={...c.scope,userId:c.actor.userId};
 return {...c,product,ml,sp,tt,orders,service,conns,drain,stock,published,notify,byExternal,actor};
}

test("cenário multicanal: Site reserva, ML/Shopee/TikTok vendem, cancelamento e devolução parcial mantêm estoque e anúncios coerentes",async()=>{
 const w=await world();
 // Estoque 10, Site reserva 2 → disponível 8 em todos os anúncios.
 await w.d.productEngineRepository.move({...w.scope,productId:w.product.id,kind:"RESERVATION",quantity:2,operationKey:"site-order:reserve",userId:"site"});
 await w.drain();
 assert.deepEqual(await w.stock(),{s:10,r:2});assert.deepEqual(w.published(),{MERCADO_LIVRE:8,SHOPEE:8,TIKTOK_SHOP:8});
 // Mercado Livre vende 1.
 w.ml.orders.set("100100",extOrder("100100",w.conns.MERCADO_LIVRE.account,w.conns.MERCADO_LIVRE.listing,1));
 assert.equal((await w.notify("MERCADO_LIVRE","100100","evt-ml-1")).accepted,true);await w.drain();
 assert.deepEqual(await w.stock(),{s:9,r:2});assert.deepEqual(w.published(),{MERCADO_LIVRE:7,SHOPEE:7,TIKTOK_SHOP:7});
 const ml=await w.byExternal("MERCADO_LIVRE","100100");
 assert.equal(ml.source,"MERCADO_LIVRE");assert.equal(ml.status,"PAID");assert.equal(ml.stockState,"SOLD");assert.equal(ml.totalCents,2990);assert.ok(ml.contactId,"contato com opt-in da conexão");
 // Shopee vende 2 e TikTok vende 1.
 w.sp.orders.set("SP200",extOrder("SP200",w.conns.SHOPEE.account,w.conns.SHOPEE.listing,2));await w.notify("SHOPEE","SP200");await w.drain();
 assert.deepEqual(await w.stock(),{s:7,r:2});assert.deepEqual(w.published(),{MERCADO_LIVRE:5,SHOPEE:5,TIKTOK_SHOP:5});
 w.tt.orders.set("TT300",extOrder("TT300",w.conns.TIKTOK_SHOP.account,w.conns.TIKTOK_SHOP.listing,1));await w.notify("TIKTOK_SHOP","TT300");await w.drain();
 assert.deepEqual(await w.stock(),{s:6,r:2});assert.deepEqual(w.published(),{MERCADO_LIVRE:4,SHOPEE:4,TIKTOK_SHOP:4});
 // Webhook duplicado e evento novo do mesmo pedido: venda baixada uma vez só.
 assert.equal((await w.notify("MERCADO_LIVRE","100100","evt-ml-1")).accepted,false);
 await w.notify("MERCADO_LIVRE","100100","evt-ml-2");await w.notify("TIKTOK_SHOP","TT300");await w.drain();
 assert.deepEqual(await w.stock(),{s:6,r:2});
 assert.equal((await q("select count(*)::int n from commerce_orders where workspace_id=$1",[w.workspaceId]))[0].n,3,"pedido externo nunca duplica");
 // Fora de ordem: snapshot antigo (aguardando pagamento) não regride o pedido.
 const stale=extOrder("100100",w.conns.MERCADO_LIVRE.account,w.conns.MERCADO_LIVRE.listing,1,"PENDING_PAYMENT");stale.updatedAt=new Date(Date.now()-3600000).toISOString();
 w.ml.orders.set("100100",stale);await w.service.refreshExternalOrder(w.actor,ml.id);
 assert.equal((await w.byExternal("MERCADO_LIVRE","100100")).status,"PAID");
 // Envio e rastreio vêm do canal.
 w.tt.orders.set("TT300",{...extOrder("TT300",w.conns.TIKTOK_SHOP.account,w.conns.TIKTOK_SHOP.listing,1,"SHIPPED"),shipment:{externalId:"ship-TT300",state:"SHIPPED",externalStatus:"in_transit",carrier:"Correios",trackingNumber:"BR123TT",labelAvailable:false,fulfilledByMarketplace:false,shippedAt:new Date().toISOString()}});
 await w.notify("TIKTOK_SHOP","TT300");await w.drain();
 const tt=await w.byExternal("TIKTOK_SHOP","TT300");assert.equal(tt.status,"SHIPPED");
 const [shipment]=await w.orders.shipments(tt.id);assert.equal(shipment.trackingNumber,"BR123TT");assert.equal(shipment.status,"SHIPPED");assert.ok(shipment.events.length>=2);
 // Cancelamento do ML antes do envio devolve só o que foi baixado (uma vez).
 w.ml.orders.set("100100",{...extOrder("100100",w.conns.MERCADO_LIVRE.account,w.conns.MERCADO_LIVRE.listing,1,"CANCELLED"),cancelReason:"buyer_cancelled"});
 await w.notify("MERCADO_LIVRE","100100");await w.drain();await w.notify("MERCADO_LIVRE","100100");await w.drain();
 assert.deepEqual(await w.stock(),{s:7,r:2});assert.deepEqual(w.published(),{MERCADO_LIVRE:5,SHOPEE:5,TIKTOK_SHOP:5});
 const cancelled=await w.byExternal("MERCADO_LIVRE","100100");assert.equal(cancelled.status,"CANCELLED");assert.equal(cancelled.stockState,"RETURNED");assert.equal(cancelled.paymentStatus,"REFUNDED");
 // Devolução parcial na Shopee: pedido 2 unidades, cliente devolve 1. Pedir não mexe no estoque.
 const sp=await w.byExternal("SHOPEE","SP200");
 w.sp.orders.set("SP200",extOrder("SP200",w.conns.SHOPEE.account,w.conns.SHOPEE.listing,2,"DELIVERED"));
 w.sp.returns.set("SP200",[{id:"RET-1",orderId:"SP200",state:"REQUESTED",externalStatus:"requested",reason:"defeito",items:[{externalItemId:w.conns.SHOPEE.listing,quantity:1}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]);
 await w.notify("SHOPEE","SP200",randomUUID(),"RETURN");await w.drain();
 const [ret]=await w.orders.returns(sp.id);
 assert.equal(ret.status,"REQUESTED");assert.equal(ret.refundStatus,"MARKETPLACE");assert.equal(ret.items[0].quantity,1);assert.deepEqual(await w.stock(),{s:7,r:2});
 // Recebido e reposto: só a quantidade devolvida volta; repetir não repõe de novo.
 const deps={orders:w.orders,productEngineRepository:w.d.productEngineRepository};
 const admin={tenantId:w.tenantId,workspaceId:w.workspaceId,actorUserId:w.actor.userId};
 await receiveReturn(deps,admin,{returnId:ret.id,items:[{orderItemId:ret.items[0].orderItemId,receivedQuantity:1,restockQuantity:1}]});
 await receiveReturn(deps,admin,{returnId:ret.id,items:[{orderItemId:ret.items[0].orderItemId,receivedQuantity:1,restockQuantity:1}]});
 await w.drain();
 assert.deepEqual(await w.stock(),{s:8,r:2});assert.deepEqual(w.published(),{MERCADO_LIVRE:6,SHOPEE:6,TIKTOK_SHOP:6});
 // Mesma devolução vinda de novo do canal não duplica; quantidade acima do vendido é recusada.
 await w.notify("SHOPEE","SP200",randomUUID(),"RETURN");await w.drain();assert.equal((await w.orders.returns(sp.id)).length,1);
 await assert.rejects(w.orders.createReturn({tenantId:w.tenantId,workspaceId:w.workspaceId,orderId:sp.id,source:"SHOPEE",requestKey:randomUUID(),status:"REQUESTED",refundCents:0,refundStatus:"MARKETPLACE",items:[{orderItemId:ret.items[0].orderItemId,quantity:2}]}),/ORDER_RETURN_VALIDATION/);
 // Safety stock por canal: só a Shopee publica 1 a menos.
 await w.service.setSafetyStock(w.actor,w.conns.SHOPEE.id,1);await w.drain();
 assert.deepEqual(w.published(),{MERCADO_LIVRE:6,SHOPEE:5,TIKTOK_SHOP:6});
 // Analytics por canal (pedidos; cancelado não é venda).
 const summary=await w.orders.channelSummary({tenantId:w.tenantId,workspaceId:w.workspaceId,from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString(),global:true,teamIds:[],ownerUserIds:[]});
 const by=Object.fromEntries(summary.map(s=>[s.source,s]));
 assert.equal(by.MERCADO_LIVRE.cancellations,1);assert.equal(by.MERCADO_LIVRE.sales,0);assert.equal(by.SHOPEE.sales,1);assert.equal(by.SHOPEE.returns,1);assert.equal(by.TIKTOK_SHOP.revenueCents,2990);
});

test("última unidade vendida em dois canais ao mesmo tempo: uma venda baixa, a outra fica em CONFLICT (nada negativo, nada perdido)",async()=>{
 const w=await world();
 await w.d.productEngineRepository.move({...w.scope,productId:w.product.id,kind:"ADJUSTMENT",quantity:1,operationKey:randomUUID(),userId:"x"});
 w.ml.orders.set("200200",extOrder("200200",w.conns.MERCADO_LIVRE.account,w.conns.MERCADO_LIVRE.listing,1));
 w.sp.orders.set("B1",extOrder("B1",w.conns.SHOPEE.account,w.conns.SHOPEE.listing,1));
 await Promise.all([w.notify("MERCADO_LIVRE","200200"),w.notify("SHOPEE","B1")]);await w.drain();
 const states=[(await w.byExternal("MERCADO_LIVRE","200200")).stockState,(await w.byExternal("SHOPEE","B1")).stockState].sort();
 assert.deepEqual(states,["CONFLICT","SOLD"]);assert.deepEqual(await w.stock(),{s:0,r:0});
 assert.deepEqual(w.published(),{MERCADO_LIVRE:0,SHOPEE:0,TIKTOK_SHOP:0});
 const conflicted=(await w.byExternal("MERCADO_LIVRE","200200")).stockState==="CONFLICT"?await w.byExternal("MERCADO_LIVRE","200200"):await w.byExternal("SHOPEE","B1");
 assert.ok((await w.orders.events(conflicted.id)).some(e=>e.type==="stock_conflict"));
 // Reposição + nova sincronização resolve o conflito sem baixar duas vezes a outra venda.
 await w.d.productEngineRepository.move({...w.scope,productId:w.product.id,kind:"IN",quantity:5,operationKey:randomUUID(),userId:"x"});
 await w.service.refreshExternalOrder(w.actor,conflicted.id);
 assert.equal((await w.orders.get(conflicted.id)).stockState,"SOLD");assert.deepEqual(await w.stock(),{s:4,r:0});
});

test("estoque do próprio marketplace (Full), item sem vínculo e pedido não pago não mexem no estoque central",async()=>{
 const w=await world();
 w.ml.orders.set("300300",extOrder("300300",w.conns.MERCADO_LIVRE.account,w.conns.MERCADO_LIVRE.listing,2,"PAID",{shipment:{externalId:"s",state:"READY_TO_SHIP",externalStatus:"ready_to_ship",logisticType:"fulfillment",labelAvailable:false,fulfilledByMarketplace:true}}));
 w.ml.orders.set("300301",extOrder("300301",w.conns.MERCADO_LIVRE.account,"MLB-NAO-VINCULADO",1));
 w.ml.orders.set("300302",extOrder("300302",w.conns.MERCADO_LIVRE.account,w.conns.MERCADO_LIVRE.listing,1,"PENDING_PAYMENT"));
 for(const id of ["300300","300301","300302"])await w.notify("MERCADO_LIVRE",id);await w.drain();
 assert.deepEqual(await w.stock(),{s:10,r:0});
 assert.equal((await w.byExternal("MERCADO_LIVRE","300300")).stockState,"EXTERNAL");
 const unmapped=await w.byExternal("MERCADO_LIVRE","300301");assert.equal(unmapped.items[0].productId,"");assert.equal(unmapped.status,"PAID");
 assert.equal((await w.byExternal("MERCADO_LIVRE","300302")).status,"AWAITING_PAYMENT");
});

test("RBAC: cancelar/estornar exige permissão sensível; Atendente/Gerente sem concessão não cancelam; escopo e isolamento entre empresas",async()=>{
 assert.ok(ROLE_PERMISSIONS.owner.includes("order:cancel")&&ROLE_PERMISSIONS.owner.includes("payment:refund"));
 for(const role of ["admin","editor","viewer"])assert.ok(!ROLE_PERMISSIONS[role].includes("order:cancel")&&!ROLE_PERMISSIONS[role].includes("payment:refund"),role);
 assert.ok(effectivePermissions("admin",["order:cancel"]).includes("order:cancel"),"Gerente só por concessão explícita");
 const w=await world(),other=await world();w.allowed.add(other.tenantId);
 w.ml.orders.set("400400",extOrder("400400",w.conns.MERCADO_LIVRE.account,w.conns.MERCADO_LIVRE.listing,1));await w.notify("MERCADO_LIVRE","400400");await w.drain();
 const order=await w.byExternal("MERCADO_LIVRE","400400");
 const app=Fastify();app.decorateRequest("zunoContext",null);
 app.addHook("onRequest",async request=>{const [role,...grantParts]=String(request.headers.authorization??"").split(":");const grants=grantParts.join(":");const tenantId=request.headers["x-tenant"]??w.tenantId;
  request.zunoContext={principal:role?{tenantId,role,userId:"user-"+role,permissions:effectivePermissions(role,grants?grants.split(","):[])}:undefined};});
 await registerCommerceRoutes(app,{...w.siteDeps,commerceRepository:new PostgresSiteCommerceRepository(db.pool),orders:w.orders,paymentProviders:{SANDBOX:new SandboxPaymentProvider()},shippingProviders:{},workspaceRepository:w.workspaceRepository,
  marketplace:w.service,access:{teamMembershipRepository:w.d.teamMembershipRepository},deals:w.d.dealRepository});
 const ws=`?workspaceId=${w.workspaceId}`,cancel=headers=>app.inject({method:"POST",url:`/commerce/orders/${order.id}/cancel${ws}`,headers,payload:{reason:"teste"}});
 const detail=await app.inject({method:"GET",url:`/commerce/orders/${order.id}${ws}`,headers:{authorization:"editor"}});
 assert.equal(detail.statusCode,404,"Atendente não pode ler pedido sem vínculo com suas equipes");
 const ownerDetail=await app.inject({method:"GET",url:`/commerce/orders/${order.id}${ws}`,headers:{authorization:"owner"}});
 assert.equal(ownerDetail.statusCode,200,ownerDetail.body);assert.equal(ownerDetail.json().data.shipments.length,1);
 for(const role of ["editor","admin"]){
  const list=await app.inject({method:"GET",url:`/commerce/orders${ws}`,headers:{authorization:role}});
  assert.equal(list.json().data.total,0,"listagem e contagem não expõem pedidos fora do escopo");
  assert.equal((await app.inject({method:"POST",url:`/commerce/orders/${order.id}/status${ws}`,headers:{authorization:role},payload:{to:"PROCESSING"}})).statusCode,404);
  assert.equal((await app.inject({method:"POST",url:`/commerce/orders/${order.id}/returns${ws}`,headers:{authorization:role},payload:{requestKey:randomUUID(),items:[{orderItemId:order.items[0].id,quantity:1}]}})).statusCode,404);
 }
 assert.equal((await cancel({authorization:"editor"})).statusCode,403,"Atendente nunca cancela por padrão");
 assert.equal((await cancel({authorization:"admin"})).statusCode,403,"Gerente sem concessão");
 assert.equal((await cancel({authorization:"admin:order:cancel"})).statusCode,404,"Gerente com concessão não acessa pedido fora das equipes");
 assert.equal((await app.inject({method:"POST",url:`/commerce/orders/${order.id}/cancel?workspaceId=${other.workspaceId}`,headers:{authorization:"owner","x-tenant":other.tenantId},payload:{}})).statusCode,404,"outra empresa não enxerga o pedido");
 const deal=await w.deal();await db.pool.query("update deals set owner_user_id='user-admin' where id=$1",[deal.id]);
 await w.orders.update(order.id,{crmDealId:deal.id},{type:"qa_scope_linked",actorType:"system",data:{}});
 const ownDetail=await app.inject({method:"GET",url:`/commerce/orders/${order.id}${ws}`,headers:{authorization:"admin"}});assert.equal(ownDetail.statusCode,200,ownDetail.body);
 const ownList=await app.inject({method:"GET",url:`/commerce/orders${ws}`,headers:{authorization:"admin"}});assert.equal(ownList.json().data.total,1);
 assert.equal((await app.inject({method:"GET",url:`/commerce/orders/${order.id}${ws}`,headers:{authorization:"editor"}})).statusCode,404);
 const ok=await cancel({authorization:"owner"});assert.equal(ok.statusCode,200,ok.body);
 assert.equal((await w.orders.get(order.id)).status,"CANCELLED");assert.deepEqual(await w.stock(),{s:10,r:0});
 const label=await app.inject({method:"GET",url:`/commerce/orders/${order.id}/label${ws}`,headers:{authorization:"editor"}});assert.equal(label.statusCode,404);
 const ownerLabel=await app.inject({method:"GET",url:`/commerce/orders/${order.id}/label${ws}`,headers:{authorization:"owner"}});assert.equal(ownerLabel.statusCode,200,ownerLabel.body);assert.equal(ownerLabel.json().data.contentType,"application/pdf");
 const channels=await app.inject({method:"GET",url:`/commerce/analytics/channels${ws}&from=${new Date(Date.now()-86400000).toISOString()}&to=${new Date(Date.now()+86400000).toISOString()}`,headers:{authorization:"owner"}});
 assert.equal(channels.statusCode,200,channels.body);assert.equal(channels.json().data.totals.cancellations,1);
 // Notificação de outro app/conta não cria nada em lugar nenhum.
 assert.equal((await w.service.providerNotification("SHOPEE",{headers:{},url:"",rawBody:JSON.stringify({app:"outro-app",shop:w.conns.SHOPEE.account,order:"X",event:"e"})})).accepted,false);
 assert.equal((await w.service.providerNotification("SHOPEE",{headers:{},url:"",rawBody:JSON.stringify({app:"sp-app",shop:other.conns.SHOPEE.account+"-nao",order:"X",event:"e2"})})).accepted,false);
 await assert.rejects(other.service.refreshExternalOrder({...other.scope,userId:"u"},order.id),/MARKETPLACE_ORDER_NOT_FOUND/);
});

test("canal sem cancelamento pela API: bloqueio explícito (BLOCKED_EXTERNAL_CAPABILITY), sem tentar endpoint inventado",async()=>{
 const w=await world();w.ml.capabilities.cancelOrder="BLOCKED_EXTERNAL_CAPABILITY";
 w.ml.orders.set("500500",extOrder("500500",w.conns.MERCADO_LIVRE.account,w.conns.MERCADO_LIVRE.listing,1));await w.notify("MERCADO_LIVRE","500500");await w.drain();
 const order=await w.byExternal("MERCADO_LIVRE","500500");
 await assert.rejects(w.service.cancelExternalOrder(w.actor,order.id,"x"),/BLOCKED_EXTERNAL_CAPABILITY/);
 assert.equal((await w.orders.get(order.id)).status,"PAID");
});

test("identical seller IDs in different providers never overwrite another connection or its encrypted tokens",async()=>{
 const w=await world(),ml=await repo.connection(w.scope,w.conns.MERCADO_LIVRE.id),before=await secrets.get(ml.credentialsRef);
 const accountId=ml.externalAccountId;
 w.sp.authorizationUrl=state=>"https://example.test/authorize?state="+state;
 w.sp.connect=async()=>({accessToken:"shopee-only-token",refreshToken:"shopee-refresh",expiresAt:new Date(Date.now()+3600000).toISOString(),userId:accountId});
 w.sp.account=async()=>({id:accountId,name:"QA Shopee",siteId:"BR",userProducts:false});
 const start=await w.service.startOAuth(w.actor,"SHOPEE"),state=new URL(start.url).searchParams.get("state");
 const result=await w.service.callback(state,"qa-code",start.browserNonce,{},"SHOPEE");
 assert.notEqual(result.connectionId,ml.id);
 assert.equal((await repo.connection(w.scope,result.connectionId)).provider,"SHOPEE");
 assert.equal((await repo.connection(w.scope,ml.id)).provider,"MERCADO_LIVRE");
 assert.deepEqual(await secrets.get(ml.credentialsRef),before,"the original provider token is unchanged");
});
