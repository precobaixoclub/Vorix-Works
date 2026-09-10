"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Check, Clock3, MoreHorizontal, Search, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { StatusBadge } from "@/components/StatusBadge";
import { TeamPicker, teamLabel } from "@/components/TeamPicker";
import { UserPicker, type UserPickerMember, userLabel } from "@/components/UserPicker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { cancelTask, completeTask, createTask } from "@/features/crm/api";
import { useContacts, useDeals, useTasks } from "@/features/crm/hooks";
import { isTaskOverdue, isTaskToday, isTaskUpcoming, TASK_STATUS_LABEL, TASK_TYPE_LABEL } from "@/features/crm/presentation";
import type { Contact, Deal, Task, TaskStatus, TaskType } from "@/features/crm/types";
import { useTeams } from "@/features/identity/hooks";
import type { Team } from "@/features/identity/types";
import { useInboxMembers } from "@/features/inbox/hooks";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type TaskView = "today" | "overdue" | "upcoming" | "done" | "cancelled";

const VIEW_LABEL: Record<TaskView, string> = {
  today: "Hoje",
  overdue: "Atrasadas",
  upcoming: "Próximas",
  done: "Concluídas",
  cancelled: "Canceladas",
};

const TASK_TYPES = Object.keys(TASK_TYPE_LABEL) as TaskType[];

export default function TasksPage() {
  return (
    <Suspense fallback={<TasksFallback />}>
      <TasksView />
    </Suspense>
  );
}

function TasksFallback() {
  return (
    <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-8">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-4 h-14 rounded-xl" />
      <div className="mt-5"><TaskListSkeleton /></div>
    </main>
  );
}

