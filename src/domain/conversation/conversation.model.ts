/**
 * Domínio de Conversation — Sprint 06 (Fase 1). O coração conversacional do Zuno: a partir desta
 * sprint, o Chat deixa de ser só armazenamento de mensagens (`src/domain/chat/`, Sprint 02/03,
 * nunca ligado a um endpoint real) e passa a ser uma máquina de estados com intenção e decisão.
 * Nenhum tipo aqui depende de LLM/OpenAI/Fastify — é domínio puro; a classificação de intenção
 * (Fase 3) e a decisão do Arthur (Fase 4) são 100% baseadas em regras nesta sprint.
 *
 * RESPONSABILIDADE DE CADA ENTIDADE:
 *
 * - `Conversation`: o "fio" da conversa — um Workspace pode ter várias. Guarda só o essencial
 *   duradouro (quem, onde, status, estado ATUAL). Equivalente em espírito a `ChatSession`
 *   (Sprint 02), mas com um campo novo essencial: `state` (a máquina de estados desta sprint).
 *
 * - `ConversationContext`: o que o sistema entende da SITUAÇÃO agora — não é o histórico
 *   completo, é um resumo estruturado e barato de reconstruir a cada turno (contagem de turnos,
 *   última intenção, entidades referenciadas por regra simples — ex.: menção a uma campanha).
 *   Reconstruído/atualizado a cada mensagem pelo Engine (Fase 2); nunca persistido como "verdade"
 *   isolada — é derivado dos eventos.
 *
 * - `ConversationState`: em que fase do ciclo de vida um TURNO está — não é sobre a conversa
 *   inteira, é o resultado de processar a ÚLTIMA mensagem (idle → processing → resolved, ou
 *   awaiting_context/waiting_action quando o Arthur decide que precisa de mais alguma coisa antes
 *   de seguir). O Engine PRODUZ isso a cada mensagem (Fase 2, requisito explícito).
 *
 * - `UserIntent`: o resultado da classificação por regras (Fase 3) — qual das 8 intenções mínimas
 *   o texto do usuário parece expressar, com que confiança, e qual regra bateu (explicabilidade —
 *   importante já que não há IA para "explicar" a decisão de outra forma).
 *
 * - `ConversationEvent`: o log imutável de tudo que acontece numa conversa — mensagem do usuário,
 *   intenção classificada, contexto atualizado, decisão tomada, mudança de estado, mensagem do
 *   sistema. NÃO existe uma entidade `ConversationMessage` separada de propósito: uma "mensagem"
 *   é só um tipo de evento (`user_message`/`system_message`) — o histórico
 *   (`GET /v1/conversations/:id/history`, Fase 5) é literalmente a lista de eventos.
 *
 * - `ConversationMemory`: o que vale a pena lembrar entre turnos, além do contexto efêmero —
 *   pares chave/valor extraídos por regra simples (nunca embedding/busca semântica, isso é IA).
 *   Existe como o LUGAR certo para memória de verdade entrar quando o AI Gateway (Fase 7) for
 *   ligado — a estrutura já existe, vazia de inteligência.
 */

