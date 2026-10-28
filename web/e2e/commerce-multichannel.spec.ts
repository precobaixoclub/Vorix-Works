import {test,expect,type Page} from "@playwright/test";
import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {loginCookie,mockConversasBackend,WORKSPACE_ID} from "./fixtures/mock-backend";
import {OWNER_PERMISSIONS} from "./fixtures/access-fixture";

const output=join(process.cwd(),"..","docs","commerce-multichannel-evidence");mkdirSync(output,{recursive:true});
const at=(minutes:number)=>new Date(Date.UTC(2026,9,27,15,0)-minutes*60000).toISOString();
const base={paymentStatus:"APPROVED",shippingStatus:"PENDING",currency:"BRL",refundedCents:0,subtotalCents:15000,discountCents:0,shippingCents:0,utm:{},customer:{name:"Comprador",email:"",phone:""}};
const siteOrder={...base,id:"ord-site",number:1001,source:"SITE",status:"DELIVERED",shippingStatus:"DELIVERED",stockState:"SOLD",totalCents:18000,subtotalCents:18000,createdAt:at(300),customer:{name:"Ana Lima",email:"ana@example.test",phone:"+5511999990000"},
 delivery:{optionId:"d1",kind:"SHIPPING",label:"Correios PAC",priceCents:0,requiresAddress:true},
 items:[{id:"it-1",productId:"p-1",name:"Camiseta Vorix",variantLabel:"M",quantity:3,unitPriceCents:5000,totalCents:15000},{id:"it-2",productId:"p-2",name:"Boné Vorix",quantity:1,unitPriceCents:3000,totalCents:3000}]};
const mlOrder={...base,id:"ord-ml",number:1002,source:"MERCADO_LIVRE",status:"PAID",stockState:"CONFLICT",totalCents:12990,createdAt:at(120),externalOrderId:"2000009876543210",externalStatus:"paid",connectionId:"conn-ml",customer:{name:"Comprador ML",email:"",phone:""},
 items:[{id:"it-ml",productId:"",externalItemId:"MLB123456789",name:"Camiseta Vorix anúncio",quantity:1,unitPriceCents:12990,totalCents:12990}]};
const shopeeOrder={...base,id:"ord-sh",number:1003,source:"SHOPEE",status:"PROCESSING",stockState:"EXTERNAL",totalCents:4990,createdAt:at(60),externalOrderId:"240927SHOPEE01",customer:{name:"Cliente Shopee",email:"",phone:""},items:[{id:"it-sh",productId:"p-1",name:"Camiseta Vorix",quantity:1,unitPriceCents:4990,totalCents:4990}]};
const ORDERS=[shopeeOrder,mlOrder,siteOrder];
const LABEL_PDF=Buffer.from("%PDF-1.4 etiqueta QA").toString("base64");
const CANCEL_BLOCKED="O Mercado Livre não permite cancelar pela API — cancele no painel do Mercado Livre";
const PERMISSIONS=[...OWNER_PERMISSIONS,"order:read","order:manage","order:cancel","payment:refund","marketplace:read","marketplace:manage"];

