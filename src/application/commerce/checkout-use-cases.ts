/**
 * Vorix Commerce, Fase 2 — checkout, pedido, pagamento e estoque.
 *
 * Regras centrais:
 * - preço, frete e total SEMPRE recalculados aqui (nada do navegador é confiado);
 * - estoque controlado é reservado ao criar o pedido, vira venda (atômico) quando o pagamento é
 *   confirmado pelo provedor e volta quando o pedido expira/cancela — tudo idempotente por chave;
 * - pagamento só é "aprovado" quando o provedor confirma (webhook relido na API do provedor, ou
 *   simulação autenticada do lojista no modo de teste).
 */
import {createHash} from "node:crypto";
import type {Site} from "../../domain/sites/site.model.js";
import {checkoutReadiness,type SiteCommerceSettings} from "../../domain/sites/site-commerce.js";
import {assertOrderTransition,CANCELLABLE_STATUSES,ORDER_STATUS_LABELS,orderAddressSchema,orderCustomerSchema,orderTotals,validTaxDocument,type Order,type OrderAddress,type OrderCustomer,type OrderStatus,type Payment,type PaymentMethod,type PaymentStatus} from "../../domain/commerce/order.model.js";
import type {ShippingOption,ShippingParcelItem} from "../../domain/commerce/shipping.js";
import type {CommerceOrderRepositoryPort,PaymentProviderContext,PaymentProviderPort,ProviderPaymentState,ShippingProviderPort} from "../ports/commerce-ports.js";
import type {SecretManagerPort} from "../ports/secret-manager.port.js";
import {resolvePublishedSite} from "../sites/site-use-cases.js";
import {activeCart,cleanUtm,emit,hashToken,itemSnapshot,presentCart,publicContext,safePageUrl,type PublicLookup,type SiteCommerceDeps,type VisitorContext} from "../sites/site-commerce-use-cases.js";
import {createWonOpportunityForOrder,ensureOrderContact,type OrderCrmDeps} from "../commercial-bridge/order-crm-use-cases.js";
import {notifyBestEffort,type NotificationUseCaseDeps} from "../notification/notification-use-cases.js";
import type {TeamMembershipRepositoryPort} from "../ports/team-repository.port.js";
import {signOwnedUrl,OBJECT_URL_TTL} from "../../shared/utils/object-url-signing.js";

export type CheckoutDeps=SiteCommerceDeps&{
 orders:CommerceOrderRepositoryPort;
 paymentProviders:Partial<Record<"SANDBOX"|"MERCADO_PAGO",PaymentProviderPort>>;
 shippingProviders:Record<string,ShippingProviderPort>;
 secrets?:Pick<SecretManagerPort,"get"|"put"|"delete">;
 /** Modo de teste de pagamento liberado (QA/homologação): para todos (true) ou por tenant. */
 sandboxAllowed:boolean|((tenantId:string)=>boolean);
 webhookBaseUrl?:string;
 crm?:OrderCrmDeps;
 notification?:Partial<NotificationUseCaseDeps>;
 teamMembershipRepository?:TeamMembershipRepositoryPort;
};
const SYSTEM="system";
const now=(deps:CheckoutDeps)=>deps.now?.()??new Date();
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);

export const sandboxAllowedFor=(deps:Pick<CheckoutDeps,"sandboxAllowed">,tenantId:string)=>typeof deps.sandboxAllowed==="function"?deps.sandboxAllowed(tenantId):deps.sandboxAllowed;
// ------------------------------------------------------------------ credenciais do lojista
export const COMMERCE_CREDENTIAL_PROVIDERS=["MERCADO_PAGO","MELHOR_ENVIO"] as const;
export type CommerceCredentialProvider=(typeof COMMERCE_CREDENTIAL_PROVIDERS)[number];
const credentialRef=(site:Pick<Site,"tenantId"|"id">,provider:CommerceCredentialProvider)=>`commerce/${site.tenantId}/${site.id}/${provider.toLowerCase()}`;
export async function readCommerceCredential(deps:Pick<CheckoutDeps,"secrets">,site:Pick<Site,"tenantId"|"id">,provider:CommerceCredentialProvider):Promise<Record<string,string>|undefined>{
 const stored=await deps.secrets?.get(credentialRef(site,provider)).catch(()=>undefined);
 const value=stored?.value as Record<string,unknown>|undefined;
 return value&&typeof value.accessToken==="string"?Object.fromEntries(Object.entries(value).filter(([,item])=>typeof item==="string")) as Record<string,string>:undefined;
}
export async function saveCommerceCredential(deps:Pick<CheckoutDeps,"secrets">,site:Site,provider:CommerceCredentialProvider,input:{accessToken?:string;publicKey?:string}){
 if(!deps.secrets)throw Error("SITE_VALIDATION: cofre de credenciais indisponível neste ambiente.");
 if(!input.accessToken){await deps.secrets.delete(credentialRef(site,provider));return {connected:false};}
 await deps.secrets.put(credentialRef(site,provider),{value:{accessToken:input.accessToken.trim(),...(input.publicKey?{publicKey:input.publicKey.trim()}:{})}});
 return {connected:true};
}
export async function commerceCredentialStatus(deps:Pick<CheckoutDeps,"secrets">,site:Site){
 const [mp,me]=await Promise.all([readCommerceCredential(deps,site,"MERCADO_PAGO"),readCommerceCredential(deps,site,"MELHOR_ENVIO")]);
 return {MERCADO_PAGO:{connected:!!mp,publicKey:mp?.publicKey},MELHOR_ENVIO:{connected:!!me}};
}
/** Usado pelo site para decidir se mostra "Comprar agora". */
export async function siteCheckoutStatus(deps:Pick<CheckoutDeps,"secrets"|"sandboxAllowed">,site:Site,settings:SiteCommerceSettings){
 const paymentCredentialReady=settings.checkout.payment.provider==="MERCADO_PAGO"?!!(await readCommerceCredential(deps,site,"MERCADO_PAGO")):true;
 const missing=checkoutReadiness(settings,{paymentCredentialReady,sandboxAllowed:sandboxAllowedFor(deps,site.tenantId)});
 return {ready:missing.length===0,missing};
}

