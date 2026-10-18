import {randomUUID} from "node:crypto";
import type {CapacityUseCaseDeps,CapacityChangeInput,CapacityChangeOutcome} from "./capacity-use-cases.js";
import type {Subscription,SubscriptionItem,SubscriptionPendingChange} from "../../domain/platform-billing/subscription.model.js";
import type {AddonDefinition,PlanVersion} from "../../domain/platform-billing/plan-version.model.js";
import {resolveCommercialCapacity} from "../../domain/platform-billing/capacity.model.js";
import {isPlanLimitResource} from "../../domain/platform-billing/plan-entitlements.model.js";
import {getRealActiveSubscription} from "./lifecycle-use-cases.js";
import {getLimit} from "./entitlement-use-cases.js";
import {assertMeetingsSellable,MEETINGS_BASE_ADDON,MEETINGS_EXTRA_RECORDING_ADDON} from "./meetings-offer.js";
import {priceRefFor} from "./price-ref.js";

export async function loadRecurringCapacity(deps:CapacityUseCaseDeps,tenantId:string,subscription:Subscription,plan:PlanVersion){
 const items=await deps.subscriptionItemRepository.listBySubscription(subscription.id);
 const active=await deps.addonDefinitionRepository.listActive();
 const definitions=[...active];
 for(const item of items)if(!definitions.some(addon=>addon.code===item.addonCode)){const addon=await deps.addonDefinitionRepository.getByCode(item.addonCode);if(addon)definitions.push(addon);}
 const pending=(await deps.subscriptionPendingChangeRepository.listPendingByTenant(tenantId)).filter(change=>change.subscriptionId===subscription.id&&change.changeType==="capacity_decrease");
 const future=items.map(item=>({...item,quantity:pending.find(change=>change.addonCode===item.addonCode)?.targetQuantity??item.quantity}));
 return {items,definitions,pending,future,plan,subscription};
}
export type RecurringCapacityContext=Awaited<ReturnType<typeof loadRecurringCapacity>>;

