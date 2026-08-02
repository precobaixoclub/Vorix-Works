"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Spinner } from "@/components/Spinner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { resetCircuitBreaker } from "@/features/operations/api";
import { useBackpressure, useBackupRestorePlan, useCircuitBreakers, useQueues, useRateLimits, useSecretHealth, useSystemHealth } from "@/features/operations/hooks";
import type { BackpressureSignal, CircuitBreaker, OperationalCheck, RateLimitBucket } from "@/features/operations/types";

const TABS = ["Resumo", "Circuitos", "Pressão", "Limites de taxa", "Restauração"] as const;

export default function OperationsPage() {
  const workspace = useCurrentWorkspace();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Resumo");
  const health = useSystemHealth(workspace.id);
  const circuits = useCircuitBreakers(workspace.id);
  const backpressure = useBackpressure(workspace.id);
  const rateLimits = useRateLimits();
  const queues = useQueues();
  const secrets = useSecretHealth();
  const backup = useBackupRestorePlan();

  async function reset(id: string) {
    await resetCircuitBreaker(id);
    await Promise.all([health.mutate(), circuits.mutate()]);
  }

  return (
    <main className="px-8 py-6">
      <PageHeader title="Operação" description="Saúde, limites, filas, disjuntores, prontidão e plano de recuperação." />

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button key={item} onClick={() => setTab(item)} className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === item ? "bg-accent text-white" : "bg-surface-raised text-ink-muted hover:bg-surface-sunken"}`}>
            {item}
          </button>
        ))}
      </div>

      {health.isLoading ? <LoadingPanel /> : null}
      {health.error ? (
        <ErrorState error={health.error} onRetry={() => health.mutate()} />
      ) : (
        <>
          {tab === "Resumo" && health.data ? <SummaryPanel health={health.data} queueSize={queues.data?.publication.localQueueSize ?? 0} secretOk={secrets.data?.ok ?? false} /> : null}
          {tab === "Circuitos" ? <CircuitPanel items={circuits.data ?? health.data?.circuitBreakers ?? []} onReset={reset} /> : null}
          {tab === "Pressão" ? <BackpressurePanel items={backpressure.data ?? health.data?.backpressure ?? []} /> : null}
          {tab === "Limites de taxa" ? <RateLimitPanel items={rateLimits.data ?? []} /> : null}
          {tab === "Restauração" ? <RestorePanel plan={backup.data} /> : null}
        </>
      )}
    </main>
  );
}

function SummaryPanel({ health, queueSize, secretOk }: { health: NonNullable<ReturnType<typeof useSystemHealth>["data"]>; queueSize: number; secretOk: boolean }) {
  const checksByStatus = countBy(health.checks.map((check) => check.status));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="Status" value={health.status} status={health.status} />
        <Metric title="Checks com falha" value={String(checksByStatus.fail ?? 0)} status={(checksByStatus.fail ?? 0) > 0 ? "failed" : "healthy"} />
        <Metric title="Fila local" value={String(queueSize)} status={queueSize > 0 ? "pending" : "healthy"} />
        <Metric title="Gerenciador de Segredos" value={secretOk ? "ok" : "bloqueado"} status={secretOk ? "healthy" : "failed"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-ink">Prontidão</h2>
            <StatusBadge status={health.status} />
          </CardHeader>
          <CardBody>
            <CheckTable checks={health.checks} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-ink">Portão de Liberação</h2>
            <StatusBadge status={health.releaseGate.productionEnabled ? "blocked" : "healthy"} />
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Row label="Ambiente" value={health.releaseGate.environment} />
            <Row label="Ambiente do provedor" value={health.releaseGate.providerEnvironment} />
            <Row label="Produção" value={health.releaseGate.productionEnabled ? "habilitado" : "bloqueado"} />
            <Row label="Canario" value={health.releaseGate.canaryEnabled ? "ativo" : "inativo"} />
            <Row label="Tenants" value={String(health.releaseGate.canaryTenantCount)} />
            <Row label="Espaços de Trabalho" value={String(health.releaseGate.canaryWorkspaceCount)} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function CircuitPanel({ items, onReset }: { items: readonly CircuitBreaker[]; onReset: (id: string) => Promise<void> }) {
  if (items.length === 0) return <EmptyState title="Sem disjuntores registrados" description="Nenhum provedor ou manipulador abriu circuito nesta janela." />;
  return (
    <Card>
      <CardBody>
        <div className="overflow-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead><tr className="border-b border-border text-xs text-ink-muted"><th className="py-2">Alvo</th><th>Escopo</th><th>Estado</th><th>Falhas</th><th>Última falha</th><th>Atualizado</th><th /></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="py-2 font-medium text-ink">{item.target}</td>
                  <td className="text-ink-muted">{item.scope}</td>
                  <td><StatusBadge status={item.state} /></td>
                  <td>{item.failureCount}</td>
                  <td className="text-ink-muted">{item.lastFailureCode ?? "-"}</td>
                  <td className="text-ink-muted">{formatDate(item.updatedAt)}</td>
                  <td className="text-right"><Button variant="secondary" onClick={() => onReset(item.id)}>Redefinir</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function BackpressurePanel({ items }: { items: readonly BackpressureSignal[] }) {
  if (items.length === 0) return <EmptyState title="Sem sinais de pressão" description="Nenhum subsistema registrou pressão operacional." />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => (
        <Card key={item.id}>
          <CardBody>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">{item.component}</p>
                <p className="text-xs text-ink-muted">{item.reason}</p>
              </div>
              <div className="flex gap-2"><StatusBadge status={item.status} /><StatusBadge status={item.severity} /></div>
            </div>
            <p className="mt-3 text-sm text-ink-muted">{item.safeMessage}</p>
            <p className="mt-3 text-xs text-ink-faint">{formatDate(item.observedAt)}</p>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function RateLimitPanel({ items }: { items: readonly RateLimitBucket[] }) {
  if (items.length === 0) return <EmptyState title="Sem buckets ativos" description="Nenhum limite foi consumido nesta janela." />;
  return (
    <Card>
      <CardBody>
        <div className="overflow-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead><tr className="border-b border-border text-xs text-ink-muted"><th className="py-2">Grupo</th><th>Principal</th><th>IP</th><th>Limite</th><th>Restante</th><th>Reset</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.key} className="border-b border-border last:border-0"><td className="py-2 font-medium text-ink">{item.routeGroup}</td><td className="text-ink-muted">{item.principalId ?? "-"}</td><td className="text-ink-muted">{item.ip ?? "-"}</td><td>{item.limit}</td><td>{item.remaining}</td><td className="text-ink-muted">{formatDate(item.resetAt)}</td></tr>)}</tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function RestorePanel({ plan }: { plan?: NonNullable<ReturnType<typeof useBackupRestorePlan>["data"]> }) {
  if (!plan) return <LoadingPanel />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <ListCard title="Fonte de verdade" items={plan.sourceOfTruth} />
      <ListCard title="Dados derivados" items={plan.derivedData} />
      <ListCard title="Ordem de restore" items={plan.restoreOrder} />
      <ListCard title="Checks de consistência" items={plan.consistencyChecks} />
    </div>
  );
}

function CheckTable({ checks }: { checks: readonly OperationalCheck[] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead><tr className="border-b border-border text-xs text-ink-muted"><th className="py-2">Componente</th><th>Status</th><th>Mensagem</th><th>Latência</th></tr></thead>
        <tbody>{checks.map((check) => <tr key={check.id} className="border-b border-border last:border-0"><td className="py-2 font-medium text-ink">{check.component}</td><td><StatusBadge status={check.status} /></td><td className="text-ink-muted">{check.safeMessage}</td><td className="text-ink-muted">{check.latencyMs ?? 0} ms</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Metric({ title, value, status }: { title: string; value: string; status: string }) {
  return <Card><CardBody><p className="text-xs text-ink-muted">{title}</p><p className="mt-2 text-2xl font-semibold text-ink">{value}</p><div className="mt-2"><StatusBadge status={status} /></div></CardBody></Card>;
}

function ListCard({ title, items }: { title: string; items: readonly string[] }) {
  return <Card><CardHeader><h2 className="text-sm font-semibold text-ink">{title}</h2></CardHeader><CardBody><ol className="space-y-2 text-sm text-ink-muted">{items.map((item, index) => <li key={item} className="flex gap-3"><span className="w-6 shrink-0 text-right text-ink-faint">{index + 1}</span><span>{item}</span></li>)}</ol></CardBody></Card>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-ink-muted">{label}</span><span className="font-medium text-ink">{value}</span></div>;
}

function LoadingPanel() {
  return <div className="flex min-h-64 items-center justify-center"><Spinner className="h-5 w-5 text-ink-muted" /></div>;
}

function countBy(items: readonly string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item]: (acc[item] ?? 0) + 1 }), {});
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("pt-BR") : "-";
}

