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
import {publishSite,publicSite,publicCatalogPage} from "../dist/application/sites/site-use-cases.js";
import {generateVariantGrid} from "../dist/application/sales/catalog-use-cases.js";
import {saveSiteCommerceSettings,setPublicCartItem} from "../dist/application/sites/site-commerce-use-cases.js";
import {quoteCheckout,placeOrder,getPublicOrder,simulateSandboxPayment,expireAwaitingOrders,cancelOrder,advanceOrder,getOrderDetail,handlePaymentWebhook,siteCheckoutStatus,saveCommerceCredential} from "../dist/application/commerce/checkout-use-cases.js";
import {setStockQuantity} from "../dist/application/sales/stock-use-cases.js";
import {registerCommerceRoutes} from "../dist/interfaces/api/routes/v1/commerce.route.js";
import {PostgresSiteCommerceRepository} from "../dist/infrastructure/storage/postgres/postgres-site-commerce-repository.js";
import {PostgresCommerceOrderRepository} from "../dist/infrastructure/storage/postgres/postgres-commerce-order-repository.js";
import {PostgresContactIdentityRepository} from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import {SandboxPaymentProvider,MercadoPagoPaymentProvider} from "../dist/infrastructure/commerce/payment-providers.js";
import {OwnShippingProvider} from "../dist/infrastructure/commerce/shipping-providers.js";
import {quoteOwnShipping,shippingSettingsSchema} from "../dist/domain/commerce/shipping.js";
import {assertOrderTransition,validTaxDocument,orderTotals} from "../dist/domain/commerce/order.model.js";
import {resolveProductCommerce,siteCommerceSettingsSchema,checkoutReadiness} from "../dist/domain/sites/site-commerce.js";
import {PostgresSiteAnalyticsRepository} from "../dist/infrastructure/storage/postgres/postgres-site-analytics-repository.js";
import {analyticsRange} from "../dist/domain/sites/site-analytics.js";

let db;before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});after(async()=>{await db?.stop();});
const visible=(value={})=>({...defaultProductDetails(),siteVisible:true,...value});
const q=async(sql,params)=>(await db.pool.query(sql,params)).rows;
const CUSTOMER={name:"Maria Compradora",email:"maria@cliente.test",phone:"(11) 98888-7777"};
const ADDRESS={postalCode:"01310-100",street:"Av. Paulista",number:"1000",district:"Bela Vista",city:"São Paulo",state:"sp"};
const READY={mode:"HYBRID",checkout:{payment:{provider:"SANDBOX"},shipping:{pickup:{enabled:true,address:"Rua da Loja, 10"},fixed:{enabled:true,label:"Entrega padrão",priceCents:1500,days:5},freeShipping:{enabled:true,minSubtotalCents:50000,days:7},regions:[{from:"01000000",to:"19999999"}],table:[{id:"capital",label:"Expresso capital",from:"01000000",to:"05999999",priceCents:2500,days:1}]}}};

/** Loja publicada com A (geral, sem estoque controlado), B (vestuário P/M com estoque 5 cada) e veículo. */
async function store({settings=READY,mercadoPagoFetch}={}){
 const c=await productSiteContext(db.pool);
 const commerceRepository=new PostgresSiteCommerceRepository(db.pool);const orders=new PostgresCommerceOrderRepository(db.pool);
 const vault=new Map();const secrets={get:async ref=>vault.get(ref),put:async(ref,value)=>{vault.set(ref,value);},delete:async ref=>{vault.delete(ref);}};
 const checkout={secrets,sandboxAllowed:true};
 const siteDeps={...c.siteDeps,commerceRepository,checkoutStatus:(site,value)=>siteCheckoutStatus(checkout,site,value)};
 const site=await c.siteDeps.repository.create({...c.scope,slug:"loja-"+randomUUID().slice(0,8),draft:{content:siteContentSchema.parse({name:"Loja Teste",whatsapp:"5511988887777",blocks:[{id:"catalog",type:"catalog",title:"Catálogo"}]}),theme:siteThemeSchema.parse({})}});
 await publishSite(siteDeps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});
 const a=await c.product({name:"Caneca",priceCents:3000,details:visible({slug:"caneca",shipping:{weightGrams:400,heightCm:10,widthCm:10,lengthCm:10}})});
 const b=await c.product({name:"Camiseta",priceCents:5000,trackStock:true,details:visible({type:"APPAREL",slug:"camiseta",options:[{key:"size",name:"Tamanho",values:["P","M"]}]})});
 const variants=await generateVariantGrid(c.d,{...c.scope,productId:b.id});const m=variants.find(v=>v.optionValues.size==="M"),p=variants.find(v=>v.optionValues.size==="P");
 for(const variant of variants)await c.d.productEngineRepository.move({...c.scope,productId:b.id,variantId:variant.id,kind:"IN",quantity:5,operationKey:randomUUID(),userId:c.actor.userId});
 const vehicle=await c.product({name:"Carro",priceCents:9000000,details:visible({type:"VEHICLE",slug:"carro",vehicle:{make:"M",model:"X",manufactureYear:2023,modelYear:2024,mileage:1,condition:"used",features:[]}})});
 await saveSiteCommerceSettings(siteDeps,{site,settings,actorUserId:c.actor.userId});
 const sales={...c.d};
 const logs=[];const deps={...siteDeps,...checkout,log:(event,data)=>logs.push({event,...data}),orders,paymentProviders:{SANDBOX:new SandboxPaymentProvider(),MERCADO_PAGO:new MercadoPagoPaymentProvider({fetch:mercadoPagoFetch})},shippingProviders:{OWN:new OwnShippingProvider()},
  crm:{orders,contact:{contactRepository:c.d.contactRepository,contactIdentityRepository:new PostgresContactIdentityRepository(db.pool),timelineEventRepository:c.d.timelineEventRepository},crm:{dealRepository:c.d.dealRepository,pipelineRepository:c.d.pipelineRepository,pipelineStageRepository:c.d.pipelineStageRepository,timelineEventRepository:c.d.timelineEventRepository,sales},sales}};
 const lookup={slug:site.slug};
 const cart=async(lines)=>{let token;for(const line of lines)token=(await setPublicCartItem(deps,{lookup,token,...line})).token;return token;};
 const stock=async(variant)=>(await q("select stock_quantity::int s,reserved_quantity::int r from product_variants where id=$1",[variant.id]))[0];
 const scope={tenantId:c.tenantId,workspaceId:c.workspaceId,actorUserId:c.actor.userId};
 return {...c,site,deps,siteDeps,orders,lookup,a,b,m,p,vehicle,cart,stock,scope,vault,logs};
}
const order=(s,token,extra={})=>placeOrder(s.deps,{lookup:s.lookup,token,requestKey:randomUUID(),customer:CUSTOMER,deliveryOptionId:"pickup",payment:{method:"SANDBOX"},sessionId:"sess-checkout-1",utm:{source:"google",campaign:"verao"},...extra});
const byNumber=async(s,number)=>(await q("select id from commerce_orders where workspace_id=$1 and number=$2",[s.workspaceId,number]))[0].id;

