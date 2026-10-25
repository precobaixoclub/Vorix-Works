import type { InboxConversationRepositoryPort } from "../../../application/ports/inbox-conversation-repository.port.js";
import type { TeamRepositoryPort } from "../../../application/ports/team-repository.port.js";
import { resolveConversationVisibility } from "../routes/v1/inbox.route.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { hasPermission, type AuthPrincipal } from "../../../domain/identity/identity.model.js";
import { matchesOwnedScope, type OwnedResourceScope } from "../../../application/ports/owned-resource-scope.js";
import type { DealRepositoryPort } from "../../../application/ports/deal-repository.port.js";
import type { ContactRepositoryPort } from "../../../application/ports/contact-repository.port.js";
import type { TaskRepositoryPort } from "../../../application/ports/task-repository.port.js";
import type { ProposalRepositoryPort } from "../../../application/ports/proposal-repository.port.js";
import type { TeamMembershipRepositoryPort } from "../../../application/ports/team-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../../../application/ports/tenant-membership-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../application/ports/workspace-repository.port.js";
import { NotFoundError } from "./app-error.js";
import { requirePrincipal } from "./require-principal.js";

export type CrmAccessDeps = {
  teamRepository: TeamRepositoryPort;
  inboxConversationRepository?: InboxConversationRepositoryPort;
  dealRepository: DealRepositoryPort;
  contactRepository: ContactRepositoryPort;
  taskRepository: TaskRepositoryPort;
  proposalRepository: ProposalRepositoryPort;
  teamMembershipRepository: TeamMembershipRepositoryPort;
  membershipRepository: TenantMembershipRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
};

export async function crmScope(deps: CrmAccessDeps, actor: AuthPrincipal, contacts = false): Promise<OwnedResourceScope> {
  if (hasPermission(actor, "deal:view_all") || (contacts && hasPermission(actor, "inbox:view_all"))) return {};
  if (!hasPermission(actor, "deal:view_team") && !(contacts && hasPermission(actor, "inbox:view_team"))) return { ownerUserIdsIn: [actor.userId] };
  const teamIdsIn = (await deps.teamMembershipRepository.listByUser(actor.userId, actor.tenantId)).filter(m => actor.role !== "admin" || m.role === "owner" || m.role === "admin").map(m => m.teamId);
  const users = new Set([actor.userId]);
  for (const team of teamIdsIn) for (const member of await deps.teamMembershipRepository.listByTeam(team)) users.add(member.userId);
  return { ownUserId: actor.userId, ownerUserIdsIn: [...users], teamIdsIn };
}

/** Apply to every detail/action route, including history, tracking, delivery and media context. */
export function registerCrmAccessGuards(app: FastifyInstance, deps: CrmAccessDeps): void {
  app.addHook("preHandler", async (request: FastifyRequest) => {
    const path = (request.routeOptions.url ?? "").replace(/^\/v1/, "");
    const match = /^\/(contacts|tasks|proposals|deals)(?:\/([^/]+))?(?:\/|$)/.exec(path);
    if (!match) return;
    const actor = requirePrincipal(request);
    const query = request.query as Record<string, unknown>;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const workspaceId = String(body.workspaceId ?? query.workspaceId ?? "");
    const missing = () => { throw new NotFoundError("Registro não encontrado neste escopo."); };
    const workspace = await deps.workspaceRepository.getById(workspaceId);
    if (!workspace || workspace.tenantId !== actor.tenantId) return missing();
    const [scope, contactScope] = await Promise.all([crmScope(deps, actor), crmScope(deps, actor, true)]);
    const visible = async (kind: string, id: string, commercialOnly = false): Promise<void> => {
      const record = kind === "deals" ? await deps.dealRepository.getById(id) : kind === "contacts" ? await deps.contactRepository.getById(id) : kind === "tasks" ? await deps.taskRepository.getById(id) : await deps.proposalRepository.getById(id);
      if (!record || record.tenantId !== actor.tenantId || record.workspaceId !== workspaceId) return missing();
      if (kind === "proposals") {
        const proposal = record as Awaited<ReturnType<ProposalRepositoryPort["getById"]>> & {};
        if (proposal.dealId) return visible("deals", proposal.dealId);
        if (proposal.contactId) return visible("contacts", proposal.contactId, true);
        if (scope.ownerUserIdsIn && (!proposal.createdByUserId || !scope.ownerUserIdsIn.includes(proposal.createdByUserId))) return missing();
      } else if (!matchesOwnedScope(record as { ownerUserId?: string; teamId?: string }, kind === "contacts" && !commercialOnly ? contactScope : scope)) {
        if (kind !== "contacts" || commercialOnly || !deps.inboxConversationRepository) return missing();
        const conversations = await deps.inboxConversationRepository.listByWorkspace({ tenantId: actor.tenantId, workspaceId, contactId: id, visibility: await resolveConversationVisibility(deps, actor) });
        if (!conversations.length) return missing();
      }
    };
    const params = request.params as Record<string, string>;
    if (match[2] === ":id" && params.id) await visible(match[1], params.id);
    // A writable parent/foreign ID must be authorized too; a scoped URL cannot smuggle a
    // foreign opportunity/contact in its body or query string.
    for (const [field, kind] of [["dealId", "deals"], ["contactId", "contacts"]] as const) {
      const id = body[field] ?? query[field];
      if (typeof id === "string" && id) await visible(kind, id);
    }
    if (request.method !== "GET" && ("ownerUserId" in body || "teamId" in body)) {
      const target = { ownerUserId: typeof body.ownerUserId === "string" ? body.ownerUserId : actor.userId, teamId: typeof body.teamId === "string" ? body.teamId : undefined };
      if (!matchesOwnedScope(target, match[1] === "contacts" ? contactScope : scope)) return missing();
      if (target.ownerUserId) {
        const member = await deps.membershipRepository.getByUserAndTenant(target.ownerUserId, actor.tenantId);
        if (!member || member.status === "disabled") return missing();
      }
      if (target.teamId) {
        const team = await deps.teamRepository.getById(target.teamId);
        if (!team || team.tenantId !== actor.tenantId || team.workspaceId !== workspaceId) return missing();
      }
      if (target.teamId && !(await deps.teamMembershipRepository.listByUser(target.ownerUserId, actor.tenantId)).some(m => m.teamId === target.teamId)) return missing();
    }
  });
}