function TasksView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspace = useCurrentWorkspace();
  const [view, setView] = useState<TaskView>("today");
  const [search, setSearch] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [contactFilter, setContactFilter] = useState("");
  const [dealFilter, setDealFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const statusParam: TaskStatus = view === "done" ? "done" : view === "cancelled" ? "cancelled" : "pending";

  const { data: tasks, error, isLoading, mutate } = useTasks(workspace.id, { status: statusParam, ownerUserId: ownerUserId || undefined });
  const { data: contacts } = useContacts(workspace.id);
  const { data: deals } = useDeals(workspace.id);
  const { data: membersData } = useInboxMembers(workspace.id);
  const { data: teams } = useTeams(workspace.id);

  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType] = useState<TaskType>("follow_up");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [createContactId, setCreateContactId] = useState(searchParams.get("contactId") ?? "");
  const [createDealId, setCreateDealId] = useState(searchParams.get("dealId") ?? "");
  const [createOwnerUserId, setCreateOwnerUserId] = useState("");
  const [createTeamId, setCreateTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState<string | undefined>();
  const [pendingCancel, setPendingCancel] = useState<Task | undefined>();

  const contactsList = contacts ?? [];
  const dealsList = deals ?? [];
  const members = membersData?.members ?? [];
  const teamsList = teams ?? [];
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    const queryContactId = searchParams.get("contactId");
    const queryDealId = searchParams.get("dealId");
    if (queryContactId || queryDealId) {
      setCreateContactId(queryContactId ?? "");
      setCreateDealId(queryDealId ?? "");
      setCreateOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const deal = dealsList.find((item) => item.id === createDealId);
    if (deal?.contactId && !createContactId) setCreateContactId(deal.contactId);
  }, [createContactId, createDealId, dealsList]);

  const filteredTasks = useMemo(() => {
    return (tasks ?? [])
      .filter((task) => {
        if (view === "today") return isTaskToday(task, now);
        if (view === "overdue") return isTaskOverdue(task, now);
        if (view === "upcoming") return isTaskUpcoming(task, now);
        return true;
      })
      .filter((task) => !contactFilter || task.contactId === contactFilter)
      .filter((task) => !dealFilter || task.dealId === dealFilter)
      .filter((task) => !teamFilter || task.teamId === teamFilter)
      .filter((task) => !typeFilter || task.type === typeFilter)
      .filter((task) => {
        const haystack = `${task.title} ${task.description ?? ""} ${contactName(task.contactId, contactsList)} ${dealName(task.dealId, dealsList)}`.toLowerCase();
        return !debouncedSearch || haystack.includes(debouncedSearch.toLowerCase());
      });
  }, [contactFilter, contactsList, dealFilter, dealsList, debouncedSearch, now, tasks, teamFilter, typeFilter, view]);

  const viewCounts = useMemo(() => {
    const pendingTasks = statusParam === "pending" ? tasks ?? [] : [];
    return {
      today: pendingTasks.filter((task) => isTaskToday(task, now)).length,
      overdue: pendingTasks.filter((task) => isTaskOverdue(task, now)).length,
      upcoming: pendingTasks.filter((task) => isTaskUpcoming(task, now)).length,
    };
  }, [now, statusParam, tasks]);

  async function handleCreate() {
    setBusy(true);
    try {
      await createTask({
        workspaceId: workspace.id,
        contactId: createContactId || undefined,
        dealId: createDealId || undefined,
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        dueAt: dueAt || undefined,
        ownerUserId: createOwnerUserId || undefined,
        teamId: createTeamId || undefined,
      });
      setCreateOpen(false);
      resetCreateForm();
      await mutate();
      toast.success("Tarefa criada.");
    } catch (cause) {
      toast.error("Não foi possível criar a tarefa", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  async function handleComplete(task: Task) {
    const previous = tasks;
    setActingId(task.id);
    await mutate((current) => current?.map((item) => item.id === task.id ? { ...item, status: "done" as const, completedAt: new Date().toISOString() } : item), { revalidate: false });
    try {
      await completeTask(task.id, workspace.id);
      await mutate();
      toast.success("Tarefa concluída.");
    } catch (cause) {
      await mutate(previous, { revalidate: false });
      toast.error("Não foi possível concluir", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setActingId(undefined);
    }
  }

  async function handleCancel() {
    if (!pendingCancel) return;
    const task = pendingCancel;
    setActingId(task.id);
    try {
      await cancelTask(task.id, workspace.id);
      setPendingCancel(undefined);
      await mutate();
      toast.success("Tarefa cancelada.");
    } catch (cause) {
      toast.error("Não foi possível cancelar", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setActingId(undefined);
    }
  }

  function resetCreateForm() {
    setType("follow_up");
    setTitle("");
    setDescription("");
    setDueAt("");
    setCreateContactId("");
    setCreateDealId("");
    setCreateOwnerUserId("");
    setCreateTeamId("");
  }

  const contactOptions = contactsList.map((contact) => ({ id: contact.id, label: contact.company ? `${contact.name} · ${contact.company}` : contact.name }));
  const dealOptions = dealsList.map((deal) => ({ id: deal.id, label: deal.title }));

  return (
    <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tarefas</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Central de execução comercial: hoje, atrasadas, próximas e concluídas.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Nova tarefa</Button>
      </div>

      <FilterBar summary={`${filteredTasks.length} tarefas`}>
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-muted/40 p-1">
          {(["today", "overdue", "upcoming", "done"] as TaskView[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setView(item)}
              className={cn("h-9 shrink-0 rounded-lg px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", view === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {VIEW_LABEL[item]}
              {item in viewCounts ? <span className="ml-1 text-xs tabular-nums text-muted-foreground">{viewCounts[item as keyof typeof viewCounts]}</span> : null}
            </button>
          ))}
        </div>
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tarefa" className="pl-9" />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary"><SlidersHorizontal className="mr-2 h-4 w-4" /> Filtros</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(380px,calc(100vw-2rem))] space-y-3">
            <div>
              <Label>Responsável</Label>
              <UserPicker workspaceId={workspace.id} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "", label: "Todos" }} />
            </div>
            <div>
              <Label>Equipe</Label>
              <TeamPicker workspaceId={workspace.id} value={teamFilter} onValueChange={setTeamFilter} extraOption={{ value: "", label: "Todas" }} />
            </div>
            <div>
              <Label>Contato</Label>
              <SearchableCombo items={contactOptions} value={contactFilter} onValueChange={setContactFilter} placeholder="Contato" extraOption={{ value: "", label: "Todos" }} />
            </div>
            <div>
              <Label>Negócio</Label>
              <SearchableCombo items={dealOptions} value={dealFilter} onValueChange={setDealFilter} placeholder="Negócio" extraOption={{ value: "", label: "Todos" }} />
            </div>
            <div>
              <Label htmlFor="task-type-filter">Tipo</Label>
              <Select value={typeFilter || "all"} onValueChange={(value) => setTypeFilter(value === "all" ? "" : value)}>
                <SelectTrigger id="task-type-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {TASK_TYPES.map((taskType) => <SelectItem key={taskType} value={taskType}>{TASK_TYPE_LABEL[taskType]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>
      </FilterBar>

      {isLoading ? <TaskListSkeleton /> : null}
      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
      {!isLoading && !error && filteredTasks.length === 0 ? (
        <EmptyState
          title="Nenhuma tarefa nesta visao"
          description={view === "overdue" ? "Nada atrasado. Bom sinal." : "Crie uma tarefa vinculada a um contato ou negócio para manter a cadência comercial."}
          action={<Button onClick={() => setCreateOpen(true)}>Criar tarefa</Button>}
        />
      ) : null}

      {!isLoading && !error && filteredTasks.length > 0 ? (
        <section className="space-y-2">
          {filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              contact={contactsList.find((contact) => contact.id === task.contactId)}
              deal={dealsList.find((deal) => deal.id === task.dealId)}
              members={members}
              teams={teamsList}
              acting={actingId === task.id}
              onComplete={() => handleComplete(task)}
              onCancel={() => setPendingCancel(task)}
              onOpenContact={(contactId) => router.push(`/workspaces/${workspace.id}/contacts?contactId=${contactId}`)}
              onOpenDeal={(dealId) => router.push(`/workspaces/${workspace.id}/deals?dealId=${dealId}`)}
            />
          ))}
        </section>
      ) : null}

      {createOpen ? (
        <Modal title="Nova tarefa" onClose={() => { setCreateOpen(false); resetCreateForm(); }} maxWidthClass="sm:max-w-2xl">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="task-type">Tipo</Label>
              <Select value={type} onValueChange={(value) => setType(value as TaskType)}>
                <SelectTrigger id="task-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((taskType) => <SelectItem key={taskType} value={taskType}>{TASK_TYPE_LABEL[taskType]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="task-due">Prazo</Label>
              <Input id="task-due" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="task-title">Titulo</Label>
              <Input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Fazer follow-up da proposta" />
            </div>
            <div>
              <Label>Contato</Label>
              <SearchableCombo items={contactOptions} value={createContactId} onValueChange={setCreateContactId} placeholder="Contato" extraOption={{ value: "", label: "Sem contato" }} />
            </div>
            <div>
              <Label>Negócio</Label>
              <SearchableCombo items={dealOptions} value={createDealId} onValueChange={setCreateDealId} placeholder="Negócio" extraOption={{ value: "", label: "Sem negócio" }} />
            </div>
            <div className="sm:col-span-2">
              <Label>Responsável</Label>
              <UserPicker workspaceId={workspace.id} value={createOwnerUserId} onValueChange={setCreateOwnerUserId} extraOption={{ value: "", label: "Sem responsável" }} />
            </div>
            <div className="sm:col-span-2">
              <Label>Equipe</Label>
              <TeamPicker workspaceId={workspace.id} value={createTeamId} onValueChange={setCreateTeamId} extraOption={{ value: "", label: "Sem equipe" }} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="task-description">Descricao</Label>
              <Textarea id="task-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setCreateOpen(false); resetCreateForm(); }} disabled={busy}>Cancelar</Button>
            <Button onClick={handleCreate} loading={busy} disabled={!title.trim() || busy}>Criar</Button>
          </div>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingCancel)}
        title="Cancelar tarefa?"
        description={`"${pendingCancel?.title ?? "Tarefa"}" sera marcada como cancelada e sai da fila de execução.`}
        confirmLabel="Cancelar tarefa"
        variant="danger"
        busy={Boolean(actingId)}
        onCancel={() => setPendingCancel(undefined)}
        onConfirm={handleCancel}
      />
    </main>
  );
}

