import type { CommercialCopilotDealInput, CommercialCopilotGeneratorPort, CommercialCopilotTaskInput } from "../ports/commercial-copilot-generator.port.js";
import type { CommercialSuggestionRepositoryPort } from "../ports/commercial-suggestion-repository.port.js";
import type { ContactRepositoryPort } from "../ports/contact-repository.port.js";
import type { DealRepositoryPort } from "../ports/deal-repository.port.js";
import type { PipelineStageRepositoryPort } from "../ports/pipeline-repository.port.js";
import type { TaskRepositoryPort } from "../ports/task-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import { createTask } from "./task-use-cases.js";
import type { Contact, CommercialSuggestion, CommercialSuggestionStatus } from "../../domain/crm/crm.model.js";

export type CommercialCopilotUseCaseDeps = {
  contactRepository: ContactRepositoryPort;
  dealRepository: DealRepositoryPort;
  taskRepository: TaskRepositoryPort;
  pipelineStageRepository: PipelineStageRepositoryPort;
  commercialSuggestionRepository: CommercialSuggestionRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
  generator: CommercialCopilotGeneratorPort;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function mustContactExist(deps: CommercialCopilotUseCaseDeps, contactId: string, tenantId: string, workspaceId: string): Promise<Contact> {
  const contact = await deps.contactRepository.getById(contactId);
  if (!contact || contact.tenantId !== tenantId || contact.workspaceId !== workspaceId) {
    throw new Error(`CONTACT_NOT_FOUND: contato "${contactId}" não existe.`);
  }
  return contact;
}

export async function mustCommercialSuggestionBelongToTenantAndWorkspace(deps: CommercialCopilotUseCaseDeps, suggestionId: string, tenantId: string, workspaceId: string): Promise<CommercialSuggestion> {
  const suggestion = await deps.commercialSuggestionRepository.getById(suggestionId);
  if (!suggestion || suggestion.tenantId !== tenantId || suggestion.workspaceId !== workspaceId) {
    throw new Error(`COMMERCIAL_SUGGESTION_NOT_FOUND: sugestão "${suggestionId}" não existe.`);
  }
  return suggestion;
}

async function buildGeneratorContext(deps: CommercialCopilotUseCaseDeps, contact: Contact, tenantId: string, workspaceId: string) {
  const now = new Date();
  const [deals, tasks] = await Promise.all([
    deps.dealRepository.listByWorkspace({ tenantId, workspaceId, contactId: contact.id }),
    deps.taskRepository.listByWorkspace({ tenantId, workspaceId, contactId: contact.id }),
  ]);

  const dealInputs: CommercialCopilotDealInput[] = await Promise.all(
    deals.map(async (deal): Promise<CommercialCopilotDealInput> => {
      const stage = await deps.pipelineStageRepository.getById(deal.stageId);
      const daysInStage = Math.floor((now.getTime() - new Date(deal.lastStageChangedAt).getTime()) / MS_PER_DAY);
      return { title: deal.title, stageName: stage?.name ?? "—", isWon: Boolean(deal.wonAt), isLost: Boolean(deal.lostAt), valueCents: deal.valueCents, daysInStage };
    }),
  );

  const pendingTaskInputs: CommercialCopilotTaskInput[] = tasks
    .filter((task) => task.status === "pending")
    .map((task) => ({
      title: task.title,
      status: task.status,
      overdueDays: task.dueAt && new Date(task.dueAt) < now ? Math.floor((now.getTime() - new Date(task.dueAt).getTime()) / MS_PER_DAY) : undefined,
    }));

  const daysSinceLastInteraction = contact.lastInteractionAt ? Math.floor((now.getTime() - new Date(contact.lastInteractionAt).getTime()) / MS_PER_DAY) : undefined;

  return {
    tenantId,
    workspaceId,
    contactName: contact.name,
    origin: contact.origin,
    tags: contact.tags,
    daysSinceLastInteraction,
    deals: dealInputs,
    pendingTasks: pendingTaskInputs,
  };
}

/**
 * Gera novas sugestões via AI Gateway e persiste cada uma como `pending` — nunca executa nada
 * sozinha (auditoria, seção 13). Se o Gateway falhar (não configurado, rate limit, etc.), lança
 * `COMMERCIAL_COPILOT_UNAVAILABLE` — a rota traduz isso pra um erro operacional claro, nunca uma
 * sugestão inventada localmente.
 */
export async function generateCommercialSuggestions(deps: CommercialCopilotUseCaseDeps, input: { contactId: string; tenantId: string; workspaceId: string }): Promise<CommercialSuggestion[]> {
  const contact = await mustContactExist(deps, input.contactId, input.tenantId, input.workspaceId);
  const generatorInput = await buildGeneratorContext(deps, contact, input.tenantId, input.workspaceId);
  const result = await deps.generator.generateSuggestions(generatorInput);
  if (!result.ok) {
    throw new Error(`COMMERCIAL_COPILOT_UNAVAILABLE: ${result.message}`);
  }

  const created: CommercialSuggestion[] = [];
  for (const suggestion of result.suggestions) {
    created.push(
      await deps.commercialSuggestionRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        contactId: contact.id,
        title: suggestion.title,
        rationale: suggestion.rationale,
        evidence: suggestion.evidence,
        confidence: suggestion.confidence,
        suggestedAction: suggestion.suggestedAction,
      }),
    );
  }

  await deps.timelineEventRepository.record({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    entityType: "contact",
    entityId: contact.id,
    eventType: "commercial_suggestions_generated",
    actorType: "ai",
    payload: { count: created.length },
  });

  return created;
}

