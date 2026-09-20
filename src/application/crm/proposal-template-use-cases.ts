import type { ProposalTemplateRepositoryPort, ProposalTemplateValues } from "../ports/proposal-template-repository.port.js";
import type { ProposalItem, ProposalTemplate } from "../../domain/crm/crm.model.js";

export type ProposalTemplateUseCaseDeps = { proposalTemplateRepository: ProposalTemplateRepositoryPort };

function normalizeItems(items: readonly ProposalItem[]): ProposalItem[] {
  return items.map((item) => ({
    productId: item.productId,
    name: item.name.trim(),
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    subtotalCents: item.quantity * item.unitPriceCents,
  }));
}

async function mustBelong(deps: ProposalTemplateUseCaseDeps, id: string, tenantId: string, workspaceId: string): Promise<ProposalTemplate> {
  const template = await deps.proposalTemplateRepository.getById(id);
  if (!template || template.tenantId !== tenantId || template.workspaceId !== workspaceId) {
    throw new Error(`PROPOSAL_TEMPLATE_NOT_FOUND: modelo "${id}" não existe.`);
  }
  return template;
}

export function listProposalTemplates(deps: ProposalTemplateUseCaseDeps, input: { tenantId: string; workspaceId: string; activeOnly?: boolean }) {
  return deps.proposalTemplateRepository.listByWorkspace(input);
}

export function createProposalTemplate(deps: ProposalTemplateUseCaseDeps, input: ProposalTemplateValues & { tenantId: string; workspaceId: string }) {
  return deps.proposalTemplateRepository.create({ ...input, defaultItems: normalizeItems(input.defaultItems) });
}

export async function updateProposalTemplate(deps: ProposalTemplateUseCaseDeps, input: { id: string; tenantId: string; workspaceId: string; patch: Partial<ProposalTemplateValues> }) {
  await mustBelong(deps, input.id, input.tenantId, input.workspaceId);
  return deps.proposalTemplateRepository.update(input.id, { ...input.patch, defaultItems: input.patch.defaultItems ? normalizeItems(input.patch.defaultItems) : undefined });
}

export async function duplicateProposalTemplate(deps: ProposalTemplateUseCaseDeps, input: { id: string; tenantId: string; workspaceId: string }) {
  const source = await mustBelong(deps, input.id, input.tenantId, input.workspaceId);
  return deps.proposalTemplateRepository.create({
    tenantId: source.tenantId,
    workspaceId: source.workspaceId,
    name: `${source.name} (cópia)`,
    defaultTitle: source.defaultTitle,
    defaultItems: source.defaultItems,
    defaultConditions: source.defaultConditions,
    defaultValidDays: source.defaultValidDays,
    active: true,
  });
}

export async function deleteProposalTemplate(deps: ProposalTemplateUseCaseDeps, input: { id: string; tenantId: string; workspaceId: string }) {
  await mustBelong(deps, input.id, input.tenantId, input.workspaceId);
  await deps.proposalTemplateRepository.delete(input.id);
}
