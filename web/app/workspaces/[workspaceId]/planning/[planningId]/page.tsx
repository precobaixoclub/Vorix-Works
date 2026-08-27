"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { PlanningGraph } from "@/features/planning/components/PlanningGraph";
import { PlanningTaskList } from "@/features/planning/components/PlanningTaskList";
import { usePlanning, usePlanningTasks } from "@/features/planning/hooks";
import { useRuntimeList } from "@/features/runtime/hooks";
import { formatDateTime } from "@/lib/format";

/**
 * Detalhe de um plano — Sprint 09 (Fase 8): grafo de execução, tarefas com artefato esperado,
 * relatório de validação e decisões do Arthur Planner. Puramente informativo — não existe (e não
 * pode existir) nenhuma ação aqui: sem "Executar", sem gerar, sem publicar.
 */
export default function PlanningDetailPage() {
  const params = useParams<{ workspaceId: string; planningId: string }>();
  const { data: planningData, isLoading: isLoadingPlanning, error: planningError, mutate: mutatePlanning } = usePlanning(params.workspaceId, params.planningId);
  const { data: tasksData, isLoading: isLoadingTasks, error: tasksError, mutate: mutateTasks } = usePlanningTasks(params.workspaceId, params.planningId);
  const { data: runtimes } = useRuntimeList(params.workspaceId, params.planningId);

  if (isLoadingPlanning || isLoadingTasks) {
    return (
      <main className="mx-auto flex max-w-5xl justify-center px-3 py-10 sm:px-6 sm:py-16">
        <Spinner />
      </main>
    );
  }

  if (planningError || tasksError) {
    return (
      <main className="mx-auto max-w-5xl px-3 py-10 sm:px-6 sm:py-16">
        <ErrorState
          error={planningError ?? tasksError}
          onRetry={() => {
            mutatePlanning();
            mutateTasks();
          }}
        />
      </main>
    );
  }

  if (!planningData || !tasksData) {
    return (
      <main className="mx-auto flex max-w-5xl justify-center px-3 py-10 sm:px-6 sm:py-16">
        <Spinner />
      </main>
    );
  }

  const { planning, graph, decisions } = planningData;
  const { tasks, artifacts } = tasksData;
  const runtime = runtimes?.[0];
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const issues = planning.validationReport.issues;

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={planning.planningTemplate}
        description={`Estratégia ${planning.plannerStrategy} · versão ${planning.plannerVersion} · grafo v${planning.graphVersion}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={planning.status} />
            {runtime ? (
              <Link href={`/workspaces/${params.workspaceId}/runtime/${runtime.id}`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted">
                Abrir runtime
              </Link>
            ) : (
              <Link href={`/workspaces/${params.workspaceId}/runtime`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground hover:bg-muted">
                Ver runtimes
              </Link>
            )}
          </div>
        }
      />
      <p className="mb-4 break-all text-xs text-muted-foreground/70">
        Planejamento {planning.id} · Briefing {planning.briefingId} · Comando {planning.preparedCommandId}
      </p>

      <ScreenGuide
        title="Como interpretar este plano"
        description="Este detalhe mostra o roteiro que a automação preparou antes de gerar ou publicar conteúdo."
        items={[
          "Relatório de validação mostra avisos e erros.",
          "Grafo mostra a ordem das tarefas.",
          "Tarefas mostram o que cada etapa espera produzir.",
          "Decisões explicam por que o sistema escolheu esse caminho.",
        ]}
        aside={<p>Se houver erro de validação, ajuste a regra em Produção antes de seguir.</p>}
      />

      {issues.length > 0 ? (
        <Card className="mb-6 border-l-4 border-l-amber-500">
          <CardHeader>
            <p className="text-sm font-medium text-foreground">Relatório de validação</p>
          </CardHeader>
          <CardBody className="flex flex-col gap-1.5">
            {issues.map((issue, index) => (
              <p key={index} className={`text-xs ${issue.severity === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                [{issue.severity === "error" ? "erro" : "aviso"}] {issue.message}
              </p>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {graph.nodes.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <p className="text-sm font-medium text-foreground">Grafo de execução</p>
          </CardHeader>
          <CardBody>
            <PlanningGraph graph={graph} tasksById={tasksById} />
          </CardBody>
        </Card>
      ) : null}

      {tasks.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-medium text-foreground">Tarefas</h2>
          <PlanningTaskList tasks={tasks} artifacts={artifacts} />
        </div>
      ) : null}

      {decisions.length > 0 ? (
        <Card>
          <CardHeader>
            <p className="text-sm font-medium text-foreground">Decisões do Arthur Planner</p>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {decisions.map((decision) => (
              <div key={decision.id}>
                <p className="text-xs font-medium text-foreground">{decision.decisionCode}</p>
                <p className="text-xs text-muted-foreground">{decision.reason}</p>
                <p className="text-[11px] text-muted-foreground/70">{formatDateTime(decision.createdAt)}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </main>
  );
}
