"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { ListCard } from "@/components/ListCard";
import { PageHeader } from "@/components/PageHeader";
import { SortableHead } from "@/components/SortableHead";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelUnifiedPublication } from "@/features/publication-history/api";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import {
  contentTypeOf,
  derivePublicationStatus,
  PUBLICATION_DISPLAY_STATUS_LABEL,
  type PublicationContentType,
  type PublicationDisplayStatus,
  type PublicationNetwork,
  type UnifiedPublication,
} from "@/features/publication-history/types";
import { useDebounce } from "@/hooks/useDebounce";
import { useSortedRows } from "@/hooks/useSortedRows";
import { formatDateTime } from "@/lib/format";

const NETWORK_LABEL: Record<PublicationNetwork, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube Shorts" };
const NETWORK_ICON: Record<PublicationNetwork, string> = { tiktok: "♪", instagram: "◎", facebook: "f", youtube: "▶" };
const FORMAT_LABEL: Record<PublicationContentType, string> = { image: "Imagem", video: "Vídeo", carousel: "Carrossel", text: "Texto" };
const FORMAT_ICON: Record<PublicationContentType, string> = { image: "▧", video: "▶", carousel: "▦", text: "¶" };
// Um tom por formato, dentro do vocabulário fechado (emerald/sky/violet/amber/rose/primary) —
// gradiente de dois estágios na MESMA cor, nunca um degradê multicolorido (achado de auditoria:
// a versão anterior misturava sky/indigo/emerald/rose/orange/teal/cyan/slate/zinc numa única tela).
const FORMAT_GRADIENT: Record<PublicationContentType, string> = {
  image: "from-sky-500/60 to-sky-600/60",
  video: "from-rose-500/60 to-rose-600/60",
  carousel: "from-emerald-500/60 to-emerald-600/60",
  text: "from-violet-500/60 to-violet-600/60",
};

// Ordinal usado só para ordenar a coluna Status da tabela — não é exibido.
const STATUS_ORDER: Record<PublicationDisplayStatus, number> = {
  draft: 0,
  scheduled: 1,
  publishing: 2,
  published: 3,
  failed: 4,
  cancelled: 5,
};

const NETWORK_FILTERS: Array<{ value: PublicationNetwork | "all"; label: string }> = [
  { value: "all", label: "Todas as redes" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube Shorts" },
];

const STATUS_FILTERS: Array<{ value: PublicationDisplayStatus | "all"; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "published", label: "Publicados" },
  { value: "scheduled", label: "Agendados" },
  { value: "publishing", label: "Publicando" },
  { value: "failed", label: "Com erro" },
  { value: "cancelled", label: "Cancelados" },
];

const FORMAT_FILTERS: Array<{ value: PublicationContentType | "all"; label: string }> = [
  { value: "all", label: "Todos formatos" },
  { value: "image", label: "Imagem" },
  { value: "video", label: "Vídeo" },
  { value: "carousel", label: "Carrossel" },
  { value: "text", label: "Texto" },
];

type DateFilter = "all" | "upcoming" | "past" | "this_month";
type ViewMode = "grid" | "list";
type PublicationSortKey = "title" | "network" | "format" | "status" | "date";

const DATE_FILTERS: Array<{ value: DateFilter; label: string }> = [
  { value: "all", label: "Qualquer data" },
  { value: "upcoming", label: "Próximas" },
  { value: "this_month", label: "Este mês" },
  { value: "past", label: "Já publicadas" },
];

function matchesDate(iso: string | undefined, filter: DateFilter): boolean {
  if (filter === "all" || !iso) return true;
  const date = new Date(iso);
  const now = new Date();
  if (Number.isNaN(date.getTime())) return true;
  if (filter === "upcoming") return date.getTime() >= now.getTime();
  if (filter === "past") return date.getTime() < now.getTime();
  if (filter === "this_month") return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return true;
}