// ------------------------------------------------------------------ cotação (carrinho → itens + frete)
type CheckoutLine=Awaited<ReturnType<typeof presentCart>>["lines"][number];
async function checkoutLines(deps:CheckoutDeps,lookup:PublicLookup,token:string){
 const context=await publicContext(deps,lookup);
 if(!context.commerce.checkoutReady)throw Error("SITE_VALIDATION: a compra online não está disponível nesta loja.");
 const cart=await activeCart(deps,context,token);if(!cart)throw Error("SITE_VALIDATION: seu carrinho expirou. Adicione os produtos de novo.");
 const {lines:all}=await presentCart(deps,context,cart,token);
 const lines=all.filter(line=>line.channel==="checkout");
 if(!lines.length)throw Error("SITE_VALIDATION: não há produtos para compra online no carrinho.");
 const blocked=lines.find(line=>!line.available||!line.resolved);
 if(blocked)throw Error(`SITE_VALIDATION: ${blocked.name}${blocked.variantLabel?` (${blocked.variantLabel})`:""} não está disponível nessa quantidade. Ajuste o carrinho.`);
 const currencies=new Set(lines.map(line=>line.currency));if(currencies.size>1)throw Error("SITE_VALIDATION: o carrinho tem produtos em moedas diferentes.");
 return {context,cart,lines,allLines:all};
}
async function parcelItems(deps:CheckoutDeps,lines:CheckoutLine[]):Promise<ShippingParcelItem[]>{
 const measures=await deps.commerceRepository.variantMeasures(lines.map(line=>line.variantId).filter((id):id is string=>!!id));
 return lines.map(line=>{const own=line.resolved!.product.details?.shipping??{},variant=line.variantId?measures.get(line.variantId):undefined;
  return {productId:line.productId,quantity:line.quantity,unitPriceCents:line.unitPriceCents,weightGrams:variant?.weightGrams??own.weightGrams,heightCm:variant?.heightCm??own.heightCm,widthCm:variant?.widthCm??own.widthCm,lengthCm:variant?.lengthCm??own.lengthCm};});
}
async function shippingOptions(deps:CheckoutDeps,context:Awaited<ReturnType<typeof publicContext>>,lines:CheckoutLine[],postalCode:string|undefined):Promise<ShippingOption[]>{
 const settings=context.commerce.settings.checkout.shipping;
 const request={destinationPostalCode:postalCode,subtotalCents:lines.reduce((sum,line)=>sum+line.unitPriceCents*line.quantity,0),items:await parcelItems(deps,lines)};
 const scope={tenantId:context.site.tenantId,workspaceId:context.site.workspaceId,siteId:context.site.id,settings};
 const options=[...await (deps.shippingProviders.OWN?.quote(scope,request)??Promise.resolve([]))];
 if(settings.provider.key!=="NONE"&&postalCode){
  const provider=deps.shippingProviders[settings.provider.key];
  // Provedor externo fora do ar nunca derruba o checkout: seguem só os métodos próprios.
  if(provider)options.push(...await provider.quote({...scope,credentials:await readCommerceCredential(deps,context.site,"MELHOR_ENVIO")},request).catch(error=>{deps.log?.("shipping_provider_failed",{provider:settings.provider.key,error:errorText(error)});return [];}));
 }
 return options;
}
function presentLines(lines:CheckoutLine[]){return lines.map(({resolved:_resolved,...line})=>line);}
function paymentMethods(settings:SiteCommerceSettings,publicKey?:string){
 const payment=settings.checkout.payment;
 if(payment.provider==="SANDBOX")return [{method:"SANDBOX" as const,label:"Pagamento de teste (nenhum valor é cobrado)"}];
 return [...(payment.pix?[{method:"PIX" as const,label:"PIX"}]:[]),...(payment.card&&publicKey?[{method:"CARD" as const,label:"Cartão de crédito",publicKey}]:[])];
}
export async function quoteCheckout(deps:CheckoutDeps,input:{lookup:PublicLookup;token:string;postalCode?:string}&VisitorContext){
 const {context,lines,allLines,cart}=await checkoutLines(deps,input.lookup,input.token);
 const postal=input.postalCode?.replace(/\D/g,"");
 if(postal&&!/^\d{8}$/.test(postal))throw Error("SITE_VALIDATION: informe um CEP válido.");
 const options=await shippingOptions(deps,context,lines,postal);
 const totals=orderTotals(lines,0);
 const credential=context.commerce.settings.checkout.payment.provider==="MERCADO_PAGO"?await readCommerceCredential(deps,context.site,"MERCADO_PAGO"):undefined;
 const base={tenantId:context.site.tenantId,workspaceId:context.site.workspaceId,siteId:context.site.id,anonymousSessionId:input.sessionId,cartId:cart.id,pageUrl:safePageUrl(input.pageUrl),utm:cleanUtm(input.utm)};
 emit(deps,{...base,type:postal?"SHIPPING_QUOTED":"CHECKOUT_STARTED"});
 return {items:presentLines(lines),otherItems:allLines.length-lines.length,subtotalCents:totals.subtotalCents,currency:lines[0].currency,shippingOptions:options,
  paymentMethods:paymentMethods(context.commerce.settings,credential?.publicKey),requireDocument:context.commerce.settings.checkout.requireDocument||context.commerce.settings.checkout.payment.provider==="MERCADO_PAGO",
  sandbox:context.commerce.settings.checkout.payment.provider==="SANDBOX",reservationMinutes:context.commerce.settings.checkout.reservationMinutes,storeName:context.snapshot.content.name};
}

