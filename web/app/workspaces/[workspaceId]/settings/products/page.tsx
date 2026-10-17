"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Spinner } from "@/components/Spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { createProduct, updateProduct, type CreateProductInput } from "@/features/crm/api";
import { useProducts } from "@/features/crm/hooks";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import type { BillingType, Product } from "@/features/crm/types";
import { createVariant, deleteVariant } from "@/features/sales/api";
import { useCommercialSettings, useVariants } from "@/features/sales/hooks";
import { BILLING_SUFFIX, BILLING_TYPE_LABEL, formatBp } from "@/features/sales/presentation";
import { formatCurrencyCents } from "@/lib/format";

/**
 * Catálogo de produtos e serviços (Sales Engine): preços formais separados — custo, tabela,
 * mínimo — e tipo de cobrança. Custo só aparece/edita para quem pode ver custo; preço mínimo só a
 * gestão define (é o piso que dispara aprovação comercial).
 */
export default function ProductsPage() {
  const workspace = useCurrentWorkspace();
  const { data: products, error, isLoading, mutate } = useProducts(workspace.id);
  const { data: settings } = useCommercialSettings(workspace.id);
  const visibility = settings?.visibility ?? { canViewCost: false, canViewMargin: false, isManager: false };
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | "new" | undefined>();
  const [togglingId, setTogglingId] = useState<string | undefined>();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products ?? [];
    return (products ?? []).filter((product) => [product.name, product.code, product.category].some((value) => value?.toLowerCase().includes(query)));
  }, [products, search]);

  async function handleToggleActive(product: Product) {
    setTogglingId(product.id);
    try {
      await updateProduct(product.id, workspace.id, { active: !product.active } as never);
      await mutate();
    } catch (cause) {
      toast.error("Não foi possível alterar o status", { description: cause instanceof Error ? cause.message : undefined });
    } finally {
      setTogglingId(undefined);
    }
  }

  return (
    <SettingsShell
      active="products"
      title="Produtos e serviços"
      description="Catálogo comercial com custo, preço de tabela, preço mínimo e tipo de cobrança."
      actions={<Button onClick={() => setEditing("new")}>Novo produto</Button>}
    >
      <FilterBar summary={`${filtered.length} itens`}>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, código ou categoria" aria-label="Buscar produto" className="max-w-sm" />
      </FilterBar>

      <Card>
        <CardBody className="p-0">
          {isLoading ? <div className="flex justify-center py-14"><Spinner /></div> : null}
          {error ? <div className="p-5"><ErrorState error={error} onRetry={() => mutate()} /></div> : null}
          {!isLoading && !error && products && products.length === 0 ? (
            <div className="p-5"><EmptyState title="Nenhum produto ainda" description="Cadastre produtos ou serviços para montar oportunidades e propostas com preço, desconto e margem." /></div>
          ) : null}
          {!isLoading && !error && products && products.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Cobrança</TableHead>
                  <TableHead className="text-right">Tabela</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  {visibility.canViewCost ? <TableHead className="text-right">Custo</TableHead> : null}
                  {visibility.canViewCost ? <TableHead className="text-right">Margem na tabela</TableHead> : null}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Nenhum item encontrado.</TableCell></TableRow>
                ) : filtered.map((product) => {
                  const list = product.listPriceCents ?? product.priceCents;
                  const margin = product.costCents !== undefined && list > 0 ? Math.round(((list - product.costCents) * 10000) / list) : undefined;
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <p className="font-medium text-foreground">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{[product.code, product.category, product.itemType === "product" ? "Produto" : "Serviço"].filter(Boolean).join(" · ")}</p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{BILLING_TYPE_LABEL[product.billingType ?? "one_time"]}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrencyCents(list, product.currency)}{BILLING_SUFFIX[product.billingType ?? "one_time"] ?? ""}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{product.minimumPriceCents !== undefined ? formatCurrencyCents(product.minimumPriceCents, product.currency) : "—"}</TableCell>
                      {visibility.canViewCost ? <TableCell className="text-right tabular-nums text-muted-foreground">{product.costCents !== undefined ? formatCurrencyCents(product.costCents, product.currency) : "—"}</TableCell> : null}
                      {visibility.canViewCost ? <TableCell className="text-right tabular-nums">{formatBp(margin)}</TableCell> : null}
                      <TableCell><Badge variant={product.active ? "default" : "outline"}>{product.active ? "Ativo" : "Inativo"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setEditing(product)}>Editar</Button>
                          <Button variant="ghost" onClick={() => handleToggleActive(product)} loading={togglingId === product.id}>{product.active ? "Desativar" : "Ativar"}</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
        </CardBody>
      </Card>

      {editing ? (
        <ProductModal
          workspaceId={workspace.id}
          product={editing === "new" ? undefined : editing}
          canViewCost={visibility.canViewCost}
          isManager={visibility.isManager}
          onClose={() => setEditing(undefined)}
          onSaved={async () => { setEditing(undefined); await mutate(); }}
        />
      ) : null}
    </SettingsShell>
  );
}

