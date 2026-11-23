"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle2, ChevronDown, Circle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { OPEN_NOTIFICATIONS_EVENT } from "@/components/NotificationBell";
import { ActivityList, AttentionList, CreateMenu, HomePanel, QuickLinkGrid, SummaryCard, type ModuleLoadIssue, type SummaryCardProps } from "@/components/home/HomeBlocks";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useMyAccess } from "@/features/auth/access";
import { acceptCommercialSuggestion, completeTask, dismissCommercialSuggestion } from "@/features/crm/api";
import { isTaskOverdue } from "@/features/crm/presentation";
import {
  useHomeCommercialMetrics,
  useHomeConnections,
  useHomeDashboard,
  useHomeMeetings,
  useHomePaidOrders,
  useHomePendingTasks,
  useHomeProposals,
  useHomeRecentOrders,
  useHomeSocialPosts,
  useHomeSuggestions,
  useHomeUnreadConversations,
} from "@/features/home/hooks";
import {
  buildActivity,
  conversationAttention,
  createOptions,
  greetingFor,
  meetingsAttention,
  moduleAccess,
  ordersAttention,
  postsAwaitingApproval,
  quickLinks,
  relativeTime,
  salesAttention,
  scheduledPosts,
  socialAttention,
  sortAttention,
  todayLabel,
  upcomingMeetings,
  type AttentionItem,
  type HomeModule,
} from "@/features/home/model";
import { useInboxModuleStatus } from "@/features/inbox/hooks";
import { useNotifications } from "@/features/notification/hooks";
import { useOnboarding } from "@/features/onboarding/hooks";
import type { OnboardingStep } from "@/features/onboarding/types";
import { useSolutions } from "@/features/solutions/hooks";
import { formatCurrencyCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SectionBoundary } from "@/components/home/SectionBoundary";
import type { CommerceOrder } from "@/features/commerce/api";
import type { CommercialSuggestion, Proposal, Task } from "@/features/crm/types";
import type { InboxConversation, MessagingConnection } from "@/features/inbox/types";
import type { MeetingListItem } from "@/features/meetings/types";
import type { SocialPostView } from "@/features/social/types";
import { DashboardView } from "./dashboard-view";

/**
 * Início unificado do workspace (Reorganização de UX — Fase 3): uma central operacional ÚNICA para
 * todas as ferramentas contratadas. Cada área carrega sozinha (falha do Marketing não derruba o
 * resto), só busca o que a conta tem e o perfil pode ler, e nunca mostra "0" quando o dado não
 * existe. Todas as consultas levam o workspace atual — trocar de empresa remonta a página do zero.
 */

const CHECKLIST_ITEMS: ReadonlyArray<{ step: OnboardingStep; label: string }> = [
  { step: "company", label: "Empresa" },
  { step: "commercial", label: "Comercial" },
  { step: "team", label: "Equipe" },
  { step: "channel", label: "Canal" },
];

const DAY = 24 * 60 * 60 * 1000;

/** Leitura defensiva: resposta fora do formato esperado vira "sem dado" daquela área, nunca derruba a página. */
const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const count = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