// ------------------------------------------------------------------ pedido
export type PlaceOrderInput={lookup:PublicLookup;token:string;requestKey:string;customer:unknown;address?:unknown;deliveryOptionId:string;payment:{method:PaymentMethod;cardToken?:string;cardPaymentMethodId?:string;installments?:number}}&VisitorContext;
const reserveKey=(order:Order,itemId:string)=>`order:${order.id}:reserve:${itemId}`;
async function moveStock(deps:CheckoutDeps,order:Order,kind:"RESERVATION"|"RELEASE"|"SALE"|"RETURN",suffix:string,consumeReservation=false){
 for(const item of order.items.filter(item=>item.trackStock))
  await deps.productEngineRepository.move({tenantId:order.tenantId,workspaceId:order.workspaceId,productId:item.productId,variantId:item.variantId,kind,quantity:item.quantity,operationKey:`order:${order.id}:${suffix}:${item.id}`,userId:SYSTEM,...(consumeReservation?{consumeReservation:true}:{})});
}
/** Reserva todos os itens ou nenhum: se um faltar, devolve o que já tinha reservado. */
async function reserveStock(deps:CheckoutDeps,order:Order){
 const reserved:typeof order.items=[];
 try{
  for(const item of order.items.filter(item=>item.trackStock)){
   await deps.productEngineRepository.move({tenantId:order.tenantId,workspaceId:order.workspaceId,productId:item.productId,variantId:item.variantId,kind:"RESERVATION",quantity:item.quantity,operationKey:reserveKey(order,item.id),userId:SYSTEM});
   reserved.push(item);
  }
 }catch(error){
  for(const item of reserved)await deps.productEngineRepository.move({tenantId:order.tenantId,workspaceId:order.workspaceId,productId:item.productId,variantId:item.variantId,kind:"RELEASE",quantity:item.quantity,operationKey:`order:${order.id}:release:${item.id}`,userId:SYSTEM}).catch(()=>undefined);
  const failed=order.items.find(item=>item.trackStock&&!reserved.includes(item));
  throw Object.assign(Error(`SITE_VALIDATION: ${failed?`${failed.name}${failed.variantLabel?` (${failed.variantLabel})`:""}`:"Um produto"} acabou de esgotar. Ajuste o carrinho e tente de novo.`),{cause:error});
 }
}
function providerContext(order:Pick<Order,"tenantId"|"workspaceId"|"siteId">,credentials?:Record<string,string>):PaymentProviderContext{return {tenantId:order.tenantId,workspaceId:order.workspaceId,siteId:order.siteId??"",credentials};}
async function paymentProviderFor(deps:CheckoutDeps,site:Pick<Site,"tenantId"|"id">,key:string){
 const provider=deps.paymentProviders[key as "SANDBOX"|"MERCADO_PAGO"];if(!provider)throw Error("SITE_VALIDATION: forma de pagamento indisponível.");
 return {provider,credentials:key==="MERCADO_PAGO"?await readCommerceCredential(deps,site,"MERCADO_PAGO"):undefined};
}
const orderToken=(siteId:string,requestKey:string)=>createHash("sha256").update(`order:${siteId}:${requestKey}`).digest("base64url");
export async function placeOrder(deps:CheckoutDeps,input:PlaceOrderInput){
 // Repetição (duplo clique, retry após falha de rede): o mesmo pedido volta antes de olhar o carrinho.
 const {site:publishedSite}=await resolvePublishedSite(deps,input.lookup);
 const repeatedToken=orderToken(publishedSite.id,input.requestKey);
 const existing=await deps.orders.getByPublicTokenHash(hashToken(repeatedToken));
 if(existing)return {...(await publicOrderView(deps,existing)),publicToken:repeatedToken,repeated:true};
 const {context,lines,allLines,cart}=await checkoutLines(deps,input.lookup,input.token);
 const settings=context.commerce.settings.checkout;
 const customer=orderCustomerSchema.parse(input.customer) as OrderCustomer;
 const needsDocument=settings.requireDocument||settings.payment.provider==="MERCADO_PAGO";
 if(needsDocument&&(!customer.document||!validTaxDocument(customer.document)))throw Error("SITE_VALIDATION: informe um CPF ou CNPJ válido.");
 if(customer.document&&!validTaxDocument(customer.document))throw Error("SITE_VALIDATION: informe um CPF ou CNPJ válido.");
 const methods=paymentMethods(context.commerce.settings,(await readCommerceCredential(deps,context.site,"MERCADO_PAGO").catch(()=>undefined))?.publicKey).map(item=>item.method);
 if(!methods.includes(input.payment.method as never))throw Error("SITE_VALIDATION: forma de pagamento indisponível.");
 const address=input.address?orderAddressSchema.parse(input.address) as OrderAddress:undefined;
 // Frete recalculado aqui: o navegador só escolhe a opção pelo id.
 const options=await shippingOptions(deps,context,lines,address?.postalCode);
 const option=options.find(item=>item.id===input.deliveryOptionId);
 if(!option)throw Error("SITE_VALIDATION: a forma de entrega escolhida não está disponível para este CEP. Escolha outra.");
 if(option.requiresAddress&&!address)throw Error("SITE_VALIDATION: informe o endereço de entrega.");
 const items=lines.map((line,position)=>{const snap=itemSnapshot(line.resolved!,line.quantity);return {position,productId:snap.productId,variantId:snap.variantId,sku:snap.sku,name:snap.name,variantLabel:snap.variantLabel,imageUrl:snap.imageUrl,quantity:line.quantity,unitPriceCents:snap.unitPriceCents,totalCents:snap.unitPriceCents*line.quantity,trackStock:!!line.resolved!.product.trackStock,specifications:snap.specifications??[]};});
 const totals=orderTotals(items,option.priceCents);
 // Token de acompanhamento derivado da chave da requisição (aleatória, só o navegador conhece): uma
 // repetição após falha de rede devolve o MESMO pedido e o mesmo link, sem criar outro.
 const publicToken=orderToken(context.site.id,input.requestKey);
 const expiresAt=new Date(now(deps).getTime()+settings.reservationMinutes*60_000).toISOString();
 const {order:created,created:isNew}=await deps.orders.create({tenantId:context.site.tenantId,workspaceId:context.site.workspaceId,siteId:context.site.id,publicTokenHash:hashToken(publicToken),requestKey:input.requestKey,customer,shippingAddress:option.requiresAddress?address:undefined,
  delivery:{optionId:option.id,kind:option.kind,label:option.label,priceCents:option.priceCents,days:option.days,provider:option.provider,requiresAddress:option.requiresAddress},...totals,currency:lines[0].currency,cartId:cart.id,anonymousSessionId:input.sessionId,utm:cleanUtm(input.utm) as Record<string,string>,reservationExpiresAt:expiresAt,items});
 // Repetição (duplo clique/retry): devolve o mesmo pedido. O token público só é revelado na criação.
 if(!isNew)return {...(await publicOrderView(deps,created)),publicToken,repeated:true};
 let order=created;
 const base={tenantId:order.tenantId,workspaceId:order.workspaceId,siteId:context.site.id,anonymousSessionId:input.sessionId,cartId:cart.id,orderId:order.id,pageUrl:safePageUrl(input.pageUrl),utm:cleanUtm(input.utm)};
 try{
  await reserveStock(deps,order);
  if(order.items.some(item=>item.trackStock))order=(await deps.orders.update(order.id,{stockState:"RESERVED"},{type:"stock_reserved",actorType:"system",data:{expiresAt}}))??order;
 }catch(error){
  await deps.orders.update(order.id,{status:"CANCELLED",cancelReason:"out_of_stock",cancelledAt:now(deps).toISOString(),paymentStatus:"CANCELLED",reservationExpiresAt:null},{type:"order_cancelled",fromStatus:"PENDING",toStatus:"CANCELLED",actorType:"system",data:{reason:"out_of_stock"}});
  throw error;
 }
 emit(deps,{...base,amountCents:order.totalCents,currency:order.currency,type:"ORDER_CREATED"});
 // Contato no CRM assim que os dados são confirmados (falha aqui nunca derruba a compra).
 if(deps.crm)await ensureOrderContact(deps.crm,order).then(contactId=>deps.orders.update(order.id,{contactId},{type:"contact_linked",actorType:"system",data:{contactId}})).then(updated=>{if(updated)order=updated;}).catch(error=>deps.log?.("order_contact_failed",{orderId:order.id,error:errorText(error)}));
 try{
  const {provider,credentials}=await paymentProviderFor(deps,context.site,settings.payment.provider);
  const state=await provider.createPayment(providerContext(order,credentials),{orderId:order.id,orderNumber:order.number,amountCents:order.totalCents,currency:order.currency,method:input.payment.method,description:`Pedido #${order.number} — ${context.snapshot.content.name}`,customer,expiresAt,idempotencyKey:`order-${order.id}-payment-1`,
   notificationUrl:deps.webhookBaseUrl&&provider.key==="MERCADO_PAGO"?`${deps.webhookBaseUrl.replace(/\/$/,"")}/webhooks/commerce/mercado-pago/${context.site.id}`:undefined,cardToken:input.payment.cardToken,cardPaymentMethodId:input.payment.cardPaymentMethodId,installments:input.payment.installments});
  const payment=await deps.orders.createPayment({tenantId:order.tenantId,workspaceId:order.workspaceId,orderId:order.id,provider:provider.key,method:input.payment.method,amountCents:order.totalCents,currency:order.currency,providerPaymentId:state.providerPaymentId,status:"PENDING",instructions:state.instructions??{},failureReason:undefined});
  order=(await deps.orders.update(order.id,{status:"AWAITING_PAYMENT"},{type:"payment_started",fromStatus:"PENDING",toStatus:"AWAITING_PAYMENT",actorType:"customer",data:{provider:provider.key,method:input.payment.method}},{statuses:["PENDING"]}))??order;
  emit(deps,{...base,type:"PAYMENT_STARTED"});
  // Cartão pode voltar aprovado/recusado na hora: mesmo caminho de um webhook.
  if(state.status!=="PENDING")await applyPaymentState(deps,payment,state,{eventKey:`create:${payment.id}:${state.status}`,actor:"provider"});
 }catch(error){
  await cancelOrderInternal(deps,order,{reason:"payment_error",actorType:"system"}).catch(()=>undefined);
  deps.log?.("ConversionError",{orderId:order.id,stage:"payment",error:errorText(error)});
  throw Error(errorText(error).startsWith("SITE_VALIDATION")||errorText(error).startsWith("PAYMENT_VALIDATION")?errorText(error).replace(/^PAYMENT_VALIDATION/,"SITE_VALIDATION"):"SITE_VALIDATION: não foi possível iniciar o pagamento agora. Nenhum valor foi cobrado. Tente novamente em instantes.");
 }
 // Linhas compradas saem do carrinho; se não sobrou nada, o carrinho vira pedido.
 if(lines.length===allLines.length)await deps.commerceRepository.markCartOrdered(cart.id);
 else for(const line of lines)await deps.commerceRepository.removeCartItem({cartId:cart.id,productId:line.productId,variantId:line.variantId});
 deps.log?.("OrderCreated",{orderId:order.id,number:order.number,siteId:context.site.id});
 return {...(await publicOrderView(deps,(await deps.orders.get(order.id))!)),publicToken,repeated:false};
}

