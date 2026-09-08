import { computeLeadScore } from "./lead-scoring.js";
import { mustContactBelongToTenantAndWorkspace } from "./contact-use-cases.js";
import type { ContactRepositoryPort } from "../ports/contact-repository.port.js";
import type { ContactIdentityRepositoryPort } from "../ports/contact-identity-repository.port.js";
import type { DealRepositoryPort } from "../ports/deal-repository.port.js";
import type { TaskRepositoryPort } from "../ports/task-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import type { LeadScore } from "../../domain/crm/crm.model.js";

export type LeadScoringUseCaseDeps = {
  contactRepository: ContactRepositoryPort;
  contactIdentityRepository: ContactIdentityRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  dealRepository: DealRepositoryPort;
  taskRepository: TaskRepositoryPort;
};

export async function getLeadScore(deps: LeadScoringUseCaseDeps, input: { contactId: string; tenantId: string; workspaceId: string }): Promise<LeadScore> {
  const contact = await mustContactBelongToTenantAndWorkspace(deps, input.contactId, input.tenantId, input.workspaceId);
  const [deals, tasks] = await Promise.all([
    deps.dealRepository.listByWorkspace({ tenantId: input.tenantId, workspaceId: input.workspaceId, contactId: contact.id }),
    deps.taskRepository.listByWorkspace({ tenantId: input.tenantId, workspaceId: input.workspaceId, contactId: contact.id }),
  ]);
  return computeLeadScore({ contact, deals, tasks });
}
