"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { BriefcaseBusiness, ClipboardCheck, FileText, History, Info, MessageSquareText, Search, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { DealDetailModal } from "@/components/crm/DealDetailModal";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { TeamPicker, teamLabel } from "@/components/TeamPicker";
import { UserPicker, type UserPickerMember, userLabel } from "@/components/UserPicker";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createContact, linkContactIdentity, moveDealStage, updateContact } from "@/features/crm/api";
import { useContactTimeline, useContacts, useDeals, useLeadScore, usePipelineStages, usePipelines, useProposals, useTasks } from "@/features/crm/hooks";
import { nextPendingTask, PROPOSAL_STATUS_LABEL, TASK_STATUS_LABEL, TASK_TYPE_LABEL, timelineEventLabel } from "@/features/crm/presentation";
import type { Contact, Deal, Proposal, Task } from "@/features/crm/types";
import type { Team } from "@/features/identity/types";
import { useTeams } from "@/features/identity/hooks";
import { useInboxConversations, useInboxMembers } from "@/features/inbox/hooks";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type ContactSection = "summary" | "conversations" | "deals" | "tasks" | "proposals" | "timeline";

export default function ContactsPage() {
  return (
    <Suspense fallback={<ContactsFallback />}>
      <ContactsView />
    </Suspense>
  );
}

function ContactsFallback() {
  return (
    <main className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6 sm:py-8">
      <Skeleton className="h-8 w-36" />
      <Skeleton className="mt-4 h-14 rounded-xl" />
      <div className="mt-5"><ContactGridSkeleton /></div>
    </main>
  );
}

function ContactsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspace = useCurrentWorkspace();
  const [search, setSearch] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [teamId, setTeamId] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data: contacts, error, isLoading, mutate } = useContacts(workspace.id, { search: debouncedSearch || undefined, ownerUserId: ownerUserId || undefined, teamId: teamId || undefined });
  const { data: deals, mutate: mutateDeals } = useDeals(workspace.id);
  const { data: tasks } = useTasks(workspace.id);
  const { data: proposals } = useProposals(workspace.id);
  const { data: conversations } = useInboxConversations(workspace.id);
  const { data: membersData } = useInboxMembers(workspace.id);
  const { data: teams } = useTeams(workspace.id);
  const { data: pipelines } = usePipelines(workspace.id);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [origin, setOrigin] = useState("");
  const [createOwnerUserId, setCreateOwnerUserId] = useState("");
  const [createTeamId, setCreateTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | undefined>();
  const [selectedDealId, setSelectedDealId] = useState<string | undefined>();

  const contactsList = contacts ?? [];
  const dealsList = deals ?? [];
  const tasksList = tasks ?? [];
  const proposalsList = proposals ?? [];
  const conversationsList = conversations?.conversations ?? [];
  const members = membersData?.members ?? [];
  const teamsList = teams ?? [];
  const selectedContact = contactsList.find((contact) => contact.id === selectedContactId);
  const selectedDeal = dealsList.find((deal) => deal.id === selectedDealId);
  const selectedDealPipeline = selectedDeal ? pipelines?.find((pipeline) => pipeline.id === selectedDeal.pipelineId) : undefined;
  const { data: selectedDealStages } = usePipelineStages(selectedDeal?.pipelineId, workspace.id);

  useEffect(() => {
    const queryContactId = searchParams.get("contactId");
    if (queryContactId) setSelectedContactId(queryContactId);
  }, [searchParams]);

  const visibleContacts = contactsList;

  async function handleCreate() {
    setBusy(true);
    try {
      const contact = await createContact({
        workspaceId: workspace.id,
        name: name.trim(),
        company: company.trim() || undefined,
        origin: origin.trim() || undefined,
        ownerUserId: createOwnerUserId || undefined,
        teamId: createTeamId || undefined,
      });
      if (phone.trim()) {
        try {
          await linkContactIdentity(contact.id, workspace.id, "whatsapp", phone.trim());
        } catch (cause) {
          toast.error("Contato criado, mas o WhatsApp não foi vinculado", { description: cause instanceof Error ? cause.message : "Revise o número depois." });
        }
      }
      setCreateOpen(false);
      resetCreateForm();
      await mutate();
      toast.success("Contato criado.");
    } catch (cause) {
      toast.error("Não foi possível criar o contato", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  function resetCreateForm() {
    setName("");
    setCompany("");
    setPhone("");
    setOrigin("");
    setCreateOwnerUserId("");
    setCreateTeamId("");
  }

  async function handleMoveDeal(deal: Deal, stageId: string, lossReason?: string) {
    try {
      await moveDealStage(deal.id, workspace.id, stageId, lossReason);
      await mutateDeals();
      toast.success("Negócio atualizado.");
    } catch (cause) {
      toast.error("Não foi possível mover o negócio", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    }
  }

  return (
    <main className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Contatos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Visao 360 de clientes, canais, oportunidades, tarefas, propostas e historico.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Novo contato</Button>
      </div>

      <FilterBar summary={`${visibleContacts.length} contatos`}>
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar contato ou empresa" className="pl-9" />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <SlidersHorizontal className="mr-2 h-4 w-4" /> Filtros
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(360px,calc(100vw-2rem))] space-y-3">
            <div>
              <Label>Responsável</Label>
              <UserPicker workspaceId={workspace.id} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "", label: "Todos" }} />
            </div>
            <div>
              <Label>Equipe</Label>
              <TeamPicker workspaceId={workspace.id} value={teamId} onValueChange={setTeamId} extraOption={{ value: "", label: "Todas" }} />
            </div>
          </PopoverContent>
        </Popover>
      </FilterBar>

      {isLoading ? <ContactGridSkeleton /> : null}
      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
      {!isLoading && !error && visibleContacts.length === 0 ? (
        <EmptyState
          title="Nenhum contato ainda"
          description={search ? "Nenhum contato encontrado para essa busca." : "Crie seu primeiro contato ou vincule uma conversa do WhatsApp ao CRM."}
          action={<Button onClick={() => setCreateOpen(true)}>Criar contato</Button>}
        />
      ) : null}

      {!isLoading && !error && visibleContacts.length > 0 ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleContacts.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              deals={dealsList.filter((deal) => deal.contactId === contact.id)}
              tasks={tasksList.filter((task) => task.contactId === contact.id)}
              proposals={proposalsList.filter((proposal) => proposal.contactId === contact.id)}
              conversations={conversationsList.filter((conversation) => conversation.crmContactId === contact.id)}
              members={members}
              teams={teamsList}
              onOpen={() => setSelectedContactId(contact.id)}
            />
          ))}
        </section>
      ) : null}

      {createOpen ? (
        <Modal title="Novo contato" onClose={() => { setCreateOpen(false); resetCreateForm(); }} maxWidthClass="sm:max-w-2xl">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="contact-name">Nome</Label>
              <Input id="contact-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome do contato" />
            </div>
            <div>
              <Label htmlFor="contact-company">Empresa</Label>
              <Input id="contact-company" value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Empresa ou marca" />
            </div>
            <div>
              <Label htmlFor="contact-phone">WhatsApp</Label>
              <Input id="contact-phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+55 11 99999-9999" inputMode="tel" />
            </div>
            <div>
              <Label htmlFor="contact-origin">Origem</Label>
              <Input id="contact-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="Ex.: whatsapp, indicacao" />
            </div>
            <div>
              <Label>Responsável</Label>
              <UserPicker workspaceId={workspace.id} value={createOwnerUserId} onValueChange={setCreateOwnerUserId} extraOption={{ value: "", label: "Sem responsável" }} />
            </div>
            <div>
              <Label>Equipe</Label>
              <TeamPicker workspaceId={workspace.id} value={createTeamId} onValueChange={setCreateTeamId} extraOption={{ value: "", label: "Sem equipe" }} />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setCreateOpen(false); resetCreateForm(); }} disabled={busy}>Cancelar</Button>
            <Button onClick={handleCreate} loading={busy} disabled={!name.trim() || busy}>Criar</Button>
          </div>
        </Modal>
      ) : null}

      <ContactDetailModal
        open={Boolean(selectedContact)}
        onOpenChange={(open) => { if (!open) setSelectedContactId(undefined); }}
        workspaceId={workspace.id}
        contact={selectedContact}
        deals={dealsList.filter((deal) => deal.contactId === selectedContact?.id)}
        tasks={tasksList.filter((task) => task.contactId === selectedContact?.id)}
        proposals={proposalsList.filter((proposal) => proposal.contactId === selectedContact?.id)}
        conversations={conversationsList.filter((conversation) => conversation.crmContactId === selectedContact?.id)}
        members={members}
        teams={teamsList}
        onChanged={async () => { await mutate(); }}
        onOpenDeal={(dealId) => {
          setSelectedContactId(undefined);
          setSelectedDealId(dealId);
        }}
        onCreateDeal={(contact) => router.push(`/workspaces/${workspace.id}/deals?contactId=${contact.id}`)}
        onCreateTask={(contact) => router.push(`/workspaces/${workspace.id}/tasks?contactId=${contact.id}`)}
        onCreateProposal={(contact) => router.push(`/workspaces/${workspace.id}/proposals?contactId=${contact.id}`)}
      />

      <DealDetailModal
        open={Boolean(selectedDeal)}
        onOpenChange={(open) => { if (!open) setSelectedDealId(undefined); }}
        workspaceId={workspace.id}
        deal={selectedDeal}
        pipeline={selectedDealPipeline}
        stages={selectedDealStages ?? []}
        contacts={contactsList}
        tasks={tasksList}
        proposals={proposalsList}
        members={members}
        teams={teamsList}
        onChanged={async () => { await Promise.all([mutateDeals(), mutate()]); }}
        onMove={(deal, stage) => {
          if (stage.isLost) {
            toast.error("Mover para Perdido exige motivo. Use o Kanban de Negócios para registrar a perda.");
            return;
          }
          void handleMoveDeal(deal, stage.id);
        }}
        onCreateTask={(deal) => router.push(`/workspaces/${workspace.id}/tasks?dealId=${deal.id}${deal.contactId ? `&contactId=${deal.contactId}` : ""}`)}
        onCreateProposal={(deal) => router.push(`/workspaces/${workspace.id}/proposals?dealId=${deal.id}${deal.contactId ? `&contactId=${deal.contactId}` : ""}`)}
      />
    </main>
  );
}

