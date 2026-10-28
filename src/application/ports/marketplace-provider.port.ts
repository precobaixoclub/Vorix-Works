import type { ExternalListing, ExternalAttribute, MarketplaceProviderId, PublishDraft } from "../../domain/marketplaces/marketplace.model.js";
/** `metadata`: dados da loja exigidos pelo canal além do token (ex.: shop_id da Shopee, shop_cipher do TikTok Shop). */
export type MarketplaceTokens = { accessToken: string; refreshToken: string; expiresAt: string; userId: string; metadata?: Record<string,string> };
/** Credencial em uso numa chamada: token + conta + metadados da loja. Nunca sai do servidor. */
export type ProviderAuth = { accessToken: string; accountId: string; metadata: Record<string,string> };
export type CategoryAttribute={id:string;name:string;required:boolean;variation:boolean;values?:{id:string;name:string}[]};
export type CategoryRequirements = { id: string; name: string; leaf: boolean; allowed: boolean; attributes: CategoryAttribute[]; saleTerms?:CategoryAttribute[] };
/** Peso/medidas do produto (details.shipping) — exigidos por Shopee/TikTok para publicar. */
export type PackageDimensions = { weightGrams?: number; heightCm?: number; widthCm?: number; lengthCm?: number };
export type ListingWrite = { draft: PublishDraft; priceCents: number; quantity: number; currency: string; sku?: string; userProducts: boolean; correlation: string; package?: PackageDimensions; variants?: {id?:string;sku?:string;priceCents:number;quantity:number;attributes:ExternalAttribute[]}[] };

/**
 * O que o canal REALMENTE permite pela API oficial para esta integração. `BLOCKED_EXTERNAL_CAPABILITY`
 * = o canal não oferece (ou não confirmamos para Brasil/conta): a interface mostra e o código nunca
 * inventa endpoint para cobrir.
 */
export type CapabilityState = "SUPPORTED" | "BLOCKED_EXTERNAL_CAPABILITY";
export type ProviderCapabilities = {
  listings: CapabilityState; publish: CapabilityState; priceSync: CapabilityState; stockSync: CapabilityState;
  orders: CapabilityState; shipments: CapabilityState; labels: CapabilityState; cancelOrder: CapabilityState;
  returns: CapabilityState; webhooks: CapabilityState;
};

// ---------------------------------------------------------------- pedidos externos normalizados
/** Estado do pedido no canal, já traduzido. O canal é a autoridade (pagamento e logística). */
export type ExternalOrderState = "PENDING_PAYMENT" | "PAID" | "READY_TO_SHIP" | "SHIPPED" | "DELIVERED" | "CANCELLED";
export type ExternalShipmentState = "PENDING" | "READY_TO_SHIP" | "SHIPPED" | "DELIVERED" | "NOT_DELIVERED" | "CANCELLED";
export type ExternalOrderItem = { externalItemId: string; externalVariationId?: string; sku?: string; title: string; variantLabel?: string; quantity: number; unitPriceCents: number };
export type ExternalShipment = {
  externalId?: string; state: ExternalShipmentState; externalStatus: string; substatus?: string; logisticType?: string; carrier?: string;
  trackingNumber?: string; trackingUrl?: string; labelAvailable: boolean;
  /** Estoque e envio do próprio marketplace (Mercado Livre Full etc.): sem baixa do estoque central. */
  fulfilledByMarketplace: boolean; shippedAt?: string; deliveredAt?: string; estimatedDeliveryAt?: string;
};
export type ExternalOrder = {
  id: string; accountId: string; state: ExternalOrderState; externalStatus: string; createdAt: string; updatedAt: string; paidAt?: string; cancelledAt?: string; cancelReason?: string;
  currency: string; items: ExternalOrderItem[]; subtotalCents: number; discountCents: number; shippingCents: number; totalCents: number;
  /** Só o que o canal libera (o marketplace mascara contato). Nunca e-mail/telefone inventados. */
  buyer: { id?: string; name?: string; nickname?: string };
  shippingAddress?: { city?: string; state?: string; postalCode?: string };
  shipment?: ExternalShipment;
  /** Snapshot pequeno e seguro (ids/estados) para auditoria — sem dados pessoais. */
  data: Record<string, unknown>;
};
export type ExternalReturnState = "REQUESTED" | "APPROVED" | "IN_TRANSIT" | "RECEIVED" | "COMPLETED" | "REJECTED" | "CANCELLED";
export type ExternalReturn = { id: string; orderId: string; state: ExternalReturnState; externalStatus: string; reason?: string; refundCents?: number;
  items: { externalItemId: string; externalVariationId?: string; quantity: number }[]; createdAt: string; updatedAt: string };
