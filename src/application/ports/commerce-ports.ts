import type {Order,OrderEvent,OrderItem,OrderReturn,OrderSource,OrderStatus,Payment,PaymentInstructions,PaymentMethod,PaymentStatus,RefundStatus,ReturnStatus,Shipment,ShipmentStatus,ShippingStatus,StockState,OrderCustomer,OrderAddress,OrderDelivery} from "../../domain/commerce/order.model.js";
import type {ShippingOption,ShippingQuoteRequest,ShippingSettings} from "../../domain/commerce/shipping.js";

// ------------------------------------------------------------------ PaymentProvider
/** Credenciais do LOJISTA (nunca as do Vorix). Lidas do cofre de segredos por tenant/site. */
export type PaymentProviderContext={tenantId:string;workspaceId:string;siteId:string;credentials?:Record<string,string>};
export type CreateProviderPaymentInput={orderId:string;orderNumber:number;amountCents:number;currency:string;method:PaymentMethod;description:string;customer:OrderCustomer;expiresAt:string;idempotencyKey:string;notificationUrl?:string;cardToken?:string;cardPaymentMethodId?:string;installments?:number};
export type ProviderPaymentState={providerPaymentId:string;status:PaymentStatus;instructions?:PaymentInstructions;failureReason?:string};
export type PaymentProviderPort={
 readonly key:"SANDBOX"|"MERCADO_PAGO";
 readonly methods:readonly PaymentMethod[];
 /** Estorno de parte do valor (devolução parcial). Provedor sem suporte só estorna o total. */
 readonly partialRefund:boolean;
 createPayment(context:PaymentProviderContext,input:CreateProviderPaymentInput):Promise<ProviderPaymentState>;
 /** Fonte da verdade: o webhook só avisa; o status é sempre relido do provedor. */
 getPayment(context:PaymentProviderContext,providerPaymentId:string):Promise<ProviderPaymentState>;
 refund(context:PaymentProviderContext,providerPaymentId:string,amountCents:number,idempotencyKey?:string):Promise<ProviderPaymentState>;
 cancel(context:PaymentProviderContext,providerPaymentId:string):Promise<ProviderPaymentState>;
};

// ------------------------------------------------------------------ ShippingProvider
export type ShippingProviderContext={tenantId:string;workspaceId:string;siteId:string;settings:ShippingSettings;credentials?:Record<string,string>};
export type ShippingProviderPort={
 readonly key:string;
 quote(context:ShippingProviderContext,request:ShippingQuoteRequest):Promise<ShippingOption[]>;
};

// ------------------------------------------------------------------ Pedidos
export type CreateOrderInput={tenantId:string;workspaceId:string;siteId:string;publicTokenHash:string;requestKey:string;customer:OrderCustomer;shippingAddress?:OrderAddress;delivery:OrderDelivery;
 subtotalCents:number;discountCents:number;shippingCents:number;totalCents:number;currency:string;cartId?:string;anonymousSessionId?:string;utm:Record<string,string>;reservationExpiresAt:string;
 items:Omit<OrderItem,"id">[]};
export type OrderPatch={status?:OrderStatus;paymentStatus?:PaymentStatus;shippingStatus?:ShippingStatus;stockState?:StockState;contactId?:string;crmDealId?:string;salesIntentId?:string;cancelReason?:string;paidAt?:string;cancelledAt?:string;reservationExpiresAt?:string|null;
 externalStatus?:string;externalUpdatedAt?:string;externalData?:Record<string,unknown>;shippedAt?:string;deliveredAt?:string;shippingCents?:number;totalCents?:number};
/** Pedido vindo de marketplace: o canal manda; o Vorix registra no mesmo pedido/estoque/central. */
export type ExternalOrderInput={tenantId:string;workspaceId:string;source:Exclude<OrderSource,"SITE"|"MANUAL">;connectionId:string;externalOrderId:string;externalStatus:string;externalUpdatedAt?:string;externalData:Record<string,unknown>;
 customer:OrderCustomer;shippingAddress?:OrderAddress;delivery:OrderDelivery;subtotalCents:number;discountCents:number;shippingCents:number;totalCents:number;currency:string;createdAt?:string;items:Omit<OrderItem,"id">[]};
