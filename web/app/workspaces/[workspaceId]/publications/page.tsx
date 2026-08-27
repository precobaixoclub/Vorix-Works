"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { mutate } from "swr";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { ListCard } from "@/components/ListCard";
import { PageHeader } from "@/components/PageHeader";
import { ProgressivePanel, ScreenGuide } from "@/components/ScreenGuide";
import { SortableHead } from "@/components/SortableHead";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { beginMetaPagesOAuth, disconnectMetaPagesOAuth } from "@/features/publication/api";
import {
  useMetaPagesOAuthStatus,
  usePublicationDeadLetters,
  usePublicationMetrics,
  usePublicationOutbox,
  usePublicationProviders,
  usePublicationQueue,
  usePublicationReconciliations,
  usePublications,
} from "@/features/publication/hooks";
import type { PublicationPlan, PublicationState } from "@/features/publication/types";
import { useDebounce } from "@/hooks/useDebounce";
import { useSortedRows } from "@/hooks/useSortedRows";
import { formatDateTime } from "@/lib/format";
import { PublicationDetailModal } from "./PublicationDetailModal";

const PUBLICATION_STATES: PublicationState[] = [
  "draft",
  "waiting_for_approval",
  "approved",
  "publishing",
  "published",
  "failed",
  "cancelled",
  "superseded",
  "unknown_outcome",
];

const PUBLICATION_STATE_LABEL: Record<PublicationState, string> = {
  draft: "Rascunho",
  waiting_for_approval: "Aguardando aprovação",
  approved: "Aprovado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
  superseded: "Substituído",
  unknown_outcome: "Resultado desconhecido",
};

type StatusFilter = "all" | PublicationState;
type PublicationSortKey = "id" | "state" | "mode" | "createdAt";