export const CONVERSATION_STATUSES = ["active", "archived"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/**
 * Estado do TURNO mais recente — não da conversa como um todo. `idle` só existe antes da primeira
 * mensagem. Depois disso, todo turno termina em `resolved` (Arthur respondeu ou foi uma conversa
 * livre) ou `awaiting_context`/`waiting_action` (Arthur decidiu que precisa de algo antes de
 * seguir — a próxima mensagem do usuário parte desse estado, não de `idle`).
 *
 * Sprint 07 (Fase 10) acrescenta dois estados do fluxo de Briefing — deliberadamente NÃO um
 * `ready_for_action` (rejeitado na revisão da Sprint 07B: "pronto" é responsabilidade do
 * `BriefingReadiness`/`PreparedCommand`, não da máquina de estados da conversa):
 * `collecting_briefing`: existe um Briefing ativo nesta conversa e ainda faltam campos —
 *   equivalente a `awaiting_context`, mas especificamente sobre um Briefing estruturado (nunca os
 *   dois ao mesmo tempo: quando um Briefing está ativo, ele governa o turno).
 * `awaiting_confirmation`: o resumo do Briefing foi apresentado e o sistema aguarda
 *   confirmar/corrigir/cancelar do usuário — nenhum `PreparedCommand` existe ainda.
 * Depois de `command_prepared`, o turno volta para `resolved` (nunca `waiting_action`): nenhuma
 * ação de verdade foi disparada (o `PreparedCommand` só é preparado, nunca executado nesta
 * sprint) — `waiting_action` sugeriria uma ação pendente de execução externa, o que não é o caso.
 */
export const CONVERSATION_STATES = [
  "idle",
  "processing",
  "awaiting_context",
  "waiting_action",
  "resolved",
  "collecting_briefing",
  "awaiting_confirmation",
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export type Conversation = {
  id: string;
  tenantId: string;
  workspaceId: string;
  status: ConversationStatus;
  state: ConversationState;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationContext = {
  tenantId: string;
  workspaceId: string;
  turnCount: number;
  lastIntent?: UserIntentType;
  /** Extraído por regra simples (ex.: "campanha X" -> {campaign: "X"}) — nunca NLP/embedding. */
  referencedEntities: Record<string, string>;
};

/**
 * As 8 intenções mínimas pedidas na Fase 3, mais `unknown` para quando nenhuma regra bate (nunca
 * inventamos uma intenção — melhor admitir que não sabemos do que forçar uma classificação errada).
 */
export const USER_INTENT_TYPES = [
  "create_campaign",
  "edit_campaign",
  "answer_question",
  "query_workspace",
  "query_assets",
  "query_knowledge",
  "start_briefing",
  "free_chat",
  "unknown",
] as const;
export type UserIntentType = (typeof USER_INTENT_TYPES)[number];

export type UserIntent = {
  type: UserIntentType;
  /** 0..1 — heurística de regra (ex.: match de palavra-chave = 0.9; fallback = 0.3), nunca uma probabilidade de modelo. */
  confidence: number;
  rawText: string;
  /** Qual regra bateu, para depuração/explicabilidade — `undefined` quando cai no fallback `unknown`/`free_chat`. */
  matchedRule?: string;
};

/**
 * As mesmas 6 ações que o PROMPT 06 pede do Arthur (Fase 4) — usadas tanto pelo Intent Router
 * (como SUGESTÃO, ver `InternalCommand`) quanto pelo Arthur (como DECISÃO final, ver
 * `ArthurDecision`). Nunca aciona a Skill de verdade nesta sprint — é só o rótulo da decisão.
 */
export const CONVERSATION_ACTIONS = [
  "respond",
  "request_more_context",
  "call_caio",
  "call_clara",
  "call_assets",
  "start_briefing",
] as const;
export type ConversationAction = (typeof CONVERSATION_ACTIONS)[number];

/** Produzido pelo Intent Router (Fase 3) — uma SUGESTÃO de ação, nunca uma execução. */
export type InternalCommand = {
  action: ConversationAction;
  intent: UserIntent;
  reason: string;
};

/** Produzido pelo Arthur (Fase 4) — a decisão final, que pode confirmar ou substituir a sugestão
 * do Router (ex.: baixa confiança sempre vira `request_more_context`, mesmo que o Router tenha
 * sugerido outra coisa). `executed` é sempre `false` nesta sprint — Arthur decide, não gera. */
export type ArthurDecision = {
  action: ConversationAction;
  reason: string;
  executed: false;
};

/**
 * Os 13 tipos novos de evento do Briefing (Sprint 07, Fase 10) carregam referências/metadados
 * para auditoria (`briefingId`, `fieldKey`, `questionId`, `source`...) — NUNCA o valor sensível
 * completo de um campo `sensitivity: "sensitive"` (ver `toBriefingEventPayload` em
 * `src/application/briefing/events.ts`), e nunca a lista de regras internas usadas para decidir.
 */
export const CONVERSATION_EVENT_TYPES = [
  "user_message",
  "intent_classified",
  "context_updated",
  "decision_made",
  "system_message",
  "state_changed",
  "briefing_started",
  "briefing_field_collected",
  "briefing_field_updated",
  "briefing_field_ambiguous",
  "briefing_question_created",
  "briefing_question_answered",
  "briefing_confirmation_requested",
  "briefing_confirmed",
  "briefing_cancelled",
  "briefing_suspended",
  "briefing_resumed",
  "command_prepared",
  "command_superseded",
] as const;
export type ConversationEventType = (typeof CONVERSATION_EVENT_TYPES)[number];

export type ConversationEvent = {
  id: string;
  conversationId: string;
  type: ConversationEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ConversationMemory = {
  conversationId: string;
  facts: Record<string, string>;
  updatedAt: string;
};
