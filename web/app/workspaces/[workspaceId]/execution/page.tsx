"use client";

import { ExternalLink, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { ListCard } from "@/components/ListCard";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { SortableHead } from "@/components/SortableHead";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useExecutionRuns } from "@/features/execution/hooks";
import type { ExecutionRun, ExecutionRunState } from "@/features/execution/types";
import { useDebounce } from "@/hooks/useDebounce";
import { useSortedRows } from "@/hooks/useSortedRows";
import { formatDateTime } from "@/lib/format";

const EXECUTION_STATES: ExecutionRunState[] = ["created", "validating", "ready", "running", "waiting_for_approval", "completed", "failed", "cancelled"];

const EXECUTION_STATE_LABEL: Record<ExecutionRunState, string> = {
  created: "Criada",
  validating: "Validando",
  ready: "Pronta",
  running: "Rodando",
  waiting_for_approval: "Aguardando aprovação",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

type StatusFilter = "all" | ExecutionRunState;
type ExecutionSortKey = "id" | "state" | "mode" | "createdAt";

export default function ExecutionRunsPage() {
  const workspace = useCurrentWorkspace();
  const { data: runs, isLoading, error, mutate } = useExecutionRuns(workspace.id);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const debouncedSearch = useDebounce(searchTerm, 300);

  const stats = useMemo(() => {
    const items = runs ?? [];
    const running = items.filter((r) => r.state === "running" || r.state === "ready" || r.state === "validating" || r.state === "created").length;
    const waitingApproval = items.filter((r) => r.state === "waiting_for_approval").length;
    const completed = items.filter((r) => r.state === "completed").length;
    const failed = items.filter((r) => r.state === "failed" || r.state === "cancelled").length;
    return { total: items.length, running, waitingApproval, completed, failed };
  }, [runs]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return (runs ?? []).filter((run) => {
      const matchesSearch = term === "" || run.id.toLowerCase().includes(term) || run.runtimePlanId.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "all" || run.state === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [runs, debouncedSearch, statusFilter]);

  const { sorted, sort, onSort } = useSortedRows<ExecutionRun, ExecutionSortKey>(
    filtered,
    {
      id: (r) => r.id.toLowerCase(),
      state: (r) => EXECUTION_STATE_LABEL[r.state].toLowerCase(),
      mode: (r) => (r.mode === "real" ? "real" : "simulação"),
      createdAt: (r) => new Date(r.createdAt).getTime(),
    },
    { key: "createdAt", dir: "desc" },
  );

  const {
    currentPage, totalPages, paginatedItems, setCurrentPage, resetPage,
    totalItems, pageSize, containerRef, availableHeight,
  } = usePagination(sorted, { auto: true });

  useEffect(() => {
    resetPage();
  }, [debouncedSearch, statusFilter, sort, resetPage]);

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Execuções" description="Histórico de testes e processamentos feitos pela linha de produção." />
      <ScreenGuide
        title="Como usar"
        description="Esta tela ajuda a entender se a automação executou como esperado antes de publicar de verdade."
        items={[
          "Abra uma execução para ver os passos.",
          "Confira o estado antes de usar conteúdo gerado.",
          "Use Simulação para validar sem publicar.",
          "Falhas aqui indicam ajuste necessário na produção ou nas conexões.",
        ]}
        aside={<p>No uso diário, você normalmente acompanha o resultado final em Postagens Publicadas.</p>}
      />

      <div className="mb-3">
        <StatsGrid>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.total}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Em andamento</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.running}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Aguardando aprovação</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.waitingApproval}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Concluída</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.completed}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Falhou</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.failed}</p></Card>
        </StatsGrid>
      </div>

      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-64 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por ID da execução ou do runtime..."
                className="pl-10"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              {EXECUTION_STATES.map((state) => (
                <SelectItem key={state} value={state}>{EXECUTION_STATE_LABEL[state]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <ListCard
        ref={containerRef}
        availableHeight={availableHeight}
        footer={
          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead columnKey="id" sort={sort} onSort={onSort}>Execução</SortableHead>
              <SortableHead columnKey="state" sort={sort} onSort={onSort}>Estado</SortableHead>
              <SortableHead columnKey="mode" sort={sort} onSort={onSort}>Modo</SortableHead>
              <TableHead>Runtime</TableHead>
              <SortableHead columnKey="createdAt" sort={sort} onSort={onSort} align="right">Criado em</SortableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8">
                  <ErrorState error={error} onRetry={() => mutate()} />
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-14 text-center">
                  <Spinner className="mx-auto h-5 w-5 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8">
                  {debouncedSearch || statusFilter !== "all" ? (
                    <p className="text-center text-sm text-muted-foreground">Nenhuma execução encontrada com esses filtros.</p>
                  ) : (
                    <EmptyState title="Nenhuma simulação ainda" description="Crie uma simulação a partir da tela de detalhe de um Runtime validado." />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link href={`/workspaces/${workspace.id}/execution/${run.id}`} className="font-medium text-foreground hover:text-primary">
                      {run.mode === "real" ? "Execução real" : "Simulação"}
                    </Link>
                    <p className="mt-0.5 break-all text-[11px] text-muted-foreground">{run.id}</p>
                  </TableCell>
                  <TableCell><StatusBadge status={run.state} /></TableCell>
                  <TableCell>
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{run.mode === "real" ? "Real" : "Simulação"}</span>
                  </TableCell>
                  <TableCell>
                    <Link href={`/workspaces/${workspace.id}/runtime/${run.runtimePlanId}`} className="text-xs text-muted-foreground hover:text-primary">
                      {run.runtimePlanId}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatDateTime(run.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <Button asChild size="sm" variant="ghost" title="Abrir execução">
                        <Link href={`/workspaces/${workspace.id}/execution/${run.id}`} aria-label="Abrir execução">
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ListCard>
    </main>
  );
}
