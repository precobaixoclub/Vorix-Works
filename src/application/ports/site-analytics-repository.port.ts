import type {AnalyticsScope,AnalyticsFilters,AnalyticsRange,SiteAnalyticsReport} from "../../domain/sites/site-analytics.js";
export type SiteAnalyticsQuery={scope:AnalyticsScope;filters:AnalyticsFilters;range:AnalyticsRange;offset:number;limit:number;sort:"views"|"visitors"|"whatsapp"|"cart"|"intents"|"opportunities"|"sales"|"revenue"};
export type SiteAnalyticsRepositoryPort={
 report(input:SiteAnalyticsQuery):Promise<SiteAnalyticsReport>;
 journey(input:SiteAnalyticsQuery&{intentId:string}):Promise<{reference:string;contactId?:string;conversationId?:string;attendanceId?:string;dealId?:string;identityAmbiguous:boolean;events:{type:string;at:string;productId?:string;productName?:string;path?:string}[]}|undefined>;
};