function ProductModal({ workspaceId, product, canViewCost, isManager, onClose, onSaved }: { workspaceId: string; product?: Product; canViewCost: boolean; isManager: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(product?.name ?? "");
  const [code, setCode] = useState(product?.code ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [itemType, setItemType] = useState<"product" | "service">(product?.itemType ?? "service");
  const [billingType, setBillingType] = useState<BillingType>(product?.billingType ?? "one_time");
  const [unit, setUnit] = useState(product?.unit ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [list, setList] = useState(product ? currencyInputFromCents(product.listPriceCents ?? product.priceCents) : "");
  const [minimum, setMinimum] = useState(product?.minimumPriceCents !== undefined ? currencyInputFromCents(product.minimumPriceCents) : "");
  const [cost, setCost] = useState(product?.costCents !== undefined ? currencyInputFromCents(product.costCents) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const listCents = centsFromCurrencyInput(list);
  const costCents = cost.trim() ? centsFromCurrencyInput(cost) : undefined;
  const margin = costCents !== undefined && listCents > 0 ? Math.round(((listCents - costCents) * 10000) / listCents) : undefined;

  async function handleSave() {
    setBusy(true);
    setError(undefined);
    const payload: Omit<CreateProductInput, "workspaceId"> = {
      name: name.trim(),
      description: description.trim() || undefined,
      priceCents: listCents,
      code: code.trim() || null,
      category: category.trim() || null,
      itemType,
      billingType,
      unit: unit.trim() || null,
      ...(canViewCost ? { costCents: costCents ?? null } : {}),
      ...(isManager ? { minimumPriceCents: minimum.trim() ? centsFromCurrencyInput(minimum) : null } : {}),
    };
    try {
      if (product) await updateProduct(product.id, workspaceId, payload);
      else await createProduct({ workspaceId, ...payload });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^[A-Z_]+:\s*/, "") : "Não foi possível salvar o produto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={product ? "Editar produto" : "Novo produto"} onClose={onClose} maxWidthClass="sm:max-w-2xl">
      <div className="space-y-4">
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label htmlFor="product-name">Nome</Label><Input id="product-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus /></div>
          <div><Label htmlFor="product-code">Código/SKU</Label><Input id="product-code" value={code} onChange={(event) => setCode(event.target.value)} /></div>
          <div><Label htmlFor="product-category">Categoria</Label><Input id="product-category" value={category} onChange={(event) => setCategory(event.target.value)} /></div>
          <div>
            <Label>Tipo</Label>
            <Select value={itemType} onValueChange={(value) => setItemType(value as "product" | "service")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="service">Serviço</SelectItem><SelectItem value="product">Produto</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <Label>Cobrança</Label>
            <Select value={billingType} onValueChange={(value) => setBillingType(value as BillingType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(BILLING_TYPE_LABEL) as BillingType[]).map((key) => <SelectItem key={key} value={key}>{BILLING_TYPE_LABEL[key]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label htmlFor="product-unit">Unidade</Label><Input id="product-unit" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Ex.: licença, hora, m²" /></div>
        </div>

        <div className="grid gap-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-3">
          <div><Label htmlFor="product-list">Preço de tabela (R$)</Label><Input id="product-list" value={list} onChange={(event) => setList(event.target.value)} inputMode="decimal" /></div>
          <div>
            <Label htmlFor="product-min">Preço mínimo (R$)</Label>
            <Input id="product-min" value={minimum} onChange={(event) => setMinimum(event.target.value)} inputMode="decimal" disabled={!isManager} placeholder={isManager ? "Sem piso" : "Definido pela gestão"} />
          </div>
          {canViewCost ? (
            <div>
              <Label htmlFor="product-cost">Custo (R$)</Label>
              <Input id="product-cost" value={cost} onChange={(event) => setCost(event.target.value)} inputMode="decimal" placeholder="Desconhecido" />
              <p className="mt-1 text-[11px] text-muted-foreground">Margem na tabela: {formatBp(margin)}</p>
            </div>
          ) : null}
        </div>

        <div><Label htmlFor="product-description">Descrição</Label><Textarea id="product-description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></div>

        {product && isManager ? <VariantsEditor workspaceId={workspaceId} product={product} canViewCost={canViewCost} /> : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button onClick={handleSave} loading={busy} disabled={!name.trim() || busy}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}

function VariantsEditor({ workspaceId, product, canViewCost }: { workspaceId: string; product: Product; canViewCost: boolean }) {
  const { data: variants, mutate } = useVariants(workspaceId, product.id);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [minimum, setMinimum] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      <p className="text-sm font-medium">Variações (ex.: 10 / 20 / 50 usuários)</p>
      {(variants ?? []).map((variant) => (
        <div key={variant.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
          <span>{variant.name}</span>
          <span className="flex items-center gap-3 tabular-nums text-muted-foreground">
            {formatCurrencyCents(variant.listPriceCents, product.currency)}
            {variant.minimumPriceCents !== undefined ? ` · mín. ${formatCurrencyCents(variant.minimumPriceCents, product.currency)}` : ""}
            <Button variant="ghost" size="icon" aria-label="Remover variação" onClick={async () => { await deleteVariant(product.id, variant.id, workspaceId); await mutate(); }}><Trash2 className="h-4 w-4" /></Button>
          </span>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-5">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome" className="sm:col-span-2" />
        <Input value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Tabela" inputMode="decimal" />
        <Input value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="Mínimo" inputMode="decimal" />
        {canViewCost ? <Input value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Custo" inputMode="decimal" /> : null}
      </div>
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        disabled={!name.trim() || !price.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await createVariant(product.id, { workspaceId, name: name.trim(), listPriceCents: centsFromCurrencyInput(price), minimumPriceCents: minimum.trim() ? centsFromCurrencyInput(minimum) : undefined, costCents: canViewCost && cost.trim() ? centsFromCurrencyInput(cost) : undefined });
            setName(""); setPrice(""); setMinimum(""); setCost("");
            await mutate();
          } catch (cause) {
            toast.error("Não foi possível criar a variação", { description: cause instanceof Error ? cause.message : undefined });
          } finally {
            setBusy(false);
          }
        }}
      >
        + Adicionar variação
      </Button>
    </div>
  );
}
