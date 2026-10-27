import {z} from "zod";
/**
 * Vorix Commerce, Fase 2 — pedido (Order). Venda transacional própria: nunca uma Opportunity.
 * Valores sempre recalculados no servidor; itens guardam snapshot que não muda com o catálogo.
 */
export const ORDER_SOURCES=["SITE","MERCADO_LIVRE","SHOPEE","TIKTOK_SHOP","MANUAL"] as const;
export type OrderSource=(typeof ORDER_SOURCES)[number];
export const ORDER_STATUSES=["PENDING","AWAITING_PAYMENT","PAID","CONFIRMED","PROCESSING","SHIPPED","DELIVERED","CANCELLED"] as const;
export type OrderStatus=(typeof ORDER_STATUSES)[number];
export type PaymentStatus="PENDING"|"APPROVED"|"FAILED"|"CANCELLED"|"REFUNDED";
export type ShippingStatus="NOT_REQUIRED"|"PENDING"|"READY_FOR_PICKUP"|"SHIPPED"|"DELIVERED"|"CANCELLED";
export type StockState="NONE"|"RESERVED"|"RELEASED"|"SOLD"|"RETURNED";
export type PaymentMethod="PIX"|"CARD"|"SANDBOX";

const TRANSITIONS:Record<OrderStatus,readonly OrderStatus[]>={
 PENDING:["AWAITING_PAYMENT","CANCELLED"],
 AWAITING_PAYMENT:["PAID","CANCELLED"],
 PAID:["CONFIRMED","PROCESSING","CANCELLED"],
 CONFIRMED:["PROCESSING","CANCELLED"],
 // Retirada no local vai direto de "em preparação" para "entregue".
 PROCESSING:["SHIPPED","DELIVERED","CANCELLED"],
 SHIPPED:["DELIVERED"],
 DELIVERED:[],
 CANCELLED:[],
};
export function canTransitionOrder(from:OrderStatus,to:OrderStatus):boolean{return TRANSITIONS[from].includes(to);}
export function assertOrderTransition(from:OrderStatus,to:OrderStatus):void{if(!canTransitionOrder(from,to))throw Error(`ORDER_TRANSITION_INVALID: não é possível passar o pedido de ${ORDER_STATUS_LABELS[from]} para ${ORDER_STATUS_LABELS[to]}.`);}
export const ORDER_STATUS_LABELS:Record<OrderStatus,string>={PENDING:"Pendente",AWAITING_PAYMENT:"Aguardando pagamento",PAID:"Pago",CONFIRMED:"Confirmado",PROCESSING:"Em preparação",SHIPPED:"Enviado",DELIVERED:"Entregue",CANCELLED:"Cancelado"};
/** Cancelável antes de sair para entrega. Depois disso é devolução (fora desta fase). */
export const CANCELLABLE_STATUSES:readonly OrderStatus[]=["PENDING","AWAITING_PAYMENT","PAID","CONFIRMED","PROCESSING"];

