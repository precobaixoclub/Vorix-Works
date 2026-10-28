import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {TikTokShopProvider,tiktokShopConfig,tiktokShopSign,tiktokCents} from "../dist/infrastructure/marketplaces/tiktok-shop-provider.js";
import {MarketplaceError} from "../dist/domain/marketplaces/marketplace.model.js";

const CONFIG={appKey:"appkey123",appSecret:"super-secret-value",serviceId:"7000000000000000001",apiBaseUrl:"https://open-api.tiktokglobalshop.com"};
const AUTH={accessToken:"ACCESS-TOKEN-SECRET",accountId:"7495000000000000001",metadata:{shopCipher:"ROW_cipher_br",openId:"open-1"}};
const ok=(data)=>new Response(JSON.stringify({code:0,message:"Success",request_id:"r",data}),{status:200,headers:{"content-type":"application/json"}});
/** fetch falso: rotas por "MÉTODO caminho"; registra cada chamada com query/corpo decodificados. */
function mock(routes){
 const calls=[];
 const fetcher=async(input,options={})=>{
  const url=new URL(String(input));const key=(options.method??"GET")+" "+url.origin+url.pathname;
  const call={url,method:options.method??"GET",headers:options.headers??{},body:typeof options.body==="string"?JSON.parse(options.body):options.body,raw:options.body,options};calls.push(call);
  const handler=routes[key]??routes[(options.method??"GET")+" "+url.pathname];
  if(!handler)throw new Error("unexpected "+key);
  return typeof handler==="function"?handler(call):ok(handler);
 };
 return {calls,provider:new TikTokShopProvider(CONFIG,fetcher)};
}
const WAREHOUSES={warehouses:[{id:"WH-SALES",type:"SALES_WAREHOUSE",effect_status:"ENABLED",is_default:true},{id:"WH-RET",type:"RETURN_WAREHOUSE",effect_status:"ENABLED"}]};
const PRODUCT={id:"1729000000000000001",status:"ACTIVATE",title:"Camiseta",description:"<p>Linha 1</p><p>A &amp; B</p>",update_time:1761600000,
 category_chains:[{id:"600001",is_leaf:false},{id:"601226",is_leaf:true}],main_images:[{uri:"tos-img-1",urls:["https://p16-oec.tiktokcdn.com/img1.jpg"]}],
 product_attributes:[{id:"100198",name:"Material",values:[{id:"1000",name:"Algodão"}]}],package_weight:{value:"0.3",unit:"KILOGRAM"},
 skus:[{id:"1729100000000000001",seller_sku:"CAM-P",price:{currency:"BRL",sale_price:"59.90",tax_exclusive_price:"59.90"},inventory:[{warehouse_id:"WH-SALES",quantity:3}],
   sales_attributes:[{id:"100000",name:"Tamanho",value_id:"201",value_name:"P"}],identifier_code:{type:"EAN",code:"7891234567895"}},
  {id:"1729100000000000002",seller_sku:"CAM-M",price:{currency:"BRL",sale_price:"64.90"},inventory:[{warehouse_id:"WH-SALES",quantity:4}],sales_attributes:[{id:"100000",name:"Tamanho",value_id:"202",value_name:"M"}]}]};
const ORDER={id:"576000000000000001",status:"AWAITING_COLLECTION",create_time:1761500000,update_time:1761600000,paid_time:1761500100,user_id:"buyer-77",buyer_email:"x@scs.tiktokw.us",
 fulfillment_type:"FULFILLMENT_BY_SELLER",shipping_type:"TIKTOK",need_upload_invoice:"INVOICE_UPLOADED",cpf:"123.456.789-00",delivery_type:"HOME_DELIVERY",shipping_provider:"J&T Express",tracking_number:"BR123",packages:[{id:"1153000000000000001"}],
 recipient_address:{postal_code:"01001-000",phone_number:"(+55)11*****99",name:"Fulano",district_info:[{address_level_name:"State",address_name:"São Paulo"},{address_level_name:"City",address_name:"São Paulo"}]},
 payment:{currency:"BRL",original_total_product_price:"179.70",sub_total:"169.70",seller_discount:"10.00",platform_discount:"0",shipping_fee:"12.50",total_amount:"182.20"},
 line_items:[{id:"L1",product_id:"1729000000000000001",sku_id:"1729100000000000001",seller_sku:"CAM-P",product_name:"Camiseta",sku_name:"P",sale_price:"59.90"},
  {id:"L2",product_id:"1729000000000000001",sku_id:"1729100000000000001",seller_sku:"CAM-P",product_name:"Camiseta",sku_name:"P",sale_price:"59.90"},
  {id:"L3",product_id:"1729000000000000001",sku_id:"1729100000000000002",seller_sku:"CAM-M",product_name:"Camiseta",sku_name:"M",sale_price:"59.90"}]};

test("signature follows the documented formula (secret+path+sorted params+body+secret, HMAC-SHA256 hex)",()=>{
 const query={timestamp:"1700000000",app_key:"appkey123",shop_cipher:"ROW_x",sign:"ignored",access_token:"ignored"};
 const body='{"product_ids":["1"]}';
 const expected=createHmac("sha256","super-secret-value").update("super-secret-value"+"/product/202309/products/activate"+"app_keyappkey123"+"shop_cipherROW_x"+"timestamp1700000000"+body+"super-secret-value").digest("hex");
 assert.equal(tiktokShopSign("super-secret-value","/product/202309/products/activate",query,body),expected);
});