export async function listCommercialSuggestions(deps: CommercialCopilotUseCaseDeps, input: { tenantId: string; workspaceId: string; contactId?: string; status?: CommercialSuggestionStatus }): Promise<CommercialSuggestion[]> {
  return deps.commercialSuggestionRepository.listByWorkspace(input);
}

/**
 * Aceitar É a autorização humana exigida pela auditoria (seção 13: "IA nunca altera operações
 * comerciais críticas sem autorização") — só a partir daqui um efeito real pode acontecer. Para
 * `follow_up_task`/`reach_out` (ações que só precisam de um título, sem julgamento adicional de
 * qual etapa/proposta), cria a Tarefa automaticamente; para as demais (`review_deal_stage`/
 * `send_proposal`/`none`), só marca aceita — a especificidade (qual etapa, quais itens) exige
 * julgamento humano que a sugestão não tem como cobrir sozinha.
 */
export async function acceptCommercialSuggestion(deps: CommercialCopilotUseCaseDeps, input: { suggestionId: string; tenantId: string; workspaceId: string }): Promise<CommercialSuggestion> {
  const suggestion = await mustCommercialSuggestionBelongToTenantAndWorkspace(deps, input.suggestionId, input.tenantId, input.workspaceId);
  if (suggestion.status !== "pending") {
    throw new Error(`COMMERCIAL_SUGGESTION_ALREADY_RESOLVED: sugestão "${input.suggestionId}" já está "${suggestion.status}".`);
  }
  const updated = await deps.commercialSuggestionRepository.setStatus(suggestion.id, "accepted", new Date().toISOString());

  if (suggestion.suggestedAction === "follow_up_task" || suggestion.suggestedAction === "reach_out") {
    await createTask(deps, {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      contactId: suggestion.contactId,
      dealId: suggestion.dealId,
      type: suggestion.suggestedAction === "reach_out" ? "ligacao" : "follow_up",
      title: suggestion.title,
      description: suggestion.rationale,
    });
  }

  await deps.timelineEventRepository.record({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    entityType: "contact",
    entityId: suggestion.contactId,
    eventType: "commercial_suggestion_accepted",
    actorType: "user",
    payload: { suggestionId: suggestion.id, suggestedAction: suggestion.suggestedAction },
  });

  return updated;
}

export async function dismissCommercialSuggestion(deps: CommercialCopilotUseCaseDeps, input: { suggestionId: string; tenantId: string; workspaceId: string }): Promise<CommercialSuggestion> {
  const suggestion = await mustCommercialSuggestionBelongToTenantAndWorkspace(deps, input.suggestionId, input.tenantId, input.workspaceId);
  if (suggestion.status !== "pending") {
    throw new Error(`COMMERCIAL_SUGGESTION_ALREADY_RESOLVED: sugestão "${input.suggestionId}" já está "${suggestion.status}".`);
  }
  return deps.commercialSuggestionRepository.setStatus(suggestion.id, "dismissed", new Date().toISOString());
}
