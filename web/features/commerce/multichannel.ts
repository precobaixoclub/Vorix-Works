/** Vorix Commerce multicanal — rótulos e regras puras (sem rede) usadas pela Central de Pedidos,
 * pelo painel de Marketplaces e pelo bloco "Vendas por canal". O servidor continua sendo a
 * autoridade: estas funções só explicam e pré-validam o que a API vai conferir de novo. */
export const ORDER_SOURCES=["SITE","MERCADO_LIVRE","SHOPEE","TIKTOK_SHOP"] as const;
export type OrderSource=(typeof ORDER_SOURCES)[number];
export const ORDER_SOURCE_LABELS:Record<string,string>={SITE:"Site",MANUAL:"Manual",MERCADO_LIVRE:"Mercado Livre",SHOPEE:"Shopee",TIKTOK_SHOP:"TikTok Shop"};
export const sourceLabel=(source:string)=>ORDER_SOURCE_LABELS[source]??source;
export const isMarketplaceSource=(source:string)=>source==="MERCADO_LIVRE"||source==="SHOPEE"||source==="TIKTOK_SHOP";
/** Tons do vocabulário fechado do design system (nunca hex solto). */
export const SOURCE_TONE:Record<string,string>={SITE:"bg-primary/15 text-foreground",MANUAL:"bg-muted text-muted-foreground",MERCADO_LIVRE:"bg-amber-500/15 text-amber-700 dark:text-amber-300",SHOPEE:"bg-rose-500/15 text-rose-700 dark:text-rose-300",TIKTOK_SHOP:"bg-violet-500/15 text-violet-700 dark:text-violet-300"};
export const SOURCE_BAR:Record<string,string>={SITE:"bg-primary",MANUAL:"bg-muted-foreground",MERCADO_LIVRE:"bg-amber-500",SHOPEE:"bg-rose-500",TIKTOK_SHOP:"bg-violet-500"};

export type ProviderId="MERCADO_LIVRE"|"SHOPEE"|"TIKTOK_SHOP";
export const PROVIDER_SLUGS:Record<ProviderId,string>={MERCADO_LIVRE:"mercado-livre",SHOPEE:"shopee",TIKTOK_SHOP:"tiktok-shop"};
export const providerSlug=(provider:string)=>PROVIDER_SLUGS[provider as ProviderId]??provider.toLowerCase().replace(/_/g,"-");
export type CapabilityState="SUPPORTED"|"BLOCKED_EXTERNAL_CAPABILITY";
export const CAPABILITY_KEYS=["listings","publish","priceSync","stockSync","orders","shipments","labels","cancelOrder","returns","webhooks"] as const;
export type CapabilityKey=(typeof CAPABILITY_KEYS)[number];
export const CAPABILITY_LABELS:Record<CapabilityKey,string>={listings:"Importar anúncios",publish:"Publicar anúncios",priceSync:"Sincronizar preço",stockSync:"Sincronizar estoque",orders:"Receber pedidos",shipments:"Acompanhar envios",labels:"Baixar etiquetas",cancelOrder:"Cancelar pedido pela API",returns:"Devoluções",webhooks:"Notificações em tempo real"};
/** Divide as capacidades em liberadas e bloqueadas pelo canal (na ordem fixa acima). */
export function splitCapabilities(capabilities:Partial<Record<string,string>>|undefined){
 const supported:CapabilityKey[]=[],blocked:CapabilityKey[]=[];
 for(const key of CAPABILITY_KEYS)(capabilities?.[key]==="SUPPORTED"?supported:blocked).push(key);
 return {supported,blocked};
}

export const STOCK_STATE_LABELS:Record<string,string>={NONE:"Sem estoque controlado",RESERVED:"Reservado",RELEASED:"Reserva devolvida",SOLD:"Baixado do estoque",RETURNED:"Devolvido ao estoque",CONFLICT:"Venda sem saldo central",EXTERNAL:"Estoque do marketplace"};