test("every signed call carries app_key/timestamp/sign, shop_cipher and the access token header",async()=>{
 const {calls,provider}=mock({"POST /product/202309/products/activate":{}});
 await provider.setStatus(AUTH,"1729000000000000001","active");
 const call=calls[0];assert.equal(call.url.origin,"https://open-api.tiktokglobalshop.com");
 assert.equal(call.url.searchParams.get("shop_cipher"),"ROW_cipher_br");assert.equal(call.url.searchParams.get("app_key"),"appkey123");
 assert.equal(call.headers["x-tts-access-token"],"ACCESS-TOKEN-SECRET");assert.equal(call.options.redirect,"error");assert.ok(call.options.signal);
 const query=Object.fromEntries(call.url.searchParams);
 assert.equal(query.sign,tiktokShopSign(CONFIG.appSecret,"/product/202309/products/activate",query,call.raw));
 assert.deepEqual(call.body,{product_ids:["1729000000000000001"]});
 assert.equal(call.url.searchParams.has("access_token"),false);
 await assert.rejects(provider.setStatus({...AUTH,metadata:{}},"1","paused"),e=>e.code==="TIKTOK_SHOP_CIPHER_MISSING");
});

test("authorize URL, token exchange, shop cipher in metadata and refresh (token/refresh endpoint) keeps metadata",async()=>{
 const token=c=>ok({access_token:"AT-"+c.url.searchParams.get("grant_type"),access_token_expire_in:1893456000,refresh_token:"RT-new",refresh_token_expire_in:1900000000,open_id:"open-9",seller_name:"Loja",seller_base_region:"BR",user_type:0,granted_scopes:["seller.order.info"]});
 const {calls,provider}=mock({
  "GET https://auth.tiktok-shops.com/api/v2/token/get":token,"GET https://auth.tiktok-shops.com/api/v2/token/refresh":token,
  "GET /authorization/202309/shops":{shops:[{id:"7495000000000000001",name:"Loja BR",region:"BR",cipher:"ROW_cipher_br",code:"BRLCX"},{id:"1",name:"US",region:"US",cipher:"US_c"}]}});
 const url=new URL(provider.authorizationUrl("state-1","unused"));
 assert.equal(url.origin+url.pathname,"https://services.tiktokshop.com/open/authorize");
 assert.equal(url.searchParams.get("service_id"),CONFIG.serviceId);assert.equal(url.searchParams.get("state"),"state-1");assert.equal(provider.pkce,false);
 const tokens=await provider.connect({code:"auth-code",params:{}});
 assert.equal(calls[0].url.searchParams.get("grant_type"),"authorized_code");assert.equal(calls[0].url.searchParams.get("auth_code"),"auth-code");
 assert.equal(calls[1].headers["x-tts-access-token"],"AT-authorized_code");assert.equal(calls[1].url.searchParams.has("shop_cipher"),false);
 assert.deepEqual({userId:tokens.userId,metadata:tokens.metadata,expiresAt:tokens.expiresAt},{userId:"7495000000000000001",metadata:{shopCipher:"ROW_cipher_br",openId:"open-9"},expiresAt:new Date(1893456000000).toISOString()});
 const refreshed=await provider.refreshConnection("RT-old",{accountId:"7495000000000000001",metadata:{shopCipher:"ROW_cipher_br",openId:"open-1"}});
 const refreshCall=calls.at(-1);assert.equal(refreshCall.url.pathname,"/api/v2/token/refresh");
 assert.equal(refreshCall.url.searchParams.get("grant_type"),"refresh_token");assert.equal(refreshCall.url.searchParams.get("refresh_token"),"RT-old");
 assert.equal(calls[0].url.pathname,"/api/v2/token/get");
 const before=calls.length;
 await assert.rejects(provider.connect({code:"null",params:{error:"auth_denied"}}),e=>e.code==="TIKTOK_AUTHORIZATION_DENIED");assert.equal(calls.length,before);
 assert.equal(refreshed.metadata.shopCipher,"ROW_cipher_br");assert.equal(refreshed.userId,"7495000000000000001");assert.equal(refreshed.refreshToken,"RT-new");
 const rejected=new TikTokShopProvider(CONFIG,async()=>new Response(JSON.stringify({code:36004004,message:"invalid refresh token RT-old super-secret-value"}),{status:200}));
 await assert.rejects(rejected.refreshConnection("RT-old",{accountId:"1",metadata:{}}),e=>e.code==="REAUTH_REQUIRED"&&!e.message.includes("RT-old"));
 await provider.disconnect(AUTH);
});

test("account is BR-only and returns the shop cipher",async()=>{
 const br=mock({"GET /authorization/202309/shops":{shops:[{id:"7495000000000000001",name:"Loja BR",region:"BR",cipher:"ROW_cipher_br"}]}}).provider;
 assert.deepEqual(await br.account(AUTH),{id:"7495000000000000001",name:"Loja BR",siteId:"BR",userProducts:false,metadata:{shopCipher:"ROW_cipher_br"}});
 const us=mock({"GET /authorization/202309/shops":{shops:[{id:"7495000000000000001",name:"US",region:"US",cipher:"c"}]}}).provider;
 await assert.rejects(us.account(AUTH),e=>e instanceof MarketplaceError&&e.code==="TIKTOK_ACCOUNT_REGION_UNSUPPORTED");
 const connectUs=mock({"GET https://auth.tiktok-shops.com/api/v2/token/get":{access_token:"a",refresh_token:"r",access_token_expire_in:1893456000},"GET /authorization/202309/shops":{shops:[{id:"1",region:"US",cipher:"c"}]}}).provider;
 await assert.rejects(connectUs.connect({code:"x",params:{}}),e=>e.code==="TIKTOK_ACCOUNT_REGION_UNSUPPORTED");
});

