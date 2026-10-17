"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, Package, PackageX, Plus, Power, Search, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card, CardBody } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Input } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { updateProduct } from "@/features/crm/api";
import { useProducts, useStockRisk } from "@/features/crm/hooks";
import type { Product, ProductStockRisk } from "@/features/crm/types";
import { useCommercialSettings } from "@/features/sales/hooks";
import { BILLING_SUFFIX, BILLING_TYPE_LABEL, formatBp } from "@/features/sales/presentation";
import { formatCurrencyCents, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "todos" | "repor" | "sem-estoque" | "risco" | "novos";
type Sort = "recentes" | "atualizados" | "nome" | "menor-preco" | "maior-preco" | "menor-estoque";
const NEW_DAYS = 15;
const DAY = 86_400_000;

const isNew = (product: Product) => Date.now() - new Date(product.createdAt).getTime() <= NEW_DAYS * DAY;
const outOfStock = (product: Product) => Boolean(product.trackStock && (product.stockQuantity ?? 0) <= 0);
const qty = (value: number, unit?: string) => `${value.toLocaleString("pt-BR")}${unit ? ` ${unit}` : ""}`;

/**
 * Produtos (Vorix Conversas) — vitrine do catálogo: tudo o que está cadastrado com foto, o que
 * precisa de reposição, o que está faltando para as oportunidades em andamento, novidades e o que
 * mudou recentemente. Um clique abre o cadastro completo.
 */
export default function ProductsCatalogPage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: products, error, isLoading, mutate } = useProducts(workspace.id);
  const { data: settings } = useCommercialSettings(workspace.id);
  const { data: stockRisk, mutate: mutateStockRisk } = useStockRisk(workspace.id);
  const visibility = settings?.visibility ?? { canViewCost: false, canViewMargin: false, isManager: false };
  const [editing, setEditing] = useState<Product | "new" | undefined>();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [category, setCategory] = useState<string>("todas");
  const [sort, setSort] = useState<Sort>("recentes");
  const [showInactive, setShowInactive] = useState(false);
  const filter = (searchParams.get("filtro") as Filter | null) ?? "todos";
  const view = searchParams.get("view") === "lista" ? "lista" : "vitrine";

  const setParam = (key: string, value: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const riskByProduct = useMemo(() => new Map((stockRisk?.products ?? []).map((item) => [item.productId, item])), [stockRisk]);
  const all = products ?? [];
  const active = all.filter((product) => product.active);
  const lowStock = active.filter((product) => product.lowStock && !outOfStock(product));
  const empty = active.filter(outOfStock);
  const atRisk = active.filter((product) => riskByProduct.get(product.id)?.level && riskByProduct.get(product.id)?.level !== "ok");
  const recent = active.filter(isNew);
  const categories = useMemo(() => [...new Set(all.map((product) => product.category).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "pt-BR")), [all]);

  const catalog = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list = showInactive ? all : active;
    if (filter === "repor") list = list.filter((product) => product.lowStock || outOfStock(product));
    if (filter === "sem-estoque") list = list.filter(outOfStock);
    if (filter === "risco") list = list.filter((product) => (riskByProduct.get(product.id)?.level ?? "ok") !== "ok");
    if (filter === "novos") list = list.filter(isNew);
    if (category !== "todas") list = list.filter((product) => product.category === category);
    if (query) list = list.filter((product) => [product.name, product.code, product.category, product.description].some((value) => value?.toLowerCase().includes(query)));
    const price = (product: Product) => product.listPriceCents ?? product.priceCents;
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "nome": return a.name.localeCompare(b.name, "pt-BR");
        case "menor-preco": return price(a) - price(b);
        case "maior-preco": return price(b) - price(a);
        case "menor-estoque": return (a.trackStock ? a.stockQuantity ?? 0 : Infinity) - (b.trackStock ? b.stockQuantity ?? 0 : Infinity);
        case "atualizados": return b.updatedAt.localeCompare(a.updatedAt);
        default: return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, search, category, sort, showInactive, filter, riskByProduct]);

  const showShelves = filter === "todos" && !search.trim() && category === "todas" && active.length > 0;
  const recentlyUpdated = [...active].filter((product) => product.updatedAt !== product.createdAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);

  async function toggleActive(product: Product) {
    try {
      await updateProduct(product.id, workspace.id, { active: !product.active });
      await mutate();
      toast.success(product.active ? "Produto desativado — não aparece mais para vender." : "Produto ativado.");
    } catch (cause) {
      toast.error("Não foi possível alterar o produto", { description: cause instanceof Error ? cause.message : undefined });
    }
  }

  const tiles: { key: Filter; label: string; count: number; icon: React.ReactNode; tone: string; hint: string }[] = [
    { key: "todos", label: "Produtos ativos", count: active.length, icon: <Package className="h-4 w-4" />, tone: "text-solution", hint: "Tudo o que está à venda" },
    { key: "repor", label: "Precisa repor", count: lowStock.length + empty.length, icon: <TriangleAlert className="h-4 w-4" />, tone: "text-orange-500", hint: "Chegou no aviso de compra" },
    { key: "sem-estoque", label: "Sem estoque", count: empty.length, icon: <PackageX className="h-4 w-4" />, tone: "text-destructive", hint: "Zerado — não dá para entregar" },
    { key: "risco", label: "Falta para as oportunidades", count: atRisk.length, icon: <TriangleAlert className="h-4 w-4" />, tone: "text-orange-500", hint: "Vendas em andamento pedem mais do que há" },
    { key: "novos", label: "Novidades", count: recent.length, icon: <Sparkles className="h-4 w-4" />, tone: "text-ai", hint: `Cadastrados nos últimos ${NEW_DAYS} dias` },
  ];

  return (
    <div className="mx-auto max-w-7xl px-3 py-6 sm:px-6">
      <PageHeader
        title="Produtos"
        description="Seu catálogo em um só lugar: o que você vende, o que precisa repor e o que é novidade."
        actions={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Cadastrar produto</Button>}
      />

      {isLoading ? <CatalogSkeleton /> : null}
      {error ? <ErrorState error={error} onRetry={() => mutate()} /> : null}

      {!isLoading && !error && all.length === 0 ? (
        <EmptyState
          icon={<Package className="h-5 w-5" />}
          title="Seu catálogo está vazio"
          description="Cadastre o que você vende — com foto, preço e estoque — para usar nas oportunidades e propostas."
          action={<Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Cadastrar o primeiro produto</Button>}
        />
      ) : null}

      {!isLoading && !error && all.length > 0 ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                onClick={() => setParam("filtro", tile.key === "todos" || filter === tile.key ? undefined : tile.key)}
                aria-pressed={filter === tile.key}
                className={cn(
                  "rounded-xl border bg-card p-3 text-left transition-colors hover:border-solution/50",
                  filter === tile.key ? "border-solution ring-2 ring-solution/25" : "border-border/70",
                )}
              >
                <span className={cn("flex items-center gap-1.5 text-xs font-medium", tile.tone)}>{tile.icon}{tile.label}</span>
                <span className="mt-1 block text-2xl font-semibold tabular-nums text-foreground">{tile.count}</span>
                <span className="block text-[11px] text-muted-foreground">{tile.hint}</span>
              </button>
            ))}
          </div>

          {showShelves ? (
            <>
              <Shelf title="Precisa repor" hint="Estoque no aviso de compra ou zerado" products={[...empty, ...lowStock].slice(0, 12)} risk={riskByProduct} onOpen={setEditing} />
              <Shelf title="Faltando para as oportunidades" hint="Se as vendas em andamento fecharem, não haverá estoque para todas" products={atRisk.slice(0, 12)} risk={riskByProduct} onOpen={setEditing} />
              <Shelf title="Novidades" hint={`Cadastrados nos últimos ${NEW_DAYS} dias`} products={[...recent].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)} risk={riskByProduct} onOpen={setEditing} />
              <Shelf title="Atualizados recentemente" hint="Preço, estoque ou cadastro alterados" products={recentlyUpdated} risk={riskByProduct} onOpen={setEditing} />
            </>
          ) : null}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">{filter === "todos" ? "Todo o catálogo" : tiles.find((tile) => tile.key === filter)?.label}</h2>
              <div className="flex rounded-lg border border-border/70 p-0.5" role="group" aria-label="Forma de exibição">
                <Button variant={view === "vitrine" ? "secondary" : "ghost"} size="sm" onClick={() => setParam("view", undefined)} aria-pressed={view === "vitrine"}><LayoutGrid className="h-4 w-4" />Vitrine</Button>
                <Button variant={view === "lista" ? "secondary" : "ghost"} size="sm" onClick={() => setParam("view", "lista")} aria-pressed={view === "lista"}><List className="h-4 w-4" />Lista</Button>
              </div>
            </div>
            <Card>
              <CardBody className="flex flex-wrap items-center gap-3 p-3">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, código ou categoria" aria-label="Buscar produto" className="pl-9" />
                </div>
                <div className="w-44">
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger aria-label="Categoria"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas as categorias</SelectItem>
                      {categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-44">
                  <Select value={sort} onValueChange={(value) => setSort(value as Sort)}>
                    <SelectTrigger aria-label="Ordenar"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recentes">Mais recentes</SelectItem>
                      <SelectItem value="atualizados">Atualizados por último</SelectItem>
                      <SelectItem value="nome">Nome (A–Z)</SelectItem>
                      <SelectItem value="menor-preco">Menor preço</SelectItem>
                      <SelectItem value="maior-preco">Maior preço</SelectItem>
                      <SelectItem value="menor-estoque">Menor estoque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Mostrar desativados" />
                  Mostrar desativados
                </label>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{catalog.length} {catalog.length === 1 ? "item" : "itens"}</span>
              </CardBody>
            </Card>

            {catalog.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">Nenhum produto encontrado com esses filtros.</p>
            ) : view === "vitrine" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {catalog.map((product) => <ProductCard key={product.id} product={product} risk={riskByProduct.get(product.id)} onOpen={() => setEditing(product)} />)}
              </div>
            ) : (
              <Card>
                <CardBody className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead className="text-right">Preço</TableHead>
                        <TableHead className="text-right">Estoque</TableHead>
                        <TableHead className="text-right">Em oportunidades</TableHead>
                        {visibility.canViewCost ? <TableHead className="text-right">Margem</TableHead> : null}
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catalog.map((product) => {
                        const price = product.listPriceCents ?? product.priceCents;
                        const margin = product.costCents !== undefined && price > 0 ? Math.round(((price - product.costCents) * 10000) / price) : undefined;
                        const risk = riskByProduct.get(product.id);
                        return (
                          <TableRow key={product.id} className={cn("cursor-pointer", !product.active && "opacity-60")} onClick={() => setEditing(product)}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <ProductThumb product={product} className="h-10 w-10 rounded-lg" />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground">{product.name}</p>
                                  <p className="truncate text-xs text-muted-foreground">{[product.category, product.code, BILLING_TYPE_LABEL[product.billingType ?? "one_time"]].filter(Boolean).join(" · ")}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrencyCents(price, product.currency)}{BILLING_SUFFIX[product.billingType ?? "one_time"] ?? ""}</TableCell>
                            <TableCell className="text-right"><StockBadge product={product} /></TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{risk?.openDemand ? qty(risk.openDemand, product.unit) : "—"}</TableCell>
                            {visibility.canViewCost ? <TableCell className="text-right tabular-nums">{formatBp(margin)}</TableCell> : null}
                            <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                              <Button variant="ghost" size="icon" onClick={() => toggleActive(product)} aria-label={product.active ? `Desativar ${product.name}` : `Ativar ${product.name}`} title={product.active ? "Desativar" : "Ativar"}>
                                <Power className={product.active ? "h-4 w-4" : "h-4 w-4 text-muted-foreground"} />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardBody>
              </Card>
            )}
          </section>
        </div>
      ) : null}

      {editing ? (
        <ProductFormModal
          workspaceId={workspace.id}
          product={editing === "new" ? undefined : editing}
          canViewCost={visibility.canViewCost}
          isManager={visibility.isManager}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await Promise.all([mutate(), mutateStockRisk()]);
          }}
        />
      ) : null}
    </div>
  );
}

