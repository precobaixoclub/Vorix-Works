import {createHash} from "node:crypto";
import {commercialRuleSchema,evaluateCommercialRules,ruleActive,type CommercialRule,type CommercialRuleInput,type RuleLine,type RuleScope} from "../../domain/commerce/commercial-rules.js";
import type {SiteEngineDeps} from "../sites/site-use-cases.js";
import type {Product} from "../../domain/crm/crm.model.js";

export function ruleVersion(rules:Pick<CommercialRule,"id"|"revision">[],activeAt?:Date){return JSON.stringify(rules.map(rule=>[rule.id,rule.revision,...(activeAt?[ruleActive(rule as CommercialRule,activeAt)]:[])]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
export function pricingFingerprint(lines:RuleLine[],rules:CommercialRule[],couponCode?:string){return createHash("sha256").update(JSON.stringify({lines,rules:ruleVersion(rules),couponCode})).digest("hex");}
export function categoryAncestors(categoryId:string|undefined,categories:{id:string;parentId?:string}[]){
 const ids:string[]=[];while(categoryId&&!ids.includes(categoryId)){ids.push(categoryId);categoryId=categories.find(item=>item.id===categoryId)?.parentId;}return ids;
}
export function pricingLine(product:Product,variantId:string|undefined,quantity:number,price:number,categories:{id:string;parentId?:string}[]):RuleLine{
 return {key:JSON.stringify([product.id,variantId??""]),productId:product.id,variantId,categoryIds:categoryAncestors(product.categoryId,categories),collection:product.details?.apparel?.collection,quantity,unitPriceCents:price,currency:product.currency,...(product.details?.promotion?{promotion:product.details.promotion}:{})};
}
export async function validateCommercialRuleInput(deps:SiteEngineDeps,scope:RuleScope,input:unknown){
 const definition=commercialRuleSchema.parse(input);
 const metadata=await deps.productEngineRepository.metadata(scope);
 if(definition.scope.type==="PRODUCTS")for(const id of definition.scope.ids){const product=await deps.productRepository.getById(id);if(!product||product.tenantId!==scope.tenantId||product.workspaceId!==scope.workspaceId)throw Error("SITE_VALIDATION: produto fora desta loja.");}
 if(definition.scope.type==="CATEGORIES"&&definition.scope.ids.some(id=>!metadata.categories.some(category=>category.id===id)))throw Error("SITE_VALIDATION: categoria fora desta loja.");
 if(definition.scope.type==="COLLECTIONS"){
  const products=await deps.productRepository.listByWorkspace(scope),collections=new Set(products.map(product=>product.details?.apparel?.collection).filter(Boolean));
  if(definition.scope.ids.some(id=>!collections.has(id)))throw Error("SITE_VALIDATION: coleção não encontrada nesta loja.");
 }
 return definition;
}
export async function saveCommercialRule(deps:SiteEngineDeps,scope:RuleScope,input:unknown,actor:string,update?:{id:string;revision:number}){
 if(!deps.commercialRules)throw Error("SITE_VALIDATION: regras comerciais indisponíveis.");
 const definition=await validateCommercialRuleInput(deps,scope,input);
 const saved=await deps.commercialRules.save(scope,definition,actor,update);
 if(!saved)throw Error("SITE_VALIDATION: a regra mudou ou foi excluída. Atualize a tela antes de salvar.");return saved;
}
export {evaluateCommercialRules};
export type {CommercialRuleInput};