test("product normalizes to ExternalListing with SKUs, sales attributes, stock and status",async()=>{
 const {provider}=mock({"GET /product/202309/products/1729000000000000001":PRODUCT,"GET /logistics/202309/warehouses":WAREHOUSES,
  "POST /product/202502/products/search":c=>ok(c.url.searchParams.get("page_token")?{products:[],total_count:1}:{products:[{id:"1729000000000000001"}],next_page_token:"tok2",total_count:1})});
 const listing=await provider.getListing(AUTH,"1729000000000000001");
 assert.equal(listing.sellerId,AUTH.accountId);assert.equal(listing.categoryId,"601226");assert.equal(listing.status,"active");assert.equal(listing.model,"LEGACY");
 assert.equal(listing.quantity,7);assert.equal(listing.priceCents,5990);assert.equal(listing.currency,"BRL");assert.equal(listing.description,"Linha 1\nA & B");
 assert.deepEqual(listing.variants,[{id:"1729100000000000001",sku:"CAM-P",ean:"7891234567895",priceCents:5990,quantity:3,options:{Tamanho:"P"}},{id:"1729100000000000002",sku:"CAM-M",ean:undefined,priceCents:6490,quantity:4,options:{Tamanho:"M"}}]);
 assert.deepEqual(listing.attributes,[{id:"100198",value_id:"1000",value_name:"Algodão"}]);
 assert.deepEqual(listing.pictures,["https://p16-oec.tiktokcdn.com/img1.jpg"]);
 assert.equal(listing.stockWritable,true);assert.equal(listing.priceWritable,true);
 assert.deepEqual(await provider.listExternalProducts(AUTH),{ids:["1729000000000000001"],cursor:"tok2",total:1});
 for(const [status,expected] of [["SELLER_DEACTIVATED","paused"],["PLATFORM_DEACTIVATED","paused"],["FREEZE","closed"],["DELETED","closed"],["PENDING","under_review"],["DRAFT","draft"]]){
  const p=mock({"GET /product/202309/products/1729000000000000001":{...PRODUCT,status},"GET /logistics/202309/warehouses":WAREHOUSES}).provider;
  assert.equal((await p.getListing(AUTH,"1729000000000000001")).status,expected);
 }
 const ambiguous=mock({"GET /product/202309/products/1729000000000000001":PRODUCT,"GET /logistics/202309/warehouses":{warehouses:[...WAREHOUSES.warehouses,{id:"WH-2",type:"SALES_WAREHOUSE",effect_status:"ENABLED"}]}}).provider;
 assert.equal((await ambiguous.getListing(AUTH,"1729000000000000001")).stockWritable,false);
});

test("price and inventory payloads use SKU ids, BRL amounts and the single sales warehouse",async()=>{
 const {calls,provider}=mock({"GET /product/202309/products/1729000000000000001":PRODUCT,"GET /logistics/202309/warehouses":WAREHOUSES,
  "POST /product/202309/products/1729000000000000001/prices/update":{},"POST /product/202309/products/1729000000000000001/inventory/update":{}});
 await provider.syncPrice(AUTH,"1729000000000000001",4990,[{id:"1729100000000000001",priceCents:4990},{id:"1729100000000000002",priceCents:5490}]);
 assert.deepEqual(calls.at(-1).body,{skus:[{id:"1729100000000000001",price:{amount:"49.90",currency:"BRL"}},{id:"1729100000000000002",price:{amount:"54.90",currency:"BRL"}}]});
 await provider.syncStock(AUTH,"1729000000000000001",0,[{id:"1729100000000000001",quantity:5},{id:"1729100000000000002",quantity:0}]);
 assert.deepEqual(calls.at(-1).body,{skus:[{id:"1729100000000000001",inventory:[{warehouse_id:"WH-SALES",quantity:5}]},{id:"1729100000000000002",inventory:[{warehouse_id:"WH-SALES",quantity:0}]}]});
 await assert.rejects(provider.syncStock(AUTH,"1729000000000000001",3),e=>e.code==="TIKTOK_VARIANTS_REQUIRED");
 await assert.rejects(provider.syncStock(AUTH,"1729000000000000001",0,[{id:"1729100000000000001",quantity:100000}]),e=>e.code==="INVALID_EXTERNAL_QUANTITY");
 const ambiguous=mock({"GET /logistics/202309/warehouses":{warehouses:[{id:"A",type:"SALES_WAREHOUSE",effect_status:"ENABLED"},{id:"B",type:"SALES_WAREHOUSE",effect_status:"ENABLED"}]}}).provider;
 await assert.rejects(ambiguous.syncStock(AUTH,"1729000000000000001",1,[{id:"1729100000000000001",quantity:1}]),e=>e.code==="TIKTOK_STOCK_WAREHOUSE_AMBIGUOUS");
});

