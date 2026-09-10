"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label } from "@/components/Field";
import { GuardedButton } from "@/components/GuardedButton";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { useAuth } from "@/contexts/auth-context";
import {
  acceptCommercialSuggestion,
  createContact,
  createDeal,
  createProposal,
  createTask,
  dismissCommercialSuggestion,
  generateCommercialSuggestions,
  linkContactIdentity,
  updateContact,
} from "@/features/crm/api";
import { useCommercialSuggestions, useContact, useDeals, useLeadScore, usePipelines, usePipelineStages, useTasks } from "@/features/crm/hooks";
import type { LeadTemperature, TaskType } from "@/features/crm/types";
import { useInboxConversationMessages } from "@/features/inbox/hooks";
import type { InboxConversation, InboxTenantMember } from "@/features/inbox/types";
import { formatCurrencyCents } from "@/lib/format";
import { canOperateWorkspace, RBAC_COPY } from "@/lib/rbac";

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  reuniao: "Reunião",
  enviar_proposta: "Enviar proposta",
  follow_up: "Follow-up",
  personalizada: "Personalizada",
};

type QuickAction = "deal" | "task" | "proposal";

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
    if (!canOperate) return;
    setLinking(true);
    setLinkError(undefined);
    try {
      const contact = await createContact({ workspaceId, name: conversation.contactName ?? conversation.contactPhone, origin: "whatsapp" });
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
  const { data: tasks, mutate: mutateTasks } = useTasks(workspaceId, { contactId, status: "pending" });
  const { data: pipelines } = usePipelines(workspaceId);
  const defaultPipeline = pipelines?.[0];
  const { data: stages } = usePipelineStages(defaultPipeline?.id, workspaceId);
  const defaultStage = stages?.[0];
  const { data: leadScore } = useLeadScore(contactId, workspaceId);
  const { data: suggestions, mutate: mutateSuggestions } = useCommercialSuggestions(workspaceId, { contactId, status: "pending" });

  const [quickAction, setQuickAction] = useState<QuickAction | undefined>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [newTag, setNewTag] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [proposalLink, setProposalLink] = useState<string | undefined>();
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [resolvingSuggestionId, setResolvingSuggestionId] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [valueReais, setValueReais] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("follow_up");

  useEffect(() => {
    if (contact?.ownerUserId) setOwnerInput(contact.ownerUserId);
  }, [contact?.ownerUserId]);

  const memberOptions = members.map((member) => ({ id: member.userId, label: `${member.name} · ${member.email}` }));

  function closeQuickAction() {
    setQuickAction(undefined);
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
      await Promise.all([mutateSuggestions(), mutateTasks()]);
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

  async function handleQuickActionSubmit() {
    if (!canOperate || !quickAction || !title.trim()) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const cents = Math.round(Number(valueReais.replace(",", ".")) * 100) || 0;
      if (quickAction === "deal" && defaultPipeline && defaultStage) {
        await createDeal({ workspaceId, pipelineId: defaultPipeline.id, stageId: defaultStage.id, contactId, title: title.trim(), valueCents: cents });
        await mutateDeals();
      } else if (quickAction === "task") {
        await createTask({ workspaceId, contactId, type: taskType, title: title.trim() });
        await mutateTasks();
      } else if (quickAction === "proposal") {
        const { publicToken } = await createProposal({ workspaceId, contactId, title: title.trim(), items: [{ name: title.trim(), quantity: 1, unitPriceCents: cents }] });
        setProposalLink(`${window.location.origin}/p/${publicToken}`);
      }
      closeQuickAction();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível criar o item.");
    } finally {
      setBusy(false);
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
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">CRM</h3>
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
        <p className="mb-1 text-[11px] text-muted-foreground">Negócios ({deals?.length ?? 0})</p>
        <div className="space-y-1">
          {(deals ?? []).slice(0, 4).map((deal) => (
            <div key={deal.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs">
              <span className="truncate text-foreground">{deal.title}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatCurrencyCents(deal.valueCents, deal.currency)}</span>
            </div>
          ))}
          {deals && deals.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum negócio ativo.</p> : null}
        </div>
      </div>

      {tasks && tasks.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">Tarefas pendentes ({tasks.length})</p>
          <div className="space-y-1">
            {tasks.slice(0, 3).map((task) => (
              <div key={task.id} className="rounded-lg bg-muted/40 px-2 py-1.5 text-xs text-foreground">{task.title}</div>
            ))}
          </div>
        </div>
      ) : null}

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
        <GuardedButton variant="secondary" onClick={() => setQuickAction("deal")} disabled={!defaultPipeline || !defaultStage} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>+ Negócio</GuardedButton>
        <GuardedButton variant="secondary" onClick={() => setQuickAction("task")} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>+ Tarefa</GuardedButton>
        <GuardedButton variant="secondary" onClick={() => setQuickAction("proposal")} allowed={canOperate} blockedReason={RBAC_COPY.operateConversations}>+ Proposta</GuardedButton>
      </div>

      {quickAction ? (
        <Modal title={quickAction === "deal" ? "Novo negócio" : quickAction === "task" ? "Nova tarefa" : "Nova proposta"} onClose={closeQuickAction}>
          <div className="space-y-3">
            {quickAction === "task" ? (
              <div>
                <Label htmlFor="quick-task-type">Tipo</Label>
                <Select value={taskType} onValueChange={(value) => setTaskType(value as TaskType)}>
                  <SelectTrigger id="quick-task-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((type) => <SelectItem key={type} value={type}>{TASK_TYPE_LABEL[type]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div>
              <Label htmlFor="quick-title">{quickAction === "task" ? "Titulo" : quickAction === "proposal" ? "Item / titulo da proposta" : "Titulo"}</Label>
              <Input id="quick-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            {quickAction === "deal" || quickAction === "proposal" ? (
              <div>
                <Label htmlFor="quick-value">Valor (R$)</Label>
                <Input id="quick-value" value={valueReais} onChange={(event) => setValueReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={closeQuickAction} disabled={busy}>Cancelar</Button>
              <Button onClick={handleQuickActionSubmit} loading={busy} disabled={!title.trim() || busy}>Criar</Button>
            </div>
          </div>
        </Modal>
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
