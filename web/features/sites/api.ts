import {apiClient} from "@/lib/api-client";
import type {TenantSite,SiteDomain,SiteSnapshot,PublicTenantSite,SiteCommerceSettings,SalesIntentSummary} from "./types";
const q=encodeURIComponent;
export const listSites=(workspaceId:string)=>apiClient.get<{sites:TenantSite[];publicBaseDomain?:string;customDomainTarget?:string|null}>(`/v1/sites?workspaceId=${q(workspaceId)}`);
export const createSite=(workspaceId:string,slug:string,draft:SiteSnapshot)=>apiClient.post<TenantSite>(`/v1/sites?workspaceId=${q(workspaceId)}`,{slug,draft});
export const saveSite=(site:TenantSite,draft:SiteSnapshot)=>apiClient.put<TenantSite>(`/v1/sites/${q(site.id)}?workspaceId=${q(site.workspaceId)}`,{revision:site.revision,draft});
export const publishSite=(site:TenantSite,unpublish=false)=>apiClient.post<TenantSite>(`/v1/sites/${q(site.id)}/publish?workspaceId=${q(site.workspaceId)}`,{revision:site.revision,unpublish});
export const previewSite=(site:TenantSite)=>apiClient.get<PublicTenantSite>(`/v1/sites/${q(site.id)}/preview?workspaceId=${q(site.workspaceId)}`);
export const uploadSiteImage=(site:TenantSite,file:File)=>{const data=new FormData();data.append("file",file);return apiClient.upload<{url:string}>(`/v1/sites/${q(site.id)}/images?workspaceId=${q(site.workspaceId)}`,data);};
export const changeSiteSlug=(site:TenantSite,slug:string)=>apiClient.put<TenantSite>(`/v1/sites/${q(site.id)}/slug?workspaceId=${q(site.workspaceId)}`,{slug});
export const listDomains=(site:TenantSite)=>apiClient.get<SiteDomain[]>(`/v1/sites/${q(site.id)}/domains?workspaceId=${q(site.workspaceId)}`);
export const claimDomain=(site:TenantSite,hostname:string)=>apiClient.post<SiteDomain>(`/v1/sites/${q(site.id)}/domains?workspaceId=${q(site.workspaceId)}`,{hostname});
export const verifyDomain=(site:TenantSite,domain:SiteDomain)=>apiClient.post<SiteDomain>(`/v1/sites/${q(site.id)}/domains/${q(domain.id)}/verify?workspaceId=${q(site.workspaceId)}`,{});
export const removeDomain=(site:TenantSite,domain:SiteDomain)=>apiClient.delete<null>(`/v1/sites/${q(site.id)}/domains/${q(domain.id)}?workspaceId=${q(site.workspaceId)}`);
export type SiteCommerceSettingsView={settings:SiteCommerceSettings;configured:boolean;hasWhatsapp:boolean};
export const getSiteCommerce=(site:TenantSite)=>apiClient.get<SiteCommerceSettingsView>(`/v1/sites/${q(site.id)}/commerce?workspaceId=${q(site.workspaceId)}`);
export const saveSiteCommerce=(site:TenantSite,settings:SiteCommerceSettings)=>apiClient.put<SiteCommerceSettingsView>(`/v1/sites/${q(site.id)}/commerce?workspaceId=${q(site.workspaceId)}`,{settings});
export const listSiteSalesIntents=(site:TenantSite)=>apiClient.get<SalesIntentSummary[]>(`/v1/sites/${q(site.id)}/sales-intents?workspaceId=${q(site.workspaceId)}&limit=50`);
// Vorix Commerce, Fase 2 — prontidão da loja online e credenciais do lojista (o token nunca volta).
export type CheckoutStatusView={ready:boolean;missing:string[];sandboxAllowed:boolean;credentials:{MERCADO_PAGO:{connected:boolean;publicKey?:string;webhookConfigured?:boolean};MELHOR_ENVIO:{connected:boolean}}};
export const getCheckoutStatus=(site:TenantSite,draft=false)=>apiClient.get<CheckoutStatusView>(`/v1/sites/${q(site.id)}/commerce/checkout-status?workspaceId=${q(site.workspaceId)}${draft?"&draft=1":""}`);
export const saveCommerceCredential=(site:TenantSite,provider:"MERCADO_PAGO"|"MELHOR_ENVIO",input:{accessToken?:string;publicKey?:string;webhookSecret?:string})=>apiClient.put<{connected:boolean}>(`/v1/sites/${q(site.id)}/commerce/credentials/${provider}?workspaceId=${q(site.workspaceId)}`,input);

export const getSiteCommerceDraft=(site:TenantSite)=>apiClient.get<import("./types").SiteCommerceDraft>(`/v1/sites/${q(site.id)}/commerce-draft?workspaceId=${q(site.workspaceId)}`);
// Pacote de Modelo Vorix: validar (não grava), importar (só sem erros), listar, detalhar e remover.
const templatePackageForm=(file:File)=>{const data=new FormData();data.append("file",file);return data;};
export const validateTemplatePackage=(site:TenantSite,file:File)=>apiClient.upload<{report:import("./imported-template").TemplateReport}>(`/v1/sites/${q(site.id)}/template-packages/validate?workspaceId=${q(site.workspaceId)}`,templatePackageForm(file));
export const importTemplatePackage=(site:TenantSite,file:File)=>apiClient.upload<{imported:boolean;report:import("./imported-template").TemplateReport;template?:import("./imported-template").ImportedTemplateSummary}>(`/v1/sites/${q(site.id)}/template-packages?workspaceId=${q(site.workspaceId)}`,templatePackageForm(file));
export const listImportedTemplates=(site:TenantSite)=>apiClient.get<import("./imported-template").ImportedTemplateSummary[]>(`/v1/sites/${q(site.id)}/template-packages?workspaceId=${q(site.workspaceId)}`);
export const getImportedTemplate=(site:TenantSite,id:string)=>apiClient.get<import("./imported-template").ImportedTemplateDetail>(`/v1/sites/${q(site.id)}/template-packages/${q(id)}?workspaceId=${q(site.workspaceId)}`);
export const removeImportedTemplate=(site:TenantSite,id:string)=>apiClient.delete<null>(`/v1/sites/${q(site.id)}/template-packages/${q(id)}?workspaceId=${q(site.workspaceId)}`);
