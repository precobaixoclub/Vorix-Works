import type { AutomationRuleRepositoryPort, CreateAutomationRuleInput, UpdateAutomationRuleInput } from "../ports/automation-rule-repository.port.js";
import type { AutomationRunLogRepositoryPort } from "../ports/automation-run-log-repository.port.js";
import type { ContactRepositoryPort } from "../ports/contact-repository.port.js";
import type { DealRepositoryPort } from "../ports/deal-repository.port.js";
import type { PipelineStageRepositoryPort } from "../ports/pipeline-repository.port.js";
import type { TaskRepositoryPort } from "../ports/task-repository.port.js";
import type { TeamMembershipRepositoryPort } from "../ports/team-repository.port.js";
import type { TimelineEventRepositoryPort } from "../ports/timeline-event-repository.port.js";
import { createTask } from "./task-use-cases.js";
import type { AutomationCondition, AutomationRule, AutomationTrigger, Contact, Deal } from "../../domain/crm/crm.model.js";

export type AutomationUseCaseDeps = {
  automationRuleRepository: AutomationRuleRepositoryPort;
  automationRunLogRepository: AutomationRunLogRepositoryPort;
  contactRepository: ContactRepositoryPort;
  dealRepository: DealRepositoryPort;
  taskRepository: TaskRepositoryPort;
  teamMembershipRepository: TeamMembershipRepositoryPort;
  pipelineStageRepository: PipelineStageRepositoryPort;
  timelineEventRepository: TimelineEventRepositoryPort;
};

export type AutomationTriggerContext = {
  tenantId: string;
  workspaceId: string;
  trigger: AutomationTrigger;
  contact?: Contact;
  deal?: Deal;
};

/** Guard de tenant/workspace — nunca 403, sempre 404. */
export async function mustAutomationRuleBelongToTenantAndWorkspace(deps: AutomationUseCaseDeps, ruleId: string, tenantId: string, workspaceId: string): Promise<AutomationRule> {
  const rule = await deps.automationRuleRepository.getById(ruleId);
  if (!rule || rule.tenantId !== tenantId || rule.workspaceId !== workspaceId) {
    throw new Error(`AUTOMATION_RULE_NOT_FOUND: regra "${ruleId}" não existe.`);
  }
  return rule;
}

export async function createAutomationRule(deps: AutomationUseCaseDeps, input: CreateAutomationRuleInput): Promise<AutomationRule> {
  return deps.automationRuleRepository.create(input);
}

export async function listAutomationRules(deps: AutomationUseCaseDeps, input: { tenantId: string; workspaceId: string }): Promise<AutomationRule[]> {
  return deps.automationRuleRepository.listByWorkspace(input.tenantId, input.workspaceId);
}

export async function getAutomationRule(deps: AutomationUseCaseDeps, input: { ruleId: string; tenantId: string; workspaceId: string }): Promise<AutomationRule> {
  return mustAutomationRuleBelongToTenantAndWorkspace(deps, input.ruleId, input.tenantId, input.workspaceId);
}

export async function updateAutomationRule(deps: AutomationUseCaseDeps, input: { ruleId: string; tenantId: string; workspaceId: string; patch: UpdateAutomationRuleInput }): Promise<AutomationRule> {
  await mustAutomationRuleBelongToTenantAndWorkspace(deps, input.ruleId, input.tenantId, input.workspaceId);
  return deps.automationRuleRepository.update(input.ruleId, input.patch);
}

export async function deleteAutomationRule(deps: AutomationUseCaseDeps, input: { ruleId: string; tenantId: string; workspaceId: string }): Promise<void> {
  await mustAutomationRuleBelongToTenantAndWorkspace(deps, input.ruleId, input.tenantId, input.workspaceId);
  await deps.automationRuleRepository.delete(input.ruleId);
}

export async function listAutomationRunLogs(deps: AutomationUseCaseDeps, input: { ruleId: string; tenantId: string; workspaceId: string }) {
  await mustAutomationRuleBelongToTenantAndWorkspace(deps, input.ruleId, input.tenantId, input.workspaceId);
  return deps.automationRunLogRepository.listByRule(input.ruleId);
}

function conditionsMatch(conditions: readonly AutomationCondition[], context: AutomationTriggerContext): boolean {
  return conditions.every((condition) => {
    switch (condition.field) {
      case "pipelineId": return context.deal?.pipelineId === condition.equals;
      case "stageId": return context.deal?.stageId === condition.equals;
      case "origin": return context.contact?.origin === condition.equals;
      case "tag": return context.contact?.tags.includes(condition.equals) ?? false;
      default: return false;
    }
  });
}

/**
 * Move o negócio de etapa DIRETO pelo repositório (nunca via `moveDealStage` de
 * `deal-use-cases.ts`) — evitar isso é o que impede um ciclo infinito (regra de automação move o
 * negócio → dispararia `deal_stage_changed` de novo → poderia casar a mesma regra de novo).
 * Automação nunca move um negócio pra uma etapa de perda: não há como coletar `lossReason` num
 * contexto automatizado, e inventar um motivo genérico violaria "nunca perdido silenciosamente".
 */