test("create uploads images (multipart), sends package and SKUs, and rejects unknown settings",async()=>{
 const {calls,provider}=mock({"GET /logistics/202309/warehouses":WAREHOUSES,
  "GET https://cdn.vorix.test/a.jpg":()=>new Response(new Uint8Array([255,216,255,1]),{status:200,headers:{"content-type":"image/jpeg"}}),
  "POST /product/202309/images/upload":{uri:"tos-uploaded",url:"https://p16.tiktokcdn.com/x.jpg"},
  "POST /product/202309/products":{product_id:"1729000000000000009",skus:[{id:"1729100000000000009",seller_sku:"S-1"}]}});
 const draft={categoryId:"601226",title:"Caneca",description:"Cerâmica <300ml>",condition:"new",listingTypeId:"x",buyingMode:"buy_it_now",attributes:[{id:"100198",value_id:"1000"}],pictures:["https://cdn.vorix.test/a.jpg"],settings:{}};
 const created=await provider.createListing(AUTH,{draft,priceCents:3990,quantity:8,currency:"BRL",sku:"S-1",userProducts:false,correlation:"vorix:1",package:{weightGrams:350,lengthCm:10,widthCm:10,heightCm:12}});
 const upload=calls.find(c=>c.url.pathname==="/product/202309/images/upload");assert.ok(upload.raw instanceof FormData);assert.equal(upload.headers["Content-Type"],undefined);
 const q=Object.fromEntries(upload.url.searchParams);assert.equal(q.sign,tiktokShopSign(CONFIG.appSecret,"/product/202309/images/upload",q,""));
 const body=calls.at(-1).body;
 assert.deepEqual(body.main_images,[{uri:"tos-uploaded"}]);assert.equal(body.description,"<p>Cerâmica &lt;300ml&gt;</p>");
 assert.deepEqual(body.package_weight,{value:"0.35",unit:"KILOGRAM"});assert.deepEqual(body.package_dimensions,{length:"10",width:"10",height:"12",unit:"CENTIMETER"});
 assert.deepEqual(body.skus,[{seller_sku:"S-1",sales_attributes:[],price:{amount:"39.90",currency:"BRL"},inventory:[{warehouse_id:"WH-SALES",quantity:8}]}]);
 assert.deepEqual(body.product_attributes,[{id:"100198",values:[{id:"1000"}]}]);
 assert.equal(created.id,"1729000000000000009");
 await assert.rejects(provider.createListing(AUTH,{draft:{...draft,settings:{price:1}},priceCents:1,quantity:1,currency:"BRL",userProducts:false,correlation:"c",package:{weightGrams:1}}),e=>e.code==="TIKTOK_UNSUPPORTED_LISTING_SETTING");
 await assert.rejects(provider.createListing(AUTH,{draft:{...draft,pictures:["https://127.0.0.1/a.jpg"]},priceCents:1,quantity:1,currency:"BRL",userProducts:false,correlation:"c",package:{weightGrams:1}}),e=>e.code==="TIKTOK_IMAGE_INVALID_URL");
});

test("update uses Partial Edit Product (only changed top-level fields, never price/inventory) and refuses category changes",async()=>{
 const {calls,provider}=mock({"GET /product/202309/products/1729000000000000001":PRODUCT,
  "GET https://cdn.vorix.test/b.png":()=>new Response(new Uint8Array([137,80,78,71]),{status:200,headers:{"content-type":"image/png"}}),
  "POST /product/202309/images/upload":{uri:"tos-new",url:"https://p16.tiktokcdn.com/y.png",use_case:"MAIN_IMAGE"},
  "POST /product/202509/products/1729000000000000001/partial_edit":{product_id:"1729000000000000001",skus:[],audit:{status:"AUDITING"}}});
 await provider.updateListing(AUTH,"1729000000000000001",{title:"Camiseta nova",pictures:["https://cdn.vorix.test/b.png"],settings:{}});
 const edit=calls.at(-1);assert.equal(edit.method,"POST");
 assert.deepEqual(edit.body,{title:"Camiseta nova",main_images:[{uri:"tos-new"}]});
 const q=Object.fromEntries(edit.url.searchParams);assert.equal(q.sign,tiktokShopSign(CONFIG.appSecret,"/product/202509/products/1729000000000000001/partial_edit",q,edit.raw));
 await provider.updateListing(AUTH,"1729000000000000001",{categoryId:"601226",description:"Nova"});
 assert.deepEqual(calls.at(-1).body,{description:"<p>Nova</p>"});
 await assert.rejects(provider.updateListing(AUTH,"1729000000000000001",{categoryId:"999999"}),e=>e.code==="TIKTOK_CATEGORY_CHANGE_UNSUPPORTED");
 assert.ok(!calls.some(c=>c.method==="PUT"));
});

