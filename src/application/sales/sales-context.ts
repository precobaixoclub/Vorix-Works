import type { DealRepositoryPort } from "../ports/deal-repository.port.js";
import type { PipelineStageRepositoryPort } from "../ports/pipeline-repository.port.js";
import type { ProductRepositoryPort } from "../ports/product-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import type { TaskRepositoryPort } from "../ports/task-repository.port.js";
import type { ContactRepositoryPort } from "../ports/contact-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../ports/tenant-membership-repository.port.js";
import type { TeamMembershipRepositoryPort } from "../ports/team-repository.port.js";
import type { CommercialApprovalRepositoryPort, DealItemRepositoryPort, SalesCatalogRepositoryPort, SalesConfigRepositoryPort } from "../ports/sales-engine-repository.port.js";
import type { NotificationUseCaseDeps } from "../notification/notification-use-cases.js";
import type { AutomationUseCaseDeps } from "../crm/automation-use-cases.js";
import { hasPermission, type TenantRole } from "../../domain/identity/identity.model.js";
import type { CommercialPolicy, CommercialSettings } from "../../domain/sales/sales.model.js";
import type { EffectiveCommercialPolicy } from "../../domain/sales/pricing.js";
import type { Deal } from "../../domain/crm/crm.model.js";

/** Dependências do Sales Engine — reaproveita os repositórios do CRM existente (Deal/Product/
 * Stage/Timeline/Task) e só acrescenta o que é novo (itens, catálogo estendido, configuração e
 * aprovações). Notificação/automação são opcionais: sem elas o fluxo funciona igual, só não avisa. */
export type SalesEngineDeps = {
  dealRepository: DealRepositoryPort;
  pipelineStageRepository: PipelineStageRepositoryPort;
  productRepository: ProductRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  dealItemRepository: DealItemRepositoryPort;
  salesCatalogRepository: SalesCatalogRepositoryPort;
  salesConfigRepository: SalesConfigRepositoryPort;
  approvalRepository: CommercialApprovalRepositoryPort;
  membershipRepository: TenantMembershipRepositoryPort;
  teamMembershipRepository: TeamMembershipRepositoryPort;
  taskRepository?: TaskRepositoryPort;
  contactRepository?: ContactRepositoryPort;
  notification?: Partial<NotificationUseCaseDeps>;
  automation?: AutomationUseCaseDeps;
};

/** Quem está agindo — sempre vindo do JWT (nunca do corpo da requisição). */
export type SalesActor = { tenantId: string; userId: string; role: TenantRole };

export const isSalesManager = (role: TenantRole): boolean => role === "owner" || role === "admin";

export function defaultCommercialSettings(tenantId: string, workspaceId: string): CommercialSettings {
  return {
    workspaceId,
    tenantId,
    sellersCanViewCost: false,
    sellersCanViewMargin: true,
    dealVisibility: "all",
    proposalAcceptAutoWin: false,
    rankingEnabled: false,
    updatedAt: new Date(0).toISOString(),
  };
}

export async function loadCommercialSettings(deps: Pick<SalesEngineDeps, "salesConfigRepository">, tenantId: string, workspaceId: string): Promise<CommercialSettings> {
  const settings = await deps.salesConfigRepository.getSettings(workspaceId);
  return settings && settings.tenantId === tenantId ? settings : defaultCommercialSettings(tenantId, workspaceId);
}

export type SalesVisibility = { canViewCost: boolean; canViewMargin: boolean; isManager: boolean };

/** Custo/margem: admin/owner sempre (RBAC); editor conforme a configuração do workspace; viewer nunca. */
export function resolveVisibility(actor: SalesActor, settings: CommercialSettings): SalesVisibility {
  const editor = actor.role === "editor";
  return {
    canViewCost: hasPermission(actor.role, "product:view_cost") || (editor && settings.sellersCanViewCost),
    canViewMargin: hasPermission(actor.role, "deal:view_margin") || (editor && settings.sellersCanViewMargin),
    isManager: isSalesManager(actor.role),
  };
}

/** Escopo de leitura de oportunidades conforme `dealVisibility` — gestão sempre vê tudo. */
export async function resolveDealScope(deps: Pick<SalesEngineDeps, "salesConfigRepository" | "teamMembershipRepository">, actor: SalesActor, workspaceId: string): Promise<{ ownerUserIdsIn?: string[]; teamIdsIn?: string[] }> {
  if (isSalesManager(actor.role)) return {};
  const settings = await loadCommercialSettings(deps, actor.tenantId, workspaceId);
  if (settings.dealVisibility === "all") return {};
  if (settings.dealVisibility === "own") return { ownerUserIdsIn: [actor.userId] };
  const teams = await deps.teamMembershipRepository.listByUser(actor.userId);
  return { ownerUserIdsIn: [actor.userId], teamIdsIn: teams.map((membership) => membership.teamId) };
}

