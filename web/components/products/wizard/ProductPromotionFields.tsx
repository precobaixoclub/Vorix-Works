"use client";
import { BadgePercent } from "lucide-react";
import { Input } from "@/components/Field";
import { Field } from "./WizardParts";
import { Switch } from "@/components/ui/switch";
import type { ProductDetails } from "@/features/product-engine/types";
import { formatCurrencyCents } from "@/lib/format";

type Promotion = NonNullable<ProductDetails["promotion"]>;

/** Dates are picked in Brazil time: the promotion starts at 00:00 of the first day and ends at 23:59 of the last. */
const ZONE = "-03:00";
export const promotionDate = (iso?: string) => iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)) : "";
export const promotionStart = (day: string) => day ? `${day}T00:00:00${ZONE}` : undefined;
export const promotionEnd = (day: string) => day ? `${day}T23:59:59${ZONE}` : undefined;
export const promotionalPrice = (price: number, percent: number) => Math.round(price * (100 - percent) / 100);

/** Is the promotion running now, scheduled, or over? Used for the hint and for the product list. */
export function promotionStatus(promotion: Promotion | undefined, now = new Date()): "running" | "scheduled" | "ended" | undefined {
  if (!promotion) return undefined;
  if (promotion.startsAt && Date.parse(promotion.startsAt) > now.getTime()) return "scheduled";
  if (promotion.endsAt && Date.parse(promotion.endsAt) <= now.getTime()) return "ended";
  return "running";
}

/**
 * The product's own promotion: a percentage off, optionally between two dates. The site shows
 * "de/por" with the percentage, lists it in "Em promoção", and the cart and WhatsApp order use the
 * same price.
 */
export function ProductPromotionFields({ value, onChange, priceCents, currency = "BRL", disabled }: { value?: Promotion; onChange: (value: Promotion | undefined) => void; priceCents: number; currency?: string; disabled?: boolean }) {
  const on = !!value, percent = value?.percent ?? 10, status = promotionStatus(value);
  const set = (patch: Partial<Promotion>) => onChange({ percent, ...value, ...patch });
  const start = promotionDate(value?.startsAt), end = promotionDate(value?.endsAt);
  const invalidWindow = !!start && !!end && end < start;
  return <div className="space-y-3 border-t border-border/60 pt-5">
    <label className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-3">
      <span className="flex items-start gap-2"><BadgePercent aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><span className="block text-sm font-medium">Produto em promoção</span><span className="block text-xs text-muted-foreground">O site mostra “de/por” com o desconto e coloca o produto na seção “Em promoção”.</span></span></span>
      <Switch checked={on} disabled={disabled} onCheckedChange={(checked) => onChange(checked ? { percent } : undefined)} aria-label="Produto em promoção" />
    </label>
    {on ? <div className="grid gap-4 sm:grid-cols-3">
      <Field label="Desconto (%)" htmlFor="product-promo-percent" hint="De 1% a 90%.">
        <Input id="product-promo-percent" inputMode="numeric" disabled={disabled} value={String(percent)} onChange={(event) => { const next = Number(event.target.value.replace(/\D/g, "").slice(0, 2)); set({ percent: Math.min(90, Math.max(1, next || 1)) }); }} />
      </Field>
      <Field label="Começa em" htmlFor="product-promo-start" hint="Em branco = já começa.">
        <Input id="product-promo-start" type="date" disabled={disabled} value={start} onChange={(event) => set({ startsAt: promotionStart(event.target.value) })} />
      </Field>
      <Field label="Termina em" htmlFor="product-promo-end" hint={invalidWindow ? "O fim precisa ser depois do início." : "Em branco = sem data para acabar."}>
        <Input id="product-promo-end" type="date" disabled={disabled} value={end} min={start || undefined} aria-invalid={invalidWindow || undefined} onChange={(event) => set({ endsAt: promotionEnd(event.target.value) })} />
      </Field>
      <p className="text-sm sm:col-span-3" aria-live="polite">
        {priceCents > 0 ? <>No site: <span className="text-muted-foreground line-through">{formatCurrencyCents(priceCents, currency)}</span> por <strong className="tabular-nums">{formatCurrencyCents(promotionalPrice(priceCents, percent), currency)}</strong> <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">-{percent}%</span></> : "Defina o preço de venda para ver o preço promocional."}
        {status === "scheduled" ? <span className="ml-2 text-xs text-muted-foreground">Agendada: ainda não começou.</span> : status === "ended" ? <span className="ml-2 text-xs text-warning">Encerrada: o site já mostra o preço normal.</span> : null}
      </p>
    </div> : null}
  </div>;
}
