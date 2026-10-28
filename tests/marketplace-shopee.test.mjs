import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {ShopeeProvider,shopeeConfig} from "../dist/infrastructure/marketplaces/shopee-provider.js";
import {MarketplaceError} from "../dist/domain/marketplaces/marketplace.model.js";

const NOW=Date.UTC(2026,9,27,12,0,0),TS=Math.floor(NOW/1000);
const config={partnerId:"1001",partnerKey:"partner-key-secret",redirectUri:"https://app.vorix.test/v1/marketplaces/shopee/callback",apiBaseUrl:"https://partner.shopeemobile.com"};
const auth={accessToken:"access-token-secret",accountId:"555",metadata:{shopId:"555"}};
const hmac=base=>createHmac("sha256",config.partnerKey).update(base).digest("hex");
const json=(body,init={})=>new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"},...init});
/** Mocked fetch: routes by pathname; records every call (url, method, parsed body). */
function mk(routes,options={}){
 const calls=[];
 const fetcher=async(url,init={})=>{
  const u=new URL(url);let body;
  if(typeof init.body==="string")body=JSON.parse(init.body);else if(init.body)body=init.body;
  calls.push({url:u,path:u.pathname,method:init.method??"GET",body,init});
  const route=routes[u.host==="partner.shopeemobile.com"?u.pathname:u.href];
  if(!route)return json({error:"error_not_found",message:"no route "+u.pathname});
  const result=await route(u,body,init);return result instanceof Response?result:json(result);
 };
 return {provider:new ShopeeProvider(config,fetcher,{minIntervalMs:0,labelPollMs:0,tierDelayMs:0,now:()=>NOW,...options}),calls};
}
const rejectsCode=(fn,code,extra=()=>true)=>assert.rejects(fn,e=>e instanceof MarketplaceError&&e.code===code&&extra(e));

test("public API signature = partner_id+path+timestamp; shop API adds access_token+shop_id", async()=>{
 const {provider,calls}=mk({
  "/api/v2/auth/token/get":()=>({access_token:"new-access",refresh_token:"new-refresh",expire_in:14400,request_id:"r"}),
  "/api/v2/shop/get_shop_info":()=>({error:"",shop_name:"Loja QA",region:"BR",status:"NORMAL"}),
 });
 await provider.connect({code:"abc123",params:{shop_id:"555"}});
 const pub=calls[0].url.searchParams;
 assert.equal(pub.get("partner_id"),"1001");assert.equal(pub.get("timestamp"),String(TS));
 assert.equal(pub.get("sign"),hmac("1001/api/v2/auth/token/get"+TS));
 assert.equal(pub.get("access_token"),null);assert.equal(pub.get("shop_id"),null);
 await provider.account(auth);
 const shop=calls[1].url.searchParams;
 assert.equal(shop.get("sign"),hmac("1001/api/v2/shop/get_shop_info"+TS+"access-token-secret"+"555"));
 assert.equal(shop.get("access_token"),"access-token-secret");assert.equal(shop.get("shop_id"),"555");
 assert.equal(calls[1].init.redirect,"error");assert.ok(calls[1].init.signal);
});

test("authorization URL: BR fixed link with state (production); legacy signed link on sandbox", ()=>{
 const {provider}=mk({});
 assert.equal(provider.pkce,false);assert.equal(provider.applicationId,"1001");
 // Guia 20: https://open.shopee.com.br/auth?partner_id&auth_type=seller&redirect_uri&response_type=code&state (state volta intacto).
 const url=new URL(provider.authorizationUrl("state-xyz","ignored-challenge"));
 assert.equal(url.origin+url.pathname,"https://open.shopee.com.br/auth");
 assert.deepEqual(Object.fromEntries(url.searchParams),{partner_id:"1001",auth_type:"seller",redirect_uri:"https://app.vorix.test/v1/marketplaces/shopee/callback",response_type:"code",state:"state-xyz"});
 const sandbox=new ShopeeProvider({...config,apiBaseUrl:"https://openplatform.sandbox.test-stable.shopee.sg"},async()=>json({}),{now:()=>NOW});
 const legacy=new URL(sandbox.authorizationUrl("state-xyz","c"));
 assert.equal(legacy.origin+legacy.pathname,"https://openplatform.sandbox.test-stable.shopee.sg/api/v2/shop/auth_partner");
 assert.equal(legacy.searchParams.get("sign"),hmac("1001/api/v2/shop/auth_partner"+TS));
 const redirect=new URL(legacy.searchParams.get("redirect"));
 assert.equal(redirect.origin+redirect.pathname,"https://app.vorix.test/v1/marketplaces/shopee/callback");
 assert.equal(redirect.searchParams.get("state"),"state-xyz");
});

test("token and refresh bodies; refresh rotates; failures map without leaking", async()=>{
 const bodies=[];const {provider}=mk({
  // Respostas planas, como no guia 20 (sem envelope `response`).
  "/api/v2/auth/token/get":(_u,b)=>{bodies.push(b);return {refresh_token:"r1",access_token:"a1",expire_in:13859,request_id:"c040",error:"",message:""};},
  "/api/v2/auth/access_token/get":(_u,b)=>{bodies.push(b);return {partner_id:1001,refresh_token:"r2",access_token:"a2",expire_in:14400,request_id:"6d79",error:"",message:"",shop_id:555};},
 });
 const tokens=await provider.connect({code:"code-1",params:{shop_id:"555",state:"s"}});
 assert.deepEqual(bodies[0],{code:"code-1",shop_id:555,partner_id:1001});
 assert.equal(tokens.userId,"555");assert.deepEqual(tokens.metadata,{shopId:"555"});
 assert.equal(tokens.expiresAt,new Date(NOW+13859000).toISOString());
 const refreshed=await provider.refreshConnection("r1",{accountId:"555",metadata:{shopId:"555"}});
 assert.deepEqual(bodies[1],{refresh_token:"r1",shop_id:555,partner_id:1001});
 assert.equal(refreshed.refreshToken,"r2");assert.equal(refreshed.userId,"555");
 await rejectsCode(()=>provider.connect({code:"c",params:{}}),"SHOPEE_SHOP_AUTHORIZATION_REQUIRED");
 await rejectsCode(()=>provider.connect({code:"c",params:{main_account_id:"9",shop_id:"555"}}),"SHOPEE_SHOP_AUTHORIZATION_REQUIRED");
 const bad=mk({"/api/v2/auth/access_token/get":()=>({error:"error_param",message:"Invalid refresh_token r1-secret"})}).provider;
 await rejectsCode(()=>bad.refreshConnection("r1-secret",{accountId:"555",metadata:{}}),"REAUTH_REQUIRED",e=>!e.message.includes("r1-secret"));
 const wrongShop=mk({"/api/v2/auth/access_token/get":()=>({access_token:"a",refresh_token:"r",expire_in:10,shop_id:999})}).provider;
 await assert.rejects(()=>wrongShop.refreshConnection("r",{accountId:"555",metadata:{}}),MarketplaceError);
 const otherList=mk({"/api/v2/auth/token/get":()=>({access_token:"a",refresh_token:"r",expire_in:10,shop_id_list:[777],error:""})}).provider;
 await rejectsCode(()=>otherList.connect({code:"c",params:{shop_id:"555"}}),"SHOPEE_AUTHORIZATION_REJECTED");
 await provider.disconnect(auth); // no-op: no per-shop revoke in v2
});

