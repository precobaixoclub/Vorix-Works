"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/Spinner";
import { acceptCommercialSuggestion, completeTask, dismissCommercialSuggestion } from "@/features/crm/api";
import { useCommercialSuggestions, useTasks } from "@/features/crm/hooks";
import { formatDate } from "@/lib/format";

/**
 * "Vorix Intelligence" — CRM/Comercial, Fase 5. Cockpit de "o que precisa da sua atenção" —
 * sugestões pendentes do Copiloto Comercial + tarefas atrasadas, cada item com uma ação primária
 * de resolução. Deliberadamente enxuto nesta fase (auditoria, seção 20): agrega só o que já é
 * calculado em outro lugar (sugestões/tarefas), nunca escaneia todo o CRM em busca de "leads
 * quentes" por aqui — isso ficaria caro e fora de escopo para uma primeira versão.
 */
export function VorixIntelligencePanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { data: suggestions, isLoading: suggestionsLoading, mutate: mutateSuggestions } = useCommercialSuggestions(workspaceId, { status: "pending" });
  const { data: tasks, isLoading: tasksLoading, mutate: mutateTasks } = useTasks(workspaceId, { status: "pending" });
  const overdueTasks = (tasks ?? []).filter((task) => task.dueAt && new Date(task.dueAt) < new Date());
  const [resolvingId, setResolvingId] = useState<string | undefined>();

  const loading = suggestionsLoading || tasksLoading;
  const hasNothing = !loading && (suggestions?.length ?? 0) === 0 && overdueTasks.length === 0;

  async function handleAcceptSuggestion(id: string) {
    setResolvingId(id);
    try {
      await acceptCommercialSuggestion(id, workspaceId);
      await Promise.all([mutateSuggestions(), mutateTasks()]);
    } finally {
      setResolvingId(undefined);
    }
  }

  async function handleDismissSuggestion(id: string) {
    setResolvingId(id);
    try {
      await dismissCommercialSuggestion(id, workspaceId);
      await mutateSuggestions();
    } finally {
      setResolvingId(undefined);
    }
  }

  async function handleResolveTask(id: string) {
    setResolvingId(id);
    try {
      await completeTask(id, workspaceId);
      await mutateTasks();
    } finally {
      setResolvingId(undefined);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <p className="text-sm font-semibold text-foreground">Vorix Intelligence</p>
          <p className="mt-1 text-xs text-muted-foreground">O que precisa da sua atenção agora.</p>
        </div>
      </CardHeader>
      <CardBody>
        {loading ? <div className="flex justify-center py-6"><Spinner /></div> : null}
        {hasNothing ? <EmptyState title="Tudo em dia" description="Nenhuma sugestão pendente e nenhuma tarefa atrasada." /> : null}
        {!loading ? (
          <div className="space-y-2">
            {(suggestions ?? []).map((suggestion) => (
              <div key={suggestion.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">✨ {suggestion.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{suggestion.rationale}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button variant="secondary" onClick={() => handleAcceptSuggestion(suggestion.id)} loading={resolvingId === suggestion.id} disabled={Boolean(resolvingId)}>Resolver agora</Button>
                  <Button variant="ghost" onClick={() => handleDismissSuggestion(suggestion.id)} disabled={Boolean(resolvingId)}>Descartar</Button>
                </div>
              </div>
            ))}
            {overdueTasks.map((task) => (
              <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                  <p className="text-xs text-muted-foreground">Atrasada desde {formatDate(task.dueAt)}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button variant="secondary" onClick={() => handleResolveTask(task.id)} loading={resolvingId === task.id} disabled={Boolean(resolvingId)}>Concluir</Button>
                  <Button variant="ghost" onClick={() => router.push(`/workspaces/${workspaceId}/tasks`)}>Ver tarefa</Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
