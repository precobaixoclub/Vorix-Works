"use client";

import { useMemo } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { Input, MoneyInput } from "@/components/Field";
import { SearchableCombo } from "@/components/SearchableCombo";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import type { BillingType, Product, ProductStockRisk } from "@/features/crm/types";
import { ProductVariantPicker } from "@/components/products/ProductVariantPicker";
import type {ProductVariant} from "@/features/sales/types";
import { StockLine } from "@/components/sales/StockRisk";
import { BILLING_SUFFIX, bpFromPercentInput, formatBp, percentInputFromBp } from "@/features/sales/presentation";
import { previewLine, previewTotals, priceFromDiscount } from "@/features/sales/preview";
import { formatCurrencyCents } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Linha de produto em edição (antes de existir no backend). */
export type DraftLine = {
  key: string;
  productId: string;
  variantId?:string;
  variantStockQuantity?:number;
  name: string;
  billingType: BillingType;
  listPriceCents: number;
  minimumPriceCents?: number;
  unitCostCents?: number;
  quantity: string;
  priceInput: string;
  unit?: string;
};

export function draftFromProduct(product: Product,variant?:ProductVariant): DraftLine {
  const list = variant&&variant.priceOverride!==false?variant.listPriceCents:product.listPriceCents??product.priceCents;
  return {
    key: `${product.id}-${Date.now().toString(36)}`,
    productId: product.id,
    variantId:variant?.id,variantStockQuantity:variant?Math.max(0,(variant.stockQuantity??0)-(variant.reservedQuantity??0)):undefined,
    name:variant?`${product.name} — ${variant.name}`:product.name,
    billingType: product.billingType ?? "one_time",
    listPriceCents: list,
    minimumPriceCents:variant?.minimumPriceCents??product.minimumPriceCents,
    unitCostCents:variant?.costCents??product.costCents,
    quantity: "1",
    priceInput: currencyInputFromCents(list),
    unit: product.unit,
  };
}

export const draftQuantity = (line: DraftLine) => Math.max(0, Number(line.quantity.replace(",", ".")) || 0);
export const draftPrice = (line: DraftLine) => centsFromCurrencyInput(line.priceInput);

/**
 * Produtos e serviços da oportunidade (criação): busca no catálogo, quantidade, preço proposto OU
 * desconto % e cálculo instantâneo (tabela, desconto, valor proposto e margem quando permitida).
 * O backend recalcula e valida tudo ao salvar — esta conta é só prévia.
 */
