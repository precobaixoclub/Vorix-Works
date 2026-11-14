import {z} from "zod";

const money=z.number().int().min(0).max(100_000_000);
const ids=z.array(z.string().min(1).max(160)).max(200).default([]);
export const commercialRuleSchema=z.object({
 name:z.string().trim().min(2).max(160),active:z.boolean().default(false),priority:z.number().int().min(0).max(1000).default(0),
 stackable:z.boolean().default(false),allowCoupon:z.boolean().default(false),
 startsAt:z.string().datetime({offset:true}).optional(),endsAt:z.string().datetime({offset:true}).optional(),
 channels:z.array(z.enum(["CHECKOUT","WHATSAPP"])).min(1).max(2),currency:z.string().regex(/^[A-Z]{3}$/).default("BRL"),
 scope:z.object({type:z.enum(["STORE","PRODUCTS","CATEGORIES","COLLECTIONS"]),ids}).strict(),
 trigger:z.discriminatedUnion("type",[
  z.object({type:z.literal("QUANTITY"),count:z.enum(["ELIGIBLE","SAME_PRODUCT"]),minimum:z.number().int().min(1).max(100000).default(1)}).strict(),
  z.object({type:z.literal("SUBTOTAL"),minimumCents:money}).strict(),
 ]),
 benefit:z.discriminatedUnion("type",[
  z.object({type:z.literal("PERCENT"),basisPoints:z.number().int().min(1).max(10000)}).strict(),
  z.object({type:z.literal("FIXED"),amountCents:money}).strict(),
  z.object({type:z.literal("UNIT_PRICE"),tiers:z.array(z.object({minimum:z.number().int().min(1).max(100000),maximum:z.number().int().min(1).max(100000).optional(),unitPriceCents:money}).strict()).min(1).max(20)}).strict(),
 ]),
 /** Coupons reuse the same conditions and benefits; absent = automatic rule. */
 couponCode:z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/).optional(),
}).strict().superRefine((rule,ctx)=>{
 const invalid=(message:string)=>ctx.addIssue({code:"custom",message});
 if(rule.scope.type!=="STORE"&&!rule.scope.ids.length)invalid("Selecione ao menos um item para o escopo.");
 if(rule.scope.type==="STORE"&&rule.scope.ids.length)invalid("Toda a loja não usa uma seleção de produtos.");
 if(new Set(rule.scope.ids).size!==rule.scope.ids.length)invalid("O escopo contém itens repetidos.");
 if(rule.startsAt&&rule.endsAt&&Date.parse(rule.endsAt)<=Date.parse(rule.startsAt))invalid("O fim da validade deve ser posterior ao início.");
 if(rule.benefit.type==="UNIT_PRICE"){
  if(rule.trigger.type!=="QUANTITY")invalid("Preço unitário por faixa exige gatilho por quantidade.");
  const tiers=rule.benefit.tiers;
  if(rule.trigger.type==="QUANTITY"&&rule.trigger.minimum!==tiers[0].minimum)invalid("A quantidade mínima deve coincidir com o início da primeira faixa.");
  tiers.forEach((tier,i)=>{
   const next=tiers[i+1],previous=tiers[i-1];
   if(tier.maximum!==undefined&&tier.maximum<tier.minimum)invalid("A quantidade final da faixa não pode ser menor que a inicial.");
   if(next&&(next.minimum<=tier.minimum||tier.maximum!==undefined&&tier.maximum!==next.minimum-1))invalid("As faixas precisam estar ordenadas, sem sobreposição ou lacunas.");
   if(previous&&tier.unitPriceCents>previous.unitPriceCents)invalid("O preço das faixas deve permanecer igual ou diminuir.");
  });
 }
});
export type CommercialRuleInput=z.infer<typeof commercialRuleSchema>;
export type RuleScope={tenantId:string;workspaceId:string;siteId:string};
export type CommercialRule=CommercialRuleInput&RuleScope&{id:string;revision:number;createdAt:string;updatedAt:string};
export type ProductPromotion={percent:number;startsAt?:string;endsAt?:string};
export type RuleLine={key:string;productId:string;variantId?:string;categoryIds?:string[];collection?:string;quantity:number;unitPriceCents:number;currency:string;/** The product's own promotion; applied before the rules. */promotion?:ProductPromotion};
export function promotionActive(promotion:ProductPromotion|undefined,now:Date):promotion is ProductPromotion{return !!promotion&&(!promotion.startsAt||Date.parse(promotion.startsAt)<=now.getTime())&&(!promotion.endsAt||Date.parse(promotion.endsAt)>now.getTime());}
export const promotionalPrice=(price:number,percent:number)=>Math.round(price*(100-percent)/100);
export type AppliedCommercialRule={id:string;revision:number;name:string;priority:number;benefit:CommercialRuleInput["benefit"];tier?:{minimum:number;maximum?:number;unitPriceCents:number};discountCents:number;coupon:boolean};
export type PricedRuleLine=RuleLine&{originalUnitPriceCents:number;totalCents:number;discountCents:number;appliedRules:AppliedCommercialRule[]};
export type RuleProgress={ruleId:string;name:string;productId?:string;missing:number;unitPriceCents:number;currency:string};
export type CommercialPricing={items:PricedRuleLine[];originalSubtotalCents:number;discountCents:number;totalCents:number;appliedRules:AppliedCommercialRule[];progress:RuleProgress[];couponCode?:string;couponStatus?:"APPLIED"|"NOT_ELIGIBLE"|"CONFLICT"};

