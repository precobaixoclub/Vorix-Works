import {z} from "zod";
import {randomInt} from "node:crypto";
/**
 * Vorix Commerce, Fase 1. O catálogo continua sendo a fonte única; aqui só se decide COMO cada
 * produto é comercializado no Site. Checkout online existe no modelo, mas não é oferecido ao
 * visitante até a Fase 2 (Order + Payment + Shipping) existir de verdade.
 */
export const SITE_COMMERCE_MODES=["SHOWCASE","WHATSAPP","WHATSAPP_CART","ONLINE_CHECKOUT","HYBRID"] as const;
export type SiteCommerceMode=(typeof SITE_COMMERCE_MODES)[number];
export const PRODUCT_SALE_MODES=["INHERIT_SITE_DEFAULT","SHOW_ONLY","WHATSAPP_DIRECT","WHATSAPP_CART","ONLINE_CHECKOUT"] as const;
export type ProductSaleMode=(typeof PRODUCT_SALE_MODES)[number];
/** O que o visitante efetivamente vê nesta fase. */
export type EffectiveSaleMode="SHOW_ONLY"|"WHATSAPP_DIRECT"|"WHATSAPP_CART";
export type CommerceAction="whatsapp"|"add_to_cart"|"inquiry";
export const ONLINE_CHECKOUT_AVAILABLE=false;

export const SHOWCASE_CTAS={LEARN_MORE:"Saiba mais",INTERESTED:"Tenho interesse",QUOTE:"Solicitar orçamento"} as const;
export const siteCommerceSettingsSchema=z.object({
 mode:z.enum(SITE_COMMERCE_MODES),
 showcaseCta:z.enum(["LEARN_MORE","INTERESTED","QUOTE"]).default("INTERESTED"),
 /** Equipe que recebe os novos clientes do Site; a distribuição é a da própria equipe. */
 teamId:z.string().min(1).max(160).optional(),
 createOpportunityFromWhatsapp:z.boolean().default(true),
 form:z.object({openAttendance:z.boolean().default(false),createOpportunity:z.boolean().default(false)}).strict().default({openAttendance:false,createOpportunity:false}),
 notifyTeam:z.boolean().default(true),
 outOfStock:z.enum(["ASK_AVAILABILITY","SHOW_UNAVAILABLE","HIDE_CTA"]).default("ASK_AVAILABILITY"),
}).strict();
export type SiteCommerceSettings=z.infer<typeof siteCommerceSettingsSchema>;
/** Site sem configuração salva preserva o comportamento anterior (botão de WhatsApp quando há número). */
export function defaultSiteCommerceSettings(hasWhatsapp:boolean):SiteCommerceSettings{
 return siteCommerceSettingsSchema.parse({mode:hasWhatsapp?"WHATSAPP":"SHOWCASE"});
}

export type CommerceProductInput={type:string;itemType?:string;saleMode?:ProductSaleMode;trackStock:boolean;availableQuantity?:number};
export type ProductCommerce={
 saleMode:EffectiveSaleMode;requestedSaleMode:ProductSaleMode;checkoutAvailable:false;
 allowedActions:CommerceAction[];ctaLabel:string;availability:"available"|"unavailable"|"untracked";
};
const assistedTypes=new Set(["VEHICLE","REAL_ESTATE"]);
function siteDefault(mode:SiteCommerceMode,product:CommerceProductInput):Exclude<ProductSaleMode,"INHERIT_SITE_DEFAULT">{
 if(mode==="SHOWCASE")return "SHOW_ONLY";
 if(mode==="WHATSAPP")return "WHATSAPP_DIRECT";
 if(mode==="WHATSAPP_CART")return "WHATSAPP_CART";
 if(mode==="ONLINE_CHECKOUT")return "ONLINE_CHECKOUT";
 // HYBRID: cada produto decide; sem escolha, serviços/veículos/imóveis vão para conversa e o resto para o carrinho.
 return assistedTypes.has(product.type)||product.itemType==="service"?"WHATSAPP_DIRECT":"WHATSAPP_CART";
}
export function resolveProductCommerce(input:{settings:SiteCommerceSettings;hasWhatsapp:boolean;contactForm:boolean;product:CommerceProductInput}):ProductCommerce{
 const requested=input.product.saleMode&&input.product.saleMode!=="INHERIT_SITE_DEFAULT"?input.product.saleMode:siteDefault(input.settings.mode,input.product);
 let saleMode:EffectiveSaleMode=requested==="SHOW_ONLY"?"SHOW_ONLY":requested==="WHATSAPP_CART"?"WHATSAPP_CART":"WHATSAPP_DIRECT";
 if(saleMode!=="SHOW_ONLY"&&!input.hasWhatsapp)saleMode="SHOW_ONLY";
 const availability=!input.product.trackStock||input.product.availableQuantity===undefined?"untracked":input.product.availableQuantity>0?"available":"unavailable";
 const inquiry:CommerceAction[]=input.contactForm?["inquiry"]:[];
 const base={requestedSaleMode:input.product.saleMode??"INHERIT_SITE_DEFAULT",checkoutAvailable:false as const,availability} as const;
 if(saleMode==="SHOW_ONLY")return {...base,saleMode,allowedActions:inquiry,ctaLabel:SHOWCASE_CTAS[input.settings.showcaseCta]};
 if(availability==="unavailable"){
  if(input.settings.outOfStock==="ASK_AVAILABILITY")return {...base,saleMode:"WHATSAPP_DIRECT",allowedActions:["whatsapp",...inquiry],ctaLabel:"Consultar disponibilidade"};
  return {...base,saleMode,allowedActions:input.settings.outOfStock==="SHOW_UNAVAILABLE"?inquiry:[],ctaLabel:"Indisponível no momento"};
 }
 if(saleMode==="WHATSAPP_CART")return {...base,saleMode,allowedActions:["add_to_cart","whatsapp",...inquiry],ctaLabel:"Adicionar ao carrinho"};
 return {...base,saleMode,allowedActions:["whatsapp",...inquiry],ctaLabel:"Falar no WhatsApp"};
}
export function siteCommerceSummary(settings:SiteCommerceSettings,hasWhatsapp:boolean){
 return {mode:settings.mode,cartEnabled:hasWhatsapp&&(settings.mode==="WHATSAPP_CART"||settings.mode==="HYBRID"),whatsappEnabled:hasWhatsapp,checkoutAvailable:ONLINE_CHECKOUT_AVAILABLE,showcaseCta:SHOWCASE_CTAS[settings.showcaseCta]};
}

