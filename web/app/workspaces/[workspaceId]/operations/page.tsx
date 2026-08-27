"use client";

import { Activity, Gauge, History, ListOrdered, Timer, Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav, type PageSubnavItem } from "@/components/PageSubnav";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { resetCircuitBreaker } from "@/features/operations/api";
import { useBackpressure, useBackupRestorePlan, useCircuitBreakers, useQueues, useRateLimits, useSecretHealth, useSystemHealth } from "@/features/operations/hooks";
import type { BackpressureSignal, CircuitBreaker, OperationalCheck, QueueSnapshot, RateLimitBucket } from "@/features/operations/types";

const TAB_ITEMS: PageSubnavItem[] = [
  { value: "saude", label: "Saúde", icon: Activity },
  { value: "circuitos", label: "Circuitos", icon: Zap },
  { value: "pressao", label: "Pressão", icon: Gauge },
  { value: "limites", label: "Limites de taxa", icon: Timer },
  { value: "filas", label: "Filas", icon: ListOrdered },
  { value: "restauracao", label: "Restauração", icon: History },
] as const;

type TabKey = (typeof TAB_ITEMS)[number]["value"];

export default function OperationsPage() {
  const workspace = useCurrentWorkspace();
  const [tab, setTab] = useState<TabKey>("saude");
  const [resetTarget, setResetTarget] = useState<CircuitBreaker | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const health = useSystemHealth(workspace.id);
  const circuits = useCircuitBreakers(workspace.id);
  const backpressure = useBackpressure(workspace.id);
  const rateLimits = useRateLimits(workspace.id);
  const queues = useQueues(workspace.id);
  const secrets = useSecretHealth(workspace.id);
  const backup = useBackupRestorePlan(workspace.id);

  async function reset(id: string) {
    setResetBusy(true);
    try {
      await resetCircuitBreaker(id, workspace.id);
      await Promise.all([health.mutate(), circuits.mutate()]);
      setResetTarget(null);
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Operação" description="Monitore a saúde do sistema e veja rapidamente se algo impede as publicações." />

      <ScreenGuide
        title="Leitura rápida"
        description="Use esta tela quando uma geração, agendamento ou publicação parecer travada."
        items={[
          "Saúde mostra se o sistema está pronto.",
          "Circuitos mostra integrações bloqueadas por falha repetida.",
          "Pressão, Limites e Filas indicam excesso de uso ou espera.",
          "Restauração mostra o plano de recuperação se algo parar.",
        ]}
        aside={<p>Se tudo estiver saudável aqui, investigue a publicação específica em Postagens Publicadas.</p>}
      />

      <PageSubnav items={TAB_ITEMS} value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        {health.isLoading ? <LoadingPanel /> : null}
        {health.error ? (
          <ErrorState error={health.error} onRetry={() => health.mutate()} />
        ) : (
          <>
            {tab === "saude" && health.data ? <SummaryPanel health={health.data} queueSize={queues.data?.publication.localQueueSize ?? 0} secretOk={secrets.data?.ok ?? false} /> : null}
            {tab === "circuitos" ? <CircuitPanel items={circuits.data ?? health.data?.circuitBreakers ?? []} busy={resetBusy} onRequestReset={setResetTarget} /> : null}
            {tab === "pressao" ? <BackpressurePanel items={backpressure.data ?? health.data?.backpressure ?? []} /> : null}
            {tab === "limites" ? <RateLimitPanel items={rateLimits.data ?? []} /> : null}
            {tab === "filas" ? <QueuePanel snapshot={queues.data} /> : null}
            {tab === "restauracao" ? <RestorePanel plan={backup.data} /> : null}
          </>
        )}
      </PageSubnav>

      <ConfirmDialog
        open={!!resetTarget}
        title={`Redefinir disjuntor de ${resetTarget?.target ?? ""}?`}
        description="O disjuntor volta a permitir chamadas para este alvo mesmo que a causa original da falha ainda não tenha sido corrigida."
        confirmLabel="Redefinir"
        busy={resetBusy}
        onCancel={() => setResetTarget(null)}
        onConfirm={() => {
          if (resetTarget) return reset(resetTarget.id);
        }}
      />
    </main>
  );
}

function SummaryPanel({ health, queueSize, secretOk }: { health: NonNullable<ReturnType<typeof useSystemHealth>["data"]>; queueSize: number; secretOk: boolean }) {
  const checksByStatus = countBy(health.checks.map((check) => check.status));
  return (
    <div className="space-y-5">
      <StatsGrid>
        <Metric title="Status" value={health.status} status={health.status} />
        <Metric title="Checks com falha" value={String(checksByStatus.fail ?? 0)} status={(checksByStatus.fail ?? 0) > 0 ? "failed" : "healthy"} />
        <Metric title="Fila local" value={String(queueSize)} status={queueSize > 0 ? "pending" : "healthy"} />
        <Metric title="Gerenciador de Segredos" value={secretOk ? "ok" : "bloqueado"} status={secretOk ? "healthy" : "failed"} />
      </StatsGrid>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-foreground">Prontidão</h2>
            <StatusBadge status={health.status} />
          </CardHeader>
          <CardBody>
            <CheckTable checks={health.checks} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-foreground">Portão de Liberação</h2>
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

function CircuitPanel({ items, busy, onRequestReset }: { items: readonly CircuitBreaker[]; busy: boolean; onRequestReset: (item: CircuitBreaker) => void }) {
  if (items.length === 0) return <EmptyState title="Sem disjuntores registrados" description="Nenhum provedor ou manipulador abriu circuito nesta janela." />;
  return (
    <Card>
      <CardBody>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alvo</TableHead>
              <TableHead>Escopo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Falhas</TableHead>
              <TableHead>Última falha</TableHead>
              <TableHead>Atualizado</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium text-foreground">{item.target}</TableCell>
                <TableCell className="text-muted-foreground">{item.scope}</TableCell>
                <TableCell><StatusBadge status={item.state} /></TableCell>
                <TableCell>{item.failureCount}</TableCell>
                <TableCell className="text-muted-foreground">{item.lastFailureCode ?? "-"}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(item.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRequestReset(item)}>Redefinir</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
                <p className="text-sm font-semibold text-foreground">{item.component}</p>
                <p className="text-xs text-muted-foreground">{item.reason}</p>
              </div>
              <div className="flex gap-2"><StatusBadge status={item.status} /><StatusBadge status={item.severity} /></div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{item.safeMessage}</p>
            <p className="mt-3 text-xs text-muted-foreground">{formatDate(item.observedAt)}</p>
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grupo</TableHead>
              <TableHead>Escopo</TableHead>
              <TableHead>Limite</TableHead>
              <TableHead>Restante</TableHead>
              <TableHead>Reset</TableHead>
              <TableHead>Atualizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.key}>
                <TableCell className="font-medium text-foreground">{item.routeGroup}</TableCell>
                <TableCell className="text-muted-foreground">tenant atual</TableCell>
                <TableCell>{item.limit}</TableCell>
                <TableCell>{item.remaining}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(item.resetAt)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(item.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function QueuePanel({ snapshot }: { snapshot?: QueueSnapshot }) {
  if (!snapshot) return <LoadingPanel />;
  const jobs = snapshot.publication.localJobs;
  if (jobs.length === 0) return <EmptyState title="Fila vazia" description="Nenhum job de publicação aguardando execução neste workspace." />;
  return (
    <Card>
      <CardBody>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Publicação</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Entrada</TableHead>
              <TableHead>Executar após</TableHead>
              <TableHead>Job</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium text-foreground">{job.publicationId}</TableCell>
                <TableCell className="text-muted-foreground">{job.kind}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(job.enqueuedAt)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(job.runAfter)}</TableCell>
                <TableCell className="break-all text-xs text-muted-foreground">{job.id}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function RestorePanel({ plan }: { plan?: NonNullable<ReturnType<typeof useBackupRestorePlan>["data"]> }) {
  if (!plan) return <LoadingPanel />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <OrderedListCard title="Fonte de verdade" items={plan.sourceOfTruth} />
      <OrderedListCard title="Dados derivados" items={plan.derivedData} />
      <OrderedListCard title="Ordem de restore" items={plan.restoreOrder} />
      <OrderedListCard title="Checks de consistência" items={plan.consistencyChecks} />
    </div>
  );
}

function CheckTable({ checks }: { checks: readonly OperationalCheck[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Componente</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Mensagem</TableHead>
          <TableHead>Latência</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {checks.map((check) => (
          <TableRow key={check.id}>
            <TableCell className="font-medium text-foreground">{check.component}</TableCell>
            <TableCell><StatusBadge status={check.status} /></TableCell>
            <TableCell className="text-muted-foreground">{check.safeMessage}</TableCell>
            <TableCell className="text-muted-foreground">{check.latencyMs ?? 0} ms</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Metric({ title, value, status }: { title: string; value: string; status: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
        <div className="mt-2"><StatusBadge status={status} /></div>
      </CardBody>
    </Card>
  );
}

function OrderedListCard({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold text-foreground">{title}</h2></CardHeader>
      <CardBody>
        <ol className="space-y-2 text-sm text-muted-foreground">
          {items.map((item, index) => (
            <li key={item} className="flex gap-3">
              <span className="w-6 shrink-0 text-right text-muted-foreground">{index + 1}</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function LoadingPanel() {
  return <div className="flex min-h-64 items-center justify-center"><Spinner className="h-5 w-5 text-muted-foreground" /></div>;
}

function countBy(items: readonly string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => ({ ...acc, [item]: (acc[item] ?? 0) + 1 }), {});
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("pt-BR") : "-";
}