export function dealVisibleInScope(deal: Deal, scope: { ownerUserIdsIn?: string[]; teamIdsIn?: string[] }): boolean {
  if (!scope.ownerUserIdsIn && !scope.teamIdsIn) return true;
  return Boolean((deal.ownerUserId && scope.ownerUserIdsIn?.includes(deal.ownerUserId)) || (deal.teamId && scope.teamIdsIn?.includes(deal.teamId)));
}

/** Política efetiva — a mais específica vence: usuário > equipe (a mais permissiva entre as
 * equipes do vendedor) > papel > workspace. Campo ausente na camada específica herda da geral. */
export async function resolveEffectivePolicy(deps: Pick<SalesEngineDeps, "salesConfigRepository" | "membershipRepository" | "teamMembershipRepository">, input: { tenantId: string; workspaceId: string; userId?: string }): Promise<EffectiveCommercialPolicy> {
  const policies = await deps.salesConfigRepository.listPolicies({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  if (policies.length === 0) return { allowBelowMinimum: false, source: "none" };
  const layers: { policy: CommercialPolicy; source: EffectiveCommercialPolicy["source"] }[] = [];
  const workspacePolicy = policies.find((policy) => policy.scopeType === "workspace");
  if (workspacePolicy) layers.push({ policy: workspacePolicy, source: "workspace" });
  if (input.userId) {
    const membership = await deps.membershipRepository.getByUserAndTenant(input.userId, input.tenantId);
    const rolePolicy = membership ? policies.find((policy) => policy.scopeType === "role" && policy.scopeId === membership.role) : undefined;
    if (rolePolicy) layers.push({ policy: rolePolicy, source: "role" });
    const teamIds = new Set((await deps.teamMembershipRepository.listByUser(input.userId)).map((membershipRow) => membershipRow.teamId));
    const teamPolicies = policies.filter((policy) => policy.scopeType === "team" && policy.scopeId && teamIds.has(policy.scopeId));
    if (teamPolicies.length > 0) {
      const minMargins = teamPolicies.map((policy) => policy.minMarginBp).filter((value): value is number => value !== undefined);
      const maxDiscounts = teamPolicies.map((policy) => policy.maxDiscountBp).filter((value): value is number => value !== undefined);
      layers.push({
        source: "team",
        policy: {
          ...teamPolicies[0],
          minMarginBp: minMargins.length ? Math.min(...minMargins) : undefined,
          maxDiscountBp: maxDiscounts.length ? Math.max(...maxDiscounts) : undefined,
          allowBelowMinimum: teamPolicies.some((policy) => policy.allowBelowMinimum),
        },
      });
    }
    const userPolicy = policies.find((policy) => policy.scopeType === "user" && policy.scopeId === input.userId);
    if (userPolicy) layers.push({ policy: userPolicy, source: "user" });
  }
  const effective: EffectiveCommercialPolicy = { allowBelowMinimum: false, source: "none" };
  for (const layer of layers) {
    if (layer.policy.minMarginBp !== undefined) effective.minMarginBp = layer.policy.minMarginBp;
    if (layer.policy.maxDiscountBp !== undefined) effective.maxDiscountBp = layer.policy.maxDiscountBp;
    effective.allowBelowMinimum = layer.policy.allowBelowMinimum;
    effective.source = layer.source;
  }
  return effective;
}

/** Guard de tenant/workspace — nunca 403, sempre 404 (mesmo padrão do CRM). */
export async function mustDealInWorkspace(deps: Pick<SalesEngineDeps, "dealRepository">, dealId: string, tenantId: string, workspaceId: string): Promise<Deal> {
  const deal = await deps.dealRepository.getById(dealId);
  if (!deal || deal.tenantId !== tenantId || deal.workspaceId !== workspaceId) throw new Error(`DEAL_NOT_FOUND: oportunidade "${dealId}" não existe.`);
  return deal;
}

/** Gestores do tenant (owner/admin) — destinatários de pedidos de aprovação. */
export async function listManagerUserIds(deps: Pick<SalesEngineDeps, "membershipRepository">, tenantId: string): Promise<string[]> {
  const memberships = await deps.membershipRepository.listByTenant(tenantId);
  return memberships.filter((membership) => isSalesManager(membership.role)).map((membership) => membership.userId);
}
