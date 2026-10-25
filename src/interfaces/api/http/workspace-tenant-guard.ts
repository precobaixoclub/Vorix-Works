import type { FastifyInstance } from "fastify";
import type { WorkspaceRepositoryPort } from "../../../application/ports/workspace-repository.port.js";
import { NotFoundError } from "./app-error.js";

/** All authenticated business endpoints share the same tenant boundary, including writes that
 * otherwise only check a workspace foreign key. Public and platform-admin endpoints have their
 * own authentication and resource guards. */
export function registerWorkspaceTenantGuard(app: FastifyInstance, repository: WorkspaceRepositoryPort): void {
  app.addHook("preHandler", async request => {
    const principal = request.zunoContext?.principal;
    if (!principal || /^\/(?:v1\/)?admin(?:\/|$)/.test(request.routeOptions.url ?? "")) return;
    const sources = [request.params, request.query, request.body] as (Record<string, unknown> | undefined)[];
    const ids = new Set(sources.map(source => source?.workspaceId).filter((id): id is string => typeof id === "string" && id.length > 0));
    for (const id of ids) {
      const workspace = await repository.getById(id);
      if (!workspace || workspace.tenantId !== principal.tenantId) throw new NotFoundError("Workspace não encontrado.");
    }
  });
}
