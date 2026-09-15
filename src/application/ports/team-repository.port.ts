import type { Team, TeamMembership, TenantRole } from "../../domain/identity/identity.model.js";

export type CreateTeamInput = { tenantId: string; workspaceId: string; name: string };
export type UpdateTeamInput = { name?: string; roundRobinEnabled?: boolean; timezone?: string };

export type TeamRepositoryPort = {
  create(input: CreateTeamInput): Promise<Team>;
  getById(id: string): Promise<Team | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<Team[]>;
  update(id: string, input: UpdateTeamInput): Promise<Team>;
  delete(id: string): Promise<void>;
  /**
   * Bloco "roteamento por equipe" (réplica adaptada do CMDesk) — resolve o próximo membro
   * elegível do nível via round-robin e AVANÇA o ponteiro, tudo de forma atômica. A serialização
   * (lock) é um detalhe de implementação do adapter Postgres (advisory lock transacional, mesmo
   * padrão de `withIdentityLock`) — nunca vaza pro chamador.
   *
   * Regras (mesmo racional do CMDesk `getNextAgentByRoleta`, para UMA equipe/nível):
   * - Sem nenhum membro no nível → `undefined`.
   * - `team.roundRobinEnabled === false` → devolve o principal do nível (ou o primeiro membro se
   *   nenhum for principal), NUNCA avança o ponteiro.
   * - Round-robin ligado mas ninguém com `participatesInRoundRobin === true` → mesmo fallback do
   *   principal, sem avançar o ponteiro.
   * - Round-robin ligado com elegíveis → escolhe pelo ponteiro atual (módulo o tamanho da lista),
   *   avança o ponteiro, grava `lastAssignedAt` do escolhido.
   */
  selectNextMemberForLevel(teamId: string, level: string): Promise<{ userId: string; usedRoundRobin: boolean } | undefined>;
};

export type AddTeamMemberInput = {
  teamId: string;
  userId: string;
  role: TenantRole;
  attendanceLevel?: string;
  participatesInRoundRobin?: boolean;
  /** `undefined` = deixa a camada de aplicação decidir (primeiro membro do nível vira principal
   * automaticamente) — ver `addTeamMember` em `team-use-cases.ts`. */
  isPrincipalForLevel?: boolean;
};

export type UpdateTeamMemberInput = { attendanceLevel?: string; participatesInRoundRobin?: boolean; isPrincipalForLevel?: boolean };

export type TeamMembershipRepositoryPort = {
  add(input: AddTeamMemberInput): Promise<TeamMembership>;
  remove(teamId: string, userId: string): Promise<void>;
  listByTeam(teamId: string): Promise<TeamMembership[]>;
  listByUser(userId: string): Promise<TeamMembership[]>;
  getByTeamAndUser(teamId: string, userId: string): Promise<TeamMembership | undefined>;
  update(teamId: string, userId: string, input: UpdateTeamMemberInput): Promise<TeamMembership>;
  /** Desmarca `isPrincipalForLevel` de todo mundo do nível, exceto `exceptUserId` (se informado) —
   * único jeito de garantir "no máximo um principal por nível" sem constraint de banco (que
   * travaria em estados transitórios durante um update em lote). */
  clearPrincipalForLevel(teamId: string, level: string, exceptUserId?: string): Promise<void>;
  countByTeamAndLevel(teamId: string, level: string): Promise<number>;
};