/** O que o comprador vê (sem dados internos). */
async function publicOrderView(deps:CheckoutDeps,order:Order){
 const payment=(await deps.orders.payments(order.id)).at(-1);
 return {number:order.number,status:order.status,statusLabel:ORDER_STATUS_LABELS[order.status],paymentStatus:order.paymentStatus,shippingStatus:order.shippingStatus,
  items:order.items.map(item=>({name:item.name,variantLabel:item.variantLabel,quantity:item.quantity,unitPriceCents:item.unitPriceCents,totalCents:item.totalCents,imageUrl:item.imageUrl?signOwnedUrl(item.imageUrl,OBJECT_URL_TTL.preview):undefined})),
  subtotalCents:order.subtotalCents,discountCents:order.discountCents,shippingCents:order.shippingCents,totalCents:order.totalCents,currency:order.currency,delivery:{label:order.delivery.label,kind:order.delivery.kind,days:order.delivery.days},
  customerName:order.customer.name.split(/\s+/)[0],reservationExpiresAt:order.status==="AWAITING_PAYMENT"?order.reservationExpiresAt:undefined,
  payment:payment?{method:payment.method,status:payment.status,instructions:payment.status==="PENDING"?payment.instructions:{sandbox:payment.instructions.sandbox}}:undefined,createdAt:order.createdAt};
}
export async function getPublicOrder(deps:CheckoutDeps,input:{publicToken:string}){
 if(!/^[A-Za-z0-9_-]{20,64}$/.test(input.publicToken))throw Error("SITE_NOT_FOUND: pedido não encontrado.");
 let order=await deps.orders.getByPublicTokenHash(hashToken(input.publicToken));if(!order)throw Error("SITE_NOT_FOUND: pedido não encontrado.");
 if(order.status==="AWAITING_PAYMENT"){
  // Sem depender só do webhook: relê o provedor real (nunca o sandbox) e expira se passou do prazo.
  const payment=(await deps.orders.payments(order.id)).at(-1);
  if(payment?.provider==="MERCADO_PAGO"&&payment.providerPaymentId&&payment.status==="PENDING"){
   const {provider,credentials}=await paymentProviderFor(deps,{tenantId:order.tenantId,id:order.siteId??""},payment.provider);
   const state=await provider.getPayment(providerContext(order,credentials),payment.providerPaymentId).catch(()=>undefined);
   if(state&&state.status!=="PENDING")await applyPaymentState(deps,payment,state,{eventKey:`poll:${payment.id}:${state.status}`,actor:"provider"});
  }
  order=(await deps.orders.get(order.id))!;
  if(order.status==="AWAITING_PAYMENT"&&order.reservationExpiresAt&&Date.parse(order.reservationExpiresAt)<=now(deps).getTime())await expireOrder(deps,order);
  order=(await deps.orders.get(order.id))!;
 }
 return publicOrderView(deps,order);
}