test("domínio: transições válidas, totais, documento e frete próprio sem valor inventado",()=>{
 assertOrderTransition("AWAITING_PAYMENT","PAID");assert.throws(()=>assertOrderTransition("DELIVERED","CANCELLED"),/ORDER_TRANSITION_INVALID/);assert.throws(()=>assertOrderTransition("PENDING","SHIPPED"));
 assert.deepEqual(orderTotals([{unitPriceCents:1000,quantity:2}],500,300),{subtotalCents:2000,discountCents:300,shippingCents:500,totalCents:2200});
 assert.equal(validTaxDocument("529.982.247-25"),true);assert.equal(validTaxDocument("111.111.111-11"),false);assert.equal(validTaxDocument("11.222.333/0001-81"),true);
 const settings=shippingSettingsSchema.parse(READY.checkout.shipping);
 const ids=postal=>quoteOwnShipping(settings,{destinationPostalCode:postal,subtotalCents:1000,items:[]}).map(o=>o.id);
 assert.deepEqual(ids("01310100"),["pickup","fixed","table:capital"]);
 assert.deepEqual(ids("80000000"),["pickup"],"fora das regiões atendidas: só retirada");
 assert.deepEqual(quoteOwnShipping(settings,{destinationPostalCode:"02000000",subtotalCents:60000,items:[]}).map(o=>o.id),["pickup","free","fixed","table:capital"]);
 assert.deepEqual(quoteOwnShipping(shippingSettingsSchema.parse({}),{destinationPostalCode:"01310100",subtotalCents:1000,items:[]}),[],"sem método configurado, não há opção");
 const unready=siteCommerceSettingsSchema.parse({mode:"ONLINE_CHECKOUT"});
 assert.deepEqual(checkoutReadiness(unready,{paymentCredentialReady:false,sandboxAllowed:false}).length,2);
 const product={type:"GENERAL",trackStock:false,priceCents:1000};
 assert.equal(resolveProductCommerce({settings:unready,hasWhatsapp:true,contactForm:true,checkoutReady:false,product}).saleMode,"WHATSAPP_DIRECT","loja não pronta: nunca mostra compra");
 assert.equal(resolveProductCommerce({settings:unready,hasWhatsapp:true,contactForm:true,checkoutReady:true,product}).saleMode,"ONLINE_CHECKOUT");
 assert.equal(resolveProductCommerce({settings:unready,hasWhatsapp:true,contactForm:true,checkoutReady:true,product:{...product,priceCents:0}}).saleMode,"WHATSAPP_DIRECT","sem preço válido não vende online");
 assert.equal(resolveProductCommerce({settings:unready,hasWhatsapp:true,contactForm:true,checkoutReady:true,product:{type:"REAL_ESTATE",trackStock:false,priceCents:1}}).saleMode,"WHATSAPP_DIRECT","imóvel nunca é forçado ao checkout");
});

test("modo híbrido real: camiseta compra online, veículo conversa, override vitrine, loja sem pagamento não vende",async()=>{
 const s=await store();
 let data=await publicSite(s.siteDeps,s.lookup);
 const by=id=>data.products.find(p=>p.id===id).commerce;
 assert.equal(data.commerce.checkoutAvailable,true);assert.equal(data.commerce.sandbox,true);
 assert.equal(by(s.b.id).saleMode,"ONLINE_CHECKOUT");assert.ok(by(s.b.id).allowedActions.includes("buy_now"));
 assert.equal(by(s.vehicle.id).saleMode,"WHATSAPP_DIRECT");
 await s.d.productRepository.update(s.a.id,{details:visible({slug:"caneca",saleMode:"SHOW_ONLY"})});
 data=await publicSite(s.siteDeps,s.lookup);assert.equal(by(s.a.id).saleMode,"SHOW_ONLY");
 await saveSiteCommerceSettings(s.siteDeps,{site:s.site,settings:{mode:"HYBRID"},actorUserId:s.actor.userId});
 data=await publicSite(s.siteDeps,s.lookup);
 assert.equal(data.commerce.checkoutAvailable,false);assert.equal(by(s.b.id).saleMode,"WHATSAPP_CART","sem pagamento configurado volta ao carrinho do WhatsApp");
});

