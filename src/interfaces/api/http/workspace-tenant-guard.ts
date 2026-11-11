import type { FastifyInstance } from "fastify";
import type { WorkspaceRepositoryPort } from "../../../application/ports/workspace-repository.port.js";
import type { AuthPrincipal } from "../../../domain/identity/identity.model.js";
import { ForbiddenError, NotFoundError } from "./app-error.js";

/** `workspaceIds` ausente = todos os espaços da empresa (padrão e dono da conta). */
export function canAccessWorkspace(principal: Pick<AuthPrincipal, "workspaceIds">, workspaceId: string): boolean {
  return !principal.workspaceIds || principal.workspaceIds.includes(workspaceId);
}

/** All authenticated business endpoints share the same tenant boundary, including writes that
 * otherwise only check a workspace foreign key. Public and platform-admin endpoints have their
 * own authentication and resource guards.
 *
 * It also applies per-person workspace access (`principal.workspaceIds`, migration 0196): a
 * workspace outside that list answers exactly like a workspace of another account. */
export function registerWorkspaceTenantGuard(app: FastifyInstance, repository: WorkspaceRepositoryPort): void {
  app.addHook("preHandler", async request => {
    const principal = request.zunoContext?.principal;
    if (!principal || /^\/(?:v1\/)?admin(?:\/|$)/.test(request.routeOptions.url ?? "")) return;
    const sources = [request.params, request.query, request.body] as (Record<string, unknown> | undefined)[];
    const ids = new Set(sources.map(source => source?.workspaceId).filter((id): id is string => typeof id === "string" && id.length > 0));
    // `/workspaces/:id/...` names the workspace `id`. Those routes already check the tenant and
    // must still activate inactive workspaces, so only the per-person access applies here.
    const routeId = (request.params as Record<string, unknown> | undefined)?.id;
    if (/^\/(?:v1\/)?workspaces\/:id(?:\/|$)/.test(request.routeOptions.url ?? "") && typeof routeId === "string" && !canAccessWorkspace(principal, routeId)) {
      throw new NotFoundError("Workspace não encontrado.");
    }
    for (const id of ids) {
      const workspace = await repository.getById(id);
      if (!workspace || workspace.tenantId !== principal.tenantId || !canAccessWorkspace(principal, id)) throw new NotFoundError("Workspace não encontrado.");
      if (workspace.status !== "active" && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        throw new ForbiddenError("WORKSPACE_INACTIVE: ative o espaço de trabalho antes de fazer alterações. Os dados foram preservados.");
      }
    }
  });
}
