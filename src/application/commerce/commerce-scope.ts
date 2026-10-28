/**
 * Escopo comercial (Administrador global; Gerente nas equipes gerenciadas; Atendente no que é dele).
 * Mesma régua do Analytics/CRM: o escopo de oportunidades (`deal:view_*`) decide o que a pessoa enxerga
 * e onde pode executar ações sensíveis (cancelar, estornar).
 */
import {resolveAccessContext,readableTeamIds,scopeFor,teamScopeUserIds,type AccessControlDeps} from "../identity/access-control-use-cases.js";
import type {AuthPrincipal} from "../../domain/identity/identity.model.js";
import type {Order} from "../../domain/commerce/order.model.js";

export type CommerceVisibility={global:boolean;teamIds:string[];ownerUserIds:string[]};
export async function commerceVisibility(deps:Pick<AccessControlDeps,"teamMembershipRepository">,principal:Pick<AuthPrincipal,"tenantId"|"userId"|"role"|"permissions"|"isAccountOwner">):Promise<CommerceVisibility>{
 const access=await resolveAccessContext(deps,principal);
 const level=scopeFor(access,"deal");
 if(level==="all")return {global:true,teamIds:[],ownerUserIds:[]};
 if(level==="own")return {global:false,teamIds:[],ownerUserIds:[principal.userId]};
 const teamIds=readableTeamIds(access);
 return {global:false,teamIds,ownerUserIds:[...new Set([principal.userId,...await teamScopeUserIds(deps,access,teamIds)])]};
}
/**
 * Pedido relacionado a equipe/responsável: equipe de atendimento do site (roteamento) ou dono/equipe da
 * oportunidade ganha. Pedido sem vínculo (ex.: marketplace) só para quem tem escopo global.
 */
export async function orderInScope(visibility:CommerceVisibility,order:Order,lookup:{siteTeamId(siteId:string):Promise<string|undefined>;deal(id:string):Promise<{ownerUserId?:string;teamId?:string}|undefined>}):Promise<boolean>{
 if(visibility.global)return true;
 const siteTeam=order.siteId?await lookup.siteTeamId(order.siteId):undefined;
 if(siteTeam&&visibility.teamIds.includes(siteTeam))return true;
 const deal=order.crmDealId?await lookup.deal(order.crmDealId):undefined;
 return !!deal&&((!!deal.ownerUserId&&visibility.ownerUserIds.includes(deal.ownerUserId))||(!!deal.teamId&&visibility.teamIds.includes(deal.teamId)));
}
