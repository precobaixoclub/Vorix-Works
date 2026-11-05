import {apiClient} from "@/lib/api-client";
import type {TenantSite} from "@/features/sites/types";
export type {CommercialRule,CommercialRuleInput,AppliedCommercialRule,RuleProgress} from "./rule-types";
import type {CommercialRule,CommercialRuleInput} from "./rule-types";
const endpoint=(site:TenantSite)=>`/v1/sites/${encodeURIComponent(site.id)}/commercial-rules`;
const query=(site:TenantSite)=>`workspaceId=${encodeURIComponent(site.workspaceId)}`;
export const listCommercialRules=(site:TenantSite)=>apiClient.get<CommercialRule[]>(`${endpoint(site)}?${query(site)}`);
export const saveCommercialRule=(site:TenantSite,definition:CommercialRuleInput,existing?:CommercialRule)=>existing?apiClient.put<CommercialRule>(`${endpoint(site)}/${encodeURIComponent(existing.id)}?${query(site)}`,{definition,revision:existing.revision}):apiClient.post<CommercialRule>(`${endpoint(site)}?${query(site)}`,{definition});
export const deleteCommercialRule=(site:TenantSite,rule:CommercialRule)=>apiClient.delete<{deleted:true}>(`${endpoint(site)}/${encodeURIComponent(rule.id)}?${query(site)}&revision=${rule.revision}`);
export function ruleDefinition(rule:CommercialRule):CommercialRuleInput{const {id:_id,revision:_revision,tenantId:_tenant,workspaceId:_workspace,siteId:_site,createdAt:_created,updatedAt:_updated,...definition}=rule;return definition;}
