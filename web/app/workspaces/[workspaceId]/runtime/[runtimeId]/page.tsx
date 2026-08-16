"use client";

import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { RuntimeBindingGraph } from "@/features/runtime/components/RuntimeBindingGraph";
import { RuntimeContextPanel } from "@/features/runtime/components/RuntimeContextPanel";
import { RuntimeTaskContracts } from "@/features/runtime/components/RuntimeTaskContracts";
import { useRuntime, useRuntimeBindings } from "@/features/runtime/hooks";
import { createExecutionRun } from "@/features/execution/api";

/**
 * Detalhe de um runtime — Sprint 10 (Fase 7): grafo de bindings, contratos de entrada/saída por
 * tarefa, artefato esperado, relatório de validação e contexto de origem. Puramente informativo —
 * não existe (e não pode existir) nenhuma ação aqui: sem "Executar", sem gerar, sem publicar.
 */
export default function RuntimeDetailPage() {
  const params = useParams<{ workspaceId: string; runtimeId: string }>();
  const router = useRouter();
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const { data: detail, isLoading: isLoadingDetail, error: detailError, mutate: mutateDetail } = useRuntime(params.workspaceId, params.runtimeId);
  const { data: bindingsView, isLoading: isLoadingBindings, error: bindingsError, mutate: mutateBindings } = useRuntimeBindings(params.workspaceId, params.runtimeId);

  if (isLoadingDetail || isLoadingBindings) {
    return (
      <main className="mx-auto flex max-w-5xl justify-center px-3 py-10 sm:px-6 sm:py-16">
        <Spinner />
      </main>
    );
  }

  if (detailError || bindingsError) {
    return (
      <main className="mx-auto max-w-5xl px-3 py-10 sm:px-6 sm:py-16">
        <ErrorState
          error={detailError ?? bindingsError}
          onRetry={() => {
            mutateDetail();
            mutateBindings();
          }}
        />
      </main>
    );
  }

  if (!detail || !bindingsView) {
    return (
      <main className="mx-auto flex max-w-5xl justify-center px-3 py-10 sm:px-6 sm:py-16">
        <Spinner />
      </main>
    );
  }

  const { runtimePlan, validationReport, tasks, artifacts, context } = detail;
  const { bindings, inputs, outputs } = bindingsView;
  const issues = validationReport.issues;

  async function handleCreateDryRun() {
    await createRun("dry_run");
  }

  async function handleCreateRealExecution() {
    const confirmed = window.confirm("Iniciar uma execução real pode chamar Skills reais habilitadas por feature flag. Continuar?");
    if (!confirmed) return;
    await createRun("real");
  }

  async function createRun(executionMode: "dry_run" | "real") {
    setIsCreatingRun(true);
    try {
      const run = await createExecutionRun({
        workspaceId: params.workspaceId,
        runtimePlanId: runtimePlan.id,
        idempotencyKey: `web:${executionMode}:${runtimePlan.id}`,
        executionMode,
      });
      router.push(`/workspaces/${params.workspaceId}/execution/${run.id}`);
    } finally {
      setIsCreatingRun(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={runtimePlan.translationTemplate}
        description={`Estratégia ${runtimePlan.translatorStrategy} · versão ${runtimePlan.translatorVersion} · schema v${runtimePlan.runtimeSchemaVersion}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={runtimePlan.status} />
            <Button disabled={runtimePlan.status !== "validated" || isCreatingRun} onClick={handleCreateDryRun}>
              Criar simulação
            </Button>
            <Button variant="secondary" disabled={runtimePlan.status !== "validated" || isCreatingRun} onClick={handleCreateRealExecution}>
              Criar execução real
            </Button>
          </div>
        }
      />

      <ScreenGuide
        title="Antes de executar"
        description="Use esta tela para transformar um plano validado em simulação ou execução real."
        items={[
          "Confira se o status está validado.",
          "Crie simulação para testar sem publicar.",
          "Crie execução real só quando estiver pronto.",
          "Revise contexto, contratos e tarefas antes de iniciar.",
        ]}
        aside={<p>Simulação é o caminho mais seguro para testar uma regra nova.</p>}
      />

      <Card className="mb-6">
        <CardHeader>
          <p className="text-sm font-medium text-ink">Contexto de execução</p>
        </CardHeader>
        <CardBody>
          <RuntimeContextPanel context={context} />
        </CardBody>
      </Card>

      {issues.length > 0 ? (
        <Card className="mb-6 border-l-4 border-l-amber-500">
          <CardHeader>
            <p className="text-sm font-medium text-ink">Relatório de validação</p>
          </CardHeader>
          <CardBody className="flex flex-col gap-1.5">
            {issues.map((issue, index) => (
              <p key={index} className={`text-xs ${issue.severity === "error" ? "text-red-600" : "text-ink-muted"}`}>
                [{issue.code}] {issue.message}
              </p>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {tasks.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <p className="text-sm font-medium text-ink">Grafo de bindings</p>
          </CardHeader>
          <CardBody>
            <RuntimeBindingGraph tasks={tasks} bindings={bindings} />
          </CardBody>
        </Card>
      ) : null}

      {tasks.length > 0 ? (
        <div>
          <h2 className="mb-3 text-sm font-medium text-ink">Contratos por tarefa</h2>
          <RuntimeTaskContracts tasks={tasks} inputs={inputs} outputs={outputs} bindings={bindings} artifacts={artifacts} />
        </div>
      ) : null}
    </main>
  );
}