export type ShipmentInput={tenantId:string;workspaceId:string;orderId:string;provider:string;externalShipmentId?:string;status:ShipmentStatus;externalStatus?:string;substatus?:string;logisticType?:string;carrier?:string;trackingNumber?:string;trackingUrl?:string;labelAvailable:boolean;fulfilledByMarketplace:boolean;shippedAt?:string;deliveredAt?:string;estimatedDeliveryAt?:string};
export type ReturnInput={tenantId:string;workspaceId:string;orderId:string;source:OrderSource;externalReturnId?:string;requestKey?:string;status:ReturnStatus;externalStatus?:string;reason?:string;refundCents:number;refundStatus:RefundStatus;createdBy?:string;items:{orderItemId:string;quantity:number;reason?:string}[]};
export type OrderEventInput=Omit<OrderEvent,"id"|"createdAt"|"orderId">;
export type OrderListFilter={tenantId:string;workspaceId:string;siteId?:string;status?:OrderStatus;paymentStatus?:PaymentStatus;shippingStatus?:ShippingStatus;source?:string;search?:string;from?:string;to?:string;limit:number;offset:number};
export type CommerceOrderRepositoryPort={
 /** Idempotente por (siteId, requestKey): repetir o "Finalizar compra" devolve o mesmo pedido. */
 create(input:CreateOrderInput):Promise<{order:Order;created:boolean}>;
 get(id:string):Promise<Order|undefined>;
 getByPublicTokenHash(hash:string):Promise<Order|undefined>;
 list(filter:OrderListFilter):Promise<{orders:Order[];total:number}>;
 /** Atualiza só se o status atual for um dos esperados (concorrência); grava o evento junto. */
 update(id:string,patch:OrderPatch,event:OrderEventInput,expected?:{statuses?:readonly OrderStatus[];stockStates?:readonly StockState[]}):Promise<Order|undefined>;
 addEvent(orderId:string,event:OrderEventInput):Promise<void>;
 events(orderId:string):Promise<OrderEvent[]>;
 listExpiring(input:{now:string;limit:number}):Promise<Order[]>;
 createPayment(input:{tenantId:string;workspaceId:string;orderId:string;provider:string;method:PaymentMethod;amountCents:number;currency:string;providerPaymentId?:string;status:PaymentStatus;instructions:PaymentInstructions;failureReason?:string}):Promise<Payment>;
 updatePayment(id:string,patch:{status:PaymentStatus;failureReason?:string;instructions?:PaymentInstructions},expectedStatuses:readonly PaymentStatus[]):Promise<Payment|undefined>;
 payments(orderId:string):Promise<Payment[]>;
 paymentByProviderId(provider:string,providerPaymentId:string):Promise<Payment|undefined>;
 /** true = evento novo; false = já processado (webhook duplicado). */
 claimWebhookEvent(input:{provider:string;eventKey:string;orderId?:string;paymentId?:string}):Promise<boolean>;
 findContactForCustomer(input:{tenantId:string;workspaceId:string;email:string;phone:string}):Promise<string|undefined>;
 upsertExternalOrder(input:ExternalOrderInput):Promise<{order:Order;created:boolean}>;
 getByExternal(connectionId:string,externalOrderId:string):Promise<Order|undefined>;
 shipments(orderId:string):Promise<Shipment[]>;
 upsertShipment(input:ShipmentInput):Promise<Shipment>;
 returns(orderId:string):Promise<OrderReturn[]>;
 getReturn(id:string):Promise<OrderReturn|undefined>;
 /** Valida sob trava do pedido: nunca devolve mais do que vendido − devoluções ativas. */
 createReturn(input:ReturnInput):Promise<{ret:OrderReturn;created:boolean}>;
 updateReturn(id:string,patch:{status?:ReturnStatus;externalStatus?:string;refundStatus?:RefundStatus;refundCents?:number;refundProviderId?:string},expected:{statuses?:readonly ReturnStatus[];refundStatuses?:readonly RefundStatus[]},event?:OrderEventInput):Promise<OrderReturn|undefined>;
 setReturnItemReceived(returnId:string,orderItemId:string,received:number,restocked:number):Promise<void>;
 recordRefund(paymentId:string,orderId:string,amountCents:number):Promise<Payment>;
};