test("order normalization: status mapping, per-unit aggregation, cents and no contact data",async()=>{
 const {calls,provider}=mock({"GET /order/202507/orders":{orders:[ORDER]}});
 const order=await provider.getOrder(AUTH,"576000000000000001");
 assert.equal(calls[0].url.searchParams.get("ids"),"576000000000000001");
 assert.equal(order.state,"READY_TO_SHIP");assert.equal(order.accountId,AUTH.accountId);
 assert.deepEqual(order.items.map(i=>[i.externalItemId,i.externalVariationId,i.quantity,i.unitPriceCents]),[["1729000000000000001","1729100000000000001",2,5990],["1729000000000000001","1729100000000000002",1,5990]]);
 assert.deepEqual([order.subtotalCents,order.discountCents,order.shippingCents,order.totalCents],[17970,1000,1250,18220]);
 assert.deepEqual(order.buyer,{id:"buyer-77"});assert.deepEqual(order.shippingAddress,{city:"São Paulo",state:"São Paulo",postalCode:"01001-000"});
 assert.ok(!JSON.stringify(order).includes("Fulano")&&!JSON.stringify(order).includes("scs.tiktokw")&&!JSON.stringify(order).includes("*****"));
 assert.equal(order.shipment.externalId,"1153000000000000001");assert.equal(order.shipment.labelAvailable,true);assert.equal(order.shipment.fulfilledByMarketplace,false);
 assert.equal(order.shipment.trackingNumber,"BR123");assert.equal(order.paidAt,new Date(1761500100000).toISOString());
 assert.equal(order.data.shippingType,"TIKTOK");assert.equal(order.data.needUploadInvoice,"INVOICE_UPLOADED");assert.ok(!JSON.stringify(order).includes("123.456.789"));
 // Etiqueta só com TikTok Shipping e, no BR, depois da NF-e enviada.
 for(const patch of [{shipping_type:"SELLER"},{need_upload_invoice:"NEED_INVOICE"},{need_upload_invoice:"INVOICE_PROCESSING"}]){
  const p=mock({"GET /order/202507/orders":{orders:[{...ORDER,...patch}]}}).provider;
  assert.equal((await p.getOrder(AUTH,ORDER.id)).shipment.labelAvailable,false,JSON.stringify(patch));
 }
 const expected={UNPAID:"PENDING_PAYMENT",ON_HOLD:"PENDING_PAYMENT",AWAITING_SHIPMENT:"PAID",PARTIALLY_SHIPPING:"SHIPPED",IN_TRANSIT:"SHIPPED",DELIVERED:"DELIVERED",COMPLETED:"DELIVERED",CANCELLED:"CANCELLED"};
 for(const [status,state] of Object.entries(expected)){
  const p=mock({"GET /order/202507/orders":{orders:[{...ORDER,status,fulfillment_type:"FULFILLMENT_BY_TIKTOK"}]},"GET /fulfillment/202309/orders/576000000000000001/tracking":{tracking:[{description:"Saiu",update_time_millis:2},{description:"Coletado",update_time_millis:1}]}}).provider;
  const o=await p.getOrder(AUTH,"576000000000000001");assert.equal(o.state,state,status);assert.equal(o.shipment.fulfilledByMarketplace,true);assert.equal(o.shipment.labelAvailable,false);
  if(state==="SHIPPED")assert.equal(o.shipment.substatus,"Saiu");
 }
 assert.equal(tiktokCents("0.5"),50);assert.equal(tiktokCents("1234.56"),123456);assert.throws(()=>tiktokCents("1.234"));assert.throws(()=>tiktokCents("-1"));
 const listing=mock({"POST /order/202309/orders/search":c=>{assert.deepEqual(c.body,{update_time_ge:1761500000,update_time_lt:1761600000});assert.equal(c.url.searchParams.get("page_size"),"50");
  return ok({orders:[{id:"9"}],next_page_token:"n",total_count:1});}}).provider;
 assert.deepEqual(await listing.listOrders(AUTH,{updatedFrom:new Date(1761500000000).toISOString(),updatedTo:new Date(1761600000000).toISOString()}),{ids:["9"],cursor:"n"});
});

test("shipping label is downloaded from the official doc_url only when awaiting collection",async()=>{
 const pdf=Buffer.from("%PDF-1.4 label");
 const {calls,provider}=mock({"GET /order/202507/orders":{orders:[ORDER]},
  "GET /fulfillment/202309/packages/1153000000000000001/shipping_documents":{doc_url:"https://open-fs-va.tiktokshop.com/label.pdf?sig=1",tracking_number:"BR123"},
  "GET https://open-fs-va.tiktokshop.com/label.pdf":()=>new Response(pdf,{status:200,headers:{"content-type":"application/pdf"}})});
 const order=await provider.getOrder(AUTH,ORDER.id);
 const label=await provider.shippingLabel(AUTH,order);
 assert.equal(calls.find(c=>c.url.pathname.endsWith("shipping_documents")).url.searchParams.get("document_type"),"SHIPPING_LABEL");
 assert.deepEqual(label,{contentType:"application/pdf",base64:pdf.toString("base64"),filename:"etiqueta-tiktok-576000000000000001.pdf"});
 assert.equal(calls.at(-1).options.redirect,"error");
 await assert.rejects(provider.shippingLabel(AUTH,{...order,externalStatus:"AWAITING_SHIPMENT"}),e=>e.code==="TIKTOK_LABEL_NOT_AVAILABLE");
 const evil=mock({"GET /fulfillment/202309/packages/1153000000000000001/shipping_documents":{doc_url:"https://evil.example/label.pdf"}}).provider;
 await assert.rejects(evil.shippingLabel(AUTH,order),e=>e.code==="TIKTOK_LABEL_NOT_AVAILABLE");
});

