"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, Archive, ArchiveRestore, MessageSquareText, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { KpiCard } from "@/components/DashboardKit";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { GuardedButton } from "@/components/GuardedButton";
import { ListCard } from "@/components/ListCard";
import { PageHeader } from "@/components/PageHeader";
import { SearchableCombo } from "@/components/SearchableCombo";
import { SortableHead } from "@/components/SortableHead";
import { Spinner } from "@/components/Spinner";
import { StatsGrid } from "@/components/StatsGrid";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useTeams } from "@/features/identity/hooks";
import { dismissRadarAlert, reactivateRadarAlert, reanalyzeRadarAlert } from "@/features/radar/api";
import { useRadarAlertDetail, useRadarAlerts, useRadarCredits, useRadarRealtime, useRadarStats } from "@/features/radar/hooks";
import {
  formatWaitingMinutes,
  RADAR_AI_TONE_CLASS,
  RADAR_CATEGORY_LABEL,
  RADAR_LEVEL_CLASS,
  RADAR_LEVEL_LABEL,
  RADAR_MAIN_RISK_LABEL,
  RADAR_PRIORITY_LABEL,
  radarAiIndicator,
  radarCreditsBanner,
  radarDiagnosisNotice,
  radarReanalyzeFeedback,
} from "@/features/radar/presentation";
import type { RadarAlert, RadarCredits, RadarRiskLevel } from "@/features/radar/types";
import { useDebounce } from "@/hooks/useDebounce";
import { useSortedRows } from "@/hooks/useSortedRows";
import { ApiError } from "@/lib/api-error";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { canOperateWorkspace } from "@/lib/rbac";
import { cn } from "@/lib/utils";

/**
 * Radar de Sentimento (réplica adaptada do CMDesk, pedido explícito do usuário) — conversas em
 * risco, detectadas por palavra-chave + score heurístico.
 *
 * Duas coisas distintas, nunca confundidas na tela: o SCORE DO RADAR (heurístico, gratuito,
 * sempre atualizado) e o DIAGNÓSTICO DA IA (consome crédito, pode estar desatualizado). Sem
 * crédito a tela abre normalmente: score, nível, motivos e sinais seguem ao vivo, o último
 * diagnóstico continua visível, e um banner explica que só os NOVOS diagnósticos estão suspensos.
 */
export default function RadarPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-primary" /></div>}>
      <RadarView />
    </Suspense>
  );
}

type RadarSortKey = "contact" | "team" | "agent" | "score" | "waiting" | "updatedAt";
type LevelFilter = RadarRiskLevel | "all";
const LEVELS: readonly RadarRiskLevel[] = ["critical", "high", "medium", "low"];
const COLUMN_COUNT = 9;

function LevelBadge({ level }: { level: RadarRiskLevel }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", RADAR_LEVEL_CLASS[level])}>{RADAR_LEVEL_LABEL[level]}</span>;
}

function AiBadge({ alert }: { alert: RadarAlert }) {
  const indicator = radarAiIndicator(alert);
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", RADAR_AI_TONE_CLASS[indicator.tone])}>{indicator.label}</span>;
}

