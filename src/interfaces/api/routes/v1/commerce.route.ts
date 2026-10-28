import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {requirePermission} from "../../http/require-principal.js";
import {NotFoundError,ValidationError,ForbiddenError} from "../../http/app-error.js";
import {successEnvelope} from "../../http/response-envelope.js";
import {assertWorkspaceBelongsToTenant} from "./workspace-ownership.js";
import {mustSite} from "../../../../application/sites/site-use-cases.js";
import {sandboxAllowedFor,advanceOrder,cancelOrder,commerceCredentialStatus,COMMERCE_CREDENTIAL_PROVIDERS,expireAwaitingOrders,getOrderDetail,getPublicOrder,handlePaymentWebhook,listOrders,placeOrder,quoteCheckout,saveCommerceCredential,siteCheckoutStatus,simulateSandboxPayment,type CheckoutDeps} from "../../../../application/commerce/checkout-use-cases.js";
import {getSiteCommerceSettings} from "../../../../application/sites/site-commerce-use-cases.js";
import {ORDER_STATUSES} from "../../../../domain/commerce/order.model.js";
import {utmSchema} from "../../../../domain/sites/site-commerce.js";
import type {WorkspaceRepositoryPort} from "../../../../application/ports/workspace-repository.port.js";
import {hasPermission,type Permission} from "../../../../domain/identity/identity.model.js";
import {commerceVisibility,orderInScope} from "../../../../application/commerce/commerce-scope.js";
import {receiveReturn,refundReturn,requestReturn,transitionReturn} from "../../../../application/commerce/returns-use-cases.js";
import {MarketplaceError} from "../../../../domain/marketplaces/marketplace.model.js";
import type {MarketplaceService} from "../../../../application/marketplaces/marketplace-service.js";
import type {TeamMembershipRepositoryPort} from "../../../../application/ports/team-repository.port.js";
import type {Order} from "../../../../domain/commerce/order.model.js";
export type CommerceRouteDeps=CheckoutDeps&{workspaceRepository:WorkspaceRepositoryPort;expirationIntervalMs?:number;
 /** Pedidos de marketplace: cancelar/etiqueta/atualizar no canal. Ausente = só pedidos do Site. */
 marketplace?:MarketplaceService;
 /** Escopo por equipe para ações sensíveis (cancelar/estornar) e Vendas por canal. */
 access?:{teamMembershipRepository:TeamMembershipRepositoryPort};
 deals?:{getById(id:string):Promise<{ownerUserId?:string;teamId?:string}|undefined>}};