export default function ContentsPage() {
  const workspace = useCurrentWorkspace();
  const [search, setSearch] = useState("");
  const [networkFilter, setNetworkFilter] = useState<PublicationNetwork | "all">("all");
  const [statusFilter, setStatusFilter] = useState<PublicationDisplayStatus | "all">("all");
  const [formatFilter, setFormatFilter] = useState<PublicationContentType | "all">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [busyId, setBusyId] = useState<string | undefined>();
  const [selectedPost, setSelectedPost] = useState<UnifiedPublication | undefined>();
  const { data: publications, isLoading, error, mutate } = useUnifiedPublications(workspace.id);

  const debouncedSearch = useDebounce(search, 300);

  const stats = useMemo(() => {
    const statuses = (publications ?? []).map((publication) => derivePublicationStatus(publication));
    return {
      total: statuses.length,
      published: statuses.filter((status) => status === "published").length,
      scheduled: statuses.filter((status) => status === "scheduled").length,
      failed: statuses.filter((status) => status === "failed").length,
      cancelled: statuses.filter((status) => status === "cancelled").length,
    };
  }, [publications]);

  const activeFilterCount = [
    networkFilter !== "all",
    statusFilter !== "all",
    formatFilter !== "all",
    dateFilter !== "all",
    search.trim() !== "",
  ].filter(Boolean).length;

  // 1 — filtro (busca debounced: o Input recebe `search` cru, o filtro lê `debouncedSearch`)
  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return (publications ?? [])
      .filter((publication) => (networkFilter === "all" ? true : publication.network === networkFilter))
      .filter((publication) => (statusFilter === "all" ? true : derivePublicationStatus(publication) === statusFilter))
      .filter((publication) => (formatFilter === "all" ? true : contentTypeOf(publication) === formatFilter))
      .filter((publication) => matchesDate(publication.scheduledAt ?? publication.publishedAt ?? publication.createdAt, dateFilter))
      .filter((publication) => (query ? titleOf(publication).toLowerCase().includes(query) || publication.text.toLowerCase().includes(query) : true));
  }, [publications, networkFilter, statusFilter, formatFilter, dateFilter, debouncedSearch]);

  // 2 — ordenação da lista INTEIRA (antes de paginar; só usada pela visão "Lista")
  const { sorted, sort, onSort } = useSortedRows<UnifiedPublication, PublicationSortKey>(
    filtered,
    {
      title: (post) => titleOf(post).toLowerCase(),
      network: (post) => NETWORK_LABEL[post.network].toLowerCase(),
      format: (post) => FORMAT_LABEL[contentTypeOf(post)].toLowerCase(),
      status: (post) => STATUS_ORDER[derivePublicationStatus(post)] ?? 0,
      date: (post) => {
        const iso = publicationDate(post);
        if (!iso) return null;
        const time = new Date(iso).getTime();
        return Number.isNaN(time) ? null : time;
      },
    },
    { key: "date", dir: "desc" },
  );

  // 3 — paginação adaptativa à altura da viewport (só usada pela visão "Lista")
  const {
    currentPage, totalPages, paginatedItems, setCurrentPage, resetPage,
    totalItems, pageSize, containerRef, availableHeight,
  } = usePagination(sorted, { auto: true });

  // 4 — reset de página ao mudar filtro OU ordenação
  useEffect(() => {
    resetPage();
  }, [debouncedSearch, networkFilter, statusFilter, formatFilter, dateFilter, sort, resetPage]);

  async function cancel(post: UnifiedPublication) {
    setBusyId(post.id);
    try {
      await cancelUnifiedPublication(workspace.id, post.network, post.id);
      await mutate();
      setSelectedPost(undefined);
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Conteúdos"
        description="Veja, filtre e reutilize tudo que já foi criado ou publicado."
        actions={
          <>
            <div className="inline-flex rounded-lg border border-border bg-card p-1">
              <button type="button" onClick={() => setViewMode("grid")} className={viewModeButtonClass(viewMode === "grid")}>Grid</button>
              <button type="button" onClick={() => setViewMode("list")} className={viewModeButtonClass(viewMode === "list")}>Lista</button>
            </div>
            <Link href={`/workspaces/${workspace.id}/create`}><Button variant="secondary">Criar conteúdo</Button></Link>
          </>
        }
      />

      <div className="mb-5">
        <StatsGrid>
          <StatCard label="Total" value={stats.total} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          <StatCard label="Publicados" value={stats.published} active={statusFilter === "published"} onClick={() => setStatusFilter("published")} />
          <StatCard label="Agendados" value={stats.scheduled} active={statusFilter === "scheduled"} onClick={() => setStatusFilter("scheduled")} />
          <StatCard label="Com erro" value={stats.failed} active={statusFilter === "failed"} onClick={() => setStatusFilter("failed")} />
          <StatCard label="Cancelados" value={stats.cancelled} active={statusFilter === "cancelled"} onClick={() => setStatusFilter("cancelled")} />
        </StatsGrid>
      </div>

      <Card className="mb-5">
        <CardContent className="p-4">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_150px_150px_150px]">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar conteúdo" aria-label="Buscar conteúdo" className="w-full" />
            <FilterSelect label="Rede" value={networkFilter} onChange={(value) => setNetworkFilter(value as PublicationNetwork | "all")} options={NETWORK_FILTERS} />
            <FilterSelect label="Status" value={statusFilter} onChange={(value) => setStatusFilter(value as PublicationDisplayStatus | "all")} options={STATUS_FILTERS} />
            <FilterSelect label="Período" value={dateFilter} onChange={(value) => setDateFilter(value as DateFilter)} options={DATE_FILTERS} />
            <FilterSelect label="Formato" value={formatFilter} onChange={(value) => setFormatFilter(value as PublicationContentType | "all")} options={FORMAT_FILTERS} />
          </div>
          {activeFilterCount > 0 ? (
            <div className="mt-2 flex justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setNetworkFilter("all");
                  setStatusFilter("all");
                  setFormatFilter("all");
                  setDateFilter("all");
                }}
              >
                Limpar filtros
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-14"><Spinner /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : viewMode === "grid" ? (
        !publications || publications.length === 0 ? (
          <EmptyState
            title="Nenhum conteúdo ainda"
            description="Quando algo for publicado ou agendado, a biblioteca aparece aqui."
            action={<Link href={`/workspaces/${workspace.id}/create`}><Button variant="secondary">Criar conteúdo</Button></Link>}
          />
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
            Nenhum conteúdo corresponde aos filtros aplicados.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((post) => (
              <PublicationCard key={`${post.network}-${post.id}`} workspaceId={workspace.id} post={post} busy={busyId === post.id} onOpen={() => setSelectedPost(post)} onCancel={() => cancel(post)} />
            ))}
          </div>
        )
      ) : (
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
                <SortableHead columnKey="title" sort={sort} onSort={onSort}>Conteúdo</SortableHead>
                <SortableHead columnKey="network" sort={sort} onSort={onSort}>Rede</SortableHead>
                <SortableHead columnKey="format" sort={sort} onSort={onSort}>Formato</SortableHead>
                <SortableHead columnKey="status" sort={sort} onSort={onSort}>Status</SortableHead>
                <SortableHead columnKey="date" sort={sort} onSort={onSort} align="right">Data</SortableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {!publications || publications.length === 0
                      ? "Nenhum conteúdo ainda"
                      : "Nenhum conteúdo corresponde aos filtros aplicados."}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedItems.map((post) => {
                  const format = contentTypeOf(post);
                  const status = derivePublicationStatus(post);
                  const thumbnail = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
                  const when = publicationDate(post);
                  return (
                    <TableRow key={`${post.network}-${post.id}`}>
                      <TableCell>
                        <button type="button" onClick={() => setSelectedPost(post)} className="flex min-w-0 items-center gap-3 text-left">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
                            {thumbnail ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumbnail} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-lg text-primary-foreground/80" aria-hidden>{FORMAT_ICON[format]}</span>
                            )}
                          </span>
                          <span className="min-w-0 truncate font-medium text-foreground">{titleOf(post)}</span>
                        </button>
                      </TableCell>
                      <TableCell><NetworkBadge network={post.network} /></TableCell>
                      <TableCell className="text-muted-foreground">{FORMAT_LABEL[format]}</TableCell>
                      <TableCell><StatusBadge status={status} /></TableCell>
                      <TableCell className="text-right text-muted-foreground">{when ? formatDateTime(when) : "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end">
                          <ActionsMenu workspaceId={workspace.id} post={post} busy={busyId === post.id} onOpen={() => setSelectedPost(post)} onCancel={() => cancel(post)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </ListCard>
      )}

      {selectedPost ? (
        <PublicationDetailDrawer workspaceId={workspace.id} post={selectedPost} busy={busyId === selectedPost.id} onCancel={() => cancel(selectedPost)} onClose={() => setSelectedPost(undefined)} />
      ) : null}
    </main>
  );
}