test("account requires a Brazil shop", async()=>{
 const ok=mk({"/api/v2/shop/get_shop_info":()=>({shop_name:"Loja BR",region:"BR"})}).provider;
 assert.deepEqual(await ok.account(auth),{id:"555",name:"Loja BR",siteId:"BR",userProducts:false,metadata:{shopId:"555"}});
 const sg=mk({"/api/v2/shop/get_shop_info":()=>({shop_name:"Loja SG",region:"SG"})}).provider;
 await rejectsCode(()=>sg.account(auth),"SHOPEE_ACCOUNT_REGION_UNSUPPORTED");
 await rejectsCode(()=>ok.account({...auth,metadata:{shopId:"777"}}),"SHOPEE_SHOP_MISMATCH");
});

const baseItem=(patch={})=>({item_id:3001,category_id:100182,item_name:"Camiseta QA",description:"Descrição",item_sku:"CAM-1",create_time:TS-1000,update_time:TS-10,
 attribute_list:[{attribute_id:100037,original_attribute_name:"Material",attribute_value_list:[{value_id:0,original_value_name:"Algodão"}]}],
 image:{image_url_list:["https://cf.shopee.com.br/file/abc","http://insecure.test/x"],image_id_list:["abc"]},item_status:"NORMAL",has_model:false,
 brand:{brand_id:0,original_brand_name:"NoBrand"},...patch});

test("listing normalization: simple item, variations, locks and status mapping", async()=>{
 let item=baseItem({price_info:[{currency:"BRL",original_price:59.9,current_price:59.9}],stock_info_v2:{seller_stock:[{location_id:"BRZ",stock:7}]}});
 const routes={
  "/api/v2/product/get_item_list":u=>{assert.deepEqual(u.searchParams.getAll("item_status"),["NORMAL","UNLIST"]);assert.equal(u.searchParams.get("offset"),"0");
   return {response:{item:[{item_id:3001,item_status:"NORMAL"},{item_id:3002,item_status:"UNLIST"}],total_count:150,has_next_page:true,next_offset:100}};},
  "/api/v2/product/get_item_base_info":u=>{assert.equal(u.searchParams.get("item_id_list"),"3001");return {response:{item_list:[item]}};},
  "/api/v2/product/get_model_list":()=>({response:{tier_variation:[{name:"Cor",option_list:[{option:"Azul"},{option:"Preto"}]},{name:"Tamanho",option_list:[{option:"P"},{option:"M"}]}],
   model:[{model_id:91,tier_index:[0,1],model_sku:"CAM-AZ-M",price_info:[{original_price:69.9,current_price:69.9}],stock_info_v2:{seller_stock:[{stock:3}]}},
    {model_id:92,tier_index:[1,0],model_sku:"CAM-PR-P",price_info:[{original_price:69.9,current_price:69.9}],stock_info_v2:{seller_stock:[{stock:4}]}}]}}),
 };
 const {provider}=mk(routes);
 assert.deepEqual(await provider.listExternalProducts(auth),{ids:["3001","3002"],cursor:"100",total:150});
 let l=await provider.getListing(auth,"3001");
 assert.equal(l.id,"3001");assert.equal(l.sellerId,"555");assert.equal(l.priceCents,5990);assert.equal(l.quantity,7);assert.equal(l.status,"active");
 assert.equal(l.model,"LEGACY");assert.equal(l.stockWritable,true);assert.equal(l.priceWritable,true);assert.equal(l.currency,"BRL");
 assert.deepEqual(l.pictures,["https://cf.shopee.com.br/file/abc"]);assert.equal(l.url,"https://shopee.com.br/product/555/3001");
 assert.deepEqual(l.attributes,[{id:"100037",value_name:"Algodão"},{id:"BRAND",value_id:"0",value_name:"NoBrand"}]);
 assert.equal(l.updatedAt,new Date((TS-10)*1000).toISOString());
 item=baseItem({has_model:true,item_status:"UNLIST"});
 l=await provider.getListing(auth,"3001");
 assert.equal(l.status,"paused");assert.equal(l.priceCents,6990);assert.equal(l.quantity,7);
 assert.deepEqual(l.variants,[{id:"91",sku:"CAM-AZ-M",priceCents:6990,quantity:3,options:{Cor:"Azul",Tamanho:"M"}},{id:"92",sku:"CAM-PR-P",priceCents:6990,quantity:4,options:{Cor:"Preto",Tamanho:"P"}}]);
 item=baseItem({item_status:"BANNED",has_promotion:true,price_info:[{original_price:50,current_price:40}],stock_info_v2:{seller_stock:[{stock:1}],shopee_stock:[{location_id:"BRFBS",stock:5}]}});
 l=await provider.getListing(auth,"3001");
 assert.equal(l.status,"closed");assert.equal(l.priceWritable,false);assert.equal(l.stockWritable,false);assert.equal(l.priceCents,5000);
 // has_promotion sem diferença de preço também trava preço; FBS (is_fulfillment_by_shopee) trava estoque mesmo sem shopee_stock.
 item=baseItem({has_promotion:true,is_fulfillment_by_shopee:true,price_info:[{original_price:50,current_price:50}],stock_info_v2:{seller_stock:[{stock:0}],shopee_stock:[]}});
 l=await provider.getListing(auth,"3001");assert.equal(l.priceWritable,false);assert.equal(l.stockWritable,false);
 item=baseItem({item_status:"SELLER_DELETE",price_info:[{original_price:50,current_price:50}]});
 assert.equal((await provider.getListing(auth,"3001")).status,"closed");
 item=baseItem({item_status:"NORMAL",price_info:[{original_price:50,current_price:50}],stock_info_v2:{seller_stock:[{location_id:"A",stock:1},{location_id:"B",stock:2}]}});
 l=await provider.getListing(auth,"3001");assert.equal(l.stockWritable,false);assert.equal(l.quantity,3);
 await rejectsCode(()=>provider.getListing(auth,"../3001"),"INVALID_EXTERNAL_IDENTIFIER");
});

