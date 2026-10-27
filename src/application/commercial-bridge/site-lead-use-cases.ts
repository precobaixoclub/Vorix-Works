/**
 * Vorix Commerce, Fase 1 — ponte Site → Atendimento → CRM.
 *
 * Fica fora de `application/inbox` e `application/crm` (mesmo motivo da ponte Inbox→CRM: os dois
 * contextos não se importam). Regra central: clique não cria nada no CRM. Só uma interação real
 * (mensagem recebida com a referência, ou formulário enviado) vira contato/atendimento/oportunidade.
 */
import type {SiteCommerceRepositoryPort} from "../ports/site-commerce-repository.port.js";
import type {SiteRepositoryPort} from "../ports/site-repository.port.js";
import type {TeamMembershipRepositoryPort} from "../ports/team-repository.port.js";
import type {DealUseCaseDeps} from "../crm/deal-use-cases.js";
import {createDeal} from "../crm/deal-use-cases.js";
import {ensureDefaultPipeline,type PipelineUseCaseDeps} from "../crm/pipeline-use-cases.js";
import {addDealItem} from "../sales/deal-commercial-use-cases.js";
import type {SalesEngineDeps} from "../sales/sales-context.js";
import {notifyBestEffort,type NotificationUseCaseDeps} from "../notification/notification-use-cases.js";
import {routeUnassignedConversationToTeam,type InboxUseCaseDeps} from "../inbox/inbox-use-cases.js";
import {ensureOpenAttendanceSafely} from "../inbox/attendance-tracking.js";
import {resolveNextTeamMember} from "../identity/team-use-cases.js";
import {ensureCrmContactForInboxContact,type InboxCrmBridgeDeps} from "./inbox-crm-bridge-use-cases.js";
import {defaultSiteCommerceSettings,extractSalesIntentReference,SALES_INTENT_TTL_MS,newSalesIntentReference,type SalesIntent,type SiteCommerceSettings} from "../../domain/sites/site-commerce.js";
import type {InboxContact,InboxConversation} from "../../domain/inbox/inbox.model.js";
import {INBOX_SYSTEM_ACTOR,normalizePhoneNumber} from "../../domain/inbox/inbox.model.js";


export const SITE_LEAD_ORIGIN="site";
const STALE_CLAIM_MS=5*60*1000;
export type SiteLeadDeps={
 commerceRepository:SiteCommerceRepositoryPort;
 siteRepository:Pick<SiteRepositoryPort,"get">;
 crm:PipelineUseCaseDeps&DealUseCaseDeps;
 sales:SalesEngineDeps;
 teamMembershipRepository?:TeamMembershipRepositoryPort;
 notification?:Partial<NotificationUseCaseDeps>;
 /** Presentes no worker (WhatsApp) e na API (formulário com "abrir atendimento"). */
 inbox?:InboxUseCaseDeps;
 crmBridge?:InboxCrmBridgeDeps;
 now?:()=>Date;
 log?:(event:string,data:Record<string,unknown>)=>void;
};
const systemActor=(tenantId:string)=>({tenantId,userId:INBOX_SYSTEM_ACTOR,role:"owner" as const});
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);

