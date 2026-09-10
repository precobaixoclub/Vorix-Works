"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Circle, MessageSquareText, Plus, Rocket, UsersRound, WalletCards } from "lucide-react";
import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useCommercialMetrics, useTasks } from "@/features/crm/hooks";
import { useInboxMetrics } from "@/features/inbox/hooks";
import { useOnboarding } from "@/features/onboarding/hooks";
import type { OnboardingStep } from "@/features/onboarding/types";
import { useUnifiedPublications } from "@/features/publication-history/hooks";
import { derivePublicationStatus } from "@/features/publication-history/types";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { VorixIntelligencePanel } from "./vorix-intelligence-panel";

const CHECKLIST_ITEMS: ReadonlyArray<{ step: OnboardingStep; label: string }> = [
  { step: "company", label: "Empresa" },
  { step: "commercial", label: "Comercial" },
  { step: "team", label: "Equipe" },
  { step: "channel", label: "Canal" },
  { step: "brand", label: "Marca" },
];

const ACTIVATION_ITEMS: ReadonlyArray<{ step: OnboardingStep; title: string; description: string; route: string; icon: typeof Rocket }> = [
  { step: "channel", title: "Conectar canal", description: "Ative o primeiro WhatsApp de atendimento.", route: "conversas?tab=connections", icon: MessageSquareText },
  { step: "team", title: "Convidar equipe", description: "Traga quem vai operar vendas e atendimento.", route: "settings/users", icon: UsersRound },
  { step: "commercial", title: "Criar primeiro negócio", description: "Abra a primeira oportunidade comercial.", route: "deals", icon: WalletCards },
  { step: "brand", title: "Criar primeiro conteúdo", description: "Prepare a base de marketing do workspace.", route: "create", icon: Rocket },
];

export default function WorkspaceHomePage() {
  const router = useRouter();
  const workspace = useCurrentWorkspace();
  const { state } = useAuth();
  const { data: inboxMetrics, isLoading: inboxLoading, error: inboxError, mutate: mutateInbox } = useInboxMetrics(workspace.id);
  const { data: commercialMetrics, isLoading: commercialLoading, error: commercialError, mutate: mutateCommercial } = useCommercialMetrics(workspace.id);
  const { data: tasks, isLoading: tasksLoading, error: tasksError, mutate: mutateTasks } = useTasks(workspace.id, { status: "pending" });
  const { data: publications, isLoading: publicationsLoading, error: publicationsError, mutate: mutatePublications } = useUnifiedPublications(workspace.id);
  const { data: onboarding, isLoading: onboardingLoading } = useOnboarding(workspace.id);

  const now = useMemo(() => new Date(), []);
  const overdueTasks = (tasks ?? []).filter((task) => task.dueAt && new Date(task.dueAt) < now);
  const scheduledPublications = (publications ?? []).filter((post) => derivePublicationStatus(post) === "scheduled");
  const loading = inboxLoading || commercialLoading || tasksLoading || publicationsLoading;
  const error = inboxError || commercialError || tasksError || publicationsError;
  const isFreshWorkspace = !loading && !error && (inboxMetrics?.backlogCount ?? 0) === 0 && (commercialMetrics?.openPipelineValueCents ?? 0) === 0 && overdueTasks.length === 0 && scheduledPublications.length === 0;

  const userName = state.status === "authenticated" ? state.user.name.split(" ")[0] : undefined;
  const greeting = `${greetingForHour(now)}, ${userName || "time"}.`;

  const kpis = [
    {
      label: "Conversas aguardando",
      value: inboxMetrics ? String(inboxMetrics.backlogCount) : undefined,
      hint: inboxMetrics ? `${inboxMetrics.openCount} abertas · ${inboxMetrics.pendingCount} pendentes` : undefined,
      route: `/workspaces/${workspace.id}/conversas`,
      icon: MessageSquareText,
      tone: (inboxMetrics?.backlogCount ?? 0) > 0 ? "attention" as const : "default" as const,
    },
    {
      label: "Pipeline comercial",
      value: commercialMetrics ? formatCurrencyCents(commercialMetrics.openPipelineValueCents) : undefined,
      hint: commercialMetrics ? `${commercialMetrics.dealsCreatedCount} negócios no período` : undefined,
      route: `/workspaces/${workspace.id}/deals`,
      icon: WalletCards,
      tone: "default" as const,
    },
    {
      label: "Tarefas atrasadas",
      value: tasks ? String(overdueTasks.length) : undefined,
      hint: tasks ? `${tasks.length} tarefas pendentes` : undefined,
      route: `/workspaces/${workspace.id}/tasks`,
      icon: CheckCircle2,
      tone: overdueTasks.length > 0 ? "critical" as const : "default" as const,
    },
    {
      label: "Conteúdos agendados",
      value: publications ? String(scheduledPublications.length) : undefined,
      hint: publications ? "Próximas publicações programadas" : undefined,
      route: `/workspaces/${workspace.id}/calendar`,
      icon: CalendarClock,
      tone: "default" as const,
    },
  ];

  return (
    <main className="mx-auto max-w-[1500px] px-3 py-5 sm:px-6 sm:py-8">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={workspace.status} />
            <span className="text-xs text-muted-foreground">Workspace criado em {formatDate(workspace.createdAt)}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{greeting}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Aqui está o que precisa da sua atenção hoje em {workspace.name}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => router.push(`/workspaces/${workspace.id}/conversas`)}>Abrir conversas</Button>
          <Button onClick={() => router.push(`/workspaces/${workspace.id}/create`)}>
            <Plus className="mr-2 h-4 w-4" /> Criar conteúdo
          </Button>
        </div>
      </header>

      <OnboardingChecklist workspaceId={workspace.id} completedSteps={onboarding?.completedSteps ?? []} status={onboarding?.status} loading={onboardingLoading} />

      {error ? (
        <div className="mb-5">
          <ErrorState error={error} onRetry={() => { void Promise.all([mutateInbox(), mutateCommercial(), mutateTasks(), mutatePublications()]); }} />
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <button
            key={kpi.label}
            type="button"
            onClick={() => router.push(kpi.route)}
            className={cn(
              "group min-w-0 rounded-2xl border border-border/70 bg-card px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              kpi.tone === "critical" && "border-destructive/30 bg-destructive/5",
              kpi.tone === "attention" && "border-warning/40 bg-warning/5",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{kpi.label}</span>
              <kpi.icon className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
            </div>
            {loading ? <Skeleton className="mt-3 h-8 w-24" /> : <p className="mt-3 truncate text-2xl font-semibold tabular-nums text-foreground">{kpi.value ?? "—"}</p>}
            {loading ? <Skeleton className="mt-2 h-3 w-32" /> : <p className="mt-1 truncate text-xs text-muted-foreground">{kpi.hint ?? "Sem dado disponivel"}</p>}
          </button>
        ))}
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <VorixIntelligencePanel workspaceId={workspace.id} />
        <QuickActions workspaceId={workspace.id} />
      </div>

      {isFreshWorkspace ? <ActivationPanel workspaceId={workspace.id} completedSteps={onboarding?.completedSteps ?? []} /> : null}
    </main>
  );
}

