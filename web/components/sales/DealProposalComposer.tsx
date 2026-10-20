"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { ArrowRight, Check, CheckCircle2, FileText, MessageCircle, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { ProposalDocument } from "@/components/proposals/ProposalDocument";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useContact, useProposalTemplates } from "@/features/crm/hooks";
import type { Deal, ProposalWithToken } from "@/features/crm/types";
import type { PublicProposal } from "@/features/crm/public-proposal-api";
import { listInboxConversations } from "@/features/inbox/api";
import { useInboxConnections } from "@/features/inbox/hooks";
import { createProposalFromDeal, sendProposalWhatsapp } from "@/features/sales/api";
import { useDealCommercial, useInvalidateSales } from "@/features/sales/hooks";
import { formatCurrencyCents } from "@/lib/format";

const AURORA_INTRODUCTION = "Cada detalhe desta proposta foi organizado para facilitar sua decisão. Confira a solução, os valores e as condições que preparamos para você.";
const messageFor = (error: unknown) => error instanceof Error ? error.message : "Tente novamente.";

function validityAfter(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function GenerateProposalModal({ workspaceId, deal, contactName, onClose, onCreated }: {
  workspaceId: string; deal: Deal; contactName?: string; onClose: () => void;
  onCreated: (proposal: ProposalWithToken, approvalRequired: boolean) => Promise<void>;
}) {
  const { data: templates } = useProposalTemplates(workspaceId, true);
  const { data: contact } = useContact(deal.contactId, workspaceId);
  const { data: commercial } = useDealCommercial(workspaceId, deal.id);
  const [templateId, setTemplateId] = useState("aurora");
  const [title, setTitle] = useState(deal.title);
  const [introduction, setIntroduction] = useState(AURORA_INTRODUCTION);
  const [validUntil, setValidUntil] = useState(() => validityAfter());
  const [conditions, setConditions] = useState("");
  const [terms, setTerms] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function chooseTemplate(id: string) {
    const template = templates?.find(item => item.id === id);
    setTemplateId(id);
    setTitle(template?.defaultTitle || deal.title);
    setIntroduction(template?.defaultIntroduction ?? AURORA_INTRODUCTION);
    setConditions(template?.defaultConditions ?? "");
    setTerms(template?.defaultTerms ?? "");
    setValidUntil(validityAfter(template?.defaultValidDays ?? 7));
  }

  async function generate() {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      const created = await createProposalFromDeal(deal.id, {
        workspaceId, templateId: templateId === "aurora" ? undefined : templateId,
        title: title.trim() || undefined, introduction: introduction.trim(), validUntil: validUntil || undefined,
        conditions: conditions.trim(), terms: terms.trim(), justification: justification.trim() || undefined,
      });
      await onCreated(created, created.approvalRequired);
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Gerar proposta" onClose={() => { if (!busy) onClose(); }} maxWidthClass="sm:max-w-2xl">
      <div className="space-y-5">
        <div className="relative overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-ai/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" />Aurora · uma proposta pronta para impressionar</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Visual moderno, detalhes completos e resposta pelo próprio link. Os dados da oportunidade já vêm preenchidos.</p>
          <div className="mt-4 grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
            <div><p className="text-[11px] text-muted-foreground">Cliente</p><p className="mt-1 break-words text-sm font-medium">{contactName || contact?.name || "Sem contato vinculado"}</p>{contact?.company ? <p className="text-xs text-muted-foreground">{contact.company}</p> : null}</div>
            <div><p className="text-[11px] text-muted-foreground">Valor atual da oportunidade</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrencyCents(deal.valueCents, deal.currency)}</p></div>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Check className="h-3.5 w-3.5 text-primary" />{commercial?.items?.length ? `${commercial.items.length} itens, quantidades e descontos importados automaticamente.` : "O valor e o vínculo com o cliente vêm da oportunidade."}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="gp-model">Modelo</Label><Select value={templateId} onValueChange={chooseTemplate} disabled={busy}><SelectTrigger id="gp-model"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="aurora">Aurora · padrão</SelectItem>{(templates ?? []).map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="gp-valid">Válida até</Label><Input id="gp-valid" type="date" value={validUntil} onChange={event => setValidUntil(event.target.value)} disabled={busy} /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="gp-cond">Condições comerciais (opcional)</Label><Textarea id="gp-cond" rows={3} value={conditions} onChange={event => setConditions(event.target.value)} placeholder="Ex.: forma de pagamento, parcelamento e prazo de entrega." disabled={busy} /><p className="text-[11px] text-muted-foreground">Preencha somente os combinados desta negociação.</p></div>
        <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Personalizar apresentação e termos</summary><div className="mt-4 space-y-3"><div><Label htmlFor="gp-title">Título</Label><Input id="gp-title" value={title} onChange={event => setTitle(event.target.value)} disabled={busy} /></div><div><Label htmlFor="gp-intro">Introdução</Label><Textarea id="gp-intro" rows={3} value={introduction} onChange={event => setIntroduction(event.target.value)} disabled={busy} /></div><div><Label htmlFor="gp-terms">Termos (opcional)</Label><Textarea id="gp-terms" rows={3} value={terms} onChange={event => setTerms(event.target.value)} disabled={busy} /></div></div></details>
        {commercial?.approval?.required ? <div className="space-y-1.5 rounded-lg border border-warning/30 bg-warning/5 p-3"><Label htmlFor="gp-just">Justificativa para aprovação</Label><Input id="gp-just" value={justification} onChange={event => setJustification(event.target.value)} disabled={busy} /><p className="text-xs text-muted-foreground">O envio fica disponível depois da aprovação do gestor.</p></div> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={generate} loading={busy}><FileText className="h-4 w-4" />Gerar proposta<ArrowRight className="h-4 w-4" /></Button></div>
      </div>
    </Modal>
  );
}

export function DealProposalComposer({ workspaceId, deal, contactName, onClose, onChanged }: { workspaceId: string; deal: Deal; contactName?: string; onClose: () => void; onChanged: () => void | Promise<void> }) {
  const [created, setCreated] = useState<(ProposalWithToken & { approvalRequired: boolean })>();
  const invalidate = useInvalidateSales(workspaceId);
  return created ? <ProposalReview workspaceId={workspaceId} deal={deal} proposal={created} contactName={contactName} onClose={onClose} onChanged={async () => { await Promise.all([invalidate(), onChanged()]); }} /> : <GenerateProposalModal workspaceId={workspaceId} deal={deal} contactName={contactName} onClose={onClose} onCreated={async (proposal, approvalRequired) => { setCreated({ ...proposal, approvalRequired }); await invalidate(); }} />;
}

function ProposalReview({ workspaceId, deal, proposal, contactName, onClose, onChanged }: { workspaceId: string; deal: Deal; proposal: ProposalWithToken & { approvalRequired: boolean }; contactName?: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const workspace = useCurrentWorkspace();
  const { data: contact } = useContact(deal.contactId, workspaceId);
  const { data: connectionsData, error: connectionsError } = useInboxConnections(workspaceId);
  const { data: conversationsData, error: conversationsError } = useSWR(deal.contactId ? ["proposal-recipient-conversations", workspaceId, deal.contactId] : null, () => listInboxConversations(workspaceId, undefined, deal.contactId));
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const idempotencyKey = useRef(`proposal-card-${proposal.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const connections = connectionsData?.connections ?? [];
  const conversations = (conversationsData?.conversations ?? []).filter(conversation => conversation.chatType !== "group" && conversation.connectionProvider !== "instagram" && conversation.crmContactId === deal.contactId && connections.some(connection => connection.id === conversation.connectionId && connection.provider !== "instagram" && connection.status === "connected"));
  const conversationId = selected || (conversations.length === 1 ? conversations[0].id : "");
  const recipient = conversations.find(conversation => conversation.id === conversationId);
  const pending = proposal.approvalRequired || proposal.status === "pending_approval";
  const loading = !connectionsData || (Boolean(deal.contactId) && !conversationsData);
  const document: PublicProposal = { number: proposal.number, version: proposal.version ?? 1, title: proposal.title, introduction: proposal.introduction, items: proposal.items.map(item => ({ name: item.name, description: item.description, quantity: item.quantity, unitPriceCents: item.unitPriceCents, subtotalCents: item.subtotalCents, billingType: item.billingType })), subtotalCents: proposal.items.reduce((sum, item) => sum + item.subtotalCents, 0), discountCents: proposal.discountCents, totalCents: proposal.totalCents, currency: proposal.currency, validUntil: proposal.validUntil, conditions: proposal.conditions, notes: proposal.notes, terms: proposal.terms, status: proposal.status, superseded: false, customerName: contactName || contact?.name, customerCompany: contact?.company, issuerName: workspace.name, declineReasons: [] };

  async function send() {
    if (!recipient || pending || busy || sent) return;
    setBusy(true); setError(undefined);
    try {
      await sendProposalWhatsapp(proposal.id, { workspaceId, conversationId: recipient.id, idempotencyKey: idempotencyKey.current });
      setSent(true);
      toast.success("Proposta enviada pelo WhatsApp.");
      await onChanged();
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  }

  return <Modal title={sent ? "Proposta enviada" : "Revise e envie sua proposta"} onClose={() => { if (!busy) onClose(); }} maxWidthClass="sm:max-w-5xl">
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        {sent ? <p role="status" className="flex items-start gap-2 text-sm font-medium text-primary"><CheckCircle2 className="h-5 w-5 shrink-0" />O cliente receberá o link nesta conversa e poderá consultar, aceitar ou recusar a proposta.</p> : pending ? <p className="text-sm text-warning">Rascunho salvo. Esta condição precisa da aprovação do gestor antes do envio.</p> : <>
          <p className="mb-3 flex items-center gap-2 text-sm font-medium"><MessageCircle className="h-4 w-4 text-primary" />Enviar para o WhatsApp do cliente</p>
          {conversationsError || connectionsError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar as conversas. Feche e abra a proposta novamente para tentar.</p> : loading ? <p className="text-xs text-muted-foreground">Buscando as conversas deste cliente...</p> : !deal.contactId || conversations.length === 0 ? <p className="text-sm text-muted-foreground">Este cliente ainda não tem uma conversa em um WhatsApp conectado. O rascunho está salvo; vincule o contato a uma conversa para enviar depois.</p> : <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0 space-y-1.5"><Label htmlFor="proposal-whatsapp-recipient">Conversa de destino</Label><Select value={conversationId} onValueChange={setSelected} disabled={busy}><SelectTrigger id="proposal-whatsapp-recipient"><SelectValue placeholder="Escolha a conversa do cliente" /></SelectTrigger><SelectContent>{conversations.map(conversation => <SelectItem key={conversation.id} value={conversation.id}>{conversation.contactPhone || conversation.contactName || "Cliente"} · {connections.find(connection => connection.id === conversation.connectionId)?.displayName}</SelectItem>)}</SelectContent></Select></div><Button onClick={send} loading={busy} disabled={!recipient}><Send className="h-4 w-4" />Enviar pelo WhatsApp</Button></div>}
        </>}
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      </div>
      <ProposalDocument proposal={document} preview />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="text-xs text-muted-foreground">{sent ? "O envio e a resposta ficam registrados na oportunidade." : "A proposta já está salva. Você também pode enviá-la mais tarde."}</p><Button variant="secondary" onClick={onClose} disabled={busy}>{sent ? "Concluir" : "Fechar revisão"}</Button></div>
    </div>
  </Modal>;
}
