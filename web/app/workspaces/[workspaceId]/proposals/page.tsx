"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, FileText, History, Info, Search, Send, SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { DetailBlock, DetailModal } from "@/components/DetailModal";
import { LossReasonModal } from "@/components/crm/LossReasonModal";
import { ProposalTemplatesPanel } from "@/components/crm/ProposalTemplatesPanel";
import { QuickCreateTaskModal } from "@/components/crm/QuickCreateTaskModal";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { StatusBadge } from "@/components/StatusBadge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createProposal, moveDealStage, regenerateProposalLink, revokeProposalLink, sendProposal } from "@/features/crm/api";
import { useContacts, useDeals, usePipelineStages, useProducts, useProposalTemplates, useProposalTimeline, useProposals } from "@/features/crm/hooks";
import { useInboxConversations } from "@/features/inbox/hooks";
import { centsFromCurrencyInput, PROPOSAL_STATUS_LABEL, timelineEventLabel } from "@/features/crm/presentation";
import type { Contact, Deal, Product, Proposal, ProposalStatus } from "@/features/crm/types";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type DraftItem = { productId?: string; name: string; quantity: number; unitPriceCents: number };
type ProposalSection = "summary" | "items" | "history";

const STATUS_OPTIONS: ProposalStatus[] = ["draft", "sent", "viewed", "accepted", "rejected", "expired"];

export default function ProposalsPage() {
  return (
    <Suspense fallback={<ProposalsFallback />}>
      <ProposalsView />
    </Suspense>
  );
}

function ProposalsFallback() {
  return (
    <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-8">
      <Skeleton className="h-8 w-36" />
      <Skeleton className="mt-4 h-14 rounded-xl" />
      <div className="mt-5"><ProposalGridSkeleton /></div>
    </main>
  );
}

