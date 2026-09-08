"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/Spinner";
import { createContact, createDeal, createProposal, createTask, linkContactIdentity, updateContact } from "@/features/crm/api";
import { useContact, useDeals, usePipelines, usePipelineStages, useTasks } from "@/features/crm/hooks";
import type { TaskType } from "@/features/crm/types";
import { useInboxConversationMessages } from "@/features/inbox/hooks";
import type { InboxConversation } from "@/features/inbox/types";
import { formatCurrencyCents } from "@/lib/format";

const TASK_TYPE_LABEL: Record<TaskType, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  reuniao: "Reunião",
  enviar_proposta: "Enviar proposta",
  follow_up: "Follow-up",
  personalizada: "Personalizada",
};

/**
 * CRM/Comercial (Fase 4) — seção "CRM" do painel de contato do Conversas. Nunca sai da tela pra
 * criar negócio/tarefa/proposta (auditoria, seção 8: integração contextual). A ligação com o
 * WhatsApp é sempre explícita (botão "Vincular ao CRM") — nunca automática (mesmo racional de
 * `ContactIdentity`, ver `crm.model.ts`).
 */
export function CrmContextSection({ workspaceId, conversation, onLinked }: { workspaceId: string; conversation: InboxConversation; onLinked: () => void }) {
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | undefined>();
  const { data: messagesData } = useInboxConversationMessages(workspaceId, conversation.id);
  const messageCount = messagesData?.messages.length ?? 0;

  async function handleLink() {
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
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">CRM</h3>
        {messageCount >= 3 ? (
          <div className="mb-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-medium text-foreground">✨ Vorix identificou uma oportunidade</p>
            <p className="mt-1 text-xs text-muted-foreground">Esta conversa já tem várias trocas de mensagem, mas {conversation.contactName ?? "este contato"} ainda não está no seu CRM.</p>
            <Button className="mt-2 w-full" onClick={handleLink} loading={linking} disabled={linking}>Vincular ao CRM</Button>
          </div>
        ) : (
          <Button variant="secondary" className="w-full" onClick={handleLink} loading={linking} disabled={linking}>Vincular ao CRM</Button>
        )}
        {linkError ? <p className="mt-2 text-xs text-destructive">{linkError}</p> : null}
      </section>
    );
  }

  return <LinkedCrmSection workspaceId={workspaceId} contactId={conversation.crmContactId} />;
}

type QuickAction = "deal" | "task" | "proposal";

function LinkedCrmSection({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const { data: contact, mutate: mutateContact } = useContact(contactId, workspaceId);
  const { data: deals, mutate: mutateDeals } = useDeals(workspaceId, { contactId });
  const { data: tasks, mutate: mutateTasks } = useTasks(workspaceId, { contactId, status: "pending" });
  const { data: pipelines } = usePipelines(workspaceId);
  const defaultPipeline = pipelines?.[0];
  const { data: stages } = usePipelineStages(defaultPipeline?.id, workspaceId);
  const defaultStage = stages?.[0];

  const [quickAction, setQuickAction] = useState<QuickAction | undefined>();
  const [busy, setBusy] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const [proposalLink, setProposalLink] = useState<string | undefined>();

  // Campos do modal de ação rápida (compartilhados entre negócio/tarefa/proposta pra manter 1 modal só).
  const [title, setTitle] = useState("");
  const [valueReais, setValueReais] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("follow_up");

  function closeQuickAction() {
    setQuickAction(undefined);
    setTitle("");
    setValueReais("");
  }

  async function handleAddTag() {
    if (!contact || !newTag.trim()) return;
    await updateContact(contactId, workspaceId, { tags: [...contact.tags, newTag.trim()] });
    setNewTag("");
    await mutateContact();
  }

  async function handleChangeOwner() {
    if (!ownerInput.trim()) return;
    await updateContact(contactId, workspaceId, { ownerUserId: ownerInput.trim() });
    setOwnerInput("");
    await mutateContact();
  }

  async function handleQuickActionSubmit() {
    if (!quickAction || !title.trim()) return;
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
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
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">CRM</h3>

      <div>
        <p className="text-[11px] text-muted-foreground">Responsável</p>
        <p className="text-sm text-foreground">{contact.ownerUserId ?? "Sem responsável"}</p>
        <div className="mt-1 flex gap-1.5">
          <Input value={ownerInput} onChange={(event) => setOwnerInput(event.target.value)} placeholder="ID do usuário" className="flex-1" />
          <Button variant="secondary" onClick={handleChangeOwner} disabled={!ownerInput.trim()}>Definir</Button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] text-muted-foreground">Tags</p>
        <div className="mb-1.5 flex flex-wrap gap-1">
          {contact.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          {contact.tags.length === 0 ? <span className="text-xs text-muted-foreground">Nenhuma tag</span> : null}
        </div>
        <div className="flex gap-1.5">
          <Input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="Nova tag" className="flex-1" />
          <Button variant="secondary" onClick={handleAddTag} disabled={!newTag.trim()}>+ Tag</Button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] text-muted-foreground">Negócios ({deals?.length ?? 0})</p>
        <div className="space-y-1">
          {(deals ?? []).slice(0, 4).map((deal) => (
            <div key={deal.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-2 py-1.5 text-xs">
              <span className="truncate text-foreground">{deal.title}</span>
              <span className="tabular-nums text-muted-foreground">{formatCurrencyCents(deal.valueCents, deal.currency)}</span>
            </div>
          ))}
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

      <div className="grid grid-cols-3 gap-1.5">
        <Button variant="secondary" onClick={() => setQuickAction("deal")} disabled={!defaultPipeline || !defaultStage}>+ Negócio</Button>
        <Button variant="secondary" onClick={() => setQuickAction("task")}>+ Tarefa</Button>
        <Button variant="secondary" onClick={() => setQuickAction("proposal")}>+ Proposta</Button>
      </div>

      {quickAction ? (
        <Modal
          title={quickAction === "deal" ? "Novo negócio" : quickAction === "task" ? "Nova tarefa" : "Nova proposta"}
          onClose={closeQuickAction}
        >
          <div className="space-y-3">
            {quickAction === "task" ? (
              <div>
                <Label htmlFor="quick-task-type">Tipo</Label>
                <Select value={taskType} onValueChange={(value) => setTaskType(value as TaskType)}>
                  <SelectTrigger id="quick-task-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => <SelectItem key={t} value={t}>{TASK_TYPE_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div>
              <Label htmlFor="quick-title">{quickAction === "task" ? "Título" : quickAction === "proposal" ? "Item / título da proposta" : "Título"}</Label>
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
            <p className="text-sm text-muted-foreground">Guarde este link — ele não será mostrado novamente.</p>
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
