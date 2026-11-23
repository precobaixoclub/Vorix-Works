"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ConceptsExplainer } from "@/components/marketing/ConceptsExplainer";
import { listEditorialIdeas } from "@/features/editorial-ideas/api";
import { AlignLeft, ExternalLink, GalleryHorizontal, ImageIcon, LayoutGrid, List, MoreHorizontal, Video } from "lucide-react";
import { Button } from "@/components/Button";
import { ChannelIcon, channelLabel } from "@/components/ChannelIcon";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelUnifiedPublication } from "@/features/publication-history/api";
import { groupPublications, publicationDate, type ContentGroup } from "@/features/publication-history/content-groups";
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
import { cn } from "@/lib/utils";

const NETWORK_LABEL: Record<PublicationNetwork, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube Shorts" };
const FORMAT_LABEL: Record<PublicationContentType, string> = { image: "Imagem", video: "Vídeo", carousel: "Carrossel", text: "Texto" };
// Um tom por formato, dentro do vocabulário fechado — gradiente de dois estágios na MESMA cor.
const FORMAT_GRADIENT: Record<PublicationContentType, string> = {
  image: "from-sky-500/60 to-sky-600/60",
  video: "from-rose-500/60 to-rose-600/60",
  carousel: "from-emerald-500/60 to-emerald-600/60",
  text: "from-violet-500/60 to-violet-600/60",
};
/** Cor do pontinho de resultado em cada ícone de rede. */
const STATUS_DOT: Record<PublicationDisplayStatus, string> = {
  published: "bg-emerald-500",
  scheduled: "bg-sky-500",
  publishing: "bg-amber-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground",
  draft: "bg-muted-foreground",
  awaiting_approval: "bg-violet-500",
};

// Ordinal usado só para ordenar a coluna Status da tabela — não é exibido.
const STATUS_ORDER: Record<PublicationDisplayStatus, number> = { draft: 0, awaiting_approval: 1, scheduled: 2, publishing: 3, published: 4, failed: 5, cancelled: 6 };

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
  { value: "awaiting_approval", label: "Aguardando aprovação" },
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
type ContentSortKey = "title" | "networks" | "format" | "status" | "date";

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

/**
 * Biblioteca de conteúdos: UM card por peça, mesmo quando ela saiu em várias redes (antes cada rede
 * virava um card duplicado). Os ícones mostram onde a peça foi; o detalhe traz data, hora e
 * resultado de cada rede.
 */