function ProposalsView() {
  const searchParams = useSearchParams();
  const workspace = useCurrentWorkspace();
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [contactFilter, setContactFilter] = useState("");
  const [dealFilter, setDealFilter] = useState("");
  const [view, setView] = useState<"proposals" | "templates">("proposals");

  const { data: proposals, error, isLoading, mutate } = useProposals(workspace.id, { status: statusFilter === "all" ? undefined : statusFilter });
  const { data: products } = useProducts(workspace.id, { activeOnly: true });
  const { data: templates } = useProposalTemplates(workspace.id, true);
  const { data: contacts } = useContacts(workspace.id);
  const { data: deals } = useDeals(workspace.id);
  const { data: conversations } = useInboxConversations(workspace.id);

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = proposals?.find((proposal) => proposal.id === selectedId);
  const [sendingId, setSendingId] = useState<string | undefined>();
  // Item 36 do pedido — depois de uma recusa, a tela central também precisa oferecer "Criar
  // follow-up"/"Marcar negócio como perdido" (antes só os pontos de entrada contextuais —
  // Conversa/Deal/Contact 360 — tinham isso; a central ficava só com o motivo, sem ação).
  const [creatingFollowUpFor, setCreatingFollowUpFor] = useState<Proposal | undefined>();
  const [lossPromptFor, setLossPromptFor] = useState<Proposal | undefined>();
  const lossPromptDeal = (deals ?? []).find((deal) => deal.id === lossPromptFor?.dealId);
  const { data: lossPromptStages } = usePipelineStages(lossPromptDeal?.pipelineId, workspace.id);
  const [lossBusy, setLossBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState(searchParams.get("contactId") ?? "");
  const [dealId, setDealId] = useState(searchParams.get("dealId") ?? "");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [discountReais, setDiscountReais] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [conditions, setConditions] = useState("");
  const [templateId, setTemplateId] = useState("none");
  const [busy, setBusy] = useState(false);
  const [newLink, setNewLink] = useState<string | undefined>();

  const contactsList = contacts ?? [];
  const dealsList = deals ?? [];
  const productsList = products ?? [];

  useEffect(() => {
    const queryContactId = searchParams.get("contactId");
    const queryDealId = searchParams.get("dealId");
    if (queryContactId || queryDealId) {
      setContactId(queryContactId ?? "");
      setDealId(queryDealId ?? "");
      setCreateOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const deal = dealsList.find((item) => item.id === dealId);
    if (deal?.contactId && !contactId) setContactId(deal.contactId);
    if (deal && !title) setTitle(`Proposta · ${deal.title}`);
  }, [contactId, dealId, dealsList, title]);

  const visibleProposals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (proposals ?? [])
      .filter((proposal) => !contactFilter || proposal.contactId === contactFilter)
      .filter((proposal) => !dealFilter || proposal.dealId === dealFilter)
      .filter((proposal) => {
        if (!q) return true;
        const contact = contactsList.find((item) => item.id === proposal.contactId);
        const deal = dealsList.find((item) => item.id === proposal.dealId);
        return `${proposal.title} ${contact?.name ?? ""} ${deal?.title ?? ""}`.toLowerCase().includes(q);
      });
  }, [contactFilter, contactsList, dealFilter, dealsList, proposals, search]);

  function addProductItem(productId: string) {
    const product = productsList.find((item) => item.id === productId);
    if (!product) return;
    setItems((current) => [...current, { productId: product.id, name: product.name, quantity: 1, unitPriceCents: product.priceCents }]);
  }

  function addCustomItem() {
    setItems((current) => [...current, { name: "", quantity: 1, unitPriceCents: 0 }]);
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, i) => i !== index));
  }

  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const discountCents = centsFromCurrencyInput(discountReais);
  const totalCents = Math.max(0, subtotalCents - discountCents);
  const contactOptions = contactsList.map((contact) => ({ id: contact.id, label: contact.company ? `${contact.name} · ${contact.company}` : contact.name }));
  const dealOptions = dealsList.map((deal) => ({ id: deal.id, label: deal.title }));

  async function handleCreate() {
    setBusy(true);
    try {
      const { publicToken } = await createProposal({
        workspaceId: workspace.id,
        contactId: contactId || undefined,
        dealId: dealId || undefined,
        title: title.trim(),
        items: items.filter((item) => item.name.trim()).map((item) => ({ productId: item.productId, name: item.name.trim(), quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
        discountCents,
        validUntil: validUntil || undefined,
        conditions: conditions.trim() || undefined,
      });
      setCreateOpen(false);
      setNewLink(`${window.location.origin}/p/${publicToken}`);
      resetCreateForm();
      await mutate();
      toast.success("Proposta criada.");
    } catch (cause) {
      toast.error("Não foi possível criar a proposta", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    if (id === "none") return;
    const template = templates?.find((item) => item.id === id);
    if (!template) return;
    setTitle(template.defaultTitle);
    setItems(template.defaultItems.map((item) => ({ productId: item.productId, name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents })));
    setConditions(template.defaultConditions ?? "");
    const date = new Date(); date.setDate(date.getDate() + template.defaultValidDays);
    setValidUntil(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
  }

  async function handleSend(proposal: Proposal) {
    setSendingId(proposal.id);
    try {
      const conversation = conversations?.conversations.find((item) => item.crmContactId === proposal.contactId);
      if (!conversation) throw new Error("Este contato não possui conversa vinculada para envio.");
      const contact = contactsList.find((item) => item.id === proposal.contactId);
      const message = `${contact?.name ? `Olá, ${contact.name}! ` : "Olá! "}Preparei sua proposta comercial.\n\nVocê pode visualizar aqui:\n{{proposalUrl}}`;
      await sendProposal(proposal.id, { workspaceId: workspace.id, conversationId: conversation.id, message, idempotencyKey: crypto.randomUUID() });
      await mutate();
      toast.success(proposal.status === "draft" ? "Proposta enviada." : "Proposta reenviada.");
    } catch (cause) {
      toast.error("Não foi possível enviar", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setSendingId(undefined);
    }
  }

  function handleCreateNewProposalFrom(proposal: Proposal) {
    setSelectedId(undefined);
    setContactId(proposal.contactId ?? "");
    setDealId(proposal.dealId ?? "");
    setTitle("");
    setCreateOpen(true);
  }

  async function handleConfirmLossReason(reason: string) {
    if (!lossPromptFor || !lossPromptDeal) return;
    const lostStage = lossPromptStages?.find((stage) => stage.isLost);
    if (!lostStage) {
      toast.error("Este pipeline não tem uma etapa de perda configurada.");
      return;
    }
    setLossBusy(true);
    try {
      await moveDealStage(lossPromptDeal.id, workspace.id, lostStage.id, reason);
      toast.success("Negócio marcado como perdido.");
      setLossPromptFor(undefined);
      setSelectedId(undefined);
    } catch (cause) {
      toast.error("Não foi possível marcar o negócio como perdido", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally {
      setLossBusy(false);
    }
  }

  function resetCreateForm() {
    setTitle("");
    setContactId("");
    setDealId("");
    setItems([]);
    setDiscountReais("");
    setValidUntil("");
    setConditions("");
    setTemplateId("none");
  }

  if (view === "templates") {
    return <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-8"><div className="mb-5 flex items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Propostas</h1><div className="mt-3 flex gap-2"><Button variant="secondary" onClick={() => setView("proposals")}>Propostas</Button><Button onClick={() => setView("templates")}>Modelos</Button></div></div></div><ProposalTemplatesPanel workspaceId={workspace.id} /></main>;
  }

  return (
    <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Propostas</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Crie, envie e acompanhe propostas conectadas a contatos e negocios reais.</p>
        </div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setView("templates")}>Modelos</Button><Button onClick={() => setCreateOpen(true)}>Nova proposta</Button></div>
      </div>

      <FilterBar summary={`${visibleProposals.length} propostas`}>
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar proposta, cliente ou negócio" className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ProposalStatus | "all")}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            {STATUS_OPTIONS.map((status) => <SelectItem key={status} value={status}>{PROPOSAL_STATUS_LABEL[status]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary"><SlidersHorizontal className="mr-2 h-4 w-4" /> Filtros</Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(380px,calc(100vw-2rem))] space-y-3">
            <div>
              <Label>Contato</Label>
              <SearchableCombo items={contactOptions} value={contactFilter} onValueChange={setContactFilter} placeholder="Contato" extraOption={{ value: "", label: "Todos" }} />
            </div>
            <div>
              <Label>Negocio</Label>
              <SearchableCombo items={dealOptions} value={dealFilter} onValueChange={setDealFilter} placeholder="Negócio" extraOption={{ value: "", label: "Todos" }} />
            </div>
          </PopoverContent>
        </Popover>
      </FilterBar>

      {isLoading ? <ProposalGridSkeleton /> : null}
      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}
      {!isLoading && !error && visibleProposals.length === 0 ? (
        <EmptyState
          title="Nenhuma proposta nesta visão"
          description="Crie uma proposta vinculada a um contato ou negócio para acompanhar envio, visualização e aceite."
          action={<Button onClick={() => setCreateOpen(true)}>Criar proposta</Button>}
        />
      ) : null}

      {!isLoading && !error && visibleProposals.length > 0 ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleProposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              contact={contactsList.find((contact) => contact.id === proposal.contactId)}
              deal={dealsList.find((deal) => deal.id === proposal.dealId)}
              sending={sendingId === proposal.id}
              onOpen={() => setSelectedId(proposal.id)}
              onSend={() => handleSend(proposal)}
            />
          ))}
        </section>
      ) : null}

      {createOpen ? (
        <Modal title="Nova proposta" onClose={() => { setCreateOpen(false); resetCreateForm(); }} maxWidthClass="sm:max-w-3xl">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="proposal-template">Modelo</Label><Select value={templateId} onValueChange={applyTemplate}><SelectTrigger id="proposal-template"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem modelo</SelectItem>{(templates ?? []).map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="sm:col-span-2">
              <Label htmlFor="proposal-title">Titulo</Label>
              <Input id="proposal-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Proposta · Plano Pro" />
            </div>
            <div>
              <Label>Contato</Label>
              <SearchableCombo items={contactOptions} value={contactId} onValueChange={setContactId} placeholder="Contato" extraOption={{ value: "", label: "Sem contato" }} />
            </div>
            <div>
              <Label>Negocio</Label>
              <SearchableCombo items={dealOptions} value={dealId} onValueChange={setDealId} placeholder="Negócio" extraOption={{ value: "", label: "Sem negócio" }} />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <Label>Itens</Label>
            {items.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-xl border border-border/70 bg-muted/20 p-2 sm:grid-cols-[minmax(0,1fr)_80px_120px_auto] sm:items-center">
                <Input value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} placeholder="Item" />
                <Input type="number" min={1} value={item.quantity} onChange={(event) => updateItem(index, { quantity: Number(event.target.value) || 1 })} aria-label="Quantidade" />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={(item.unitPriceCents / 100).toFixed(2)}
                  onChange={(event) => updateItem(index, { unitPriceCents: centsFromCurrencyInput(event.target.value) })}
                  aria-label="Valor unitario"
                />
                <Button variant="ghost" onClick={() => removeItem(index)}>Remover</Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {productsList.length > 0 ? (
                <SearchableCombo items={productsList.map((product) => ({ id: product.id, label: product.name }))} value="" onValueChange={addProductItem} placeholder="Adicionar do catálogo" className="w-56" />
              ) : null}
              <Button variant="secondary" onClick={addCustomItem}>Item avulso</Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="proposal-discount">Desconto</Label>
              <Input id="proposal-discount" value={discountReais} onChange={(event) => setDiscountReais(event.target.value)} placeholder="0,00" inputMode="decimal" />
            </div>
            <div>
              <Label htmlFor="proposal-valid-until">Validade</Label>
              <Input id="proposal-valid-until" type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="proposal-conditions">Condicoes</Label>
              <Textarea id="proposal-conditions" value={conditions} onChange={(event) => setConditions(event.target.value)} rows={3} />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm font-semibold text-foreground">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrencyCents(totalCents)}</span>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setCreateOpen(false); resetCreateForm(); }} disabled={busy}>Cancelar</Button>
            <Button onClick={handleCreate} loading={busy} disabled={!title.trim() || items.filter((item) => item.name.trim()).length === 0 || busy}>Criar</Button>
          </div>
        </Modal>
      ) : null}

      {newLink ? (
        <Modal title="Proposta criada" onClose={() => setNewLink(undefined)}>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Este link bruto e exibido somente agora. O token salvo no backend permanece protegido.</p>
            <Input readOnly value={newLink} onFocus={(event) => event.target.select()} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(newLink); toast.success("Link copiado."); }}>
                <Copy className="mr-2 h-4 w-4" /> Copiar
              </Button>
              <Button onClick={() => setNewLink(undefined)}>Fechar</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ProposalDetailModal
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) setSelectedId(undefined); }}
        workspaceId={workspace.id}
        proposal={selected}
        contact={contactsList.find((contact) => contact.id === selected?.contactId)}
        deal={dealsList.find((deal) => deal.id === selected?.dealId)}
        products={productsList}
        sending={selected ? sendingId === selected.id : false}
        onSend={(proposal) => handleSend(proposal)}
        onChanged={mutate}
        onCreateNewProposal={handleCreateNewProposalFrom}
        onCreateFollowUp={(proposal) => { setSelectedId(undefined); setCreatingFollowUpFor(proposal); }}
        onMarkDealLost={(proposal) => { setSelectedId(undefined); setLossPromptFor(proposal); }}
      />

      {creatingFollowUpFor ? (
        <QuickCreateTaskModal
          workspaceId={workspace.id}
          contactId={creatingFollowUpFor.contactId}
          dealChoice={creatingFollowUpFor.dealId ? { mode: "auto", dealId: creatingFollowUpFor.dealId } : { mode: "none" }}
          title="Criar follow-up"
          onClose={() => setCreatingFollowUpFor(undefined)}
          onCreated={async () => {
            setCreatingFollowUpFor(undefined);
            toast.success("Follow-up criado.");
          }}
        />
      ) : null}

      {lossPromptFor ? (
        <LossReasonModal onClose={() => setLossPromptFor(undefined)} onConfirm={handleConfirmLossReason} busy={lossBusy} />
      ) : null}
    </main>
  );
}