const id=z.string().min(1).max(160);
const slugParam=z.object({slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80)});
const visitor={sessionId:z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),pageUrl:z.string().max(2000).optional(),utm:utmSchema.optional()};
const cartToken=z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);
const MARKETPLACE_MESSAGES:Record<string,string>={
 BLOCKED_EXTERNAL_CAPABILITY:"O canal não permite esta operação pela API oficial — faça no painel do marketplace.",
 MARKETPLACE_ORDER_ALREADY_SHIPPED:"O pedido já saiu para entrega no canal: use devolução.",
 ML_LABEL_NOT_AVAILABLE:"A etiqueta ainda não está disponível no Mercado Livre (envio precisa estar pronto para despachar).",
 SHOPEE_LABEL_NOT_AVAILABLE:"A etiqueta ainda não está disponível na Shopee.",TIKTOK_LABEL_NOT_AVAILABLE:"A etiqueta ainda não está disponível no TikTok Shop.",
 SHOPEE_ORDER_NOT_CANCELLABLE:"A Shopee não permite cancelar este pedido no status atual.",TIKTOK_ORDER_NOT_CANCELLABLE:"O TikTok Shop não permite cancelar este pedido agora.",
 SHOPEE_CANCEL_REASON_UNSUPPORTED:"Escolha um dos motivos aceitos pela Shopee.",TIKTOK_CANCEL_REASON_CODE_REQUIRED:"Escolha um dos motivos aceitos pelo TikTok Shop.",TIKTOK_CANCEL_REASON_NOT_AVAILABLE:"Este motivo não é mais aceito pelo TikTok Shop para o pedido. Abra o cancelamento de novo.",
 REAUTH_REQUIRED:"A conta do marketplace precisa ser reconectada.",MARKETPLACE_DISCONNECTED:"A conta do marketplace está desconectada.",MARKETPLACE_PROVIDER_NOT_CONFIGURED:"Este canal não está configurado neste ambiente.",
};
/** Vorix Commerce, Fase 2 — checkout público, webhook de pagamento e central de pedidos. */
export async function registerCommerceRoutes(app:FastifyInstance,deps:CommerceRouteDeps):Promise<void>{
 const guard=async<T>(run:()=>Promise<T>)=>{try{return await run();}catch(error){
  if(error instanceof z.ZodError)throw new ValidationError(error.issues.map(issue=>issue.message).join(" "));
  if(error instanceof MarketplaceError){
   if(error.code==="MARKETPLACE_ORDER_NOT_FOUND"||error.code==="MARKETPLACE_CONNECTION_NOT_FOUND")throw new NotFoundError();
   throw new ValidationError(MARKETPLACE_MESSAGES[error.code]??"O canal recusou a operação agora. Tente novamente em instantes.");
  }
  if(error instanceof Error){
   if(error.message.startsWith("SITE_NOT_FOUND"))throw new NotFoundError();
   if(/^(SITE_VALIDATION|ORDER_TRANSITION_INVALID|PAYMENT_VALIDATION|ORDER_RETURN_VALIDATION)/.test(error.message))throw new ValidationError(error.message.replace(/^[A-Z_]+:\s*/,""));
   if(error.message.startsWith("SITE_ENTITLEMENT"))throw new ForbiddenError(error.message);
  }
  throw error;
 }};
 const lookup=(request:FastifyRequest)=>({slug:slugParam.parse(request.params).slug});
 // Checkout público --------------------------------------------------------------------------
 app.post("/public/sites/:slug/checkout/quote",async request=>guard(async()=>{
  const body=z.object({token:cartToken,postalCode:z.string().max(12).optional(),...visitor}).strict().parse(request.body);
  return successEnvelope(await quoteCheckout(deps,{...body,lookup:lookup(request)}),request.id);
 }));
 app.post("/public/sites/:slug/checkout/orders",async request=>guard(async()=>{
  const body=z.object({token:cartToken,requestKey:z.string().uuid(),customer:z.unknown(),address:z.unknown().optional(),deliveryOptionId:z.string().min(1).max(80),
   payment:z.object({method:z.enum(["PIX","CARD","SANDBOX"]),cardToken:z.string().max(200).optional(),cardPaymentMethodId:z.string().max(40).optional(),installments:z.number().int().min(1).max(24).optional()}).strict(),...visitor}).strict().parse(request.body);
  return successEnvelope(await placeOrder(deps,{...body,lookup:lookup(request)}),request.id);
 }));
 app.get("/public/orders/:token",async request=>guard(async()=>{
  const {token}=z.object({token:z.string().max(80)}).parse(request.params);
  return successEnvelope(await getPublicOrder(deps,{publicToken:token}),request.id);
 }));
 // Webhook do Mercado Pago (conta do lojista). O corpo só diz "olhe o pagamento X"; a verdade vem da API.
 app.post("/webhooks/commerce/mercado-pago/:siteId",async(request,reply)=>guard(async()=>{
  const {siteId}=z.object({siteId:id}).parse(request.params);
  const body=(request.body??{}) as {type?:string;action?:string;data?:{id?:string|number}};const query=request.query as {"data.id"?:string;type?:string;topic?:string;id?:string};
  const paymentId=String(body.data?.id??query["data.id"]??(query.topic==="payment"?query.id:"")??"");
  if((body.type??query.type??query.topic)==="payment"&&/^\d{1,30}$/.test(paymentId))await handlePaymentWebhook(deps,{provider:"MERCADO_PAGO",siteId,providerPaymentId:paymentId}).catch(error=>request.log.error({err:error,siteId},"ConversionError: webhook de pagamento"));
  reply.code(200);return {ok:true};
 }));
 // Administração --------------------------------------------------------------------------------
 const scoped=async(request:FastifyRequest,permission:Permission)=>{
  const principal=requirePermission(request,permission);
  const workspaceId=id.parse((request.method==="GET"?(request.query as {workspaceId?:string}):(request.query as {workspaceId?:string}))?.workspaceId);
  await assertWorkspaceBelongsToTenant(deps.workspaceRepository,{tenantId:principal.tenantId,workspaceId});
  if(!await deps.hasAccess(principal.tenantId))throw new ForbiddenError("Vorix Site não está habilitado nesta conta.");
  return {tenantId:principal.tenantId,workspaceId,actorUserId:principal.userId};
 };
 app.get("/commerce/orders",async request=>guard(async()=>{
  const scope=await scoped(request,"order:read");
  const query=z.object({status:z.enum(ORDER_STATUSES).optional(),paymentStatus:z.enum(["PENDING","APPROVED","FAILED","CANCELLED","REFUNDED"]).optional(),shippingStatus:z.enum(["NOT_REQUIRED","PENDING","READY_FOR_PICKUP","SHIPPED","DELIVERED","CANCELLED"]).optional(),source:z.enum(["SITE","MERCADO_LIVRE","SHOPEE","TIKTOK_SHOP","MANUAL"]).optional(),search:z.string().max(120).optional(),from:z.iso.datetime().optional(),to:z.iso.datetime().optional(),limit:z.coerce.number().int().min(1).max(200).default(25),offset:z.coerce.number().int().min(0).default(0),workspaceId:z.string()}).parse(request.query);
  const {workspaceId:_workspaceId,...filter}=query;
  return successEnvelope(await listOrders(deps,scope,filter),request.id);
 }));
 const scopedOrder=async(_request:FastifyRequest,scope:{tenantId:string;workspaceId:string},orderId:string):Promise<Order>=>{
  const order=await deps.orders.get(id.parse(orderId));if(!order||order.tenantId!==scope.tenantId||order.workspaceId!==scope.workspaceId)throw new NotFoundError();return order;
 };
 const visibility=async(request:FastifyRequest)=>{
  const principal=requirePermission(request,"order:read");
  return deps.access?commerceVisibility(deps.access,{...principal,isAccountOwner:(principal as {isAccountOwner?:boolean}).isAccountOwner??false}):{global:hasPermission(principal,"deal:view_all"),teamIds:[],ownerUserIds:[principal.userId]};
 };
 /** O que esta pessoa pode fazer neste pedido (a interface só mostra o permitido; as rotas conferem de novo). */
 const orderActions=async(request:FastifyRequest,order:Order)=>{
  const principal=requirePermission(request,"order:read"),can=(permission:Permission)=>hasPermission(principal,permission);
  const inScope=await orderInScope(await visibility(request),order,{siteTeamId:async siteId=>(await deps.commerceRepository.getSettings(siteId))?.teamId,deal:async dealId=>deps.deals?.getById(dealId)});
  const capabilities=order.source==="SITE"?undefined:deps.marketplace?.configuredProviders().find(p=>p.id===order.source)?.capabilities;
  const paid=["APPROVED","PARTIALLY_REFUNDED"].includes(order.paymentStatus);
  let cancelBlockedReason:string|undefined;
  if(!can("order:cancel"))cancelBlockedReason="Cancelar pedidos exige a permissão “Cancelar pedidos”.";
  else if(!inScope)cancelBlockedReason="Pedido fora das suas equipes.";
  else if(order.source==="SITE"&&paid&&!can("payment:refund"))cancelBlockedReason="Este pedido está pago: cancelar estorna o cliente e exige a permissão “Estornar pagamentos”.";
  else if(order.source==="SITE"&&!["PENDING","AWAITING_PAYMENT","PAID","CONFIRMED","PROCESSING"].includes(order.status))cancelBlockedReason="Pedido já enviado/encerrado: use devolução.";
  else if(order.source!=="SITE"&&!capabilities)cancelBlockedReason="Canal não configurado neste ambiente.";
  else if(order.source!=="SITE"&&capabilities?.cancelOrder!=="SUPPORTED")cancelBlockedReason="O canal não permite cancelar pela API oficial — cancele no painel do marketplace.";
  else if(order.source!=="SITE"&&["SHIPPED","DELIVERED","CANCELLED"].includes(order.status))cancelBlockedReason="Pedido já enviado/encerrado no canal: use devolução.";
  const payment=(await deps.orders.payments(order.id)).find(p=>p.status==="APPROVED"||p.status==="REFUNDED");
  return {canCancel:!cancelBlockedReason,cancelBlockedReason,
   canRefund:order.source==="SITE"&&can("payment:refund")&&inScope&&!!payment&&payment.refundedCents<payment.amountCents,
   partialRefund:!!payment&&!!deps.paymentProviders[payment.provider as "SANDBOX"|"MERCADO_PAGO"]?.partialRefund,
   canLabel:order.source!=="SITE"&&capabilities?.labels==="SUPPORTED"&&can("order:manage"),
   canManageReturns:can("order:manage"),canRefresh:order.source!=="SITE"&&!!capabilities&&can("order:manage")};
 };
 app.get("/commerce/orders/:id",async request=>guard(async()=>{
  const scope=await scoped(request,"order:read");const detail=await getOrderDetail(deps,scope,(request.params as {id:string}).id);
  return successEnvelope({...detail,shipments:await deps.orders.shipments(detail.order.id),returns:await deps.orders.returns(detail.order.id),actions:await orderActions(request,detail.order as Order)},request.id);
 }));
 // Pedidos de marketplace: o canal é a autoridade de logística (etiqueta e status vêm dele).
 const marketplaceOrder=async(request:FastifyRequest,permission:Permission)=>{
  const scope=await scoped(request,permission);const order=await scopedOrder(request,scope,(request.params as {id:string}).id);
  if(order.source==="SITE"||!deps.marketplace)throw new ValidationError("Disponível só para pedidos de marketplace com o canal configurado.");
  return {order,actor:{tenantId:scope.tenantId,workspaceId:scope.workspaceId,userId:scope.actorUserId}};
 };
 app.get("/commerce/orders/:id/label",async request=>guard(async()=>{const {order,actor}=await marketplaceOrder(request,"order:manage");return successEnvelope(await deps.marketplace!.shippingLabel(actor,order.id),request.id);}));
 // Motivos oficiais aceitos pelo canal agora (Shopee: enum fixo; TikTok: elegibilidade do pedido). Exige poder cancelar.
 app.get("/commerce/orders/:id/cancel-reasons",async request=>guard(async()=>{const {order,actor}=await marketplaceOrder(request,"order:cancel");return successEnvelope({reasons:await deps.marketplace!.cancelReasons(actor,order.id)},request.id);}));
 app.post("/commerce/orders/:id/refresh",{config:{readOnlyGuard:true}},async request=>guard(async()=>{const {order,actor}=await marketplaceOrder(request,"order:manage");return successEnvelope(await deps.marketplace!.refreshExternalOrder(actor,order.id),request.id);}));
 // Devoluções (parciais) ---------------------------------------------------------------------------
 const returnItems=z.array(z.object({orderItemId:id,quantity:z.number().int().min(1).max(100000)}).strict()).min(1).max(200);
 app.post("/commerce/orders/:id/returns",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"order:manage");const body=z.object({requestKey:z.string().uuid(),reason:z.string().max(300).optional(),items:returnItems}).strict().parse(request.body);
  return successEnvelope(await requestReturn(deps,scope,{orderId:(request.params as {id:string}).id,...body}),request.id);
 }));
 app.post("/commerce/returns/:id/status",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"order:manage");const body=z.object({to:z.enum(["APPROVED","IN_TRANSIT","REJECTED","CANCELLED","COMPLETED"])}).strict().parse(request.body);
  return successEnvelope(await transitionReturn(deps,scope,{returnId:id.parse((request.params as {id:string}).id),...body}),request.id);
 }));
 app.post("/commerce/returns/:id/receive",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"order:manage");
  const body=z.object({items:z.array(z.object({orderItemId:id,receivedQuantity:z.number().int().min(0).max(100000),restockQuantity:z.number().int().min(0).max(100000)}).strict()).min(1).max(200)}).strict().parse(request.body);
  return successEnvelope(await receiveReturn(deps,scope,{returnId:id.parse((request.params as {id:string}).id),...body}),request.id);
 }));
 app.post("/commerce/returns/:id/refund",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"payment:refund");const body=z.object({amountCents:z.number().int().min(1).optional()}).strict().parse(request.body??{});
  const ret=await deps.orders.getReturn(id.parse((request.params as {id:string}).id));if(!ret||ret.tenantId!==scope.tenantId||ret.workspaceId!==scope.workspaceId)throw new NotFoundError();
  const order=await scopedOrder(request,scope,ret.orderId);
  if(!(await orderActions(request,order)).canRefund)throw new ForbiddenError("Sem permissão para estornar este pedido (permissão ou equipe).");
  return successEnvelope(await refundReturn(deps,scope,{returnId:ret.id,...body}),request.id);
 }));
 // Vendas por canal (pedidos; a oportunidade ganha da mesma venda não conta de novo) --------------
 app.get("/commerce/analytics/channels",async request=>guard(async()=>{
  const scope=await scoped(request,"order:read");requirePermission(request,"analytics:read");
  const q=z.object({from:z.iso.datetime(),to:z.iso.datetime()}).parse(request.query);
  const vis=await visibility(request);
  const channels=await deps.orders.channelSummary({tenantId:scope.tenantId,workspaceId:scope.workspaceId,from:q.from,to:q.to,global:vis.global,teamIds:vis.teamIds,ownerUserIds:vis.ownerUserIds});
  const sum=(key:"orders"|"sales"|"revenueCents"|"refundsCents"|"cancellations"|"returns")=>channels.reduce((total,c)=>total+c[key],0);
  const gross=channels.reduce((total,c)=>total+c.averageTicketCents*c.sales,0);
  return successEnvelope({channels,totals:{orders:sum("orders"),sales:sum("sales"),revenueCents:sum("revenueCents"),refundsCents:sum("refundsCents"),averageTicketCents:sum("sales")?Math.round(gross/sum("sales")):0,cancellations:sum("cancellations"),returns:sum("returns")}},request.id);
 }));

 app.post("/commerce/orders/:id/status",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"order:manage");const body=z.object({to:z.enum(ORDER_STATUSES),trackingCode:z.string().trim().max(80).optional()}).strict().parse(request.body);
  return successEnvelope(await advanceOrder(deps,scope,{id:(request.params as {id:string}).id,...body}),request.id);
 }));
 app.post("/commerce/orders/:id/cancel",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"order:cancel");const body=z.object({reason:z.string().max(200).optional(),restock:z.boolean().optional()}).strict().parse(request.body??{});
  const order=await scopedOrder(request,scope,(request.params as {id:string}).id);
  const actions=await orderActions(request,order);if(!actions.canCancel)throw new ForbiddenError(actions.cancelBlockedReason??"Sem permissão para cancelar este pedido.");
  if(order.source!=="SITE")return successEnvelope(await deps.marketplace!.cancelExternalOrder({tenantId:scope.tenantId,workspaceId:scope.workspaceId,userId:scope.actorUserId},order.id,body.reason?.trim()||"cancelled_by_store"),request.id);
  return successEnvelope(await cancelOrder(deps,scope,{id:order.id,...body}),request.id);
 }));
 app.post("/commerce/orders/:id/sandbox-payment",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const scope=await scoped(request,"order:manage");const body=z.object({outcome:z.enum(["APPROVED","FAILED"])}).strict().parse(request.body);
  return successEnvelope(await simulateSandboxPayment(deps,scope,{id:(request.params as {id:string}).id,...body}),request.id);
 }));
 const ownedSite=async(request:FastifyRequest,permission:Permission)=>{const scope=await scoped(request,permission);return {scope,site:await mustSite(deps,{id:(request.params as {id:string}).id,tenantId:scope.tenantId,workspaceId:scope.workspaceId})};};
 app.get("/sites/:id/commerce/checkout-status",async request=>guard(async()=>{
  const {site}=await ownedSite(request,"site:read");const {settings}=await getSiteCommerceSettings(deps,site);
  return successEnvelope({...await siteCheckoutStatus(deps,site,settings),credentials:await commerceCredentialStatus(deps,site),sandboxAllowed:sandboxAllowedFor(deps,site.tenantId)},request.id);
 }));
 app.put("/sites/:id/commerce/credentials/:provider",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const {site}=await ownedSite(request,"commerce:manage");const {provider}=z.object({provider:z.enum(COMMERCE_CREDENTIAL_PROVIDERS)}).parse({provider:(request.params as {provider:string}).provider});
  const body=z.object({accessToken:z.string().trim().min(10).max(500).optional(),publicKey:z.string().trim().min(10).max(200).optional()}).strict().parse(request.body??{});
  return successEnvelope(await saveCommerceCredential(deps,site,provider,body),request.id);
 }));
 // Reservas vencidas voltam ao estoque mesmo sem ninguém abrir o pedido.
 if(deps.expirationIntervalMs){
  const timer=setInterval(()=>{expireAwaitingOrders(deps).then(result=>{if(result.expired)app.log.info({expired:result.expired},"commerce: pedidos expirados");}).catch(error=>app.log.error({err:error},"commerce: falha ao expirar pedidos"));},deps.expirationIntervalMs);
  timer.unref();app.addHook("onClose",async()=>clearInterval(timer));
 }
}
