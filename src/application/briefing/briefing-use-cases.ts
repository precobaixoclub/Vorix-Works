import type { Briefing, BriefingSchema, BriefingType, PreparedCommand } from "../../domain/briefing/briefing.model.js";
import type { UserIntentType } from "../../domain/conversation/conversation.model.js";
import type { BriefingFieldValueRepositoryPort } from "../ports/briefing-field-value-repository.port.js";
import type { BriefingQuestionRepositoryPort } from "../ports/briefing-question-repository.port.js";
import type { BriefingRepositoryPort } from "../ports/briefing-repository.port.js";
import type { ConversationEventRepositoryPort } from "../ports/conversation-event-repository.port.js";
import type { PreparedCommandRepositoryPort } from "../ports/prepared-command-repository.port.js";
import { selectCurrentFieldValues } from "./field-state.js";
import { buildPreparedCommandInput } from "./prepare-command.js";
import { evaluateBriefingReadiness } from "./readiness-evaluator.js";

/**
 * Casos de uso de Briefing — Sprint 07 (Fase 12). Mesmo padrão de `conversation-use-cases.ts`
 * (Sprint 06): `tenantId`/`workspaceId` sempre vêm de fora, nunca do corpo da requisição; erros
 * são `Error` com prefixo reconhecível, traduzidos para HTTP na borda. Rotas nunca tocam
 * repositórios diretamente — só estas funções.
 */

/**
 * Único ponto de contato entre Briefing e o Planning Engine (Sprint 09) — interface estreita e
 * OPCIONAL, propositalmente definida aqui (não importada de `src/application/planning/*`) para
 * que este arquivo nunca precise saber nada sobre `Planning`/`ExecutionGraph`/Ports do domínio de
 * Planning. `undefined` reproduz exatamente o comportamento da Sprint 07/08 (nenhum Planning
 * nasce) — os testes dessas sprints continuam válidos sem tocar em nada aqui.
 */
export type BriefingPlanningHook = {
  createFromPreparedCommand(preparedCommand: PreparedCommand): Promise<void>;
  supersedeForPreparedCommand(preparedCommandId: string): Promise<void>;
};

export type BriefingUseCaseDeps = {
  briefingRepository: BriefingRepositoryPort;
  fieldValueRepository: BriefingFieldValueRepositoryPort;
  questionRepository: BriefingQuestionRepositoryPort;
  preparedCommandRepository: PreparedCommandRepositoryPort;
  eventRepository: ConversationEventRepositoryPort;
  planningEngine?: BriefingPlanningHook;
};

async function mustBelongToTenantAndWorkspace(
  repository: BriefingRepositoryPort,
  id: string,
  tenantId: string,
  workspaceId: string,
): Promise<Briefing> {
  const briefing = await repository.getById(id);
  if (!briefing || briefing.tenantId !== tenantId || briefing.workspaceId !== workspaceId) {
    throw new Error(`BRIEFING_NOT_FOUND: briefing "${id}" não existe.`);
  }
  return briefing;
}

export type StartBriefingInput = { tenantId: string; workspaceId: string; conversationId: string; type: BriefingType; schemaVersion: number };

/** Idempotente por design: nunca cria um segundo Briefing ativo para a mesma conversa — se já
 * existir um (mesmo de outro tipo, o que não deveria acontecer nesta sprint já que só
 * `campaign_creation` tem schema), devolve o existente em vez de duplicar. */
export async function startBriefing(deps: BriefingUseCaseDeps, input: StartBriefingInput): Promise<Briefing> {
  const existing = await deps.briefingRepository.getActiveByConversation(input.conversationId);
  if (existing) return existing;

  const briefing = await deps.briefingRepository.create({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    type: input.type,
    schemaVersion: input.schemaVersion,
  });
  await deps.eventRepository.append({
    conversationId: input.conversationId,
    type: "briefing_started",
    payload: { briefingId: briefing.id, schemaType: briefing.type, schemaVersion: briefing.schemaVersion },
  });
  return briefing;
}

export type GetActiveBriefingInput = { tenantId: string; workspaceId: string; conversationId: string };

export async function getActiveBriefing(deps: BriefingUseCaseDeps, input: GetActiveBriefingInput): Promise<Briefing | undefined> {
  const briefing = await deps.briefingRepository.getActiveByConversation(input.conversationId);
  if (!briefing || briefing.tenantId !== input.tenantId || briefing.workspaceId !== input.workspaceId) return undefined;
  return briefing;
}

export type GetBriefingInput = { tenantId: string; workspaceId: string; id: string };

export async function getBriefing(deps: BriefingUseCaseDeps, input: GetBriefingInput): Promise<Briefing> {
  return mustBelongToTenantAndWorkspace(deps.briefingRepository, input.id, input.tenantId, input.workspaceId);
}

export type CancelBriefingInput = { tenantId: string; workspaceId: string; id: string };