export default function WorkspaceHomePage() {
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const { available, isLoading: solutionsLoading } = useSolutions();
  const { can, access } = useMyAccess();
  const base = `/workspaces/${workspace.id}`;
  const [now] = useState(() => new Date());
  // Janelas arredondadas para a hora: a chave de cache fica estável durante a visita.
  const ranges = useMemo(() => {
    const hour = new Date(now);
    hour.setMinutes(0, 0, 0);
    const at = (offsetDays: number) => new Date(hour.getTime() + offsetDays * DAY).toISOString();
    return { past7: at(-7), next7: at(7), next30: at(30) };
  }, [now]);

  const ready = !solutionsLoading && access !== undefined;
  const accessOf = (module: HomeModule) => (ready ? moduleAccess(module, available, can) : "hidden");
  const conversationsAccess = accessOf("conversations");
  const salesAccess = accessOf("sales");
  const marketingAccess = accessOf("marketing");
  const meetingsAccess = accessOf("meetings");
  const siteAccess = accessOf("site");
  const hasConversations = available.includes("conversations");

  // ---- Conversas e Vendas (o painel do backend já entrega os dois, no recorte de quem vê)
  const { data: inboxStatus } = useInboxModuleStatus();
  const inboxOn = conversationsAccess === "visible" && inboxStatus?.enabled === true;
  const [scope, setScope] = useState<string | undefined>();
  const dashboardWanted = inboxOn || salesAccess === "visible";
  const firstDashboard = useHomeDashboard(workspace.id, "me", dashboardWanted && scope !== "company");
  // Quem pode ver a empresa inteira começa por ela (é a central da empresa); dá para trocar para "Só eu".
  const companyFromMe = list<{ value: string }>(firstDashboard.data?.options?.viewings).some((option) => option.value === "company");
  const viewing = scope ?? (companyFromMe ? "company" : "me");
  const scopedDashboard = useHomeDashboard(workspace.id, viewing, dashboardWanted && viewing !== "me");
  const companyAvailable = companyFromMe || scope === "company";
  const dashboard = viewing === "me" ? firstDashboard : scopedDashboard;
  const attendance = dashboard.data?.attendance?.available && dashboard.data.attendance.backlog ? dashboard.data.attendance : undefined;
  const commercial = dashboard.data?.commercial?.available && dashboard.data.commercial.open ? dashboard.data.commercial : undefined;

  const connections = useHomeConnections(workspace.id, inboxOn);
  const unread = useHomeUnreadConversations(workspace.id, inboxOn);
  const connectionList = list<MessagingConnection>(connections.data?.connections);
  const unreadList = list<InboxConversation>(unread.data?.conversations);
  const hasConnectedChannel = connectionList.some((connection) => connection.status === "connected");

  const tasksOn = hasConversations && ready && can("task:read");
  const tasks = useHomePendingTasks(workspace.id, tasksOn);
  const proposalsOn = hasConversations && ready && can("proposal:read");
  const proposalsViewed = useHomeProposals(workspace.id, "viewed", proposalsOn);
  const proposalsAccepted = useHomeProposals(workspace.id, "accepted", proposalsOn);
  const salesOn = salesAccess === "visible";
  const suggestions = useHomeSuggestions(workspace.id, salesOn);
  const metrics = useHomeCommercialMetrics(workspace.id, salesOn);

  // ---- Marketing, Reuniões, Site
  const posts = useHomeSocialPosts(workspace.id, { from: ranges.past7, to: ranges.next30 }, marketingAccess === "visible");
  const meetings = useHomeMeetings(workspace.id, { from: ranges.past7, to: ranges.next7 }, meetingsAccess === "visible");
  const recentOrders = useHomeRecentOrders(workspace.id, ranges.past7, siteAccess === "visible");
  const paidOrders = useHomePaidOrders(workspace.id, siteAccess === "visible");

  const { data: onboarding, isLoading: onboardingLoading } = useOnboarding(hasConversations ? workspace.id : undefined);
  const { data: notifications } = useNotifications(workspace.id);
  const notificationCount = list(notifications?.notifications).length;
  const taskList = list<Task>(tasks.data);
  const postList = list<SocialPostView>(posts.data?.posts);
  const meetingList = list<MeetingListItem>(meetings.data?.items);
  const recentOrderList = list<CommerceOrder>(recentOrders.data?.orders);
  const recentOrderTotal = count(recentOrders.data?.total);
  const paidOrderList = list<CommerceOrder>(paidOrders.data?.orders);

  // ---------------------------------------------------------------- Resumo (só o que a conta tem)
  const cards: SummaryCardProps[] = [];
  const loadingOr = <T,>(swr: { data?: T; error?: unknown; isLoading: boolean; mutate: () => unknown }) =>
    swr.error ? ({ kind: "error", onRetry: () => void swr.mutate() } as const) : !swr.data ? ({ kind: "loading" } as const) : undefined;

  if (!ready) {
    for (const id of ["a", "b", "c", "d"]) cards.push({ id: `loading-${id}`, module: "conversations", label: "Carregando…", href: "", state: { kind: "loading" } });
  }
  if (conversationsAccess === "no_permission") cards.push({ id: "conversations-waiting", module: "conversations", label: "Aguardando resposta", href: "/conversas", state: { kind: "no_permission" } });
  if (conversationsAccess === "visible") {
    if (inboxStatus && !inboxStatus.enabled) {
      cards.push({ id: "conversations-waiting", module: "conversations", label: "Aguardando resposta", href: "/conversas", state: { kind: "unavailable", message: "O atendimento ainda não está ativo nesta conta." } });
    } else if (connections.data && !hasConnectedChannel) {
      cards.push({ id: "conversations-waiting", module: "conversations", label: "Aguardando resposta", href: "/conversas", state: { kind: "setup", message: (connectionList.length ? "Seu canal de atendimento está desconectado." : "Você ainda não conectou um canal de atendimento."), actionLabel: can("inbox:manage_connections") ? "Conectar canal" : undefined, actionHref: "/conversas" } });
    } else {
      const pending = !inboxStatus ? ({ kind: "loading" } as const) : loadingOr(dashboard);
      if (pending) cards.push({ id: "conversations-waiting", module: "conversations", label: "Aguardando resposta", href: "/conversas", state: pending });
      else if (!attendance) cards.push({ id: "conversations-waiting", module: "conversations", label: "Aguardando resposta", href: "/conversas", state: { kind: "unavailable", message: "Indicador de atendimento indisponível para o seu perfil." } });
      else {
        const waiting = attendance.backlog.awaitingFirstResponse + attendance.backlog.awaitingAgent;
        const breached = attendance.sla.configured ? attendance.sla.openBreached : 0;
        cards.push({
          id: "conversations-waiting",
          module: "conversations",
          label: "Aguardando resposta",
          href: "/conversas",
          state: { kind: "value", value: waiting, hint: breached > 0 ? `${breached} com prazo vencido` : waiting === 0 ? "Ninguém esperando agora" : `${attendance.backlog.awaitingFirstResponse} sem primeira resposta`, tone: breached > 0 ? "critical" : waiting > 0 ? "attention" : undefined },
        });
        if (attendance.backlog.total > 0) cards.push({ id: "conversations-active", module: "conversations", label: "Em atendimento", href: "/kanban", state: { kind: "value", value: attendance.backlog.total, hint: attendance.backlog.queue > 0 ? `${attendance.backlog.queue} na fila sem atendente` : "Todos com atendente" } });
      }
    }
  }
  if (salesAccess === "no_permission") cards.push({ id: "sales-open", module: "sales", label: "Oportunidades abertas", href: "/deals", state: { kind: "no_permission" } });
  if (salesAccess === "visible") {
    const pending = loadingOr(dashboard);
    cards.push({
      id: "sales-open",
      module: "sales",
      label: "Oportunidades abertas",
      href: "/deals",
      state: pending ?? (commercial ? { kind: "value", value: commercial.open.count, hint: commercial.open.count ? `${formatCurrencyCents(commercial.open.valueCents)} em negociação` : "Nenhuma em negociação" } : { kind: "unavailable", message: "Indicador comercial indisponível para o seu perfil." }),
    });
  }
  if (tasksOn) {
    const pending = loadingOr(tasks);
    const overdue = taskList.filter((task) => isTaskOverdue(task, now)).length;
    cards.push({ id: "sales-tasks", module: "sales", label: "Tarefas atrasadas", href: "/tasks?visao=atrasadas", state: pending ?? { kind: "value", value: overdue, hint: `${taskList.length} pendente(s) no total`, tone: overdue > 0 ? "critical" : undefined } });
  }
  if (marketingAccess === "no_permission") cards.push({ id: "marketing-scheduled", module: "marketing", label: "Publicações agendadas", href: "/calendar", state: { kind: "no_permission" } });
  if (marketingAccess === "visible") {
    const pending = loadingOr(posts);
    const scheduled = scheduledPosts(postList, now);
    const awaiting = postsAwaitingApproval(postList);
    cards.push({
      id: "marketing-scheduled",
      module: "marketing",
      label: "Publicações agendadas",
      href: "/calendar",
      state: pending ?? (scheduled.length ? { kind: "value", value: scheduled.length, hint: `Próxima ${relativeTime(scheduled[0]!.scheduledAt, now)} · 30 dias` } : { kind: "setup", message: "Seu calendário de publicações está vazio.", ...(can("marketing:social_publish") || can("marketing:social_schedule") ? { actionLabel: "Agendar publicação", actionHref: "/social/compose" } : {}) }),
    });
    if (!pending && awaiting > 0) cards.push({ id: "marketing-approval", module: "marketing", label: "Aguardando aprovação", href: "/calendar", state: { kind: "value", value: awaiting, hint: "Publicações para revisar", tone: "attention" } });
  }
  if (meetingsAccess === "no_permission") cards.push({ id: "meetings-upcoming", module: "meetings", label: "Próximas reuniões", href: "/meetings/central", state: { kind: "no_permission" } });
  if (meetingsAccess === "visible") {
    const pending = loadingOr(meetings);
    const upcoming = upcomingMeetings(meetingList, now);
    cards.push({
      id: "meetings-upcoming",
      module: "meetings",
      label: "Próximas reuniões",
      href: "/meetings/agenda",
      state: pending ?? (upcoming.length ? { kind: "value", value: upcoming.length, hint: `${upcoming[0]!.title} · ${relativeTime(upcoming[0]!.scheduledStartAt, now)}` } : { kind: "setup", message: "Você ainda não possui reuniões agendadas.", ...(can("meeting:create") ? { actionLabel: "Agendar reunião", actionHref: "/meetings/agenda" } : {}) }),
    });
  }
  if (siteAccess === "no_permission") cards.push({ id: "site-orders", module: "site", label: "Pedidos do site", href: "/site/pedidos", state: { kind: "no_permission" } });
  if (siteAccess === "visible") {
    const pending = loadingOr(recentOrders);
    const toPrepare = count(paidOrders.data?.total) ?? 0;
    cards.push({
      id: "site-orders",
      module: "site",
      label: "Pedidos (7 dias)",
      href: "/site/pedidos",
      state: pending ?? (recentOrderTotal === undefined ? { kind: "unavailable", message: "Indicador de pedidos indisponível no momento." } : { kind: "value", value: recentOrderTotal, hint: toPrepare > 0 ? `${toPrepare} pago(s) aguardando preparação` : recentOrderTotal ? "Nenhum aguardando preparação" : "Nenhum pedido nos últimos 7 dias", tone: toPrepare > 0 ? "attention" : undefined }),
    });
  }

  // ---------------------------------------------------------------- Precisa da sua atenção
  const attention: AttentionItem[] = sortAttention([
    ...(inboxOn ? conversationAttention({ conversations: unreadList, connections: connectionList, attendance }) : []),
    ...salesAttention({ tasks: tasksOn ? taskList : undefined, proposalsViewed: proposalsOn ? list<Proposal>(proposalsViewed.data) : undefined, suggestions: salesOn ? list<CommercialSuggestion>(suggestions.data) : undefined, dealsWithoutNextAction: salesOn ? count(metrics.data?.dealsWithoutNextActionCount) : undefined, now }),
    ...(marketingAccess === "visible" ? socialAttention(postList) : []),
    ...(meetingsAccess === "visible" ? meetingsAttention(meetingList, now) : []),
    ...(siteAccess === "visible" ? ordersAttention(paidOrderList) : []),
  ]);
  const issues: ModuleLoadIssue[] = [];
  const retry = (...swrs: { mutate: () => unknown }[]) => () => swrs.forEach((swr) => void swr.mutate());
  if (inboxOn && (unread.error || connections.error)) issues.push({ module: "conversations", onRetry: retry(unread, connections) });
  if ((tasksOn && tasks.error) || (proposalsOn && proposalsViewed.error) || (salesOn && (suggestions.error || metrics.error))) issues.push({ module: "sales", onRetry: retry(tasks, proposalsViewed, suggestions, metrics) });
  if (marketingAccess === "visible" && posts.error) issues.push({ module: "marketing", onRetry: retry(posts) });
  if (meetingsAccess === "visible" && meetings.error) issues.push({ module: "meetings", onRetry: retry(meetings) });
  if (siteAccess === "visible" && paidOrders.error) issues.push({ module: "site", onRetry: retry(paidOrders) });
  const attentionLoading =
    !ready ||
    (inboxOn && (unread.isLoading || connections.isLoading)) ||
    (tasksOn && tasks.isLoading) ||
    (salesOn && (suggestions.isLoading || metrics.isLoading)) ||
    (marketingAccess === "visible" && posts.isLoading) ||
    (meetingsAccess === "visible" && meetings.isLoading) ||
    (siteAccess === "visible" && paidOrders.isLoading);

  const [busyId, setBusyId] = useState<string | undefined>();
  async function handleAction(kind: "complete_task" | "accept_suggestion" | "dismiss_suggestion", id: string) {
    setBusyId(id);
    try {
      if (kind === "complete_task") {
        await completeTask(id, workspace.id);
        toast.success("Tarefa concluída.");
      } else if (kind === "accept_suggestion") {
        await acceptCommercialSuggestion(id, workspace.id);
        toast.success("Sugestão aplicada.");
      } else {
        await dismissCommercialSuggestion(id, workspace.id);
      }
      await Promise.all([tasks.mutate(), suggestions.mutate(), metrics.mutate()]);
    } catch (cause) {
      toast.error("Não foi possível concluir a ação", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusyId(undefined);
    }
  }

  // ---------------------------------------------------------------- Atividade recente
  const activity = buildActivity({
    posts: marketingAccess === "visible" ? postList : undefined,
    meetings: meetingsAccess === "visible" ? meetingList : undefined,
    orders: siteAccess === "visible" ? recentOrderList : undefined,
    proposalsAccepted: proposalsOn ? list<Proposal>(proposalsAccepted.data) : undefined,
    now,
  });
  const activityLoading = !ready || (marketingAccess === "visible" && posts.isLoading) || (meetingsAccess === "visible" && meetings.isLoading) || (siteAccess === "visible" && recentOrders.isLoading) || (proposalsOn && proposalsAccepted.isLoading);
  const hasActivitySource = marketingAccess === "visible" || meetingsAccess === "visible" || siteAccess === "visible" || proposalsOn;

  const firstName = state.status === "authenticated" ? state.user.name.split(" ")[0] : undefined;
  const create = ready ? createOptions(available, can) : [];
  const links = ready ? quickLinks(available, can) : [];

  return (
    <main className="mx-auto w-full max-w-[1280px] px-3 py-4 sm:px-6 sm:py-6" data-testid="workspace-home">
      <header className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{todayLabel(now)}</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {greetingFor(now)}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">Panorama de <span className="font-medium text-foreground">{workspace.name}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT))}
            data-testid="home-notifications"
            aria-label={notificationCount ? `${notificationCount} notificações` : "Notificações"}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border/70 bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
          >
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span>Notificações</span>
            {notificationCount ? <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground dark:bg-primary-glow dark:text-background">{notificationCount > 99 ? "99+" : notificationCount}</span> : null}
          </button>
          <CreateMenu base={base} options={create} />
        </div>
      </header>

      {hasConversations ? <OnboardingChecklist workspaceId={workspace.id} completedSteps={onboarding?.completedSteps ?? []} status={onboarding?.status} loading={onboardingLoading} /> : null}

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="home-summary" className="order-2 min-w-0 lg:order-1 lg:col-span-2" data-testid="home-summary">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 id="home-summary" className="text-[15px] font-semibold text-foreground">Resumo de hoje</h2>
            {companyAvailable ? (
              <div role="group" aria-label="Recorte dos indicadores" className="flex rounded-lg border border-border/70 bg-card p-0.5 text-xs">
                {[{ value: "company", label: "Empresa" }, { value: "me", label: "Só eu" }].map((option) => (
                  <button key={option.value} type="button" aria-pressed={viewing === option.value} onClick={() => setScope(option.value)} className={cn("min-h-[32px] rounded-md px-2.5 font-medium transition-colors", viewing === option.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {cards.length ? (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
              {cards.map((card) => <SectionBoundary key={card.id} label={card.label} compact><SummaryCard base={base} card={card} /></SectionBoundary>)}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nenhum indicador disponível para as ferramentas desta conta.</p>
          )}
        </section>

        <HomePanel title="Precisa da sua atenção" description="Pendências de todas as áreas, as mais urgentes primeiro." className="order-1 lg:order-2" testId="home-attention">
          <SectionBoundary label="as pendências"><AttentionList base={base} items={attention} loading={attentionLoading} issues={issues} now={now} busyId={busyId} onAction={(kind, id) => void handleAction(kind, id)} /></SectionBoundary>
        </HomePanel>

        <div className="order-3 flex min-w-0 flex-col gap-4 sm:gap-5">
          <HomePanel title="Acessos rápidos" testId="home-quick-links">
            <QuickLinkGrid base={base} links={links} />
          </HomePanel>
          {hasActivitySource ? (
            <HomePanel title="Atividade recente" description="Últimos 7 dias" testId="home-activity">
              <SectionBoundary label="a atividade recente"><ActivityList base={base} items={activity} loading={activityLoading} now={now} /></SectionBoundary>
            </HomePanel>
          ) : null}
        </div>

        {hasConversations && (inboxOn || salesOn) ? (
          <div className="order-4 min-w-0 lg:col-span-2">
            <DetailedIndicators workspaceId={workspace.id} inboxEnabled={inboxOn} />
          </div>
        ) : null}
      </div>
    </main>
  );
}

/** Indicadores completos de atendimento, SLA, CSAT, comercial e metas (o painel que antes ocupava o
 * Início). Fechado por padrão: só consulta quando a pessoa abre. */
function DetailedIndicators({ workspaceId, inboxEnabled }: { workspaceId: string; inboxEnabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-2xl border border-border/70 bg-card shadow-sm">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left sm:px-5" data-testid="home-detailed-toggle">
          <span>
            <span className="block text-[15px] font-semibold text-foreground">Indicadores de atendimento e vendas</span>
            <span className="block text-xs text-muted-foreground">Tempo de resposta, SLA, satisfação, funil e metas por período</span>
          </span>
          <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/70 p-3 sm:p-5">{open ? <SectionBoundary label="os indicadores detalhados"><DashboardView workspaceId={workspaceId} inboxEnabled={inboxEnabled} /></SectionBoundary> : null}</CollapsibleContent>
    </Collapsible>
  );
}

function OnboardingChecklist({ workspaceId, completedSteps, status, loading }: { workspaceId: string; completedSteps: readonly OnboardingStep[]; status: string | undefined; loading: boolean }) {
  const router = useRouter();
  if (loading || status === "completed") return null;
  const done = CHECKLIST_ITEMS.filter((item) => completedSteps.includes(item.step)).length;
  if (done === CHECKLIST_ITEMS.length) return null;
  return (
    <section className="mb-4 rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-sm sm:mb-5" data-testid="home-onboarding">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Configuração inicial · {done} de {CHECKLIST_ITEMS.length}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {CHECKLIST_ITEMS.map((item) => {
              const isDone = completedSteps.includes(item.step);
              return (
                <span key={item.step} className={`inline-flex items-center gap-1.5 text-xs ${isDone ? "text-foreground" : "text-muted-foreground"}`}>
                  {isDone ? <CheckCircle2 className="h-3.5 w-3.5 text-status-active" /> : <Circle className="h-3.5 w-3.5" />}
                  {item.label}
                </span>
              );
            })}
          </div>
        </div>
        <Button variant="secondary" onClick={() => router.push(`/workspaces/${workspaceId}/onboarding`)}>Continuar</Button>
      </div>
    </section>
  );
}