test("checkout visitante com variação + retirada: total no servidor, reserva, contato, carrinho vira pedido; repetir não duplica",async()=>{
 const s=await store();
 const token=await s.cart([{productId:s.a.id,quantity:2},{productId:s.b.id,variantId:s.m.id,quantity:1}]);
 const quote=await quoteCheckout(s.deps,{lookup:s.lookup,token,postalCode:"01310100"});
 assert.equal(quote.subtotalCents,11000);assert.deepEqual(quote.shippingOptions.map(o=>o.id),["pickup","fixed","table:capital"]);assert.equal(quote.sandbox,true);
 const requestKey=randomUUID();
 const placed=await placeOrder(s.deps,{lookup:s.lookup,token,requestKey,customer:CUSTOMER,deliveryOptionId:"pickup",payment:{method:"SANDBOX"},sessionId:"sess-checkout-1",utm:{source:"google"}});
 assert.equal(placed.status,"AWAITING_PAYMENT");assert.equal(placed.totalCents,11000);assert.equal(placed.shippingCents,0);assert.ok(placed.publicToken);assert.equal(placed.payment.instructions.sandbox,true);
 assert.deepEqual(await s.stock(s.m),{s:5,r:1},"reservado, não baixado");
 const again=await placeOrder(s.deps,{lookup:s.lookup,token,requestKey,customer:CUSTOMER,deliveryOptionId:"pickup",payment:{method:"SANDBOX"}});
 // Mesmo requestKey (retry após falha de rede): mesmo pedido e mesmo link, sem reservar de novo.
 assert.equal(again.repeated,true);assert.equal(again.number,placed.number);assert.equal(again.publicToken,placed.publicToken);
 assert.equal((await q("select count(*)::int n from commerce_orders where workspace_id=$1",[s.workspaceId]))[0].n,1);
 assert.deepEqual(await s.stock(s.m),{s:5,r:1});
 const id=await byNumber(s,placed.number);const detail=await getOrderDetail(s.deps,s.scope,id);
 assert.equal(detail.order.items.length,2);assert.equal(detail.order.items.find(i=>i.variantId===s.m.id).variantLabel,"Tamanho: M");
 assert.equal(detail.order.utm.source,"google");assert.ok(detail.order.contactId);
 assert.equal((await q("select origin from contacts where id=$1",[detail.order.contactId]))[0].origin,"site");
 assert.equal((await q("select status from site_carts where id=$1",[detail.order.cartId]))[0].status,"ORDERED");
 assert.deepEqual((await q("select type from site_events where order_id=$1 order by created_at",[id])).map(r=>r.type).sort(),["ORDER_CREATED","PAYMENT_STARTED"]);
 const publicView=await getPublicOrder(s.deps,{publicToken:placed.publicToken});
 assert.equal(publicView.number,placed.number);assert.equal(publicView.customerName,"Maria");assert.equal(publicView.contactId,undefined);
 await assert.rejects(getPublicOrder(s.deps,{publicToken:"x".repeat(32)}),/SITE_NOT_FOUND/);
});

test("pagamento aprovado vira venda uma vez só; webhook duplicado não baixa de novo; recusado libera a reserva",async()=>{
 const s=await store();
 const placed=await order(s,await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:2}]));
 const id=await byNumber(s,placed.number);
 assert.equal((await simulateSandboxPayment(s.deps,s.scope,{id,outcome:"APPROVED"})).status,"paid");
 assert.deepEqual(await s.stock(s.m),{s:3,r:0},"reserva convertida em baixa definitiva");
 assert.equal((await simulateSandboxPayment(s.deps,s.scope,{id,outcome:"APPROVED"})).status,"duplicate");
 assert.deepEqual(await s.stock(s.m),{s:3,r:0},"sem dupla baixa");
 const detail=await getOrderDetail(s.deps,s.scope,id);assert.equal(detail.order.status,"PAID");assert.equal(detail.order.stockState,"SOLD");assert.equal(detail.payments[0].status,"APPROVED");
 assert.ok(detail.events.some(e=>e.type==="payment_approved"));
 assert.deepEqual((await q("select type from site_events where order_id=$1 and type in ('PAYMENT_APPROVED','ORDER_PAID')",[id])).length,2);
 const failed=await order(s,await s.cart([{productId:s.b.id,variantId:s.p.id,quantity:1}]));const failedId=await byNumber(s,failed.number);
 assert.deepEqual(await s.stock(s.p),{s:5,r:1});
 await simulateSandboxPayment(s.deps,s.scope,{id:failedId,outcome:"FAILED"});
 assert.deepEqual(await s.stock(s.p),{s:5,r:0});assert.equal((await getOrderDetail(s.deps,s.scope,failedId)).order.status,"CANCELLED");
});

test("reserva expira, devolve estoque; pagamento após expirar é estornado automaticamente",async()=>{
 const s=await store();
 const placed=await order(s,await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:1}]));const id=await byNumber(s,placed.number);
 assert.equal((await expireAwaitingOrders(s.deps)).expired,0,"ainda no prazo");
 const later={...s.deps,now:()=>new Date(Date.now()+31*60_000)};
 assert.ok((await expireAwaitingOrders(later)).expired>=1);
 assert.deepEqual(await s.stock(s.m),{s:5,r:0});
 let detail=await getOrderDetail(s.deps,s.scope,id);assert.equal(detail.order.status,"CANCELLED");assert.equal(detail.order.cancelReason,"payment_expired");assert.equal(detail.order.stockState,"RELEASED");
 assert.equal((await simulateSandboxPayment(s.deps,s.scope,{id,outcome:"APPROVED"})).status,"refunded_after_cancellation");
 detail=await getOrderDetail(s.deps,s.scope,id);assert.equal(detail.order.paymentStatus,"REFUNDED");assert.deepEqual(await s.stock(s.m),{s:5,r:0},"estoque não volta a baixar");
});

test("cancelar pedido pago antes do envio: estorna e devolve ao estoque; enviado não cancela; fluxo de status com retirada",async()=>{
 const s=await store();
 const placed=await order(s,await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:2}]));const id=await byNumber(s,placed.number);
 await simulateSandboxPayment(s.deps,s.scope,{id,outcome:"APPROVED"});
 await cancelOrder(s.deps,s.scope,{id,reason:"cliente desistiu"});
 const detail=await getOrderDetail(s.deps,s.scope,id);
 assert.equal(detail.order.status,"CANCELLED");assert.equal(detail.order.stockState,"RETURNED");assert.equal(detail.order.paymentStatus,"REFUNDED");
 assert.deepEqual(await s.stock(s.m),{s:5,r:0});
 const pickup=await order(s,await s.cart([{productId:s.a.id,quantity:1}]));const pid=await byNumber(s,pickup.number);
 await simulateSandboxPayment(s.deps,s.scope,{id:pid,outcome:"APPROVED"});
 await assert.rejects(advanceOrder(s.deps,s.scope,{id:pid,to:"SHIPPED"}),/ORDER_TRANSITION_INVALID|retirada/);
 assert.equal((await advanceOrder(s.deps,s.scope,{id:pid,to:"PROCESSING"})).shippingStatus,"READY_FOR_PICKUP");
 assert.equal((await advanceOrder(s.deps,s.scope,{id:pid,to:"DELIVERED"})).status,"DELIVERED");
 await assert.rejects(cancelOrder(s.deps,s.scope,{id:pid}),/não pode ser cancelado/);
 const shipped=await order(s,await s.cart([{productId:s.a.id,quantity:1}]),{deliveryOptionId:"fixed",address:ADDRESS});const sid=await byNumber(s,shipped.number);
 assert.equal(shipped.shippingCents,1500);assert.equal(shipped.totalCents,4500);
 await simulateSandboxPayment(s.deps,s.scope,{id:sid,outcome:"APPROVED"});await advanceOrder(s.deps,s.scope,{id:sid,to:"PROCESSING"});
 await advanceOrder(s.deps,s.scope,{id:sid,to:"SHIPPED",trackingCode:"BR123"});
 const [shipment]=await s.orders.shipments(sid);assert.equal(shipment.trackingNumber,"BR123");assert.equal(shipment.status,"SHIPPED");assert.equal(shipment.provider,"SITE");
 await assert.rejects(cancelOrder(s.deps,s.scope,{id:sid}),/não pode ser cancelado/);
});