function ContactCard({
  contact,
  deals,
  tasks,
  proposals,
  conversations,
  members,
  teams,
  onOpen,
}: {
  contact: Contact;
  deals: readonly Deal[];
  tasks: readonly Task[];
  proposals: readonly Proposal[];
  conversations: readonly { id: string; status: string; lastMessageAt?: string }[];
  members: readonly UserPickerMember[];
  teams: readonly Team[];
  onOpen: () => void;
}) {
  const openDealsValue = deals.filter((deal) => !deal.wonAt && !deal.lostAt).reduce((sum, deal) => sum + deal.valueCents, 0);
  const nextTask = nextPendingTask(tasks, { contactId: contact.id });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="min-w-0 rounded-2xl border border-border/70 bg-card px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <Avatar name={contact.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{contact.name}</p>
          <p className="truncate text-xs text-muted-foreground">{contact.company ?? "Sem empresa"}</p>
        </div>
        {conversations.length > 0 ? <Badge variant="info">WhatsApp</Badge> : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <MiniMetric label="Pipeline" value={formatCurrencyCents(openDealsValue)} />
        <MiniMetric label="Propostas" value={String(proposals.length)} />
      </div>
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p className="truncate">Responsável: {userLabel(contact.ownerUserId, members)}</p>
        <p className="truncate">Equipe: {teamLabel(contact.teamId, teams)}</p>
        <p className="truncate">{nextTask ? `Próxima: ${nextTask.title}` : "Sem próxima atividade"}</p>
      </div>
    </button>
  );
}

