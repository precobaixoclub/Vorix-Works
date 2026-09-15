import type { ConversationTimeEntryPhaseType } from "../../domain/inbox/inbox.model.js";

/**
 * Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário) —
 * histórico de permanência em fase. Ver `db/migrations/0125_inbox_kanban.sql`.
 */

export type ConversationServiceTime = {
  conversationId: string;
  /** Soma de `durationSeconds` de todas as entradas JÁ FECHADAS com `phaseType: "RUNNING"` —
   * nunca inclui a entrada aberta atual (essa é calculada no frontend via `currentPhaseStartedAt`
   * + `isRunning`, ver seção 5.3 do guia do usuário: sem isso o número "pularia" a cada refetch). */
  totalSeconds: number;
  /** `startedAt` da entrada aberta (`endedAt is null`) — `undefined` se não houver nenhuma (conversa
   * sem equipe/fase ainda). */
  currentPhaseStartedAt?: string;
  /** `phaseType !== "PAUSED"` da entrada aberta — sem conceito de horário comercial por equipe
   * ainda (fora de escopo desta rodada, ver relatório de canal/equipe), então é só isso; nunca
   * `true` sem uma entrada aberta. */
  isRunning: boolean;
};

export type ConversationTimeEntryRepositoryPort = {
  /**
   * Bloco "mover card" — O ALGORITMO CENTRAL do kanban (seção 4.2 do guia do usuário), tudo numa
   * ÚNICA transação com lock, implementado inteiro no adapter Postgres (a serialização via
   * `SELECT ... FOR UPDATE` na própria linha de `inbox_conversations` é um detalhe de
   * implementação, nunca exposto ao chamador): (1) fecha toda entrada de tempo aberta de
   * `(conversationId, teamId)` — normalmente só uma; (2) abre uma nova pra `phaseId`, com
   * `phaseType` = snapshot passado por quem chama (nunca relido da fase depois); (3) atualiza
   * `inbox_conversations.current_phase_id` — as três coisas atômicas juntas, ou nenhuma. Sem o
   * lock, um drag manual concorrente com uma automação (ou dois atendentes movendo o MESMO card)
   * poderia intercalar entre (1) e (2) de duas chamadas e deixar DUAS entradas abertas,
   * corrompendo o cálculo de tempo de atendimento.
   */
  moveConversationPhase(input: { tenantId: string; conversationId: string; teamId: string; phaseId: string; phaseType: ConversationTimeEntryPhaseType }): Promise<void>;
  /** Abre a PRIMEIRA entrada só se não houver NENHUMA pra `(conversationId, teamId)` ainda — usado
   * por `ensureConversationPhaseState` (conversa entrando na fase padrão pela primeira vez, nunca
   * fecha nada porque não há nada aberto). No-op silencioso se já existir alguma entrada. */
  openFirstIfMissing(input: { tenantId: string; conversationId: string; teamId: string; phaseId: string; phaseType: ConversationTimeEntryPhaseType }): Promise<void>;
  getServiceTimeBulk(input: { tenantId: string; teamId: string; conversationIds: readonly string[] }): Promise<ConversationServiceTime[]>;
};