// ------------------------------------------------------------------ pagamento
/**
 * Aplica um estado de pagamento confirmado pelo provedor. Idempotente: `eventKey` repetido é
 * ignorado e as transições do pedido são condicionais (dois webhooks juntos nunca baixam estoque 2x).
 */
export async function applyPaymentState(deps:CheckoutDeps,payment:Payment,state:ProviderPaymentState,input:{eventKey:string;actor:"provider"|"user";actorId?:string}){
 if(!await deps.orders.claimWebhookEvent({provider:payment.provider,eventKey:input.eventKey,orderId:payment.orderId,paymentId:payment.id}))return {status:"duplicate" as const};
 const order=await deps.orders.get(payment.orderId);if(!order)return {status:"ignored" as const};
 const at=now(deps).toISOString();
 if(state.status==="APPROVED"){
  // CANCELLED incluso: o PIX pode ser pago no instante em que o pedido expira — a confirmação do provedor vale (e é estornada abaixo).
  const updatedPayment=await deps.orders.updatePayment(payment.id,{status:"APPROVED"},["PENDING","FAILED","CANCELLED"]);
  if(!updatedPayment&&payment.status!=="PENDING")return {status:"ignored" as const};
  if(order.status==="CANCELLED"){
   // Pagou depois de expirar: devolve o dinheiro automaticamente (o estoque já foi liberado).
   await refundPayment(deps,order,payment,"paid_after_cancellation");
   return {status:"refunded_after_cancellation" as const};
  }
  if(order.status!=="AWAITING_PAYMENT")return {status:"ignored" as const};
  // Reserva vira venda na mesma transação de estoque (chave idempotente por item).
  if(order.stockState==="RESERVED")await moveStock(deps,order,"SALE","sale",true);
  const paid=await deps.orders.update(order.id,{status:"PAID",paymentStatus:"APPROVED",stockState:order.stockState==="RESERVED"?"SOLD":order.stockState,paidAt:at,reservationExpiresAt:null},{type:"payment_approved",fromStatus:"AWAITING_PAYMENT",toStatus:"PAID",actorType:input.actor,actorId:input.actorId,data:{paymentId:payment.id,provider:payment.provider}},{statuses:["AWAITING_PAYMENT"]});
  if(!paid)return {status:"ignored" as const};
  emit(deps,{...orderEvent(paid),type:"PAYMENT_APPROVED"});
  await afterPaid(deps,paid).catch(error=>deps.log?.("order_after_paid_failed",{orderId:paid.id,error:errorText(error)}));
  // ORDER_PAID depois do CRM: leva a oportunidade ganha (se criada) para o Analytics não contar a venda duas vezes.
  emit(deps,{...orderEvent(await deps.orders.get(paid.id)??paid),type:"ORDER_PAID"});
  deps.log?.("OrderPaid",{orderId:paid.id,number:paid.number});
  return {status:"paid" as const};
 }
 if(state.status==="FAILED"||state.status==="CANCELLED"){
  await deps.orders.updatePayment(payment.id,{status:state.status,failureReason:state.failureReason},["PENDING"]);
  if(order.status==="AWAITING_PAYMENT")await cancelOrderInternal(deps,order,{reason:state.status==="FAILED"?"payment_failed":"payment_cancelled",actorType:"provider"});
  return {status:"cancelled" as const};
 }
 if(state.status==="REFUNDED"){await deps.orders.updatePayment(payment.id,{status:"REFUNDED"},["APPROVED","PENDING"]);await deps.orders.addEvent(order.id,{type:"payment_refunded",actorType:input.actor,data:{paymentId:payment.id}});}
 return {status:"ignored" as const};
}
/** Evento analítico do pedido: valor total pago (com frete), moeda e a oportunidade ganha da mesma venda (deduplicação). */
const orderEvent=(order:Order)=>({tenantId:order.tenantId,workspaceId:order.workspaceId,siteId:order.siteId??"",anonymousSessionId:order.anonymousSessionId,contactId:order.contactId,orderId:order.id,opportunityId:order.crmDealId,utm:order.utm,amountCents:order.totalCents,currency:order.currency});
async function afterPaid(deps:CheckoutDeps,order:Order){
 const context=order.siteId?await deps.commerceRepository.getSettings(order.siteId):undefined;
 if(deps.crm){
  const contactId=order.contactId??await ensureOrderContact(deps.crm,order);
  if(context?.checkout.orderCrm==="CONTACT_AND_WON_OPPORTUNITY"){
   const dealId=await createWonOpportunityForOrder(deps.crm,{...order,contactId},contactId);
   if(dealId)await deps.orders.update(order.id,{crmDealId:dealId,contactId},{type:"crm_opportunity_won",actorType:"system",data:{dealId}});
  }else if(!order.contactId)await deps.orders.update(order.id,{contactId},{type:"contact_linked",actorType:"system",data:{contactId}});
 }
 // Aviso para a equipe do site (mesma infraestrutura de notificações).
 if(deps.notification?.notificationRepository&&context?.teamId&&deps.teamMembershipRepository)
  for(const member of await deps.teamMembershipRepository.listByTeam(context.teamId).catch(()=>[]))
   notifyBestEffort(deps.notification,{tenantId:order.tenantId,workspaceId:order.workspaceId,userId:member.userId,title:`Novo pedido pago #${order.number}`,body:`${order.customer.name} · ${(order.totalCents/100).toLocaleString("pt-BR",{style:"currency",currency:order.currency})} · ${order.delivery.label}`,sourceType:"commerce_order_paid",sourceId:order.id,sourceUrl:`/workspaces/${order.workspaceId}/site/pedidos?pedido=${order.id}`});
}
async function refundPayment(deps:CheckoutDeps,order:Order,payment:Payment,reason:string){
 if(!payment.providerPaymentId)return;
 const {provider,credentials}=await paymentProviderFor(deps,{tenantId:order.tenantId,id:order.siteId??""},payment.provider);
 const state=await provider.refund(providerContext(order,credentials),payment.providerPaymentId,payment.amountCents);
 await deps.orders.updatePayment(payment.id,{status:state.status==="REFUNDED"?"REFUNDED":"APPROVED"},["APPROVED"]);
 if(state.status==="REFUNDED")await deps.orders.update(order.id,{paymentStatus:"REFUNDED"},{type:"payment_refunded",actorType:"system",data:{paymentId:payment.id,reason}});
 else await deps.orders.addEvent(order.id,{type:"refund_pending",actorType:"system",data:{paymentId:payment.id,reason}});
}
/** Webhook: nunca confia no corpo; relê o pagamento no provedor com a credencial do lojista. */
export async function handlePaymentWebhook(deps:CheckoutDeps,input:{provider:"MERCADO_PAGO";siteId:string;providerPaymentId:string}){
 const payment=await deps.orders.paymentByProviderId(input.provider,input.providerPaymentId);
 if(!payment)return {status:"unknown" as const};
 const order=await deps.orders.get(payment.orderId);if(!order||order.siteId!==input.siteId)return {status:"unknown" as const};
 const {provider,credentials}=await paymentProviderFor(deps,{tenantId:order.tenantId,id:input.siteId},input.provider);
 const state=await provider.getPayment(providerContext(order,credentials),input.providerPaymentId);
 return applyPaymentState(deps,payment,state,{eventKey:`webhook:${input.providerPaymentId}:${state.status}`,actor:"provider"});
}