export type ShipmentStatus="PENDING"|"READY_TO_SHIP"|"SHIPPED"|"DELIVERED"|"NOT_DELIVERED"|"CANCELLED";
export const SHIPMENT_STATUS_LABELS:Record<ShipmentStatus,string>={PENDING:"Aguardando",READY_TO_SHIP:"Pronto para envio",SHIPPED:"A caminho",DELIVERED:"Entregue",NOT_DELIVERED:"Não entregue",CANCELLED:"Cancelado"};
export const shipmentStatusLabel=(status:string)=>SHIPMENT_STATUS_LABELS[status as ShipmentStatus]??status;

export type ReturnStatus="REQUESTED"|"APPROVED"|"IN_TRANSIT"|"RECEIVED"|"COMPLETED"|"REJECTED"|"CANCELLED";
export type RefundStatus="NONE"|"PROCESSING"|"REFUNDED"|"FAILED"|"NOT_SUPPORTED"|"MARKETPLACE";
export const RETURN_STATUS_LABELS:Record<ReturnStatus,string>={REQUESTED:"Solicitada",APPROVED:"Aprovada",IN_TRANSIT:"Em trânsito",RECEIVED:"Recebida",COMPLETED:"Concluída",REJECTED:"Recusada",CANCELLED:"Cancelada"};
export const REFUND_STATUS_LABELS:Record<RefundStatus,string>={NONE:"Sem reembolso",PROCESSING:"Reembolso em processamento",REFUNDED:"Reembolsado",FAILED:"Reembolso falhou",NOT_SUPPORTED:"Reembolso manual (provedor não suporta)",MARKETPLACE:"Reembolso feito pelo marketplace"};
export const returnStatusLabel=(status:string)=>RETURN_STATUS_LABELS[status as ReturnStatus]??status;
export const refundStatusLabel=(status:string)=>REFUND_STATUS_LABELS[status as RefundStatus]??status;
/** Espelha `RETURN_TRANSITIONS` do domínio. RECEIVED só pelo formulário "Receber e repor". */
const RETURN_TRANSITIONS:Record<ReturnStatus,readonly ReturnStatus[]>={REQUESTED:["APPROVED","IN_TRANSIT","RECEIVED","REJECTED","CANCELLED"],APPROVED:["IN_TRANSIT","RECEIVED","CANCELLED"],IN_TRANSIT:["RECEIVED","CANCELLED"],RECEIVED:["COMPLETED"],COMPLETED:[],REJECTED:[],CANCELLED:[]};
export type ReturnStatusTarget="APPROVED"|"IN_TRANSIT"|"REJECTED"|"CANCELLED"|"COMPLETED";
export const RETURN_ACTION_LABELS:Record<ReturnStatusTarget,string>={APPROVED:"Aprovar",IN_TRANSIT:"Marcar em trânsito",REJECTED:"Recusar",CANCELLED:"Cancelar devolução",COMPLETED:"Concluir"};
export const DESTRUCTIVE_RETURN_ACTIONS:readonly ReturnStatusTarget[]=["REJECTED","CANCELLED"];
export const returnStatusActions=(status:string):ReturnStatusTarget[]=>(RETURN_TRANSITIONS[status as ReturnStatus]??[]).filter((to):to is ReturnStatusTarget=>to!=="RECEIVED");
export const canReceiveReturn=(status:string)=>(RETURN_TRANSITIONS[status as ReturnStatus]??[]).includes("RECEIVED");
export const ACTIVE_RETURN_STATUSES:readonly string[]=["REQUESTED","APPROVED","IN_TRANSIT","RECEIVED","COMPLETED"];

