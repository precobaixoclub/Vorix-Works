import type { Briefing, BriefingReadiness } from "../../domain/briefing/briefing.model.js";
import { getBriefingSchema, hasBriefingSchema } from "../../domain/briefing/schema-registry.js";
import type {
  ArthurDecision,
  Conversation,
  ConversationAction,
  ConversationEvent,
  ConversationState,
  InternalCommand,
  UserIntent,
} from "../../domain/conversation/conversation.model.js";
import { resumeBriefing, startBriefing, suspendBriefing, type BriefingUseCaseDeps } from "../briefing/briefing-use-cases.js";
import type { BriefingQuestionDto, BriefingSummaryDto, PreparedCommandSummaryDto } from "../briefing/dto.js";
import { processBriefingTurn, type ProcessBriefingTurnDeps } from "../briefing/process-briefing-turn.js";
import type { AiGatewayPort } from "../ports/ai-gateway.port.js";
import type { AssetMetadataSourcePort } from "../ports/asset-metadata-source.port.js";
import type { CompanyKnowledgeSourcePort } from "../ports/company-knowledge-source.port.js";
import type { ConversationEventRepositoryPort } from "../ports/conversation-event-repository.port.js";
import type { ConversationMemoryRepositoryPort } from "../ports/conversation-memory-repository.port.js";
import type { ConversationRepositoryPort } from "../ports/conversation-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import { decideConversationAction } from "./arthur-conversation-decision.js";
import { extractEntities, resolveContext } from "./conversation-context.js";
import { classifyIntent, routeIntent } from "./intent-router.js";

/**
 * Conversation Engine — Sprint 06 (Fase 2), estendido na Sprint 07 (Fase 10) para governar o
 * fluxo de Briefing. "Receber mensagem, identificar contexto, manter histórico, produzir um
 * ConversationState" continua valendo — o que muda é que, quando existe um Briefing ativo (ou a
 * mensagem classifica como `create_campaign`, a ÚNICA intenção que inicia um Briefing
 * automaticamente, Sprint 07B), o turno inteiro é delegado a `processBriefingTurn`
 * (`src/application/briefing/process-briefing-turn.ts`) em vez de `routeIntent`/
 * `decideConversationAction` — Arthur/Router legado nunca são chamados nesse caso. Fora de um
 * Briefing ativo, o pipeline da Sprint 06 é IDÊNTICO ao original.
 */

export type ConversationEngineDeps = {
  conversationRepository: ConversationRepositoryPort;
  eventRepository: ConversationEventRepositoryPort;
  memoryRepository: ConversationMemoryRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
} & BriefingUseCaseDeps & {
    companyKnowledgeSource: CompanyKnowledgeSourcePort;
    assetMetadataSource: AssetMetadataSourcePort;
    aiGateway: AiGatewayPort;
    aiExtractionEnabled: boolean;
  };

export type ProcessMessageInput = {
  conversationId: string;
  content: string;
};

export type ProcessMessageResult = {
  conversation: Conversation;
  intent: UserIntent;
  command: InternalCommand;
  decision: ArthurDecision;
  systemMessageText: string;
  events: ConversationEvent[];
  /** Presentes só quando o turno foi governado por um Briefing ativo (Sprint 07, Fase 13). */
  briefingSummary?: BriefingSummaryDto;
  nextQuestion?: BriefingQuestionDto;
  readiness?: BriefingReadiness;
  confirmationRequired?: boolean;
  preparedCommandSummary?: PreparedCommandSummaryDto;
  /** Sprint 08 (Fase 20) — metadados públicos mínimos sobre o uso de IA neste turno. Nunca
   * provider/model/tokens/confidence bruta/prompt/resposta do provider. */
  aiAssisted?: boolean;
  aiFallbackUsed?: boolean;
  extractionWarnings?: readonly string[];
};

const DECISION_MESSAGE: Record<ConversationAction, string> = {
  respond: "Arthur decidiu responder diretamente.",
  request_more_context: "Arthur decidiu pedir mais contexto.",
  call_caio: "Arthur decidiu acionar Caio para a campanha.",
  call_clara: "Arthur decidiu consultar Knowledge.",
  call_assets: "Arthur decidiu consultar Assets.",
  start_briefing: "Arthur decidiu iniciar um Briefing.",
};

const STATE_FOR_ACTION: Record<ConversationAction, ConversationState> = {
  respond: "resolved",
  request_more_context: "awaiting_context",
  call_caio: "waiting_action",
  call_clara: "waiting_action",
  call_assets: "waiting_action",
  start_briefing: "waiting_action",
};

const BRIEFING_LIFECYCLE_EVENT_TYPES = new Set(["briefing_started", "briefing_suspended", "briefing_resumed", "briefing_confirmed", "briefing_cancelled"]);