export async function cancelBriefing(deps: BriefingUseCaseDeps, input: CancelBriefingInput): Promise<Briefing> {
  const briefing = await mustBelongToTenantAndWorkspace(deps.briefingRepository, input.id, input.tenantId, input.workspaceId);
  const pendingQuestion = await deps.questionRepository.getPendingByBriefing(briefing.id);
  if (pendingQuestion) await deps.questionRepository.markSuperseded(pendingQuestion.id);

  const updated = await deps.briefingRepository.updateStatus(briefing.id, "cancelled");
  await deps.eventRepository.append({ conversationId: briefing.conversationId, type: "briefing_cancelled", payload: { briefingId: briefing.id } });
  return updated;
}

/** Suspensão nunca muda `status` (Sprint 07B) — só registra o evento, o Briefing continua
 * "vivo" e retomável. Quem decide QUANDO suspender é o orquestrador de turno, não este caso de uso. */
export async function suspendBriefing(deps: BriefingUseCaseDeps, briefing: Briefing, incompatibleIntent: UserIntentType): Promise<void> {
  await deps.eventRepository.append({
    conversationId: briefing.conversationId,
    type: "briefing_suspended",
    payload: { briefingId: briefing.id, incompatibleIntent },
  });
}

export async function resumeBriefing(deps: BriefingUseCaseDeps, briefing: Briefing): Promise<void> {
  await deps.eventRepository.append({ conversationId: briefing.conversationId, type: "briefing_resumed", payload: { briefingId: briefing.id } });
}

export async function evaluateActiveReadiness(deps: BriefingUseCaseDeps, schema: BriefingSchema, briefing: Briefing) {
  const currentList = await deps.fieldValueRepository.listCurrentByBriefing(briefing.id);
  const currentValues = selectCurrentFieldValues(currentList);
  const readiness = evaluateBriefingReadiness(schema, currentValues, briefing.status === "ready" || briefing.status === "completed");
  return { readiness, currentValues };
}

/** Confirmação válida: marca o Briefing `ready` e cria (ou reaproveita, se já existir para esta
 * revisão — idempotência da Fase 9) o `PreparedCommand`. Nunca executa nada — `PreparedCommand`
 * fica só `prepared`. */
export async function confirmBriefingAndPrepareCommand(
  deps: BriefingUseCaseDeps,
  params: { briefing: Briefing; schema: BriefingSchema; intent: UserIntentType },
) {
  const readyBriefing = await deps.briefingRepository.updateStatus(params.briefing.id, "ready");
  const currentList = await deps.fieldValueRepository.listCurrentByBriefing(readyBriefing.id);
  const currentValues = selectCurrentFieldValues(currentList);

  const input = buildPreparedCommandInput({ briefing: readyBriefing, schema: params.schema, currentValues, intent: params.intent });
  const command = await deps.preparedCommandRepository.create(input);

  await deps.eventRepository.append({
    conversationId: readyBriefing.conversationId,
    type: "briefing_confirmed",
    payload: { briefingId: readyBriefing.id, revision: readyBriefing.revision },
  });
  await deps.eventRepository.append({
    conversationId: readyBriefing.conversationId,
    type: "command_prepared",
    payload: { commandId: command.id, briefingId: readyBriefing.id, briefingRevision: readyBriefing.revision },
  });

  // Sprint 09 — Planning nasce automaticamente ao confirmar (decisão obrigatória), nunca via
  // endpoint próprio. `planningEngine` ausente (Sprint 07/08) preserva o comportamento antigo.
  if (deps.planningEngine) {
    await deps.planningEngine.createFromPreparedCommand(command);
  }

  return { briefing: readyBriefing, command };
}

/** Correção pós-confirmação (Fase 9): supera o `PreparedCommand` da revisão atual (se existir),
 * incrementa a revisão do Briefing e volta o status para `collecting` — a próxima confirmação
 * gera um `PreparedCommand` NOVO, nunca reaproveita o superado. */
export async function supersedeCommandAfterCorrection(deps: BriefingUseCaseDeps, briefing: Briefing): Promise<Briefing> {
  const existingCommand = await deps.preparedCommandRepository.getByBriefingRevision(briefing.id, briefing.revision, briefing.type);
  if (existingCommand && existingCommand.status === "prepared") {
    await deps.preparedCommandRepository.markSuperseded(existingCommand.id);
    await deps.eventRepository.append({
      conversationId: briefing.conversationId,
      type: "command_superseded",
      payload: { commandId: existingCommand.id, briefingId: briefing.id, briefingRevision: briefing.revision },
    });
    // Sprint 09 (decisão obrigatória) — o Planning nascido deste PreparedCommand acompanha.
    if (deps.planningEngine) {
      await deps.planningEngine.supersedeForPreparedCommand(existingCommand.id);
    }
  }

  const bumped = await deps.briefingRepository.incrementRevision(briefing.id);
  return deps.briefingRepository.updateStatus(bumped.id, "collecting");
}
