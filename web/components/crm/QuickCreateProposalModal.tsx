"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createProposal } from "@/features/crm/api";
import { useProducts, useProposalTemplates } from "@/features/crm/hooks";
import { centsFromCurrencyInput } from "@/features/crm/presentation";
import type { TaskDealChoice } from "@/features/crm/task-scheduling";
import type { ProposalTemplate, ProposalWithToken } from "@/features/crm/types";
import { formatCurrencyCents } from "@/lib/format";

type Item = { productId?: string; name: string; quantity: number; unitPriceCents: number };

function dateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function QuickCreateProposalModal({ workspaceId, contactId, contactName, dealChoice, onClose, onCreated }: {
  workspaceId: string;
  contactId?: string;
  contactName?: string;
  dealChoice: TaskDealChoice;
  onClose: () => void;
  onCreated: (proposal: ProposalWithToken) => void | Promise<void>;
}) {
  const { data: templates } = useProposalTemplates(workspaceId, true);
  const { data: products } = useProducts(workspaceId, { activeOnly: true });
  const [templateId, setTemplateId] = useState("none");
  const [dealId, setDealId] = useState(dealChoice.mode === "auto" ? dealChoice.dealId : "");
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [discount, setDiscount] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [conditions, setConditions] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const total = useMemo(() => Math.max(0, items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0) - centsFromCurrencyInput(discount)), [discount, items]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    if (id === "none") return;
    const template = templates?.find((candidate) => candidate.id === id);
    if (!template) return;
    setTitle(template.defaultTitle);
    setItems(template.defaultItems.map((item) => ({ productId: item.productId, name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents })));
    setConditions(template.defaultConditions ?? "");
    setValidUntil(dateAfter(template.defaultValidDays));
  }

  function addProduct(productId: string) {
    const product = products?.find((candidate) => candidate.id === productId);
    if (product) setItems((current) => [...current, { productId: product.id, name: product.name, quantity: 1, unitPriceCents: product.priceCents }]);
  }

  async function submit() {
    setBusy(true);
    try {
      const proposal = await createProposal({ workspaceId, contactId, dealId: dealChoice.mode === "auto" ? dealChoice.dealId : dealChoice.mode === "choose" ? dealId || undefined : undefined, title: title.trim(), items: items.filter((item) => item.name.trim()), discountCents: centsFromCurrencyInput(discount), validUntil: validUntil || undefined, conditions: conditions.trim() || undefined });
      await onCreated(proposal);
      toast.success("Proposta criada.");
    } catch (cause) {
      toast.error("Não foi possível criar a proposta", { description: cause instanceof Error ? cause.message : "Tente novamente." });
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Gerar proposta" onClose={onClose} maxWidthClass="sm:max-w-3xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="proposal-template">Modelo</Label><Select value={templateId} onValueChange={applyTemplate}><SelectTrigger id="proposal-template"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem modelo</SelectItem>{(templates ?? []).map((template: ProposalTemplate) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Cliente</Label><Input value={contactName ?? "Contato selecionado"} readOnly /></div>
          {dealChoice.mode === "choose" ? <div className="sm:col-span-2"><Label htmlFor="proposal-deal">Negócio</Label><Select value={dealId || "none"} onValueChange={(value) => setDealId(value === "none" ? "" : value)}><SelectTrigger id="proposal-deal"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem negócio</SelectItem>{dealChoice.options.map((option) => <SelectItem key={option.id} value={option.id}>{option.title}</SelectItem>)}</SelectContent></Select></div> : null}
          <div className="sm:col-span-2"><Label htmlFor="proposal-title">Título</Label><Input id="proposal-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
        </div>

        <div className="space-y-2"><Label>Itens</Label>{items.map((item, index) => <div key={index} className="grid gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_80px_120px_auto]"><Input aria-label={`Nome do item ${index + 1}`} value={item.name} onChange={(event) => setItems((all) => all.map((value, position) => position === index ? { ...value, name: event.target.value } : value))} /><Input aria-label={`Quantidade do item ${index + 1}`} type="number" min={1} value={item.quantity} onChange={(event) => setItems((all) => all.map((value, position) => position === index ? { ...value, quantity: Math.max(1, Number(event.target.value) || 1) } : value))} /><Input aria-label={`Valor do item ${index + 1}`} type="number" min={0} step="0.01" value={(item.unitPriceCents / 100).toFixed(2)} onChange={(event) => setItems((all) => all.map((value, position) => position === index ? { ...value, unitPriceCents: centsFromCurrencyInput(event.target.value) } : value))} /><Button variant="ghost" onClick={() => setItems((all) => all.filter((_, position) => position !== index))}>Remover</Button></div>)}<div className="flex flex-wrap gap-2">{(products ?? []).length ? <SearchableCombo value="" onValueChange={addProduct} items={(products ?? []).map((product) => ({ id: product.id, label: product.name }))} placeholder="Adicionar do catálogo" className="w-56" /> : null}<Button variant="secondary" onClick={() => setItems((all) => [...all, { name: "", quantity: 1, unitPriceCents: 0 }])}>Item avulso</Button></div></div>

        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="proposal-discount">Desconto</Label><Input id="proposal-discount" value={discount} onChange={(event) => setDiscount(event.target.value)} inputMode="decimal" placeholder="0,00" /></div><div><Label htmlFor="proposal-validity">Validade</Label><Input id="proposal-validity" type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></div><div className="sm:col-span-2"><Label htmlFor="proposal-conditions">Condições</Label><Textarea id="proposal-conditions" value={conditions} onChange={(event) => setConditions(event.target.value)} rows={3} /></div></div>
        <div className="flex items-center justify-between border-t pt-3 font-semibold"><span>Total</span><span>{formatCurrencyCents(total)}</span></div>
        {preview ? <div className="rounded-xl border bg-muted/20 p-4"><p className="font-semibold">{title || "Sem título"}</p>{items.map((item, index) => <div key={index} className="mt-2 flex justify-between gap-3 text-sm"><span>{item.quantity}× {item.name}</span><span>{formatCurrencyCents(item.quantity * item.unitPriceCents)}</span></div>)}<p className="mt-3 border-t pt-2 text-right font-semibold">{formatCurrencyCents(total)}</p></div> : null}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setPreview((value) => !value)}>{preview ? "Ocultar" : "Visualizar"}</Button><Button onClick={submit} loading={busy} disabled={busy || !title.trim() || items.filter((item) => item.name.trim()).length === 0}>Criar proposta</Button></div>
      </div>
    </Modal>
  );
}
