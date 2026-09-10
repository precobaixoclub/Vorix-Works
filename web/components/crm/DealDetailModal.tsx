"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, FileText, History, Info, MoveRight, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { StatusBadge } from "@/components/StatusBadge";
import { TeamPicker, teamLabel } from "@/components/TeamPicker";
import { UserPicker, type UserPickerMember, userLabel } from "@/components/UserPicker";
import { Skeleton } from "@/components/ui/skeleton";
import { updateDeal } from "@/features/crm/api";
import { useDealTimeline } from "@/features/crm/hooks";
import { centsFromCurrencyInput, currencyInputFromCents, nextPendingTask, PROPOSAL_STATUS_LABEL, TASK_TYPE_LABEL, timelineEventLabel } from "@/features/crm/presentation";
import type { Contact, Deal, Pipeline, PipelineStage, Proposal, Task } from "@/features/crm/types";
import type { Team } from "@/features/identity/types";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Section = "summary" | "activities" | "proposals" | "timeline";

export function DealDetailModal({
  open,
  onOpenChange,
  workspaceId,
  deal,
  pipeline,
  stages,
  contacts,
  tasks,
  proposals,
  members,
  teams,
  onChanged,
  onMove,
  onCreateTask,
  onCreateProposal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  deal: Deal | undefined;
  pipeline: Pipeline | undefined;
  stages: readonly PipelineStage[];
  contacts: readonly Contact[];
  tasks: readonly Task[];
  proposals: readonly Proposal[];
  members: readonly UserPickerMember[];
  teams: readonly Team[];
  onChanged: () => void | Promise<void>;
  onMove: (deal: Deal, stage: PipelineStage) => void | Promise<void>;
  onCreateTask?: (deal: Deal) => void;
  onCreateProposal?: (deal: Deal) => void;
}) {
  const [section, setSection] = useState<Section>("summary");
  const [editing, setEditing] = useState(false);
  const dealTasks = deal ? tasks.filter((task) => task.dealId === deal.id) : [];
  const dealProposals = deal ? proposals.filter((proposal) => proposal.dealId === deal.id) : [];
  const contact = deal?.contactId ? contacts.find((item) => item.id === deal.contactId) : undefined;
  const stage = deal ? stages.find((item) => item.id === deal.stageId) : undefined;
  const nextTask = nextPendingTask(dealTasks, { dealId: deal?.id });

  if (!deal) return null;

  return (
    <>
      <DetailModal
        open={open}
        onOpenChange={onOpenChange}
        title={deal.title}
        description={
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{contact?.name ?? "Sem contato vinculado"}</span>
            <span>·</span>
            <span>{formatCurrencyCents(deal.valueCents, deal.currency)}</span>
          </div>
        }
        eyebrow="Negócio"
        avatar={<DealAvatar title={deal.title} stage={stage} />}
        headerExtra={<StatusBadge status={stage?.isWon ? "won" : stage?.isLost ? "lost" : "open"} />}
        sections={[
          { value: "summary", label: "Resumo", icon: Info },
          { value: "activities", label: "Atividades", icon: ClipboardCheck, badge: dealTasks.length || undefined },
          { value: "proposals", label: "Propostas", icon: FileText, badge: dealProposals.length || undefined },
          { value: "timeline", label: "Timeline", icon: History },
        ]}
        value={section}
        onValueChange={(value) => setSection(value as Section)}
        widthStorageKey="deal-detail-modal-width"
        defaultWidthPercent={72}
      >
        {section === "summary" ? (
          <DealSummary
            deal={deal}
            contact={contact}
            pipeline={pipeline}
            stage={stage}
            nextTask={nextTask}
            stages={stages}
            ownerLabel={userLabel(deal.ownerUserId, members)}
            teamLabel={teamLabel(deal.teamId, teams)}
            onEdit={() => setEditing(true)}
            onMove={(targetStage) => { void onMove(deal, targetStage); }}
            onCreateTask={onCreateTask ? () => onCreateTask(deal) : undefined}
            onCreateProposal={onCreateProposal ? () => onCreateProposal(deal) : undefined}
          />
        ) : null}
        {section === "activities" ? <DealActivities tasks={dealTasks} members={members} /> : null}
        {section === "proposals" ? <DealProposals proposals={dealProposals} /> : null}
        {section === "timeline" ? <DealTimeline dealId={deal.id} workspaceId={workspaceId} /> : null}
      </DetailModal>

      {editing ? (
        <EditDealModal
          workspaceId={workspaceId}
          deal={deal}
          contacts={contacts}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function DealSummary({
  deal,
  contact,
  pipeline,
  stage,
  nextTask,
  stages,
  ownerLabel,
  teamLabel,
  onEdit,
  onMove,
  onCreateTask,
  onCreateProposal,
}: {
  deal: Deal;
  contact: Contact | undefined;
  pipeline: Pipeline | undefined;
  stage: PipelineStage | undefined;
  nextTask: Task | undefined;
  stages: readonly PipelineStage[];
  ownerLabel: string;
  teamLabel: string;
  onEdit: () => void;
  onMove: (stage: PipelineStage) => void;
  onCreateTask?: () => void;
  onCreateProposal?: () => void;
}) {
  return (
    <div className="space-y-7">
      <DetailBlock
        label="Contexto"
        action={<Button variant="ghost" size="sm" onClick={onEdit}><Pencil className="mr-2 h-4 w-4" /> Editar</Button>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoCell label="Contato" value={contact?.name ?? "Sem contato"} />
          <InfoCell label="Responsável" value={ownerLabel} />
          <InfoCell label="Equipe" value={teamLabel} />
          <InfoCell label="Etapa" value={stage?.name ?? "Sem etapa"} />
          <InfoCell label="Pipeline" value={pipeline?.name ?? "Pipeline"} />
          <InfoCell label="Valor" value={formatCurrencyCents(deal.valueCents, deal.currency)} strong />
          <InfoCell label="Origem" value={deal.origin ?? "—"} />
          <InfoCell label="Previsão" value={formatDate(deal.expectedCloseDate)} />
          <InfoCell label="Próxima atividade" value={nextTask ? `${TASK_TYPE_LABEL[nextTask.type]} · ${nextTask.title}` : "Sem próxima atividade"} />
          <InfoCell label="Última mudança" value={formatDateTime(deal.lastStageChangedAt)} />
        </div>
      </DetailBlock>

      <DetailBlock label="Ações contextuais">
        <div className="flex flex-wrap gap-2">
          {onCreateTask ? <Button variant="secondary" onClick={onCreateTask}>Criar tarefa</Button> : null}
          {onCreateProposal ? <Button variant="secondary" onClick={onCreateProposal}>Criar proposta</Button> : null}
        </div>
      </DetailBlock>

      <DetailBlock label="Mover etapa">
        <div className="flex flex-wrap gap-2">
          {stages.filter((item) => item.id !== deal.stageId).map((targetStage) => (
            <Button key={targetStage.id} variant="secondary" onClick={() => onMove(targetStage)}>
              <MoveRight className="mr-2 h-4 w-4" />
              {targetStage.name}
            </Button>
          ))}
        </div>
      </DetailBlock>
    </div>
  );
}

function DealActivities({ tasks, members }: { tasks: readonly Task[]; members: readonly UserPickerMember[] }) {
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma atividade vinculada a este negócio.</p>;
  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div key={task.id} className="rounded-xl border border-border/70 bg-card px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{task.title}</p>
            <StatusBadge status={task.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {TASK_TYPE_LABEL[task.type]} · {userLabel(task.ownerUserId, members)} · {task.dueAt ? formatDateTime(task.dueAt) : "Sem prazo"}
          </p>
          {task.description ? <p className="mt-2 text-sm text-muted-foreground">{task.description}</p> : null}
        </div>
      ))}
    </div>
  );
}

function DealProposals({ proposals }: { proposals: readonly Proposal[] }) {
  if (proposals.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma proposta vinculada a este negócio.</p>;
  return (
    <div className="space-y-2">
      {proposals.map((proposal) => (
        <div key={proposal.id} className="rounded-xl border border-border/70 bg-card px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{proposal.title}</p>
            <StatusBadge status={proposal.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatCurrencyCents(proposal.totalCents, proposal.currency)} · {PROPOSAL_STATUS_LABEL[proposal.status]} · validade {formatDate(proposal.validUntil)}
          </p>
        </div>
      ))}
    </div>
  );
}

function DealTimeline({ dealId, workspaceId }: { dealId: string; workspaceId: string }) {
  const { data, isLoading, error, mutate } = useDealTimeline(dealId, workspaceId);
  if (isLoading) return <TimelineSkeleton />;
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>;

  return (
    <ol className="space-y-3">
      {data.map((event) => (
        <li key={event.id} className="relative pl-5">
          <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-primary" />
          <p className="text-sm font-medium text-foreground">{timelineEventLabel(event)}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</p>
        </li>
      ))}
    </ol>
  );
}

function EditDealModal({
  workspaceId,
  deal,
  contacts,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  deal: Deal;
  contacts: readonly Contact[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(deal.title);
  const [value, setValue] = useState(currencyInputFromCents(deal.valueCents));
  const [origin, setOrigin] = useState(deal.origin ?? "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(deal.expectedCloseDate?.slice(0, 10) ?? "");
  const [ownerUserId, setOwnerUserId] = useState(deal.ownerUserId ?? "");
  const [teamId, setTeamId] = useState(deal.teamId ?? "");
  const [contactId, setContactId] = useState(deal.contactId ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(deal.title);
    setValue(currencyInputFromCents(deal.valueCents));
    setOrigin(deal.origin ?? "");
    setExpectedCloseDate(deal.expectedCloseDate?.slice(0, 10) ?? "");
    setOwnerUserId(deal.ownerUserId ?? "");
    setTeamId(deal.teamId ?? "");
    setContactId(deal.contactId ?? "");
  }, [deal]);

  async function handleSave() {
    setBusy(true);
    try {
      await updateDeal(deal.id, workspaceId, {
        title: title.trim(),
        valueCents: centsFromCurrencyInput(value),
        origin: origin.trim() || undefined,
        expectedCloseDate: expectedCloseDate || undefined,
        ownerUserId: ownerUserId || undefined,
        teamId: teamId || undefined,
        contactId: contactId || undefined,
      });
      await onSaved();
      toast.success("Negócio atualizado.");
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  const contactOptions = contacts.map((contact) => ({ id: contact.id, label: contact.company ? `${contact.name} · ${contact.company}` : contact.name }));

  return (
    <Modal title="Editar negócio" onClose={onClose} maxWidthClass="sm:max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="edit-deal-title">Titulo</Label>
          <Input id="edit-deal-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="edit-deal-value">Valor</Label>
          <Input id="edit-deal-value" value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" />
        </div>
        <div>
          <Label htmlFor="edit-deal-origin">Origem</Label>
          <Input id="edit-deal-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} />
        </div>
        <div>
          <Label>Contato</Label>
          <SearchableCombo items={contactOptions} value={contactId} onValueChange={setContactId} placeholder="Contato" extraOption={{ value: "", label: "Sem contato" }} />
        </div>
        <div>
          <Label>Responsável</Label>
          <UserPicker workspaceId={workspaceId} value={ownerUserId} onValueChange={setOwnerUserId} extraOption={{ value: "", label: "Sem responsável" }} />
        </div>
        <div>
          <Label>Equipe</Label>
          <TeamPicker workspaceId={workspaceId} value={teamId} onValueChange={setTeamId} extraOption={{ value: "", label: "Sem equipe" }} />
        </div>
        <div>
          <Label htmlFor="edit-deal-close">Previsão de fechamento</Label>
          <Input id="edit-deal-close" type="date" value={expectedCloseDate} onChange={(event) => setExpectedCloseDate(event.target.value)} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button onClick={handleSave} loading={busy} disabled={!title.trim() || busy}>Salvar</Button>
      </div>
    </Modal>
  );
}

function InfoCell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-sm text-foreground", strong && "font-semibold tabular-nums")}>{value}</p>
    </div>
  );
}

function DealAvatar({ title, stage }: { title: string; stage: PipelineStage | undefined }) {
  const initials = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "NG";
  return (
    <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl text-sm font-semibold", stage?.isWon ? "bg-status-active-bg text-status-active" : stage?.isLost ? "bg-danger-bg text-danger" : "bg-ai-soft text-ai")}>
      {initials}
    </div>
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