test("seller cancel: reason must come from the official aftersale eligibility (SELLER/CANCEL) before Cancel Order 202602",async()=>{
 assert.equal(new TikTokShopProvider(CONFIG,async()=>{throw new Error("x");}).capabilities.cancelOrder,"SUPPORTED");
 const ELIGIBILITY="GET /return_refund/202602/orders/576000000000000001/aftersale_eligibility";
 // BR, AWAITING_SHIPMENT (Cancel reasons > BR Market > Seller Initiates Cancel Reason).
 const eligible={sku_eligibility:[{sku_id:"1729100000000000001",line_item_eligibility:[{request_type:"CANCEL",eligible:true,order_line_list:[{order_line_item_id:"L1"},{order_line_item_id:"L2"}],
  available_reason_names:["seller_cancel_reason_out_of_stock","seller_cancel_paid_reason_address_not_deliver"]}]},
  {sku_id:"1729100000000000002",line_item_eligibility:[{request_type:"CANCEL",eligible:true,order_line_list:[{order_line_item_id:"L3"}],available_reason_names:["seller_cancel_reason_out_of_stock"]}]}]};
 const {calls,provider}=mock({[ELIGIBILITY]:eligible,"POST /return_refund/202602/cancellations":{cancel_id:"4035319218955782461",cancel_status:"CANCELLATION_REQUEST_SUCCESS"}});
 const base={id:"576000000000000001",externalStatus:"AWAITING_SHIPMENT"};
 await provider.cancelOrder(AUTH,base,"seller_cancel_reason_out_of_stock");
 assert.equal(calls[0].url.searchParams.get("initiate_aftersale_user"),"SELLER");assert.equal(calls[0].url.searchParams.get("request_types"),"CANCEL");
 const q=Object.fromEntries(calls[0].url.searchParams);assert.equal(q.sign,tiktokShopSign(CONFIG.appSecret,"/return_refund/202602/orders/576000000000000001/aftersale_eligibility",q,""));
 assert.deepEqual(calls[1].body,{order_id:"576000000000000001",cancel_reason:"seller_cancel_reason_out_of_stock"});
 assert.equal(calls[1].url.pathname,"/return_refund/202602/cancellations");assert.equal(calls[1].url.searchParams.get("shop_cipher"),"ROW_cipher_br");
 // Motivo fora da lista atual de alguma linha (ex.: removido do canal) nunca é enviado.
 const sent=calls.length;
 await assert.rejects(provider.cancelOrder(AUTH,base,"seller_cancel_paid_reason_address_not_deliver"),e=>e.code==="TIKTOK_CANCEL_REASON_NOT_AVAILABLE");
 assert.equal(calls.filter(c=>c.method==="POST").length,1);assert.equal(calls.length,sent+1);
 await assert.rejects(provider.cancelOrder(AUTH,{...base,externalStatus:"IN_TRANSIT"},"seller_cancel_reason_out_of_stock"),e=>e.code==="TIKTOK_ORDER_NOT_CANCELLABLE");
 await assert.rejects(provider.cancelOrder(AUTH,base,"cliente desistiu"),e=>e.code==="TIKTOK_CANCEL_REASON_CODE_REQUIRED");
 const ineligible=mock({[ELIGIBILITY]:{sku_eligibility:[{sku_id:"1",line_item_eligibility:[{request_type:"CANCEL",eligible:false,ineligible_code:25001001,ineligible_reason:"invalid order status"}]}]}});
 await assert.rejects(ineligible.provider.cancelOrder(AUTH,base,"seller_cancel_reason_out_of_stock"),e=>e.code==="TIKTOK_ORDER_NOT_CANCELLABLE");
 assert.ok(!ineligible.calls.some(c=>c.method==="POST"));
 const empty=mock({[ELIGIBILITY]:{}}).provider;
 await assert.rejects(empty.cancelOrder(AUTH,base,"seller_cancel_reason_out_of_stock"),e=>e.code==="TIKTOK_ORDER_NOT_CANCELLABLE");
});

test("returns map status, refund and aggregate return line items",async()=>{
 const {calls,provider}=mock({"POST /return_refund/202602/returns/search":{return_orders:[
  {return_id:"R1",order_id:"576000000000000001",return_status:"BUYER_SHIPPED_ITEM",return_reason:"ecom_order_delivered_refund_and_return_reason_damaged",create_time:1761600000,update_time:1761700000,
   refund_amount:{currency:"BRL",refund_total:"119.80",refund_subtotal:"119.80",refund_shipping_fee:"0"},
   return_line_items:[{return_line_item_id:"RL1",order_line_item_id:"L1",sku_id:"1729100000000000001",product_name:"Camiseta",seller_sku:"CAM-P"},{return_line_item_id:"RL2",order_line_item_id:"L2",sku_id:"1729100000000000001",product_name:"Camiseta"}]},
  {return_id:"R2",order_id:"576000000000000001",return_status:"RETURN_OR_REFUND_REQUEST_CANCEL",create_time:1761600000,return_line_items:[{return_line_item_id:"RL3",order_line_item_id:"L3",sku_id:"1729100000000000002"}]},
  {return_id:"R3",order_id:"576000000000000001",return_status:"EXCHANGE_REQUEST_PENDING",create_time:1761600000,return_line_items:[{order_line_item_id:"L3",sku_id:"1729100000000000002"}]},
  {return_id:"R4",order_id:"576000000000000001",return_status:"REPLACEMENT_REQUEST_CANCEL",create_time:1761600000,return_line_items:[{order_line_item_id:"L3",sku_id:"1729100000000000002"}]}],next_page_token:""},
  "GET /order/202507/orders":{orders:[ORDER]}});
 const returns=await provider.getReturns(AUTH,"576000000000000001");
 assert.deepEqual(calls[0].body,{order_ids:["576000000000000001"]});
 assert.equal(returns[0].state,"IN_TRANSIT");assert.equal(returns[0].refundCents,11980);
 assert.deepEqual(returns[0].items,[{externalItemId:"1729000000000000001",externalVariationId:"1729100000000000001",quantity:2}]);
 assert.equal(returns[1].state,"CANCELLED");assert.deepEqual(returns[1].items,[{externalItemId:"1729000000000000001",externalVariationId:"1729100000000000002",quantity:1}]);
 assert.deepEqual([returns[2].state,returns[3].state],["REQUESTED","CANCELLED"]);
 assert.equal(calls[0].url.searchParams.get("page_size"),"50");assert.equal(calls.filter(c=>c.url.pathname.endsWith("/returns/search")).length,1);
});

