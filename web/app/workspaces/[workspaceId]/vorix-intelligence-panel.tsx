"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDollarSign, Sparkles, Target } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { acceptCommercialSuggestion, completeTask, dismissCommercialSuggestion } from "@/features/crm/api";
import { useCommercialMetrics, useCommercialSuggestions, useTasks } from "@/features/crm/hooks";
import { formatCurrencyCents, formatDate } from "@/lib/format";

type IntelligenceLevel = "critical" | "attention" | "opportunity" | "info";

type IntelligenceItem = {
  id: string;
  level: IntelligenceLevel;
  title: string;
  context: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
  secondaryLabel?: string;
  onSecondary?: () => void | Promise<void>;
};

const LEVEL_CLASS: Record<IntelligenceLevel, string> = {
  critical: "text-destructive bg-destructive/10",
  attention: "text-warning bg-warning-bg",
  opportunity: "text-ai bg-ai-soft",
  info: "text-primary bg-accent-soft",
};

export function VorixIntelligencePanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const { data: suggestions, isLoading: suggestionsLoading, error: suggestionsError, mutate: mutateSuggestions } = useCommercialSuggestions(workspaceId, { status: "pending" });
  const { data: tasks, isLoading: tasksLoading, error: tasksError, mutate: mutateTasks } = useTasks(workspaceId, { status: "pending" });
  const { data: metrics, isLoading: metricsLoading, error: metricsError, mutate: mutateMetrics } = useCommercialMetrics(workspaceId);
  const [resolvingId, setResolvingId] = useState<string | undefined>();

  const loading = suggestionsLoading || tasksLoading || metricsLoading;
  const error = suggestionsError || tasksError || metricsError;
  const overdueTasks = (tasks ?? []).filter((task) => task.dueAt && new Date(task.dueAt) < new Date());

  async function handleAcceptSuggestion(id: string) {
    setResolvingId(id);
    try {
      await acceptCommercialSuggestion(id, workspaceId);
      await Promise.all([mutateSuggestions(), mutateTasks(), mutateMetrics()]);
      toast.success("Sugestao aplicada.");
    } catch (cause) {
      toast.error("Não foi possível aplicar a sugestão", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setResolvingId(undefined);
    }
  }

  async function handleDismissSuggestion(id: string) {
    setResolvingId(id);
    try {
      await dismissCommercialSuggestion(id, workspaceId);
      await mutateSuggestions();
    } catch (cause) {
      toast.error("Não foi possível descartar", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setResolvingId(undefined);
    }
  }

  async function handleResolveTask(id: string) {
    setResolvingId(id);
    try {
      await completeTask(id, workspaceId);
      await mutateTasks();
      toast.success("Tarefa concluída.");
    } catch (cause) {
      toast.error("Não foi possível concluir a tarefa", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setResolvingId(undefined);
    }
  }

  const items: IntelligenceItem[] = [
    ...(suggestions ?? []).slice(0, 3).map((suggestion) => ({
      id: suggestion.id,
      level: suggestion.confidence >= 0.8 ? "opportunity" as const : "info" as const,
      title: suggestion.title,
      context: suggestion.rationale,
      actionLabel: "Resolver",
      onAction: () => handleAcceptSuggestion(suggestion.id),
      secondaryLabel: "Descartar",
      onSecondary: () => handleDismissSuggestion(suggestion.id),
    })),
    ...overdueTasks.slice(0, 3).map((task) => ({
      id: task.id,
      level: "critical" as const,
      title: task.title,
      context: `Atrasada desde ${formatDate(task.dueAt)}`,
      actionLabel: "Concluir",
      onAction: () => handleResolveTask(task.id),
      secondaryLabel: "Ver tarefas",
      onSecondary: () => router.push(`/workspaces/${workspaceId}/tasks`),
    })),
    ...(metrics && metrics.dealsWithoutNextActionCount > 0
      ? [{
          id: "deals-without-next-action",
          level: "attention" as const,
          title: `${metrics.dealsWithoutNextActionCount} oportunidades sem próxima atividade`,
          context: `${formatCurrencyCents(metrics.openPipelineValueCents)} em pipeline precisa de cadência comercial.`,
          actionLabel: "Organizar",
          onAction: () => router.push(`/workspaces/${workspaceId}/deals`),
        }]
      : []),
  ].slice(0, 6);

  return (
    <section className="overflow-hidden rounded-2xl border border-ai/25 bg-card shadow-sm">
      <div className="relative px-4 py-4 sm:px-5">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ai to-transparent" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ai-soft text-ai">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ai">Vorix Intelligence</p>
              <h2 className="text-lg font-semibold text-foreground">O que precisa da sua atenção agora</h2>
            </div>
          </div>
          <Button variant="ghost" onClick={() => router.push(`/workspaces/${workspaceId}/deals`)}>
            Abrir comercial <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4">
          {loading ? <IntelligenceSkeleton /> : null}
          {error ? <ErrorState error={error} onRetry={() => { void Promise.all([mutateSuggestions(), mutateTasks(), mutateMetrics()]); }} /> : null}
          {!loading && !error && items.length === 0 ? <CompactAllClear /> : null}
          {!loading && !error && items.length > 0 ? (
            <div className="divide-y divide-border/70">
              {items.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${LEVEL_CLASS[item.level]}`}>
                      {item.level === "critical" ? <AlertTriangle className="h-4 w-4" /> : item.level === "opportunity" ? <CircleDollarSign className="h-4 w-4" /> : <Target className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.context}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
                    {item.secondaryLabel && item.onSecondary ? (
                      <Button variant="ghost" size="sm" disabled={Boolean(resolvingId)} onClick={() => { void item.onSecondary?.(); }}>
                        {item.secondaryLabel}
                      </Button>
                    ) : null}
                    <Button size="sm" loading={resolvingId === item.id} disabled={Boolean(resolvingId)} onClick={() => { void item.onAction(); }}>
                      {item.actionLabel}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function IntelligenceSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

function CompactAllClear() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-active-bg text-status-active">
        <CheckCircle2 className="h-4 w-4" />
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">Tudo sob controle</p>
        <p className="text-xs text-muted-foreground">Nenhuma acao critica precisa da sua atenção agora.</p>
      </div>
    </div>
  );
}