async function settingsFor(deps:SiteLeadDeps,siteId:string):Promise<SiteCommerceSettings>{
 const saved=await deps.commerceRepository.getSettings(siteId);if(saved)return saved;
 const site=await deps.siteRepository.get(siteId);return defaultSiteCommerceSettings(!!(site?.published??site?.draft)?.content.whatsapp);
}
function dealTitle(intent:Pick<SalesIntent,"snapshot"|"type">){
 const items=intent.snapshot.items;const first=items[0];
 if(!first)return "Interesse pelo site";
 const label=`${first.name}${first.variantLabel?` (${first.variantLabel})`:""}`;
 return (items.length>1?`Site: ${label} + ${items.length-1} item(ns)`:`Site: ${label}`).slice(0,200);
}
/** Cria a oportunidade já com os itens da intenção (preço que o visitante viu). Idempotente via `intent.dealId`. */
async function ensureOpportunity(deps:SiteLeadDeps,intent:SalesIntent,input:{contactId?:string;ownerUserId?:string;teamId?:string}):Promise<string>{
 if(intent.dealId)return intent.dealId;
 const {pipeline,stages}=await ensureDefaultPipeline(deps.crm,intent.tenantId,intent.workspaceId);
 const stage=[...stages].filter(item=>!item.isWon&&!item.isLost).sort((a,b)=>a.position-b.position)[0];
 if(!stage)throw Error("SITE_LEAD_NO_STAGE: o funil padrão não tem etapa em andamento.");
 const deal=await createDeal(deps.crm,{tenantId:intent.tenantId,workspaceId:intent.workspaceId,pipelineId:pipeline.id,stageId:stage.id,contactId:input.contactId,title:dealTitle(intent),valueCents:0,currency:intent.snapshot.currency||"BRL",ownerUserId:input.ownerUserId,teamId:input.teamId,origin:SITE_LEAD_ORIGIN});
 // Grava o vínculo antes dos itens: numa retomada, a oportunidade nunca é criada duas vezes.
 await deps.commerceRepository.updateIntentLinks(intent.id,{dealId:deal.id});
 for(const item of intent.snapshot.items){
  try{await addDealItem(deps.sales,systemActor(intent.tenantId),{workspaceId:intent.workspaceId,dealId:deal.id,productId:item.productId,variantId:item.variantId,quantity:item.quantity,proposedUnitPriceCents:item.unitPriceCents});}
  catch(error){
   // Produto mudou/desativou desde o clique: preserva o item como avulso com o preço visto.
   deps.log?.("site_lead_item_fallback",{intentId:intent.id,productId:item.productId,error:errorText(error)});
   await addDealItem(deps.sales,systemActor(intent.tenantId),{workspaceId:intent.workspaceId,dealId:deal.id,name:`${item.name}${item.variantLabel?` (${item.variantLabel})`:""}`,listPriceCents:item.unitPriceCents,quantity:item.quantity});
  }
 }
 return deal.id;
}
async function notifyLead(deps:SiteLeadDeps,input:{intent:SalesIntent;settings:SiteCommerceSettings;customer:string;assigneeUserId?:string;conversationId?:string;dealId?:string}){
 if(!deps.notification?.notificationRepository||!input.settings.notifyTeam)return;
 const recipients=new Set<string>();
 if(input.assigneeUserId)recipients.add(input.assigneeUserId);
 else if(input.settings.teamId&&deps.teamMembershipRepository)for(const member of await deps.teamMembershipRepository.listByTeam(input.settings.teamId).catch(()=>[]))recipients.add(member.userId);
 const items=input.intent.snapshot.items;
 const what=items.length>1?`carrinho com ${items.length} itens`:items[0]?`${items[0].name}${items[0].variantLabel?` (${items[0].variantLabel})`:""}`:"contato pelo formulário";
 const sourceUrl=input.conversationId?`/workspaces/${input.intent.workspaceId}/conversas?conversation=${input.conversationId}`:input.dealId?`/workspaces/${input.intent.workspaceId}/crm/oportunidades?deal=${input.dealId}`:undefined;
 for(const userId of recipients)notifyBestEffort(deps.notification,{tenantId:input.intent.tenantId,workspaceId:input.intent.workspaceId,userId,title:"Novo interesse recebido pelo site",body:`${input.customer} · ${what} · origem: Site${input.assigneeUserId?"":" · aguardando responsável"}`,sourceType:"site_lead",sourceId:input.intent.id,sourceUrl});
}

export type SalesIntentConversionResult={status:"converted"|"already_converted"|"ignored";reason?:string;intentId?:string;dealId?:string;assignedUserId?:string};
/**
 * Mensagem recebida no WhatsApp com `Ref: VX-XXXXXX`. Idempotente: reentrega do webhook, duas
 * mensagens com a mesma referência ou retomada após falha nunca criam um segundo contato,
 * atendimento ou oportunidade.
 */
