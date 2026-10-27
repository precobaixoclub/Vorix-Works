"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { BriefcaseBusiness, Package, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Input, Label } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebounce } from "@/hooks/useDebounce";
import { addConversationProductToOpportunity, listConversationProducts, sendConversationProduct, type ConversationProduct } from "@/features/inbox/api";
import { useInvalidateSales } from "@/features/sales/hooks";
import { formatCurrencyCents } from "@/lib/format";

/** Botão "Produtos" do composer: o atendente busca no catálogo e o Vorix monta o card (foto, preço, link). */
export function ProductPickerButton({ disabled, onOpen }: { disabled?: boolean; onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={onOpen} aria-label="Produtos">
            <Package className="h-4 w-4" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabled ? "Você não pode enviar mensagens nesta conversa." : "Produtos do catálogo"}</TooltipContent>
    </Tooltip>
  );
}

export function ProductPickerModal({ workspaceId, conversationId, canAddToOpportunity, onClose, onSent }: { workspaceId: string; conversationId: string; canAddToOpportunity: boolean; onClose: () => void; onSent: () => void }) {
  const [search, setSearch] = useState("");
  const query = useDebounce(search.trim(), 250);
  const { data, error, isLoading, mutate } = useSWR(["conversation-products", workspaceId, conversationId, query], () => listConversationProducts(workspaceId, conversationId, query));
  const [selected, setSelected] = useState<ConversationProduct>();
  const [variantId, setVariantId] = useState<string>();
  const [withImage, setWithImage] = useState(true);
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState<"send" | "deal">();
  const [chooseDeal, setChooseDeal] = useState<{ id: string; title: string }[]>();
  const [confirmCreate, setConfirmCreate] = useState(false);
  const invalidateSales = useInvalidateSales(workspaceId);
  useEffect(() => { setVariantId(undefined); setQuantity("1"); setChooseDeal(undefined); }, [selected?.id]);

  const variant = selected?.variants.find((item) => item.id === variantId);
  const needsVariant = !!selected?.requiresVariant && !variant;
  const amount = Number(quantity.replace(",", "."));
  const validQuantity = Number.isFinite(amount) && amount > 0;
  const blockedReason = needsVariant ? "Escolha a opção do produto primeiro." : undefined;

  async function send() {
    if (!selected || needsVariant) return;
    setBusy("send");
    try {
      await sendConversationProduct(workspaceId, conversationId, { productId: selected.id, variantId, withImage: withImage && !!selected.imageUrl });
      toast.success("Produto enviado ao cliente.");
      onSent();
      onClose();
    } catch (caught) {
      toast.error("Não foi possível enviar o produto", { description: caught instanceof Error ? caught.message : "Tente novamente." });
    } finally { setBusy(undefined); }
  }

  async function addToDeal(options: { dealId?: string; createIfMissing?: boolean } = {}) {
    if (!selected || needsVariant || !validQuantity) return;
    setBusy("deal");
    try {
      const result = await addConversationProductToOpportunity(workspaceId, conversationId, { productId: selected.id, variantId, quantity: amount, ...options });
      if (result.status === "added") {
        toast.success(result.created ? "Oportunidade criada com o produto." : `Produto adicionado em "${result.dealTitle}".`);
        await invalidateSales();
        setChooseDeal(undefined);
      } else if (result.status === "choose") setChooseDeal(result.deals);
      else if (result.status === "no_deal") setConfirmCreate(true);
      else toast.error("Este contato ainda não tem um número de telefone confirmado para vincular ao CRM.");
    } catch (caught) {
      toast.error("Não foi possível adicionar à oportunidade", { description: caught instanceof Error ? caught.message : "Tente novamente." });
    } finally { setBusy(undefined); }
  }

  return (
    <Modal title="Produtos" onClose={onClose} maxWidthClass="sm:max-w-2xl">
      {!selected ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="conversation-product-search">Buscar por nome, SKU ou categoria</Label>
            <Input id="conversation-product-search" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ex.: camiseta, SKU-123" />
          </div>
          {error ? (
            <div className="space-y-2 text-sm"><p>Não foi possível carregar o catálogo.</p><Button variant="secondary" size="sm" onClick={() => void mutate()}>Tentar novamente</Button></div>
          ) : isLoading && !data ? (
            <p className="text-sm text-muted-foreground">Carregando produtos...</p>
          ) : !data?.length ? (
            <p className="text-sm text-muted-foreground">{query ? "Nenhum produto encontrado com essa busca." : "Nenhum produto ativo no catálogo."}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Resultados">
              {data.map((product) => (
                <li key={product.id}>
                  <button type="button" onClick={() => setSelected(product)} className="flex w-full items-center gap-3 rounded-lg border border-border/60 p-2 text-left transition-colors hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-muted-foreground" />}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{product.name}</span>
                      <span className="block text-xs tabular-nums text-muted-foreground">{formatCurrencyCents(product.priceCents, product.currency)}{product.sku ? ` · ${product.sku}` : ""}</span>
                      {product.availableQuantity === 0 ? <span className="text-xs text-amber-600 dark:text-amber-400">Sem estoque</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-3">
            <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">{selected.imageUrl ? <img src={selected.imageUrl} alt="" className="h-full w-full object-cover" /> : <Package className="h-6 w-6 text-muted-foreground" />}</span>
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{selected.name}</p>
              <p className="text-sm tabular-nums">{formatCurrencyCents(variant?.priceCents ?? selected.priceCents, selected.currency)}</p>
              {selected.description ? <p className="text-xs text-muted-foreground">{selected.description}</p> : null}
              <p className="text-xs text-muted-foreground">{selected.siteUrl ? "O link do produto no site vai junto." : "Produto fora do site publicado: vai sem link."}</p>
            </div>
          </div>
          {selected.requiresVariant ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Opção</legend>
              <div className="flex flex-wrap gap-2">
                {selected.variants.map((item) => (
                  <button key={item.id} type="button" aria-pressed={variantId === item.id} onClick={() => setVariantId(item.id)} className={`min-h-10 rounded-full border px-3 text-sm ${variantId === item.id ? "border-primary bg-primary/10" : "border-border"} ${item.availableQuantity === 0 ? "opacity-60" : ""}`}>
                    {item.label}{item.availableQuantity === 0 ? " · sem estoque" : ""}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={withImage && !!selected.imageUrl} disabled={!selected.imageUrl} onChange={(event) => setWithImage(event.target.checked)} /> Enviar com a foto</label>
          {chooseDeal ? (
            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <p className="text-sm font-medium">Em qual oportunidade?</p>
              {chooseDeal.map((deal) => <Button key={deal.id} variant="secondary" size="sm" className="mr-2" disabled={!!busy} onClick={() => void addToDeal({ dealId: deal.id })}>{deal.title}</Button>)}
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-end sm:justify-between">
            <Button variant="ghost" onClick={() => setSelected(undefined)}>Voltar à busca</Button>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              {canAddToOpportunity ? (
                <div className="flex items-end gap-2">
                  <div className="w-20"><Label htmlFor="conversation-product-quantity">Qtd.</Label><Input id="conversation-product-quantity" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
                  <Tooltip><TooltipTrigger asChild><span className="inline-flex"><Button variant="secondary" loading={busy === "deal"} disabled={!!busy || needsVariant || !validQuantity} onClick={() => void addToDeal()}><BriefcaseBusiness className="h-4 w-4" />Adicionar à oportunidade</Button></span></TooltipTrigger>{blockedReason ? <TooltipContent>{blockedReason}</TooltipContent> : null}</Tooltip>
                </div>
              ) : null}
              <Tooltip><TooltipTrigger asChild><span className="inline-flex"><Button loading={busy === "send"} disabled={!!busy || needsVariant} onClick={() => void send()}><Send className="h-4 w-4" />Enviar ao cliente</Button></span></TooltipTrigger>{blockedReason ? <TooltipContent>{blockedReason}</TooltipContent> : null}</Tooltip>
            </div>
          </div>
        </div>
      )}
      {confirmCreate && selected ? (
        <ConfirmDialog open title="Criar oportunidade com este produto?" description={`Este contato não tem oportunidade aberta. Uma nova oportunidade será criada com ${selected.name}${variant ? ` (${variant.label})` : ""} e você como responsável.`} confirmLabel="Criar oportunidade" onCancel={() => setConfirmCreate(false)} onConfirm={() => { setConfirmCreate(false); void addToDeal({ createIfMissing: true }); }} />
      ) : null}
    </Modal>
  );
}