function StatCard({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <Card className={active ? "border-primary" : undefined}>
      <CardContent className="p-4">
        <button type="button" onClick={onClick} className="block w-full text-left">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{value}</p>
        </button>
      </CardContent>
    </Card>
  );
}

function FilterSelect<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-accent-soft" aria-label={label}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function PublicationCard({ workspaceId, post, busy, onOpen, onCancel }: { workspaceId: string; post: UnifiedPublication; busy: boolean; onOpen: () => void; onCancel: () => void }) {
  const format = contentTypeOf(post);
  const status = derivePublicationStatus(post);
  const thumbnail = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  const when = publicationDate(post);

  return (
    <article className="group min-w-0 overflow-hidden rounded-2xl border border-border bg-card/55 transition hover:border-primary/70 hover:shadow-lg">
      <button type="button" onClick={onOpen} className={`relative flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-5xl text-primary-foreground/75 drop-shadow" aria-hidden>{FORMAT_ICON[format]}</span>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-primary-foreground backdrop-blur">{NETWORK_ICON[post.network]} {NETWORK_LABEL[post.network]}</span>
        <span className="absolute right-3 top-3"><StatusBadge status={status} /></span>
      </button>
      <div className="p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <button type="button" onClick={onOpen} className="min-w-0 text-left">
            <h2 className="line-clamp-2 text-sm font-semibold text-foreground">{titleOf(post)}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{when ? formatDateTime(when) : "Sem data"} · {FORMAT_LABEL[format]}</p>
          </button>
          <ActionsMenu workspaceId={workspaceId} post={post} busy={busy} onOpen={onOpen} onCancel={onCancel} />
        </div>
      </div>
    </article>
  );
}

function ActionsMenu({ workspaceId, post, busy, onOpen, onCancel }: { workspaceId: string; post: UnifiedPublication; busy: boolean; onOpen: () => void; onCancel: () => void }) {
  const status = derivePublicationStatus(post);
  return (
    <details className="relative shrink-0">
      <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">•••</summary>
      <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">
        <button type="button" onClick={onOpen} className="w-full rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted">Abrir</button>
        <Link href={publishAgainHref(workspaceId, post)} className="block rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted">Publicar novamente</Link>
        {status === "scheduled" ? (
          <button type="button" disabled={busy} onClick={onCancel} className="w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger-bg disabled:opacity-60">Cancelar agendamento</button>
        ) : null}
      </div>
    </details>
  );
}

function PublicationDetailDrawer({ workspaceId, post, busy, onClose, onCancel }: { workspaceId: string; post: UnifiedPublication; busy: boolean; onClose: () => void; onCancel: () => void }) {
  const format = contentTypeOf(post);
  const status = derivePublicationStatus(post);
  const thumbnail = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  const when = publicationDate(post);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Fechar detalhe" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-card p-4 shadow-lg sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Conteúdo</p>
            <h2 className="mt-2 text-2xl font-semibold text-foreground">{titleOf(post)}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Fechar</button>
        </div>

        {thumbnail ? (
          // Peça inteira sem corte (mesmo achado ao vivo do review/page.tsx — `object-cover` numa
          // caixa de proporção fixa cortava peças que não são exatamente 4:3, ex.: Stories 9:16).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="mx-auto mb-5 max-h-[60vh] w-full rounded-2xl border border-border object-contain" />
        ) : (
          <div className={`relative mb-5 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
            <span className="text-6xl text-primary-foreground/75" aria-hidden>{FORMAT_ICON[format]}</span>
          </div>
        )}

        <div className="mb-5 flex flex-wrap gap-2">
          <NetworkBadge network={post.network} />
          <StatusBadge status={status} />
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{FORMAT_LABEL[format]}</span>
          {post.placement === "story" ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Story</span> : null}
        </div>

        <div className="space-y-4">
          <DetailBlock label="Legenda" value={post.text || "Sem legenda"} />
          <DetailBlock label={status === "scheduled" ? "Agendado para" : status === "published" ? "Publicado em" : "Data"} value={when ? formatDateTime(when) : "Sem data"} />
          {post.timezone ? <DetailBlock label="Fuso" value={post.timezone} /> : null}
          <DetailBlock label="Histórico" value={PUBLICATION_DISPLAY_STATUS_LABEL[status]} />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={publishAgainHref(workspaceId, post)}><Button>Publicar novamente</Button></Link>
          {status === "scheduled" ? <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancelar agendamento</Button> : null}
        </div>
      </aside>
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{value}</p>
    </div>
  );
}

function NetworkBadge({ network }: { network: PublicationNetwork }) {
  return <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{NETWORK_ICON[network]} {NETWORK_LABEL[network]}</span>;
}

function viewModeButtonClass(active: boolean) {
  return `rounded-md px-3 py-1.5 text-xs font-medium transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;
}

function titleOf(post: UnifiedPublication): string {
  const firstLine = post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 96) : `${NETWORK_LABEL[post.network]} · ${FORMAT_LABEL[contentTypeOf(post)]}`;
}

function publicationDate(post: UnifiedPublication): string | undefined {
  return post.scheduledAt ?? post.publishedAt ?? post.createdAt;
}

function publishAgainHref(workspaceId: string, post: UnifiedPublication): string {
  return `/workspaces/${workspaceId}/publish?network=${post.network}&source=${encodeURIComponent(`${post.network}:${post.id}`)}`;
}
