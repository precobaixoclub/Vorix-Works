"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PackageSearch, Power, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FilterBar } from "@/components/FilterBar";
import { Input, Label, MoneyInput, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Spinner } from "@/components/Spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const lowStockOnly = searchParams.get("lowStock") === "1";
  const lowStockCount = (products ?? []).filter((product) => product.lowStock && product.active).length;
  const hasStockControl = (products ?? []).some((product) => product.trackStock);

  function setLowStockOnly(next: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("lowStock", "1");
    else params.delete("lowStock");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const base = lowStockOnly ? (products ?? []).filter((product) => product.lowStock) : products ?? [];
    if (!query) return base;
    return base.filter((product) => [product.name, product.code, product.category].some((value) => value?.toLowerCase().includes(query)));
  }, [products, search, lowStockOnly]);

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
      {lowStockCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 text-foreground">
            <TriangleAlert className="h-4 w-4 text-warning" />
            {lowStockCount === 1 ? "1 produto chegou ao ponto de reposição — hora de comprar mais." : `${lowStockCount} produtos chegaram ao ponto de reposição — hora de comprar mais.`}
          </span>
          {!lowStockOnly ? <Button variant="secondary" size="sm" onClick={() => setLowStockOnly(true)}>Ver produtos</Button> : null}
        </div>
      ) : null}

      <FilterBar summary={`${filtered.length} itens`}>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, código ou categoria" aria-label="Buscar produto" className="max-w-sm" />
        {hasStockControl ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={lowStockOnly} onCheckedChange={setLowStockOnly} aria-label="Só estoque baixo" />
            Só estoque baixo
          </label>
        ) : null}
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
                  <TableHead className="text-right">Tabela</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  {hasStockControl ? <TableHead className="text-right">Estoque</TableHead> : null}
                  {visibility.canViewCost ? <TableHead className="text-right">Custo</TableHead> : null}
                  {visibility.canViewCost ? <TableHead className="text-right">Margem</TableHead> : null}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">{lowStockOnly ? "Nenhum produto com estoque baixo." : "Nenhum item encontrado."}</TableCell></TableRow>
                ) : filtered.map((product) => {
                  const list = product.listPriceCents ?? product.priceCents;
                  const margin = product.costCents !== undefined && list > 0 ? Math.round(((list - product.costCents) * 10000) / list) : undefined;
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <p className="min-w-[160px] font-medium text-foreground">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{[product.code, product.category, product.itemType === "product" ? "Produto" : "Serviço", BILLING_TYPE_LABEL[product.billingType ?? "one_time"]].filter(Boolean).join(" · ")}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrencyCents(list, product.currency)}{BILLING_SUFFIX[product.billingType ?? "one_time"] ?? ""}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{product.minimumPriceCents !== undefined ? formatCurrencyCents(product.minimumPriceCents, product.currency) : "—"}</TableCell>
                      {hasStockControl ? <TableCell className="text-right"><StockCell product={product} /></TableCell> : null}
                      {visibility.canViewCost ? <TableCell className="text-right tabular-nums text-muted-foreground">{product.costCents !== undefined ? formatCurrencyCents(product.costCents, product.currency) : "—"}</TableCell> : null}
                      {visibility.canViewCost ? <TableCell className="text-right tabular-nums">{formatBp(margin)}</TableCell> : null}
                      <TableCell><Badge variant={product.active ? "default" : "outline"}>{product.active ? "Ativo" : "Inativo"}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(product)}>Editar</Button>
                          <Button variant="ghost" size="icon" onClick={() => handleToggleActive(product)} loading={togglingId === product.id} aria-label={product.active ? `Desativar ${product.name}` : `Ativar ${product.name}`} title={product.active ? "Desativar" : "Ativar"}><Power className={product.active ? "h-4 w-4" : "h-4 w-4 text-muted-foreground"} /></Button>
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
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? false);
  const [stock, setStock] = useState(product?.stockQuantity !== undefined ? formatQuantityInput(product.stockQuantity) : "");
  const [alertAt, setAlertAt] = useState(product?.stockAlertThreshold !== undefined ? formatQuantityInput(product.stockAlertThreshold) : "");
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
      trackStock,
      ...(trackStock ? { stockQuantity: quantityFromInput(stock) ?? 0, stockAlertThreshold: quantityFromInput(alertAt) ?? null } : {}),
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
    <Modal title={product ? "Editar produto" : "Novo produto"} onClose={onClose} maxWidthClass="sm:max-w-3xl">
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
          <div><Label htmlFor="product-list">Preço de tabela</Label><MoneyInput id="product-list" value={list} onChange={(event) => setList(event.target.value)} placeholder="0,00" /></div>
          <div>
            <Label htmlFor="product-min">Preço mínimo</Label>
            <MoneyInput id="product-min" value={minimum} onChange={(event) => setMinimum(event.target.value)} disabled={!isManager} placeholder={isManager ? "Sem piso" : "Definido pela gestão"} />
          </div>
          {canViewCost ? (
            <div>
              <Label htmlFor="product-cost">Custo</Label>
              <MoneyInput id="product-cost" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Desconhecido" />
              <p className="mt-1 text-[11px] text-muted-foreground">Margem na tabela: {formatBp(margin)}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 rounded-xl border border-border/70 p-3">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium text-foreground">Controlar estoque</span>
              <span className="block text-xs text-muted-foreground">A venda ganha dá baixa automática; reabrir ou perder devolve ao estoque.</span>
            </span>
            <Switch checked={trackStock} onCheckedChange={setTrackStock} aria-label="Controlar estoque" />
          </label>
          {trackStock ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="product-stock">{unit.trim() ? `Quantidade em estoque (${unit.trim()})` : "Quantidade em estoque"}</Label>
                <Input id="product-stock" value={stock} onChange={(event) => setStock(event.target.value.replace(/[^\d.,-]/g, ""))} inputMode="decimal" placeholder="0" />
              </div>
              <div>
                <Label htmlFor="product-alert">Avisar para comprar quando chegar a</Label>
                <Input id="product-alert" value={alertAt} onChange={(event) => setAlertAt(event.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="Ex.: 5" />
                <p className="mt-1 text-[11px] text-muted-foreground">Ao atingir esse saldo, a gestão recebe um alerta de reposição.</p>
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <Label htmlFor="product-description">Descrição e observações</Label>
          <Textarea id="product-description" rows={6} value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-32 resize-y leading-relaxed" placeholder="Detalhes do produto, condições, observações internas..." maxLength={5000} />
          <p className="mt-1 text-right text-[11px] text-muted-foreground tabular-nums">{description.length}/5000</p>
        </div>

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
        <MoneyInput value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Tabela" aria-label="Preço de tabela da variação" />
        <MoneyInput value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="Mínimo" aria-label="Preço mínimo da variação" />
        {canViewCost ? <MoneyInput value={cost} onChange={(event) => setCost(event.target.value)} placeholder="Custo" aria-label="Custo da variação" /> : null}
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

function StockCell({ product }: { product: Product }) {
  if (!product.trackStock) return <span className="text-muted-foreground">—</span>;
  const quantity = (product.stockQuantity ?? 0).toLocaleString("pt-BR");
  return (
    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap tabular-nums">
      {product.lowStock ? <PackageSearch className="h-3.5 w-3.5 text-warning" aria-hidden="true" /> : null}
      <span className={product.lowStock ? "font-medium text-warning" : "text-foreground"}>{quantity}{product.unit ? ` ${product.unit}` : ""}</span>
      {product.lowStock ? <Badge variant="warning" className="ml-1">Repor</Badge> : null}
    </span>
  );
}

function formatQuantityInput(value: number): string {
  return String(value).replace(".", ",");
}

function quantityFromInput(value: string): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}