export async function convertSalesIntentFromInbound(deps:SiteLeadDeps,input:{tenantId:string;workspaceId:string;conversation:InboxConversation;inboxContact?:InboxContact;messageBody?:string}):Promise<SalesIntentConversionResult>{
 const reference=extractSalesIntentReference(input.messageBody);
 if(!reference)return {status:"ignored",reason:"no_reference"};
 if(input.conversation.chatType!=="direct"||!input.inboxContact)return {status:"ignored",reason:"not_direct"};
 const found=await deps.commerceRepository.getIntentByReference(reference);
 // Referência de outro tenant/workspace é tratada como inexistente (nunca vaza nem converte).
 if(!found||found.tenantId!==input.tenantId||found.workspaceId!==input.workspaceId)return {status:"ignored",reason:"unknown_reference"};
 if(found.status==="CONVERTED")return {status:"already_converted",intentId:found.id,dealId:found.dealId};
 const now=deps.now?.()??new Date();
 if(Date.parse(found.expiresAt)<=now.getTime())return {status:"ignored",reason:"expired",intentId:found.id};
 const intent=await deps.commerceRepository.claimIntent({id:found.id,staleBefore:new Date(now.getTime()-STALE_CLAIM_MS).toISOString()});
 if(!intent)return {status:"already_converted",intentId:found.id};
 try{
  const settings=await settingsFor(deps,intent.siteId);
  let conversation=input.conversation;
  // Equipe do Site: conversa sem responsável, ou nascida depois do clique (só distribuída pela regra do canal).
  const bornAfterClick=Date.parse(conversation.createdAt)>=Date.parse(intent.createdAt);
  if(settings.teamId&&deps.inbox&&(!conversation.assignedUserId||bornAfterClick)&&!["resolved","archived"].includes(conversation.status)){
   conversation=await routeUnassignedConversationToTeam(deps.inbox,{tenantId:intent.tenantId,workspaceId:intent.workspaceId,conversationId:conversation.id,teamId:settings.teamId,replaceAutomaticAssignment:bornAfterClick}).catch(error=>{deps.log?.("site_lead_routing_failed",{intentId:intent.id,error:errorText(error)});return conversation;});
  }
  const contactId=intent.contactId??(deps.crmBridge?(await ensureCrmContactForInboxContact(deps.crmBridge,{tenantId:intent.tenantId,workspaceId:intent.workspaceId,inboxContactId:input.inboxContact.id,contactName:input.inboxContact.name,contactPhone:input.inboxContact.phoneNormalized,origin:SITE_LEAD_ORIGIN}))?.contactId:undefined);
  await deps.commerceRepository.updateIntentLinks(intent.id,{contactId,conversationId:conversation.id});
  const attendance=await deps.inbox?.attendanceRepository?.getOpenByConversation(conversation.id).catch(()=>undefined);
  const teamId=conversation.currentTeamId??settings.teamId;
  const dealId=settings.createOpportunityFromWhatsapp?await ensureOpportunity(deps,{...intent,contactId},{contactId,ownerUserId:conversation.assignedUserId,teamId}):undefined;
  const completed=await deps.commerceRepository.completeIntent(intent.id,{contactId,conversationId:conversation.id,attendanceId:attendance?.id,dealId});
  if(intent.anonymousSessionId&&contactId)await deps.commerceRepository.attachContactToSession({siteId:intent.siteId,anonymousSessionId:intent.anonymousSessionId,contactId}).catch(()=>undefined);
  await deps.commerceRepository.recordEvent({tenantId:intent.tenantId,workspaceId:intent.workspaceId,siteId:intent.siteId,type:"SALES_INTENT_CONVERTED",anonymousSessionId:intent.anonymousSessionId,contactId,salesIntentId:intent.id,productId:intent.productId,variantId:intent.variantId,utm:intent.utm}).catch(()=>undefined);
  await notifyLead(deps,{intent,settings,customer:input.inboxContact.name||input.inboxContact.phoneNormalized||"Cliente",assigneeUserId:conversation.assignedUserId,conversationId:conversation.id,dealId});
  deps.log?.("SalesIntentConverted",{intentId:intent.id,type:intent.type,siteId:intent.siteId,hasDeal:!!dealId});
  return {status:"converted",intentId:completed?.id??intent.id,dealId,assignedUserId:conversation.assignedUserId};
 }catch(error){
  deps.log?.("ConversionError",{intentId:intent.id,error:errorText(error)});
  await deps.commerceRepository.releaseIntent(intent.id,errorText(error)).catch(()=>undefined);
  throw error;
 }
}
/** Depois das regras de atendimento (reabertura de conversa finalizada), grava o atendimento que ficou aberto. */
export async function attachAttendanceToConvertedIntent(deps:SiteLeadDeps,input:{intentId:string;conversationId:string}):Promise<void>{
 const attendance=await deps.inbox?.attendanceRepository?.getOpenByConversation(input.conversationId).catch(()=>undefined);
 if(attendance)await deps.commerceRepository.updateIntentLinks(input.intentId,{attendanceId:attendance.id});
}

