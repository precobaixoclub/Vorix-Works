"use client";

import { PackageX, TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DealStockRisk, DealStockRiskItem, ProductStockRisk } from "@/features/crm/types";
import { cn } from "@/lib/utils";

/**
 * Alerta de estoque nas oportunidades em andamento, em linguagem simples:
 * - laranja (atenção): esta venda cabe no estoque, mas somando as outras oportunidades abertas
 *   vai faltar — feche logo ou reponha;
 * - vermelho (revisar): o estoque que sobrou depois das vendas já fechadas não cobre esta venda.
 */
export const STOCK_RISK_COPY = {
  warning: { label: "Estoque em risco", short: "Atenção ao estoque" },
  critical: { label: "Falta estoque", short: "Revisar: estoque insuficiente" },
} as const;

const qty = (value: number, unit?: string) => `${value.toLocaleString("pt-BR")}${unit ? ` ${unit}` : ""}`;

export function stockRiskSentence(item: Pick<DealStockRiskItem, "name" | "unit" | "quantity" | "available" | "openDemand" | "level">): string {
  if (item.level === "critical") {
    return item.available <= 0
      ? `${item.name}: sem estoque. Esta venda pede ${qty(item.quantity, item.unit)}.`
      : `${item.name}: esta venda pede ${qty(item.quantity, item.unit)}, mas só há ${qty(item.available, item.unit)} em estoque.`;
  }
  return `${item.name}: há ${qty(item.available, item.unit)} em estoque e ${qty(item.openDemand, item.unit)} em oportunidades abertas. Se as outras fecharem antes, vai faltar.`;
}

export function StockRiskBadge({ risk, className }: { risk: DealStockRisk | undefined; className?: string }) {
  if (!risk) return null;
  const critical = risk.level === "critical";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            critical ? "border-destructive/40 bg-destructive/15 text-destructive" : "border-orange-500/40 bg-orange-500/15 text-orange-600 dark:text-orange-300",
            className,
          )}
        >
          {critical ? <PackageX className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
          {STOCK_RISK_COPY[risk.level].label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1">
        {risk.items.map((item) => <p key={item.productId}>{stockRiskSentence(item)}</p>)}
      </TooltipContent>
    </Tooltip>
  );
}

/** Nível de uma linha ainda não salva (criação): mesma regra do backend, com a quantidade digitada. */
export function draftStockLevel(stock: Pick<ProductStockRisk, "stockQuantity" | "openDemand"> | undefined, quantity: number): "ok" | "warning" | "critical" {
  if (!stock || !(quantity > 0)) return "ok";
  if (quantity > stock.stockQuantity) return "critical";
  if (quantity + stock.openDemand > stock.stockQuantity) return "warning";
  return "ok";
}

/** Linha informativa abaixo da quantidade: quanto há, quanto está reservado e o alerta. */
export function StockLine({ stock, quantity, unit, name, existingInDeal = 0 }: { stock: Pick<ProductStockRisk, "stockQuantity" | "openDemand"> | undefined; quantity: number; unit?: string; name: string; existingInDeal?: number }) {
  if (!stock) return null;
  // Em uma oportunidade já salva, a demanda aberta já inclui a própria quantidade dela.
  const others = Math.max(0, stock.openDemand - existingInDeal);
  const level = draftStockLevel({ stockQuantity: stock.stockQuantity, openDemand: others }, quantity);
  return (
    <p
      className={cn(
        "mt-1.5 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs",
        level === "critical" ? "bg-destructive/10 text-destructive" : level === "warning" ? "bg-orange-500/10 text-orange-700 dark:text-orange-300" : "bg-muted/50 text-muted-foreground",
      )}
    >
      {level === "critical" ? <PackageX className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : level === "warning" ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
      <span>
        {level === "ok"
          ? `Em estoque: ${qty(stock.stockQuantity, unit)}${others > 0 ? ` · ${qty(others, unit)} em outras oportunidades abertas` : ""}`
          : stockRiskSentence({ name, unit, quantity, available: stock.stockQuantity, openDemand: others + quantity, level })}
      </span>
    </p>
  );
}