test("webhook: signature accept/reject and event mapping",()=>{
 const {provider}=mock({});
 const sign=(raw,secret=CONFIG.appSecret,key=CONFIG.appKey)=>createHmac("sha256",secret).update(key+raw).digest("hex");
 const raw=JSON.stringify({type:1,tts_notification_id:"7327",shop_id:"7495000000000000001",timestamp:1761600000,data:{order_id:"576000000000000001",order_status:"AWAITING_SHIPMENT"}});
 assert.deepEqual(provider.parseNotification({headers:{authorization:sign(raw)},rawBody:raw,url:"/"}),
  {accountId:"7495000000000000001",eventId:"7327",topic:"ORDER_STATUS_CHANGE",kind:"ORDER",resource:"order:576000000000000001",externalOrderId:"576000000000000001"});
 assert.equal(provider.parseNotification({headers:{},rawBody:raw,url:"/"}),undefined);
 assert.equal(provider.parseNotification({headers:{authorization:sign(raw,"other-secret")},rawBody:raw,url:"/"}),undefined);
 assert.equal(provider.parseNotification({headers:{authorization:sign(raw)},rawBody:raw+" ",url:"/"}),undefined);
 assert.equal(provider.parseNotification({headers:{authorization:"zz"},rawBody:raw,url:"/"}),undefined);
 const ret=JSON.stringify({type:12,shop_id:"7495000000000000001",timestamp:1,data:{order_id:"576000000000000001",return_id:"R1",return_status:"AWAITING_BUYER_SHIP"}});
 const parsedReturn=provider.parseNotification({headers:{Authorization:sign(ret)},rawBody:ret,url:"/"});
 assert.equal(parsedReturn.kind,"RETURN");assert.equal(parsedReturn.externalOrderId,"576000000000000001");assert.match(parsedReturn.eventId,/^[0-9a-f]{64}$/);
 const product=JSON.stringify({type:5,tts_notification_id:"n5",shop_id:"7495000000000000001",timestamp:1,data:{product_id:"1729000000000000001",status:"PRODUCT_DEACTIVATED"}});
 const parsedProduct=provider.parseNotification({headers:{authorization:sign(product)},rawBody:product,url:"/"});
 assert.equal(parsedProduct.kind,"LISTING");assert.equal(parsedProduct.resource,"product:1729000000000000001");
 const other=JSON.stringify({type:6,tts_notification_id:"n6",shop_id:"7495000000000000001",timestamp:1,data:{}});
 assert.equal(provider.parseNotification({headers:{authorization:sign(other)},rawBody:other,url:"/"}),undefined);
 // type 2 não tem página de tópico oficial: ignorado.
 const reverse=JSON.stringify({type:2,tts_notification_id:"n2",shop_id:"7495000000000000001",timestamp:1,data:{order_id:"576000000000000001"}});
 assert.equal(provider.parseNotification({headers:{authorization:sign(reverse)},rawBody:reverse,url:"/"}),undefined);
 // Exemplo oficial do tópico 5: product_id numérico acima de 2^53 — os dígitos vêm do corpo bruto, sem perda.
 const numeric='{"type":5,"tts_notification_id":"7327112393057371910","shop_id":"7494049642642441621","timestamp":1644412885,"data":{"product_id":576486316948490001,"status":"PRODUCT_FIRST_PASS_REVIEW","suspended_reason":"","update_time":1644412885}}';
 assert.equal(provider.parseNotification({headers:{authorization:sign(numeric)},rawBody:numeric,url:"/"}).resource,"product:576486316948490001");
 // Package update (4): pedidos em package_list[].order_id_list.
 const pkg=JSON.stringify({type:4,tts_notification_id:"7327112393057371910",shop_id:"7494049642642441621",timestamp:1644412885,data:{sc_type:"COMBINE",role_type:"ROLE_USER",package_list:[{package_id:"123456",order_id_list:["152523","532123"]}],update_time:1644412885}});
 assert.deepEqual(provider.parseNotification({headers:{authorization:sign(pkg)},rawBody:pkg,url:"/"}),
  {accountId:"7494049642642441621",eventId:"7327112393057371910",topic:"PACKAGE_UPDATE",kind:"ORDER",resource:"order:152523",externalOrderId:"152523"});
 const cancel=JSON.stringify({type:11,tts_notification_id:"n11",shop_id:"7494049642642441621",timestamp:1644412885,data:{order_id:"576486316948490001",cancellations_role:"BUYER",cancel_status:"CANCELLATION_REQUEST_PENDING",cancel_id:"4035318504086604100",create_time:1627587600}});
 assert.equal(provider.parseNotification({headers:{authorization:sign(cancel)},rawBody:cancel,url:"/"}).topic,"CANCELLATION_STATUS_CHANGE");
});

