"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useTeams } from "@/features/identity/hooks";
import { useInboxModuleStatus } from "@/features/inbox/hooks";
import { AttendanceModuleToggle } from "../conversas/inbox-tab";
import { KanbanBoard } from "./kanban-board";

/**
 * Kanban de atendimento (réplica adaptada do CMDesk, pedido explícito do usuário) — quadro por
 * EQUIPE (nunca um quadro único global): cada equipe tem seu próprio conjunto de fases/colunas
 * (`TeamKanbanPhase`), então a primeira decisão da tela é sempre "qual equipe". Rota própria
 * (`/kanban`, fora de `/conversas`) por pedido explícito do guia de implementação do usuário —
 * o board é uma visão gerencial por equipe, não uma aba da caixa de entrada individual.
 */
export default function KanbanPage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const { data: status, isLoading: statusLoading } = useInboxModuleStatus();
  const { data: teams, error: teamsError, isLoading: teamsLoading, mutate: mutateTeams } = useTeams(workspace.id);
  const [teamId, setTeamId] = useState<string>("");

  useEffect(() => {
    if (!teamId && teams && teams.length > 0) setTeamId(teams[0].id);
  }, [teamId, teams]);

  if (statusLoading || teamsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (status && !status.enabled) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <EmptyState
          icon={<span aria-hidden="true">🗂️</span>}
          title="Kanban de atendimento indisponível"
          description="O atendimento por canais está temporariamente indisponível neste ambiente."
          action={<Button variant="secondary" onClick={() => router.push(`/workspaces/${workspace.id}`)}>Voltar para Início</Button>}
        />
      </div>
    );
  }

  if (teamsError) {
    return (
      <div className="p-3 sm:p-6">
        <ErrorState error={teamsError} onRetry={() => mutateTeams()} />
      </div>
    );
  }

  if (!teams || teams.length === 0) {
    return (
      <div className="p-3 sm:p-6">
        <EmptyState
          icon={<span aria-hidden="true">🗂️</span>}
          title="Nenhuma equipe cadastrada"
          description="Crie uma equipe em Configurações → Equipes para começar a organizar o atendimento em fases."
          action={<Button variant="secondary" onClick={() => router.push(`/workspaces/${workspace.id}/settings/teams`)}>Ir para Equipes</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:p-4">
      {/* Cabeçalho compacto (pedido explícito do usuário: "hoje existe espaço demais entre
         título/descrição/contagem/seletor/botão Fases/quadro") — título, alternância Lista/Kanban
         e seletor de equipe numa linha só, sem parágrafo de descrição (o nome da tela já é
         autoexplicativo) — o resto (contagem + botão Fases) continua dentro do próprio
         `KanbanBoard`, já compacto numa linha própria logo abaixo. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-lg font-semibold text-foreground">Kanban de atendimento</h1>
          <AttendanceModuleToggle workspaceId={workspace.id} active="kanban" />
        </div>
        <SearchableCombo
          items={teams.map((team) => ({ id: team.id, label: team.name }))}
          value={teamId}
          onValueChange={setTeamId}
          placeholder="Selecione a equipe"
          className="w-48"
        />
      </div>
      {teamId ? (
        <div className="min-h-0 flex-1">
          <KanbanBoard workspaceId={workspace.id} teamId={teamId} teams={teams} />
        </div>
      ) : null}
    </div>
  );
}