function TaskRow({
  task,
  contact,
  deal,
  members,
  teams,
  acting,
  onComplete,
  onCancel,
  onOpenContact,
  onOpenDeal,
}: {
  task: Task;
  contact: Contact | undefined;
  deal: Deal | undefined;
  members: readonly UserPickerMember[];
  teams: readonly Team[];
  acting: boolean;
  onComplete: () => void;
  onCancel: () => void;
  onOpenContact: (contactId: string) => void;
  onOpenDeal: (dealId: string) => void;
}) {
  const overdue = isTaskOverdue(task);
  return (
    <article className={cn("rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm", overdue && "border-destructive/30 bg-destructive/5")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <span className="text-xs text-muted-foreground">{TASK_TYPE_LABEL[task.type]}</span>
          </div>
          <h2 className="mt-2 text-sm font-semibold text-foreground">{task.title}</h2>
          {task.description ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p> : null}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}>
              <Clock3 className="h-3.5 w-3.5" />
              {task.dueAt ? `${formatDateTime(task.dueAt)} · ${formatRelativeTime(task.dueAt)}` : "Sem prazo"}
            </span>
            <span>{userLabel(task.ownerUserId, members)}</span>
            <span>{teamLabel(task.teamId, teams)}</span>
            <span>{TASK_STATUS_LABEL[task.status]}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {contact ? <Button variant="ghost" size="sm" onClick={() => onOpenContact(contact.id)}>{contact.name}</Button> : null}
            {deal ? <Button variant="ghost" size="sm" onClick={() => onOpenDeal(deal.id)}>{deal.title}</Button> : null}
          </div>
        </div>
        {task.status === "pending" ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" loading={acting} disabled={acting} onClick={onComplete}>
              <Check className="mr-2 h-4 w-4" /> Concluir
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Ações da tarefa">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-2">
                <Button variant="ghost" className="w-full justify-start text-destructive hover:text-destructive" onClick={onCancel}>Cancelar tarefa</Button>
              </PopoverContent>
            </Popover>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function TaskListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="rounded-2xl border border-border/70 bg-card p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-5 w-2/5" />
          <Skeleton className="mt-2 h-4 w-3/5" />
        </div>
      ))}
    </div>
  );
}

function contactName(contactId: string | undefined, contacts: readonly Contact[]): string {
  if (!contactId) return "";
  return contacts.find((contact) => contact.id === contactId)?.name ?? "";
}

function dealName(dealId: string | undefined, deals: readonly Deal[]): string {
  if (!dealId) return "";
  return deals.find((deal) => deal.id === dealId)?.title ?? "";
}