test("frete e segurança: opção fora da região, endereço obrigatório, frete grátis por valor, documento inválido",async()=>{
 const s=await store();
 await assert.rejects(order(s,await s.cart([{productId:s.a.id,quantity:1}]),{deliveryOptionId:"fixed"}),/endereço de entrega|não está disponível/);
 await assert.rejects(order(s,await s.cart([{productId:s.a.id,quantity:1}]),{deliveryOptionId:"fixed",address:{...ADDRESS,postalCode:"80000-000"}}),/não está disponível para este CEP/);
 await assert.rejects(order(s,await s.cart([{productId:s.a.id,quantity:1}]),{deliveryOptionId:"table:capital",address:{...ADDRESS,postalCode:"06000000"}}),/não está disponível/);
 const free=await order(s,await s.cart([{productId:s.a.id,quantity:20}]),{deliveryOptionId:"free",address:ADDRESS});
 assert.equal(free.shippingCents,0);assert.equal(free.totalCents,60000);
 await assert.rejects(order(s,await s.cart([{productId:s.a.id,quantity:1}]),{customer:{...CUSTOMER,document:"111.111.111-11"}}),/CPF ou CNPJ/);
 await assert.rejects(order(s,await s.cart([{productId:s.a.id,quantity:1}]),{payment:{method:"PIX"}}),/forma de pagamento indisponível/);
 await assert.rejects(s.cart([{productId:s.vehicle.id,quantity:1}]),/não pode ser adicionado/,"veículo não entra no carrinho de compra");
});

test("estoque insuficiente e checkout simultâneo nunca vendem a mesma unidade",async()=>{
 const s=await store();
 // PGlite é uma sessão única (transações concorrentes se misturam); a disputa real é garantida pelo
 // `for update` do estoque no Postgres e verificada no smoke de produção. Aqui: três compradores
 // com o carrinho montado ao mesmo tempo, finalizando um depois do outro.
 const tokens=await Promise.all([1,2,3].map(()=>s.cart([{productId:s.b.id,variantId:s.m.id,quantity:3}])));
 const results=[];for(const token of tokens)results.push(await order(s,token).then(value=>({status:"fulfilled",value}),reason=>({status:"rejected",reason})));
 const ok=results.filter(r=>r.status==="fulfilled");
 assert.equal(ok.length,1,"só um pedido reserva 3 de 5");
 const reasons=results.filter(r=>r.status==="rejected").map(r=>r.reason.message);assert.ok(reasons.every(m=>/esgotar|disponível/.test(m)),reasons.join(" | "));
 assert.deepEqual(await s.stock(s.m),{s:5,r:3});
 assert.equal((await q("select count(*)::int n from commerce_orders where workspace_id=$1 and status<>'CANCELLED'",[s.workspaceId]))[0].n,1,"um único pedido ativo");
});

test("CRM opcional: pedido pago vira oportunidade ganha sem baixar estoque de novo; padrão é só contato",async()=>{
 const s=await store({settings:{...READY,checkout:{...READY.checkout,orderCrm:"CONTACT_AND_WON_OPPORTUNITY"}}});
 const placed=await order(s,await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:1}]),{deliveryOptionId:"fixed",address:ADDRESS});
 const id=await byNumber(s,placed.number);await simulateSandboxPayment(s.deps,s.scope,{id,outcome:"APPROVED"});
 const detail=await getOrderDetail(s.deps,s.scope,id);assert.ok(detail.order.crmDealId,JSON.stringify(s.logs));
 const deal=await s.d.dealRepository.getById(detail.order.crmDealId);assert.equal(deal.status,"won");assert.equal(deal.origin,"site_checkout");
 assert.equal((await s.d.dealItemRepository.listByDeal(deal.id)).length,2,"produto + frete");
 assert.deepEqual(await s.stock(s.m),{s:4,r:0},JSON.stringify(await q("select movement_type,delta,reserved_delta,reason,deal_id,operation_key from product_stock_movements where variant_id=$1 order by created_at",[s.m.id])));
 const plain=await store();const other=await order(plain,await plain.cart([{productId:plain.a.id,quantity:1}]));
 const oid=await byNumber(plain,other.number);await simulateSandboxPayment(plain.deps,plain.scope,{id:oid,outcome:"APPROVED"});
 assert.equal((await getOrderDetail(plain.deps,plain.scope,oid)).order.crmDealId,undefined);
 assert.equal((await q("select count(*)::int n from deals where workspace_id=$1",[plain.workspaceId]))[0].n,0);
});