function ProposalCard({
  proposal,
  contact,
  deal,
  sending,
  onOpen,
  onSend,
}: {
  proposal: Proposal;
  contact: Contact | undefined;
  deal: Deal | undefined;
  sending: boolean;
  onOpen: () => void;
  onSend: () => void;
}) {
  return (
    <article className="rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
      <button type="button" onClick={onOpen} className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{proposal.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{contact?.name ?? "Sem contato"}{deal ? ` · ${deal.title}` : ""}</p>
          </div>
          <StatusBadge status={proposal.status} />
        </div>
        <p className="mt-4 text-2xl font-semibold tabular-nums text-foreground">{formatCurrencyCents(proposal.totalCents, proposal.currency)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <MiniMetric label="Validade" value={formatDate(proposal.validUntil)} />
          <MiniMetric label="Atualizada" value={formatDate(proposal.updatedAt)} />
        </div>
      </button>
      {proposal.status === "draft" ? (
        <Button variant="secondary" className="mt-3 w-full" loading={sending} disabled={sending} onClick={onSend}>
          <Send className="mr-2 h-4 w-4" /> Enviar
        </Button>
      ) : null}
    </article>
  );
}

const REJECTION_REASON_LABEL: Record<string, string> = { price: "Preço", deadline: "Prazo", scope: "Escopo", other: "Outro" };

function ProposalDetailModal({
  open,
  onOpenChange,
  workspaceId,
  proposal,
  contact,
  deal,
  products,
  sending,
  onSend,
  onChanged,
  onCreateNewProposal,
  onCreateFollowUp,
  onMarkDealLost,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  proposal: Proposal | undefined;
  contact: Contact | undefined;
  deal: Deal | undefined;
  products: readonly Product[];
  sending: boolean;
  onSend: (proposal: Proposal) => void | Promise<void>;
  onChanged: () => void | Promise<unknown>;
  /** Item 36 do pedido — recusar uma proposta nunca significa perder o negócio automaticamente;
   * essas 3 ações continuam sendo decisão humana, oferecidas aqui na tela central (antes só
   * existiam nos pontos de entrada contextuais — Conversa/Deal/Contact 360). */
  onCreateNewProposal?: (proposal: Proposal) => void;
  onCreateFollowUp?: (proposal: Proposal) => void;
  onMarkDealLost?: (proposal: Proposal) => void;
}) {
  const [section, setSection] = useState<ProposalSection>("summary");
  const [publicLink, setPublicLink] = useState<string>();
  const [linkBusy, setLinkBusy] = useState(false);
  const { data: timeline, isLoading: timelineLoading, error: timelineError, mutate: mutateTimeline } = useProposalTimeline(proposal?.id, workspaceId);

  if (!proposal) return null;

  return (
    <DetailModal
      open={open}
      onOpenChange={onOpenChange}
      title={proposal.title}
      description={<span className="text-sm text-muted-foreground">{contact?.name ?? "Sem contato"}{deal ? ` · ${deal.title}` : ""}</span>}
      eyebrow="Proposta"
      avatar={<span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ai-soft text-ai"><FileText className="h-5 w-5" /></span>}
      headerExtra={<StatusBadge status={proposal.status} />}
      sections={[
        { value: "summary", label: "Resumo", icon: Info },
        { value: "items", label: "Itens", icon: FileText, badge: proposal.items.length || undefined },
        { value: "history", label: "Histórico", icon: History },
      ]}
      value={section}
      onValueChange={(value) => setSection(value as ProposalSection)}
      widthStorageKey="proposal-detail-modal-width"
      defaultWidthPercent={68}
    >
      {section === "summary" ? (
        <div className="space-y-7">
          <DetailBlock
            label="Resumo"
            action={["draft", "sent", "viewed"].includes(proposal.status) ? <Button size="sm" loading={sending} disabled={sending} onClick={() => { void onSend(proposal); }}>{proposal.status === "draft" ? "Enviar proposta" : "Reenviar proposta"}</Button> : undefined}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoCell label="Cliente" value={contact?.name ?? "Sem contato"} />
              <InfoCell label="Negócio" value={deal?.title ?? "Sem negócio"} />
              <InfoCell label="Status" value={PROPOSAL_STATUS_LABEL[proposal.status]} />
              <InfoCell label="Total" value={formatCurrencyCents(proposal.totalCents, proposal.currency)} strong />
              <InfoCell label="Validade" value={formatDate(proposal.validUntil)} />
              <InfoCell label="Criada" value={formatDateTime(proposal.createdAt)} />
              <InfoCell label="Enviada" value={formatDateTime(proposal.sentAt)} />
              <InfoCell label="Primeira visualização" value={formatDateTime(proposal.viewedAt)} />
              <InfoCell label="Última visualização" value={formatDateTime(proposal.lastViewedAt)} />
              <InfoCell label="Visualizações" value={String(proposal.viewCount ?? 0)} />
              <InfoCell label="Respondida" value={formatDateTime(proposal.respondedAt)} />
            </div>
            {proposal.conditions ? <p className="mt-4 rounded-xl bg-muted/30 px-3 py-3 text-sm text-muted-foreground">{proposal.conditions}</p> : null}
          </DetailBlock>

          {proposal.status === "rejected" ? (
            <DetailBlock label="Proposta recusada">
              <p className="text-sm text-muted-foreground">
                Motivo: {proposal.rejectionReason ? REJECTION_REASON_LABEL[proposal.rejectionReason] ?? proposal.rejectionReason : "Não informado"}
                {proposal.rejectionComment ? ` · ${proposal.rejectionComment}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">O negócio continua aberto — recusar uma proposta não significa perder a venda.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => onCreateNewProposal?.(proposal)}>Criar nova proposta</Button>
                {onCreateFollowUp ? <Button variant="secondary" onClick={() => onCreateFollowUp(proposal)}>Criar follow-up</Button> : null}
                {onMarkDealLost && deal ? <Button variant="ghost" onClick={() => onMarkDealLost(proposal)}>Marcar negócio como perdido</Button> : null}
              </div>
            </DetailBlock>
          ) : null}

          <DetailBlock label="Link publico">
            <p className="text-sm text-muted-foreground">O token bruto nao e armazenado. Gerar outro link invalida o anterior.</p>
            {publicLink ? <Input className="mt-2" readOnly value={publicLink} onFocus={(event) => event.target.select()} /> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" loading={linkBusy} disabled={linkBusy || !["draft", "sent", "viewed"].includes(proposal.status)} onClick={async () => { setLinkBusy(true); try { const result = await regenerateProposalLink(proposal.id, workspaceId); setPublicLink(`${window.location.origin}/p/${result.publicToken}`); await onChanged(); } catch (cause) { toast.error("Nao foi possivel gerar o link", { description: cause instanceof Error ? cause.message : "Tente novamente." }); } finally { setLinkBusy(false); } }}>Gerar novo link</Button>
              <Button variant="ghost" disabled={linkBusy || Boolean(proposal.publicLinkRevokedAt)} onClick={async () => { setLinkBusy(true); try { await revokeProposalLink(proposal.id, workspaceId); await onChanged(); toast.success("Link revogado."); } catch (cause) { toast.error("Nao foi possivel revogar o link", { description: cause instanceof Error ? cause.message : "Tente novamente." }); } finally { setLinkBusy(false); } }}>Revogar link</Button>
              {publicLink ? <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(publicLink)}>Copiar</Button> : null}
            </div>
          </DetailBlock>
        </div>
      ) : null}

      {section === "items" ? (
        <ListBlock empty="Nenhum item nesta proposta.">
          {proposal.items.map((item, index) => {
            const product = item.productId ? products.find((candidate) => candidate.id === item.productId) : undefined;
            return (
              <div key={`${item.name}-${index}`} className="rounded-xl border border-border/70 bg-card px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  <p className="text-sm font-semibold tabular-nums text-foreground">{formatCurrencyCents(item.subtotalCents, proposal.currency)}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.quantity}x {formatCurrencyCents(item.unitPriceCents, proposal.currency)}{product ? ` · catálogo: ${product.name}` : ""}
                </p>
              </div>
            );
          })}
          {proposal.discountCents > 0 ? (
            <div className="flex justify-between rounded-xl bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <span>Desconto</span>
              <span className="tabular-nums">- {formatCurrencyCents(proposal.discountCents, proposal.currency)}</span>
            </div>
          ) : null}
        </ListBlock>
      ) : null}

      {section === "history" ? (
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
  );
}

function ListBlock({ empty, children }: { empty: string; children: ReactNode }) {
  const count = Array.isArray(children) ? children.filter(Boolean).length : children ? 1 : 0;
  if (count === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
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

function ProposalGridSkeleton() {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="rounded-2xl border border-border/70 bg-card p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-4 h-8 w-32" />
          <Skeleton className="mt-3 h-12 rounded-lg" />
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