/** Quantidades absolutas tornam repetição de Salvar idempotente; preços já contratados são preservados. */
export function prepareRecurringCapacity(context:RecurringCapacityContext,input:CapacityChangeInput,validateSale=true){
 const {items,definitions,plan,subscription}=context;
 const target=new Map(context.future.map(item=>[item.addonCode,item.quantity]));
 const touched=new Set<string>();
 const quantity=(value:number)=>{if(!Number.isSafeInteger(value)||value<0||value>10000)throw Error("CAPACITY_INVALID: informe uma quantidade inteira não negativa.");return value;};
 const set=(code:string,value:number)=>{target.set(code,quantity(value));touched.add(code);};
 for(const [resource,requested] of [["users",input.users],["messaging_connections",input.whatsappConnections]] as const){
  if(requested===undefined)continue;quantity(requested);const included=plan.limits[resource];if(included===null)continue;
  if(requested<included)throw Error(`CAPACITY_BELOW_PLAN_MINIMUM: o plano inclui ${included} de ${resource}.`);
  const addon=definitions.find(addon=>addon.resource===resource&&(plan.allowedAddonCodes.includes(addon.code)||items.some(item=>item.addonCode===addon.code)));
  if(!addon){if(requested===included)continue;throw Error(`CAPACITY_ADDON_NOT_AVAILABLE: adicional de ${resource} indisponível.`);}
  set(addon.code,Math.ceil((requested-included)/addon.increment));
 }
 if(input.concurrentRecordings!==undefined){
  const count=quantity(input.concurrentRecordings),base=items.find(item=>item.addonCode===MEETINGS_BASE_ADDON),extra=items.find(item=>item.addonCode===MEETINGS_EXTRA_RECORDING_ADDON);
  const current=base?1+(extra?.quantity??0):0;
  if(validateSale&&count>current)assertMeetingsSellable();
  if(base&&count<1)throw Error("CAPACITY_BELOW_PLAN_MINIMUM: Meetings inclui uma gravação. Ajuste somente as gravações adicionais.");
  if(count>0){set(MEETINGS_BASE_ADDON,1);set(MEETINGS_EXTRA_RECORDING_ADDON,count-1);}
 }
 for(const [code,value] of Object.entries(input.addonQuantities??{})){
  const addon=definitions.find(addon=>addon.code===code);if(!addon)throw Error("CAPACITY_ADDON_NOT_AVAILABLE: adicional não encontrado.");
  if(["users","messaging_connections","meetings_concurrent_recordings"].includes(addon.resource))throw Error("CAPACITY_INVALID: ajuste usuários, WhatsApp e gravações nos campos correspondentes.");
  if((addon.resource==="site"||addon.resource==="commerce")&&value>1)throw Error("CAPACITY_INVALID: esse módulo permite somente uma contratação.");
  set(code,value);
 }
 const desired:SubscriptionItem[]=[];
 for(const [code,value] of target){
  const existing=items.find(item=>item.addonCode===code),addon=definitions.find(addon=>addon.code===code);
  if(!addon){if(existing&&value===existing.quantity){desired.push(existing);continue;}throw Error("CAPACITY_ADDON_NOT_AVAILABLE: definição do adicional ausente.");}
  if(value>(existing?.quantity??0)&&(!addon.active||!plan.allowedAddonCodes.includes(code)))throw Error("CAPACITY_ADDON_NOT_AVAILABLE: este adicional não está disponível para aumento neste plano.");
  if(value>(existing?.quantity??0)&&addon.currency!==plan.currency)throw Error("CAPACITY_INVALID: moeda do adicional incompatível com o plano.");
  if(value===0&&!existing)continue;
  desired.push(existing?{...existing,quantity:value}:{id:"",subscriptionId:subscription.id,addonCode:code,quantity:value,unitPriceUsd:subscription.billingInterval==="yearly"?addon.yearlyPriceUsd:addon.monthlyPriceUsd,currency:addon.currency,createdAt:"",updatedAt:""});
 }
 return {desired,touched,snapshot:resolveCommercialCapacity(plan,definitions,desired,subscription.billingInterval)};
}

export async function withCapacityMutation<T>(deps:CapacityUseCaseDeps,tenantId:string,work:(deps:CapacityUseCaseDeps)=>Promise<T>){
 return deps.capacityMutationRepository?deps.capacityMutationRepository.run(tenantId,repositories=>work({...deps,...repositories})):work(deps);
}
async function validateReductions(deps:CapacityUseCaseDeps,tenantId:string,context:RecurringCapacityContext,desired:SubscriptionItem[]){
 for(const item of desired){
  const old=context.items.find(current=>current.addonCode===item.addonCode);if(!old||item.quantity>=old.quantity)continue;
  const addon=context.definitions.find(addon=>addon.code===item.addonCode);
  if(addon&&isPlanLimitResource(addon.resource)){
   const {used}=await getLimit(deps,{tenantId,resource:addon.resource});
   const included=context.plan.limits[addon.resource];
   if(included!==null){const maximum=included+desired.filter(other=>context.definitions.find(def=>def.code===other.addonCode)?.resource===addon.resource).reduce((sum,other)=>sum+other.quantity*(context.definitions.find(def=>def.code===other.addonCode)?.increment??1),0);if(used>maximum)throw Error(`CAPACITY_REDUCTION_BELOW_USAGE: ${used} em uso; o novo limite seria ${maximum}. Libere capacidade antes de reduzir.`);}
  }
 }
}