test("stock and price payloads; failure_list is an error", async()=>{
 const sent={};let fail=false;
 const {provider}=mk({
  "/api/v2/product/update_stock":(_u,b)=>{sent.stock=b;return {response:{failure_list:fail?[{model_id:91,failed_reason:"stock locked token=abc"}]:[],success_list:fail?[]:b.stock_list.map(s=>({model_id:s.model_id,location_id:"",stock:s.seller_stock[0].stock}))}};},
  "/api/v2/product/update_price":(_u,b)=>{sent.price=b;return {response:{failure_list:[],success_list:b.price_list.map(p=>({model_id:p.model_id,original_price:p.original_price}))}};},
  "/api/v2/product/get_item_base_info":()=>({response:{item_list:[baseItem({has_model:true})]}}),
  "/api/v2/product/get_model_list":()=>({response:{tier_variation:[],model:[{model_id:91},{model_id:92}]}}),
  "/api/v2/product/unlist_item":(_u,b)=>{sent.unlist=b;return {error:"",message:"",response:{failure_list:[],success_list:[{item_id:3001,unlist:b.item_list[0].unlist}]}};},
  // delete_item não tem objeto `response`: só error/message/warning/request_id.
  "/api/v2/product/delete_item":(_u,b)=>{sent.delete=b;return {error:"",message:"",warning:"",request_id:"r"};},
 });
 await provider.syncStock(auth,"3001",9);
 assert.deepEqual(sent.stock,{item_id:3001,stock_list:[{model_id:0,seller_stock:[{stock:9}]}]});
 await provider.syncStock(auth,"3001",0,[{id:"91",quantity:2},{id:"92",quantity:0}]);
 assert.deepEqual(sent.stock,{item_id:3001,stock_list:[{model_id:91,seller_stock:[{stock:2}]},{model_id:92,seller_stock:[{stock:0}]}]});
 await provider.syncPrice(auth,"3001",12345,[{id:"91",priceCents:1990}]);
 assert.deepEqual(sent.price,{item_id:3001,price_list:[{model_id:91,original_price:19.9}]});
 await provider.syncPrice(auth,"3001",12345);
 assert.deepEqual(sent.price,{item_id:3001,price_list:[{model_id:91,original_price:123.45},{model_id:92,original_price:123.45}]});
 fail=true;
 await rejectsCode(()=>provider.syncStock(auth,"3001",1,[{id:"91",quantity:1}]),"SHOPEE_STOCK_UPDATE_REJECTED",e=>!JSON.stringify(e.issues).includes("token"));
 await rejectsCode(()=>provider.syncStock(auth,"3001",-1),"MARKETPLACE_INVALID_QUANTITY");
 await provider.setStatus(auth,"3001","paused");assert.deepEqual(sent.unlist,{item_list:[{item_id:3001,unlist:true}]});
 await provider.setStatus(auth,"3001","active");assert.deepEqual(sent.unlist,{item_list:[{item_id:3001,unlist:false}]});
 await provider.setStatus(auth,"3001","closed");assert.deepEqual(sent.delete,{item_id:3001});
});