function ContactDetailModal({
  open,
  onOpenChange,
  workspaceId,
  contact,
  deals,
  tasks,
  proposals,
  conversations,
  members,
  teams,
  onChanged,
  onOpenDeal,
  onCreateDeal,
  onCreateTask,
  onCreateProposal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  contact: Contact | undefined;
  deals: readonly Deal[];
  tasks: readonly Task[];
  proposals: readonly Proposal[];
  conversations: readonly { id: string; status: string; lastMessageAt?: string; contactPhone?: string }[];
  members: readonly UserPickerMember[];
  teams: readonly Team[];
  onChanged: () => void | Promise<void>;
  onOpenDeal: (dealId: string) => void;
  onCreateDeal: (contact: Contact) => void;
  onCreateTask: (contact: Contact) => void;
  onCreateProposal: (contact: Contact) => void;
}) {
  const router = useRouter();
  const [section, setSection] = useState<ContactSection>("summary");
  const [editing, setEditing] = useState(false);
  const { data: timeline, isLoading: timelineLoading, error: timelineError, mutate: mutateTimeline } = useContactTimeline(contact?.id, workspaceId);
  const { data: leadScore, isLoading: scoreLoading } = useLeadScore(contact?.id, workspaceId);

  if (!contact) return null;

  const primaryConversation = conversations[0];
  const activeDealsValue = deals.filter((deal) => !deal.wonAt && !deal.lostAt).reduce((sum, deal) => sum + deal.valueCents, 0);

  return (
    <>
      <DetailModal
        open={open}
        onOpenChange={onOpenChange}
        title={contact.name}
        description={<span className="text-sm text-muted-foreground">{contact.company ?? contact.origin ?? "Contato comercial"}</span>}
        eyebrow="Contato 360"
        avatar={<Avatar name={contact.name} large />}
        headerExtra={primaryConversation ? <StatusBadge status={primaryConversation.status} /> : undefined}
        sections={[
          { value: "summary", label: "Resumo", icon: Info },
          { value: "conversations", label: "Conversas", icon: MessageSquareText, badge: conversations.length || undefined },
          { value: "deals", label: "Negócios", icon: BriefcaseBusiness, badge: deals.length || undefined },
          { value: "tasks", label: "Tarefas", icon: ClipboardCheck, badge: tasks.length || undefined },
          { value: "proposals", label: "Propostas", icon: FileText, badge: proposals.length || undefined },
          { value: "timeline", label: "Timeline", icon: History },
        ]}
        value={section}
        onValueChange={(value) => setSection(value as ContactSection)}
        widthStorageKey="contact-detail-modal-width"
        defaultWidthPercent={76}
      >
        {section === "summary" ? (
          <div className="space-y-7">
            <DetailBlock label="Resumo" action={<Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Editar</Button>}>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoCell label="Empresa" value={contact.company ?? "—"} />
                <InfoCell label="Responsável" value={userLabel(contact.ownerUserId, members)} />
                <InfoCell label="Equipe" value={teamLabel(contact.teamId, teams)} />
                <InfoCell label="Origem" value={contact.origin ?? "—"} />
                <InfoCell label="Lead score" value={scoreLoading ? "Carregando..." : leadScore ? `${leadScore.score} · ${leadScore.temperature}` : "—"} />
                <InfoCell label="Pipeline ativo" value={formatCurrencyCents(activeDealsValue)} strong />
                <InfoCell label="Última interação" value={formatDateTime(contact.lastInteractionAt)} />
                <InfoCell label="Criado em" value={formatDate(contact.createdAt)} />
              </div>
              {contact.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {contact.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                </div>
              ) : null}
            </DetailBlock>
            <DetailBlock label="Ações contextuais">
              <div className="flex flex-wrap gap-2">
                {primaryConversation ? <Button variant="secondary" onClick={() => router.push(`/workspaces/${workspaceId}/conversas?conversation=${primaryConversation.id}`)}>Enviar mensagem</Button> : null}
                <Button variant="secondary" onClick={() => onCreateDeal(contact)}>Criar negócio</Button>
                <Button variant="secondary" onClick={() => onCreateTask(contact)}>Criar tarefa</Button>
                <Button variant="secondary" onClick={() => onCreateProposal(contact)}>Criar proposta</Button>
              </div>
            </DetailBlock>
          </div>
        ) : null}

        {section === "conversations" ? (
          <ListBlock empty="Nenhuma conversa vinculada a este contato.">
            {conversations.map((conversation) => (
              <button key={conversation.id} type="button" onClick={() => router.push(`/workspaces/${workspaceId}/conversas?conversation=${conversation.id}`)} className="w-full rounded-xl border border-border/70 bg-card px-3 py-3 text-left transition hover:border-primary/40">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">WhatsApp {conversation.contactPhone ? `· ${conversation.contactPhone}` : ""}</p>
                  <StatusBadge status={conversation.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Última interação {formatDateTime(conversation.lastMessageAt)}</p>
              </button>
            ))}
          </ListBlock>
        ) : null}

        {section === "deals" ? (
          <ListBlock empty="Nenhum negócio vinculado a este contato.">
            {deals.map((deal) => (
              <button key={deal.id} type="button" onClick={() => onOpenDeal(deal.id)} className="w-full rounded-xl border border-border/70 bg-card px-3 py-3 text-left transition hover:border-primary/40">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{deal.title}</p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrencyCents(deal.valueCents, deal.currency)}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{userLabel(deal.ownerUserId, members)} · atualizado {formatDateTime(deal.updatedAt)}</p>
              </button>
            ))}
          </ListBlock>
        ) : null}

        {section === "tasks" ? (
          <ListBlock empty="Nenhuma tarefa vinculada a este contato.">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-border/70 bg-card px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{task.title}</p>
                  <StatusBadge status={task.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{TASK_TYPE_LABEL[task.type]} · {TASK_STATUS_LABEL[task.status]} · {formatDateTime(task.dueAt)}</p>
              </div>
            ))}
          </ListBlock>
        ) : null}

        {section === "proposals" ? (
          <ListBlock empty="Nenhuma proposta vinculada a este contato.">
            {proposals.map((proposal) => (
              <div key={proposal.id} className="rounded-xl border border-border/70 bg-card px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{proposal.title}</p>
                  <StatusBadge status={proposal.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{formatCurrencyCents(proposal.totalCents, proposal.currency)} · {PROPOSAL_STATUS_LABEL[proposal.status]}</p>
              </div>
            ))}
          </ListBlock>
        ) : null}

        {section === "timeline" ? (
          timelineLoading ? <TimelineSkeleton /> : timelineError ? <ErrorState error={timelineError} onRetry={() => mutateTimeline()} /> : (
            <ListBlock empty="Nenhum evento registrado ainda.">
              {(timeline ?? []).map((event) => (
                <div key={event.id} className="relative pl-5">
                  <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-primary" />
                  <p className="text-sm font-medium text-foreground">{timelineEventLabel(event)}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</p>
                </div>
              ))}
            </ListBlock>
          )
        ) : null}
      </DetailModal>

      {editing ? <EditContactModal workspaceId={workspaceId} contact={contact} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await onChanged(); }} /> : null}
    </>
  );
}

