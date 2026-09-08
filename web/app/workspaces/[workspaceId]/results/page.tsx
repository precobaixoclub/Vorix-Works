"use client";

import { useState } from "react";
import { brl, horas, KpiCard, num, pct } from "@/components/DashboardKit";
import { Card, CardBody, CardHeader } from "@/components/Card";
import { Input, Label } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatsGrid } from "@/components/StatsGrid";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useCommercialMetrics, usePipelines } from "@/features/crm/hooks";
import { useInboxMetrics } from "@/features/inbox/hooks";

function seconds(value: number | undefined): string {
  if (value === undefined) return "—";
  return horas(value / 3600);
}

export default function ResultsPage() {
  const workspace = useCurrentWorkspace();
  const { data: pipelines } = usePipelines(workspace.id);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [origin, setOrigin] = useState("");

  const filters = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    pipelineId: pipelineId || undefined,
    ownerUserId: ownerUserId.trim() || undefined,
    origin: origin.trim() || undefined,
  };

  const { data: commercial } = useCommercialMetrics(workspace.id, filters);
  const { data: attendance } = useInboxMetrics(workspace.id, { dateFrom: filters.dateFrom, dateTo: filters.dateTo });

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Resultados" description="Atendimento e comercial num só lugar — sempre a partir de dados reais, nunca uma atribuição inventada." />

      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="results-from">De</Label>
            <Input id="results-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="results-to">Até</Label>
            <Input id="results-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
          {pipelines && pipelines.length > 1 ? (
            <div>
              <Label htmlFor="results-pipeline">Pipeline</Label>
              <Select value={pipelineId} onValueChange={setPipelineId}>
                <SelectTrigger id="results-pipeline" className="w-44"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  {pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div>
            <Label htmlFor="results-owner">Responsável</Label>
            <Input id="results-owner" value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} placeholder="ID do usuário" className="w-40" />
          </div>
          <div>
            <Label htmlFor="results-origin">Origem</Label>
            <Input id="results-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="Ex.: whatsapp" className="w-40" />
          </div>
        </CardBody>
      </Card>

      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-foreground">Atendimento</h2>
        <StatsGrid>
          <KpiCard label="Recebidas" value={num(attendance?.receivedCount)} />
          <KpiCard label="Em aberto" value={num(attendance?.openCount)} />
          <KpiCard label="Pendentes" value={num(attendance?.pendingCount)} />
          <KpiCard label="Backlog" value={num(attendance?.backlogCount)} accent={attendance && attendance.backlogCount > 0 ? "negative" : "default"} />
          <KpiCard label="Resolvidas" value={num(attendance?.resolvedCount)} accent="positive" />
          <KpiCard label="1ª resposta (média)" value={seconds(attendance?.avgFirstResponseSeconds)} />
          <KpiCard label="Tempo de atendimento (média)" value={seconds(attendance?.avgHandleTimeSeconds)} hint="Aproximado — sem carimbo dedicado de resolução" />
          <KpiCard label="Respostas por IA" value={num(attendance?.aiResolvedMessageCount)} hint={`vs. ${num(attendance?.humanResolvedMessageCount)} por humanos`} />
        </StatsGrid>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-foreground">Comercial</h2>
        <StatsGrid>
          <KpiCard label="Negócios criados" value={num(commercial?.dealsCreatedCount)} />
          <KpiCard label="Valor em aberto" value={brl((commercial?.openPipelineValueCents ?? 0) / 100)} />
          <KpiCard label="Ganhos" value={num(commercial?.wonCount)} accent="positive" hint={brl((commercial?.wonValueCents ?? 0) / 100)} />
          <KpiCard label="Perdidos" value={num(commercial?.lostCount)} accent={commercial && commercial.lostCount > 0 ? "negative" : "default"} />
          <KpiCard label="Conversão" value={commercial?.conversionRate !== undefined ? pct(commercial.conversionRate * 100) : "—"} />
          <KpiCard label="Ticket médio" value={commercial?.avgTicketCents !== undefined ? brl(commercial.avgTicketCents / 100) : "—"} />
          <KpiCard label="Ciclo médio" value={commercial?.avgCycleDays !== undefined ? `${commercial.avgCycleDays.toFixed(1)} dias` : "—"} />
          <KpiCard label="Propostas enviadas" value={num(commercial?.proposalsSentCount)} hint={`${num(commercial?.proposalsAcceptedCount)} aceitas`} />
          <KpiCard label="Taxa de aceite de proposta" value={commercial?.proposalAcceptRate !== undefined ? pct(commercial.proposalAcceptRate * 100) : "—"} />
          <KpiCard label="Sem próximo passo" value={num(commercial?.dealsWithoutNextActionCount)} accent={commercial && commercial.dealsWithoutNextActionCount > 0 ? "negative" : "default"} />
        </StatsGrid>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">Tempo por etapa (negócios abertos)</p></CardHeader>
          <CardBody className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Etapa</TableHead><TableHead className="text-right">Negócios</TableHead><TableHead className="text-right">Dias (média)</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(commercial?.stageAging ?? []).map((stage) => (
                  <TableRow key={stage.stageId}>
                    <TableCell>{stage.stageName}</TableCell>
                    <TableCell className="text-right tabular-nums">{stage.openCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{stage.avgDaysInStage.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">Motivos de perda</p></CardHeader>
          <CardBody className="space-y-1.5">
            {(commercial?.lossReasons ?? []).map((item) => (
              <div key={item.reason} className="flex justify-between text-sm">
                <span className="text-foreground">{item.reason}</span>
                <span className="tabular-nums text-muted-foreground">{item.count}</span>
              </div>
            ))}
            {commercial && commercial.lossReasons.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum negócio perdido no período.</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><p className="text-sm font-semibold text-foreground">Receita por origem</p></CardHeader>
          <CardBody className="space-y-1.5">
            {(commercial?.revenueByOrigin ?? []).map((item) => (
              <div key={item.origin} className="flex justify-between text-sm">
                <span className="text-foreground">{item.origin}</span>
                <span className="tabular-nums text-muted-foreground">{brl(item.wonValueCents / 100)}</span>
              </div>
            ))}
            {commercial && commercial.revenueByOrigin.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum negócio ganho no período.</p> : null}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
