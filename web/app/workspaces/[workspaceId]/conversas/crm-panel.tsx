"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { DealDetailModal } from "@/components/crm/DealDetailModal";
import { LossReasonModal } from "@/components/crm/LossReasonModal";
import { QuickCreateDealModal } from "@/components/crm/QuickCreateDealModal";
import { QuickCreateTaskModal } from "@/components/crm/QuickCreateTaskModal";
import { RescheduleTaskPopover } from "@/components/crm/RescheduleTaskPopover";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { GuardedButton } from "@/components/GuardedButton";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Spinner } from "@/components/Spinner";
import { userLabel } from "@/components/UserPicker";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import {
  acceptCommercialSuggestion,
  completeTask,
  createContact,
  createProposal,
  dismissCommercialSuggestion,
  generateCommercialSuggestions,
  linkContactIdentity,
  moveDealStage,
  updateContact,
} from "@/features/crm/api";
import { resolveActiveDeal } from "@/features/crm/deal-resolution";
import { useCommercialSuggestions, useContact, useDeals, useLeadScore, usePipelines, usePipelineStages, useProposals, useTasks } from "@/features/crm/hooks";
import { isTaskOverdue, nextPendingTask, TASK_TYPE_LABEL } from "@/features/crm/presentation";
import { resolveTaskDealChoice } from "@/features/crm/task-scheduling";
import type { Deal, LeadTemperature, PipelineStage, Task } from "@/features/crm/types";
import { useTeams } from "@/features/identity/hooks";
import { useInboxConversationMessages } from "@/features/inbox/hooks";
import type { InboxConversation, InboxTenantMember } from "@/features/inbox/types";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { canOperateWorkspace, RBAC_COPY } from "@/lib/rbac";
import { cn } from "@/lib/utils";

const TEMPERATURE_LABEL: Record<LeadTemperature, string> = { frio: "Frio", morno: "Morno", quente: "Quente" };
const TEMPERATURE_VARIANT: Record<LeadTemperature, "outline" | "secondary" | "default"> = { frio: "outline", morno: "secondary", quente: "default" };

export function CrmContextSection({
  workspaceId,
  conversation,
  members,
  onLinked,
}: {
  workspaceId: string;
  conversation: InboxConversation;
  members: readonly InboxTenantMember[];
  onLinked: () => void;
}) {
  const { state } = useAuth();
  const canOperate = canOperateWorkspace(state.status === "authenticated" ? state.role : undefined);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | undefined>();
  const { data: messagesData } = useInboxConversationMessages(workspaceId, conversation.id);
  const messageCount = messagesData?.messages.length ?? 0;

  async function handleLink() {
    // Vínculo ao CRM só existe pra conversa direta (o chamador já garante isso — ver
    // `ContactContextPane` — mas esta checagem é defesa em profundidade: grupo nunca tem
    // `contactId`, nunca pode virar um Contact do CRM, ver seção 8 do pedido original).
    if (!canOperate || !conversation.contactId) return;
    setLinking(true);
    setLinkError(undefined);
    try {
      const contact = await createContact({ workspaceId, name: conversation.contactName ?? conversation.contactPhone ?? "Contato do WhatsApp", origin: "whatsapp" });
      await linkContactIdentity(contact.id, workspaceId, "whatsapp", conversation.contactId);
      onLinked();
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : "Não foi possível vincular ao CRM.");
    } finally {
      setLinking(false);
    }
  }

  if (!conversation.crmContactId) {
    return (
      <section className="mt-4 border-t border-border pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM</h3>
        {messageCount >= 3 ? (
          <div className="mb-2 rounded-lg border border-ai/30 bg-ai-soft p-3 dark:bg-ai/10">
            <p className="text-sm font-medium text-foreground">Vorix encontrou uma oportunidade</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Esta conversa já tem várias trocas, mas {conversation.contactName ?? "este contato"} ainda não está no CRM.
            </p>
            <GuardedButton className="mt-2 w-full" onClick={handleLink} loading={linking} disabled={linking} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
              Vincular ao CRM
            </GuardedButton>
          </div>
        ) : (
          <GuardedButton variant="secondary" className="w-full" onClick={handleLink} loading={linking} disabled={linking} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
            Vincular ao CRM
          </GuardedButton>
        )}
        {linkError ? <p className="mt-2 text-xs text-destructive">{linkError}</p> : null}
      </section>
    );
  }

  return <LinkedCrmSection workspaceId={workspaceId} contactId={conversation.crmContactId} members={members} canOperate={canOperate} />;
}