export type ShippingLabel = { contentType: string; base64: string; filename: string };
/** Notificação já autenticada (assinatura do canal conferida) e traduzida para um job. */
export type ProviderNotification = { accountId: string; eventId: string; topic: string; kind: "ORDER" | "LISTING" | "RETURN"; resource: string; externalOrderId?: string };

export interface MarketplaceProvider {
  readonly id: MarketplaceProviderId;
  /** Identifica o app no canal (client_id/partner_id/app_key) — notificações de outros apps são ignoradas. */
  readonly applicationId: string;
  readonly capabilities: ProviderCapabilities;
  /** PKCE só onde o canal suporta (Mercado Livre). */
  readonly pkce: boolean;
  authorizationUrl(state:string,challenge:string):string;
  /** `params`: demais parâmetros do retorno do OAuth (ex.: shop_id da Shopee). */
  connect(input:{code:string;verifier?:string;params:Record<string,string>}):Promise<MarketplaceTokens>;
  refreshConnection(refreshToken:string,auth:{accountId:string;metadata:Record<string,string>}):Promise<MarketplaceTokens>;
  disconnect(auth:ProviderAuth):Promise<void>;
  account(auth:ProviderAuth):Promise<{id:string;name:string;siteId:string;userProducts:boolean;metadata?:Record<string,string>}>;
  listExternalProducts(auth:ProviderAuth,cursor?:string):Promise<{ids:string[];cursor?:string;total:number}>;
  getListing(auth:ProviderAuth,id:string):Promise<ExternalListing>;
  category(auth:ProviderAuth,id:string):Promise<CategoryRequirements>;
  validateListing(auth:ProviderAuth,input:ListingWrite):Promise<string[]>;
  createListing(auth:ProviderAuth,input:ListingWrite):Promise<ExternalListing>;
  updateListing(auth:ProviderAuth,id:string,input:Partial<PublishDraft>,userProducts:boolean):Promise<void>;
  setStatus(auth:ProviderAuth,id:string,status:"paused"|"active"|"closed"):Promise<void>;
  syncPrice(auth:ProviderAuth,id:string,priceCents:number,variants?:{id:string;priceCents:number}[]):Promise<void>;
  syncStock(auth:ProviderAuth,id:string,quantity:number,variants?:{id:string;quantity:number}[]):Promise<void>;
  // ------------------------------------------------------------ pedidos, logística e devoluções
  /** Pedidos alterados na janela (reconciliação/polling). */
  listOrders(auth:ProviderAuth,input:{updatedFrom:string;updatedTo:string;cursor?:string}):Promise<{ids:string[];cursor?:string}>;
  getOrder(auth:ProviderAuth,id:string):Promise<ExternalOrder>;
  /** Devoluções/reclamações de um pedido (o canal decide o reembolso). */
  getReturns(auth:ProviderAuth,orderId:string):Promise<ExternalReturn[]>;
  shippingLabel(auth:ProviderAuth,order:ExternalOrder):Promise<ShippingLabel>;
  cancelOrder(auth:ProviderAuth,order:ExternalOrder,reason:string):Promise<void>;
  /** Recurso de notificação que não é o próprio pedido (envio, reclamação) → id do pedido. */
  resolveOrderId?(auth:ProviderAuth,resource:string):Promise<string|undefined>;
  /** Confere a assinatura do canal e traduz a notificação. `undefined` = não é deste app/da integração. */
  parseNotification(input:{headers:Record<string,string|undefined>;rawBody:string;url:string}):ProviderNotification|undefined;
}
