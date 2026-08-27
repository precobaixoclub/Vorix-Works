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
import { RUNTIME_STATES, type RuntimePlan, type RuntimeState } from "@/features/runtime/types";
import { useRuntimeList } from "@/features/runtime/hooks";
import { useDebounce } from "@/hooks/useDebounce";
import { useSortedRows } from "@/hooks/useSortedRows";
import { formatDateTime } from "@/lib/format";

const RUNTIME_STATE_LABEL: Record<RuntimeState, string> = {
  draft: "Rascunho",
  validating: "Validando",
  validated: "Validado",
  validation_failed: "Validação falhou",
  superseded: "Substituído",
};

type StatusFilter = "all" | RuntimeState;
type RuntimeSortKey = "template" | "strategy" | "status" | "updatedAt";

/**
 * Lista de Runtimes deste Workspace — Sprint 10 (Fase 7). Só leitura: cada RuntimePlan nasce
 * sozinho quando um Planning fica "ready", nunca por ação do usuário aqui. Sem nenhum botão de
 * criação/execução — só visualização.
 */
export default function RuntimeListPage() {
  const workspace = useCurrentWorkspace();
  const { data: runtimes, isLoading, error, mutate } = useRuntimeList(workspace.id);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const debouncedSearch = useDebounce(searchTerm, 300);

  const stats = useMemo(() => {
    const items = runtimes ?? [];
    const validated = items.filter((r) => r.status === "validated").length;
    const validating = items.filter((r) => r.status === "validating").length;
    const failed = items.filter((r) => r.status === "validation_failed").length;
    return {
      total: items.length,
      validated,
      validating,
      failed,
      others: items.length - validated - validating - failed,
    };
  }, [runtimes]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return (runtimes ?? []).filter((runtime) => {
      const matchesSearch =
        term === "" ||
        runtime.id.toLowerCase().includes(term) ||
        runtime.translationTemplate.toLowerCase().includes(term) ||
        runtime.translatorStrategy.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "all" || runtime.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [runtimes, debouncedSearch, statusFilter]);

  const { sorted, sort, onSort } = useSortedRows<RuntimePlan, RuntimeSortKey>(
    filtered,
    {
      template: (r) => r.translationTemplate.toLowerCase(),
      strategy: (r) => r.translatorStrategy.toLowerCase(),
      status: (r) => RUNTIME_STATE_LABEL[r.status].toLowerCase(),
      updatedAt: (r) => new Date(r.updatedAt).getTime(),
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
      <PageHeader title="Runtime" description="Bastidor técnico da linha de produção: mostra planos preparados pelo sistema antes da execução." />

      <ScreenGuide
        title="Tela de bastidor"
        description="Você não precisa usar esta tela no fluxo normal. Ela existe para conferir se a automação preparou tudo corretamente."
        items={[
          "Produção cria as regras.",
          "Planejamento transforma regras em plano.",
          "Runtime valida o plano antes de executar.",
          "Execuções mostra o teste ou processamento final.",
        ]}
        aside={<p>Se a lista estiver vazia, volte em Produção e crie uma linha ou aguarde a automação preparar o próximo lote.</p>}
      />

      <div className="mb-3">
        <StatsGrid>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.total}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Validado</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.validated}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Validando</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.validating}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Validação falhou</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.failed}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Outros</p><p className="text-2xl font-semibold text-foreground tabular-nums">{stats.others}</p></Card>
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
              {RUNTIME_STATES.map((state) => (
                <SelectItem key={state} value={state}>{RUNTIME_STATE_LABEL[state]}</SelectItem>
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
              <SortableHead columnKey="template" sort={sort} onSort={onSort}>Template</SortableHead>
              <SortableHead columnKey="strategy" sort={sort} onSort={onSort}>Estratégia</SortableHead>
              <SortableHead columnKey="status" sort={sort} onSort={onSort}>Status</SortableHead>
              <TableHead>Planejamento</TableHead>
              <SortableHead columnKey="updatedAt" sort={sort} onSort={onSort} align="right">Atualizado em</SortableHead>
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
                    <p className="text-center text-sm text-muted-foreground">Nenhum runtime encontrado com esses filtros.</p>
                  ) : (
                    <EmptyState title="Nenhum runtime ainda" description="Um runtime nasce automaticamente quando um plano de campanha fica pronto." />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((runtime) => (
                <TableRow key={runtime.id}>
                  <TableCell>
                    <Link href={`/workspaces/${workspace.id}/runtime/${runtime.id}`} className="font-medium text-foreground hover:text-primary">
                      {runtime.translationTemplate}
                    </Link>
                    <p className="mt-0.5 break-all text-[11px] text-muted-foreground">{runtime.id}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{runtime.translatorStrategy}</TableCell>
                  <TableCell><StatusBadge status={runtime.status} /></TableCell>
                  <TableCell>
                    <Link href={`/workspaces/${workspace.id}/planning/${runtime.sourceContext.planningId}`} className="text-xs text-muted-foreground hover:text-primary">
                      {runtime.sourceContext.planningId}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatDateTime(runtime.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
                      <Button asChild size="sm" variant="ghost" title="Abrir runtime">
                        <Link href={`/workspaces/${workspace.id}/runtime/${runtime.id}`} aria-label="Abrir runtime">
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