function LinkedCrmSection({
  workspaceId,
  contactId,
  members,
  canOperate,
}: {
  workspaceId: string;
  contactId: string;
  members: readonly InboxTenantMember[];
  canOperate: boolean;
}) {
  const { data: contact, error: contactError, mutate: mutateContact } = useContact(contactId, workspaceId);
  const { data: deals, mutate: mutateDeals } = useDeals(workspaceId, { contactId });
  // Todas as tarefas do contato (não só pendentes) — alimenta a seção "Próxima ação" (via
  // `nextPendingTask`, que já filtra por `pending` internamente) e o `DealDetailModal` embutido
  // abaixo (aba Atividades mostra histórico completo, não só pendentes).
  const { data: allTasks, mutate: mutateAllTasks } = useTasks(workspaceId, { contactId });
  const { data: proposals } = useProposals(workspaceId, { contactId });
  const { data: pipelines } = usePipelines(workspaceId);
  const { data: leadScore } = useLeadScore(contactId, workspaceId);
  const { data: suggestions, mutate: mutateSuggestions } = useCommercialSuggestions(workspaceId, { contactId, status: "pending" });
  const { data: teams } = useTeams(workspaceId);

  // Jornada Comercial Fase 2, item 7 — "negócio atual" da conversa é o negócio ABERTO mais
  // recentemente atualizado; Ganho/Perdido nunca contam como atual enquanto houver outro aberto.
  const { current: currentDeal, openDeals } = resolveActiveDeal(deals ?? []);
  const [openDealId, setOpenDealId] = useState<string | undefined>();
  const dealForModal = (deals ?? []).find((deal) => deal.id === openDealId);
  const { data: modalStages } = usePipelineStages(dealForModal?.pipelineId, workspaceId);
  const modalPipeline = pipelines?.find((pipeline) => pipeline.id === dealForModal?.pipelineId);
  // Etapa do negócio atual mostrado no card (pode ser de um pipeline diferente do embutido acima).
  const { data: currentDealStages } = usePipelineStages(currentDeal?.pipelineId, workspaceId);
  const currentDealStage = currentDealStages?.find((stage) => stage.id === currentDeal?.stageId);
  const [creatingDeal, setCreatingDeal] = useState(false);
  const [lossPrompt, setLossPrompt] = useState<{ deal: Deal; stage: PipelineStage } | undefined>();

  // Jornada Comercial Fase 3, item 9 — nunca escolhe um negócio errado em silêncio: com 1 negócio
  // aberto usa ele automaticamente, com mais de 1 força uma escolha explícita no próprio modal.
  const dealChoice = resolveTaskDealChoice(openDeals);
  const [creatingTask, setCreatingTask] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | undefined>();

  const [creatingProposal, setCreatingProposal] = useState(false);
  const [proposalDealId, setProposalDealId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [newTag, setNewTag] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [proposalLink, setProposalLink] = useState<string | undefined>();
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [resolvingSuggestionId, setResolvingSuggestionId] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [valueReais, setValueReais] = useState("");

  useEffect(() => {
    if (contact?.ownerUserId) setOwnerInput(contact.ownerUserId);
  }, [contact?.ownerUserId]);

  const memberOptions = members.map((member) => ({ id: member.userId, label: `${member.name} · ${member.email}` }));

  function closeProposalModal() {
    setCreatingProposal(false);
    setProposalDealId(undefined);
    setTitle("");
    setValueReais("");
  }

  async function handleGenerateSuggestions() {
    if (!canOperate) return;
    setGeneratingSuggestions(true);
    setActionError(undefined);
    try {
      await generateCommercialSuggestions(contactId, workspaceId);
      await mutateSuggestions();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível gerar sugestões.");
    } finally {
      setGeneratingSuggestions(false);
    }
  }

  async function handleAcceptSuggestion(suggestionId: string) {
    if (!canOperate) return;
    setResolvingSuggestionId(suggestionId);
    try {
      await acceptCommercialSuggestion(suggestionId, workspaceId);
      await Promise.all([mutateSuggestions(), mutateAllTasks()]);
    } finally {
      setResolvingSuggestionId(undefined);
    }
  }

  async function handleDismissSuggestion(suggestionId: string) {
    if (!canOperate) return;
    setResolvingSuggestionId(suggestionId);
    try {
      await dismissCommercialSuggestion(suggestionId, workspaceId);
      await mutateSuggestions();
    } finally {
      setResolvingSuggestionId(undefined);
    }
  }

  async function handleAddTag() {
    if (!canOperate || !contact || !newTag.trim()) return;
    await updateContact(contactId, workspaceId, { tags: [...contact.tags, newTag.trim()] });
    setNewTag("");
    await mutateContact();
  }

  async function handleChangeOwner() {
    if (!canOperate || !ownerInput.trim()) return;
    await updateContact(contactId, workspaceId, { ownerUserId: ownerInput.trim() });
    await mutateContact();
  }

  async function handleCreateProposal() {
    if (!canOperate || !title.trim()) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const cents = Math.round(Number(valueReais.replace(",", ".")) * 100) || 0;
      const { publicToken } = await createProposal({ workspaceId, contactId, dealId: proposalDealId, title: title.trim(), items: [{ name: title.trim(), quantity: 1, unitPriceCents: cents }] });
      setProposalLink(`${window.location.origin}/p/${publicToken}`);
      closeProposalModal();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível criar a proposta.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCompleteNextTask(task: Task) {
    if (!canOperate) return;
    setCompletingTaskId(task.id);
    try {
      await completeTask(task.id, workspaceId);
      await mutateAllTasks();
    } catch (cause) {
      toast.error("Não foi possível concluir a tarefa", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setCompletingTaskId(undefined);
    }
  }

  if (contactError) {
    return (
      <section className="mt-4 border-t border-border pt-4">
        <ErrorState error={contactError} onRetry={() => mutateContact()} />
      </section>
    );
  }

  if (!contact) {
    return (
      <section className="mt-4 border-t border-border pt-4">
        <div className="flex justify-center py-4"><Spinner /></div>
      </section>
    );
  }

  return (
    <section className="mt-4 space-y-3 border-t border-border pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">COMERCIAL</h3>
      {actionError ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionError}</p> : null}

      {leadScore ? (
        <div>
          <div className="flex items-center gap-2">
            <Badge variant={TEMPERATURE_VARIANT[leadScore.temperature]}>{TEMPERATURE_LABEL[leadScore.temperature]}</Badge>
            <span className="text-xs tabular-nums text-muted-foreground">{leadScore.score}/100</span>
          </div>
          {leadScore.factors.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {leadScore.factors.map((factor) => (
                <li key={factor.label} className="text-[11px] text-muted-foreground">
                  {factor.points > 0 ? "+" : ""}{factor.points} · {factor.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div>
        <p className="text-[11px] text-muted-foreground">Responsável</p>
        <p className="text-sm text-foreground">{ownerLabel(contact.ownerUserId, members)}</p>
        <div className="mt-1 flex gap-1.5">
          <SearchableCombo
            items={memberOptions}
            value={ownerInput}
            onValueChange={setOwnerInput}
            placeholder="Escolher responsável"
            searchPlaceholder="Buscar por nome ou email..."
            emptyText="Nenhum membro encontrado."
            disabled={!canOperate}
            className="min-w-0 flex-1"
          />
          <GuardedButton variant="secondary" onClick={handleChangeOwner} disabled={!ownerInput.trim()} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
            Definir
          </GuardedButton>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] text-muted-foreground">Tags</p>
        <div className="mb-1.5 flex flex-wrap gap-1">
          {contact.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          {contact.tags.length === 0 ? <span className="text-xs text-muted-foreground">Nenhuma tag</span> : null}
        </div>
        <div className="flex gap-1.5">
          <Input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="Nova tag" className="flex-1" disabled={!canOperate} />
          <GuardedButton variant="secondary" onClick={handleAddTag} disabled={!newTag.trim()} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
            + Tag
          </GuardedButton>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] text-muted-foreground">Negócio atual</p>
        {!currentDeal ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Nenhum negócio aberto.</p>
            <GuardedButton variant="secondary" className="w-full" onClick={() => setCreatingDeal(true)} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
              + Criar negócio
            </GuardedButton>
          </div>
        ) : openDeals.length === 1 ? (
          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">{currentDeal.title}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatCurrencyCents(currentDeal.valueCents, currentDeal.currency)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{currentDealStage?.name ?? "Sem etapa"} · {ownerLabel(currentDeal.ownerUserId, members)}</p>
            <p className="text-[11px] text-muted-foreground">
              {(() => {
                const nextTask = nextPendingTask(allTasks ?? [], { dealId: currentDeal.id });
                return nextTask ? `${TASK_TYPE_LABEL[nextTask.type]} · ${nextTask.title}` : "Sem próxima atividade";
              })()}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setOpenDealId(currentDeal.id)}>Abrir negócio</Button>
              <Button variant="secondary" size="sm" onClick={() => { setCreatingProposal(true); setProposalDealId(currentDeal.id); }}>Gerar proposta</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">{openDeals.length} negócios em andamento</p>
            {openDeals.slice(0, 4).map((deal) => (
              <button
                key={deal.id}
                type="button"
                onClick={() => setOpenDealId(deal.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-left text-xs transition hover:bg-muted"
              >
                <span className="truncate text-foreground">{deal.title}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatCurrencyCents(deal.valueCents, deal.currency)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-[11px] text-muted-foreground">Próxima ação</p>
        {(() => {
          // Jornada Comercial Fase 3, item 6 — regra centralizada (`nextPendingTask`, já reusada
          // por Tarefas/Home/Deal), nunca reimplementada aqui: pending com menor `dueAt`, o que já
          // coloca uma tarefa atrasada na frente de qualquer futura (item 28: sem lógica duplicada).
          const nextTask = nextPendingTask(allTasks ?? [], { contactId });
          if (!nextTask) {
            return (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Nenhuma próxima atividade.</p>
                <GuardedButton variant="secondary" className="w-full" onClick={() => setCreatingTask(true)} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
                  + Criar próxima ação
                </GuardedButton>
              </div>
            );
          }
          const overdue = isTaskOverdue(nextTask);
          return (
            <div className={cn("space-y-1.5 rounded-lg border p-2.5", overdue ? "border-destructive/30 bg-destructive/5" : "border-border/70 bg-muted/30")}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{TASK_TYPE_LABEL[nextTask.type]}</span>
                {overdue ? <Badge variant="destructive">Atrasada</Badge> : null}
              </div>
              <p className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                {nextTask.dueAt ? formatDateTime(nextTask.dueAt) : "Sem prazo"}
              </p>
              {nextTask.title !== TASK_TYPE_LABEL[nextTask.type] ? <p className="text-xs text-muted-foreground">{nextTask.title}</p> : null}
              <p className="text-xs text-muted-foreground">Responsável: {userLabel(nextTask.ownerUserId, members)}</p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <GuardedButton
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCompleteNextTask(nextTask)}
                  loading={completingTaskId === nextTask.id}
                  disabled={Boolean(completingTaskId)}
                  allowed={canOperate}
                  blockedReason={RBAC_COPY.operateConversations}
                >
                  Concluir
                </GuardedButton>
                {canOperate ? (
                  <RescheduleTaskPopover
                    task={nextTask}
                    workspaceId={workspaceId}
                    onRescheduled={async () => { await mutateAllTasks(); }}
                    trigger={<Button variant="secondary" size="sm">Reagendar</Button>}
                  />
                ) : null}
                {nextTask.dealId ? <Button variant="ghost" size="sm" onClick={() => setOpenDealId(nextTask.dealId)}>Ver</Button> : null}
              </div>
            </div>
          );
        })()}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">Vorix Intelligence</p>
          <GuardedButton variant="ghost" onClick={handleGenerateSuggestions} loading={generatingSuggestions} disabled={generatingSuggestions} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
            Gerar
          </GuardedButton>
        </div>
        <div className="space-y-1.5">
          {(suggestions ?? []).map((suggestion) => (
            <div key={suggestion.id} className="rounded-lg border border-ai/25 bg-ai-soft p-2 dark:bg-ai/10">
              <p className="text-xs font-medium text-foreground">{suggestion.title}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{suggestion.rationale}</p>
              <div className="mt-1.5 flex gap-1.5">
                <GuardedButton variant="secondary" onClick={() => handleAcceptSuggestion(suggestion.id)} loading={resolvingSuggestionId === suggestion.id} disabled={Boolean(resolvingSuggestionId)} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
                  Aceitar
                </GuardedButton>
                <GuardedButton variant="ghost" onClick={() => handleDismissSuggestion(suggestion.id)} disabled={Boolean(resolvingSuggestionId)} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>
                  Descartar
                </GuardedButton>
              </div>
            </div>
          ))}
          {suggestions && suggestions.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma sugestao pendente.</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <GuardedButton variant="secondary" onClick={() => setCreatingDeal(true)} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>+ Negócio</GuardedButton>
        <GuardedButton variant="secondary" onClick={() => setCreatingTask(true)} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>+ Tarefa</GuardedButton>
        <GuardedButton variant="secondary" onClick={() => setCreatingProposal(true)} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>+ Proposta</GuardedButton>
      </div>

      {creatingProposal ? (
        <Modal title="Nova proposta" onClose={closeProposalModal}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="quick-title">Item / titulo da proposta</Label>
              <Input id="quick-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="quick-value">Valor (R$)</Label>
              <Input id="quick-value" value={valueReais} onChange={(event) => setValueReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={closeProposalModal} disabled={busy}>Cancelar</Button>
              <Button onClick={handleCreateProposal} loading={busy} disabled={!title.trim() || busy}>Criar</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {creatingTask ? (
        <QuickCreateTaskModal
          workspaceId={workspaceId}
          contactId={contactId}
          dealChoice={dealChoice}
          onClose={() => setCreatingTask(false)}
          onCreated={async () => {
            setCreatingTask(false);
            await mutateAllTasks();
          }}
        />
      ) : null}

      {creatingDeal ? (
        <QuickCreateDealModal
          workspaceId={workspaceId}
          contactId={contactId}
          defaultOrigin="whatsapp"
          onClose={() => setCreatingDeal(false)}
          onCreated={async () => {
            setCreatingDeal(false);
            await mutateDeals();
          }}
        />
      ) : null}

      {dealForModal ? (
        <DealDetailModal
          open={Boolean(dealForModal)}
          onOpenChange={(open) => { if (!open) setOpenDealId(undefined); }}
          workspaceId={workspaceId}
          deal={dealForModal}
          pipeline={modalPipeline}
          stages={modalStages ?? []}
          contacts={contact ? [contact] : []}
          tasks={allTasks ?? []}
          proposals={proposals ?? []}
          members={members}
          teams={teams ?? []}
          onChanged={async () => { await Promise.all([mutateDeals(), mutateAllTasks()]); }}
          onMove={(deal, stage) => {
            if (stage.isLost) {
              setLossPrompt({ deal, stage });
              return;
            }
            void moveDealStage(deal.id, workspaceId, stage.id).then(() => mutateDeals());
          }}
        />
      ) : null}

      {lossPrompt ? (
        <LossReasonModal
          onClose={() => setLossPrompt(undefined)}
          onConfirm={async (reason) => {
            if (!lossPrompt) return;
            await moveDealStage(lossPrompt.deal.id, workspaceId, lossPrompt.stage.id, reason);
            await mutateDeals();
            setLossPrompt(undefined);
          }}
        />
      ) : null}

      {proposalLink ? (
        <Modal title="Proposta criada" onClose={() => setProposalLink(undefined)}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Guarde este link. Ele não será mostrado novamente.</p>
            <Input readOnly value={proposalLink} onFocus={(event) => event.target.select()} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(proposalLink); }}>Copiar link</Button>
              <Button onClick={() => setProposalLink(undefined)}>Fechar</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function ownerLabel(ownerUserId: string | undefined, members: readonly InboxTenantMember[]): string {
  if (!ownerUserId) return "Sem responsável";
  const member = members.find((item) => item.userId === ownerUserId);
  if (member) return member.name;
  return ownerUserId.length > 10 ? `${ownerUserId.slice(0, 8)}...` : ownerUserId;
}
