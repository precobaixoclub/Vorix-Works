"use client";

import { useMyAccess } from "@/features/auth/access";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, FileText, Handshake, History, Info, MoveRight, Package, Pencil, RotateCcw, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { RescheduleTaskPopover } from "@/components/crm/RescheduleTaskPopover";
import { QuickCreateTaskModal } from "@/components/crm/QuickCreateTaskModal";
import { QuickCreateProposalModal } from "@/components/crm/QuickCreateProposalModal";
import { ProposalDetailModal } from "@/components/crm/ProposalDetailModal";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, MoneyInput } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { StatusBadge } from "@/components/StatusBadge";
import { TeamPicker, teamLabel } from "@/components/TeamPicker";
import { UserPicker, type UserPickerMember, userLabel } from "@/components/UserPicker";
import { Skeleton } from "@/components/ui/skeleton";
import { completeTask, updateDeal, setDealArchived } from "@/features/crm/api";
import { useDealTimeline } from "@/features/crm/hooks";
import { centsFromCurrencyInput, currencyInputFromCents, isTaskOverdue, nextPendingTask, PROPOSAL_STATUS_LABEL, TASK_TYPE_LABEL, timelineEventLabel } from "@/features/crm/presentation";
import type { Contact, Deal, Pipeline, PipelineStage, Proposal, Task } from "@/features/crm/types";
import type { Team } from "@/features/identity/types";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CloseDealModal, DealCockpitStats, DealNegotiation, DealOverview, DealProducts } from "@/components/sales/DealCockpit";
import { DealProposalsPanel } from "@/components/sales/DealProposalsPanel";
import { DealCustomFieldsBlock, DealParticipantsBlock } from "@/components/sales/DealDataBlocks";
import { loseDeal, reopenDeal, winDeal } from "@/features/sales/api";
import { useCompetitors, useInvalidateSales, useReasons } from "@/features/sales/hooks";
import { ClosedDealCorrectionModal } from "@/components/sales/ClosedDealCorrectionModal";
import { useAuth } from "@/contexts/auth-context";
import { canManageTenant, canOperateWorkspace } from "@/lib/rbac";
import styles from "./DealDetail.module.css";