export async function saveRecurringCapacity(deps:CapacityUseCaseDeps,input:CapacityChangeInput){
 return withCapacityMutation(deps,input.tenantId,async locked=>{
  const subscription=await getRealActiveSubscription(locked,input.tenantId);
  if(!["active","trial"].includes(subscription.status))throw Error("CAPACITY_INVALID: regularize a assinatura antes de alterar as quantidades.");
  if(!subscription.providerSubscriptionId)throw Error("ADDON_NO_PROVIDER_SUBSCRIPTION: assinatura sem gateway de pagamento.");
  if(subscription.cancelAtPeriodEnd)throw Error("CAPACITY_INVALID: reative a assinatura antes de alterar as quantidades.");
  const plan=await locked.planVersionRepository.getById(subscription.planVersionId);if(!plan)throw Error("CAPACITY_PLAN_VERSION_NOT_FOUND");
  const context=await loadRecurringCapacity(locked,input.tenantId,subscription,plan);
  const prepared=prepareRecurringCapacity(context,input);
  await validateReductions(locked,input.tenantId,context,prepared.desired);
  const effectiveAt=subscription.currentPeriodEnd??subscription.trialEnd;
  if(!effectiveAt&&prepared.desired.some(item=>item.quantity<(context.items.find(old=>old.addonCode===item.addonCode)?.quantity??0)))throw Error("CAPACITY_INVALID: a data da próxima renovação ainda não está disponível.");
  const futureChanged=prepared.desired.some(item=>item.quantity!==(context.future.find(old=>old.addonCode===item.addonCode)?.quantity??0));
  // Também sincroniza pendências legadas, cujo valor ainda não havia sido enviado ao gateway.
  const needsSync=futureChanged||context.pending.some(change=>!change.billingSynced);
  const refs=prepared.desired.map(item=>{const definition=context.definitions.find(addon=>addon.code===item.addonCode);return {addonCode:item.addonCode,quantity:item.quantity,unitPriceCents:Math.round(item.unitPriceUsd*100),providerItemId:item.providerItemId,providerPriceRef:item.providerPriceRef??(definition?(item.providerItemId&&locked.billingProvider.providerId==="stripe"&&!(subscription.billingInterval==="yearly"?definition.yearlyProviderPriceRef:definition.monthlyProviderPriceRef)?undefined:priceRefFor(locked.billingProvider.providerId,item.addonCode,subscription.billingInterval==="yearly"?definition.yearlyProviderPriceRef:definition.monthlyProviderPriceRef)):undefined)};});
  const result=needsSync?await locked.billingProvider.setRecurringItems({providerSubscriptionId:subscription.providerSubscriptionId,amount:prepared.snapshot.totalMonthlyAmount,currency:prepared.snapshot.currency,operationKey:`capacity-${randomUUID()}`,items:refs}):{ok:true as const,providerItemIds:{} as Record<string,string>};
  if(!result.ok)throw Error(`ADDON_PROVIDER_ERROR(${result.kind}): ${result.message}`);
  await locked.beginCapacityWrite?.();
  const outcomes:CapacityChangeOutcome[]=[];
  for(const item of prepared.desired){
   const old=context.items.find(current=>current.addonCode===item.addonCode),previous=context.pending.find(change=>change.addonCode===item.addonCode);
   const addon=context.definitions.find(addon=>addon.code===item.addonCode);
   if(!prepared.touched.has(item.addonCode)&&!previous)continue;
   if(previous?.targetQuantity===item.quantity&&previous.billingSynced)continue;
   if(previous)await locked.subscriptionPendingChangeRepository.markCancelled(previous.id);
   let stored=old;const providerItemId=result.providerItemIds[item.addonCode]??old?.providerItemId;
   const providerPriceRef=(result as {providerPriceRefs?:Record<string,string>}).providerPriceRefs?.[item.addonCode]??old?.providerPriceRef??refs.find(ref=>ref.addonCode===item.addonCode)?.providerPriceRef;
   if(item.quantity>(old?.quantity??0)){
    stored=old?await locked.subscriptionItemRepository.updateQuantity(old.id,item.quantity):await locked.subscriptionItemRepository.create({...item,providerItemId,providerPriceRef});
   }
   if(stored&&providerItemId&&(providerItemId!==stored.providerItemId||providerPriceRef!==stored.providerPriceRef))await locked.subscriptionItemRepository.updateProviderItemId(stored.id,providerItemId,providerPriceRef);
   if(old&&item.quantity<old.quantity)await locked.subscriptionPendingChangeRepository.create({subscriptionId:subscription.id,tenantId:input.tenantId,addonCode:item.addonCode,subscriptionItemId:old.id,fromQuantity:old.quantity,targetQuantity:item.quantity,effectiveAt:effectiveAt!,billingSynced:true});
   if(addon){const included=isPlanLimitResource(addon.resource)?(plan.limits[addon.resource]??0):0;const base=addon.code===MEETINGS_EXTRA_RECORDING_ADDON?1:included;outcomes.push({resource:addon.resource,kind:item.quantity>(old?.quantity??0)?"increased":item.quantity<(old?.quantity??0)?"decrease_scheduled":"unchanged",fromQuantity:base+(old?.quantity??0)*addon.increment,toQuantity:base+item.quantity*addon.increment,effectiveAt:item.quantity<(old?.quantity??0)?effectiveAt:undefined});}
  }
  if(needsSync)await locked.billingEventRepository.record({tenantId:input.tenantId,subscriptionId:subscription.id,eventType:"subscription_updated",payload:{reason:"capacity_saved",nextRecurringAmount:prepared.snapshot.totalMonthlyAmount,currency:prepared.snapshot.currency,billingInterval:subscription.billingInterval,quantities:Object.fromEntries(prepared.desired.map(item=>[item.addonCode,item.quantity]))}});
  return {outcomes,nextCharge:effectiveAt?{at:effectiveAt,amount:prepared.snapshot.totalMonthlyAmount,currency:prepared.snapshot.currency}:undefined};
 });
}