export type ReturnItemLike={orderItemId:string;quantity:number;receivedQuantity:number;restockedQuantity:number};
export type ReturnLike={id:string;status:string;refundStatus:string;items:ReturnItemLike[]};
/** Quanto do item ainda pode ser devolvido: vendido − devoluções ativas (recusada/cancelada libera). */
export function returnableQuantity(item:{id:string;quantity:number},returns:readonly Pick<ReturnLike,"status"|"items">[]):number{
 const used=returns.filter(r=>ACTIVE_RETURN_STATUSES.includes(r.status)).flatMap(r=>r.items).filter(i=>i.orderItemId===item.id).reduce((sum,i)=>sum+i.quantity,0);
 return Math.max(0,item.quantity-used);
}
/** Normaliza a quantidade digitada: inteiro entre 0 e o máximo. */
export const clampQuantity=(value:string|number,max:number)=>{const n=Math.floor(Number(value));return Number.isFinite(n)?Math.min(Math.max(0,n),Math.max(0,max)):0;};
/** Valida as quantidades de uma nova devolução; devolve a lista para a API ou um erro em português. */
export function buildReturnItems(items:readonly {id:string;name:string;quantity:number}[],returns:readonly Pick<ReturnLike,"status"|"items">[],quantities:Record<string,number>):{items:{orderItemId:string;quantity:number}[];error?:string}{
 const out:{orderItemId:string;quantity:number}[]=[];
 for(const item of items){
  const quantity=quantities[item.id]??0;if(!quantity)continue;
  const max=returnableQuantity(item,returns);
  if(!Number.isInteger(quantity)||quantity<0)return {items:[],error:`Quantidade inválida para ${item.name}.`};
  if(quantity>max)return {items:[],error:`${item.name}: pode devolver até ${max}.`};
  out.push({orderItemId:item.id,quantity});
 }
 return out.length?{items:out}:{items:[],error:"Informe a quantidade de pelo menos um item."};
}
/** Recebimento: reposto ≤ recebido ≤ solicitado, por item. */
export function validateReceipt(returnItems:readonly ReturnItemLike[],input:Record<string,{received:number;restock:number}>):string|undefined{
 let any=false;
 for(const item of returnItems){
  const value=input[item.orderItemId]??{received:0,restock:0};
  if(value.received<0||value.restock<0||!Number.isInteger(value.received)||!Number.isInteger(value.restock))return "Use apenas quantidades inteiras.";
  if(value.received>item.quantity)return `Recebido não pode passar do solicitado (${item.quantity}).`;
  if(value.restock>value.received)return "Reposto não pode passar do recebido.";
  if(value.received)any=true;
 }
 return any?undefined:"Informe o que foi recebido.";
}
/** Reembolso sugerido de uma devolução: soma de preço unitário × quantidade devolvida. */
export function defaultRefundCents(orderItems:readonly {id:string;unitPriceCents:number}[],returnItems:readonly {orderItemId:string;quantity:number}[]):number{
 const price=new Map(orderItems.map(i=>[i.id,i.unitPriceCents]));
 return returnItems.reduce((sum,i)=>sum+(price.get(i.orderItemId)??0)*i.quantity,0);
}
/** Reembolso só para devolução da loja (não MARKETPLACE), ativa e ainda não reembolsada. */
export const canRefundReturn=(ret:Pick<ReturnLike,"status"|"refundStatus">,canRefund:boolean)=>canRefund&&ret.refundStatus!=="MARKETPLACE"&&(ret.refundStatus==="NONE"||ret.refundStatus==="FAILED")&&!["REJECTED","CANCELLED"].includes(ret.status);

export type ChannelRow={source:string;orders:number;sales:number;revenueCents:number;refundsCents:number;averageTicketCents:number;cancellations:number;returns:number};
/** Largura (0–100) da barra de receita de cada canal, relativa ao maior canal. */
export const channelShare=(rows:readonly ChannelRow[],row:ChannelRow)=>{const max=Math.max(0,...rows.map(r=>r.revenueCents));return max>0?Math.round(row.revenueCents/max*1000)/10:0;};
/** Base64 → Blob (etiqueta). */
export function base64ToBlob(base64:string,contentType:string):Blob{
 const binary=atob(base64),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return new Blob([bytes],{type:contentType||"application/octet-stream"});
}