test("Mercado Pago (API simulada): PIX com QR, webhook relido no provedor, duplicado ignorado, credencial do lojista no cofre",async()=>{
 const calls=[];let status="pending";
 const fetch=async(url,init={})=>{calls.push({url,method:init.method??"GET",auth:init.headers?.Authorization,idem:init.headers?.["X-Idempotency-Key"],body:init.body?JSON.parse(init.body):undefined});
  return new Response(JSON.stringify({id:987654321,status,date_of_expiration:"2030-01-01T00:00:00.000-03:00",point_of_interaction:{transaction_data:{qr_code:"00020126PIXCOPIAECOLA",qr_code_base64:"iVBORw0KGgo=",ticket_url:"https://mp.test/ticket"}}}),{status:200});};
 const s=await store({settings:{...READY,checkout:{...READY.checkout,payment:{provider:"MERCADO_PAGO",pix:true,card:false}}},mercadoPagoFetch:fetch});
 assert.equal((await siteCheckoutStatus(s.deps,s.site,(await s.deps.commerceRepository.getSettings(s.site.id)))).ready,false,"sem credencial não vende");
 await saveCommerceCredential(s.deps,s.site,"MERCADO_PAGO",{accessToken:"APP_USR-lojista-token",publicKey:"APP_USR-public"});
 const placed=await order(s,await s.cart([{productId:s.a.id,quantity:1}]),{payment:{method:"PIX"},customer:{...CUSTOMER,document:"52998224725"}});
 assert.equal(placed.payment.instructions.pixQrCode,"00020126PIXCOPIAECOLA");assert.ok(placed.payment.instructions.pixQrCodeBase64);
 const create=calls.find(c=>c.method==="POST");
 assert.equal(create.auth,"Bearer APP_USR-lojista-token");assert.equal(create.body.payment_method_id,"pix");assert.equal(create.body.transaction_amount,30);assert.ok(create.idem);
 status="approved";
 assert.equal((await handlePaymentWebhook(s.deps,{provider:"MERCADO_PAGO",siteId:s.site.id,providerPaymentId:"987654321"})).status,"paid");
 assert.equal((await handlePaymentWebhook(s.deps,{provider:"MERCADO_PAGO",siteId:s.site.id,providerPaymentId:"987654321"})).status,"duplicate");
 assert.equal((await handlePaymentWebhook(s.deps,{provider:"MERCADO_PAGO",siteId:"outro-site",providerPaymentId:"987654321"})).status,"unknown");
 assert.equal((await getPublicOrder(s.deps,{publicToken:placed.publicToken})).status,"PAID");
});

test("rotas: payload adulterado é recusado; RBAC de pedidos e credenciais; isolamento entre empresas",async()=>{
 const s=await store();const other=await store();
 const app=Fastify();app.decorateRequest("zunoContext",null);
 app.addHook("onRequest",async request=>{const header=request.headers.authorization;request.zunoContext={principal:header?{tenantId:s.tenantId,role:header,userId:s.actor.userId}:undefined};});
 await registerCommerceRoutes(app,{...s.deps,workspaceRepository:s.workspaceRepository});
 const token=await s.cart([{productId:s.a.id,quantity:1}]);
 const base={token,requestKey:randomUUID(),customer:CUSTOMER,deliveryOptionId:"pickup",payment:{method:"SANDBOX"}};
 assert.equal((await app.inject({method:"POST",url:`/public/sites/${s.site.slug}/checkout/orders`,payload:{...base,totalCents:1}})).statusCode,400,"total do navegador nunca é aceito");
 assert.equal((await app.inject({method:"POST",url:`/public/sites/${s.site.slug}/checkout/orders`,payload:{...base,payment:{method:"SANDBOX",amountCents:1}}})).statusCode,400);
 const created=await app.inject({method:"POST",url:`/public/sites/${s.site.slug}/checkout/orders`,payload:base});
 assert.equal(created.statusCode,200,created.body);assert.equal(created.json().data.totalCents,3000);
 const id=await byNumber(s,created.json().data.number);
 const ws=`?workspaceId=${s.workspaceId}`;
 assert.equal((await app.inject({method:"GET",url:`/commerce/orders${ws}`,headers:{authorization:"viewer"}})).json().data.total,1);
 assert.equal((await app.inject({method:"POST",url:`/commerce/orders/${id}/status${ws}`,headers:{authorization:"viewer"},payload:{to:"PROCESSING"}})).statusCode,403);
 assert.equal((await app.inject({method:"POST",url:`/commerce/orders/${id}/sandbox-payment${ws}`,headers:{authorization:"editor"},payload:{outcome:"APPROVED"}})).statusCode,200,"atendente opera pedidos");
 assert.equal((await app.inject({method:"PUT",url:`/sites/${s.site.id}/commerce/credentials/MERCADO_PAGO${ws}`,headers:{authorization:"editor"},payload:{accessToken:"APP_USR-xxxxxxxxxxxx"}})).statusCode,403,"atendente não mexe em gateway");
 assert.equal((await app.inject({method:"PUT",url:`/sites/${s.site.id}/commerce/credentials/MERCADO_PAGO${ws}`,headers:{authorization:"admin"},payload:{accessToken:"APP_USR-xxxxxxxxxxxx",publicKey:"APP_USR-public-key"}})).statusCode,200);
 const status=await app.inject({method:"GET",url:`/sites/${s.site.id}/commerce/checkout-status${ws}`,headers:{authorization:"admin"}});
 assert.equal(status.json().data.credentials.MERCADO_PAGO.connected,true);assert.ok(!JSON.stringify(status.json()).includes("APP_USR-xxxxxxxxxxxx"),"token nunca volta");
 assert.equal((await app.inject({method:"GET",url:`/commerce/orders/${id}${ws}`,headers:{authorization:"admin"}})).json().data.order.status,"PAID");
 const otherToken=await other.cart([{productId:other.a.id,quantity:1}]);const otherOrder=await order(other,otherToken);const otherId=await byNumber(other,otherOrder.number);
 assert.equal((await app.inject({method:"GET",url:`/commerce/orders/${otherId}${ws}`,headers:{authorization:"admin"}})).statusCode,404);
 await assert.rejects(getOrderDetail(s.deps,s.scope,otherId),/SITE_NOT_FOUND/);
 assert.equal((await app.inject({method:"POST",url:`/public/sites/${s.site.slug}/checkout/quote`,payload:{token:otherToken}})).statusCode,400,"carrinho de outra loja não abre");
 await app.close();
});

test("catálogo público paginado no banco: 24 primeiros, total, próxima página, busca, produto da URL e sitemap",async()=>{
 const s=await store();
 for(let i=0;i<30;i++)await s.product({name:`Produto ${String(i).padStart(2,"0")}`,priceCents:1000+i,details:visible({slug:`produto-${i}`})});
 const data=await publicSite(s.siteDeps,s.lookup);
 assert.equal(data.catalog.total,33);assert.equal(data.products.length,24);
 const page=await publicCatalogPage(s.siteDeps,s.lookup,{offset:24,limit:24});
 assert.equal(page.products.length,9);assert.equal(page.total,33);
 assert.equal((await publicCatalogPage(s.siteDeps,s.lookup,{offset:0,limit:24,search:"Produto 29"})).products[0].slug,"produto-29");
 const deep=await publicSite(s.siteDeps,s.lookup,undefined,{path:["produto","produto-29"]});
 assert.ok(deep.products.some(p=>p.slug==="produto-29"),"produto fora da 1ª página carrega pela URL (SEO)");
 assert.equal((await publicSite(s.siteDeps,s.lookup,undefined,{includeSlugs:true})).catalog.slugs.length,33);
 const hidden=await s.product({name:"Oculto",details:defaultProductDetails()});
 assert.equal((await publicCatalogPage(s.siteDeps,s.lookup,{offset:0,limit:48,ids:[hidden.id]})).products.length,0);
});

