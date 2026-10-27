"use client";
import { Package, PackageX, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PaginatedCatalog } from "@/components/products/PaginatedCatalog";
import { useMyAccess } from "@/features/auth/access";
import type { Product, ProductStockRisk } from "@/features/crm/types";
import { BILLING_SUFFIX } from "@/features/sales/presentation";
import { PROPERTY_STATUS_LABELS } from "@/features/product-engine/specializations";
import { formatCurrencyCents, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
const DAY=86_400_000, NEW_DAYS=15;
const isNew=(p:Product)=>Date.now()-new Date(p.createdAt).getTime()<=NEW_DAYS*DAY;
const outOfStock=(p:Product)=>Boolean(p.trackStock&&(p.stockQuantity??0)<=0);
const qty=(value:number,unit?:string)=>`${value.toLocaleString("pt-BR")}${unit?` ${unit}`:""}`;
export default function ProductsCatalogPage(){
 const access=useMyAccess();
 return <PaginatedCatalog card={(product,onOpen)=><ProductCard product={product} onOpen={onOpen} showInventory={access.can("inventory:read")}/>}/>;
}
function ProductCard({ product, risk, onOpen, showInventory=true }: { product: Product; risk?: ProductStockRisk; onOpen: () => void; showInventory?:boolean }) {
  const price = product.listPriceCents ?? product.priceCents;
  const pressured = risk && risk.level !== "ok";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-left transition hover:-translate-y-0.5 hover:border-solution/50 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
        showInventory && outOfStock(product) ? "border-destructive/50" : product.lowStock || pressured ? "border-orange-500/50" : "border-border/70",
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
        <p className="truncate text-[11px] text-muted-foreground">{product.category ?? (product.details?.type==="REAL_ESTATE"?"Imóvel":product.details?.type==="VEHICLE"?"Veículo":product.itemType === "service" ? "Serviço" : "Produto")}</p>
        <p className="mt-auto pt-1 text-base font-semibold tabular-nums text-foreground">
          {formatCurrencyCents(price, product.currency)}
          <span className="text-xs font-normal text-muted-foreground">{BILLING_SUFFIX[product.billingType ?? "one_time"] ?? ""}</span>
        </p>
        {showInventory ? <StockBadge product={product} /> : null}
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
  if(product.details?.type==="REAL_ESTATE"&&product.details.realEstate)return <span className="text-[11px] font-medium text-muted-foreground">{PROPERTY_STATUS_LABELS[product.details.realEstate.status]}</span>;
  if (!product.trackStock) return <span className="text-[11px] text-muted-foreground">{product.itemType === "service" ? "Serviço" : "Sem controle de estoque"}</span>;
  const amount = qty(product.stockQuantity ?? 0, product.unit);
  if (outOfStock(product)) return <span className="inline-flex w-fit items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive"><PackageX className="h-3 w-3" />Sem estoque</span>;
  if (product.lowStock) return <span className="inline-flex w-fit items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-semibold text-orange-600 dark:text-orange-300"><TriangleAlert className="h-3 w-3" />Repor · {amount}</span>;
  return <span className="text-[11px] font-medium text-success">{amount} em estoque</span>;
}