export type OrderCustomer={name:string;email:string;phone:string;document?:string};
export type OrderAddress={postalCode:string;street:string;number:string;complement?:string;district:string;city:string;state:string};
export type DeliveryKind="PICKUP"|"FREE"|"FIXED"|"TABLE"|"PROVIDER";
export type OrderDelivery={optionId:string;kind:DeliveryKind;label:string;priceCents:number;days?:number;provider?:string;requiresAddress:boolean};
export type OrderItem={id:string;position:number;productId:string;variantId?:string;sku?:string;name:string;variantLabel?:string;imageUrl?:string;quantity:number;unitPriceCents:number;totalCents:number;trackStock:boolean;specifications:{label:string;value:string}[]};
export type Order={
 id:string;tenantId:string;workspaceId:string;siteId?:string;number:number;source:OrderSource;status:OrderStatus;paymentStatus:PaymentStatus;shippingStatus:ShippingStatus;stockState:StockState;
 contactId?:string;customer:OrderCustomer;shippingAddress?:OrderAddress;delivery:OrderDelivery;
 subtotalCents:number;discountCents:number;shippingCents:number;totalCents:number;currency:string;
 crmDealId?:string;salesIntentId?:string;cartId?:string;anonymousSessionId?:string;utm:Record<string,string>;
 reservationExpiresAt?:string;cancelReason?:string;createdAt:string;updatedAt:string;paidAt?:string;cancelledAt?:string;items:OrderItem[];
};
export type OrderEvent={id:string;orderId:string;type:string;fromStatus?:string;toStatus?:string;actorType:"system"|"user"|"customer"|"provider";actorId?:string;data:Record<string,unknown>;createdAt:string};
export type Payment={id:string;orderId:string;provider:string;method:PaymentMethod;status:PaymentStatus;amountCents:number;currency:string;providerPaymentId?:string;instructions:PaymentInstructions;failureReason?:string;createdAt:string;approvedAt?:string;refundedAt?:string};
export type PaymentInstructions={pixQrCode?:string;pixQrCodeBase64?:string;pixTicketUrl?:string;expiresAt?:string;sandbox?:boolean};

export function orderTotals(items:readonly {unitPriceCents:number;quantity:number}[],shippingCents:number,discountCents=0){
 const subtotalCents=items.reduce((sum,item)=>sum+item.unitPriceCents*item.quantity,0);
 const discount=Math.min(Math.max(0,discountCents),subtotalCents);
 return {subtotalCents,discountCents:discount,shippingCents:Math.max(0,shippingCents),totalCents:subtotalCents-discount+Math.max(0,shippingCents)};
}

export const orderCustomerSchema=z.object({
 name:z.string().trim().min(3,"Informe seu nome completo.").max(160),
 email:z.email("Informe um e-mail válido.").max(320),
 phone:z.string().transform(value=>value.replace(/\D/g,"")).pipe(z.string().regex(/^\d{10,13}$/,"Informe um telefone com DDD.")),
 document:z.string().transform(value=>value.replace(/\D/g,"")).pipe(z.string().regex(/^(\d{11}|\d{14})$/,"Informe um CPF ou CNPJ válido.")).optional(),
}).strict();
export const orderAddressSchema=z.object({
 postalCode:z.string().transform(value=>value.replace(/\D/g,"")).pipe(z.string().regex(/^\d{8}$/,"Informe um CEP válido.")),
 street:z.string().trim().min(2,"Informe a rua.").max(200),number:z.string().trim().min(1,"Informe o número.").max(20),complement:z.string().trim().max(100).optional(),
 district:z.string().trim().min(2,"Informe o bairro.").max(120),city:z.string().trim().min(2,"Informe a cidade.").max(120),state:z.string().trim().regex(/^[A-Za-z]{2}$/,"Informe a UF.").transform(value=>value.toUpperCase()),
}).strict();
/** CPF/CNPJ com dígitos verificadores. */
export function validTaxDocument(value:string):boolean{
 const digits=value.replace(/\D/g,"");if(/^(\d)\1+$/.test(digits))return false;
 const check=(base:string,weights:number[])=>{const sum=weights.reduce((acc,weight,index)=>acc+Number(base[index])*weight,0);const rest=sum%11;return rest<2?0:11-rest;};
 if(digits.length===11){const w1=[10,9,8,7,6,5,4,3,2],w2=[11,10,9,8,7,6,5,4,3,2];const r1=(digits.slice(0,9).split("").reduce((a,d,i)=>a+Number(d)*w1[i],0)*10)%11%10,r2=(digits.slice(0,10).split("").reduce((a,d,i)=>a+Number(d)*w2[i],0)*10)%11%10;return r1===Number(digits[9])&&r2===Number(digits[10]);}
 if(digits.length===14){const w1=[5,4,3,2,9,8,7,6,5,4,3,2],w2=[6,...w1];return check(digits,w1)===Number(digits[12])&&check(digits,w2)===Number(digits[13]);}
 return false;
}