test("contrato com Analytics: eventos do pedido, receita por produto, cancelamento e venda única com a oportunidade ganha",async()=>{
 const s=await store({settings:{...READY,checkout:{...READY.checkout,orderCrm:"CONTACT_AND_WON_OPPORTUNITY"}}});
 const facts=async()=>q("select order_id,actor,opportunity_id,utm->>'source' source,amount_cents::int amount,currency,paid_at is not null paid,cancelled_at is not null cancelled from site_analytics_order_facts where workspace_id=$1 order by created_at",[s.workspaceId]);
 const until=async check=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}assert.fail("eventos do pedido não chegaram ao Analytics");};
 // Carrinho com dois produtos (2 canecas + 1 camiseta M), cotação e pagamento aprovado.
 const token=await s.cart([{productId:s.a.id,quantity:2},{productId:s.b.id,variantId:s.m.id,quantity:1}]);
 await quoteCheckout(s.deps,{lookup:s.lookup,token,sessionId:"sess-checkout-1",utm:{source:"google",campaign:"verao"}});
 await quoteCheckout(s.deps,{lookup:s.lookup,token,postalCode:"01310100",sessionId:"sess-checkout-1",utm:{source:"google",campaign:"verao"}});
 const paid=await order(s,token,{deliveryOptionId:"fixed",address:ADDRESS});const paidId=await byNumber(s,paid.number);
 await simulateSandboxPayment(s.deps,s.scope,{id:paidId,outcome:"APPROVED"});
 const dealId=(await getOrderDetail(s.deps,s.scope,paidId)).order.crmDealId;assert.ok(dealId);
 // Segundo pedido pago e depois cancelado: a receita dele sai do Analytics.
 const gone=await order(s,await s.cart([{productId:s.a.id,quantity:1}]),{sessionId:"sess-checkout-2"});const goneId=await byNumber(s,gone.number);
 await simulateSandboxPayment(s.deps,s.scope,{id:goneId,outcome:"APPROVED"});await cancelOrder(s.deps,s.scope,{id:goneId,reason:"cliente desistiu"});
 await until(async()=>(await facts()).filter(f=>f.paid).length===2&&(await facts()).some(f=>f.cancelled));
 const events=await q("select type,tenant_id,workspace_id,site_id,anonymous_session_id,order_id,opportunity_id,amount_cents::int amount,currency,utm->>'source' source from site_events where order_id=$1 order by created_at",[paidId]);
 assert.deepEqual(events.map(e=>e.type).sort(),["ORDER_CREATED","ORDER_PAID","PAYMENT_APPROVED","PAYMENT_STARTED"]);
 for(const e of events)assert.deepEqual([e.tenant_id,e.workspace_id,e.site_id,e.anonymous_session_id,e.source],[s.tenantId,s.workspaceId,s.site.id,"sess-checkout-1","google"]);
 const orderPaid=events.find(e=>e.type==="ORDER_PAID");assert.deepEqual([orderPaid.amount,orderPaid.currency,orderPaid.opportunity_id],[paid.totalCents,"BRL",dealId]);
 assert.deepEqual((await q("select type from site_events where site_id=$1 and type in ('CHECKOUT_STARTED','SHIPPING_QUOTED') order by type",[s.site.id])).map(e=>e.type),["CHECKOUT_STARTED","SHIPPING_QUOTED"]);
 // A mesma oportunidade também ligada a uma intenção do site (ex.: começou no WhatsApp) não pode virar segunda venda.
 await q("insert into sales_intents(id,tenant_id,workspace_id,site_id,reference,type,status,snapshot,anonymous_session_id,deal_id,expires_at,converted_at) values('intent-dup',$1,$2,$3,'VX-DUP001','PRODUCT_WHATSAPP','CONVERTED',$4,'sess-checkout-1',$5,now()+interval '1 day',now())",[s.tenantId,s.workspaceId,s.site.id,JSON.stringify({items:[{productId:s.a.id}]}),dealId]);
 const analytics=new PostgresSiteAnalyticsRepository(db.pool);
 const query={scope:{tenantId:s.tenantId,workspaceId:s.workspaceId,global:true,ownerUserIds:[],teamIds:[]},filters:{},range:analyticsRange({period:"today",timezone:"UTC"}),offset:0,limit:20,sort:"revenue"};
 const report=await analytics.report(query);
 assert.deepEqual(report.revenue,{BRL:paid.totalCents},"só o pedido pago e não cancelado, uma vez");
 assert.equal(report.metrics.SALE.count,1);assert.equal(report.metrics.ORDER.count,2);
 const product=id=>report.products.find(p=>p.key===id);
 assert.deepEqual(product(s.a.id).revenue,{BRL:6000});assert.deepEqual(product(s.b.id).revenue,{BRL:5000});
 assert.equal(product(s.a.id).metrics.SALE.count,1);assert.equal(product(s.b.id).metrics.SALE.count,1);
 assert.equal(report.acquisition.find(g=>g.utm?.source==="google")?.revenue.BRL,paid.totalCents);
 assert.deepEqual((await analytics.report({...query,filters:{productId:s.b.id}})).revenue,{BRL:5000});
 // Visão restrita: pedidos aparecem para o dono da oportunidade, nunca para quem não tem vínculo.
 const deal=(await q("select owner_user_id,team_id from deals where id=$1",[dealId]))[0];
 assert.deepEqual((await analytics.report({...query,scope:{...query.scope,global:false,ownerUserIds:["user-sem-vinculo"],teamIds:[]}})).revenue,{});
 if(deal.owner_user_id||deal.team_id)assert.deepEqual((await analytics.report({...query,scope:{...query.scope,global:false,ownerUserIds:[deal.owner_user_id??"-"],teamIds:deal.team_id?[deal.team_id]:[]}})).revenue,{BRL:paid.totalCents});
 // Outro tenant não enxerga nada desta loja.
 const other=await store();assert.deepEqual((await analytics.report({...query,scope:{...query.scope,tenantId:other.tenantId,workspaceId:other.workspaceId}})).revenue,{});
});