export function ProductLinesEditor({
  workspaceId,
  stockByVariant,
  products,
  lines,
  onChange,
  currency = "BRL",
  showMargin,
  stock,
}: {
  workspaceId:string;
  stockByVariant?:ReadonlyMap<string,ProductStockRisk>;
  products: readonly Product[];
  lines: readonly DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  currency?: string;
  showMargin: boolean;
  /** Estoque e demanda em oportunidades abertas por produto (só produtos com controle). */
  stock?: ReadonlyMap<string, ProductStockRisk>;
}) {
  const options = useMemo(() => products.filter((product) => product.active).map((product) => ({ id: product.id, label: `${product.name}${product.code ? ` · ${product.code}` : ""} — ${formatCurrencyCents(product.listPriceCents ?? product.priceCents, product.currency)}${BILLING_SUFFIX[product.billingType ?? "one_time"] ?? ""}` })), [products]);
  const totals = previewTotals(lines.map((line) => ({ quantity: draftQuantity(line), listPriceCents: line.listPriceCents, proposedUnitPriceCents: draftPrice(line), unitCostCents: line.unitCostCents, minimumPriceCents: line.minimumPriceCents })));
  const update = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <div className="space-y-2">
      {lines.map((line) => {
        const preview = previewLine({ quantity: draftQuantity(line), listPriceCents: line.listPriceCents, proposedUnitPriceCents: draftPrice(line), unitCostCents: line.unitCostCents, minimumPriceCents: line.minimumPriceCents });
        return (
          <div key={line.key} className="rounded-xl border border-border/70 bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{line.name}</p>
                <p className="text-xs text-muted-foreground">
                  Tabela {formatCurrencyCents(line.listPriceCents, currency)}{BILLING_SUFFIX[line.billingType] ?? ""}
                  {line.minimumPriceCents !== undefined ? ` · mínimo ${formatCurrencyCents(line.minimumPriceCents, currency)}` : ""}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Remover item" onClick={() => onChange(lines.filter((item) => item.key !== line.key))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_1fr]">
              <div className="text-[11px] text-muted-foreground">
                Quantidade{line.unit ? ` (${line.unit})` : ""}
                <QuantityStepper value={line.quantity} onChange={(quantity) => update(line.key, { quantity })} label={line.name} />
              </div>
              <label className="text-[11px] text-muted-foreground">Preço proposto
                <MoneyInput value={line.priceInput} onChange={(event) => update(line.key, { priceInput: event.target.value })} />
              </label>
              <label className="text-[11px] text-muted-foreground">Desconto %
                <Input
                  value={percentInputFromBp(preview.discountBp || undefined)}
                  onChange={(event) => {
                    const bp = bpFromPercentInput(event.target.value);
                    update(line.key, { priceInput: currencyInputFromCents(priceFromDiscount(line.listPriceCents, Math.min(10000, Math.max(0, bp ?? 0)))) });
                  }}
                  inputMode="decimal"
                  placeholder="0"
                />
              </label>
            </div>
            <StockLine stock={line.variantId?(stockByVariant?.get(line.variantId)??{stockQuantity:line.variantStockQuantity??0,openDemand:0}):stock?.get(line.productId)} quantity={draftQuantity(line)} unit={line.unit} name={line.name} />
            <p className={cn("mt-2 text-xs tabular-nums", preview.belowMinimum ? "font-medium text-rose-600 dark:text-rose-300" : "text-muted-foreground")}>
              Subtotal {formatCurrencyCents(preview.subtotal, currency)}
              {preview.discount > 0 ? ` · desconto ${formatCurrencyCents(preview.discount, currency)}` : ""}
              {showMargin && preview.marginBp !== undefined ? ` · margem ${formatBp(preview.marginBp)}` : ""}
              {preview.belowMinimum ? " · abaixo do mínimo (exigirá aprovação)" : ""}
            </p>
          </div>
        );
      })}

      <ProductVariantPicker workspaceId={workspaceId} products={products} onPick={(product,variant)=>onChange([...lines,draftFromProduct(product,variant)])}/>

      {lines.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-3 text-sm sm:grid-cols-4">
          <Metric label="Tabela" value={formatCurrencyCents(totals.list, currency)} />
          <Metric label="Desconto" value={formatCurrencyCents(totals.discount, currency)} />
          <Metric label="Valor proposto" value={formatCurrencyCents(totals.total, currency)} strong />
          {showMargin ? <Metric label="Margem" value={formatBp(totals.marginBp)} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Quantidade grande e fácil de ajustar (− / +) — também aceita digitar. */
export function QuantityStepper({ value, onChange, label, disabled, onCommit }: { value: string; onChange: (value: string) => void; label: string; disabled?: boolean; onCommit?: (value: string) => void }) {
  const current = Math.max(0, Number(value.replace(",", ".")) || 0);
  const set = (next: number) => {
    const text = String(Math.max(1, Math.round(next * 1000) / 1000)).replace(".", ",");
    onChange(text);
    onCommit?.(text);
  };
  return (
    <div className="mt-0.5 flex h-9 items-stretch overflow-hidden rounded-md border border-input bg-background">
      <button type="button" disabled={disabled || current <= 1} onClick={() => set(current - 1)} aria-label={`Diminuir quantidade de ${label}`} className="flex w-9 items-center justify-center text-foreground hover:bg-surface-2 disabled:opacity-30">
        <Minus className="h-4 w-4" />
      </button>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.replace(/[^\d,.]/g, ""))}
        onBlur={() => onCommit?.(value)}
        inputMode="decimal"
        aria-label={`Quantidade de ${label}`}
        className="w-14 border-x border-input bg-transparent text-center text-sm font-semibold tabular-nums text-foreground outline-none focus-visible:bg-surface-2"
      />
      <button type="button" disabled={disabled} onClick={() => set(current + 1)} aria-label={`Aumentar quantidade de ${label}`} className="flex w-9 items-center justify-center text-foreground hover:bg-surface-2 disabled:opacity-30">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums text-foreground", strong && "font-semibold")}>{value}</p>
    </div>
  );
}

