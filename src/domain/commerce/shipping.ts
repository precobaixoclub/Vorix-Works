import {z} from "zod";
import type {DeliveryKind} from "./order.model.js";
/**
 * Frete da loja. O checkout só conhece `ShippingOption`; quem calcula é um ShippingProvider
 * (os métodos próprios abaixo ou um provedor externo). Nada é inventado: sem método configurado
 * para o CEP, não há opção.
 */
const cep=z.string().regex(/^\d{8}$/,"Use um CEP com 8 dígitos.");
const money=z.number().int().min(0).max(100_000_000);
const days=z.number().int().min(0).max(120);
export const shippingSettingsSchema=z.object({
 originPostalCode:cep.optional(),
 originAddress:z.string().trim().max(300).optional(),
 handlingDays:days.default(0),
 /** Faixas de CEP atendidas para entrega. Vazio = Brasil todo. Retirada vale sempre. */
 regions:z.array(z.object({from:cep,to:cep}).strict()).max(50).default([]),
 pickup:z.object({enabled:z.boolean().default(false),address:z.string().trim().max(300).default(""),instructions:z.string().trim().max(300).default(""),days:days.default(0)}).strict().default({enabled:false,address:"",instructions:"",days:0}),
 freeShipping:z.object({enabled:z.boolean().default(false),minSubtotalCents:money.default(0),days:days.default(7)}).strict().default({enabled:false,minSubtotalCents:0,days:7}),
 fixed:z.object({enabled:z.boolean().default(false),label:z.string().trim().max(80).default("Entrega padrão"),priceCents:money.default(0),days:days.default(7)}).strict().default({enabled:false,label:"Entrega padrão",priceCents:0,days:7}),
 table:z.array(z.object({id:z.string().regex(/^[a-z0-9-]{1,40}$/),label:z.string().trim().min(1).max(80),from:cep,to:cep,priceCents:money,days}).strict()).max(50).default([]),
 provider:z.object({key:z.enum(["NONE","MELHOR_ENVIO"]).default("NONE")}).strict().default({key:"NONE"}),
}).strict().superRefine((value,ctx)=>{
 for(const [index,range] of [...value.regions,...value.table].entries())if(range.from>range.to)ctx.addIssue({code:"custom",path:[index<value.regions.length?"regions":"table"],message:"O CEP inicial precisa ser menor que o final."});
 if(value.provider.key!=="NONE"&&!value.originPostalCode)ctx.addIssue({code:"custom",path:["originPostalCode"],message:"Informe o CEP de origem para calcular o frete automático."});
});
export type ShippingSettings=z.infer<typeof shippingSettingsSchema>;
export const defaultShippingSettings=():ShippingSettings=>shippingSettingsSchema.parse({});

export type ShippingParcelItem={productId:string;quantity:number;unitPriceCents:number;weightGrams?:number;heightCm?:number;widthCm?:number;lengthCm?:number};
export type ShippingQuoteRequest={destinationPostalCode?:string;subtotalCents:number;items:ShippingParcelItem[]};
export type ShippingOption={id:string;kind:DeliveryKind;label:string;priceCents:number;days?:number;provider?:string;requiresAddress:boolean;description?:string};

const inRange=(postal:string,range:{from:string;to:string})=>postal>=range.from&&postal<=range.to;
export function servesPostalCode(settings:ShippingSettings,postal:string):boolean{return !settings.regions.length||settings.regions.some(range=>inRange(postal,range));}
/** Métodos próprios da loja (retirada, grátis, fixo, tabela por faixa de CEP). */
export function quoteOwnShipping(settings:ShippingSettings,request:ShippingQuoteRequest):ShippingOption[]{
 const options:ShippingOption[]=[];const extra=settings.handlingDays;
 if(settings.pickup.enabled)options.push({id:"pickup",kind:"PICKUP",label:"Retirar no local",priceCents:0,days:settings.pickup.days+extra,requiresAddress:false,description:[settings.pickup.address,settings.pickup.instructions].filter(Boolean).join(" · ")||undefined});
 const postal=request.destinationPostalCode;
 if(!postal||!servesPostalCode(settings,postal))return options;
 if(settings.freeShipping.enabled&&request.subtotalCents>=settings.freeShipping.minSubtotalCents)options.push({id:"free",kind:"FREE",label:"Frete grátis",priceCents:0,days:settings.freeShipping.days+extra,requiresAddress:true});
 if(settings.fixed.enabled)options.push({id:"fixed",kind:"FIXED",label:settings.fixed.label,priceCents:settings.fixed.priceCents,days:settings.fixed.days+extra,requiresAddress:true});
 for(const row of settings.table)if(inRange(postal,row))options.push({id:`table:${row.id}`,kind:"TABLE",label:row.label,priceCents:row.priceCents,days:row.days+extra,requiresAddress:true});
 return options;
}
export function hasAnyShippingMethod(settings:ShippingSettings):boolean{return settings.pickup.enabled||settings.freeShipping.enabled||settings.fixed.enabled||settings.table.length>0||settings.provider.key!=="NONE";}
/** Peso e volume do pacote com mínimos usuais de transportadora (sem inventar quando não há medida). */
export function parcelFromItems(items:readonly ShippingParcelItem[]){
 const missing=items.some(item=>!item.weightGrams);
 const weightGrams=items.reduce((sum,item)=>sum+(item.weightGrams??0)*item.quantity,0);
 return {missingMeasures:missing,weightGrams};
}