test("webhook signature matches the official reproducible example (app_key abcdef, app_secret 123)",()=>{
 const official=new TikTokShopProvider({...CONFIG,appKey:"abcdef",appSecret:"123"},async()=>{throw new Error("no network");});
 const raw='{"type":1,"tts_notification_id":"7380066284010030890","shop_id":"7495540735365777507","timestamp":1718305585,"data":{"is_on_hold_order":true,"order_id":"576653688135258178","order_status":"UNPAID","update_time":1718305585}}';
 assert.deepEqual(official.parseNotification({headers:{Authorization:"5dec0f11ec2f6783b8deee53c9ffbf8d024302f7c7e7fa55a35d17629031ac05"},rawBody:raw,url:"/"}),
  {accountId:"7495540735365777507",eventId:"7380066284010030890",topic:"ORDER_STATUS_CHANGE",kind:"ORDER",resource:"order:576653688135258178",externalOrderId:"576653688135258178"});
 assert.equal(official.parseNotification({headers:{Authorization:"Bearer 5dec0f11ec2f6783b8deee53c9ffbf8d024302f7c7e7fa55a35d17629031ac05"},rawBody:raw,url:"/"}),undefined);
});

test("signing matches the official Get Authorized Shops walkthrough",()=>{
 // docv2/page/686da77d813b8f0491e0e29f: abc000def111/authorization/202309/shopsapp_key123456timestamp1234567890abc000def111
 const expected=createHmac("sha256","abc000def111").update("abc000def111/authorization/202309/shopsapp_key123456timestamp1234567890abc000def111").digest("hex");
 assert.equal(tiktokShopSign("abc000def111","/authorization/202309/shops",{app_key:"123456",timestamp:"1234567890"}),expected);
});

test("429 is retryable with retry-after, expired token is REAUTH_REQUIRED, errors never leak bodies or secrets",async()=>{
 const limited=new TikTokShopProvider(CONFIG,async()=>new Response(JSON.stringify({code:0,message:"ACCESS-TOKEN-SECRET"}),{status:429,headers:{"retry-after":"7"}}));
 await assert.rejects(limited.setStatus(AUTH,"1","paused"),e=>e.code==="TIKTOK_RATE_LIMIT"&&e.retryable===true&&e.retryAfterMs===7000);
 // Business code 36009002 = rate limit mesmo com HTTP 200; Retry-After pode ser data HTTP.
 const business=new TikTokShopProvider(CONFIG,async()=>new Response(JSON.stringify({code:36009002,message:"Too many requests"}),{status:200}));
 await assert.rejects(business.setStatus(AUTH,"1","paused"),e=>e.code==="TIKTOK_RATE_LIMIT"&&e.retryable===true&&e.retryAfterMs===30000);
 const dated=new TikTokShopProvider(CONFIG,async()=>new Response("{}",{status:429,headers:{"retry-after":new Date(Date.now()+120000).toUTCString()}}));
 await assert.rejects(dated.setStatus(AUTH,"1","paused"),e=>e.code==="TIKTOK_RATE_LIMIT"&&e.retryAfterMs>100000&&e.retryAfterMs<=120000);
 const expired=new TikTokShopProvider(CONFIG,async()=>new Response(JSON.stringify({code:105002,message:"Access token is expired ACCESS-TOKEN-SECRET"}),{status:200}));
 await assert.rejects(expired.setStatus(AUTH,"1","paused"),e=>e.code==="REAUTH_REQUIRED"&&e.retryable===false);
 const unauthorized=new TikTokShopProvider(CONFIG,async()=>new Response("nope",{status:401}));
 await assert.rejects(unauthorized.getOrder(AUTH,"1"),e=>e.code==="REAUTH_REQUIRED");
 const down=new TikTokShopProvider(CONFIG,async()=>new Response("upstream super-secret-value",{status:503}));
 await assert.rejects(down.getOrder(AUTH,"1"),e=>e.code==="TIKTOK_UNAVAILABLE"&&e.retryable===true);
 const network=new TikTokShopProvider(CONFIG,async()=>{throw new Error("ECONNRESET ACCESS-TOKEN-SECRET");});
 await assert.rejects(network.getOrder(AUTH,"1"),e=>e.code==="TIKTOK_NETWORK_UNCERTAIN"&&e.retryable===true);
 const rejected=new TikTokShopProvider(CONFIG,async()=>new Response(JSON.stringify({code:12052700,message:"bad field ACCESS-TOKEN-SECRET super-secret-value"}),{status:200}));
 await assert.rejects(rejected.getOrder(AUTH,"1"),e=>{
  assert.equal(e.code,"TIKTOK_API_ERROR_12052700");
  for(const s of ["ACCESS-TOKEN-SECRET","super-secret-value","bad field"])assert.ok(!e.message.includes(s)&&!JSON.stringify(e).includes(s));return true;
 });
});

test("config requires credentials and only accepts the official API base",()=>{
 const env={TIKTOK_SHOP_APP_KEY:"appkey123",TIKTOK_SHOP_APP_SECRET:"s",TIKTOK_SHOP_SERVICE_ID:"700"};
 assert.deepEqual(tiktokShopConfig(env),{appKey:"appkey123",appSecret:"s",serviceId:"700",apiBaseUrl:"https://open-api.tiktokglobalshop.com"});
 assert.ok(tiktokShopConfig({...env,TIKTOK_SHOP_API_BASE_URL:"https://open-api.tiktokglobalshop.com/"}));
 assert.equal(tiktokShopConfig({...env,TIKTOK_SHOP_API_BASE_URL:"https://evil.example"}),undefined);
 assert.equal(tiktokShopConfig({TIKTOK_SHOP_APP_KEY:"a"}),undefined);
 assert.equal(new TikTokShopProvider(tiktokShopConfig(env)).applicationId,"appkey123");
});