export function ruleActive(rule:CommercialRuleInput,now:Date){return rule.active&&(!rule.startsAt||Date.parse(rule.startsAt)<=now.getTime())&&(!rule.endsAt||Date.parse(rule.endsAt)>now.getTime());}
export function ruleMatchesProduct(rule:CommercialRuleInput,line:Pick<RuleLine,"productId"|"categoryIds"|"collection"|"currency">){
 if(rule.currency!==line.currency)return false;
 switch(rule.scope.type){case "STORE":return true;case "PRODUCTS":return rule.scope.ids.includes(line.productId);case "CATEGORIES":return !!line.categoryIds?.some(id=>rule.scope.ids.includes(id));case "COLLECTIONS":return !!line.collection&&rule.scope.ids.includes(line.collection);}
}
function groups(rule:CommercialRule,lines:RuleLine[]){
 const eligible=lines.filter(line=>ruleMatchesProduct(rule,line));
 if(rule.trigger.type==="QUANTITY"&&rule.trigger.count==="SAME_PRODUCT")return [...new Set(eligible.map(line=>line.productId))].map(id=>eligible.filter(line=>line.productId===id));
 return [eligible];
}
function tierFor(rule:CommercialRule,quantity:number){
 return rule.benefit.type==="UNIT_PRICE"?rule.benefit.tiers.find((tier,i,all)=>quantity>=tier.minimum&&quantity<=(tier.maximum??(all[i+1]?all[i+1].minimum-1:Infinity))):undefined;
}
function qualifies(rule:CommercialRule,lines:RuleLine[]){
 return lines.length>0&&(rule.trigger.type==="QUANTITY"?lines.reduce((sum,line)=>sum+line.quantity,0)>=rule.trigger.minimum:lines.reduce((sum,line)=>sum+line.quantity*line.unitPriceCents,0)>=rule.trigger.minimumCents);
}
/** Largest remainder allocation: fixed/percentage discounts preserve every cent. */
function allocate(amount:number,totals:number[]){
 const sum=totals.reduce((a,b)=>a+b,0);if(!sum)return totals.map(()=>0);
 const target=Math.min(amount,sum),raw=totals.map(total=>target*total/sum),result=raw.map(Math.floor);
 let remaining=target-result.reduce((a,b)=>a+b,0);
 const order=raw.map((value,i)=>({i,remainder:value-result[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 for(const {i} of order){if(!remaining)break;result[i]++;remaining--;}
 return result;
}
function apply(rule:CommercialRule,original:RuleLine[],current:PricedRuleLine[]){
 const items=current.map(line=>({...line,appliedRules:[...line.appliedRules]}));
 for(const group of groups(rule,original)){
  if(!qualifies(rule,group))continue;
  const indexes=group.map(line=>items.findIndex(item=>item.key===line.key));
  const quantity=group.reduce((sum,line)=>sum+line.quantity,0),tier=tierFor(rule,quantity);
  const totals=indexes.map(i=>items[i].totalCents),sum=totals.reduce((a,b)=>a+b,0);
  const amounts=rule.benefit.type==="UNIT_PRICE"?(tier?indexes.map(i=>Math.max(0,items[i].totalCents-tier.unitPriceCents*items[i].quantity)):indexes.map(()=>0)):
   allocate(rule.benefit.type==="FIXED"?rule.benefit.amountCents:Math.round(sum*rule.benefit.basisPoints/10000),totals);
  indexes.forEach((index,i)=>{
   if(!amounts[i]&&!(tier&&tier.unitPriceCents<=items[index].originalUnitPriceCents))return;
   const item=items[index];item.totalCents-=amounts[i];item.discountCents+=amounts[i];
   // Tier prices are exact integer unit prices. Other benefits are allocated at line level.
   if(tier)item.unitPriceCents=Math.min(item.unitPriceCents,tier.unitPriceCents);
   item.appliedRules.push({id:rule.id,revision:rule.revision,name:rule.name,priority:rule.priority,benefit:structuredClone(rule.benefit),tier:tier?{...tier}:undefined,discountCents:amounts[i],coupon:!!rule.couponCode});
  });
 }
 return items;
}
const total=(lines:PricedRuleLine[])=>lines.reduce((sum,line)=>sum+line.totalCents,0);
/**
 * A product's own promotion lowers its unit price first; the store's rules then apply on top, as
 * on any price. The promotion shows up as an applied rule ("Promoção") with its own discount, so the
 * site, cart and WhatsApp order all show the same "de/por".
 */
export function evaluateCommercialRules(input:{lines:RuleLine[];rules:CommercialRule[];channel:"CHECKOUT"|"WHATSAPP";now?:Date;couponCode?:string}):CommercialPricing{
 const now=input.now??new Date();
 const promoted=input.lines.map(line=>promotionActive(line.promotion,now)?{...line,unitPriceCents:promotionalPrice(line.unitPriceCents,line.promotion.percent)}:line);
 if(promoted.every((line,index)=>line===input.lines[index]))return evaluateRules(input);
 const result=evaluateRules({...input,now,lines:promoted});
 const promotions=new Map<string,AppliedCommercialRule>();
 const items=result.items.map((item,index)=>{
  const original=input.lines[index];if(promoted[index]===original)return item;
  const cut=(original.unitPriceCents-promoted[index].unitPriceCents)*original.quantity;
  const entry:AppliedCommercialRule={id:`promotion:${original.productId}`,revision:1,name:"Promoção",priority:0,benefit:{type:"PERCENT",basisPoints:original.promotion!.percent*100},discountCents:cut,coupon:false};
  const prev=promotions.get(entry.id);promotions.set(entry.id,{...entry,discountCents:(prev?.discountCents??0)+cut});
  return {...item,unitPriceCents:original.unitPriceCents,originalUnitPriceCents:original.unitPriceCents,discountCents:item.discountCents+cut,appliedRules:[entry,...item.appliedRules]};
 });
 const original=input.lines.reduce((sum,line)=>sum+line.unitPriceCents*line.quantity,0);
 return {...result,items,originalSubtotalCents:original,discountCents:original-result.totalCents,appliedRules:[...promotions.values(),...result.appliedRules]};
}
function evaluateRules(input:{lines:RuleLine[];rules:CommercialRule[];channel:"CHECKOUT"|"WHATSAPP";now?:Date;couponCode?:string}):CommercialPricing{
 const now=input.now??new Date(),lines=input.lines;
 const base=lines.map(line=>({...line,originalUnitPriceCents:line.unitPriceCents,totalCents:line.quantity*line.unitPriceCents,discountCents:0,appliedRules:[] as AppliedCommercialRule[]}));
 const available=input.rules.filter(rule=>ruleActive(rule,now)&&rule.channels.includes(input.channel));
 const automatic=available.filter(rule=>!rule.couponCode).map(rule=>({rule,items:apply(rule,lines,base)})).filter(candidate=>candidate.items.some(item=>item.appliedRules.length));
 const priority=Math.max(-1,...automatic.map(candidate=>candidate.rule.priority));
 const candidates=automatic.filter(candidate=>candidate.rule.priority===priority);
 const stack=candidates.filter(candidate=>candidate.rule.stackable).sort((a,b)=>({UNIT_PRICE:0,PERCENT:1,FIXED:2}[a.rule.benefit.type]-{UNIT_PRICE:0,PERCENT:1,FIXED:2}[b.rule.benefit.type])||a.rule.id.localeCompare(b.rule.id));
 const plans=candidates.map(candidate=>({items:candidate.items,rules:[candidate.rule]}));
 if(stack.length>1)plans.push({items:stack.reduce((items,candidate)=>apply(candidate.rule,lines,items),base),rules:stack.map(candidate=>candidate.rule)});
 if(!plans.length)plans.push({items:base,rules:[]});
 const code=input.couponCode?.trim().toUpperCase(),coupon=code?available.find(rule=>rule.couponCode===code):undefined;
 let couponEligible=false;
 if(coupon){
  const standalone=apply(coupon,lines,base);couponEligible=total(standalone)<total(base);
  if(couponEligible){
   for(const plan of [...plans])if(plan.rules.every(rule=>rule.allowCoupon))plans.push({items:apply(coupon,lines,plan.items),rules:[...plan.rules,coupon]});
   plans.push({items:standalone,rules:[coupon]});
  }
 }
 const planPriority=(plan:typeof plans[number])=>Math.max(-1,...plan.rules.map(rule=>rule.priority));
 plans.sort((a,b)=>planPriority(b)-planPriority(a)||total(a.items)-total(b.items)||a.rules.map(rule=>rule.id).join().localeCompare(b.rules.map(rule=>rule.id).join()));
 const winner=plans[0];
 const couponStatus:CommercialPricing["couponStatus"]=!code?undefined:winner.rules.some(rule=>rule.couponCode===code)?"APPLIED":couponEligible?"CONFLICT":"NOT_ELIGIBLE";
 const applied=new Map<string,AppliedCommercialRule>();
 for(const item of winner.items)for(const entry of item.appliedRules){const key=JSON.stringify([entry.id,entry.tier]);const prev=applied.get(key);applied.set(key,{...entry,discountCents:(prev?.discountCents??0)+entry.discountCents});}
 const progress:RuleProgress[]=[];
 // At most one next threshold per rule/product; never advertises a rule blocked by priority/coupon.
 for(const rule of available.filter(rule=>!rule.couponCode&&rule.benefit.type==="UNIT_PRICE"&&(!couponStatus||couponStatus!=="APPLIED"||rule.allowCoupon)&&rule.priority>=priority)){
  for(const group of groups(rule,lines)){
   if(!group.length||rule.benefit.type!=="UNIT_PRICE")continue;
   const quantity=group.reduce((sum,line)=>sum+line.quantity,0),next=rule.benefit.tiers.find(tier=>tier.minimum>quantity);
   if(next)progress.push({ruleId:rule.id,name:rule.name,productId:rule.trigger.type==="QUANTITY"&&rule.trigger.count==="SAME_PRODUCT"?group[0].productId:undefined,missing:next.minimum-quantity,unitPriceCents:next.unitPriceCents,currency:rule.currency});
  }
 }
 return {items:winner.items,originalSubtotalCents:total(base),discountCents:total(base)-total(winner.items),totalCents:total(winner.items),appliedRules:[...applied.values()],progress:progress.slice(0,3),couponCode:code,couponStatus};
}
