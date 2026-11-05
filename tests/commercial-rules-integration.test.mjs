import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {startTestPostgres} from "./helpers/pglite-test-db.mjs";
import {productSiteContext} from "./helpers/product-site-context.mjs";
import {applyMigrations} from "../dist/infrastructure/storage/postgres/migration-runner.js";
import {siteContentSchema,siteThemeSchema} from "../dist/domain/sites/site.model.js";
import {defaultProductDetails} from "../dist/domain/products/product-details.js";
import {publishSite,publicSite} from "../dist/application/sites/site-use-cases.js";
import {saveSiteCommerceSettings,setPublicCartItem,getPublicCart,setPublicCartCoupon,checkoutPublicCartToWhatsapp} from "../dist/application/sites/site-commerce-use-cases.js";
import {saveCommercialRule} from "../dist/application/commerce/commercial-rule-use-cases.js";
import {quoteCheckout,placeOrder,getPublicOrder,siteCheckoutStatus} from "../dist/application/commerce/checkout-use-cases.js";
import {generateVariantGrid} from "../dist/application/sales/catalog-use-cases.js";
import {PostgresSiteCommerceRepository} from "../dist/infrastructure/storage/postgres/postgres-site-commerce-repository.js";
import {PostgresCommercialRuleRepository} from "../dist/infrastructure/storage/postgres/postgres-commercial-rule-repository.js";
import {PostgresCommerceOrderRepository} from "../dist/infrastructure/storage/postgres/postgres-commerce-order-repository.js";
import {SandboxPaymentProvider} from "../dist/infrastructure/commerce/payment-providers.js";
import {OwnShippingProvider} from "../dist/infrastructure/commerce/shipping-providers.js";
import {defaultReturnRefundCents} from "../dist/application/commerce/returns-use-cases.js";
const initial=JSON.parse(await readFile(new URL("../config/commercial-rules/bambilu-kids-progressive.json",import.meta.url),"utf8")).definition;
let db;
before(async()=>{db=await startTestPostgres();await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));});
after(async()=>{await db?.stop();});
async function store(){
 const c=await productSiteContext(db.pool),commerceRepository=new PostgresSiteCommerceRepository(db.pool),commercialRules=new PostgresCommercialRuleRepository(db.pool),orders=new PostgresCommerceOrderRepository(db.pool);
 const checkout={sandboxAllowed:true},deps={...c.siteDeps,commerceRepository,commercialRules,orders,...checkout,paymentProviders:{SANDBOX:new SandboxPaymentProvider()},shippingProviders:{OWN:new OwnShippingProvider()},checkoutStatus:(site,settings)=>siteCheckoutStatus(checkout,site,settings)};
 const site=await deps.repository.create({...c.scope,slug:"rules-"+randomUUID().slice(0,8),draft:{theme:siteThemeSchema.parse({}),content:siteContentSchema.parse({name:"Loja de regras",whatsapp:"5511999990000"})}});
 await publishSite(deps,{...c.scope,id:site.id,revision:site.revision,actorUserId:c.actor.userId});
 await saveSiteCommerceSettings(deps,{site,actorUserId:c.actor.userId,settings:{mode:"ONLINE_CHECKOUT",checkout:{payment:{provider:"SANDBOX"},shipping:{pickup:{enabled:true,address:"Rua de teste, 1"},fixed:{enabled:true,label:"Entrega",priceCents:3000,days:1}}}}});
 const a=await c.product({name:"Produto A",priceCents:6000,details:{...defaultProductDetails(),siteVisible:true,slug:"a"}}),b=await c.product({name:"Produto B",priceCents:6000,details:{...defaultProductDetails(),type:"APPAREL",siteVisible:true,slug:"b",options:[{key:"size",name:"Tamanho",values:["M","G"]}]}});
 const variants=await generateVariantGrid(c.d,{...c.scope,productId:b.id});
 const scope={...c.scope,siteId:site.id},lookup={slug:site.slug};
 const save=(definition=initial,update)=>saveCommercialRule(deps,scope,definition,c.actor.userId,update);
 const set=(token,product,quantity,variantId)=>setPublicCartItem(deps,{lookup,token,productId:product.id,quantity,variantId});
 return {...c,deps,scope,lookup,site,a,b,variants,save,set};
}
const buy=(s,token,extra={})=>placeOrder(s.deps,{lookup:s.lookup,token,requestKey:randomUUID(),customer:{name:"Cliente de teste",email:"cliente@rules.invalid",phone:"11999990000"},deliveryOptionId:"pickup",payment:{method:"SANDBOX"},...extra});
test("migrations são reaplicáveis; sem regras o carrinho e o checkout preservam o preço original",async()=>{
 await applyMigrations(db.pool,join(process.cwd(),"db/migrations"));const s=await store();const cart=await s.set(undefined,s.a,3);assert.equal(cart.subtotalCents,18000);assert.equal(cart.discountCents,0);
 const quote=await quoteCheckout(s.deps,{lookup:s.lookup,token:cart.token});assert.equal(quote.subtotalCents,18000);assert.equal(quote.discountCents,0);assert.equal(quote.finalSubtotalCents,18000);
});
test("faixas reais no carrinho e checkout, incluindo produtos e variações diferentes, remoção e quantidade",async()=>{
 const s=await store();await s.save();let cart;
 for(const [quantity,total] of [[1,6000],[2,12000],[3,16500],[4,22000],[5,25000],[6,30000],[10,50000]]){cart=await s.set(cart?.token,s.a,quantity);assert.equal(cart.subtotalCents,total);const quote=await quoteCheckout(s.deps,{lookup:s.lookup,token:cart.token});assert.equal(quote.finalSubtotalCents,total);}
 cart=await s.set(cart.token,s.a,2);cart=await s.set(cart.token,s.b,1,s.variants[0].id);cart=await s.set(cart.token,s.b,2,s.variants[1].id);assert.equal(cart.subtotalCents,25000);
 cart=await s.set(cart.token,s.b,1,s.variants[1].id);assert.equal(cart.subtotalCents,22000);cart=await s.set(cart.token,s.b,0,s.variants[0].id);assert.equal(cart.subtotalCents,16500);
 const data=await publicSite(s.deps,s.lookup);assert.equal(data.products.find(product=>product.id===s.a.id).quantityOffers[0].tiers[2].unitPriceCents,5000);
});
test("pedido congela preço original, preço aplicado, regra e faixa; editar/excluir regra não reescreve a venda",async()=>{
 const s=await store(),rule=await s.save(),cart=await s.set(undefined,s.a,5),quote=await quoteCheckout(s.deps,{lookup:s.lookup,token:cart.token});
 const order=await buy(s,cart.token,{pricingKey:quote.pricingKey});assert.equal(order.totalCents,25000);assert.equal(order.subtotalCents,30000);assert.equal(order.discountCents,5000);
 assert.equal(order.items[0].pricingSnapshot.originalUnitPriceCents,6000);assert.equal(order.items[0].pricingSnapshot.appliedUnitPriceCents,5000);assert.equal(order.items[0].pricingSnapshot.appliedRules[0].id,rule.id);assert.equal(order.items[0].pricingSnapshot.appliedRules[0].tier.minimum,5);
 const changed=await s.save({...initial,active:false},{id:rule.id,revision:rule.revision});await s.deps.commercialRules.remove(s.scope,changed.id,changed.revision,s.actor.userId);
 const historic=await getPublicOrder(s.deps,{publicToken:order.publicToken});assert.equal(historic.totalCents,25000);assert.deepEqual(historic.items[0].pricingSnapshot,order.items[0].pricingSnapshot);
 assert.equal(Number((await db.pool.query("select count(*) n from commerce_rule_audit where rule_id=$1",[rule.id])).rows[0].n),3);
});
test("preço de uma unidade no site usa o cálculo central sem aplicar o desconto duas vezes no carrinho",async()=>{
 const s=await store();await s.deps.productRepository.update(s.a.id,{priceCents:7000});const unit=await s.save();
 let catalog=await publicSite(s.deps,s.lookup);assert.equal(catalog.products.find(p=>p.id===s.a.id).priceCents,6000);assert.equal(catalog.products.find(p=>p.id===s.a.id).originalPriceCents,7000);
 const percent=await s.save({...initial,benefit:{type:"PERCENT",basisPoints:1000}},{id:unit.id,revision:unit.revision});
 catalog=await publicSite(s.deps,s.lookup);assert.equal(catalog.products.find(p=>p.id===s.b.id).variants[0].priceCents,5400);
 const cart=await s.set(undefined,s.b,1,s.variants[0].id);assert.equal(cart.subtotalCents,5400);assert.equal(cart.originalSubtotalCents,6000);assert.ok(percent.revision>unit.revision);
});
test("checkout rejeita valores desatualizados e a transação protege revisão de regras",async()=>{
 const s=await store(),rule=await s.save(),cart=await s.set(undefined,s.a,3),quote=await quoteCheckout(s.deps,{lookup:s.lookup,token:cart.token});
 await s.save({...initial,active:false},{id:rule.id,revision:rule.revision});await assert.rejects(()=>buy(s,cart.token,{pricingKey:quote.pricingKey}),/mudaram/);
 const next=await quoteCheckout(s.deps,{lookup:s.lookup,token:cart.token});assert.equal(next.finalSubtotalCents,18000);
 const original=s.deps.orders.create.bind(s.deps.orders);s.deps.orders.create=async input=>{await s.save({...initial,name:"Alteração durante a finalização"});return original(input);};
 await assert.rejects(()=>buy(s,cart.token,{pricingKey:next.pricingKey}),/mudaram/);assert.equal(Number((await db.pool.query("select count(*) n from commerce_orders where site_id=$1",[s.site.id])).rows[0].n),0);
});
test("cupom é persistido, respeita acumulação e é removido com recálculo do servidor",async()=>{
 const s=await store();const automatic=await s.save();const coupon=await s.save({...initial,name:"Cupom dez",couponCode:"DEZ10",benefit:{type:"PERCENT",basisPoints:1000}});let cart=await s.set(undefined,s.a,5);
 await assert.rejects(()=>setPublicCartCoupon(s.deps,{lookup:s.lookup,token:cart.token,code:"DEZ10"}),/acumula/);
 await s.save({...initial,allowCoupon:true},{id:automatic.id,revision:automatic.revision});cart=await setPublicCartCoupon(s.deps,{lookup:s.lookup,token:cart.token,code:"dez10"});assert.equal(cart.subtotalCents,22500);assert.equal(cart.couponCode,"DEZ10");
 assert.equal((await getPublicCart(s.deps,{lookup:s.lookup,token:cart.token})).subtotalCents,22500);
 const quote=await quoteCheckout(s.deps,{lookup:s.lookup,token:cart.token}),order=await buy(s,cart.token,{pricingKey:quote.pricingKey});assert.equal(order.totalCents,22500);assert.equal(order.items[0].totalCents,22500);assert.equal(order.items[0].pricingSnapshot.appliedUnitPriceCents,4500);assert.equal(order.items[0].pricingSnapshot.appliedRules.length,2);
 const other=await s.set(undefined,s.a,5);await setPublicCartCoupon(s.deps,{lookup:s.lookup,token:other.token,code:"DEZ10"});const removed=await setPublicCartCoupon(s.deps,{lookup:s.lookup,token:other.token});assert.equal(removed.subtotalCents,25000);
 await assert.rejects(()=>s.save({...initial,couponCode:"DEZ10"}),/cadastrado/);assert.ok(coupon.id);
});
test("escopo de tenant, referências e revisão concorrente são validados",async()=>{
 const s=await store(),foreign=await store(),rule=await s.save();assert.deepEqual(await s.deps.commercialRules.list(foreign.scope),[]);
 await assert.rejects(()=>s.save({...initial,scope:{type:"PRODUCTS",ids:[foreign.a.id]}}),/fora desta loja/);
 await assert.rejects(()=>s.save({...initial,scope:{type:"CATEGORIES",ids:["categoria-inexistente"]}}),/fora desta loja/);
 assert.equal(await s.deps.commercialRules.remove(foreign.scope,rule.id,rule.revision,s.actor.userId),false);
 await s.save({...initial,name:"Atualizada"},{id:rule.id,revision:rule.revision});await assert.rejects(()=>s.save(initial,{id:rule.id,revision:rule.revision}),/mudou/);
});
test("venda assistida congela o mesmo preço especial e total do carrinho",async()=>{
 const s=await store();await s.save();await saveSiteCommerceSettings(s.deps,{site:s.site,settings:{mode:"WHATSAPP_CART"},actorUserId:s.actor.userId});
 const cart=await s.set(undefined,s.a,5),result=await checkoutPublicCartToWhatsapp(s.deps,{lookup:s.lookup,token:cart.token,requestKey:randomUUID()});
 const intent=await s.deps.commerceRepository.getIntentByReference(result.reference);assert.equal(intent.snapshot.subtotalCents,25000);assert.equal(intent.snapshot.items[0].unitPriceCents,5000);assert.equal(intent.snapshot.items[0].totalCents,25000);assert.match(decodeURIComponent(result.whatsappUrl),/250,00/);
});
test("estorno considera desconto e distribui centavos entre devoluções sem devolver mais que o valor pago",()=>{
 const order={items:[{id:"item",unitPriceCents:6000,quantity:3,totalCents:17900,pricingSnapshot:{}}]},previous=[],amounts=[];
 for(let i=0;i<3;i++){const ret={id:`r${i}`,refundStatus:"REFUNDED",items:[{orderItemId:"item",quantity:1}]};amounts.push(defaultReturnRefundCents(order,ret,previous));previous.push(ret);}
 assert.deepEqual(amounts,[5966,5967,5967]);assert.equal(amounts.reduce((a,b)=>a+b,0),17900);
 assert.equal(defaultReturnRefundCents({items:[{id:"old",unitPriceCents:6000,quantity:2,totalCents:12000}]},{items:[{orderItemId:"old",quantity:1}]}),6000);
});