// ------------------------------------------------------------------ expiração e cancelamento
async function cancelOrderInternal(deps:CheckoutDeps,order:Order,input:{reason:string;actorType:"system"|"user"|"provider"|"customer";actorId?:string;restock?:boolean}){
 const at=now(deps).toISOString();
 const updated=await deps.orders.update(order.id,{status:"CANCELLED",cancelReason:input.reason,cancelledAt:at,reservationExpiresAt:null,shippingStatus:order.shippingStatus==="NOT_REQUIRED"?"NOT_REQUIRED":"CANCELLED",...(order.paymentStatus==="PENDING"?{paymentStatus:"CANCELLED" as PaymentStatus}:{})},
  {type:"order_cancelled",fromStatus:order.status,toStatus:"CANCELLED",actorType:input.actorType,actorId:input.actorId,data:{reason:input.reason}},{statuses:CANCELLABLE_STATUSES});
 if(!updated)return undefined;
 // Estoque: reserva volta; venda ainda não enviada volta ao saldo (opcional, padrão sim).
 if(order.stockState==="RESERVED"){await moveStock(deps,order,"RELEASE","release");await deps.orders.update(order.id,{stockState:"RELEASED"},{type:"stock_released",actorType:"system",data:{}});}
 else if(order.stockState==="SOLD"&&input.restock!==false){await moveStock(deps,order,"RETURN","return");await deps.orders.update(order.id,{stockState:"RETURNED"},{type:"stock_returned",actorType:"system",data:{}});}
 for(const payment of await deps.orders.payments(order.id)){
  if(payment.status==="PENDING"){
   if(payment.providerPaymentId&&payment.provider!=="SANDBOX"){const {provider,credentials}=await paymentProviderFor(deps,{tenantId:order.tenantId,id:order.siteId??""},payment.provider);await provider.cancel(providerContext(order,credentials),payment.providerPaymentId).catch(()=>undefined);}
   await deps.orders.updatePayment(payment.id,{status:"CANCELLED"},["PENDING"]);
  }else if(payment.status==="APPROVED")await refundPayment(deps,order,payment,input.reason);
 }
 const cancelled=await deps.orders.get(order.id);
 emit(deps,{...orderEvent(cancelled??updated),type:"ORDER_CANCELLED"});
 return cancelled;
}
async function expireOrder(deps:CheckoutDeps,order:Order){return cancelOrderInternal(deps,order,{reason:"payment_expired",actorType:"system"});}
/** Varredura periódica: pedidos aguardando pagamento além do prazo devolvem o estoque. */
export async function expireAwaitingOrders(deps:CheckoutDeps,limit=50){
 let expired=0;
 for(const order of await deps.orders.listExpiring({now:now(deps).toISOString(),limit})){
  // Antes de expirar, confere no provedor real: se pagou no último minuto, conta como pago.
  const payment=(await deps.orders.payments(order.id)).at(-1);
  if(payment?.provider==="MERCADO_PAGO"&&payment.providerPaymentId&&payment.status==="PENDING"){
   const {provider,credentials}=await paymentProviderFor(deps,{tenantId:order.tenantId,id:order.siteId??""},payment.provider).catch(()=>({provider:undefined,credentials:undefined}));
   const state=provider?await provider.getPayment(providerContext(order,credentials),payment.providerPaymentId).catch(()=>undefined):undefined;
   if(state?.status==="APPROVED"){await applyPaymentState(deps,payment,state,{eventKey:`sweep:${payment.id}:APPROVED`,actor:"provider"});continue;}
  }
  if(await expireOrder(deps,order))expired++;
 }
 return {expired};
}