function RadarView() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.role : undefined;
  const canOperate = canOperateWorkspace(role);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const plansHref = `/workspaces/${workspace.id}/settings/plano`;

  // Estado escolhido pelo usuário vive na URL (filtros, visão e alerta aberto).
  const levelFilter = (searchParams.get("level") as LevelFilter | null) ?? "all";
  const teamFilter = searchParams.get("team") ?? "";
  const showDismissed = searchParams.get("view") === "archived";
  const selectedConversationId = searchParams.get("alert") ?? undefined;

  const setParam = useCallback(
    (changes: Record<string, string | undefined>, mode: "push" | "replace" = "replace") => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const query = params.toString();
      router[mode](query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data, error, isLoading, mutate } = useRadarAlerts(workspace.id, { level: levelFilter === "all" ? undefined : levelFilter, teamId: teamFilter || undefined, dismissed: showDismissed });
  const { data: stats, mutate: mutateStats } = useRadarStats(workspace.id, teamFilter || undefined);
  const { data: credits, mutate: mutateCredits } = useRadarCredits(workspace.id);
  const { data: teams } = useTeams(workspace.id);
  useRadarRealtime(workspace.id);

  const alerts = useMemo(() => data?.alerts ?? [], [data]);
  const banner = radarCreditsBanner(credits);

  // filter → sort → paginate, sempre nessa ordem.
  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return alerts;
    return alerts.filter((alert) => [alert.contactName, alert.contactPhone, alert.agentName, alert.teamName, ...alert.reasons].some((value) => value?.toLowerCase().includes(term)));
  }, [alerts, debouncedSearch]);

  const { sorted, sort, onSort } = useSortedRows<RadarAlert, RadarSortKey>(
    filtered,
    {
      contact: (alert) => (alert.contactName ?? alert.contactPhone ?? "").toLowerCase() || null,
      team: (alert) => alert.teamName?.toLowerCase() ?? null,
      agent: (alert) => alert.agentName?.toLowerCase() ?? null,
      score: (alert) => alert.score,
      waiting: (alert) => alert.liveWaitingMinutes,
      updatedAt: (alert) => new Date(alert.updatedAt).getTime(),
    },
    { key: "score", dir: "desc" },
  );

  const { currentPage, totalPages, paginatedItems, setCurrentPage, resetPage, totalItems, pageSize, containerRef, availableHeight } = usePagination(sorted, { auto: true });

  useEffect(() => {
    resetPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, levelFilter, teamFilter, showDismissed, sort]);

  const refreshAll = useCallback(() => {
    void mutate();
    void mutateStats();
    void mutateCredits();
  }, [mutate, mutateStats, mutateCredits]);

  // O módulo fica atrás de um kill switch no backend — sem ele as rotas nem existem (404).
  if (error instanceof ApiError && error.statusCode === 404) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <EmptyState
          icon={<Activity className="h-6 w-6" aria-hidden="true" />}
          title="Radar de Sentimento indisponível"
          description="O Radar ainda não está habilitado neste ambiente."
          action={<Button variant="secondary" onClick={() => router.push(`/workspaces/${workspace.id}/conversas`)}>Ir para Conversas</Button>}
        />
      </div>
    );
  }

  const hasFilters = Boolean(debouncedSearch) || levelFilter !== "all" || Boolean(teamFilter);

  return (
    <main className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title="Radar de Sentimento"
        description="Conversas em risco, detectadas por palavras-chave e sinais do atendimento. O score do Radar é atualizado a cada mensagem; o diagnóstico da IA é gerado à parte e consome créditos."
        actions={<CreditsIndicator credits={credits} href={plansHref} />}
      />

      {banner ? (
        <Card className="mb-3 border-amber-200 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-400/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{banner.title}</p>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{banner.body}</p>
              </div>
            </div>
            <Button asChild className="shrink-0">
              <Link href={plansHref}>{banner.cta}</Link>
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="mb-3">
        <StatsGrid>
          <KpiCard label="Alertas ativos" value={stats ? String(stats.totalActive) : "—"} hint={stats && stats.totalActive > 0 ? `Score médio ${stats.avgScore}` : undefined} />
          <KpiCard label="Críticos" value={stats ? String(stats.critical) : "—"} accent={stats && stats.critical > 0 ? "negative" : "default"} />
          <KpiCard label="Altos" value={stats ? String(stats.high) : "—"} />
          <KpiCard label="SLA vencido" value={stats ? String(stats.slaBreached) : "—"} />
          <KpiCard label="Cancelamento" value={stats ? String(stats.withCancellation) : "—"} hint="Com ameaça de cancelamento" />
          <KpiCard label="IA sem créditos" value={stats ? String(stats.aiBlockedNoCredits) : "—"} hint="Aguardando diagnóstico" />
        </StatsGrid>
      </div>

      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por contato, agente, equipe ou motivo..." className="pl-10" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <Select value={levelFilter} onValueChange={(value) => setParam({ level: value === "all" ? undefined : value })}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Nível" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os níveis</SelectItem>
              {LEVELS.map((level) => <SelectItem key={level} value={level}>{RADAR_LEVEL_LABEL[level]}</SelectItem>)}
            </SelectContent>
          </Select>
          <SearchableCombo
            items={(teams ?? []).map((team) => ({ id: team.id, label: team.name }))}
            extraOption={{ value: "", label: "Todas as equipes" }}
            value={teamFilter}
            onValueChange={(value) => setParam({ team: value || undefined })}
            placeholder="Equipe"
            className="w-48"
          />
          <Select value={showDismissed ? "archived" : "active"} onValueChange={(value) => setParam({ view: value === "archived" ? "archived" : undefined })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="archived">Arquivados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <ListCard
        ref={containerRef}
        availableHeight={availableHeight}
        footer={<TablePagination currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} pageSize={pageSize} onPageChange={setCurrentPage} />}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead columnKey="contact" sort={sort} onSort={onSort}>Contato</SortableHead>
              <SortableHead columnKey="team" sort={sort} onSort={onSort}>Equipe</SortableHead>
              <SortableHead columnKey="agent" sort={sort} onSort={onSort}>Agente</SortableHead>
              <SortableHead columnKey="score" sort={sort} onSort={onSort} align="right">Score</SortableHead>
              <TableHead>Nível</TableHead>
              <TableHead>Motivos</TableHead>
              <SortableHead columnKey="waiting" sort={sort} onSort={onSort} align="right">Sem resposta</SortableHead>
              <TableHead>IA</TableHead>
              <SortableHead columnKey="updatedAt" sort={sort} onSort={onSort} align="right">Atualizado</SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8"><ErrorState error={error} onRetry={() => mutate()} /></TableCell>
              </TableRow>
            ) : isLoading ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-14 text-center"><Spinner className="mx-auto h-5 w-5 text-muted-foreground" /></TableCell>
              </TableRow>
            ) : paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-sm text-muted-foreground">
                  {hasFilters
                    ? "Nenhum alerta encontrado com esses filtros."
                    : showDismissed
                      ? "Nenhum alerta arquivado."
                      : "Nenhuma conversa em risco no momento. O Radar sinaliza aqui assim que detectar uma palavra-chave crítica."}
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((alert) => (
                <TableRow key={alert.conversationId} className="cursor-pointer" onClick={() => setParam({ alert: alert.conversationId }, "push")}>
                  <TableCell className="max-w-[220px]">
                    <p className="truncate font-medium text-foreground">{alert.contactName ?? alert.contactPhone ?? "Contato sem nome"}</p>
                    {alert.contactName && alert.contactPhone ? <p className="truncate text-[11px] text-muted-foreground">{alert.contactPhone}</p> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{alert.teamName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{alert.agentName ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-foreground">{alert.score}</TableCell>
                  <TableCell><LevelBadge level={alert.level} /></TableCell>
                  <TableCell className="max-w-[320px]">
                    <p className="truncate text-muted-foreground" title={alert.reasons.join(" · ")}>{alert.reasons.length > 0 ? alert.reasons.join(" · ") : "—"}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatWaitingMinutes(alert.liveWaitingMinutes)}
                    {alert.signals.slaBreached && alert.liveWaitingMinutes > 0 ? <span className="ml-1.5 text-[11px] font-medium text-destructive">SLA</span> : null}
                  </TableCell>
                  <TableCell><AiBadge alert={alert} /></TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatRelativeTime(alert.updatedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ListCard>

      <RadarAlertModal
        workspaceId={workspace.id}
        conversationId={selectedConversationId}
        credits={credits}
        canOperate={canOperate}
        plansHref={plansHref}
        onClose={() => setParam({ alert: undefined })}
        onChanged={refreshAll}
      />
    </main>
  );
}

/** Saldo de créditos de IA no cabeçalho — só leitura; some quando a IA não está habilitada. */
function CreditsIndicator({ credits, href }: { credits: RadarCredits | undefined; href: string }) {
  if (!credits?.aiConfigured) return null;
  return (
    <Link href={href} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground hover:text-foreground">
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      {credits.available ? (
        <span>Créditos de IA: <span className="font-semibold tabular-nums text-foreground">{credits.remainingCredits ?? "—"}</span></span>
      ) : (
        <span className="font-medium text-amber-700 dark:text-amber-300">Créditos de IA esgotados</span>
      )}
    </Link>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm text-foreground">{value}</p>
    </div>
  );
}

type ModalSection = "radar" | "ai";

function RadarAlertModal({
  workspaceId,
  conversationId,
  credits,
  canOperate,
  plansHref,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  conversationId: string | undefined;
  credits: RadarCredits | undefined;
  canOperate: boolean;
  plansHref: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, error, isLoading, mutate } = useRadarAlertDetail(workspaceId, conversationId);
  const [section, setSection] = useState<ModalSection>("radar");
  const [busy, setBusy] = useState<"analyze" | "dismiss" | undefined>();

  useEffect(() => {
    setSection("radar");
  }, [conversationId]);

  const alert = data?.alert;
  const notice = alert ? radarDiagnosisNotice(alert, credits) : undefined;
  const cooldownActive = Boolean(alert?.aiCooldownUntil && new Date(alert.aiCooldownUntil).getTime() > Date.now());
  const analyzeBlockedReason = !canOperate
    ? "Apenas owner, admin e editor podem solicitar um diagnóstico."
    : credits && !credits.aiConfigured
      ? "O diagnóstico por IA não está habilitado neste ambiente."
      : credits && !credits.available
        ? "Seus créditos de IA acabaram. Adicione créditos para gerar um novo diagnóstico."
        : alert?.aiDisplayStatus === "PENDING"
          ? "A IA já está analisando esta conversa."
          : cooldownActive
            ? `Esta conversa foi analisada há pouco. Nova análise disponível às ${new Date(alert!.aiCooldownUntil!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`
            : undefined;

  async function handleAnalyze() {
    if (!conversationId || busy) return;
    setBusy("analyze");
    try {
      const result = await reanalyzeRadarAlert(workspaceId, conversationId);
      const feedback = radarReanalyzeFeedback(result.outcome);
      if (feedback.kind === "success") toast.success(feedback.message);
      else if (feedback.kind === "error") toast.error(feedback.message);
      else toast.info(feedback.message);
      await mutate();
      onChanged();
    } catch (cause) {
      toast.error("Não foi possível solicitar o diagnóstico", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(undefined);
    }
  }

  async function handleToggleDismiss() {
    if (!conversationId || !alert || busy) return;
    setBusy("dismiss");
    try {
      if (alert.isDismissed) await reactivateRadarAlert(workspaceId, conversationId);
      else await dismissRadarAlert(workspaceId, conversationId);
      toast.success(alert.isDismissed ? "Alerta reativado." : "Alerta arquivado.");
      await mutate();
      onChanged();
    } catch (cause) {
      toast.error("Não foi possível atualizar o alerta", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(undefined);
    }
  }

  const keywords = alert?.signals.keywordMatches ?? [];

  return (
    <DetailModal
      open={Boolean(conversationId)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      eyebrow="Alerta do Radar"
      title={alert ? alert.contactName ?? alert.contactPhone ?? "Contato sem nome" : "Alerta do Radar"}
      description={alert ? [alert.teamName, alert.agentName].filter(Boolean).join(" · ") || "Sem equipe ou agente atribuído" : undefined}
      headerExtra={alert ? <div className="flex items-center gap-2"><LevelBadge level={alert.level} /><AiBadge alert={alert} /></div> : undefined}
      sections={[
        { value: "radar", label: "Score do Radar", icon: Activity },
        { value: "ai", label: "Diagnóstico da IA", icon: Sparkles },
      ]}
      value={section}
      onValueChange={(value) => setSection(value as ModalSection)}
      widthStorageKey="radar-alert-modal"
      footer={
        alert ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button asChild variant="ghost">
              <Link href={`/workspaces/${workspaceId}/conversas?conversation=${encodeURIComponent(alert.conversationId)}`}>
                <MessageSquareText className="mr-2 h-4 w-4" /> Abrir conversa
              </Link>
            </Button>
            <GuardedButton variant="secondary" allowed={canOperate} blockedReason="Apenas owner, admin e editor podem arquivar alertas." disabled={busy !== undefined} onClick={handleToggleDismiss}>
              {alert.isDismissed ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
              {alert.isDismissed ? "Reativar alerta" : "Arquivar alerta"}
            </GuardedButton>
            <GuardedButton allowed={!analyzeBlockedReason} blockedReason={analyzeBlockedReason ?? ""} disabled={busy !== undefined} onClick={handleAnalyze}>
              <Sparkles className="mr-2 h-4 w-4" />
              {busy === "analyze" ? "Analisando…" : "Analisar agora"}
            </GuardedButton>
          </div>
        ) : undefined
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading || !alert ? (
        <div className="flex justify-center py-14"><Spinner className="h-5 w-5 text-muted-foreground" /></div>
      ) : section === "radar" ? (
        <div className="space-y-6">
          <DetailBlock label="Score atual">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fact label="Score do Radar" value={<span className="text-2xl font-bold tabular-nums">{alert.score}<span className="text-sm font-normal text-muted-foreground"> / 100</span></span>} />
              <Fact label="Nível" value={<LevelBadge level={alert.level} />} />
              <Fact label="Tempo sem resposta" value={formatWaitingMinutes(alert.liveWaitingMinutes)} />
              <Fact label="Última atividade" value={formatDateTime(alert.lastMessageAt)} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Calculado pelo Radar a cada mensagem, sem uso de IA e sem consumir créditos.</p>
          </DetailBlock>

          <DetailBlock label="Motivos do alerta">
            {alert.reasons.length > 0 ? (
              <ul className="space-y-1.5 text-sm text-foreground">
                {alert.reasons.map((reason) => <li key={reason} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />{reason}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum motivo ativo no momento.</p>
            )}
          </DetailBlock>

          <DetailBlock label="Palavras-chave detectadas">
            {keywords.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {keywords.map((match) => (
                  <span key={match.keyword} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-foreground">
                    {match.keyword}
                    <span className="text-muted-foreground">· {RADAR_CATEGORY_LABEL[match.category]}</span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </DetailBlock>

          <DetailBlock label="Sinais operacionais">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fact label="SLA" value={alert.signals.slaBreached && alert.liveWaitingMinutes > 0 ? <span className="font-medium text-destructive">Vencido</span> : "Dentro do prazo"} />
              <Fact label="Transferências" value={<span className="tabular-nums">{alert.transferCount}</span>} />
              <Fact label="Reaberturas" value={<span className="tabular-nums">{alert.reopenCount}</span>} />
              <Fact label="Mensagens do cliente" value={<span className="tabular-nums">{alert.inboundCount}</span>} />
              <Fact label="Equipe" value={alert.teamName ?? "—"} />
              <Fact label="Agente" value={alert.agentName ?? "—"} />
              <Fact label="Urgência" value={alert.signals.urgency === "high" ? "Alta" : alert.signals.urgency === "medium" ? "Média" : "Baixa"} />
              <Fact label="Tom da última mensagem" value={alert.signals.sentiment === "negative" ? "Negativo" : alert.signals.sentiment === "positive" ? "Positivo" : "Neutro"} />
            </div>
          </DetailBlock>

          {alert.conversationContext ? (
            <DetailBlock label="Últimas mensagens do cliente">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{alert.conversationContext}</p>
            </DetailBlock>
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          {notice ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-400/10">
              {notice.badge ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">{notice.badge}</p> : null}
              <p className="text-sm text-foreground">{notice.message}</p>
              {notice.showBuyCredits ? (
                <Button asChild className="mt-3" size="sm">
                  <Link href={plansHref}>Adicionar créditos</Link>
                </Button>
              ) : null}
            </div>
          ) : null}

          {alert.aiAnalysis ? (
            <DetailBlock label="Último diagnóstico da IA" action={<span className="text-xs text-muted-foreground">Realizado em {formatDateTime(alert.aiAnalyzedAt)}</span>}>
              <div className="space-y-4">
                <Fact label="Diagnóstico" value={alert.aiAnalysis.diagnostico} />
                <Fact label="Causa raiz" value={alert.aiAnalysis.causaRaiz} />
                <div className="grid grid-cols-2 gap-4">
                  <Fact label="Risco principal" value={RADAR_MAIN_RISK_LABEL[alert.aiAnalysis.riscoPrincipal] ?? alert.aiAnalysis.riscoPrincipal} />
                  <Fact label="Prioridade" value={RADAR_PRIORITY_LABEL[alert.aiAnalysis.prioridade] ?? alert.aiAnalysis.prioridade} />
                </div>
                <Fact label="Ação imediata" value={alert.aiAnalysis.acaoImediata} />
                <Fact label="Resumo para gestor" value={alert.aiAnalysis.resumoParaGestor} />
              </div>
            </DetailBlock>
          ) : null}

          <p className="text-xs text-muted-foreground">
            O diagnóstico é gerado pela IA quando o Radar encontra risco suficiente e consome créditos de IA. O score do Radar, na aba ao lado, continua sendo atualizado mesmo sem créditos.
          </p>
        </div>
      )}
    </DetailModal>
  );
}
