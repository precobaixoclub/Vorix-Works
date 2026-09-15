import type { KanbanPhaseType, TeamKanbanPhase } from "../../domain/identity/identity.model.js";

/**
 * Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário) — colunas
 * do quadro, por equipe. Ver `db/migrations/0125_inbox_kanban.sql`.
 */

export type CreateKanbanPhaseInput = { tenantId: string; teamId: string; name: string; phaseType?: KanbanPhaseType };
export type UpdateKanbanPhaseInput = { name?: string; isDefaultFirst?: boolean; phaseType?: KanbanPhaseType; naoContabilizaOperacional?: boolean };

export type TeamKanbanPhaseRepositoryPort = {
  countByTeam(teamId: string): Promise<number>;
  /** Substituição em lote — usada só por `ensureDefaultPhases` (as 3 fases padrão, de uma vez, em
   * transação) e por testes; CRUD normal usa `create`/`update` individuais. */
  createMany(phases: readonly (CreateKanbanPhaseInput & { orderIndex: number; isDefaultFirst: boolean })[]): Promise<TeamKanbanPhase[]>;
  create(input: CreateKanbanPhaseInput & { orderIndex: number }): Promise<TeamKanbanPhase>;
  getById(id: string): Promise<TeamKanbanPhase | undefined>;
  listByTeam(teamId: string): Promise<TeamKanbanPhase[]>;
  update(id: string, input: UpdateKanbanPhaseInput): Promise<TeamKanbanPhase>;
  /** Desmarca `isDefaultFirst` de toda fase da equipe, exceto `exceptPhaseId` (se informado) —
   * único jeito de garantir "no máximo uma fase padrão por equipe" (mesmo racional de
   * `TeamMembershipRepositoryPort.clearPrincipalForLevel`). */
  clearDefaultFirst(teamId: string, exceptPhaseId?: string): Promise<void>;
  /** Exclusão PERMANENTE — bloqueada pela camada de aplicação se for a última fase da equipe
   * (nunca uma checagem no repositório). Migra conversas da fase excluída pro fallback ANTES de
   * excluir (mesma transação) — `deleteWithFallback` nunca deixa uma conversa com
   * `current_phase_id` apontando pra uma fase que já não existe. */
  deleteWithFallback(id: string, fallbackPhaseId: string): Promise<void>;
  /** Substituição total da ordem — duas passadas (índices temporários acima do range atual, depois
   * os finais) pra nunca violar a constraint única `(tenant, team, order_index)` no meio do
   * caminho (ver comentário completo em `reorderKanbanPhases`, `inbox-use-cases.ts`). */
  reorder(teamId: string, phaseIdsInOrder: readonly string[]): Promise<void>;
};
