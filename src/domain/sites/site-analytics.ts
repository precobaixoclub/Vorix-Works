import {z} from "zod";
export const SITE_ANALYTICS_EVENTS=["SITE_VIEW","PRODUCT_VIEW","PRODUCT_WHATSAPP_CLICK","ADD_TO_CART","REMOVE_FROM_CART","CART_WHATSAPP_START","CONTACT_FORM_SUBMITTED","SALES_INTENT_CREATED","SALES_INTENT_CONVERTED","CHECKOUT_STARTED","SHIPPING_QUOTED","PAYMENT_STARTED","ORDER_CREATED","PAYMENT_APPROVED","ORDER_PAID","ORDER_CANCELLED","ORDER_COMPLETED"] as const;
export type SiteAnalyticsEvent=(typeof SITE_ANALYTICS_EVENTS)[number];
export const analyticsEventContextSchema=z.object({eventKey:z.string().uuid().optional(),referrer:z.string().max(2000).optional(),device:z.enum(["mobile","tablet","desktop","unknown"]).optional()});
export const safeReferrer=(value:string|undefined):string|undefined=>{try{if(!value)return undefined;const url=new URL(value);return ["http:","https:"].includes(url.protocol)&&!url.username&&!url.password?url.hostname.toLowerCase().slice(0,253):undefined;}catch{return undefined;}};
export type AnalyticsScope={tenantId:string;workspaceId:string;global:boolean;ownerUserIds:string[];teamIds:string[]};
export type AnalyticsFilters={siteId?:string;productId?:string;categoryId?:string;source?:string;campaign?:string};
export type AnalyticsPeriod="today"|"yesterday"|"7d"|"30d"|"custom";
export type AnalyticsRange={from:string;to:string;timezone:string;start:string;end:string};
const invalid=(message:string):never=>{throw Error(`SITE_ANALYTICS_VALIDATION: ${message}`);};
const nextDate=(value:string,days:number)=>new Date(Date.parse(value+"T12:00:00Z")+days*86400000).toISOString().slice(0,10);
const validateDate=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+"T00:00:00Z"))||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)invalid("Data inválida.");return value;};
/** Calendar boundaries in the selected IANA timezone, including 23/25-hour DST days. */
export function analyticsRange(input:{period?:AnalyticsPeriod;from?:string;to?:string;timezone?:string},now=new Date()):AnalyticsRange{
 const timezone=input.timezone??"America/Sao_Paulo";let format:Intl.DateTimeFormat;
 try{format=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"});}catch{return invalid("Fuso horário inválido.");}
 const localDate=(time:number)=>{const p=Object.fromEntries(format.formatToParts(time).map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day}`;};
 const today=localDate(now.getTime()),period=input.period??"30d";
 const to=period==="custom"?validateDate(input.to??""):period==="yesterday"?nextDate(today,-1):today;
 const from=period==="custom"?validateDate(input.from??""):period==="7d"?nextDate(to,-6):period==="30d"?nextDate(to,-29):to;
 if(from>to||(Date.parse(to)-Date.parse(from))/86400000>365)invalid("Escolha um período de até 366 dias, com início anterior ao fim.");
 const boundary=(date:string)=>{const base=Date.parse(date+"T00:00:00Z");let low=base-36*3600000,high=base+36*3600000;while(low<high){const mid=Math.floor((low+high)/2);if(localDate(mid)<date)low=mid+1;else high=mid;}if(localDate(low)!==date)invalid("Esta data não existe no fuso escolhido.");return new Date(low).toISOString();};
 return {from,to,timezone,start:boundary(from),end:boundary(nextDate(to,1))};
}
export function conversionRate(numerator:number,denominator:number):number|null{return Number.isFinite(numerator)&&Number.isFinite(denominator)&&denominator>0&&numerator>=0&&numerator<=denominator?Math.round(numerator*10000/denominator)/100:null;}
export type AnalyticsMetric={count:number;visitors:number};
export type AnalyticsGroup={key:string;label:string;metrics:Record<string,AnalyticsMetric>;revenue:Record<string,number>;utm?:{source?:string;medium?:string;campaign?:string;content?:string;term?:string};referrer?:string};
export type SiteAnalyticsReport={range:AnalyticsRange;scope:"workspace"|"team_or_own";metrics:Record<string,AnalyticsMetric>;revenue:Record<string,number>;funnel:{key:string;label:string;visitors:number}[];conversions:{key:string;label:string;numerator:number;denominator:number;rate:number|null}[];series:AnalyticsGroup[];products:AnalyticsGroup[];acquisition:AnalyticsGroup[];productTotal:number;acquisitionTotal:number;leads:{id:string;reference:string;type:string;contactId?:string;dealId?:string;createdAt:string}[];empty:boolean;futureData:boolean;notes:string[]};