test("publish: validates settings, downloads https image, uploads to media_space, add_item payload", async()=>{
 const sent={};const {provider,calls}=mk({
  "https://images.vorix.test/p.jpg":()=>new Response(new Uint8Array([0xff,0xd8,0xff,1,2,3]),{status:200,headers:{"content-type":"image/jpeg"}}),
  "/api/v2/media_space/upload_image":(_u,b)=>{sent.form=b;return {response:{image_info:{image_id:"img-abc",image_url_list:[]}}};},
  "/api/v2/logistics/get_channel_list":()=>({response:{logistics_channel_list:[{logistics_channel_id:90001,enabled:true,mask_channel_id:0,fee_type:"SIZE_INPUT"},
   {logistics_channel_id:90002,enabled:false},{logistics_channel_id:90003,enabled:true,mask_channel_id:90001},{logistics_channel_id:90004,enabled:true,fee_type:"SIZE_SELECTION"}]}}),
  "/api/v2/product/add_item":(_u,b)=>{sent.add=b;return {response:{item_id:4001,item_status:"NORMAL",item_name:b.item_name,price_info:{original_price:b.original_price,current_price:b.original_price}}};},
  "/api/v2/product/get_category":u=>{assert.equal(u.searchParams.get("language"),"pt-br");return {response:{category_list:[{category_id:100182,parent_category_id:100,original_category_name:"T-Shirts",display_category_name:"Camisetas",has_children:false},{category_id:100,parent_category_id:0,has_children:true}]}};},
  "/api/v2/product/get_attribute_tree":u=>{assert.equal(u.searchParams.get("language"),"pt-BR");assert.equal(u.searchParams.get("category_id_list"),"100182");
   return {response:{list:[{category_id:100182,attribute_tree:[{attribute_id:100037,mandatory:true,name:"Material",attribute_value_list:[],attribute_info:{input_type:3}}]}]}};},
  "/api/v2/product/init_tier_variation":(_u,b)=>{sent.tier=b;return {response:{item_id:b.item_id,model:b.model.map((m,i)=>({tier_index:m.tier_index,model_id:9100+i,model_sku:m.model_sku,price_info:[{original_price:m.original_price}],seller_stock:m.seller_stock}))}};},
  "/api/v2/product/update_item":(_u,b)=>{sent.update=b;return {response:{item_id:b.item_id}};},
 });
 const draft={categoryId:"100182",title:"Camiseta QA",description:"Descrição completa",condition:"new",listingTypeId:"",buyingMode:"buy_it_now",
  attributes:[{id:"100037",value_name:"Algodão"},{id:"GTIN",value_name:"7891234567895"}],pictures:["https://images.vorix.test/p.jpg"],settings:{brand:{brand_id:0,original_brand_name:"NoBrand"}}};
 const write={draft,priceCents:5990,quantity:4,currency:"BRL",sku:"CAM-1",userProducts:false,correlation:"vorix:x",package:{weightGrams:300,heightCm:5,widthCm:20,lengthCm:30}};
 assert.deepEqual(await provider.validateListing(auth,write),[]);
 assert.deepEqual(await provider.validateListing(auth,{...write,draft:{...draft,attributes:[]}}),["Falta atributo: Material (100037)."]);
 const bad=await provider.validateListing(auth,{...write,package:{},draft:{...draft,settings:{price:1},pictures:["https://127.0.0.1/x.jpg"]}});
 assert.ok(bad.some(e=>e.includes("SHOPEE_UNSUPPORTED_LISTING_SETTING")));assert.ok(bad.some(e=>e.includes("peso")));assert.ok(bad.some(e=>e.includes("https pública")));
 const created=await provider.createListing(auth,write);
 assert.equal(created.id,"4001");assert.equal(created.sellerId,"555");assert.equal(created.status,"active");
 const imageCall=calls.find(c=>c.url.host==="images.vorix.test");assert.equal(imageCall.init.redirect,"error");
 const upload=calls.find(c=>c.path==="/api/v2/media_space/upload_image").url.searchParams;
 assert.equal(upload.get("sign"),hmac("1001/api/v2/media_space/upload_image"+TS));assert.equal(upload.get("access_token"),null);
 assert.ok(sent.form instanceof FormData);assert.equal(sent.form.get("image").type,"image/jpeg");
 assert.deepEqual(sent.add,{item_name:"Camiseta QA",description:"Descrição completa",category_id:100182,original_price:59.9,seller_stock:[{stock:4}],weight:0.3,
  image:{image_id_list:["img-abc"]},attribute_list:[{attribute_id:100037,attribute_value_list:[{value_id:0,original_value_name:"Algodão"}]}],logistic_info:[{logistic_id:90001,enabled:true}],
  dimension:{package_height:5,package_width:20,package_length:30},condition:"NEW",item_sku:"CAM-1",gtin_code:"7891234567895",brand:{brand_id:0,original_brand_name:"NoBrand"},item_status:"NORMAL"});
 await rejectsCode(()=>provider.createListing(auth,{...write,draft:{...draft,pictures:["https://localhost/p.jpg"]}}),"SHOPEE_IMAGE_URL_INVALID");
 await rejectsCode(()=>provider.createListing(auth,{...write,draft:{...draft,settings:{item_status:"NORMAL"}}}),"SHOPEE_UNSUPPORTED_LISTING_SETTING");
 // add_item: condition obrigatória no BR (2026-09-01) e brand exige original_brand_name.
 assert.ok((await provider.validateListing(auth,{...write,draft:{...draft,condition:"not_specified"}})).some(e=>e.includes("condição")));
 await rejectsCode(()=>provider.createListing(auth,{...write,draft:{...draft,condition:"not_specified"}}),"SHOPEE_CONDITION_REQUIRED");
 await rejectsCode(()=>provider.createListing(auth,{...write,draft:{...draft,settings:{brand:{brand_id:0}}}}),"SHOPEE_INVALID_BRAND");
 // Variações: standardise_tier_variation (tier_variation descontinuado em 2025-09-12) com ids 0 = variação própria.
 const variants=[{sku:"CAM-AZ-P",priceCents:6990,quantity:2,attributes:[{id:"Cor",value_name:"Azul"},{id:"Tamanho",value_name:"P"}]},
  {sku:"CAM-PR-M",priceCents:7990,quantity:0,attributes:[{id:"Cor",value_name:"Preto"},{id:"Tamanho",value_name:"M"}]}];
 const withModels=await provider.createListing(auth,{...write,variants});
 assert.deepEqual(sent.tier,{item_id:4001,standardise_tier_variation:[
  {variation_id:0,variation_group_id:0,variation_name:"Cor",variation_option_list:[{variation_option_id:0,variation_option_name:"Azul"},{variation_option_id:0,variation_option_name:"Preto"}]},
  {variation_id:0,variation_group_id:0,variation_name:"Tamanho",variation_option_list:[{variation_option_id:0,variation_option_name:"P"},{variation_option_id:0,variation_option_name:"M"}]}],
  model:[{tier_index:[0,0],original_price:69.9,seller_stock:[{stock:2}],model_sku:"CAM-AZ-P"},{tier_index:[1,1],original_price:79.9,seller_stock:[{stock:0}],model_sku:"CAM-PR-M"}]});
 assert.deepEqual(withModels.variants.map(v=>v.id),["9100","9101"]);
 // update_item não tem logistic_info.
 await rejectsCode(()=>provider.updateListing(auth,"4001",{settings:{logistic_info:[{logistic_id:90001,enabled:true}]}}),"SHOPEE_LOGISTICS_UPDATE_UNSUPPORTED");
 await provider.updateListing(auth,"4001",{title:"Novo",condition:"used"});assert.deepEqual(sent.update,{item_id:4001,item_name:"Novo",condition:"USED"});
});

const orderDetail=(patch={})=>({order_sn:"2410270ABCDEF1",region:"BR",currency:"BRL",total_amount:139.7,order_status:"READY_TO_SHIP",create_time:TS-7200,update_time:TS-60,pay_time:TS-7000,
 buyer_user_id:8888,buyer_username:"comprador_qa",estimated_shipping_fee:21.5,actual_shipping_fee:0,fulfillment_flag:"fulfilled_by_local_seller",shipping_carrier:"Shopee Xpress",
 recipient_address:{name:"J****",phone:"******99",full_address:"****",city:"São Paulo",state:"SP",zipcode:"01310-100"},
 item_list:[{item_id:3001,item_name:"Camiseta QA",item_sku:"CAM-1",model_id:91,model_name:"Azul,M",model_sku:"CAM-AZ-M",model_quantity_purchased:2,model_original_price:69.9,model_discounted_price:59.9},
  {item_id:3002,item_name:"Boné",item_sku:"BON-1",model_id:0,model_name:"",model_sku:"",model_quantity_purchased:1,model_original_price:19.9,model_discounted_price:19.9}],
 package_list:[{package_number:"PKG1",logistics_status:"LOGISTICS_READY",shipping_carrier:"Shopee Xpress"}],...patch});