export async function processMessage(deps: ConversationEngineDeps, input: ProcessMessageInput): Promise<ProcessMessageResult> {
  const conversation = await deps.conversationRepository.getById(input.conversationId);
  if (!conversation) {
    throw new Error(`CONVERSATION_NOT_FOUND: conversa "${input.conversationId}" não existe.`);
  }

  const appendEvent = async (type: ConversationEvent["type"], payload: Record<string, unknown>) => {
    await deps.eventRepository.append({ conversationId: conversation.id, type, payload });
  };

  // 1. Receber mensagem.
  await appendEvent("user_message", { content: input.content });

  // 2. Identificar contexto (a partir do histórico já persistido + memória) — sempre roda, mesmo
  // quando um Briefing vai governar o turno: `resolveContext`/`extractEntities` alimentam
  // `ConversationMemory`, uma das fontes do Context Resolver (Fase 4).
  const context = await resolveContext(deps, conversation);

  const intent = classifyIntent(input.content);
  await appendEvent("intent_classified", { intent });

  const updatedFacts = extractEntities(input.content, context.referencedEntities);
  await deps.memoryRepository.upsert(conversation.id, updatedFacts);
  const updatedContext = { ...context, lastIntent: intent.type, referencedEntities: updatedFacts };
  await appendEvent("context_updated", { context: updatedContext });

  // Sprint 07 (Fase 10) — decide se este turno é governado por um Briefing.
  const briefingResult = await runBriefingTurnIfApplicable(deps, conversation, intent, input.content);

  if (briefingResult) {
    await appendEvent("system_message", { content: briefingResult.systemMessageText });
    await appendEvent("state_changed", { from: conversation.state, to: briefingResult.conversationState });
    const updatedConversation = await deps.conversationRepository.updateState(conversation.id, briefingResult.conversationState);

    const command: InternalCommand = { action: "start_briefing", intent, reason: "Um Briefing ativo governou este turno." };
    const decision: ArthurDecision = { action: "start_briefing", reason: briefingResult.systemMessageText, executed: false };

    const events = await deps.eventRepository.listByConversation(conversation.id);
    return {
      conversation: updatedConversation,
      intent,
      command,
      decision,
      systemMessageText: briefingResult.systemMessageText,
      events,
      briefingSummary: briefingResult.briefingSummary,
      nextQuestion: briefingResult.nextQuestion,
      readiness: briefingResult.readiness,
      confirmationRequired: briefingResult.confirmationRequired,
      preparedCommandSummary: briefingResult.preparedCommandSummary,
      aiAssisted: briefingResult.aiAssisted,
      aiFallbackUsed: briefingResult.aiFallbackUsed,
      extractionWarnings: briefingResult.extractionWarnings,
    };
  }

  // Pipeline da Sprint 06, inalterado — Intent Router (Fase 3) + Arthur (Fase 4).
  const command = routeIntent(intent);
  const decision = decideConversationAction(command, updatedContext);
  await appendEvent("decision_made", { command, decision });

  const systemMessageText = DECISION_MESSAGE[decision.action];
  await appendEvent("system_message", { content: systemMessageText });

  const newState = STATE_FOR_ACTION[decision.action];
  await appendEvent("state_changed", { from: conversation.state, to: newState });
  const updatedConversation = await deps.conversationRepository.updateState(conversation.id, newState);

  const events = await deps.eventRepository.listByConversation(conversation.id);
  return { conversation: updatedConversation, intent, command, decision, systemMessageText, events };
}

type BriefingTurnSummary = {
  conversationState: ConversationState;
  systemMessageText: string;
  briefingSummary?: BriefingSummaryDto;
  nextQuestion?: BriefingQuestionDto;
  readiness?: BriefingReadiness;
  confirmationRequired?: boolean;
  preparedCommandSummary?: PreparedCommandSummaryDto;
  aiAssisted?: boolean;
  aiFallbackUsed?: boolean;
  extractionWarnings?: readonly string[];
};

const TERMINAL_BRIEFING_STATUSES: readonly Briefing["status"][] = ["completed", "cancelled", "expired"];

/** Ponto único de decisão "este turno é do Briefing ou da Sprint 06?" (Fase 10). Só
 * `create_campaign` inicia um Briefing automaticamente (regra de ativação, Sprint 07B) —
 * `start_briefing` continua sem schema próprio e preserva o comportamento conversacional. */
async function runBriefingTurnIfApplicable(
  deps: ConversationEngineDeps & ProcessBriefingTurnDeps,
  conversation: Conversation,
  intent: UserIntent,
  content: string,
): Promise<BriefingTurnSummary | undefined> {
  const activeBriefing = await deps.briefingRepository.getActiveByConversation(conversation.id);

  let briefing: Briefing | undefined = activeBriefing;
  let justStarted = false;

  if (!briefing && intent.type === "create_campaign" && hasBriefingSchema("campaign_creation")) {
    const schema = getBriefingSchema("campaign_creation");
    if (!schema) return undefined;
    briefing = await startBriefing(deps, {
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      type: "campaign_creation",
      schemaVersion: schema.version,
    });
    justStarted = true;
  }

  if (!briefing || TERMINAL_BRIEFING_STATUSES.includes(briefing.status)) return undefined;

  const schema = getBriefingSchema(briefing.type);
  if (!schema) return undefined;

  if (!justStarted) {
    const priorEvents = await deps.eventRepository.listByConversation(conversation.id);
    const lastLifecycleEvent = [...priorEvents].reverse().find((event) => BRIEFING_LIFECYCLE_EVENT_TYPES.has(event.type));
    if (lastLifecycleEvent?.type === "briefing_suspended") {
      await resumeBriefing(deps, briefing);
    }
  }

  const workspace = await deps.workspaceRepository.getById(briefing.workspaceId);
  const workspaceConnectedChannels = workspace?.integrations.filter((integration) => integration.status === "connected").map((integration) => integration.channel);

  const outcome = await processBriefingTurn(deps, { briefing, schema, text: content, classifiedIntent: intent, workspaceConnectedChannels });

  if (outcome.kind === "not_applicable") return undefined;

  if (outcome.kind === "suspend") {
    await suspendBriefing(deps, briefing, outcome.intent.type);
    return undefined;
  }

  return {
    conversationState: outcome.conversationState,
    systemMessageText: outcome.systemMessageText,
    briefingSummary: outcome.briefingSummary,
    nextQuestion: outcome.nextQuestion,
    readiness: outcome.readiness,
    confirmationRequired: outcome.confirmationRequired,
    preparedCommandSummary: outcome.preparedCommandSummary,
    aiAssisted: outcome.aiAssisted,
    aiFallbackUsed: outcome.aiFallbackUsed,
    extractionWarnings: outcome.extractionWarnings,
  };
}
