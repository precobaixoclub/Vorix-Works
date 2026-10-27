import type { ExternalListing, ExternalAttribute, MarketplaceConnection, PublishDraft } from "../../domain/marketplaces/marketplace.model.js";
export type MarketplaceTokens = { accessToken: string; refreshToken: string; expiresAt: string; userId: string };
export type CategoryAttribute={id:string;name:string;required:boolean;variation:boolean;values?:{id:string;name:string}[]};
export type CategoryRequirements = { id: string; name: string; leaf: boolean; allowed: boolean; attributes: CategoryAttribute[]; saleTerms?:CategoryAttribute[] };
export type ListingWrite = { draft: PublishDraft; priceCents: number; quantity: number; currency: string; sku?: string; userProducts: boolean; correlation: string; variants?: {id?:string;sku?:string;priceCents:number;quantity:number;attributes:ExternalAttribute[]}[] };
export interface MarketplaceProvider {
  readonly id: "MERCADO_LIVRE";
  authorizationUrl(state:string,challenge:string):string;
  connect(code:string,verifier:string):Promise<MarketplaceTokens>;
  refreshConnection(refreshToken:string):Promise<MarketplaceTokens>;
  disconnect(token:string,userId:string):Promise<void>;
  account(token:string):Promise<{id:string;name:string;siteId:string;userProducts:boolean}>;
  listExternalProducts(token:string,userId:string,cursor?:string):Promise<{ids:string[];cursor?:string;total:number}>;
  getListing(token:string,id:string):Promise<ExternalListing>;
  category(token:string,id:string):Promise<CategoryRequirements>;
  validateListing(token:string,input:ListingWrite):Promise<string[]>;
  createListing(token:string,input:ListingWrite):Promise<ExternalListing>;
  updateListing(token:string,id:string,input:Partial<PublishDraft>,userProducts:boolean):Promise<void>;
  setStatus(token:string,id:string,status:"paused"|"active"|"closed"):Promise<void>;
  syncPrice(token:string,id:string,priceCents:number):Promise<void>;
  syncStock(token:string,id:string,quantity:number,variants?:{id:string;quantity:number}[]):Promise<void>;
}