// ------------------------------------------------------------------ administração (Central de pedidos)
export type OrderAdminScope={tenantId:string;workspaceId:string;actorUserId:string};
async function mustOrder(deps:CheckoutDeps,scope:OrderAdminScope,id:string){const order=await deps.orders.get(id);if(!order||order.tenantId!==scope.tenantId||order.workspaceId!==scope.workspaceId)throw Error("SITE_NOT_FOUND: pedido não encontrado.");return order;}
export async function listOrders(deps:CheckoutDeps,scope:OrderAdminScope,filter:Omit<Parameters<CommerceOrderRepositoryPort["list"]>[0],"tenantId"|"workspaceId">){return deps.orders.list({...filter,tenantId:scope.tenantId,workspaceId:scope.workspaceId});}
export async function getOrderDetail(deps:CheckoutDeps,scope:OrderAdminScope,id:string){
 const order=await mustOrder(deps,scope,id);
 const payments=(await deps.orders.payments(id)).map(payment=>({...payment,instructions:{sandbox:payment.instructions.sandbox,expiresAt:payment.instructions.expiresAt}}));
 return {order:{...order,items:order.items.map(item=>({...item,imageUrl:item.imageUrl?signOwnedUrl(item.imageUrl,OBJECT_URL_TTL.preview):undefined}))},payments,events:await deps.orders.events(id)};
}
export async function advanceOrder(deps:CheckoutDeps,scope:OrderAdminScope,input:{id:string;to:OrderStatus;trackingCode?:string}){
 const order=await mustOrder(deps,scope,input.id);
 if(input.to==="CANCELLED")throw Error("SITE_VALIDATION: use a ação de cancelar pedido.");
 if(input.to==="PAID")throw Error("SITE_VALIDATION: o pagamento é confirmado pelo provedor.");
 assertOrderTransition(order.status,input.to);
 const pickup=order.delivery.kind==="PICKUP";
 if(input.to==="SHIPPED"&&pickup)throw Error("SITE_VALIDATION: pedido para retirada não é enviado — marque como entregue quando o cliente retirar.");
 const shippingStatus=input.to==="PROCESSING"&&pickup?"READY_FOR_PICKUP":input.to==="SHIPPED"?"SHIPPED":input.to==="DELIVERED"?"DELIVERED":undefined;
 const updated=await deps.orders.update(order.id,{status:input.to,...(shippingStatus?{shippingStatus}:{})},{type:"status_changed",fromStatus:order.status,toStatus:input.to,actorType:"user",actorId:scope.actorUserId,data:{...(input.trackingCode?{trackingCode:input.trackingCode.slice(0,80)}:{})}},{statuses:[order.status]});
 if(!updated)throw Error("SITE_VALIDATION: o pedido mudou enquanto você editava. Atualize a tela.");
 if(input.to==="DELIVERED")emit(deps,{...orderEvent(order),type:"ORDER_COMPLETED"});
 return updated;
}
export async function cancelOrder(deps:CheckoutDeps,scope:OrderAdminScope,input:{id:string;reason?:string;restock?:boolean}){
 const order=await mustOrder(deps,scope,input.id);
 if(!CANCELLABLE_STATUSES.includes(order.status))throw Error(`SITE_VALIDATION: pedido ${ORDER_STATUS_LABELS[order.status].toLowerCase()} não pode ser cancelado aqui.`);
 const updated=await cancelOrderInternal(deps,order,{reason:input.reason?.trim().slice(0,200)||"cancelled_by_store",actorType:"user",actorId:scope.actorUserId,restock:input.restock});
 if(!updated)throw Error("SITE_VALIDATION: o pedido mudou enquanto você editava. Atualize a tela.");
 return updated;
}
/** Modo de teste: o lojista simula a resposta do provedor (mesmo caminho do webhook real). */
export async function simulateSandboxPayment(deps:CheckoutDeps,scope:OrderAdminScope,input:{id:string;outcome:"APPROVED"|"FAILED"}){
 const order=await mustOrder(deps,scope,input.id);
 const payment=(await deps.orders.payments(order.id)).at(-1);
 if(!payment||payment.provider!=="SANDBOX")throw Error("SITE_VALIDATION: simulação disponível só para pedidos em modo de teste.");
 if(!sandboxAllowedFor(deps,order.tenantId))throw Error("SITE_VALIDATION: modo de teste desligado neste ambiente.");
 return applyPaymentState(deps,payment,{providerPaymentId:payment.providerPaymentId??payment.id,status:input.outcome},{eventKey:`sandbox:${payment.id}:${input.outcome}`,actor:"user",actorId:scope.actorUserId});
}
