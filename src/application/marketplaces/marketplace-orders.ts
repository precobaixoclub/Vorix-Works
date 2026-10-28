/**
 * Pedido de marketplace → o MESMO Order, Inventory e Central de Pedidos do Site.
 *
 * Regras:
 * - o canal é a autoridade de pagamento e logística: o status só avança (nunca regride por notificação
 *   fora de ordem) e o frete nunca é recalculado pelo Vorix;
 * - venda paga baixa o estoque central uma vez (chave idempotente por item); estoque do próprio canal
 *   (Full/FBS) não mexe no central; falta de saldo vira CONFLICT registrado, nunca pedido perdido;
 * - cancelamento antes do envio devolve só o que foi baixado; depois do envio vira devolução;
 * - devolução do canal é registrada por item/quantidade; o estoque só volta quando a loja confirma o recebimento.
 * A baixa dispara o outbox do catálogo → os demais anúncios são sincronizados com saldo − reservas − safety.
 */
import type {CommerceOrderRepositoryPort} from "../ports/commerce-ports.js";
import type {MarketplaceRepositoryPort,StoredConnection} from "../ports/marketplace-repository.port.js";
import type {ProductEngineRepositoryPort} from "../ports/product-engine-repository.port.js";
import type {ProductRepositoryPort} from "../ports/product-repository.port.js";
import type {ExternalOrder,ExternalOrderState,ExternalReturn} from "../ports/marketplace-provider.port.js";
import {canTransitionReturn,type Order,type OrderItem,type OrderStatus,type PaymentStatus,type ShippingStatus} from "../../domain/commerce/order.model.js";

const SYSTEM="marketplace-orders";
export type MarketplaceOrderDeps={
 orders:CommerceOrderRepositoryPort;repository:MarketplaceRepositoryPort;productEngineRepository:ProductEngineRepositoryPort;productRepository:ProductRepositoryPort;
 /** Contato do comprador (só com `settings.createContacts`). Identidade namespaced pela conexão. */
 contacts?:{findByIdentity(input:{channel:string;externalId:string}):Promise<string|undefined>;create(input:{tenantId:string;workspaceId:string;name:string;channel:string;externalId:string;origin:string}):Promise<string>};
 /** Aviso à equipe (ex.: venda externa sem saldo central). Best effort. */
 notify?(order:Order,title:string,body:string):Promise<void>;
 log?(event:string,data:Record<string,unknown>):void;
};
const RANK:Record<OrderStatus,number>={PENDING:0,AWAITING_PAYMENT:1,PAID:2,CONFIRMED:2,PROCESSING:3,SHIPPED:4,DELIVERED:5,CANCELLED:9};
const STATUS:Record<ExternalOrderState,OrderStatus>={PENDING_PAYMENT:"AWAITING_PAYMENT",PAID:"PAID",READY_TO_SHIP:"PROCESSING",SHIPPED:"SHIPPED",DELIVERED:"DELIVERED",CANCELLED:"CANCELLED"};
const SHIPPING:Record<ExternalOrderState,ShippingStatus>={PENDING_PAYMENT:"PENDING",PAID:"PENDING",READY_TO_SHIP:"PENDING",SHIPPED:"SHIPPED",DELIVERED:"DELIVERED",CANCELLED:"CANCELLED"};
const CHANNEL:Record<StoredConnection["provider"],string>={MERCADO_LIVRE:"mercado_livre",SHOPEE:"shopee",TIKTOK_SHOP:"tiktok_shop"};
const LABEL:Record<StoredConnection["provider"],string>={MERCADO_LIVRE:"Mercado Livre",SHOPEE:"Shopee",TIKTOK_SHOP:"TikTok Shop"};
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const sold=(state:ExternalOrderState)=>state!=="PENDING_PAYMENT"&&state!=="CANCELLED";