function Shelf({ title, hint, products, risk, onOpen }: { title: string; hint: string; products: Product[]; risk: ReadonlyMap<string, ProductStockRisk>; onOpen: (product: Product) => void }) {
  if (products.length === 0) return null;
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:px-0">
        {products.map((product) => (
          <div key={product.id} className="w-44 shrink-0 snap-start sm:w-52">
            <ProductCard product={product} risk={risk.get(product.id)} onOpen={() => onOpen(product)} />
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductCard({ product, risk, onOpen }: { product: Product; risk?: ProductStockRisk; onOpen: () => void }) {
  const price = product.listPriceCents ?? product.priceCents;
  const pressured = risk && risk.level !== "ok";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-left transition hover:-translate-y-0.5 hover:border-solution/50 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
        outOfStock(product) ? "border-destructive/50" : product.lowStock || pressured ? "border-orange-500/50" : "border-border/70",
        !product.active && "opacity-60",
      )}
    >
      <div className="relative">
        <ProductThumb product={product} className="aspect-square w-full" />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {isNew(product) ? <Badge variant="ai">Novo</Badge> : null}
          {!product.active ? <Badge variant="outline" className="bg-background/80">Desativado</Badge> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{product.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">{product.category ?? (product.itemType === "service" ? "Serviço" : "Produto")}</p>
        <p className="mt-auto pt-1 text-base font-semibold tabular-nums text-foreground">
          {formatCurrencyCents(price, product.currency)}
          <span className="text-xs font-normal text-muted-foreground">{BILLING_SUFFIX[product.billingType ?? "one_time"] ?? ""}</span>
        </p>
        <StockBadge product={product} />
        {pressured ? <p className="text-[11px] font-medium text-orange-600 dark:text-orange-300">{qty(risk.openDemand, product.unit)} em oportunidades abertas</p> : null}
        <p className="text-[10px] text-muted-foreground">Atualizado {formatRelativeTime(product.updatedAt)}</p>
      </div>
    </button>
  );
}

function ProductThumb({ product, className }: { product: Product; className?: string }) {
  const cover = product.imageUrls?.[0];
  if (cover) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={cover} alt={product.name} loading="lazy" className={cn("bg-surface-2 object-cover", className)} />;
  }
  const initials = product.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return (
    <div className={cn("vorix-grid flex items-center justify-center bg-surface-2 text-muted-foreground", className)} aria-hidden="true">
      <span className="flex flex-col items-center gap-1">
        <Package className="h-6 w-6 opacity-60" />
        <span className="text-xs font-semibold tracking-wide">{initials}</span>
      </span>
    </div>
  );
}

function StockBadge({ product }: { product: Product }) {
  if (!product.trackStock) return <span className="text-[11px] text-muted-foreground">{product.itemType === "service" ? "Serviço" : "Sem controle de estoque"}</span>;
  const amount = qty(product.stockQuantity ?? 0, product.unit);
  if (outOfStock(product)) return <span className="inline-flex w-fit items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive"><PackageX className="h-3 w-3" />Sem estoque</span>;
  if (product.lowStock) return <span className="inline-flex w-fit items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold text-orange-600 dark:text-orange-300"><TriangleAlert className="h-3 w-3" />Repor · {amount}</span>;
  return <span className="text-[11px] font-medium text-success">{amount} em estoque</span>;
}

function CatalogSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="aspect-[3/4] rounded-xl" />)}</div>
    </div>
  );
}