type Call={method:string;path:string;query:URLSearchParams;body:any};
async function fixture(page:Page){
 await mockConversasBackend(page);
 const calls:Call[]=[];let returns:any[]=[];let returnAttempts=0;let createContacts=false;
 await page.route("**/v1/**",async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  const body=request.postData()?request.postDataJSON():undefined;calls.push({method,path,query:url.searchParams,body});
  let data:unknown;
  if(path==="/v1/auth/me")data={user:{id:"user-qa",email:"qa@vorix.dev",name:"QA"},tenantId:"tenant-qa",role:"owner",permissions:PERMISSIONS,teams:[],isAccountOwner:true};
  else if(path==="/v1/solutions")data={solutions:[{key:"conversations",name:"Conversas",internal:false},{key:"site",name:"Site",internal:false}]};
  else if(path==="/v1/commerce/orders"&&method==="GET"){const source=url.searchParams.get("source");const orders=source?ORDERS.filter(o=>o.source===source):ORDERS;data={orders,total:orders.length};}
  else if(path==="/v1/commerce/orders/ord-ml")data={order:mlOrder,payments:[],events:[{id:"ev-1",type:"external_order_imported",actorType:"provider",data:{},createdAt:at(120)},{id:"ev-2",type:"stock_conflict",actorType:"system",data:{},createdAt:at(119)}],
   shipments:[{id:"shp-1",provider:"MERCADO_LIVRE",status:"SHIPPED",carrier:"Mercado Envios",trackingNumber:"BR123456789ML",trackingUrl:"https://tracking.example.test/BR123456789ML",labelAvailable:true,fulfilledByMarketplace:false,shippedAt:at(30),events:[{status:"READY_TO_SHIP",at:at(90)},{status:"SHIPPED",at:at(30)}]}],
   returns:[],actions:{canCancel:false,cancelBlockedReason:CANCEL_BLOCKED,canRefund:false,partialRefund:false,canLabel:true,canManageReturns:false,canRefresh:true}};
  else if(path==="/v1/commerce/orders/ord-ml/label")data={contentType:"application/pdf",base64:LABEL_PDF,filename:"etiqueta-2000009876543210.pdf"};
  else if(path==="/v1/commerce/orders/ord-ml/refresh")data={ok:true};
  else if(path==="/v1/commerce/orders/ord-site")data={order:siteOrder,payments:[{id:"pay-1",provider:"MERCADO_PAGO",method:"PIX",status:"APPROVED",amountCents:18000,refundedCents:0,currency:"BRL",instructions:{},createdAt:at(300)}],events:[],shipments:[],returns,
   actions:{canCancel:false,canRefund:true,partialRefund:true,canLabel:false,canManageReturns:true,canRefresh:false}};
  else if(path==="/v1/commerce/orders/ord-site/returns"&&method==="POST"){
   returnAttempts++;
   if(returnAttempts===1)return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"UPSTREAM_UNAVAILABLE",message:"Falha temporária. Tente de novo.",recoverable:true}})});
   const created={id:"ret-1",status:"REQUESTED",source:"SITE",reason:body.reason,refundCents:0,refundStatus:"NONE",createdAt:at(5),items:body.items.map((i:any)=>({...i,receivedQuantity:0,restockedQuantity:0}))};
   returns=[created];data=created;
  }else if(path==="/v1/commerce/returns/ret-1/receive"){
   returns=returns.map(r=>({...r,status:"RECEIVED",items:r.items.map((i:any)=>{const v=body.items.find((x:any)=>x.orderItemId===i.orderItemId);return {...i,receivedQuantity:v.receivedQuantity,restockedQuantity:v.restockQuantity};})}));data=returns[0];
  }else if(path==="/v1/commerce/returns/ret-1/refund"){returns=returns.map(r=>({...r,refundStatus:"REFUNDED",refundCents:body.amountCents}));data=returns[0];}
  else if(path==="/v1/commerce/analytics/channels")data={channels:[{source:"SITE",orders:12,sales:10,revenueCents:150000,refundsCents:5000,averageTicketCents:15000,cancellations:1,returns:1},{source:"MERCADO_LIVRE",orders:8,sales:8,revenueCents:96000,refundsCents:0,averageTicketCents:12000,cancellations:0,returns:2},{source:"SHOPEE",orders:3,sales:3,revenueCents:14970,refundsCents:0,averageTicketCents:4990,cancellations:0,returns:0},{source:"TIKTOK_SHOP",orders:0,sales:0,revenueCents:0,refundsCents:0,averageTicketCents:0,cancellations:0,returns:0}],
   totals:{orders:23,sales:21,revenueCents:260970,refundsCents:5000,averageTicketCents:12427,cancellations:1,returns:3}};
  else if(path==="/v1/site-analytics")data={range:{from:"2026-09-28",to:"2026-10-27",timezone:"America/Sao_Paulo",start:"2026-09-28T03:00:00.000Z",end:"2026-10-28T02:59:59.999Z"},scope:"workspace",metrics:{},revenue:{},funnel:[],conversions:[],series:[],products:[],acquisition:[],productTotal:0,acquisitionTotal:0,leads:[],empty:true,futureData:false,notes:["Vendas de marketplaces aparecem em Vendas por canal."]};
  else if(path==="/v1/sites")data={sites:[]};
  else if(path==="/v1/product-metadata")data={categories:[],brands:[],attributes:[]};
  else if(path==="/v1/marketplaces"&&method==="GET")data={configured:true,
   providers:[{id:"MERCADO_LIVRE",capabilities:{listings:"SUPPORTED",publish:"SUPPORTED",priceSync:"SUPPORTED",stockSync:"SUPPORTED",orders:"SUPPORTED",shipments:"SUPPORTED",labels:"SUPPORTED",cancelOrder:"BLOCKED_EXTERNAL_CAPABILITY",returns:"SUPPORTED",webhooks:"SUPPORTED"}},
    {id:"SHOPEE",capabilities:{listings:"SUPPORTED",publish:"BLOCKED_EXTERNAL_CAPABILITY",priceSync:"SUPPORTED",stockSync:"SUPPORTED",orders:"SUPPORTED",shipments:"SUPPORTED",labels:"SUPPORTED",cancelOrder:"SUPPORTED",returns:"BLOCKED_EXTERNAL_CAPABILITY",webhooks:"SUPPORTED"}}],
   connections:[{id:"conn-ml",provider:"MERCADO_LIVRE",externalAccountName:"Loja Vorix ML",externalAccountId:"123",status:"CONNECTED",safetyStock:0,settings:{createContacts},userProducts:true,lastSyncAt:at(10),ordersSyncedAt:at(5)}],listings:[],jobs:[],mappings:[]};
  else if(path==="/v1/marketplaces/catalog")data=[];
  else if(path==="/v1/marketplaces/shopee/connect")data={url:"/workspaces/"+WORKSPACE_ID+"/settings/marketplaces?connected=shopee"};
  else if(path==="/v1/marketplaces/connections/conn-ml/settings"){createContacts=!!body.createContacts;data={ok:true};}
  else return route.fallback();
  return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,data})});
 });
 return calls;
}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);}
const shot=(page:Page,name:string,project:string)=>page.screenshot({path:join(output,`${name}-${project}.png`),fullPage:true});
test.beforeEach(async({context})=>{await loginCookie(context);});

