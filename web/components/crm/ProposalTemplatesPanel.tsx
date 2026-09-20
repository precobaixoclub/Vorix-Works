"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { createProposalTemplate, deleteProposalTemplate, duplicateProposalTemplate, updateProposalTemplate } from "@/features/crm/api";
import { useProducts, useProposalTemplates } from "@/features/crm/hooks";
import { centsFromCurrencyInput } from "@/features/crm/presentation";
import type { ProposalTemplate } from "@/features/crm/types";
import { formatCurrencyCents } from "@/lib/format";

type Item = { productId?: string; name: string; quantity: number; unitPriceCents: number };

export function ProposalTemplatesPanel({ workspaceId }: { workspaceId: string }) {
  const { data, error, mutate } = useProposalTemplates(workspaceId, false);
  const { data: products } = useProducts(workspaceId, { activeOnly: true });
  const [editing, setEditing] = useState<ProposalTemplate | null | undefined>();
  const [busyId, setBusyId] = useState<string>();

  async function action(id: string, run: () => Promise<unknown>, message: string) {
    setBusyId(id);
    try { await run(); await mutate(); toast.success(message); }
    catch (cause) { toast.error("Não foi possível atualizar o modelo", { description: cause instanceof Error ? cause.message : "Tente novamente." }); }
    finally { setBusyId(undefined); }
  }

  if (error) return <p className="text-sm text-destructive">Não foi possível carregar os modelos.</p>;
  return <section className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Modelos de proposta</h2><p className="text-sm text-muted-foreground">Modelos preenchem uma nova proposta; alterações não afetam propostas existentes.</p></div><Button onClick={() => setEditing(null)}>Novo modelo</Button></div><div className="grid gap-3 md:grid-cols-2">{(data ?? []).map((template) => <article key={template.id} className="rounded-xl border bg-card p-4"><div className="flex justify-between gap-3"><div><p className="font-semibold">{template.name}</p><p className="text-sm text-muted-foreground">{template.defaultTitle}</p></div><span className={template.active ? "text-sm text-status-active" : "text-sm text-muted-foreground"}>{template.active ? "Ativo" : "Inativo"}</span></div><p className="mt-3 text-sm text-muted-foreground">{template.defaultItems.length} item(ns) · validade {template.defaultValidDays} dias</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => setEditing(template)}>Editar</Button><Button size="sm" variant="ghost" loading={busyId === template.id} onClick={() => action(template.id, () => duplicateProposalTemplate(template.id, workspaceId), "Modelo duplicado.")}>Duplicar</Button><Button size="sm" variant="ghost" onClick={() => action(template.id, () => updateProposalTemplate(template.id, workspaceId, { active: !template.active }), template.active ? "Modelo desativado." : "Modelo ativado.")}>{template.active ? "Desativar" : "Ativar"}</Button><Button size="sm" variant="ghost" onClick={() => action(template.id, () => deleteProposalTemplate(template.id, workspaceId), "Modelo excluído.")}>Excluir</Button></div></article>)}</div>{data?.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum modelo criado.</p> : null}{editing !== undefined ? <TemplateModal workspaceId={workspaceId} template={editing ?? undefined} products={products ?? []} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await mutate(); }} /> : null}</section>;
}

function TemplateModal({ workspaceId, template, products, onClose, onSaved }: { workspaceId: string; template?: ProposalTemplate; products: readonly { id: string; name: string; priceCents: number }[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [name, setName] = useState(template?.name ?? "");
  const [title, setTitle] = useState(template?.defaultTitle ?? "");
  const [items, setItems] = useState<Item[]>(template?.defaultItems.map((item) => ({ ...item })) ?? []);
  const [days, setDays] = useState(template?.defaultValidDays ?? 7);
  const [conditions, setConditions] = useState(template?.defaultConditions ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (template) { setName(template.name); setTitle(template.defaultTitle); } }, [template]);
  async function save() { setBusy(true); try { const input = { name: name.trim(), defaultTitle: title.trim(), defaultItems: items.filter((item) => item.name.trim()), defaultValidDays: days, defaultConditions: conditions.trim() || undefined }; if (template) await updateProposalTemplate(template.id, workspaceId, input); else await createProposalTemplate({ workspaceId, ...input }); await onSaved(); toast.success(template ? "Modelo atualizado." : "Modelo criado."); } catch (cause) { toast.error("Não foi possível salvar", { description: cause instanceof Error ? cause.message : "Tente novamente." }); } finally { setBusy(false); } }
  return <Modal title={template ? "Editar modelo" : "Novo modelo"} onClose={onClose} maxWidthClass="sm:max-w-3xl"><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="template-name">Nome do modelo</Label><Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} /></div><div><Label htmlFor="template-days">Validade padrão (dias)</Label><Input id="template-days" type="number" min={1} max={3650} value={days} onChange={(event) => setDays(Math.max(1, Number(event.target.value) || 1))} /></div><div className="sm:col-span-2"><Label htmlFor="template-title">Título padrão</Label><Input id="template-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div></div><div className="space-y-2"><Label>Itens padrão</Label>{items.map((item,index)=><div key={index} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_80px_120px_auto]"><Input aria-label={`Nome do item ${index+1}`} value={item.name} onChange={(event)=>setItems((all)=>all.map((value,pos)=>pos===index?{...value,name:event.target.value}:value))}/><Input aria-label={`Quantidade do item ${index+1}`} type="number" min={1} value={item.quantity} onChange={(event)=>setItems((all)=>all.map((value,pos)=>pos===index?{...value,quantity:Math.max(1,Number(event.target.value)||1)}:value))}/><Input aria-label={`Valor do item ${index+1}`} type="number" min={0} step="0.01" value={(item.unitPriceCents/100).toFixed(2)} onChange={(event)=>setItems((all)=>all.map((value,pos)=>pos===index?{...value,unitPriceCents:centsFromCurrencyInput(event.target.value)}:value))}/><Button variant="ghost" onClick={()=>setItems((all)=>all.filter((_,pos)=>pos!==index))}>Remover</Button></div>)}<div className="flex gap-2">{products.length?<SearchableCombo value="" onValueChange={(id)=>{const product=products.find((item)=>item.id===id);if(product)setItems((all)=>[...all,{productId:product.id,name:product.name,quantity:1,unitPriceCents:product.priceCents}]);}} items={products.map((product)=>({id:product.id,label:`${product.name} · ${formatCurrencyCents(product.priceCents)}`}))} placeholder="Adicionar produto" className="w-56"/>:null}<Button variant="secondary" onClick={()=>setItems((all)=>[...all,{name:"",quantity:1,unitPriceCents:0}])}>Item avulso</Button></div></div><div><Label htmlFor="template-conditions">Condições padrão</Label><Textarea id="template-conditions" rows={3} value={conditions} onChange={(event)=>setConditions(event.target.value)}/></div><div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={busy||!name.trim()||!title.trim()||!items.some((item)=>item.name.trim())} onClick={save}>Salvar modelo</Button></div></div></Modal>;
}