test("order normalization: status mapping, cents, masked buyer, items/models", async()=>{
 let detail=orderDetail();const {provider,calls}=mk({
  "/api/v2/order/get_order_detail":u=>{assert.equal(u.searchParams.get("order_sn_list"),"2410270ABCDEF1");assert.ok(u.searchParams.get("response_optional_fields").includes("item_list"));return {response:{order_list:[detail]}};},
  "/api/v2/logistics/get_tracking_number":()=>({response:{tracking_number:"BR123456789"}}),
  // TrackingLogisticsStatus (Data Definition): FAILED_* não pode contar como entregue/coletado.
  "/api/v2/logistics/get_tracking_info":()=>({response:{order_sn:"2410270ABCDEF1",package_number:"PKG1",logistics_status:"LOGISTICS_DELIVERY_DONE",tracking_info:[
   {update_time:TS-2000,description:"Entregue",logistics_status:"DELIVERED"},{update_time:TS-3500,description:"Falha",logistics_status:"FAILED_DELIVERED"},
   {update_time:TS-6000,description:"Coletado",logistics_status:"PICKED_UP"},{update_time:TS-6500,description:"Falha coleta",logistics_status:"FAILED_PICKED_UP"}]}}),
 });
 let o=await provider.getOrder(auth,"2410270ABCDEF1");
 assert.equal(o.state,"PAID");assert.equal(o.externalStatus,"READY_TO_SHIP");assert.equal(o.accountId,"555");assert.equal(o.currency,"BRL");
 assert.deepEqual(o.items,[{externalItemId:"3001",externalVariationId:"91",sku:"CAM-AZ-M",title:"Camiseta QA",variantLabel:"Azul,M",quantity:2,unitPriceCents:5990},
  {externalItemId:"3002",sku:"BON-1",title:"Boné",variantLabel:undefined,quantity:1,unitPriceCents:1990}]);
 assert.equal(o.subtotalCents,13970);assert.equal(o.totalCents,13970);assert.equal(o.shippingCents,0);assert.equal(o.discountCents,0);
 assert.deepEqual(o.buyer,{id:"8888",nickname:"comprador_qa"});
 assert.deepEqual(o.shippingAddress,{city:"São Paulo",state:"SP",postalCode:"01310-100"});
 assert.ok(!JSON.stringify(o).includes("J****")&&!JSON.stringify(o).includes("******99"));
 assert.equal(o.paidAt,new Date((TS-7000)*1000).toISOString());assert.equal(o.shipment.state,"PENDING");assert.equal(o.shipment.labelAvailable,false);
 assert.equal(o.shipment.fulfilledByMarketplace,false);assert.equal(o.data.estimatedShippingFeeCents,2150);
 assert.ok(!calls.some(c=>c.path.includes("tracking")));
 detail=orderDetail({order_status:"PROCESSED",total_amount:150.0});o=await provider.getOrder(auth,"2410270ABCDEF1");
 assert.equal(o.state,"READY_TO_SHIP");assert.equal(o.shipment.trackingNumber,"BR123456789");assert.equal(o.shipment.labelAvailable,true);assert.equal(o.shipment.externalId,"PKG1");
 assert.equal(o.shippingCents,1030);assert.equal(o.totalCents,o.subtotalCents-o.discountCents+o.shippingCents);
 detail=orderDetail({order_status:"COMPLETED"});o=await provider.getOrder(auth,"2410270ABCDEF1");
 assert.equal(o.state,"DELIVERED");assert.equal(o.shipment.shippedAt,new Date((TS-6000)*1000).toISOString());assert.equal(o.shipment.deliveredAt,new Date((TS-2000)*1000).toISOString());
 detail=orderDetail({order_status:"SHIPPED",fulfillment_flag:"fulfilled_by_shopee",pickup_done_time:TS-7100});o=await provider.getOrder(auth,"2410270ABCDEF1");
 assert.equal(o.shipment.shippedAt,new Date((TS-7100)*1000).toISOString(),"pickup_done_time when tracking is not read");
 // TO_CONFIRM_RECEIVE = "The order has been received by buyer" (Data Definition OrderStatus).
 for(const [status,state] of [["UNPAID","PENDING_PAYMENT"],["SHIPPED","SHIPPED"],["TO_CONFIRM_RECEIVE","DELIVERED"],["IN_CANCEL","PAID"],["CANCELLED","CANCELLED"],["TO_RETURN","DELIVERED"],["INVOICE_PENDING","PAID"]]){
  detail=orderDetail({order_status:status});assert.equal((await provider.getOrder(auth,"2410270ABCDEF1")).state,state,status);
 }
 detail=orderDetail({order_status:"READY_TO_SHIP",package_list:[{package_number:"PKG1",logistics_status:"LOGISTICS_REQUEST_CREATED"}]});
 assert.equal((await provider.getOrder(auth,"2410270ABCDEF1")).state,"READY_TO_SHIP");
 detail=orderDetail({order_status:"SHIPPED",fulfillment_flag:"fulfilled_by_shopee"});o=await provider.getOrder(auth,"2410270ABCDEF1");
 assert.equal(o.shipment.fulfilledByMarketplace,true);assert.equal(o.shipment.labelAvailable,false);
 detail=orderDetail({total_amount:"abc"});await rejectsCode(()=>provider.getOrder(auth,"2410270ABCDEF1"),"INVALID_EXTERNAL_PRICE");
});

