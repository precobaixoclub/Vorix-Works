import { assertValidWorkspaceTransition } from "../../domain/workspace/workspace.model.js";
import type { Workspace, WorkspaceSettings, WorkspaceStatus } from "../../domain/workspace/workspace.model.js";
import { getPlatformPlan } from "../../domain/platform-billing/index.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import type { PlatformBillingRepositoryPort } from "../ports/platform-billing-repository.port.js";

/**
 * Casos de uso de Workspace — Sprint 03 (Fase 6). Camada `application`, sem nenhuma dependência
 * de HTTP/Fastify — o handler de rota (`src/interfaces/api/routes/v1/workspaces.route.ts`) chama
 * estas funções e nunca toca `WorkspaceRepositoryPort` diretamente. Erros são `Error` simples com
 * prefixo reconhecível (`WORKSPACE_NOT_FOUND`, `WORKSPACE_VALIDATION_ERROR`,
 * `WORKSPACE_INVALID_TRANSITION`, `WORKSPACE_LIMIT_EXCEEDED`) — a tradução para status
 * HTTP/envelope de erro é responsabilidade da camada HTTP (ver `translateWorkspaceError`), nunca
 * desta camada.
 *
 * `tenantId` é SEMPRE recebido como parâmetro explícito (nunca lido do corpo da requisição pelo
 * caso de uso) — quem decide o valor é a rota, a partir de `request.zunoContext`, nunca o cliente.
 * `mustBelongToTenant` devolve a MESMA mensagem de erro para "não existe" e "existe mas é de
 * outro tenant" — nunca confirma para quem não tem acesso que um Workspace de outro tenant existe.
 *
 * `platformBillingRepository` é opcional: só existe em modo `AUTH_MODE=jwt` (Sprint 25). Sem ele
 * (modo noop/testes), a criação de Workspace não é limitada por plano — mesmo comportamento de
 * antes desta checagem existir.
 */
export type WorkspaceUseCaseDeps = {
  workspaceRepository: WorkspaceRepositoryPort;
  platformBillingRepository?: PlatformBillingRepositoryPort;
};

async function mustBelongToTenant(repository: WorkspaceRepositoryPort, id: string, tenantId: string): Promise<Workspace> {
  const workspace = await repository.getById(id);
  if (!workspace || workspace.tenantId !== tenantId) {
    throw new Error(`WORKSPACE_NOT_FOUND: workspace "${id}" não existe.`);
  }
  return workspace;
}

export type CreateWorkspaceUseCaseInput = { tenantId: string; name: string; kind?: string };

export async function createWorkspace(deps: WorkspaceUseCaseDeps, input: CreateWorkspaceUseCaseInput): Promise<Workspace> {
  if (!input.tenantId) throw new Error("WORKSPACE_VALIDATION_ERROR: tenantId é obrigatório.");
  const name = input.name?.trim();
  if (!name) throw new Error("WORKSPACE_VALIDATION_ERROR: name é obrigatório.");

  if (deps.platformBillingRepository) {
    // Tenants criados fora do signup público (ex.: provisionamento interno/testes) podem não ter
    // linha em tenant_billing ainda — nesse caso não há plano para aplicar, então não limitamos
    // (mesmo comportamento de quando `platformBillingRepository` nem está configurado).
    const billing = await deps.platformBillingRepository.getTenantBilling(input.tenantId);
    const plan = billing ? getPlatformPlan(billing.planCode) : undefined;
    if (plan && plan.maxWorkspaces !== null) {
      const existing = await deps.workspaceRepository.listByTenant(input.tenantId);
      const activeCount = existing.filter((workspace) => workspace.status !== "archived").length;
      if (activeCount >= plan.maxWorkspaces) {
        throw new Error(`WORKSPACE_LIMIT_EXCEEDED: o plano ${plan.name} permite no máximo ${plan.maxWorkspaces} workspace(s). Faça upgrade para criar mais.`);
      }
    }
  }

  return deps.workspaceRepository.create({ tenantId: input.tenantId, name, kind: input.kind?.trim() || undefined });
}

export type ListWorkspacesUseCaseInput = { tenantId: string; status?: WorkspaceStatus };

export async function listWorkspaces(deps: WorkspaceUseCaseDeps, input: ListWorkspacesUseCaseInput): Promise<Workspace[]> {
  if (!input.tenantId) throw new Error("WORKSPACE_VALIDATION_ERROR: tenantId é obrigatório.");
  return deps.workspaceRepository.listByTenant(input.tenantId, input.status ? { status: input.status } : undefined);
}

export type GetWorkspaceUseCaseInput = { tenantId: string; id: string };

export async function getWorkspace(deps: WorkspaceUseCaseDeps, input: GetWorkspaceUseCaseInput): Promise<Workspace> {
  return mustBelongToTenant(deps.workspaceRepository, input.id, input.tenantId);
}

export type UpdateWorkspaceUseCaseInput = { tenantId: string; id: string; name?: string; kind?: string; settings?: WorkspaceSettings };

export async function updateWorkspace(deps: WorkspaceUseCaseDeps, input: UpdateWorkspaceUseCaseInput): Promise<Workspace> {
  await mustBelongToTenant(deps.workspaceRepository, input.id, input.tenantId);
  if (input.name !== undefined && !input.name.trim()) {
    throw new Error("WORKSPACE_VALIDATION_ERROR: name não pode ser vazio.");
  }

  return deps.workspaceRepository.update(input.id, {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.settings !== undefined ? { settings: input.settings } : {}),
  });
}

export type WorkspaceTransitionUseCaseInput = { tenantId: string; id: string };

export async function activateWorkspace(deps: WorkspaceUseCaseDeps, input: WorkspaceTransitionUseCaseInput): Promise<Workspace> {
  const workspace = await mustBelongToTenant(deps.workspaceRepository, input.id, input.tenantId);
  assertValidWorkspaceTransition(workspace.status, "activate");
  return deps.workspaceRepository.activate(input.id);
}

export async function deactivateWorkspace(deps: WorkspaceUseCaseDeps, input: WorkspaceTransitionUseCaseInput): Promise<Workspace> {
  const workspace = await mustBelongToTenant(deps.workspaceRepository, input.id, input.tenantId);
  assertValidWorkspaceTransition(workspace.status, "deactivate");
  return deps.workspaceRepository.deactivate(input.id);
}

export async function archiveWorkspace(deps: WorkspaceUseCaseDeps, input: WorkspaceTransitionUseCaseInput): Promise<Workspace> {
  const workspace = await mustBelongToTenant(deps.workspaceRepository, input.id, input.tenantId);
  assertValidWorkspaceTransition(workspace.status, "archive");
  return deps.workspaceRepository.archive(input.id);
}