function OnboardingChecklist({
  workspaceId,
  completedSteps,
  status,
  loading,
}: {
  workspaceId: string;
  completedSteps: readonly OnboardingStep[];
  status: string | undefined;
  loading: boolean;
}) {
  const router = useRouter();
  if (loading || status === "completed") return null;
  const done = CHECKLIST_ITEMS.filter((item) => completedSteps.includes(item.step)).length;
  if (done === CHECKLIST_ITEMS.length) return null;

  return (
    <section className="mb-5 rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-sm">
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

function QuickActions({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const actions = [
    { label: "Criar conteúdo", route: "create" },
    { label: "Abrir Conversas", route: "conversas" },
    { label: "Novo negócio", route: "deals" },
    { label: "Publicar", route: "publish" },
  ];
  return (
    <section className="rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">Ações rapidas</h2>
      <div className="mt-3 grid gap-2">
        {actions.map((action) => (
          <button
            key={action.route}
            type="button"
            onClick={() => router.push(`/workspaces/${workspaceId}/${action.route}`)}
            className="flex min-h-11 items-center justify-between rounded-xl border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action.label}
            <span className="text-muted-foreground">→</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ActivationPanel({ workspaceId, completedSteps }: { workspaceId: string; completedSteps: readonly OnboardingStep[] }) {
  const router = useRouter();
  const actions = ACTIVATION_ITEMS.filter((item) => !completedSteps.includes(item.step)).slice(0, 4);
  if (actions.length === 0) return null;

  return (
    <section className="mt-5 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">Comece por aqui</h2>
        <p className="mt-1 text-xs text-muted-foreground">Seu workspace ainda esta vazio. Complete somente o que falta para ativar a operação.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.step}
              type="button"
              onClick={() => router.push(`/workspaces/${workspaceId}/${action.route}`)}
              className="rounded-xl border border-border/70 bg-card px-3 py-3 text-left transition hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="h-4 w-4 text-primary" />
              <p className="mt-2 text-sm font-medium text-foreground">{action.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{action.description}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function greetingForHour(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}
