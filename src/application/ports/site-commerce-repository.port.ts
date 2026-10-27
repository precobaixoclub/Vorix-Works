import type {SalesIntent,SalesIntentSnapshot,SalesIntentType,SiteCommerceSettings,Utm} from "../../domain/sites/site-commerce.js";
export type SiteEventType="SITE_VIEW"|"PRODUCT_VIEW"|"PRODUCT_WHATSAPP_CLICK"|"ADD_TO_CART"|"REMOVE_FROM_CART"|"CART_WHATSAPP_START"|"CONTACT_FORM_SUBMITTED"|"SALES_INTENT_CREATED"|"SALES_INTENT_CONVERTED"|"CHECKOUT_STARTED"|"SHIPPING_QUOTED"|"PAYMENT_STARTED"|"ORDER_CREATED"|"PAYMENT_APPROVED"|"ORDER_PAID"|"ORDER_CANCELLED"|"ORDER_COMPLETED";
export type SiteEventInput={tenantId:string;workspaceId:string;siteId:string;type:SiteEventType;anonymousSessionId?:string;contactId?:string;productId?:string;variantId?:string;salesIntentId?:string;cartId?:string;orderId?:string;pageUrl?:string;utm?:Utm};
export type CreateSalesIntentInput={tenantId:string;workspaceId:string;siteId:string;reference:string;type:SalesIntentType;status?:"OPEN"|"CONVERTED";productId?:string;variantId?:string;quantity?:number;snapshot:SalesIntentSnapshot;pageUrl?:string;utm:Utm;anonymousSessionId?:string;requestKey?:string;expiresAt:string;contactId?:string;dealId?:string};
export type SalesIntentLinks={contactId?:string;conversationId?:string;attendanceId?:string;dealId?:string};
export type SiteCart={id:string;tenantId:string;workspaceId:string;siteId:string;status:"ACTIVE"|"CHECKED_OUT"|"ABANDONED";salesIntentId?:string;expiresAt:string;updatedAt:string};
export type SiteCartItemSnapshot={name:string;variantLabel?:string;sku?:string;imageUrl?:string;unitPriceCents:number;currency:string};
export type SiteCartItem={id:string;productId:string;variantId?:string;quantity:number;productSnapshot:SiteCartItemSnapshot};
export type SiteCommerceRepositoryPort={
 getSettings(siteId:string):Promise<SiteCommerceSettings|undefined>;
 saveSettings(input:{siteId:string;tenantId:string;workspaceId:string;settings:SiteCommerceSettings;actorUserId:string}):Promise<SiteCommerceSettings>;
 /** Idempotente por (siteId, requestKey): duplo clique/retry devolve a mesma intenção. */
 createIntent(input:CreateSalesIntentInput):Promise<{intent:SalesIntent;created:boolean}>;
 getIntent(id:string):Promise<SalesIntent|undefined>;
 findIntentByRequestKey(input:{siteId:string;requestKey:string}):Promise<SalesIntent|undefined>;
 getIntentByReference(reference:string):Promise<SalesIntent|undefined>;
 recordIntentClick(id:string):Promise<void>;
 /** OPEN (ou CONVERTING abandonado antes de `staleBefore`) → CONVERTING. Só um processo vence. */
 claimIntent(input:{id:string;staleBefore:string}):Promise<SalesIntent|undefined>;
 updateIntentLinks(id:string,links:SalesIntentLinks):Promise<void>;
 completeIntent(id:string,links:SalesIntentLinks):Promise<SalesIntent|undefined>;
 releaseIntent(id:string,error:string):Promise<void>;
 listIntents(input:{tenantId:string;workspaceId:string;siteId?:string;limit:number}):Promise<SalesIntent[]>;
 getCart(input:{siteId:string;tokenHash:string}):Promise<SiteCart|undefined>;
 createCart(input:{tenantId:string;workspaceId:string;siteId:string;tokenHash:string;anonymousSessionId?:string;expiresAt:string}):Promise<SiteCart>;
 listCartItems(cartId:string):Promise<SiteCartItem[]>;
 setCartItem(input:{cartId:string;productId:string;variantId?:string;quantity:number;productSnapshot:SiteCartItemSnapshot;expiresAt:string}):Promise<void>;
 removeCartItem(input:{cartId:string;productId:string;variantId?:string}):Promise<boolean>;
 checkoutCart(input:{cartId:string;salesIntentId:string}):Promise<boolean>;
 /** Fase 2: carrinho virou pedido (todas as linhas foram para a compra online). */
 markCartOrdered(cartId:string):Promise<void>;
 variantMeasures(variantIds:readonly string[]):Promise<Map<string,{weightGrams?:number;heightCm?:number;widthCm?:number;lengthCm?:number}>>;
 recordEvent(input:SiteEventInput):Promise<void>;
 attachContactToSession(input:{siteId:string;anonymousSessionId:string;contactId:string}):Promise<void>;
};
