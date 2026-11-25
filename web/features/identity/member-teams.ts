import useSWR from "swr";
import { listTeamMembers } from "./api";
import { useTeams } from "./hooks";
import type { Team } from "./types";

/** Equipes do workspace com os usuários de cada uma (para saber a equipe de um responsável). */
export type TeamWithMembers = { team: Team; userIds: readonly string[] };

export function useWorkspaceTeamMembers(workspaceId: string) {
  const { data: teams } = useTeams(workspaceId);
  const key = teams ? ["team-members-by-team", workspaceId, teams.map((team) => team.id).sort().join(",")] : null;
  return useSWR(key, () => Promise.all(teams!.map(async (team): Promise<TeamWithMembers> => ({
    team,
    // Sem leitura de uma equipe, ela só deixa de ser sugerida — o formulário continua funcionando.
    userIds: (await listTeamMembers(team.id, workspaceId).catch(() => [])).map((member) => member.userId),
  }))));
}

/**
 * Equipe sugerida para um responsável: a do contexto (ex.: a equipe da conversa) se ele fizer parte
 * dela; senão uma equipe específica dele; senão a equipe padrão do workspace, se for membro. Sem
 * equipe → "" (sem equipe).
 */
export function teamForUser(entries: readonly TeamWithMembers[] | undefined, userId: string, preferredTeamId?: string): string {
  if (!userId || !entries) return "";
  const mine = entries.filter((entry) => entry.userIds.includes(userId)).map((entry) => entry.team);
  if (preferredTeamId && mine.some((team) => team.id === preferredTeamId)) return preferredTeamId;
  const specific = mine.filter((team) => !team.isDefault).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return (specific[0] ?? mine.find((team) => team.isDefault))?.id ?? "";
}