export default function ContentsPage() {
  const workspace = useCurrentWorkspace();
  const [search, setSearch] = useState("");
  const [networkFilter, setNetworkFilter] = useState<PublicationNetwork | "all">("all");
  // Fase 4: a jornada de "Criar conteúdo" abre a biblioteca já filtrada (?status=published|failed|…).
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<PublicationDisplayStatus | "all">(() => {
    const requested = searchParams.get("status");
    return STATUS_FILTERS.some((option) => option.value === requested) ? (requested as PublicationDisplayStatus) : "all";
  });
  const [formatFilter, setFormatFilter] = useState<PublicationContentType | "all">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [busyId, setBusyId] = useState<string | undefined>();
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [pendingCancel, setPendingCancel] = useState<UnifiedPublication | undefined>();
  const { data: publications, isLoading, error, mutate } = useUnifiedPublications(workspace.id);

  const debouncedSearch = useDebounce(search, 300);
  const groups = useMemo(() => groupPublications(publications ?? []), [publications]);

  const stats = useMemo(() => ({
    total: groups.length,
    published: groups.filter((group) => group.status === "published").length,
    scheduled: groups.filter((group) => group.posts.some((post) => derivePublicationStatus(post) === "scheduled")).length,
    awaitingApproval: groups.filter((group) => group.posts.some((post) => derivePublicationStatus(post) === "awaiting_approval")).length,
    failed: groups.filter((group) => group.posts.some((post) => derivePublicationStatus(post) === "failed")).length,
    cancelled: groups.filter((group) => group.status === "cancelled").length,
  }), [groups]);

  const activeFilterCount = [networkFilter !== "all", statusFilter !== "all", formatFilter !== "all", dateFilter !== "all", search.trim() !== ""].filter(Boolean).length;

  const filtered = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return groups
      .filter((group) => (networkFilter === "all" ? true : group.networks.includes(networkFilter)))
      .filter((group) => (statusFilter === "all" ? true : statusFilter === "published" ? group.status === "published" : group.posts.some((post) => derivePublicationStatus(post) === statusFilter)))
      .filter((group) => (formatFilter === "all" ? true : contentTypeOf(group.primary) === formatFilter))
      .filter((group) => matchesDate(group.date, dateFilter))
      .filter((group) => (query ? titleOf(group.primary).toLowerCase().includes(query) || group.primary.text.toLowerCase().includes(query) : true));
  }, [groups, networkFilter, statusFilter, formatFilter, dateFilter, debouncedSearch]);

  const { sorted, sort, onSort } = useSortedRows<ContentGroup, ContentSortKey>(
    filtered,
    {
      title: (group) => titleOf(group.primary).toLowerCase(),
      networks: (group) => group.networks.length,
      format: (group) => FORMAT_LABEL[contentTypeOf(group.primary)].toLowerCase(),
      status: (group) => STATUS_ORDER[group.status] ?? 0,
      date: (group) => {
        const time = group.date ? new Date(group.date).getTime() : Number.NaN;
        return Number.isNaN(time) ? null : time;
      },
    },
    { key: "date", dir: "desc" },
  );

  const { currentPage, totalPages, paginatedItems, setCurrentPage, resetPage, totalItems, pageSize, containerRef, availableHeight } = usePagination(sorted, { auto: true });
  useEffect(() => { resetPage(); }, [debouncedSearch, networkFilter, statusFilter, formatFilter, dateFilter, sort, resetPage]);

  const selected = selectedKey ? groups.find((group) => group.key === selectedKey) : undefined;

  async function cancel(post: UnifiedPublication) {
    setBusyId(post.id);
    try {
      await cancelUnifiedPublication(workspace.id, post.network, post.id);
      await mutate();
      setPendingCancel(undefined);
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Conteúdos"
        description={`Biblioteca de ${workspace.name}: cada peça aparece uma vez, com o ícone das redes em que saiu. Abra para ver data, hora e resultado de cada rede.`}
        actions={
          <>
            <div className="inline-flex rounded-lg border border-border bg-card p-1" role="group" aria-label="Visualização">
              <button type="button" aria-label="Grade" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")} className={viewModeButtonClass(viewMode === "grid")}><LayoutGrid className="h-4 w-4" aria-hidden /></button>
              <button type="button" aria-label="Lista" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")} className={viewModeButtonClass(viewMode === "list")}><List className="h-4 w-4" aria-hidden /></button>
            </div>
            <Link href={`/workspaces/${workspace.id}/create`}><Button variant="secondary">Criar conteúdo</Button></Link>
          </>
        }
      />

      <ConceptsExplainer base={`/workspaces/${workspace.id}`} current="content" />
      <ProductionStrip workspaceId={workspace.id} />

      <div className="mb-5">
        <StatsGrid>
          <StatCard label="Conteúdos" value={stats.total} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          <StatCard label="Publicados" value={stats.published} active={statusFilter === "published"} onClick={() => setStatusFilter("published")} />
          <StatCard label="Agendados" value={stats.scheduled} active={statusFilter === "scheduled"} onClick={() => setStatusFilter("scheduled")} />
          {stats.awaitingApproval > 0 || statusFilter === "awaiting_approval" ? <StatCard label="Aguardando aprovação" value={stats.awaitingApproval} active={statusFilter === "awaiting_approval"} onClick={() => setStatusFilter("awaiting_approval")} /> : null}
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
              <Button variant="ghost" onClick={() => { setSearch(""); setNetworkFilter("all"); setStatusFilter("all"); setFormatFilter("all"); setDateFilter("all"); }}>Limpar filtros</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-14"><Spinner /></div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nenhum conteúdo ainda"
          description="Quando algo for publicado ou agendado, a biblioteca aparece aqui."
          action={<Link href={`/workspaces/${workspace.id}/create`}><Button variant="secondary">Criar conteúdo</Button></Link>}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">Nenhum conteúdo corresponde aos filtros aplicados.</div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map((group) => (
            <ContentCard key={group.key} workspaceId={workspace.id} group={group} onOpen={() => setSelectedKey(group.key)} />
          ))}
        </div>
      ) : (
        <ListCard ref={containerRef} availableHeight={availableHeight} footer={<TablePagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setCurrentPage} />}>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead columnKey="title" sort={sort} onSort={onSort}>Conteúdo</SortableHead>
                <SortableHead columnKey="networks" sort={sort} onSort={onSort}>Redes</SortableHead>
                <SortableHead columnKey="format" sort={sort} onSort={onSort}>Formato</SortableHead>
                <SortableHead columnKey="status" sort={sort} onSort={onSort}>Status</SortableHead>
                <SortableHead columnKey="date" sort={sort} onSort={onSort} align="right">Data</SortableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.map((group) => {
                const format = contentTypeOf(group.primary);
                const thumbnail = group.primary.media.imageUrls[0] ?? group.primary.media.thumbnailUrl;
                return (
                  <TableRow key={group.key}>
                    <TableCell>
                      <button type="button" onClick={() => setSelectedKey(group.key)} className="flex min-w-0 items-center gap-3 text-left">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
                          {thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumbnail} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <FormatIcon format={format} className="h-5 w-5 text-primary-foreground/80" />
                          )}
                        </span>
                        <span className="min-w-0 truncate font-medium text-foreground">{titleOf(group.primary)}</span>
                      </button>
                    </TableCell>
                    <TableCell><NetworkIcons group={group} /></TableCell>
                    <TableCell className="text-muted-foreground">{FORMAT_LABEL[format]}</TableCell>
                    <TableCell><StatusBadge status={group.status} /></TableCell>
                    <TableCell className="text-right text-muted-foreground">{group.date ? formatDateTime(group.date) : "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end">
                        <ActionsMenu workspaceId={workspace.id} group={group} onOpen={() => setSelectedKey(group.key)} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ListCard>
      )}

      {selected ? (
        <ContentDetailModal workspaceId={workspace.id} group={selected} busyId={busyId} onCancel={setPendingCancel} onClose={() => setSelectedKey(undefined)} />
      ) : null}
      <ConfirmDialog
        open={!!pendingCancel}
        title="Cancelar agendamento"
        description={pendingCancel ? `Cancelar o agendamento no ${NETWORK_LABEL[pendingCancel.network]}? A publicação nessa rede não vai mais sair.` : ""}
        confirmLabel="Cancelar agendamento"
        cancelLabel="Voltar"
        variant="danger"
        busy={!!pendingCancel && busyId === pendingCancel.id}
        onCancel={() => setPendingCancel(undefined)}
        onConfirm={() => (pendingCancel ? cancel(pendingCancel) : undefined)}
      />
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-accent-soft" aria-label={label}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function FormatIcon({ format, className }: { format: PublicationContentType; className?: string }) {
  const Icon = format === "video" ? Video : format === "carousel" ? GalleryHorizontal : format === "text" ? AlignLeft : ImageIcon;
  return <Icon className={className} aria-hidden />;
}