async function executeMoveDealStage(deps: AutomationUseCaseDeps, deal: Deal, targetStageId: string): Promise<void> {
  const targetStage = await deps.pipelineStageRepository.getById(targetStageId);
  if (!targetStage || targetStage.pipelineId !== deal.pipelineId) {
    throw new Error("AUTOMATION_ACTION_STAGE_PIPELINE_MISMATCH: etapa alvo não pertence ao pipeline deste negócio.");
  }
  if (targetStage.isLost) {
    throw new Error("AUTOMATION_ACTION_CANNOT_AUTO_LOSE: automação nunca move um negócio pra uma etapa de perda (exige motivo humano).");
  }
  const now = new Date().toISOString();
  await deps.dealRepository.moveStage(deal.id, { stageId: targetStageId, wonAt: targetStage.isWon ? now : null, lostAt: null, lossReason: null });
  await deps.timelineEventRepository.record({
    tenantId: deal.tenantId,
    workspaceId: deal.workspaceId,
    entityType: "deal",
    entityId: deal.id,
    eventType: "deal_stage_changed",
    actorType: "automation",
    payload: { fromStageId: deal.stageId, toStageId: targetStageId, isWon: targetStage.isWon },
  });
}

async function executeAssignLeastLoadedInTeam(deps: AutomationUseCaseDeps, context: { tenantId: string; workspaceId: string; contact: Contact }, teamId: string): Promise<void> {
  const members = await deps.teamMembershipRepository.listByTeam(teamId);
  if (members.length === 0) throw new Error("AUTOMATION_ACTION_TEAM_EMPTY: equipe alvo não tem membros.");
  const loads = await Promise.all(
    members.map(async (member) => ({
      userId: member.userId,
      count: (await deps.contactRepository.listByWorkspace({ tenantId: context.tenantId, workspaceId: context.workspaceId, ownerUserId: member.userId, teamId })).length,
    })),
  );
  const leastLoaded = loads.reduce((min, current) => (current.count < min.count ? current : min));
  await deps.contactRepository.update(context.contact.id, { ownerUserId: leastLoaded.userId, teamId });
}

async function executeAction(deps: AutomationUseCaseDeps, rule: AutomationRule, context: AutomationTriggerContext): Promise<void> {
  switch (rule.action) {
    case "create_task": {
      if (!context.contact) throw new Error("AUTOMATION_ACTION_MISSING_CONTACT: ação exige um contato no contexto do gatilho.");
      await createTask(deps, {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        contactId: context.contact.id,
        dealId: context.deal?.id,
        type: rule.actionConfig.taskType ?? "follow_up",
        title: rule.actionConfig.taskTitle ?? rule.name,
      });
      return;
    }
    case "add_tag": {
      if (!context.contact || !rule.actionConfig.tag) throw new Error("AUTOMATION_ACTION_MISSING_TAG: ação exige `actionConfig.tag` e um contato.");
      if (context.contact.tags.includes(rule.actionConfig.tag)) return;
      await deps.contactRepository.update(context.contact.id, { tags: [...context.contact.tags, rule.actionConfig.tag] });
      return;
    }
    case "assign_owner": {
      if (!context.contact || !rule.actionConfig.ownerUserId) throw new Error("AUTOMATION_ACTION_MISSING_OWNER: ação exige `actionConfig.ownerUserId` e um contato.");
      await deps.contactRepository.update(context.contact.id, { ownerUserId: rule.actionConfig.ownerUserId });
      return;
    }
    case "assign_owner_least_loaded_in_team": {
      if (!context.contact || !rule.actionConfig.teamId) throw new Error("AUTOMATION_ACTION_MISSING_TEAM: ação exige `actionConfig.teamId` e um contato.");
      await executeAssignLeastLoadedInTeam(deps, { tenantId: context.tenantId, workspaceId: context.workspaceId, contact: context.contact }, rule.actionConfig.teamId);
      return;
    }
    case "move_deal_stage": {
      if (!context.deal || !rule.actionConfig.targetStageId) throw new Error("AUTOMATION_ACTION_MISSING_DEAL_OR_STAGE: ação exige `actionConfig.targetStageId` e um negócio.");
      await executeMoveDealStage(deps, context.deal, rule.actionConfig.targetStageId);
      return;
    }
  }
}

/**
 * Avalia todas as regras ativas do gatilho — NUNCA lança: uma falha de ação é contida e gravada
 * no log (auditoria, seção 18), a ação de negócio que disparou isto (ex.: mover um negócio) nunca
 * pode ser derrubada por uma automação mal configurada. Toda regra avaliada gera um
 * `AutomationRunLog`, mesmo quando as condições não batem (`matched: false`) — auditabilidade
 * total, não só das que executaram.
 */
export async function evaluateAutomationTrigger(deps: AutomationUseCaseDeps, context: AutomationTriggerContext): Promise<void> {
  const rules = await deps.automationRuleRepository.listActiveByTrigger(context.tenantId, context.workspaceId, context.trigger);
  for (const rule of rules) {
    const matched = conditionsMatch(rule.conditions, context);
    if (!matched) {
      await deps.automationRunLogRepository.record({
        tenantId: context.tenantId, workspaceId: context.workspaceId, ruleId: rule.id,
        contactId: context.contact?.id, dealId: context.deal?.id, matched: false, actionTaken: false,
      });
      continue;
    }
    try {
      await executeAction(deps, rule, context);
      await deps.automationRunLogRepository.record({
        tenantId: context.tenantId, workspaceId: context.workspaceId, ruleId: rule.id,
        contactId: context.contact?.id, dealId: context.deal?.id, matched: true, actionTaken: true,
      });
    } catch (error) {
      await deps.automationRunLogRepository.record({
        tenantId: context.tenantId, workspaceId: context.workspaceId, ruleId: rule.id,
        contactId: context.contact?.id, dealId: context.deal?.id, matched: true, actionTaken: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
