"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const { data: status, isLoading: statusLoading } = useInboxModuleStatus();
  const { data: teams, error: teamsError, isLoading: teamsLoading, mutate: mutateTeams } = useTeams(workspace.id);
  // Mesma chave de querystring que `inbox-filters.tsx` usa pro filtro "Equipe" da tela Conversas
  // (`team`) — pedido explícito do usuário: escolher uma equipe em Conversas e trocar pra Kanban
  // já deve abrir o board DAQUELA equipe, sem escolher de novo.
  const [teamId, setTeamIdState] = useState<string>(() => searchParams.get("team") ?? "");

  useEffect(() => {
    if (!teamId && teams && teams.length > 0) setTeamIdState(teams[0].id);
  }, [teamId, teams]);

  const setTeamId = useCallback(
    (nextTeamId: string) => {
      setTeamIdState(nextTeamId);
      const params = new URLSearchParams(searchParams.toString());
      if (nextTeamId) params.set("team", nextTeamId);
      else params.delete("team");
      const query = params.toString();
      router.replace(query ? `/workspaces/${workspace.id}/kanban?${query}` : `/workspaces/${workspace.id}/kanban`, { scroll: false });
    },
    [router, searchParams, workspace.id],
  );

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
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3 sm:p-4">
      {/* Cabeçalho compacto (pedido explícito do usuário: "hoje existe espaço demais entre
         título/descrição/contagem/seletor/botão Fases/quadro") — título, alternância Lista/Kanban
         e seletor de equipe numa linha só, sem parágrafo de descrição (o nome da tela já é
         autoexplicativo) — o resto (contagem, FilterBar e botão Fases) continua dentro do próprio
         `KanbanBoard`, já compacto em linhas próprias logo abaixo. A PÁGINA em si nunca mais rola
         (`overflow-hidden`, era `overflow-y-auto` — a causa raiz de "a página inteira desce pra ver
         os cards": o board por baixo já tinha scroll por coluna certo, mas o wrapper da página por
         cima competia como um segundo scroll sem altura travada; ver também `layout.tsx`). */}
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