// ------------------------------------------------------------------ auditoria multicanal (regressões)
const mpStore=async(state)=>{
 const fetch=async(url,init={})=>new Response(JSON.stringify({id:Number(state.id),status:url.includes("/refunds")?"approved":state.status,status_detail:state.detail,date_of_expiration:"2030-01-01T00:00:00.000-03:00",point_of_interaction:{transaction_data:{qr_code:"PIX",qr_code_base64:"iVBORw0KGgo="}}}),{status:200});
 const s=await store({settings:{...READY,checkout:{...READY.checkout,orderCrm:"CONTACT_AND_WON_OPPORTUNITY",payment:{provider:"MERCADO_PAGO",pix:true,card:true}}},mercadoPagoFetch:fetch});
 await saveCommerceCredential(s.deps,s.site,"MERCADO_PAGO",{accessToken:"APP_USR-lojista",publicKey:"APP_USR-public"});
 return s;
};
const DOC={customer:{...CUSTOMER,document:"52998224725"}};

test("corrida pagamento × expiração e pagamento × cancelamento: estoque mexe uma vez só e dinheiro nunca fica preso",async()=>{
 for(let round=0;round<4;round++){
  const s=await store();
  const placed=await order(s,await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:1}]));const id=await byNumber(s,placed.number);
  const later={...s.deps,now:()=>new Date(Date.now()+31*60_000)};
  await Promise.allSettled([simulateSandboxPayment(s.deps,s.scope,{id,outcome:"APPROVED"}),round%2?cancelOrder(s.deps,s.scope,{id}):expireAwaitingOrders(later)]);
  const detail=await getOrderDetail(s.deps,s.scope,id),stock=await s.stock(s.m);
  if(detail.order.status==="PAID")assert.deepEqual(stock,{s:4,r:0});
  else{assert.equal(detail.order.status,"CANCELLED");assert.deepEqual(stock,{s:5,r:0},"reserva/venda devolvida uma vez");assert.equal(detail.payments[0].status==="APPROVED",false,"aprovado nunca fica sem estorno");}
  assert.ok(detail.events.filter(e=>e.type==="stock_released"||e.type==="stock_returned").length<=1);
 }
});

test("estorno/chargeback feito no provedor cancela o pedido, devolve estoque, sai do Analytics e perde a oportunidade",async()=>{
 const state={id:"555000111",status:"pending"};const s=await mpStore(state);
 const placed=await order(s,await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:1}]),{payment:{method:"PIX"},...DOC});const id=await byNumber(s,placed.number);
 state.status="approved";assert.equal((await handlePaymentWebhook(s.deps,{provider:"MERCADO_PAGO",siteId:s.site.id,providerPaymentId:state.id})).status,"paid");
 assert.deepEqual(await s.stock(s.m),{s:4,r:0});
 const dealId=(await getOrderDetail(s.deps,s.scope,id)).order.crmDealId;assert.ok(dealId);
 state.status="charged_back";
 assert.equal((await handlePaymentWebhook(s.deps,{provider:"MERCADO_PAGO",siteId:s.site.id,providerPaymentId:state.id})).status,"refunded");
 assert.equal((await handlePaymentWebhook(s.deps,{provider:"MERCADO_PAGO",siteId:s.site.id,providerPaymentId:state.id})).status,"duplicate");
 const detail=await getOrderDetail(s.deps,s.scope,id);
 assert.equal(detail.order.status,"CANCELLED");assert.equal(detail.order.paymentStatus,"REFUNDED");assert.equal(detail.order.stockState,"RETURNED");
 assert.deepEqual(await s.stock(s.m),{s:5,r:0});
 assert.equal((await q("select count(*)::int n from site_events where order_id=$1 and type='ORDER_CANCELLED'",[id]))[0].n,1);
 assert.equal((await s.d.dealRepository.getById(dealId)).status,"lost",JSON.stringify(s.logs.filter(l=>/crm/.test(l.event))));
});

test("cartão recusado na hora: erro claro, nada cobrado, reserva liberada e o carrinho continua para tentar de novo",async()=>{
 const state={id:"777000222",status:"rejected",detail:"cc_rejected_other_reason"};const s=await mpStore(state);
 const token=await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:1}]);
 const card={method:"CARD",cardToken:"tok-1",cardPaymentMethodId:"visa",installments:1};
 await assert.rejects(order(s,token,{payment:card,...DOC}),/recusado/);
 assert.deepEqual(await s.stock(s.m),{s:5,r:0});
 state.status="approved";state.id="777000333";
 const retry=await order(s,token,{payment:{...card,cardToken:"tok-2"},...DOC});
 assert.equal(retry.status,"PAID","o mesmo carrinho compra na nova tentativa");assert.deepEqual(await s.stock(s.m),{s:4,r:0});
});

test("pagamento aprovado cuja confirmação falhou no meio é concluído pela varredura (não expira nem estorna venda válida)",async()=>{
 const s=await store();
 const placed=await order(s,await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:1}]));const id=await byNumber(s,placed.number);
 await q("update commerce_payments set status='APPROVED' where order_id=$1",[id]);
 await expireAwaitingOrders({...s.deps,now:()=>new Date(Date.now()+31*60_000)});
 const detail=await getOrderDetail(s.deps,s.scope,id);assert.equal(detail.order.status,"PAID");assert.equal(detail.order.stockState,"SOLD");
 assert.deepEqual(await s.stock(s.m),{s:4,r:0});
});