test("filtro por canal, pedido do marketplace com envio, etiqueta, atualização e cancelamento bloqueado",async({page},info)=>{
 const calls=await fixture(page);
 await page.goto(`/workspaces/${WORKSPACE_ID}/site/pedidos`);
 await expect(page.getByRole("heading",{name:"Pedidos",exact:true})).toBeVisible();
 const list=page.getByRole(info.project.name==="1024"||info.project.name==="1440"?"table":"list",{name:"Pedidos"});
 await expect(list.getByText("#1002")).toBeVisible();await expect(list.getByText("Venda sem saldo central")).toBeVisible();await expect(list.getByText("2000009876543210")).toBeVisible();
 await noOverflow(page);await shot(page,"orders-all",info.project.name);
 // Segmentado acessível: clique e teclado.
 const channel=page.getByRole("group",{name:"Canal"});await channel.getByText("Mercado Livre",{exact:true}).click();await expect(page.getByRole("radio",{name:"Mercado Livre"})).toBeChecked();
 await expect.poll(()=>calls.some(c=>c.path==="/v1/commerce/orders"&&c.query.get("source")==="MERCADO_LIVRE")).toBe(true);
 await expect(list.getByText("#1001")).toHaveCount(0);await expect(list.getByText("#1002")).toBeVisible();
 await page.keyboard.press("ArrowRight");await expect(page.getByRole("radio",{name:"Shopee"})).toBeChecked();
 await expect.poll(()=>calls.some(c=>c.path==="/v1/commerce/orders"&&c.query.get("source")==="SHOPEE")).toBe(true);
 await expect(list.getByText("#1003")).toBeVisible();await noOverflow(page);
 await channel.getByText("Todos",{exact:true}).click();await expect(list.getByText("#1001")).toBeVisible();
 await list.getByText("#1002").click();
 const dialog=page.getByRole("dialog");await expect(dialog.getByRole("heading",{name:"Pedido #1002"})).toBeVisible();
 await expect(dialog.getByText("2000009876543210")).toBeVisible();await expect(dialog.getByText("Venda sem saldo central").first()).toBeVisible();
 // Cancelamento bloqueado pelo canal: botão desabilitado + motivo visível.
 await expect(dialog.getByRole("button",{name:"Cancelar pedido"})).toBeDisabled();await expect(dialog.getByRole("note")).toHaveText(CANCEL_BLOCKED);
 await dialog.getByRole("button",{name:"Entrega",exact:true}).click();
 await expect(dialog.getByText("BR123456789ML")).toBeVisible();await expect(dialog.getByRole("list",{name:"Linha do tempo do envio"}).getByRole("listitem")).toHaveCount(2);
 await expect(dialog.getByRole("link",{name:/Acompanhar entrega/})).toHaveAttribute("href","https://tracking.example.test/BR123456789ML");
 await noOverflow(page);await shot(page,"marketplace-order-shipment",info.project.name);
 const download=page.waitForEvent("download");await dialog.getByRole("button",{name:"Baixar etiqueta"}).click();
 expect((await download).suggestedFilename()).toBe("etiqueta-2000009876543210.pdf");
 await dialog.getByRole("button",{name:"Atualizar do canal"}).click();
 await expect.poll(()=>calls.filter(c=>c.path==="/v1/commerce/orders/ord-ml/refresh"&&c.method==="POST").length).toBe(1);
 expect(calls.some(c=>c.path.endsWith("/cancel"))).toBe(false);
});