test("listOrders splits windows at 15 days and follows the Shopee cursor", async()=>{
 const seen=[];const {provider}=mk({"/api/v2/order/get_order_list":u=>{
  const q=Object.fromEntries(u.searchParams);seen.push(q);assert.equal(q.time_range_field,"update_time");assert.ok(Number(q.time_to)-Number(q.time_from)<=15*86400);assert.ok(Number(q.page_size)<=100);
  assert.equal(q.response_optional_fields,"order_status");
  return q.cursor===undefined&&seen.length===1?{response:{more:true,next_cursor:"c2",order_list:[{order_sn:"ORDER000001"}]}}:{response:{more:false,next_cursor:"",order_list:[{order_sn:"ORDER00000"+(seen.length+1)}]}};
 }});
 const from=new Date(NOW-20*86400000).toISOString(),to=new Date(NOW).toISOString();
 let page=await provider.listOrders(auth,{updatedFrom:from,updatedTo:to});assert.deepEqual(page.ids,["ORDER000001"]);
 page=await provider.listOrders(auth,{updatedFrom:from,updatedTo:to,cursor:page.cursor});assert.equal(seen[1].cursor,"c2");assert.equal(seen[1].time_from,seen[0].time_from);
 page=await provider.listOrders(auth,{updatedFrom:from,updatedTo:to,cursor:page.cursor});assert.equal(seen[2].time_from,seen[0].time_to);assert.equal(seen[2].time_to,String(TS));assert.equal(page.cursor,undefined);
 await rejectsCode(()=>provider.listOrders(auth,{updatedFrom:from,updatedTo:to,cursor:"not-json"}),"INVALID_EXTERNAL_CURSOR");
});

test("shipping label flow: parameter → create → result → download", async()=>{
 const steps=[];const pdf=new Uint8Array([0x25,0x50,0x44,0x46]);let result="PROCESSING";
 const {provider}=mk({
  "/api/v2/logistics/get_shipping_document_parameter":(_u,b)=>{steps.push(["param",b]);return {response:{result_list:[{order_sn:"2410270ABCDEF1",suggest_shipping_document_type:"THERMAL_AIR_WAYBILL"}]}};},
  "/api/v2/logistics/create_shipping_document":(_u,b)=>{steps.push(["create",b]);return {response:{result_list:[{order_sn:"2410270ABCDEF1"}]}};},
  "/api/v2/logistics/get_shipping_document_result":(_u,b)=>{steps.push(["result",b]);const s=result;result="READY";return {response:{result_list:[{order_sn:"2410270ABCDEF1",status:s}]}};},
  "/api/v2/logistics/download_shipping_document":(_u,b)=>{steps.push(["download",b]);return new Response(pdf,{status:200,headers:{"content-type":"application/pdf"}});},
 });
 const order={id:"2410270ABCDEF1",externalStatus:"PROCESSED",state:"READY_TO_SHIP",items:[],shipment:{externalId:"PKG1",state:"READY_TO_SHIP",externalStatus:"LOGISTICS_REQUEST_CREATED",trackingNumber:"BR123",labelAvailable:true,fulfilledByMarketplace:false}};
 const label=await provider.shippingLabel(auth,order);
 assert.equal(label.contentType,"application/pdf");assert.equal(Buffer.from(label.base64,"base64").toString(),"%PDF");assert.equal(label.filename,"etiqueta-shopee-2410270ABCDEF1.pdf");
 assert.deepEqual(steps.map(s=>s[0]),["param","create","result","result","download"]);
 assert.deepEqual(steps[1][1],{order_list:[{order_sn:"2410270ABCDEF1",package_number:"PKG1",tracking_number:"BR123",shipping_document_type:"THERMAL_AIR_WAYBILL"}]});
 assert.deepEqual(steps[4][1],{shipping_document_type:"THERMAL_AIR_WAYBILL",order_list:[{order_sn:"2410270ABCDEF1",package_number:"PKG1"}]});
 await rejectsCode(()=>provider.shippingLabel(auth,{...order,shipment:{...order.shipment,trackingNumber:undefined}}),"SHOPEE_LABEL_NOT_AVAILABLE");
 await rejectsCode(()=>provider.shippingLabel(auth,{...order,externalStatus:"SHIPPED"}),"SHOPEE_LABEL_NOT_AVAILABLE");
});

test("cancel_order payload; shipped orders are refused", async()=>{
 let body;const {provider}=mk({"/api/v2/order/cancel_order":(_u,b)=>{body=b;return {response:{update_time:TS}};}});
 const order={id:"2410270ABCDEF1",state:"PAID",externalStatus:"READY_TO_SHIP",items:[{externalItemId:"3001",externalVariationId:"91",quantity:2},{externalItemId:"3002",quantity:1}],shipment:{fulfilledByMarketplace:false}};
 await provider.cancelOrder(auth,order,"Sem estoque");
 assert.deepEqual(body,{order_sn:"2410270ABCDEF1",cancel_reason:"OUT_OF_STOCK",item_list:[{item_id:3001,model_id:91},{item_id:3002,model_id:0}]});
 await provider.cancelOrder(auth,order,"CUSTOMER_REQUEST");assert.deepEqual(body,{order_sn:"2410270ABCDEF1",cancel_reason:"CUSTOMER_REQUEST"});
 await rejectsCode(()=>provider.cancelOrder(auth,{...order,state:"SHIPPED",externalStatus:"SHIPPED"},"Sem estoque"),"SHOPEE_ORDER_NOT_CANCELLABLE");
 await rejectsCode(()=>provider.cancelOrder(auth,order,"qualquer coisa"),"SHOPEE_CANCEL_REASON_UNSUPPORTED");
 assert.deepEqual((await provider.cancelReasons(auth,order)).map(r=>r.code),["OUT_OF_STOCK","CUSTOMER_REQUEST"]);
 assert.deepEqual(await provider.cancelReasons(auth,{...order,state:"SHIPPED",externalStatus:"SHIPPED"}),[]);
 assert.deepEqual(await provider.cancelReasons(auth,{...order,shipment:{fulfilledByMarketplace:true}}),[],"FBS: Shopee handles it");
 assert.equal(provider.closeListingEffect,"DELETE");assert.equal(provider.capabilities.closeListing,"SUPPORTED");
 // UNDELIVERABLE_AREA: "Only apply for TW and MY".
 await rejectsCode(()=>provider.cancelOrder(auth,order,"UNDELIVERABLE_AREA"),"SHOPEE_CANCEL_REASON_UNSUPPORTED");
 await rejectsCode(()=>provider.cancelOrder(auth,order,"Área de entrega não atendida"),"SHOPEE_CANCEL_REASON_UNSUPPORTED");
});