/** Item externo → produto/variação do Vorix pelo anúncio vinculado. Sem vínculo: registrado sem estoque. */
async function mapItems(deps:MarketplaceOrderDeps,c:StoredConnection,external:ExternalOrder):Promise<Omit<OrderItem,"id">[]>{
 const items:Omit<OrderItem,"id">[]=[];
 for(const [index,line] of external.items.entries()){
  const listing=await deps.repository.listingByExternal(c,c.id,line.externalItemId);
  const variantId=listing?(line.externalVariationId?listing.variantLinks.find(link=>link.externalVariantId===line.externalVariationId)?.variantId:undefined)??listing.variantId:undefined;
  const product=listing?await deps.productRepository.getById(listing.productId):undefined;
  const scoped=product&&product.tenantId===c.tenantId&&product.workspaceId===c.workspaceId;
  items.push({position:index,productId:scoped?product.id:"",variantId:scoped?variantId:undefined,sku:line.sku,name:line.title,variantLabel:line.variantLabel,quantity:line.quantity,
   unitPriceCents:line.unitPriceCents,totalCents:line.unitPriceCents*line.quantity,trackStock:!!scoped&&product.trackStock,specifications:[],externalItemId:line.externalItemId,externalVariationId:line.externalVariationId});
 }
 return items;
}

async function buyerContact(deps:MarketplaceOrderDeps,c:StoredConnection,external:ExternalOrder):Promise<string|undefined>{
 if(!c.settings?.createContacts||!deps.contacts||!external.buyer.id)return undefined;
 const identity={channel:CHANNEL[c.provider],externalId:`${c.id}:${external.buyer.id}`};
 return await deps.contacts.findByIdentity(identity)??deps.contacts.create({tenantId:c.tenantId,workspaceId:c.workspaceId,name:(external.buyer.name??external.buyer.nickname??`Comprador ${LABEL[c.provider]}`).slice(0,160),origin:CHANNEL[c.provider],...identity});
}

export async function ingestExternalOrder(deps:MarketplaceOrderDeps,c:StoredConnection,external:ExternalOrder,returns:readonly ExternalReturn[]=[]):Promise<Order>{
 let order=await deps.orders.getByExternal(c.id,external.id);
 // Snapshot mais antigo que o já aplicado (entrega fora de ordem): nada regride.
 if(order?.externalUpdatedAt&&Date.parse(external.updatedAt)<Date.parse(order.externalUpdatedAt))return order;
 if(!order){
  const shipment=external.shipment;
  order=(await deps.orders.upsertExternalOrder({tenantId:c.tenantId,workspaceId:c.workspaceId,source:c.provider,connectionId:c.id,externalOrderId:external.id,externalStatus:external.externalStatus,externalUpdatedAt:external.updatedAt,externalData:external.data,
   customer:{name:(external.buyer.name??external.buyer.nickname??`Comprador ${LABEL[c.provider]}`).slice(0,160),email:"",phone:""},
   delivery:{optionId:"marketplace",kind:"PROVIDER",label:shipment?.logisticType?`${LABEL[c.provider]} · ${shipment.logisticType}`:`Envio ${LABEL[c.provider]}`,priceCents:external.shippingCents,provider:c.provider,requiresAddress:true},
   shippingAddress:external.shippingAddress?{postalCode:external.shippingAddress.postalCode??"",street:"",number:"",district:"",city:external.shippingAddress.city??"",state:external.shippingAddress.state??""}:undefined,
   subtotalCents:external.subtotalCents,discountCents:external.discountCents,shippingCents:external.shippingCents,totalCents:external.totalCents,currency:external.currency,createdAt:external.createdAt,
   items:await mapItems(deps,c,external)})).order;
 }
 order=await applyStatus(deps,order,external);
 order=await applyInventory(deps,c,order,external);
 if(external.shipment)await deps.orders.upsertShipment({tenantId:c.tenantId,workspaceId:c.workspaceId,orderId:order.id,provider:c.provider,externalShipmentId:external.shipment.externalId,status:external.shipment.state,
  externalStatus:external.shipment.externalStatus,substatus:external.shipment.substatus,logisticType:external.shipment.logisticType,carrier:external.shipment.carrier,trackingNumber:external.shipment.trackingNumber,trackingUrl:external.shipment.trackingUrl,
  labelAvailable:external.shipment.labelAvailable,fulfilledByMarketplace:external.shipment.fulfilledByMarketplace,shippedAt:external.shipment.shippedAt,deliveredAt:external.shipment.deliveredAt,estimatedDeliveryAt:external.shipment.estimatedDeliveryAt});
 if(!order.contactId){
  const contactId=await buyerContact(deps,c,external).catch(error=>{deps.log?.("marketplace_order_contact_failed",{orderId:order!.id,error:errorText(error)});return undefined;});
  if(contactId)order=await deps.orders.update(order.id,{contactId},{type:"contact_linked",actorType:"system",data:{contactId}})??order;
 }
 for(const ret of returns)await applyReturn(deps,c,order,ret);
 return (await deps.orders.get(order.id))??order;
}

