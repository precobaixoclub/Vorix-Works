import {createHash} from "node:crypto";
import {z} from "zod";
import {commercialRuleSchema} from "../commerce/commercial-rules.js";
import {siteCommerceSettingsSchema} from "./site-commerce.js";

export const siteCommerceDraftSchema=z.object({
 settings:siteCommerceSettingsSchema,
 rules:z.array(z.object({id:z.string().regex(/^rule-[a-zA-Z0-9_-]{1,150}$/),definition:commercialRuleSchema}).strict()).max(100),
 baseVersion:z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value,ctx)=>{
 if(new Set(value.rules.map(rule=>rule.id)).size!==value.rules.length)ctx.addIssue({code:"custom",message:"As regras não podem repetir identificadores."});
 const codes=value.rules.map(rule=>rule.definition.couponCode).filter(Boolean);
 if(new Set(codes).size!==codes.length)ctx.addIssue({code:"custom",message:"Cada cupom precisa de um código diferente."});
});
export type SiteCommerceDraft=z.infer<typeof siteCommerceDraftSchema>;
export function stableSiteJson(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(stableSiteJson).join(",")}]`;
 if(value&&typeof value==="object")return `{${Object.entries(value).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>`${JSON.stringify(key)}:${stableSiteJson(entry)}`).join(",")}}`;
 return JSON.stringify(value)??"null";
}
export function siteCommerceVersion(settings:unknown,rules:{id:string;revision:number}[]){return createHash("sha256").update(stableSiteJson({settings,rules:rules.map(({id,revision})=>({id,revision})).sort((a,b)=>a.id.localeCompare(b.id))})).digest("hex");}