export default function PublicationsPage() {
  const workspace = useCurrentWorkspace();
  const [oauthBusy, setOauthBusy] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { data: publications, isLoading, error, mutate: mutatePublications } = usePublications(workspace.id);
  const { data: queue } = usePublicationQueue(workspace.id);
  const { data: metrics } = usePublicationMetrics(workspace.id);
  const { data: providers } = usePublicationProviders();
  const { data: metaOAuth } = useMetaPagesOAuthStatus(workspace.id);
  const { data: outbox } = usePublicationOutbox(workspace.id);
  const { data: reconciliations } = usePublicationReconciliations(workspace.id);
  const { data: deadLetters } = usePublicationDeadLetters(workspace.id);
  const showSandboxTools = process.env.NEXT_PUBLIC_SHOW_SANDBOX_PROVIDERS === "true";
  const visibleProviders = (providers ?? []).filter((provider) => showSandboxTools || !provider.providerId.includes("sandbox"));
  const metaProvider = showSandboxTools ? providers?.find((provider) => provider.providerId === "meta_pages_sandbox") : undefined;

  const debouncedSearch = useDebounce(searchTerm, 300);

  // 1 — contagem por estado (StatsGrid da lista, distinta das métricas técnicas de fila acima)
  const stats = useMemo(() => {
    const items = publications ?? [];
    const published = items.filter((p) => p.state === "published").length;
    const publishing = items.filter((p) => p.state === "publishing").length;
    const failed = items.filter((p) => p.state === "failed" || p.state === "unknown_outcome").length;
    return {
      total: items.length,
      published,
      publishing,
      failed,
      others: items.length - published - publishing - failed,
    };
  }, [publications]);

  // 2 — filtro (busca debounced por id + estado)
  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return (publications ?? []).filter((publication) => {
      const matchesSearch = term === "" || publication.id.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "all" || publication.state === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [publications, debouncedSearch, statusFilter]);

  // 3 — ordenação da lista INTEIRA (antes de paginar)
  const { sorted, sort, onSort } = useSortedRows<PublicationPlan, PublicationSortKey>(
    filtered,
    {
      id: (p) => p.id.toLowerCase(),
      state: (p) => PUBLICATION_STATE_LABEL[p.state].toLowerCase(),
      mode: (p) => (p.mode === "dry_run" ? "simulação" : "real"),
      createdAt: (p) => new Date(p.createdAt).getTime(),
    },
    { key: "createdAt", dir: "desc" },
  );

  // 4 — paginação adaptativa à altura da viewport
  const {
    currentPage, totalPages, paginatedItems, setCurrentPage, resetPage,
    totalItems, pageSize, containerRef, availableHeight,
  } = usePagination(sorted, { auto: true });

  // 5 — reset de página ao mudar filtro OU ordenação
  useEffect(() => {
    resetPage();
  }, [debouncedSearch, statusFilter, sort, resetPage]);

  async function connectMetaPages() {
    setOauthBusy(true);
    try {
      const result = await beginMetaPagesOAuth(workspace.id);
      window.location.assign(result.authorizationUrl);
    } finally {
      setOauthBusy(false);
    }
  }

  async function disconnectFirstCredential() {
    const credential = metaOAuth?.credentialReferences[0];
    if (!credential) return;
    setOauthBusy(true);
    try {
      await disconnectMetaPagesOAuth(workspace.id, credential.credentialReferenceId);
      await mutate(["meta-pages-oauth-status", workspace.id]);
    } finally {
      setOauthBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader title="Publicação Técnica" description="Diagnóstico da fila e execução de publicação." />
      <ScreenGuide
        title="Quando abrir esta tela"
        description="No dia a dia, use Publicar ou Postagens Publicadas. Esta tela serve para investigar a fila interna."
        items={[
          "Fila mostra itens aguardando processamento.",
          "Caixa de saída mostra mensagens ainda não confirmadas.",
          "Não entregues lista falhas que precisam de correção.",
          "Use Provedores para diagnosticar credenciais e sincronização.",
        ]}
        aside={<p>Se a intenção é criar uma postagem nova, volte para Publicar ou Produção.</p>}
      />
      <div className="mb-6">
        <StatsGrid>
          <Card className="p-4"><p className="text-xs text-ink-muted">Fila</p><p className="text-2xl font-semibold text-ink">{queue?.size ?? 0}</p></Card>
          <Card className="p-4"><p className="text-xs text-ink-muted">Vazão</p><p className="text-2xl font-semibold text-ink">{metrics?.publicationThroughput ?? 0}</p></Card>
          <Card className="p-4"><p className="text-xs text-ink-muted">Caixa de saída pendente</p><p className="text-2xl font-semibold text-ink">{metrics?.outboxPending ?? 0}</p></Card>
          <Card className="p-4"><p className="text-xs text-ink-muted">Resultados desconhecidos</p><p className="text-2xl font-semibold text-ink">{metrics?.unknownOutcomes ?? 0}</p></Card>
        </StatsGrid>
      </div>
      <div className="mb-6 space-y-3">
        <ProgressivePanel
          title="Diagnóstico técnico da fila"
          description="Abra apenas quando uma publicação falhar ou ficar pendente."
          open={diagnosticsOpen}
          onToggle={() => setDiagnosticsOpen(!diagnosticsOpen)}
          badge={(deadLetters?.length ?? 0) > 0 ? `${deadLetters?.length} falha(s)` : undefined}
        >
          <div className="grid gap-4 lg:grid-cols-4">
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium text-ink">Registro de Provedores</p>
              <div className="space-y-2 text-xs text-ink-muted">{visibleProviders.map((provider) => <p key={provider.providerId}>{provider.displayName} · v{provider.providerVersion} · {provider.enabled ? "ativo" : "desativado"} · {provider.supportedChannels.length} canais</p>)}</div>
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium text-ink">Caixa de Saída</p>
              <p className="text-xs text-ink-muted">{outbox?.length ?? 0} mensagem(ns) · reivindicadas {metrics?.outboxClaimed ?? 0} · lease expirado {metrics?.leaseExpired ?? 0} · fencing rejeitado {metrics?.fencingRejected ?? 0}</p>
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium text-ink">Reconciliação</p>
              <p className="text-xs text-ink-muted">{reconciliations?.length ?? 0} registro(s) · pendente {metrics?.reconciliationPending ?? 0} · sucesso {metrics?.reconciliationSuccess ?? 0}</p>
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-medium text-ink">Não Entregues</p>
              <p className="text-xs text-ink-muted">{deadLetters?.length ?? 0} registro(s) · divergência {metrics?.receiptMismatch ?? 0} · falhas de credencial {metrics?.credentialResolutionFailures ?? 0}</p>
            </Card>
          </div>
        </ProgressivePanel>

        {showSandboxTools ? (
          <ProgressivePanel
            title="Meta Pages Sandbox"
            description="Ambiente de teste da Meta. No uso normal, prefira Conexões."
            open={sandboxOpen}
            onToggle={() => setSandboxOpen(!sandboxOpen)}
            badge={metaOAuth?.connected ? "conectado" : undefined}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Status do sandbox</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {metaProvider?.enabled ? "Provedor registrado" : "Provedor desabilitado"} · {metaOAuth?.connected ? "OAuth conectado" : "OAuth desconectado"}
                  {metaOAuth?.credentialReferences[0]?.providerSubjectId ? ` · page ${metaOAuth.credentialReferences[0].providerSubjectId}` : ""}
                </p>
                {metaOAuth?.credentialReferences[0]?.expiresAt ? <p className="mt-1 text-xs text-ink-muted">token expira em {formatDateTime(metaOAuth.credentialReferences[0].expiresAt)}</p> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={oauthBusy || !metaProvider?.enabled} onClick={connectMetaPages}>Conectar sandbox</Button>
                <Button variant="secondary" disabled={oauthBusy || !metaOAuth?.connected} onClick={disconnectFirstCredential}>Desconectar</Button>
              </div>
            </div>
          </ProgressivePanel>
        ) : null}
      </div>

      <div className="mb-3">
        <StatsGrid>
          <Card className="p-4"><p className="text-xs text-ink-muted">Total</p><p className="text-2xl font-semibold text-ink">{stats.total}</p></Card>
          <Card className="p-4"><p className="text-xs text-ink-muted">Publicado</p><p className="text-2xl font-semibold text-ink">{stats.published}</p></Card>
          <Card className="p-4"><p className="text-xs text-ink-muted">Publicando</p><p className="text-2xl font-semibold text-ink">{stats.publishing}</p></Card>
          <Card className="p-4"><p className="text-xs text-ink-muted">Falhou</p><p className="text-2xl font-semibold text-ink">{stats.failed}</p></Card>
          <Card className="p-4"><p className="text-xs text-ink-muted">Outros</p><p className="text-2xl font-semibold text-ink">{stats.others}</p></Card>
        </StatsGrid>
      </div>

      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-64 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <Input
                placeholder="Buscar por ID da publicação..."
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
              {PUBLICATION_STATES.map((state) => (
                <SelectItem key={state} value={state}>{PUBLICATION_STATE_LABEL[state]}</SelectItem>
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
              <SortableHead columnKey="id" sort={sort} onSort={onSort}>Publicação</SortableHead>
              <SortableHead columnKey="state" sort={sort} onSort={onSort}>Estado</SortableHead>
              <SortableHead columnKey="mode" sort={sort} onSort={onSort}>Modo</SortableHead>
              <SortableHead columnKey="createdAt" sort={sort} onSort={onSort} align="right">Criado em</SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8">
                  <ErrorState error={error} onRetry={() => mutatePublications()} />
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-14 text-center">
                  <Spinner className="mx-auto h-5 w-5 text-ink-muted" />
                </TableCell>
              </TableRow>
            ) : paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8">
                  {debouncedSearch || statusFilter !== "all" ? (
                    <p className="text-center text-sm text-ink-muted">Nenhuma publicação encontrada com esses filtros.</p>
                  ) : (
                    <EmptyState title="Nenhuma publicação" description="Crie um PublicationPlan a partir de ExecutionArtifacts pela API ou por um fluxo de produto." />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((publication) => (
                <TableRow key={publication.id}>
                  <TableCell className="font-medium text-ink">
                    <button type="button" onClick={() => setSelectedId(publication.id)} className="text-left hover:text-primary">
                      {publication.id}
                    </button>
                  </TableCell>
                  <TableCell><StatusBadge status={publication.state} /></TableCell>
                  <TableCell><span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-primary">{publication.mode === "dry_run" ? "Simulação" : "Real"}</span></TableCell>
                  <TableCell className="text-right text-ink-muted">{formatDateTime(publication.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ListCard>

      {selectedId ? (
        <PublicationDetailModal
          key={selectedId}
          workspaceId={workspace.id}
          publicationId={selectedId}
          onOpenChange={(open) => { if (!open) setSelectedId(null); }}
        />
      ) : null}
    </main>
  );
}