/** Um ícone por rede onde a peça saiu, com o pontinho do resultado daquela rede. */
function NetworkIcons({ group, onDark = false }: { group: ContentGroup; onDark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {group.posts.map((post) => {
        const status = derivePublicationStatus(post);
        return (
          <Tooltip key={`${post.network}-${post.id}`}>
            <TooltipTrigger asChild>
              <span className={cn("relative inline-flex h-7 w-7 items-center justify-center rounded-full", onDark ? "bg-black/55 text-white backdrop-blur" : "bg-muted text-foreground")}>
                <ChannelIcon channel={post.network} label={NETWORK_LABEL[post.network]} />
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2", onDark ? "ring-black/60" : "ring-card", STATUS_DOT[status])} aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent>{NETWORK_LABEL[post.network]}: {PUBLICATION_DISPLAY_STATUS_LABEL[status]}</TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}

function ContentCard({ workspaceId, group, onOpen }: { workspaceId: string; group: ContentGroup; onOpen: () => void }) {
  const post = group.primary;
  const format = contentTypeOf(post);
  const thumbnail = post.media.imageUrls[0] ?? post.media.thumbnailUrl;
  const failedCount = group.posts.filter((item) => derivePublicationStatus(item) === "failed").length;

  return (
    <article className="group min-w-0 overflow-hidden rounded-2xl border border-border bg-card/55 transition hover:border-primary/70 hover:shadow-lg">
      <button type="button" onClick={onOpen} className={`relative flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : post.media.videoUrl ? (
          <video src={post.media.videoUrl} muted playsInline preload="metadata" tabIndex={-1} aria-hidden className="pointer-events-none h-full w-full object-cover" />
        ) : (
          <FormatIcon format={format} className="h-12 w-12 text-primary-foreground/75 drop-shadow" />
        )}
        <span className="absolute left-3 top-3"><NetworkIcons group={group} onDark /></span>
        <span className="absolute right-3 top-3"><StatusBadge status={group.status} /></span>
        {failedCount > 0 && group.status !== "failed" ? (
          <span className="absolute bottom-3 left-3 rounded-full bg-destructive px-2 py-0.5 text-xs font-medium text-destructive-foreground">Falhou em {failedCount} rede{failedCount > 1 ? "s" : ""}</span>
        ) : null}
      </button>
      <div className="p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <button type="button" onClick={onOpen} className="min-w-0 text-left">
            <h2 className="line-clamp-2 text-sm font-semibold text-foreground">{titleOf(post)}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{group.date ? formatDateTime(group.date) : "Sem data"} · {FORMAT_LABEL[format]}</p>
          </button>
          <ActionsMenu workspaceId={workspaceId} group={group} onOpen={onOpen} />
        </div>
      </div>
    </article>
  );
}

function ActionsMenu({ workspaceId, group, onOpen }: { workspaceId: string; group: ContentGroup; onOpen: () => void }) {
  return (
    <details className="relative shrink-0">
      <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Abrir menu">
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">
        <button type="button" onClick={onOpen} className="w-full rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted">Ver detalhes</button>
        <Link href={publishAgainHref(workspaceId, group.primary)} className="block rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted">Publicar novamente</Link>
      </div>
    </details>
  );
}

function ContentDetailModal({ workspaceId, group, busyId, onClose, onCancel }: { workspaceId: string; group: ContentGroup; busyId?: string; onClose: () => void; onCancel: (post: UnifiedPublication) => void }) {
  const post = group.primary;
  const format = contentTypeOf(post);
  const thumbnail = post.media.imageUrls[0] ?? post.media.thumbnailUrl;

  return (
    <DetailModal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      eyebrow="Conteúdo"
      title={titleOf(post)}
      description={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={group.status} />
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{FORMAT_LABEL[format]}</span>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{group.posts.length} rede{group.posts.length > 1 ? "s" : ""}</span>
          {post.placement === "story" ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Story</span> : null}
        </div>
      }
      srDescription="Detalhes do conteúdo e o resultado em cada rede."
      widthStorageKey="vorix.contents.detail.width"
      defaultWidthPercent={62}
      footer={
        <div className="flex flex-wrap gap-2">
          <Link href={publishAgainHref(workspaceId, post)}><Button>Publicar novamente</Button></Link>
        </div>
      }
    >
      <div className="space-y-6">
        <DetailBlock label="Onde saiu">
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {group.posts.map((item) => {
              const status = derivePublicationStatus(item);
              const when = publicationDate(item);
              return (
                <li key={`${item.network}-${item.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <span className="flex min-w-36 items-center gap-2 text-sm font-medium text-foreground">
                    <ChannelIcon channel={item.network} label={NETWORK_LABEL[item.network]} /> {NETWORK_LABEL[item.network]}
                  </span>
                  <StatusBadge status={status} />
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {status === "scheduled" ? "Agendado para " : status === "published" ? "Publicado em " : ""}{when ? formatDateTime(when) : "Sem data"}
                  </span>
                  <span className="ml-auto flex gap-2">
                    {item.externalUrl ? (
                      <a href={item.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                        Ver na rede <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    ) : null}
                    {status === "scheduled" ? <Button size="sm" variant="ghost" disabled={busyId === item.id} onClick={() => onCancel(item)}>Cancelar</Button> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </DetailBlock>
        {post.media.videoUrl ? (
          <video src={post.media.videoUrl} poster={post.media.thumbnailUrl} controls playsInline preload="metadata" aria-label="Vídeo do conteúdo" className="mx-auto max-h-[60vh] w-full rounded-xl border border-border bg-black object-contain" />
        ) : thumbnail ? (
          // Peça inteira sem corte (`object-contain`): Stories 9:16 não podem ser cortados.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="mx-auto max-h-[60vh] w-full rounded-xl border border-border object-contain" />
        ) : (
          <div className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br ${FORMAT_GRADIENT[format]}`}>
            <FormatIcon format={format} className="h-14 w-14 text-primary-foreground/75" />
          </div>
        )}
        <DetailBlock label="Legenda">
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{post.text || "Sem legenda"}</p>
        </DetailBlock>
      </div>
    </DetailModal>
  );
}

function viewModeButtonClass(active: boolean) {
  return `flex h-8 w-9 items-center justify-center rounded-md transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;
}

function titleOf(post: UnifiedPublication): string {
  const firstLine = post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 96) : `${channelLabel(post.network)} · ${FORMAT_LABEL[contentTypeOf(post)]}`;
}

function publishAgainHref(workspaceId: string, post: UnifiedPublication): string {
  return `/workspaces/${workspaceId}/publish?network=${post.network}&source=${encodeURIComponent(`${post.network}:${post.id}`)}`;
}

/**
 * Fase 5: o que ainda está na produção (não virou publicação) mora na Revisão — a biblioteca mostra
 * as peças publicadas/agendadas. Este atalho deixa isso claro, com os números reais do Bolsão.
 */
function ProductionStrip({ workspaceId }: { workspaceId: string }) {
  const ideas = useSWR(["create-hub-ideas", workspaceId], () => listEditorialIdeas(workspaceId));
  const inProduction = ideas.data?.filter((idea) => idea.status === "in_production").length;
  const toReview = ideas.data?.filter((idea) => idea.status === "produced").length;
  if (!ideas.data || (!inProduction && !toReview)) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm" data-testid="library-production-strip">
      <span className="text-muted-foreground">Ainda na produção:</span>
      {toReview ? <Link href={`/workspaces/${workspaceId}/review`} className="font-medium text-foreground hover:underline">{toReview} conteúdo(s) para revisar</Link> : null}
      {inProduction ? <Link href={`/workspaces/${workspaceId}/production`} className="font-medium text-foreground hover:underline">{inProduction} em produção</Link> : null}
    </div>
  );
}