export type SiteFormLeadInput={siteId:string;tenantId:string;workspaceId:string;inquiryId:string;contactId:string;name:string;phone?:string;productId?:string;variantId?:string;quantity?:number;item?:SalesIntent["snapshot"]["items"][number];requestKey:string;anonymousSessionId?:string;pageUrl?:string;utm:SalesIntent["utm"]};
/** Formulário do Site: o contato já existe (criado pelo repositório do Site); aqui entram as regras configuráveis. */
export async function processSiteFormLead(deps:SiteLeadDeps,input:SiteFormLeadInput):Promise<{intentId:string;dealId?:string;conversationId?:string}>{
 const settings=await settingsFor(deps,input.siteId);const now=deps.now?.()??new Date();
 const items=input.item?[input.item]:[];
 // Reenvio do mesmo formulário (duplo clique/retry): nada roda de novo.
 const previous=await deps.commerceRepository.findIntentByRequestKey({siteId:input.siteId,requestKey:`form:${input.requestKey}`});
 if(previous)return {intentId:previous.id,dealId:previous.dealId,conversationId:previous.conversationId};
 let {intent}=await deps.commerceRepository.createIntent({tenantId:input.tenantId,workspaceId:input.workspaceId,siteId:input.siteId,reference:newSalesIntentReference(),type:"CONTACT_FORM",status:"CONVERTED",productId:input.productId,variantId:input.variantId,quantity:input.item?.quantity,snapshot:{items,subtotalCents:items.reduce((sum,item)=>sum+item.unitPriceCents*item.quantity,0),currency:items[0]?.currency??"BRL"},pageUrl:input.pageUrl,utm:input.utm,anonymousSessionId:input.anonymousSessionId,requestKey:`form:${input.requestKey}`,expiresAt:new Date(now.getTime()+SALES_INTENT_TTL_MS).toISOString(),contactId:input.contactId});
 const base={tenantId:input.tenantId,workspaceId:input.workspaceId,siteId:input.siteId,anonymousSessionId:input.anonymousSessionId,contactId:input.contactId,productId:input.productId,variantId:input.variantId,salesIntentId:intent.id,pageUrl:input.pageUrl,utm:input.utm};
 await deps.commerceRepository.recordEvent({...base,type:"CONTACT_FORM_SUBMITTED"}).catch(()=>undefined);
 if(input.anonymousSessionId)await deps.commerceRepository.attachContactToSession({siteId:input.siteId,anonymousSessionId:input.anonymousSessionId,contactId:input.contactId}).catch(()=>undefined);
 let conversation:InboxConversation|undefined;
 if(settings.form.openAttendance&&input.phone&&deps.inbox)conversation=await openAttendanceForFormLead(deps,{...input,phone:input.phone,teamId:settings.teamId}).catch(error=>{deps.log?.("site_form_attendance_failed",{intentId:intent.id,error:errorText(error)});return undefined;});
 let ownerUserId=conversation?.assignedUserId;
 if(!ownerUserId&&settings.teamId&&deps.inbox?.teamRepository&&settings.form.createOpportunity){
  ownerUserId=deps.inbox.teamMembershipRepository?(await resolveNextTeamMember({teamRepository:deps.inbox.teamRepository,teamMembershipRepository:deps.inbox.teamMembershipRepository},{teamId:settings.teamId}).catch(()=>undefined))?.userId:undefined;
 }
 const dealId=settings.form.createOpportunity?await ensureOpportunity(deps,intent,{contactId:input.contactId,ownerUserId,teamId:conversation?.currentTeamId??settings.teamId}):undefined;
 if(conversation||dealId)intent=await deps.commerceRepository.completeIntent(intent.id,{conversationId:conversation?.id,dealId,attendanceId:conversation?(await deps.inbox?.attendanceRepository?.getOpenByConversation(conversation.id).catch(()=>undefined))?.id:undefined})??intent;
 await notifyLead(deps,{intent,settings,customer:input.name,assigneeUserId:ownerUserId,conversationId:conversation?.id,dealId});
 deps.log?.("SiteLeadCreated",{intentId:intent.id,siteId:input.siteId,hasDeal:!!dealId,hasAttendance:!!conversation});
 return {intentId:intent.id,dealId,conversationId:conversation?.id};
}
/** Abre (ou reaproveita) a conversa do WhatsApp desse telefone e um atendimento, sem enviar mensagem. */
async function openAttendanceForFormLead(deps:SiteLeadDeps,input:SiteFormLeadInput&{phone:string;teamId?:string}):Promise<InboxConversation|undefined>{
 const inbox=deps.inbox!;
 const connection=(await inbox.connectionRepository.listByWorkspace({tenantId:input.tenantId,workspaceId:input.workspaceId})).find(item=>item.provider==="wuzapi"&&item.status==="connected");
 if(!connection)return undefined;
 const phone=normalizePhoneNumber(input.phone);if(!phone)return undefined;
 const contact=await inbox.contactRepository.upsertByPhone({tenantId:input.tenantId,workspaceId:input.workspaceId,phoneNormalized:phone,name:input.name});
 if(deps.crmBridge&&!contact.crmContactId)await deps.crmBridge.inboxContactRepository.linkCrmContact(contact.id,input.contactId).catch(()=>undefined);
 let conversation=await inbox.conversationRepository.findOrCreate({tenantId:input.tenantId,workspaceId:input.workspaceId,connectionId:connection.id,chatType:"direct",externalChatId:phone,contactId:contact.id});
 if(input.teamId&&!conversation.assignedUserId)conversation=await routeUnassignedConversationToTeam(inbox,{tenantId:input.tenantId,workspaceId:input.workspaceId,conversationId:conversation.id,teamId:input.teamId});
 await ensureOpenAttendanceSafely(inbox,conversation,{at:new Date().toISOString(),openedBy:INBOX_SYSTEM_ACTOR,openReason:"site_lead"});
 return conversation;
}
