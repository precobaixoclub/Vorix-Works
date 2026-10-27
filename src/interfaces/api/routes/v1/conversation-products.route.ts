import type {FastifyInstance,FastifyRequest} from "fastify";
import {z} from "zod";
import {requirePermission} from "../../http/require-principal.js";
import {AppError,NotFoundError,ValidationError,ForbiddenError} from "../../http/app-error.js";
import {successEnvelope} from "../../http/response-envelope.js";
import {resolveConversationVisibility,type InboxRoutesDeps} from "./inbox.route.js";
import {isConversationVisible} from "../../../../application/ports/inbox-conversation-repository.port.js";
import {addProductToConversationOpportunity,searchConversationProducts,sendProductToConversation,type ConversationProductDeps} from "../../../../application/commercial-bridge/conversation-product-use-cases.js";
import type {Permission} from "../../../../domain/identity/identity.model.js";
export type ConversationProductRouteDeps=ConversationProductDeps&{routes:Pick<InboxRoutesDeps,"teamMembershipRepository">&Partial<InboxRoutesDeps>};
const id=z.string().min(1).max(160);
/** Produto dentro do Vorix Conversas: buscar no catálogo, enviar ao cliente e levar para a oportunidade. */
export async function registerConversationProductRoutes(app:FastifyInstance,deps:ConversationProductRouteDeps):Promise<void>{
 const guard=async<T>(run:()=>Promise<T>)=>{try{return await run();}catch(error){
  if(error instanceof z.ZodError)throw new ValidationError(error.issues.map(issue=>issue.message).join(" "));
  if(error instanceof Error){
   if(/^(CONVERSATION_PRODUCT_NOT_FOUND|DEAL_NOT_FOUND)/.test(error.message))throw new NotFoundError();
   if(error.message.startsWith("CONVERSATION_PRODUCT_FORBIDDEN"))throw new ForbiddenError(error.message.replace(/^[A-Z_]+:\s*/,""));
   if(/^(DEAL_ITEM_INVALID|DEAL_NOT_OPEN|PRODUCT_INACTIVE|PRODUCT_VARIANT_REQUIRED|CONVERSATION_PRODUCT_UNAVAILABLE)/.test(error.message))throw new ValidationError(error.message.replace(/^[A-Z_]+:\s*/,""));
  }
  throw error;
 }};
 /** Mesmo escopo das rotas de conversa: fora dele é 404. */
 const visible=async(request:FastifyRequest,permissions:Permission[])=>{
  let principal=requirePermission(request,permissions[0]);for(const permission of permissions.slice(1))principal=requirePermission(request,permission);
  const conversationId=id.parse((request.params as {id?:string}).id);
  const workspaceId=id.parse((request.method==="GET"?request.query as {workspaceId?:string}:request.body as {workspaceId?:string})?.workspaceId);
  const conversation=await deps.inbox.conversationRepository.getById(conversationId);
  const visibility=await resolveConversationVisibility(deps.routes,principal);
  if(!conversation||conversation.tenantId!==principal.tenantId||conversation.workspaceId!==workspaceId||(visibility&&!isConversationVisible(conversation,visibility)))throw new AppError({code:"INBOX_CONVERSATION_NOT_FOUND",message:"Conversa não encontrada.",statusCode:404,recoverable:true});
  return {principal,conversationId,workspaceId};
 };
 app.get("/inbox/conversations/:id/products",async request=>guard(async()=>{
  const {principal,workspaceId}=await visible(request,["inbox:read","product:read"]);
  const {search}=z.object({search:z.string().max(120).optional()}).parse({search:(request.query as {search?:string}).search});
  return successEnvelope(await searchConversationProducts(deps,{tenantId:principal.tenantId,workspaceId,search}),request.id);
 }));
 app.post("/inbox/conversations/:id/products/send",{config:{readOnlyGuard:true}},async(request,reply)=>guard(async()=>{
  const {principal,conversationId,workspaceId}=await visible(request,["inbox:reply","product:read"]);
  const body=z.object({workspaceId:id,productId:id,variantId:id.optional(),withImage:z.boolean().default(true)}).strict().parse(request.body);
  const message=await sendProductToConversation(deps,{tenantId:principal.tenantId,workspaceId,conversationId,userId:principal.userId,productId:body.productId,variantId:body.variantId,withImage:body.withImage});
  reply.status(202);return successEnvelope(message,request.id);
 }));
 app.post("/inbox/conversations/:id/products/opportunity",{config:{readOnlyGuard:true}},async request=>guard(async()=>{
  const {principal,conversationId,workspaceId}=await visible(request,["inbox:reply","deal:manage"]);
  const body=z.object({workspaceId:id,productId:id,variantId:id.optional(),quantity:z.number().positive().max(100000).default(1),dealId:id.optional(),createIfMissing:z.boolean().optional()}).strict().parse(request.body);
  return successEnvelope(await addProductToConversationOpportunity(deps,{tenantId:principal.tenantId,userId:principal.userId,role:principal.role,permissions:principal.permissions,permissionRevokes:principal.permissionRevokes},{...body,workspaceId,conversationId}),request.id);
 }));
}
