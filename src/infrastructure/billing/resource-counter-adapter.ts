import type { ResourceCounterPort } from "../../application/ports/resource-counter.port.js";
import type { TenantMembershipRepositoryPort } from "../../application/ports/tenant-membership-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../application/ports/workspace-repository.port.js";
import type { MessagingConnectionRepositoryPort } from "../../application/ports/messaging-connection-repository.port.js";
import type { ContactRepositoryPort } from "../../application/ports/contact-repository.port.js";
import type { AutomationRuleRepositoryPort } from "../../application/ports/automation-rule-repository.port.js";
import type { PlanLimitResource } from "../../domain/platform-billing/plan-entitlements.model.js";

/**
 * Único adapter concreto de `ResourceCounterPort` — SaaS Commercialization, Fase 1. É a
 * composição raiz (`container.ts`) quem constrói isto, porque é o único lugar que já tem acesso
 * legítimo a Identity/Inbox/CRM ao mesmo tempo (mesmo racional de
 * `AiGatewayCommercialCopilotGenerator`). `application/billing/*` nunca vê estes repositórios.
 *
 * `messaging_connections`/`contacts`/`automations` são recursos por WORKSPACE nos seus módulos de
 * origem, mas o plano é por TENANT — soma-se aqui por cima de todos os workspaces do tenant, sem
 * adicionar nenhum método novo em `MessagingConnectionRepositoryPort`/`AutomationRuleRepositoryPort`
 * (que já são não-paginados, então somar o tamanho da lista é uma contagem real). `contacts` é a
 * única exceção — `ContactRepositoryPort.listByWorkspace` é paginado, por isso ganhou um
 * `countByWorkspace` dedicado.
 */
export class DefaultResourceCounterAdapter implements ResourceCounterPort {
  constructor(
    private readonly deps: {
      tenantMembershipRepository: TenantMembershipRepositoryPort;
      workspaceRepository: WorkspaceRepositoryPort;
      messagingConnectionRepository: MessagingConnectionRepositoryPort;
      contactRepository: ContactRepositoryPort;
      automationRuleRepository: AutomationRuleRepositoryPort;
    },
  ) {}

  async count(input: { tenantId: string; resource: PlanLimitResource }): Promise<number | undefined> {
    switch (input.resource) {
      case "users": {
        const members = await this.deps.tenantMembershipRepository.listByTenant(input.tenantId);
        return members.length;
      }
      case "workspaces": {
        const workspaces = await this.deps.workspaceRepository.listByTenant(input.tenantId);
        return workspaces.filter((workspace) => workspace.status !== "archived").length;
      }
      case "messaging_connections": {
        const workspaces = await this.deps.workspaceRepository.listByTenant(input.tenantId);
        const counts = await Promise.all(
          workspaces.map((workspace) => this.deps.messagingConnectionRepository.listByWorkspace({ tenantId: input.tenantId, workspaceId: workspace.id })),
        );
        return counts.reduce((sum, list) => sum + list.length, 0);
      }
      case "contacts": {
        const workspaces = await this.deps.workspaceRepository.listByTenant(input.tenantId);
        const counts = await Promise.all(
          workspaces.map((workspace) => this.deps.contactRepository.countByWorkspace({ tenantId: input.tenantId, workspaceId: workspace.id })),
        );
        return counts.reduce((sum, count) => sum + count, 0);
      }
      case "automations": {
        const workspaces = await this.deps.workspaceRepository.listByTenant(input.tenantId);
        const counts = await Promise.all(
          workspaces.map((workspace) => this.deps.automationRuleRepository.listByWorkspace(input.tenantId, workspace.id)),
        );
        return counts.reduce((sum, list) => sum + list.length, 0);
      }
      default:
        return undefined;
    }
  }
}
