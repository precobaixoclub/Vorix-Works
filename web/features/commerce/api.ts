import {apiClient} from "@/lib/api-client";
/** Vorix Commerce, Fase 2 — Central de pedidos (valores e status vêm sempre do servidor). */
export type OrderStatus="PENDING"|"AWAITING_PAYMENT"|"PAID"|"CONFIRMED"|"PROCESSING"|"SHIPPED"|"DELIVERED"|"CANCELLED";
export type OrderPaymentStatus="PENDING"|"APPROVED"|"FAILED"|"CANCELLED"|"REFUNDED";
export type OrderShippingStatus="NOT_REQUIRED"|"PENDING"|"READY_FOR_PICKUP"|"SHIPPED"|"DELIVERED"|"CANCELLED";
export type CommerceOrder={id:string;number:number;source:string;status:OrderStatus;paymentStatus:OrderPaymentStatus;shippingStatus:OrderShippingStatus;stockState:string;contactId?:string;crmDealId?:string;
 customer:{name:string;email:string;phone:string;document?:string};shippingAddress?:{postalCode:string;street:string;number:string;complement?:string;district:string;city:string;state:string};
 delivery:{optionId:string;kind:string;label:string;priceCents:number;days?:number;requiresAddress:boolean};subtotalCents:number;discountCents:number;shippingCents:number;totalCents:number;currency:string;
 utm:Record<string,string>;reservationExpiresAt?:string;cancelReason?:string;createdAt:string;paidAt?:string;cancelledAt?:string;
 items:{id:string;productId:string;variantId?:string;sku?:string;name:string;variantLabel?:string;imageUrl?:string;quantity:number;unitPriceCents:number;totalCents:number}[]};
export type CommercePayment={id:string;provider:string;method:string;status:OrderPaymentStatus;amountCents:number;currency:string;providerPaymentId?:string;instructions:{sandbox?:boolean;expiresAt?:string};failureReason?:string;createdAt:string;approvedAt?:string;refundedAt?:string};
export type CommerceOrderEvent={id:string;type:string;fromStatus?:string;toStatus?:string;actorType:string;actorId?:string;data:Record<string,unknown>;createdAt:string};
export type OrderFilter={status?:OrderStatus;paymentStatus?:OrderPaymentStatus;shippingStatus?:OrderShippingStatus;search?:string;from?:string;to?:string;limit:number;offset:number};
const q=encodeURIComponent;
export function listCommerceOrders(workspaceId:string,filter:OrderFilter){
 const params=new URLSearchParams({workspaceId,limit:String(filter.limit),offset:String(filter.offset)});
 for(const key of ["status","paymentStatus","shippingStatus","search","from","to"] as const){const value=filter[key];if(value)params.set(key,value);}
 return apiClient.get<{orders:CommerceOrder[];total:number}>(`/v1/commerce/orders?${params}`);
}
export const getCommerceOrder=(workspaceId:string,id:string)=>apiClient.get<{order:CommerceOrder;payments:CommercePayment[];events:CommerceOrderEvent[]}>(`/v1/commerce/orders/${q(id)}?workspaceId=${q(workspaceId)}`);
export const advanceCommerceOrder=(workspaceId:string,id:string,to:OrderStatus,trackingCode?:string)=>apiClient.post<CommerceOrder>(`/v1/commerce/orders/${q(id)}/status?workspaceId=${q(workspaceId)}`,{to,...(trackingCode?{trackingCode}:{})});
export const cancelCommerceOrder=(workspaceId:string,id:string,input:{reason?:string;restock?:boolean})=>apiClient.post<CommerceOrder>(`/v1/commerce/orders/${q(id)}/cancel?workspaceId=${q(workspaceId)}`,input);
export const simulateOrderPayment=(workspaceId:string,id:string,outcome:"APPROVED"|"FAILED")=>apiClient.post<{status:string}>(`/v1/commerce/orders/${q(id)}/sandbox-payment?workspaceId=${q(workspaceId)}`,{outcome});
export const ORDER_STATUS_LABELS:Record<OrderStatus,string>={PENDING:"Pendente",AWAITING_PAYMENT:"Aguardando pagamento",PAID:"Pago",CONFIRMED:"Confirmado",PROCESSING:"Em preparação",SHIPPED:"Enviado",DELIVERED:"Entregue",CANCELLED:"Cancelado"};
export const PAYMENT_STATUS_LABELS:Record<OrderPaymentStatus,string>={PENDING:"Pendente",APPROVED:"Aprovado",FAILED:"Recusado",CANCELLED:"Cancelado",REFUNDED:"Estornado"};
export const SHIPPING_STATUS_LABELS:Record<OrderShippingStatus,string>={NOT_REQUIRED:"Retirada",PENDING:"A enviar",READY_FOR_PICKUP:"Pronto para retirada",SHIPPED:"Enviado",DELIVERED:"Entregue",CANCELLED:"Cancelado"};
export const ORDER_EVENT_LABELS:Record<string,string>={order_created:"Pedido criado",stock_reserved:"Estoque reservado",contact_linked:"Contato vinculado no CRM",payment_started:"Pagamento iniciado",payment_approved:"Pagamento aprovado",order_cancelled:"Pedido cancelado",stock_released:"Reserva devolvida ao estoque",stock_returned:"Itens devolvidos ao estoque",payment_refunded:"Pagamento estornado",refund_pending:"Estorno em processamento",status_changed:"Status alterado",crm_opportunity_won:"Oportunidade ganha criada no CRM"};
export const CANCEL_REASON_LABELS:Record<string,string>={payment_expired:"Pagamento não feito no prazo",payment_failed:"Pagamento recusado",payment_cancelled:"Pagamento cancelado",payment_error:"Falha ao iniciar o pagamento",out_of_stock:"Produto esgotou durante a compra",cancelled_by_store:"Cancelado pela loja"};