test("produto sem controle de estoque após a venda: cancelamento ainda estorna e registra a falha de estoque",async()=>{
 const s=await store();
 const tracked=await s.product({name:"Livro",priceCents:4000,trackStock:true,details:visible({slug:"livro"})});
 await s.d.productEngineRepository.move({tenantId:s.tenantId,workspaceId:s.workspaceId,productId:tracked.id,kind:"IN",quantity:3,operationKey:randomUUID(),userId:s.actor.userId});
 const placed=await order(s,await s.cart([{productId:tracked.id,quantity:1}]));const id=await byNumber(s,placed.number);
 await simulateSandboxPayment(s.deps,s.scope,{id,outcome:"APPROVED"});
 await q("update products set track_stock=false where id=$1",[tracked.id]);
 const cancelled=await cancelOrder(s.deps,s.scope,{id});
 assert.equal(cancelled.status,"CANCELLED");
 const detail=await getOrderDetail(s.deps,s.scope,id);assert.equal(detail.order.paymentStatus,"REFUNDED");
 assert.ok(detail.events.some(e=>e.type==="stock_move_failed"));
});

test("ajuste manual de estoque não pode apagar unidades reservadas por pedidos",async()=>{
 const s=await store();
 const tracked=await s.product({name:"Vela",priceCents:2000,trackStock:true,details:visible({slug:"vela"})});
 await s.d.productEngineRepository.move({tenantId:s.tenantId,workspaceId:s.workspaceId,productId:tracked.id,kind:"IN",quantity:5,operationKey:randomUUID(),userId:s.actor.userId});
 await order(s,await s.cart([{productId:tracked.id,quantity:2}]));
 const fresh=await s.d.productRepository.getById(tracked.id);assert.equal(fresh.reservedQuantity,2);
 await assert.rejects(setStockQuantity({productRepository:s.d.productRepository,membershipRepository:{listByTenant:async()=>[]}},fresh,1,s.actor.userId),/reservada/);
 assert.equal((await setStockQuantity({productRepository:s.d.productRepository,membershipRepository:{listByTenant:async()=>[]}},fresh,7,s.actor.userId)).stockQuantity,7);
});

// ------------------------------------------------------------------ devolução parcial e estorno parcial (Site)
test("devolução parcial: pedir não repõe; recebe e repõe só o devolvido; estorno parcial uma vez; cancelamento depois estorna só o saldo",async()=>{
 const {requestReturn,receiveReturn,refundReturn,transitionReturn}=await import("../dist/application/commerce/returns-use-cases.js");
 const s=await store();
 const placed=await order(s,await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:3}]));const id=await byNumber(s,placed.number);
 await simulateSandboxPayment(s.deps,s.scope,{id,outcome:"APPROVED"});
 assert.deepEqual(await s.stock(s.m),{s:2,r:0});
 const item=(await getOrderDetail(s.deps,s.scope,id)).order.items[0];
 const key=randomUUID();
 const ret=await requestReturn(s.deps,s.scope,{orderId:id,requestKey:key,reason:"tamanho",items:[{orderItemId:item.id,quantity:2}]});
 assert.equal((await requestReturn(s.deps,s.scope,{orderId:id,requestKey:key,items:[{orderItemId:item.id,quantity:2}]})).id,ret.id,"duplo clique não cria outra");
 await assert.rejects(requestReturn(s.deps,s.scope,{orderId:id,requestKey:randomUUID(),items:[{orderItemId:item.id,quantity:2}]}),/ORDER_RETURN_VALIDATION/,"vendido 3, já devolvendo 2");
 assert.deepEqual(await s.stock(s.m),{s:2,r:0},"pedido de devolução não mexe no estoque");
 await transitionReturn(s.deps,s.scope,{returnId:ret.id,to:"APPROVED"});
 // Chegaram 2, só 1 volta a ser vendável.
 await receiveReturn(s.deps,s.scope,{returnId:ret.id,items:[{orderItemId:item.id,receivedQuantity:2,restockQuantity:1}]});
 await receiveReturn(s.deps,s.scope,{returnId:ret.id,items:[{orderItemId:item.id,receivedQuantity:2,restockQuantity:1}]});
 assert.deepEqual(await s.stock(s.m),{s:3,r:0});
 const refunded=await refundReturn(s.deps,s.scope,{returnId:ret.id});
 assert.equal(refunded.refundStatus,"REFUNDED");assert.equal(refunded.refundCents,10000);
 assert.equal((await refundReturn(s.deps,s.scope,{returnId:ret.id})).refundCents,10000,"segundo estorno da mesma devolução não acontece");
 let detail=await getOrderDetail(s.deps,s.scope,id);
 assert.equal(detail.order.paymentStatus,"PARTIALLY_REFUNDED");assert.equal(detail.payments[0].refundedCents,10000);
 // Cancelar depois: estorna só o saldo (nunca o valor cheio de novo) e devolve o estoque do que ainda estava vendido.
 await cancelOrder(s.deps,s.scope,{id,reason:"cliente desistiu do resto"});
 detail=await getOrderDetail(s.deps,s.scope,id);
 assert.equal(detail.payments[0].refundedCents,detail.payments[0].amountCents);assert.equal(detail.order.paymentStatus,"REFUNDED");
});

test("estorno parcial só quando o meio de pagamento suporta (capability)",async()=>{
 const {requestReturn,refundReturn}=await import("../dist/application/commerce/returns-use-cases.js");
 const s=await store();s.deps.paymentProviders.SANDBOX={...s.deps.paymentProviders.SANDBOX,key:"SANDBOX",methods:["SANDBOX","PIX"],partialRefund:false,
  createPayment:(...a)=>new SandboxPaymentProvider().createPayment(...a),getPayment:(...a)=>new SandboxPaymentProvider().getPayment(...a),refund:(...a)=>new SandboxPaymentProvider().refund(...a),cancel:(...a)=>new SandboxPaymentProvider().cancel(...a)};
 const placed=await order(s,await s.cart([{productId:s.b.id,variantId:s.m.id,quantity:2}]));const id=await byNumber(s,placed.number);
 await simulateSandboxPayment(s.deps,s.scope,{id,outcome:"APPROVED"});
 const item=(await getOrderDetail(s.deps,s.scope,id)).order.items[0];
 const ret=await requestReturn(s.deps,s.scope,{orderId:id,requestKey:randomUUID(),items:[{orderItemId:item.id,quantity:1}]});
 await assert.rejects(refundReturn(s.deps,s.scope,{returnId:ret.id}),/só permite estorno do valor total/);
 assert.equal((await getOrderDetail(s.deps,s.scope,id)).payments[0].refundedCents,0);
});
