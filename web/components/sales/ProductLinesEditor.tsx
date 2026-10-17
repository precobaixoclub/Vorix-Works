"use client";

import { useMemo } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Field";
import { SearchableCombo } from "@/components/SearchableCombo";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import type { BillingType, Product } from "@/features/crm/types";
import { BILLING_SUFFIX, bpFromPercentInput, formatBp, percentInputFromBp } from "@/features/sales/presentation";
import { previewLine, previewTotals, priceFromDiscount } from "@/features/sales/preview";
import { formatCurrencyCents } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Linha de produto em edição (antes de existir no backend). */
export type DraftLine = {
  key: string;
  productId: string;
  name: string;
  billingType: BillingType;
  listPriceCents: number;
  minimumPriceCents?: number;
  unitCostCents?: number;
  quantity: string;
  priceInput: string;
};

export function draftFromProduct(product: Product): DraftLine {
  const list = product.listPriceCents ?? product.priceCents;
  return {
    key: `${product.id}-${Date.now().toString(36)}`,
    productId: product.id,
    name: product.name,
    billingType: product.billingType ?? "one_time",
    listPriceCents: list,
    minimumPriceCents: product.minimumPriceCents,
    unitCostCents: product.costCents,
    quantity: "1",
    priceInput: currencyInputFromCents(list),
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
  products,
  lines,
  onChange,
  currency = "BRL",
  showMargin,
}: {
  products: readonly Product[];
  lines: readonly DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  currency?: string;
  showMargin: boolean;
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
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="text-[11px] text-muted-foreground">Qtd.
                <Input value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} inputMode="decimal" />
              </label>
              <label className="text-[11px] text-muted-foreground">Preço proposto
                <Input value={line.priceInput} onChange={(event) => update(line.key, { priceInput: event.target.value })} inputMode="decimal" />
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
            <p className={cn("mt-2 text-xs tabular-nums", preview.belowMinimum ? "font-medium text-rose-600 dark:text-rose-300" : "text-muted-foreground")}>
              Subtotal {formatCurrencyCents(preview.subtotal, currency)}
              {preview.discount > 0 ? ` · desconto ${formatCurrencyCents(preview.discount, currency)}` : ""}
              {showMargin && preview.marginBp !== undefined ? ` · margem ${formatBp(preview.marginBp)}` : ""}
              {preview.belowMinimum ? " · abaixo do mínimo (exigirá aprovação)" : ""}
            </p>
          </div>
        );
      })}

      <SearchableCombo
        items={options}
        value=""
        onValueChange={(productId) => {
          const product = products.find((item) => item.id === productId);
          if (product) onChange([...lines, draftFromProduct(product)]);
        }}
        placeholder={products.length ? "+ Adicionar produto ou serviço" : "Nenhum produto cadastrado"}
        searchPlaceholder="Buscar por nome ou código..."
        emptyText="Nenhum produto encontrado."
        disabled={products.length === 0}
      />

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

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums text-foreground", strong && "font-semibold")}>{value}</p>
    </div>
  );
}