export async function cancelRecurringCapacityReduction(deps:CapacityUseCaseDeps,input:{tenantId:string;pendingChangeId:string}){
 const pending=await deps.subscriptionPendingChangeRepository.getById(input.pendingChangeId);
 if(!pending||pending.tenantId!==input.tenantId||pending.changeType!=="capacity_decrease")throw Error("CAPACITY_PENDING_CHANGE_NOT_FOUND");
 if(pending.appliedAt||pending.cancelledAt)throw Error("CAPACITY_PENDING_CHANGE_ALREADY_APPLIED");
 const subscription=await deps.subscriptionRepository.getActiveByTenant(input.tenantId);if(!subscription||subscription.id!==pending.subscriptionId)throw Error("CAPACITY_PENDING_CHANGE_NOT_FOUND");
 const item=(await deps.subscriptionItemRepository.listBySubscription(subscription.id)).find(item=>item.id===pending.subscriptionItemId);const addon=pending.addonCode?await deps.addonDefinitionRepository.getByCode(pending.addonCode):undefined;
 if(!item||!addon)throw Error("CAPACITY_PENDING_CHANGE_NOT_FOUND");
 const plan=await deps.planVersionRepository.getById(subscription.planVersionId);if(!plan)throw Error("CAPACITY_PLAN_VERSION_NOT_FOUND");
 if(addon.resource==="users")await saveRecurringCapacity(deps,{tenantId:input.tenantId,users:(plan.limits.users??0)+item.quantity*addon.increment});
 else if(addon.resource==="messaging_connections")await saveRecurringCapacity(deps,{tenantId:input.tenantId,whatsappConnections:(plan.limits.messaging_connections??0)+item.quantity*addon.increment});
 else if(addon.code===MEETINGS_EXTRA_RECORDING_ADDON)await saveRecurringCapacity(deps,{tenantId:input.tenantId,concurrentRecordings:1+item.quantity});
 else await saveRecurringCapacity(deps,{tenantId:input.tenantId,addonQuantities:{[addon.code]:item.quantity}});
}