function EditContactModal({ workspaceId, contact, onClose, onSaved }: { workspaceId: string; contact: Contact; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(contact.name);
  const [company, setCompany] = useState(contact.company ?? "");
  const [origin, setOrigin] = useState(contact.origin ?? "");
  const [ownerUserId, setOwnerUserId] = useState(contact.ownerUserId ?? "");
  const [teamId, setTeamId] = useState(contact.teamId ?? "");
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      await updateContact(contact.id, workspaceId, {
        name: name.trim(),
        company: company.trim() || undefined,
        origin: origin.trim() || undefined,
        ownerUserId: ownerUserId || undefined,
        teamId: teamId || undefined,
        notes: notes.trim() || undefined,
      });
      await onSaved();
      toast.success("Contato atualizado.");
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Editar contato" onClose={onClose} maxWidthClass="sm:max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="edit-contact-name">Nome</Label>
          <Input id="edit-contact-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="edit-contact-company">Empresa</Label>
          <Input id="edit-contact-company" value={company} onChange={(event) => setCompany(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="edit-contact-origin">Origem</Label>
          <Input id="edit-contact-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} />
        </div>
        <div>
          <Label>Responsável</Label>
          <UserPicker workspaceId={workspaceId} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "", label: "Sem responsável" }} />
        </div>
        <div className="sm:col-span-2">
          <Label>Equipe</Label>
          <TeamPicker workspaceId={workspaceId} value={teamId} onValueChange={setTeamId} extraOption={{ value: "", label: "Sem equipe" }} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="edit-contact-notes">Notas</Label>
          <Textarea id="edit-contact-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button onClick={handleSave} loading={busy} disabled={!name.trim() || busy}>Salvar</Button>
      </div>
    </Modal>
  );
}

function ListBlock({ empty, children }: { empty: string; children: ReactNode }) {
  const items = useMemo(() => ReactChildrenCount(children), [children]);
  if (items === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <div className="space-y-2">{children}</div>;
}

function InfoCell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-sm text-foreground", strong && "font-semibold tabular-nums")}>{value}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function Avatar({ name, large }: { name: string; large?: boolean }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "CT";
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-xl bg-ai-soft font-semibold text-ai", large ? "h-12 w-12 text-sm" : "h-10 w-10 text-xs")}>
      {initials}
    </span>
  );
}

function ContactGridSkeleton() {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="rounded-2xl border border-border/70 bg-card p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="mt-4 h-14 rounded-lg" />
          <Skeleton className="mt-3 h-3 w-2/3" />
        </div>
      ))}
    </section>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function contactLabel(contact: Contact): string {
  return contact.company ? `${contact.name} · ${contact.company}` : contact.name;
}

function ReactChildrenCount(children: ReactNode): number {
  if (Array.isArray(children)) return children.filter(Boolean).length;
  return children ? 1 : 0;
}
