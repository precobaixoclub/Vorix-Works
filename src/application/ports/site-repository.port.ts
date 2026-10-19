import type { Site,SiteDomain,SiteSnapshot } from "../../domain/sites/site.model.js";
export type SiteRepositoryPort={
 list(tenantId:string,workspaceId:string):Promise<Site[]>;
 get(id:string):Promise<Site|undefined>;
 findPublic(input:{slug?:string;hostname?:string}):Promise<Site|undefined>;
 create(input:{tenantId:string;workspaceId:string;slug:string;draft:SiteSnapshot}):Promise<Site>;
 saveDraft(input:{id:string;tenantId:string;revision:number;draft:SiteSnapshot;actorUserId?:string}):Promise<Site|undefined>;
 publish(input:{id:string;tenantId:string;revision:number;actorUserId:string;unpublish?:boolean}):Promise<Site|undefined>;
 domains(siteId:string,tenantId:string):Promise<SiteDomain[]>;
 claimDomain(input:{siteId:string;tenantId:string;hostname:string}):Promise<SiteDomain|undefined>;
 verifyDomain(input:{id:string;siteId:string;tenantId:string;challenge:string}):Promise<SiteDomain|undefined>;
 removeDomain(input:{id:string;siteId:string;tenantId:string}):Promise<void>;
 addInquiry(input:{site:Site;name:string;email?:string;phone?:string;message:string;productId?:string;variantId?:string;requestKey:string}):Promise<{id:string}>;
};
