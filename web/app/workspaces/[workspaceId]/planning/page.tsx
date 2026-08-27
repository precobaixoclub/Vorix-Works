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
import { usePlanningList } from "@/features/planning/hooks";
import { PLANNING_STATUSES, type Planning, type PlanningStatus } from "@/features/planning/types";
import { useDebounce } from "@/hooks/useDebounce";
import { useSortedRows } from "@/hooks/useSortedRows";
import { formatDateTime } from "@/lib/format";

const PLANNING_STATUS_LABEL: Record<PlanningStatus, string> = {
  draft: "Rascunho",
  ready: "Pronto",
  failed: "Falhou",
  superseded: "Substituído",
};

type StatusFilter = "all" | PlanningStatus;
type PlanningSortKey = "template" | "strategy" | "status" | "updatedAt";

/**
 * Lista de Planos deste Workspace — Sprint 09 (Fase 8). Só leitura: cada plano nasce sozinho ao
 * confirmar um Briefing (`ConfirmBriefing` → `PreparedCommand` → Planning Engine), nunca por ação
 * do usuário aqui. Sem nenhum botão de criação/execução — só visualização.
 */
export default function PlanningListPage() {
  const workspace = useCurrentWorkspace();
  const { data: plans, isLoading, error, mutate } = usePlanningList(workspace.id);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const debouncedSearch = useDebounce(searchTerm, 300);

  const stats = useMemo(() => {
    const items = plans ?? [];
    const ready = items.filter((p) => p.status === "ready").length;
    const draft = items.filter((p) => p.status === "draft").length;
    const failed = items.filter((p) => p.status === "failed").length;
    const superseded = items.filter((p) => p.status === "superseded").length;
    return { total: items.length, ready, draft, failed, superseded };
  }, [plans]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return (plans ?? []).filter((plan) => {
      const matchesSearch =
        term === "" ||
        plan.id.toLowerCase().includes(term) ||
        plan.planningTemplate.toLowerCase().includes(term) ||
        plan.plannerStrategy.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "all" || plan.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [plans, debouncedSearch, statusFilter]);

  const { sorted, sort, onSort } = useSortedRows<Planning, PlanningSortKey>(
    filtered,
    {
      template: (p) => p.planningTemplate.toLowerCase(),
      strategy: (p) => p.plannerStrategy.toLowerCase(),
      status: (p) => PLANNING_STATUS_LABEL[p.status].toLowerCase(),
      updatedAt: (p) => new Date(p.updatedAt).getTime(),
    },
    { key: "updatedAt", dir: "desc" },
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
      <PageHeader title="Planejamento" description="Planos criados automaticamente a partir das regras da linha de produção." />

      <ScreenGuide
        title="Tela de acompanhamento"
        description="Aqui você vê o que o sistema planejou. Para configurar o que deve ser criado, use Produção."
        items={[
          "Cada linha representa um plano gerado.",
          "Status pronto indica que pode seguir para runtime.",
          "Abra um plano para conferir detalhes.",
          "Se não houver plano, crie ou ajuste uma linha em Produção.",
        ]}
        aside={<p>Esta tela não cria conteúdo manualmente; ela mostra o resultado da automação.</p>}
      />

      <div className="mb-3">
        <StatsGrid>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.total}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Pronto</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.ready}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Rascunho</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.draft}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Falhou</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.failed}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Substituído</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.superseded}</p></Card>
        </StatsGrid>
      </div>

      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-64 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por ID, template ou estratégia..."
                className="pl-10"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {PLANNING_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>{PLANNING_STATUS_LABEL[status]}</SelectItem>
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
              <SortableHead columnKey="template" sort={sort} onSort={onSort}>Plano</SortableHead>
              <SortableHead columnKey="strategy" sort={sort} onSort={onSort}>Estratégia</SortableHead>
              <SortableHead columnKey="status" sort={sort} onSort={onSort}>Status</SortableHead>
              <SortableHead columnKey="updatedAt" sort={sort} onSort={onSort} align="right">Atualizado em</SortableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8">
                  <ErrorState error={error} onRetry={() => mutate()} />
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-14 text-center">
                  <Spinner className="mx-auto h-5 w-5 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8">
                  {debouncedSearch || statusFilter !== "all" ? (
                    <p className="text-center text-sm text-muted-foreground">Nenhum plano encontrado com esses filtros.</p>
                  ) : (
                    <EmptyState
                      title="Nenhum plano ainda"
                      description="Um plano nasce automaticamente quando a linha de produção prepara um lote de conteúdo."
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <Link href={`/workspaces/${workspace.id}/planning/${plan.id}`} className="font-medium text-foreground hover:text-primary">
                      {plan.planningTemplate}
                    </Link>
                    <p className="mt-0.5 break-all text-[11px] text-muted-foreground">{plan.id}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{plan.plannerStrategy}</TableCell>
                  <TableCell><StatusBadge status={plan.status} /></TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatDateTime(plan.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <Button asChild size="sm" variant="ghost" title="Abrir plano">
                        <Link href={`/workspaces/${workspace.id}/planning/${plan.id}`} aria-label="Abrir plano">
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