async function applyStatus(deps:MarketplaceOrderDeps,order:Order,external:ExternalOrder):Promise<Order>{
 const target=STATUS[external.state];
 const advance=order.status!=="CANCELLED"&&(target==="CANCELLED"||RANK[target]>RANK[order.status]);
 const changedExternal=order.externalStatus!==external.externalStatus||order.externalUpdatedAt!==new Date(external.updatedAt).toISOString();
 if(!advance&&!changedExternal)return order;
 const wasPaid=!!order.paidAt||!!external.paidAt||RANK[order.status]>=RANK.PAID;
 const paymentStatus:PaymentStatus=target==="CANCELLED"?(wasPaid?"REFUNDED":"CANCELLED"):target==="AWAITING_PAYMENT"?"PENDING":"APPROVED";
 // Snapshot do canal + controle interno de baixa (nunca apagado por um snapshot novo).
 const patch={externalStatus:external.externalStatus,externalUpdatedAt:external.updatedAt,externalData:{...external.data,...(order.externalData?.vorixSoldItemIds?{vorixSoldItemIds:order.externalData.vorixSoldItemIds}:{})},
  ...(advance?{status:target,paymentStatus,shippingStatus:SHIPPING[external.state],
   ...(RANK[target]>=RANK.PAID&&target!=="CANCELLED"&&!order.paidAt?{paidAt:external.paidAt??external.updatedAt}:{}),
   ...(target==="CANCELLED"?{cancelledAt:external.cancelledAt??external.updatedAt,cancelReason:external.cancelReason??"marketplace_cancelled"}:{}),
   ...(external.shipment?.shippedAt&&!order.shippedAt?{shippedAt:external.shipment.shippedAt}:{}),
   ...(external.shipment?.deliveredAt&&!order.deliveredAt?{deliveredAt:external.shipment.deliveredAt}:{})}:{})};
 const updated=await deps.orders.update(order.id,patch,advance
  ?{type:"status_changed",fromStatus:order.status,toStatus:target,actorType:"provider",data:{externalStatus:external.externalStatus}}
  :{type:"external_updated",actorType:"provider",data:{externalStatus:external.externalStatus}},{statuses:[order.status]});
 // Outro worker aplicou primeiro: relê (a próxima sincronização converge).
 return updated??(await deps.orders.get(order.id))??order;
}

/** Itens já baixados (para devolver só o que saiu do estoque central). */
const soldItems=(order:Order)=>Array.isArray(order.externalData?.vorixSoldItemIds)?order.externalData!.vorixSoldItemIds as string[]:[];