type Section = "overview" | "products" | "negotiation" | "summary" | "activities" | "proposals" | "timeline";

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
  onOpenConversation,
  onOpenContact,
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
  /** Jornada Comercial Fase 2, item 16 — se o Contact do negócio tiver conversa, mostra "Abrir
   * conversa" abrindo a InboxConversation correta. Omitido (undefined) quando o chamador não sabe
   * resolver a conversa daquele contato ou quando não faz sentido no contexto (ex.: dentro do
   * próprio painel da conversa). */
  onOpenConversation?: (deal: Deal) => void;
  /** Jornada Comercial Fase 5, item 11 — nome do contato no header nunca deveria ser texto morto
   * quando dá pra abrir o Contact 360 direto. Omitido quando o chamador está dentro do próprio
   * Contact 360 (não faz sentido "abrir" o contato que já está aberto). */
  onOpenContact?: (contactId: string) => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [closing, setClosing] = useState<"won" | "lost">();
  const [correcting, setCorrecting] = useState(false);
  const { state: auth } = useAuth();
  const role = auth.status === "authenticated" ? auth.role : undefined;
  const { can } = useMyAccess();
  const canOperate = can("deal:manage");
  const canCorrect = can("deal:edit_closed") && can(deal?.status === "won" ? "deal:change_final_value" : "deal:change_loss_reason");
  const invalidateSales = useInvalidateSales(workspaceId);
  const { data: wonReasons } = useReasons(workspaceId, "won");
  const { data: lostReasons } = useReasons(workspaceId, "lost");
  const { data: competitors } = useCompetitors(workspaceId);
  const status = deal?.status ?? (stages.find((item) => item.id === deal?.stageId)?.isWon ? "won" : stages.find((item) => item.id === deal?.stageId)?.isLost ? "lost" : "open");
  const [editing, setEditing] = useState(false);
  // Jornada Comercial Fase 3, item 18 — criação de tarefa a partir do negócio é SEMPRE inline
  // (nunca navega pra outra tela); `dealId` nunca é ambíguo aqui (é sempre ESTE negócio).
  const [creatingTask, setCreatingTask] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [openProposalId, setOpenProposalId] = useState<string>();
  const [completingTaskId, setCompletingTaskId] = useState<string | undefined>();
  const dealTasks = deal ? tasks.filter((task) => task.dealId === deal.id) : [];
  const pendingDealTasks = [...dealTasks]
    .filter((task) => task.status === "pending")
    .sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER) - (b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER));
  const dealProposals = deal ? proposals.filter((proposal) => proposal.dealId === deal.id) : [];
  const contact = deal?.contactId ? contacts.find((item) => item.id === deal.contactId) : undefined;
  const stage = deal ? stages.find((item) => item.id === deal.stageId) : undefined;
  const nextTask = nextPendingTask(dealTasks, { dealId: deal?.id });

  async function handleCompleteTask(task: Task) {
    setCompletingTaskId(task.id);
    try {
      await completeTask(task.id, workspaceId);
      await onChanged();
    } catch (cause) {
      toast.error("Não foi possível concluir a tarefa", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setCompletingTaskId(undefined);
    }
  }

  if (!deal) return null;

  return (
    <>
      <DetailModal
        className={styles.dialog}
        open={open}
        onOpenChange={onOpenChange}
        title={deal.title}
        description={
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {contact && onOpenContact ? (
              <button type="button" onClick={() => onOpenContact(contact.id)} className="underline-offset-2 hover:text-foreground hover:underline">{contact.name}</button>
            ) : (
              <span>{contact?.name ?? "Sem contato vinculado"}</span>
            )}
            <span>·</span>
            <span>{formatCurrencyCents(deal.status === "won" ? deal.finalValueCents ?? deal.valueCents : deal.valueCents, deal.currency)}</span>
          </div>
        }
        eyebrow="Oportunidade"
        avatar={<DealAvatar title={deal.title} stage={stage} />}
        headerExtra={
          <div className={cn(styles.headerActions, "flex flex-wrap items-center gap-2")}>
            <StatusBadge status={status === "cancelled" ? "cancelled" : status} />
            {deal.archivedAt ? <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">Arquivada</span> : null}
            {can(deal.archivedAt ? "deal:unarchive" : "deal:archive") && (status === "won" || status === "lost") ? <Button size="sm" variant="secondary" onClick={async () => {
              try { await setDealArchived(deal.id, workspaceId, !deal.archivedAt); await Promise.all([invalidateSales(), onChanged()]); toast.success(deal.archivedAt ? "Oportunidade visível no Kanban." : "Oportunidade arquivada."); }
              catch (cause) { toast.error("Não foi possível atualizar o arquivamento", { description: cause instanceof Error ? cause.message : undefined }); }
            }}>{deal.archivedAt ? "Mostrar no Kanban" : "Arquivar"}</Button> : null}
            {canCorrect && (status === "won" || status === "lost") ? <Button size="sm" variant="secondary" onClick={() => setCorrecting(true)}>{status === "won" ? "Ajustar valor final" : "Corrigir motivo"}</Button> : null}
            {canOperate && status === "open" ? (
              <>
                <Button size="sm" disabled={!can("deal:win")} onClick={() => setClosing("won")}><Trophy className="mr-1.5 h-4 w-4" />Ganha</Button>
                <Button size="sm" variant="secondary" disabled={!can("deal:lose")} onClick={() => setClosing("lost")}><XCircle className="mr-1.5 h-4 w-4" />Perdida</Button>
              </>
            ) : can("deal:reopen") && status !== "open" ? (
              <Button size="sm" variant="secondary" onClick={async () => {
                try {
                  await reopenDeal(deal.id, workspaceId);
                  await Promise.all([invalidateSales(), onChanged()]);
                  toast.success("Oportunidade reaberta.");
                } catch (cause) {
                  toast.error("Não foi possível reabrir", { description: cause instanceof Error ? cause.message : undefined });
                }
              }}><RotateCcw className="mr-1.5 h-4 w-4" />Reabrir</Button>
            ) : null}
          </div>
        }
        sections={[
          { value: "overview", label: "Visão geral", icon: Info },
          { value: "products", label: "Produtos", icon: Package },
          { value: "negotiation", label: "Negociação", icon: Handshake },
          { value: "proposals", label: "Propostas", icon: FileText, badge: dealProposals.length || undefined },
          { value: "summary", label: "Dados", icon: Pencil },
          { value: "activities", label: "Atividades", icon: ClipboardCheck, badge: dealTasks.length || undefined },
          { value: "timeline", label: "Histórico", icon: History },
        ]}
        value={section}
        onValueChange={(value) => setSection(value as Section)}
        widthStorageKey="deal-detail-modal-width"
        defaultWidthPercent={72}
      >
        {section === "overview" ? (
          <div className="space-y-6">
            {status === "lost" || deal.closeComment ? <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
              {status === "lost" ? <div><p className="text-xs font-medium text-muted-foreground">Motivo da perda</p><p className="mt-1 text-base font-semibold">{deal.lossReason ?? "Não informado no registro original"}</p></div> : null}
              {deal.closeComment ? <div><p className="text-xs font-medium text-muted-foreground">Observação do fechamento</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{deal.closeComment}</p></div> : null}
            </div> : null}
            {deal.firstClosedAt ? <p className="text-xs text-muted-foreground">Primeiro fechamento: {formatDateTime(deal.firstClosedAt)}{deal.reopenCount ? ` · ${deal.reopenCount} reabertura(s) · Última: ${formatDateTime(deal.reopenedAt)}` : ""}</p> : null}
            <DealCockpitStats workspaceId={workspaceId} deal={deal} />
            <DealOverview workspaceId={workspaceId} deal={deal} onGoToProducts={() => setSection("products")} onGoToNegotiation={() => setSection("negotiation")} />
          </div>
        ) : null}
        {section === "products" ? <DealProducts workspaceId={workspaceId} deal={deal} /> : null}
        {section === "negotiation" ? <DealNegotiation workspaceId={workspaceId} deal={deal} /> : null}
        {section === "summary" ? (
          <DealSummary
            deal={deal}
            workspaceId={workspaceId}
            contact={contact}
            pipeline={pipeline}
            stage={stage}
            nextTask={nextTask}
            pendingTasks={pendingDealTasks}
            completingTaskId={completingTaskId}
            stages={canOperate ? stages.filter(item => (item.isWon ? can("deal:win") : item.isLost ? can("deal:lose") : status === "open" || can("deal:reopen"))) : []}
            ownerLabel={userLabel(deal.ownerUserId, members)}
            teamLabel={teamLabel(deal.teamId, teams)}
            onEdit={canOperate && (status === "open" || canCorrect) ? () => setEditing(true) : undefined}
            onMove={(targetStage) => { if (targetStage.isWon) setClosing("won"); else if (targetStage.isLost) setClosing("lost"); else void onMove(deal, targetStage); }}
            onCreateTask={() => setCreatingTask(true)}
            onCompleteTask={handleCompleteTask}
            onTaskRescheduled={onChanged}
            onViewAllTasks={() => setSection("activities")}
            onCreateProposal={() => setSection("proposals")}
            onOpenConversation={onOpenConversation ? () => onOpenConversation(deal) : undefined}
          />
        ) : null}
        {section === "summary" ? (
          <div className="mt-7 space-y-7">
            <DealCustomFieldsBlock workspaceId={workspaceId} deal={deal} onSaved={onChanged} />
            <DealParticipantsBlock workspaceId={workspaceId} deal={deal} />
          </div>
        ) : null}
        {section === "activities" ? <DealActivities tasks={dealTasks} members={members} /> : null}
        {section === "proposals" ? <DealProposalsPanel workspaceId={workspaceId} deal={deal} proposals={dealProposals} onChanged={onChanged} onMarkLost={() => setClosing("lost")} /> : null}
        {section === "timeline" ? <DealTimeline dealId={deal.id} workspaceId={workspaceId} stages={stages} members={members} /> : null}
      </DetailModal>
      {correcting ? <ClosedDealCorrectionModal workspaceId={workspaceId} deal={deal} onClose={() => setCorrecting(false)} onSaved={() => Promise.all([invalidateSales(), onChanged()])} /> : null}

      {closing ? (
        <CloseDealModal
          mode={closing}
          deal={deal}
          reasons={(closing === "won" ? wonReasons : lostReasons) ?? []}
          competitors={competitors ?? []}
          onClose={() => setClosing(undefined)}
          onConfirm={async (input) => {
            try {
              if (closing === "won") await winDeal(deal.id, { workspaceId, wonReason: input.reason, comment: input.comment, finalValueCents: input.finalValueCents, closedAt: input.closedAt });
              else await loseDeal(deal.id, { workspaceId, lossReason: input.reason ?? "", competitorId: input.competitorId, competitorName: input.competitorName, comment: input.comment });
              setClosing(undefined);
              await Promise.all([invalidateSales(), onChanged()]);
              toast.success(closing === "won" ? "Venda registrada! 🎉" : "Oportunidade marcada como perdida.");
            } catch (cause) {
              toast.error("Não foi possível fechar", { description: cause instanceof Error ? cause.message : undefined });
            }
          }}
        />
      ) : null}

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

      {creatingTask ? (
        <QuickCreateTaskModal
          workspaceId={workspaceId}
          contactId={deal.contactId}
          dealChoice={{ mode: "auto", dealId: deal.id }}
          title="Nova tarefa"
          onClose={() => setCreatingTask(false)}
          onCreated={async () => {
            setCreatingTask(false);
            await onChanged();
          }}
        />
      ) : null}
      {creatingProposal ? (
        <QuickCreateProposalModal
          workspaceId={workspaceId}
          contactId={deal.contactId}
          contactName={contact?.name}
          dealChoice={{ mode: "auto", dealId: deal.id }}
          onClose={() => setCreatingProposal(false)}
          onCreated={async () => { setCreatingProposal(false); await onChanged(); }}
        />
      ) : null}
      {openProposalId ? (
        <ProposalDetailModal workspaceId={workspaceId} proposal={dealProposals.find((proposal) => proposal.id === openProposalId)!} contactName={contact?.name} dealTitle={deal.title} onClose={() => setOpenProposalId(undefined)} onChanged={onChanged} onCreateNewProposal={() => { setOpenProposalId(undefined); setCreatingProposal(true); }} onCreateFollowUp={() => { setOpenProposalId(undefined); setCreatingTask(true); }} onMarkDealLost={stages.some((stage) => stage.isLost) ? () => { setOpenProposalId(undefined); void onMove(deal, stages.find((stage) => stage.isLost)!); } : undefined} onOpenContact={onOpenContact} />
      ) : null}
    </>
  );
}

function DealSummary({
  deal,
  workspaceId,
  contact,
  pipeline,
  stage,
  nextTask,
  pendingTasks,
  completingTaskId,
  stages,
  ownerLabel,
  teamLabel,
  onEdit,
  onMove,
  onCreateTask,
  onCompleteTask,
  onTaskRescheduled,
  onViewAllTasks,
  onCreateProposal,
  onOpenConversation,
}: {
  deal: Deal;
  workspaceId: string;
  contact: Contact | undefined;
  pipeline: Pipeline | undefined;
  stage: PipelineStage | undefined;
  nextTask: Task | undefined;
  pendingTasks: readonly Task[];
  completingTaskId: string | undefined;
  stages: readonly PipelineStage[];
  ownerLabel: string;
  teamLabel: string;
  onEdit?: () => void;
  onMove: (stage: PipelineStage) => void;
  onCreateTask: () => void;
  onCompleteTask: (task: Task) => void;
  onTaskRescheduled: () => void | Promise<void>;
  onViewAllTasks: () => void;
  onCreateProposal?: () => void;
  onOpenConversation?: () => void;
}) {
  return (
    <div className="space-y-7">
      <DetailBlock
        label="Contexto"
        action={onEdit ? <Button variant="secondary" size="sm" onClick={onEdit}><Pencil className="mr-2 h-4 w-4" /> Editar</Button> : undefined}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoCell label="Contato" value={contact?.name ?? "Sem contato"} />
          <InfoCell label="Responsável" value={ownerLabel} />
          <InfoCell label="Equipe" value={teamLabel} />
          <InfoCell label="Etapa" value={stage?.name ?? "Sem etapa"} />
          <InfoCell label="Pipeline" value={pipeline?.name ?? "Pipeline"} />
          <InfoCell label="Valor" value={formatCurrencyCents(deal.status === "won" ? deal.finalValueCents ?? deal.valueCents : deal.valueCents, deal.currency)} strong />
          <InfoCell label="Origem" value={deal.origin ?? "—"} />
          <InfoCell label="Previsão" value={formatDate(deal.expectedCloseDate)} />
          <InfoCell label="Próxima atividade" value={nextTask ? `${TASK_TYPE_LABEL[nextTask.type]} · ${nextTask.title}` : "Sem próxima atividade"} />
          <InfoCell label="Última mudança" value={formatDateTime(deal.lastStageChangedAt)} />
        </div>
      </DetailBlock>

      <DetailBlock
        label="Próximas atividades"
        action={<Button variant="ghost" size="sm" onClick={onCreateTask}>+ Nova tarefa</Button>}
      >
        {pendingTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma atividade pendente.</p>
        ) : (
          <div className="space-y-2">
            {pendingTasks.slice(0, 5).map((task) => {
              const overdue = isTaskOverdue(task);
              return (
                <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-card px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {TASK_TYPE_LABEL[task.type]}{task.title !== TASK_TYPE_LABEL[task.type] ? ` · ${task.title}` : ""}
                    </p>
                    <p className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {task.dueAt ? formatDateTime(task.dueAt) : "Sem prazo"}{overdue ? " · Atrasada" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button variant="secondary" size="sm" loading={completingTaskId === task.id} disabled={Boolean(completingTaskId)} onClick={() => onCompleteTask(task)}>
                      Concluir
                    </Button>
                    <RescheduleTaskPopover
                      task={task}
                      workspaceId={workspaceId}
                      onRescheduled={onTaskRescheduled}
                      trigger={<Button variant="ghost" size="sm">Reagendar</Button>}
                    />
                  </div>
                </div>
              );
            })}
            <Button variant="ghost" size="sm" onClick={onViewAllTasks}>Ver atividades</Button>
          </div>
        )}
      </DetailBlock>

      <DetailBlock label="Ações contextuais">
        <div className="flex flex-wrap gap-2">
          {onOpenConversation ? <Button variant="secondary" onClick={onOpenConversation}>Abrir conversa</Button> : null}
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
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma atividade vinculada a esta oportunidade.</p>;
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

function DealTimeline({ dealId, workspaceId, stages, members }: { dealId: string; workspaceId: string; stages: readonly PipelineStage[]; members: readonly UserPickerMember[] }) {
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
          <p className="text-xs text-muted-foreground">{formatDateTime(event.occurredAt)} · {event.actorType === "user" ? userLabel(event.actorId, members) : event.actorType === "automation" ? "Automação" : "Sistema"}</p>
          {event.payload.fromStageId && event.payload.toStageId ? <p className="mt-1 text-sm text-muted-foreground">{stages.find(stage => stage.id === event.payload.fromStageId)?.name ?? "Fase anterior"} → {stages.find(stage => stage.id === event.payload.toStageId)?.name ?? "Nova fase"}</p> : null}
          {typeof event.payload.finalValueCents === "number" ? <p className="mt-1 text-sm">Valor final: {formatCurrencyCents(event.payload.finalValueCents)}</p> : null}
          {typeof event.payload.toValueCents === "number" ? <p className="mt-1 text-sm">{typeof event.payload.fromValueCents === "number" ? `${formatCurrencyCents(event.payload.fromValueCents)} → ` : ""}{formatCurrencyCents(event.payload.toValueCents)}</p> : null}
          {typeof event.payload.lossReason === "string" ? <p className="mt-1 text-sm">Motivo: {event.payload.lossReason}</p> : null}
          {typeof event.payload.comment === "string" ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{event.payload.comment}</p> : null}
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
        valueCents: deal.valueMode === "calculated" ? undefined : centsFromCurrencyInput(value),
        origin: origin.trim() || undefined,
        expectedCloseDate: expectedCloseDate || undefined,
        ownerUserId: ownerUserId || undefined,
        teamId: teamId || undefined,
        contactId: contactId || undefined,
      });
      await onSaved();
      toast.success("Oportunidade atualizada.");
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  const contactOptions = contacts.map((contact) => ({ id: contact.id, label: contact.company ? `${contact.name} · ${contact.company}` : contact.name }));

  return (
    <Modal title="Editar oportunidade" onClose={onClose} maxWidthClass="sm:max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="edit-deal-title">Titulo</Label>
          <Input id="edit-deal-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="edit-deal-value">{deal.valueMode === "calculated" ? "Valor (calculado pelos produtos)" : "Valor"}</Label>
          <MoneyInput id="edit-deal-value" value={value} disabled={deal.valueMode === "calculated"} onChange={(event) => setValue(event.target.value)} />
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