test("devolução parcial: registrar com chave estável, receber com reposição e reembolsar",async({page},info)=>{
 const calls=await fixture(page);
 await page.goto(`/workspaces/${WORKSPACE_ID}/site/pedidos?pedido=ord-site`);
 const dialog=page.getByRole("dialog");await expect(dialog.getByRole("heading",{name:"Pedido #1001"})).toBeVisible();
 await dialog.getByRole("button",{name:/^Devoluções/}).click();
 await dialog.getByRole("button",{name:"Registrar devolução parcial"}).click();
 const form=dialog.getByRole("form",{name:"Registrar devolução parcial"});
 await expect(form.getByText("Pode devolver até 3 · vendido 3")).toBeVisible();
 await form.getByLabel("Camiseta Vorix · M").fill("2");await form.getByLabel("Motivo").fill("Tamanho errado");
 await noOverflow(page);await shot(page,"return-create",info.project.name);
 await form.getByRole("button",{name:"Registrar devolução"}).click();
 await expect.poll(()=>calls.filter(c=>c.path.endsWith("/returns")&&c.method==="POST").length).toBe(1);
 await form.getByRole("button",{name:"Registrar devolução"}).click(); // retry após falha temporária
 await expect.poll(()=>calls.filter(c=>c.path.endsWith("/returns")&&c.method==="POST").length).toBe(2);
 const [first,second]=calls.filter(c=>c.path.endsWith("/returns")&&c.method==="POST");
 expect(first.body.requestKey).toMatch(/^[0-9a-f-]{36}$/);expect(second.body.requestKey).toBe(first.body.requestKey);
 expect(second.body).toMatchObject({reason:"Tamanho errado",items:[{orderItemId:"it-1",quantity:2}]});
 const item=dialog.getByRole("listitem",{name:/Devolução de/});await expect(item.getByText("Solicitada")).toBeVisible();
 await item.getByRole("button",{name:"Receber e repor"}).click();
 const receive=dialog.getByRole("form",{name:"Receber e repor"});await expect(receive.getByText("O estoque só volta para o que for reposto.",{exact:false})).toBeVisible();
 await receive.getByLabel("Repor no estoque").fill("1");
 await noOverflow(page);await shot(page,"return-receive",info.project.name);
 await receive.getByRole("button",{name:"Confirmar recebimento"}).click();
 await expect.poll(()=>calls.find(c=>c.path==="/v1/commerce/returns/ret-1/receive")?.body).toEqual({items:[{orderItemId:"it-1",receivedQuantity:2,restockQuantity:1}]});
 await expect(item.getByText("Recebida")).toBeVisible();await expect(item.getByText("2 devolvido(s) · 2 recebido(s) · 1 reposto(s)")).toBeVisible();
 await item.getByRole("button",{name:"Reembolsar"}).click();
 const confirm=page.getByRole("alertdialog");await expect(confirm.getByLabel("Valor do reembolso")).toHaveValue("100,00");
 await shot(page,"return-refund",info.project.name);
 await confirm.getByRole("button",{name:"Reembolsar"}).click();
 await expect.poll(()=>calls.find(c=>c.path==="/v1/commerce/returns/ret-1/refund")?.body).toEqual({amountCents:10000});
 await expect(item.getByText(/Reembolsado/)).toBeVisible();await noOverflow(page);
});