test("returns: scans 60 days in windows, filters by order and maps status/items", async()=>{
 const windows=[],details=[];const {provider}=mk({
  // get_return_list não traz logística reversa; get_return_detail traz reverse_logistics_status (e o legado logistics_status).
  "/api/v2/returns/get_return_detail":u=>{details.push(u.searchParams.get("return_sn"));return {response:{return_sn:u.searchParams.get("return_sn"),order_sn:"2410270ABCDEF1",status:"ACCEPTED",
   logistics_status:"LOGISTICS_REQUEST_CREATED",reverse_logistics_status:"LOGISTICS_PICKUP_DONE"}};},
  "/api/v2/returns/get_return_list":u=>{
  windows.push([Number(u.searchParams.get("create_time_from")),Number(u.searchParams.get("create_time_to"))]);
  if(windows.length>1)return {response:{more:false,return:[]}};
  return {response:{more:false,return:[
   {return_sn:"R1",order_sn:"2410270ABCDEF1",status:"ACCEPTED",reason:"NOT_RECEIPT",refund_amount:59.9,create_time:TS-500,update_time:TS-100,user:{username:"x",email:"a@b.c"},item:[{item_id:3001,model_id:91,amount:1}]},
   {return_sn:"R2",order_sn:"2410270ABCDEF1",status:"CLOSED",reason:"DAMAGED",refund_amount:19.9,create_time:TS-400,update_time:TS-50,item:[{item_id:3002,model_id:0,amount:1}]},
   {return_sn:"R3",order_sn:"OTHERORDER1",status:"REQUESTED",create_time:TS,item:[]}]}};
 }});
 const returns=await provider.getReturns(auth,"2410270ABCDEF1");
 assert.equal(windows.length,4);assert.ok(windows.every(([a,b])=>b-a<=15*86400));assert.equal(windows[0][0],TS-60*86400);assert.equal(windows.at(-1)[1],TS);
 assert.deepEqual(returns.map(r=>[r.id,r.state,r.externalStatus,r.refundCents,r.reason]),[["R1","IN_TRANSIT","ACCEPTED",5990,"NOT_RECEIPT"],["R2","COMPLETED","CLOSED",1990,"DAMAGED"]]);
 assert.deepEqual(details,["R1"],"detail only for approved returns of this order");
 assert.deepEqual(returns[0].items,[{externalItemId:"3001",externalVariationId:"91",quantity:1}]);assert.deepEqual(returns[1].items,[{externalItemId:"3002",quantity:1}]);
 assert.ok(!JSON.stringify(returns).includes("a@b.c"));
 await provider.getReturns(auth,"2410270ABCDEF1");assert.equal(windows.length,4,"short per-shop cache");
});

test("push: signature over configured URL + body, rejects tampering, stable eventId", ()=>{
 const {provider}=mk({});
 const pushUrl="https://app.vorix.test/v1/marketplaces/shopee/notifications";
 // Formato oficial do order_status_push (código 3).
 const raw=JSON.stringify({data:{items:[],ordersn:"2410270ABCDEF1",status:"READY_TO_SHIP",completed_scenario:"",update_time:TS},shop_id:555,code:3,timestamp:TS});
 const sig=hmac(pushUrl+"|"+raw);
 const n=provider.parseNotification({headers:{authorization:sig},rawBody:raw,url:"https://evil.test/whatever"});
 assert.deepEqual({...n,eventId:undefined},{accountId:"555",eventId:undefined,topic:"order_status_push",kind:"ORDER",resource:"/orders/2410270ABCDEF1",externalOrderId:"2410270ABCDEF1"});
 assert.match(n.eventId,/^[0-9a-f]{64}$/);
 assert.equal(provider.parseNotification({headers:{Authorization:sig},rawBody:raw,url:""}).eventId,n.eventId,"replay keeps the same eventId");
 const other=JSON.stringify({shop_id:555,code:3,timestamp:TS+1,data:{ordersn:"2410270ABCDEF1",status:"SHIPPED"}});
 assert.notEqual(provider.parseNotification({headers:{authorization:hmac(pushUrl+"|"+other)},rawBody:other,url:""}).eventId,n.eventId);
 assert.equal(provider.parseNotification({headers:{authorization:"0".repeat(64)},rawBody:raw,url:""}),undefined,"wrong signature");
 assert.equal(provider.parseNotification({headers:{authorization:hmac("https://evil.test/v1/marketplaces/shopee/notifications|"+raw)},rawBody:raw,url:"https://evil.test/v1/marketplaces/shopee/notifications"}),undefined,"wrong URL");
 assert.equal(provider.parseNotification({headers:{authorization:sig},rawBody:raw+" ",url:""}),undefined,"tampered body");
 assert.equal(provider.parseNotification({headers:{},rawBody:raw,url:""}),undefined);
 const tracking=JSON.stringify({data:{ordersn:"2410270ABCDEF1",forder_id:"4965804244309504855",package_number:"PKG1",tracking_no:"BR1"},shop_id:555,code:4,timestamp:TS});
 assert.equal(provider.parseNotification({headers:{authorization:hmac(pushUrl+"|"+tracking)},rawBody:tracking,url:""}).topic,"order_trackingno_push");
 const partner=JSON.stringify({partner_id:9999,shop_id:555,code:3,timestamp:TS,data:{ordersn:"2410270ABCDEF1"}});
 assert.equal(provider.parseNotification({headers:{authorization:hmac(pushUrl+"|"+partner)},rawBody:partner,url:""}),undefined,"other partner");
 const unknown=JSON.stringify({shop_id:555,code:99,timestamp:TS,data:{}});
 assert.equal(provider.parseNotification({headers:{authorization:hmac(pushUrl+"|"+unknown)},rawBody:unknown,url:""}),undefined);
});