async function applyInventory(deps:MarketplaceOrderDeps,c:StoredConnection,order:Order,external:ExternalOrder):Promise<Order>{
 const scope={tenantId:order.tenantId,workspaceId:order.workspaceId};
 const tracked=order.items.filter(item=>item.trackStock&&item.productId);
 if(sold(external.state)&&["NONE","CONFLICT"].includes(order.stockState)){
  if(external.shipment?.fulfilledByMarketplace){
   return await deps.orders.update(order.id,{stockState:"EXTERNAL"},{type:"stock_external",actorType:"system",data:{logisticType:external.shipment.logisticType}},{stockStates:[order.stockState]})??order;
  }
  const done=new Set(soldItems(order)),conflicts:string[]=[];
  for(const item of tracked){
   if(done.has(item.id))continue;
   try{
    await deps.productEngineRepository.move({...scope,productId:item.productId,variantId:item.variantId,kind:"SALE",quantity:item.quantity,operationKey:`marketplace-order:${order.id}:sale:${item.id}`,userId:SYSTEM});
    done.add(item.id);
   }catch(error){
    if(!/INVENTORY_INSUFFICIENT/.test(errorText(error)))throw error;
    conflicts.push(item.id);
   }
  }
  const stockState=conflicts.length?"CONFLICT":tracked.length?"SOLD":"NONE";
  const updated=await deps.orders.update(order.id,{stockState,externalData:{...order.externalData,vorixSoldItemIds:[...done]}},
   conflicts.length?{type:"stock_conflict",actorType:"system",data:{items:conflicts}}:{type:"stock_sold",actorType:"system",data:{items:[...done]}},{stockStates:[order.stockState]})??order;
  if(conflicts.length&&order.stockState!=="CONFLICT")await deps.notify?.(updated,`Venda sem estoque no ${LABEL[c.provider]} — pedido #${order.number}`,
   "A venda já aconteceu no canal, mas o estoque central não tinha saldo para todos os itens. Confira o estoque e o envio.").catch(()=>undefined);
  return updated;
 }
 // Cancelado antes de sair: o que foi baixado volta (uma vez: o estado é reivindicado antes do movimento).
 if(external.state==="CANCELLED"&&["SOLD","CONFLICT"].includes(order.stockState)&&!order.shippedAt&&!external.shipment?.shippedAt){
  const claimed=await deps.orders.update(order.id,{stockState:"RETURNED"},{type:"stock_returned",actorType:"system",data:{reason:"marketplace_cancelled"}},{stockStates:[order.stockState]});
  if(!claimed)return (await deps.orders.get(order.id))??order;
  for(const item of tracked.filter(item=>soldItems(order).includes(item.id)))
   await deps.productEngineRepository.move({...scope,productId:item.productId,variantId:item.variantId,kind:"RETURN",quantity:item.quantity,operationKey:`marketplace-order:${order.id}:return:${item.id}`,userId:SYSTEM});
  return claimed;
 }
 return order;
}

/** Devolução do canal: registra itens/quantidades; reembolso é do canal; estoque só volta no recebimento confirmado pela loja. */
async function applyReturn(deps:MarketplaceOrderDeps,c:StoredConnection,order:Order,ret:ExternalReturn){
 const existing=(await deps.orders.returns(order.id)).find(r=>r.externalReturnId===ret.id);
 if(existing){
  if(existing.status!==ret.state&&canTransitionReturn(existing.status,ret.state))
   await deps.orders.updateReturn(existing.id,{status:ret.state,externalStatus:ret.externalStatus},{statuses:[existing.status]},{type:"return_updated",actorType:"provider",data:{returnId:existing.id,status:ret.state}});
  return;
 }
 const lines=ret.items.length?ret.items.map(line=>{
  const item=order.items.find(i=>i.externalItemId===line.externalItemId&&(!line.externalVariationId||!i.externalVariationId||i.externalVariationId===line.externalVariationId));
  return item?{orderItemId:item.id,quantity:Math.min(line.quantity,item.quantity)}:undefined;
 }).filter((line):line is {orderItemId:string;quantity:number}=>!!line)
  // Reclamação sem detalhe de itens: registra o pedido inteiro (a loja ajusta o recebido).
  :order.items.map(item=>({orderItemId:item.id,quantity:item.quantity}));
 if(!lines.length)return;
 await deps.orders.createReturn({tenantId:order.tenantId,workspaceId:order.workspaceId,orderId:order.id,source:order.source,externalReturnId:ret.id,status:ret.state,externalStatus:ret.externalStatus,reason:ret.reason,
  refundCents:ret.refundCents??0,refundStatus:"MARKETPLACE",items:lines}).catch(error=>{
  // Quantidade já coberta por outra devolução: registrado no log, nunca duplica estoque.
  if(/ORDER_RETURN_VALIDATION/.test(errorText(error)))deps.log?.("marketplace_return_skipped",{orderId:order.id,returnId:ret.id,error:errorText(error)});else throw error;
 });
}