test("vendas por canal no analytics do site",async({page},info)=>{
 const calls=await fixture(page);
 await page.goto(`/workspaces/${WORKSPACE_ID}/site/analytics`);
 const block=page.getByRole("region",{name:"Vendas por canal"});await expect(block).toBeVisible();
 const revenue=block.getByRole("list",{name:"Receita por canal"});await expect(revenue.getByRole("listitem")).toHaveCount(4);
 await expect(revenue.getByText("R$ 960,00")).toBeVisible();
 if(info.project.name==="390")await expect(block.getByRole("list",{name:"Detalhes por canal"}).getByText("Total")).toBeVisible();
 else await expect(block.getByRole("row",{name:/Total/})).toContainText("23");
 const request=calls.find(c=>c.path==="/v1/commerce/analytics/channels");
 expect(request?.query.get("from")).toBe("2026-09-28T03:00:00.000Z");expect(request?.query.get("to")).toBe("2026-10-28T02:59:59.999Z");
 await noOverflow(page);await block.screenshot({path:join(output,`analytics-channels-${info.project.name}.png`)});
});

test("marketplaces: conectar por canal, capacidades bloqueadas e contato do comprador",async({page},info)=>{
 const calls=await fixture(page);
 await page.goto(`/workspaces/${WORKSPACE_ID}/settings/marketplaces`);
 const shopee=page.getByRole("article",{name:"Shopee"});await expect(shopee).toBeVisible();
 await expect(shopee.getByRole("list",{name:"Bloqueado no Shopee"})).toContainText("Publicar anúncios");
 await expect(page.getByRole("article",{name:"Mercado Livre"}).getByRole("list",{name:"Bloqueado no Mercado Livre"})).toContainText("Cancelar pedido pela API");
 await expect(page.getByRole("article",{name:"TikTok Shop"})).toHaveCount(0);
 const toggle=page.getByRole("switch",{name:"Criar contato do comprador"});await expect(toggle).not.toBeChecked();
 await expect(page.getByText(/só o nome e o identificador do comprador/)).toBeVisible();
 await noOverflow(page);await shot(page,"marketplaces-providers",info.project.name);
 await toggle.click();await expect(toggle).toBeChecked();
 await expect.poll(()=>calls.find(c=>c.path==="/v1/marketplaces/connections/conn-ml/settings")?.body).toEqual({createContacts:true});
 expect(calls.find(c=>c.path==="/v1/marketplaces/connections/conn-ml/settings")?.method).toBe("PATCH");
 await shopee.getByRole("button",{name:"Conectar Shopee"}).click();
 await expect.poll(()=>calls.some(c=>c.path==="/v1/marketplaces/shopee/connect"&&c.method==="POST")).toBe(true);
 await page.waitForURL(/connected=shopee/);
});