// Referência curta: alfabeto sem 0/O/1/I/L, 6 posições (~887 milhões), sorteada com CSPRNG — não
// enumerável e sempre amarrada ao tenant/workspace na conversão.
const REFERENCE_ALPHABET="23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const SALES_INTENT_TTL_MS=14*24*60*60*1000;
export function newSalesIntentReference():string{let code="";for(let i=0;i<6;i++)code+=REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];return `VX-${code}`;}
export function isSalesIntentReference(value:string):boolean{return /^VX-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(value);}
/** Acha a referência numa mensagem recebida. Aceita minúsculas (o cliente pode reescrever o texto). */
export function extractSalesIntentReference(text:string|undefined):string|undefined{
 const match=text?/(?:^|[^A-Za-z0-9])(VX-[23456789A-HJKMNP-Z]{6})(?![A-Za-z0-9])/i.exec(text):null;
 if(!match)return undefined;const reference=match[1].toUpperCase();return isSalesIntentReference(reference)?reference:undefined;
}

export const SALES_INTENT_TYPES=["PRODUCT_WHATSAPP","CART_WHATSAPP","CONTACT_FORM","CHECKOUT","MARKETPLACE","OTHER"] as const;
export type SalesIntentType=(typeof SALES_INTENT_TYPES)[number];
export type SalesIntentStatus="OPEN"|"CONVERTING"|"CONVERTED"|"EXPIRED";
export type SalesIntentItem={productId:string;variantId?:string;name:string;variantLabel?:string;sku?:string;imageUrl?:string;quantity:number;unitPriceCents:number;currency:string;specifications?:{label:string;value:string}[]};
export type SalesIntentSnapshot={items:SalesIntentItem[];subtotalCents:number;currency:string;siteName?:string};
export type Utm={source?:string;medium?:string;campaign?:string;content?:string;term?:string};
export type SalesIntent={
 id:string;tenantId:string;workspaceId:string;siteId:string;reference:string;type:SalesIntentType;status:SalesIntentStatus;source:"SITE";
 productId?:string;variantId?:string;quantity?:number;snapshot:SalesIntentSnapshot;pageUrl?:string;utm:Utm;anonymousSessionId?:string;
 clickCount:number;contactId?:string;conversationId?:string;attendanceId?:string;dealId?:string;conversionError?:string;
 createdAt:string;expiresAt:string;convertedAt?:string;
};
export const utmSchema=z.object({source:z.string().trim().max(120).optional(),medium:z.string().trim().max(120).optional(),campaign:z.string().trim().max(200).optional(),content:z.string().trim().max(200).optional(),term:z.string().trim().max(200).optional()}).strict();

const money=(cents:number,currency:string)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency}).format(cents/100);
/** Mensagem pré-preenchida do WhatsApp. A referência vai sempre na última linha, isolada. */
export function salesIntentWhatsappMessage(intent:Pick<SalesIntent,"type"|"reference"|"snapshot">):string{
 const items=intent.snapshot.items;const describe=(item:SalesIntentItem)=>`${item.name}${item.variantLabel?` (${item.variantLabel})`:""}`;
 if(intent.type==="CART_WHATSAPP"){
  const lines=items.map(item=>`• ${item.quantity}x ${describe(item)} — ${money(item.unitPriceCents*item.quantity,item.currency)}`);
  return `Olá! Gostaria de comprar estes itens:\n${lines.join("\n")}\nTotal estimado: ${money(intent.snapshot.subtotalCents,intent.snapshot.currency)}\n\nRef: ${intent.reference}`;
 }
 const item=items[0];
 return `Olá! Tenho interesse em ${item?describe(item):"um produto do site"}${item&&item.quantity>1?`, quantidade ${item.quantity}`:""}.\n\nRef: ${intent.reference}`;
}