test("errors: 429 retryable with Retry-After, 401/invalid token → REAUTH_REQUIRED, never bodies or tokens", async()=>{
 const leak="access-token-secret partner-key-secret body-detail";
 let r=mk({"/api/v2/shop/get_shop_info":()=>new Response(leak,{status:429,headers:{"retry-after":"42"}})}).provider;
 await rejectsCode(()=>r.account(auth),"SHOPEE_RATE_LIMIT",e=>e.retryable===true&&e.retryAfterMs===42000&&!e.message.includes("secret"));
 r=mk({"/api/v2/shop/get_shop_info":()=>new Response(leak,{status:401})}).provider;
 await rejectsCode(()=>r.account(auth),"REAUTH_REQUIRED",e=>!e.retryable);
 r=mk({"/api/v2/shop/get_shop_info":()=>json({error:"invalid_acceess_token",message:leak},{status:403})}).provider;
 await rejectsCode(()=>r.account(auth),"REAUTH_REQUIRED");
 r=mk({"/api/v2/shop/get_shop_info":()=>json({error:"error_auth",message:leak})}).provider;
 await rejectsCode(()=>r.account(auth),"REAUTH_REQUIRED");
 r=mk({"/api/v2/shop/get_shop_info":()=>new Response(leak,{status:503})}).provider;
 await rejectsCode(()=>r.account(auth),"SHOPEE_UNAVAILABLE",e=>e.retryable);
 r=mk({"/api/v2/shop/get_shop_info":()=>json({error:"error_param",message:leak},{status:400})}).provider;
 await rejectsCode(()=>r.account(auth),"SHOPEE_REQUEST_REJECTED",e=>!e.message.includes("secret")&&!JSON.stringify(e.issues).includes("secret")&&e.issues[0]==="Regra Shopee: error_param");
 r=mk({"/api/v2/shop/get_shop_info":()=>json({error:"error_param <script>"+leak,message:leak})}).provider;
 await rejectsCode(()=>r.account(auth),"SHOPEE_REQUEST_REJECTED",e=>!e.issues&&!e.message.includes("secret"));
 r=new ShopeeProvider(config,async()=>{throw new Error("ECONNRESET "+leak);},{minIntervalMs:0,now:()=>NOW});
 await rejectsCode(()=>r.account(auth),"SHOPEE_NETWORK_UNCERTAIN",e=>e.retryable&&!e.message.includes("secret"));
 r=mk({"/api/v2/shop/get_shop_info":()=>({error:"error_too_many_request",message:leak})}).provider;
 await rejectsCode(()=>r.account(auth),"SHOPEE_RATE_LIMIT",e=>e.retryable);
 // Lista comum de erros da referência v2.
 const shopeeError=(error,message)=>mk({"/api/v2/shop/get_shop_info":()=>({request_id:"r",error,message})}).provider;
 await rejectsCode(()=>shopeeError("error_rate_limit","Too many requests. You have reached the rate limit. Please try again later.").account(auth),"SHOPEE_RATE_LIMIT",e=>e.retryable&&e.retryAfterMs===60000);
 // NOW = 12:00 UTC; a cota diária zera 00:00 UTC+8 = 16:00 UTC.
 await rejectsCode(()=>shopeeError("error_limit","The total API call number made by your APP has reached the daily API call limit").account(auth),"SHOPEE_DAILY_LIMIT",e=>e.retryable&&e.retryAfterMs===4*3600000);
 await rejectsCode(()=>shopeeError("error_auth","Invalid access_token.").account(auth),"REAUTH_REQUIRED");
 await rejectsCode(()=>shopeeError("error_auth","No permission to current api.").account(auth),"SHOPEE_PERMISSION_DENIED");
 await rejectsCode(()=>shopeeError("error_auth","partner_id is invalid").account(auth),"SHOPEE_PARTNER_CREDENTIALS_INVALID");
 await rejectsCode(()=>shopeeError("error_partner_key_expired","Your API partner key has expired").account(auth),"SHOPEE_PARTNER_CREDENTIALS_INVALID");
 await rejectsCode(()=>shopeeError("source_ip_undeclared","Request Source IP (1.2.3.4) is undeclared").account(auth),"SHOPEE_SOURCE_IP_UNDECLARED");
 await rejectsCode(()=>shopeeError("error_sign","Wrong sign.").account(auth),"SHOPEE_SIGNATURE_REJECTED");
 await rejectsCode(()=>shopeeError("shop_no_linked","Partner and shop has no linked.").account(auth),"REAUTH_REQUIRED");
 await rejectsCode(()=>shopeeError("error_server","Something wrong. Please try later.").account(auth),"SHOPEE_UNAVAILABLE",e=>e.retryable);
});

test("shopeeConfig validates partner, redirect and API origin", ()=>{
 const env={SHOPEE_PARTNER_ID:"1001",SHOPEE_PARTNER_KEY:"k",SHOPEE_REDIRECT_URI:"https://app.vorix.test/v1/marketplaces/shopee/callback"};
 assert.deepEqual(shopeeConfig(env),{partnerId:"1001",partnerKey:"k",redirectUri:env.SHOPEE_REDIRECT_URI,apiBaseUrl:"https://partner.shopeemobile.com"});
 assert.equal(shopeeConfig({...env,SHOPEE_API_BASE_URL:"https://openplatform.shopee.com.br"}).apiBaseUrl,"https://openplatform.shopee.com.br");
 assert.equal(shopeeConfig({...env,SHOPEE_API_BASE_URL:"https://partner.test-stable.shopeemobile.com/"}).apiBaseUrl,"https://partner.test-stable.shopeemobile.com");
 // Guia 16: sandbox oficial atual.
 assert.equal(shopeeConfig({...env,SHOPEE_API_BASE_URL:"https://openplatform.sandbox.test-stable.shopee.sg"}).apiBaseUrl,"https://openplatform.sandbox.test-stable.shopee.sg");
 for(const patch of [{SHOPEE_PARTNER_ID:"abc"},{SHOPEE_PARTNER_KEY:""},{SHOPEE_REDIRECT_URI:"http://app.vorix.test/v1/marketplaces/shopee/callback"},
  {SHOPEE_REDIRECT_URI:"https://app.vorix.test/v1/marketplaces/shopee/callback?x=1"},{SHOPEE_REDIRECT_URI:"https://app.vorix.test/callback"},
  {SHOPEE_API_BASE_URL:"https://evil.test"},{SHOPEE_API_BASE_URL:"http://partner.shopeemobile.com"},{SHOPEE_API_BASE_URL:"https://partner.shopeemobile.com/api"}])
  assert.equal(shopeeConfig({...env,...patch}),undefined,JSON.stringify(patch));
 const {provider}=mk({});
 assert.equal(provider.id,"SHOPEE");
 assert.deepEqual(Object.values(provider.capabilities).every(v=>v==="SUPPORTED"||v==="BLOCKED_EXTERNAL_CAPABILITY"),true);
});
