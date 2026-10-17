"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Target, Trash2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { DetailBlock } from "@/components/DetailModal";
import { ErrorState } from "@/components/ErrorState";
import { Input, Label, MoneyInput, Textarea } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { SearchableCombo } from "@/components/SearchableCombo";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProducts } from "@/features/crm/hooks";
import { centsFromCurrencyInput, currencyInputFromCents } from "@/features/crm/presentation";
import type { Deal } from "@/features/crm/types";
import { addDealItem, generateDealAiInsights, removeDealItem, requestApproval, updateDealCommercial, updateDealItem } from "@/features/sales/api";
import { useDealCommercial, useDealInsights, useInvalidateSales } from "@/features/sales/hooks";
import { APPROVAL_REASON_LABEL, BILLING_SUFFIX, FORECAST_LABEL, HEALTH_CLASS, HEALTH_LABEL, bpFromPercentInput, formatBp, percentInputFromBp } from "@/features/sales/presentation";
import { priceFromDiscount } from "@/features/sales/preview";
import type { DealAiInsights, DealCommercialSummary, DealItem } from "@/features/sales/types";
import { formatCurrencyCents, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AIInsightCard, AiLoading, VorixAiIcon } from "@/components/vorix/ai";

const errorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : "Tente novamente.");

/** KPIs do topo do cockpit: valor proposto, margem, probabilidade/ponderado e previsão. */
export function DealCockpitStats({ workspaceId, deal }: { workspaceId: string; deal: Deal }) {
  const { data } = useDealCommercial(workspaceId, deal.id);
  const closedValue = deal.status === "won" ? deal.finalValueCents : undefined;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label={deal.status === "won" ? "Valor final" : "Valor proposto"} value={formatCurrencyCents(closedValue ?? deal.valueCents, deal.currency)} hint={deal.valueMode === "calculated" ? "calculado pelos produtos" : "valor manual"} />
      <Stat label="Margem" value={data?.visibility.canViewMargin ? formatBp(deal.status === "won" ? deal.finalMarginBp : data?.totals.grossMarginBp) : "—"} hint={data && !data.visibility.canViewMargin ? "sem permissão" : undefined} />
      <Stat label="Probabilidade" value={data ? `${data.probability.value}%` : "—"} hint={data ? `ponderado ${formatCurrencyCents(data.weightedValueCents, deal.currency)}` : undefined} />
      <Stat label="Previsão" value={formatDate(deal.expectedCloseDate)} hint={data?.aging.expectedCloseOverdue ? "vencida" : data ? FORECAST_LABEL[data.forecastCategory] : undefined} warn={data?.aging.expectedCloseOverdue} />
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-base font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className={cn("truncate text-[11px]", warn ? "font-medium text-rose-600 dark:text-rose-300" : "text-muted-foreground")}>{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Visão geral: negociação, meta, próxima ação e IA
// ---------------------------------------------------------------------------------------------

export function DealOverview({ workspaceId, deal, onGoToProducts, onGoToNegotiation }: { workspaceId: string; deal: Deal; onGoToProducts: () => void; onGoToNegotiation: () => void }) {
  const { data, error, isLoading, mutate } = useDealCommercial(workspaceId, deal.id);
  if (isLoading) return <CockpitSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  return (
    <div className="space-y-7">
      <NegotiationRoom summary={data} deal={deal} onGoToProducts={onGoToProducts} onGoToNegotiation={onGoToNegotiation} />
      <GoalAndInsights workspaceId={workspaceId} deal={deal} summary={data} />
      {deal.status === "won" ? <WonSnapshot deal={deal} canViewMargin={data.visibility.canViewMargin} /> : null}
    </div>
  );
}

function NegotiationRoom({ summary, deal, onGoToProducts, onGoToNegotiation }: { summary: DealCommercialSummary; deal: Deal; onGoToProducts: () => void; onGoToNegotiation: () => void }) {
  const t = summary.totals;
  const currency = summary.currency;
  const recurring = t.mrrCents > 0;
  return (
    <DetailBlock label="Visão comercial" action={<span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", HEALTH_CLASS[summary.evaluation.health])}>{HEALTH_LABEL[summary.evaluation.health]}</span>}>
      {t.itemCount === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-5 text-center">
          <p className="text-sm text-muted-foreground">Sem produtos — valor estimado manual de {formatCurrencyCents(deal.valueCents, currency)}.</p>
          {deal.status === "open" ? <Button variant="secondary" size="sm" className="mt-2" onClick={onGoToProducts}>Adicionar produtos</Button> : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Valor de tabela" value={formatCurrencyCents(t.listTotalCents, currency)} />
            <Mini label="Desconto" value={`${formatCurrencyCents(t.discountCents, currency)} · ${formatBp(t.discountBp)}`} />
            <Mini label="Valor proposto" value={formatCurrencyCents(t.totalCents, currency)} strong />
            {summary.visibility.canViewCost ? <Mini label="Custo" value={t.costCents !== undefined ? formatCurrencyCents(t.costCents, currency) : "—"} /> : null}
            {summary.visibility.canViewMargin ? <Mini label="Lucro bruto" value={t.grossProfitCents !== undefined ? formatCurrencyCents(t.grossProfitCents, currency) : "—"} /> : null}
            {summary.visibility.canViewMargin ? <Mini label="Margem atual" value={formatBp(t.grossMarginBp)} hint={summary.policy.minMarginBp !== undefined ? `mínima ${formatBp(summary.policy.minMarginBp)}` : undefined} /> : null}
            <Mini label="Preço mínimo" value={t.minimumTotalCents !== undefined ? formatCurrencyCents(t.minimumTotalCents, currency) : "—"} />
            <Mini
              label="Ainda pode negociar"
              value={t.negotiationRoomCents !== undefined ? formatCurrencyCents(Math.max(0, t.negotiationRoomCents), currency) : "—"}
              hint={t.negotiationRoomCents !== undefined && t.negotiationRoomCents < 0 ? `${formatCurrencyCents(-t.negotiationRoomCents, currency)} abaixo do mínimo` : undefined}
              danger={t.negotiationRoomCents !== undefined && t.negotiationRoomCents < 0}
            />
          </div>
          {recurring ? (
            <div className="grid grid-cols-3 gap-2">
              <Mini label="MRR" value={formatCurrencyCents(t.mrrCents, currency)} />
              <Mini label="ARR" value={formatCurrencyCents(t.arrCents, currency)} />
              <Mini label="TCV" value={formatCurrencyCents(t.tcvCents, currency)} hint={t.contractMonths ? `contrato de ${t.contractMonths} meses` : "anualizado (sem contrato definido)"} />
            </div>
          ) : null}
          {summary.evaluation.requiresApproval ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              <span>
                {summary.evaluation.reasons.map((reason) => APPROVAL_REASON_LABEL[reason]).join(" · ")} —{" "}
                {summary.approval.status === "approved" ? "aprovado" : summary.approval.status === "pending" ? "aguardando aprovação" : summary.approval.status === "rejected" ? "recusado pelo gestor" : "precisa de aprovação para enviar proposta"}
              </span>
              <Button variant="secondary" size="sm" onClick={onGoToNegotiation}>Ver negociação</Button>
            </div>
          ) : null}
        </div>
      )}
    </DetailBlock>
  );
}

function Mini({ label, value, hint, strong, danger }: { label: string; value: string; hint?: string; strong?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums text-sm text-foreground", strong && "font-semibold", danger && "text-rose-600 dark:text-rose-300")}>{value}</p>
      {hint ? <p className={cn("text-[11px]", danger ? "text-rose-600 dark:text-rose-300" : "text-muted-foreground")}>{hint}</p> : null}
    </div>
  );
}

function GoalAndInsights({ workspaceId, deal, summary }: { workspaceId: string; deal: Deal; summary: DealCommercialSummary }) {
  const { data: insights } = useDealInsights(workspaceId, deal.id);
  const [ai, setAi] = useState<DealAiInsights>();
  const [generating, setGenerating] = useState(false);
  const impact = insights?.goalImpact;

  async function handleGenerate() {
    setGenerating(true);
    try {
      setAi(await generateDealAiInsights(deal.id, workspaceId));
    } catch (cause) {
      toast.error("Não foi possível gerar a análise", { description: errorMessage(cause) });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <DetailBlock label="Meta e próxima ação">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Target className="h-3.5 w-3.5" /> Impacto na meta do mês</p>
            {impact?.available ? (
              <div className="mt-1.5 space-y-1 text-sm">
                <p className="tabular-nums">Meta {formatCurrencyCents(impact.targetCents, deal.currency)} · vendido {formatCurrencyCents(impact.realizedCents, deal.currency)} ({formatBp(impact.attainmentBp)})</p>
                {deal.status === "open" ? (
                  <p className="font-medium text-emerald-700 dark:text-emerald-300">Se fechar: {formatCurrencyCents(impact.afterCloseCents, deal.currency)} · {formatBp(impact.afterCloseAttainmentBp)} da meta{impact.afterCloseRemainingCents > 0 ? ` · faltará ${formatCurrencyCents(impact.afterCloseRemainingCents, deal.currency)}` : " · meta batida"}</p>
                ) : null}
                <Progress bp={impact.attainmentBp} afterBp={deal.status === "open" ? impact.afterCloseAttainmentBp : undefined} />
              </div>
            ) : <p className="mt-1.5 text-sm text-muted-foreground">Sem meta mensal de receita definida para o responsável.</p>}
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Próxima ação</p>
            {summary.nextActivity ? (
              <p className={cn("mt-1.5 text-sm", summary.nextActivity.overdue && "font-medium text-rose-600 dark:text-rose-300")}>{summary.nextActivity.title} · {summary.nextActivity.dueAt ? formatDateTime(summary.nextActivity.dueAt) : "sem prazo"}{summary.nextActivity.overdue ? " · atrasada" : ""}</p>
            ) : deal.status === "open" ? <p className="mt-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">Sem próxima ação definida</p> : <p className="mt-1.5 text-sm text-muted-foreground">—</p>}
            <p className="mt-1 text-[11px] text-muted-foreground">{summary.aging.daysOpen} dias aberta · {summary.aging.daysInStage} dias na etapa{summary.aging.daysWithoutActivity !== undefined ? ` · ${summary.aging.daysWithoutActivity} dias sem atividade` : ""}</p>
          </div>
        </div>
      </DetailBlock>

      <DetailBlock
        label="Inteligência comercial"
        action={insights?.aiAvailable && deal.status === "open" ? <Button variant="ai" size="sm" onClick={handleGenerate} disabled={generating}><VorixAiIcon className="h-4 w-4 text-current" />{ai ? "Atualizar análise" : "Analisar com IA"}</Button> : undefined}
      >
        <div className="space-y-3">
          {insights?.risks.length ? (
            <ul className="space-y-1.5">
              {insights.risks.map((risk) => (
                <li key={risk.code} className="flex gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>{risk.title}{risk.evidence ? <span className="block text-xs italic text-muted-foreground">“{risk.evidence}”</span> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nenhum risco identificado nos dados.</p>}
          {insights?.explanations.length ? <ul className="space-y-1 text-sm text-muted-foreground">{insights.explanations.map((text) => <li key={text} className="flex gap-2"><TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />{text}</li>)}</ul> : null}
          {generating ? <AiLoading kind="analyzing" detail="conversa, propostas e atividades" /> : null}
          {ai && !generating ? (
            <AIInsightCard title="Análise da oportunidade" meta={formatDateTime(ai.generatedAt)} footnote="Sugestões da IA nunca são executadas sozinhas; os números vêm do sistema.">
              {ai.summary ? <p className="text-foreground">{ai.summary}</p> : <p className="text-muted-foreground">Sem dados suficientes para um resumo confiável.</p>}
              {ai.risks.map((risk) => <p key={risk.title}><span className="font-medium text-foreground">Risco:</span> {risk.title} <span className="text-xs italic text-muted-foreground">“{risk.evidence}”</span></p>)}
              {ai.nextActions.map((action) => <p key={action.title}><span className="font-medium text-foreground">Sugestão:</span> {action.title} — <span className="text-muted-foreground">{action.rationale}</span></p>)}
            </AIInsightCard>
          ) : null}
        </div>
      </DetailBlock>
    </>
  );
}

function Progress({ bp, afterBp }: { bp: number; afterBp?: number }) {
  const clamp = (value: number) => Math.min(100, Math.max(0, value / 100));
  return (
    <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-muted">
      {afterBp !== undefined ? <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-300/60 dark:bg-emerald-400/30" style={{ width: `${clamp(afterBp)}%` }} /> : null}
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary dark:bg-primary-glow" style={{ width: `${clamp(bp)}%` }} />
    </div>
  );
}

function WonSnapshot({ deal, canViewMargin }: { deal: Deal; canViewMargin: boolean }) {
  return (
    <DetailBlock label="Venda registrada">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label="Valor final" value={formatCurrencyCents(deal.finalValueCents ?? deal.valueCents, deal.currency)} strong />
        {canViewMargin ? <Mini label="Lucro bruto" value={deal.finalGrossProfitCents !== undefined ? formatCurrencyCents(deal.finalGrossProfitCents, deal.currency) : "—"} /> : null}
        {canViewMargin ? <Mini label="Margem final" value={formatBp(deal.finalMarginBp)} /> : null}
        <Mini label="Fechada em" value={formatDate(deal.closedAt)} hint={deal.wonReason ? `motivo: ${deal.wonReason}` : undefined} />
      </div>
    </DetailBlock>
  );
}

function CockpitSkeleton() {
  return <div className="space-y-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-20 w-full" />)}</div>;
}

// ---------------------------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------------------------

export function DealProducts({ workspaceId, deal }: { workspaceId: string; deal: Deal }) {
  const { data, error, isLoading, mutate } = useDealCommercial(workspaceId, deal.id);
  const { data: products } = useProducts(workspaceId, { activeOnly: true });
  const invalidate = useInvalidateSales(workspaceId);
  const [adding, setAdding] = useState(false);
  const editable = deal.status === "open";

  const productOptions = useMemo(() => (products ?? []).map((product) => ({ id: product.id, label: `${product.name}${product.code ? ` · ${product.code}` : ""} — ${formatCurrencyCents(product.listPriceCents ?? product.priceCents, product.currency)}${BILLING_SUFFIX[product.billingType ?? "one_time"] ?? ""}` })), [products]);

  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      await Promise.all([mutate(), invalidate()]);
      if (success) toast.success(success);
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: errorMessage(cause) });
    }
  }

  if (isLoading) return <CockpitSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;

  return (
    <div className="space-y-6">
      <DetailBlock label={`Produtos e serviços (${data.items.length})`}>
        {data.items.length === 0 ? <p className="mb-3 text-sm text-muted-foreground">Nenhum produto. Sem produtos, o valor é o estimado manual.</p> : (
          <div className="mb-3 space-y-2">
            {data.items.map((item) => <ItemRow key={item.id} item={item} currency={data.currency} summary={data} editable={editable} onSave={(patch) => run(() => updateDealItem(deal.id, item.id, { workspaceId, ...patch }))} onRemove={() => run(() => removeDealItem(deal.id, item.id, workspaceId), "Item removido")} />)}
          </div>
        )}
        {editable ? (
          <SearchableCombo
            items={productOptions}
            value=""
            loading={adding}
            onValueChange={(productId) => {
              setAdding(true);
              void run(() => addDealItem(deal.id, { workspaceId, productId, quantity: 1 }), "Produto adicionado").finally(() => setAdding(false));
            }}
            placeholder={productOptions.length ? "+ Adicionar produto ou serviço" : "Cadastre produtos em Configurações › Produtos"}
            searchPlaceholder="Buscar por nome ou código..."
            emptyText="Nenhum produto encontrado."
            disabled={!productOptions.length}
          />
        ) : <p className="text-xs text-muted-foreground">Oportunidade fechada — reabra para alterar os termos.</p>}
      </DetailBlock>
      <DealTermsBlock workspaceId={workspaceId} deal={deal} summary={data} editable={editable} onSaved={() => Promise.all([mutate(), invalidate()]).then(() => undefined)} />
    </div>
  );
}

function ItemRow({ item, currency, summary, editable, onSave, onRemove }: { item: DealItem; currency: string; summary: DealCommercialSummary; editable: boolean; onSave: (patch: { quantity?: number; proposedUnitPriceCents?: number; discountBp?: number }) => Promise<void>; onRemove: () => Promise<void> }) {
  const [quantity, setQuantity] = useState(String(item.quantity).replace(".", ","));
  const [price, setPrice] = useState(currencyInputFromCents(item.proposedUnitPriceCents));
  const [discount, setDiscount] = useState(percentInputFromBp(item.subtotalListCents ? Math.round((item.discountCents * 10000) / item.subtotalListCents) : undefined));
  const belowMinimum = item.minimumPriceCentsSnapshot !== undefined && item.proposedUnitPriceCents < item.minimumPriceCentsSnapshot;
  const save = () => {
    const nextQuantity = Number(quantity.replace(",", "."));
    const nextPrice = centsFromCurrencyInput(price);
    if (nextQuantity === item.quantity && nextPrice === item.proposedUnitPriceCents) return;
    void onSave({ quantity: nextQuantity, proposedUnitPriceCents: nextPrice });
  };
  return (
    <div className={cn("rounded-xl border p-3", belowMinimum ? "border-rose-200 dark:border-rose-500/30" : "border-border/70")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.productNameSnapshot}{item.productCodeSnapshot ? <span className="text-muted-foreground"> · {item.productCodeSnapshot}</span> : null}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            Tabela {formatCurrencyCents(item.listPriceCentsSnapshot, currency)}{BILLING_SUFFIX[item.billingTypeSnapshot] ?? ""}
            {item.minimumPriceCentsSnapshot !== undefined ? ` · mínimo ${formatCurrencyCents(item.minimumPriceCentsSnapshot, currency)}` : ""}
            {summary.visibility.canViewCost && item.unitCostCentsSnapshot !== undefined ? ` · custo ${formatCurrencyCents(item.unitCostCentsSnapshot, currency)}` : ""}
          </p>
        </div>
        {editable ? <Button variant="ghost" size="icon" aria-label="Remover item" onClick={() => void onRemove()}><Trash2 className="h-4 w-4" /></Button> : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="text-[11px] text-muted-foreground">Qtd.<Input value={quantity} disabled={!editable} onChange={(event) => setQuantity(event.target.value)} onBlur={save} inputMode="decimal" /></label>
        <label className="text-[11px] text-muted-foreground">Preço proposto<MoneyInput value={price} disabled={!editable} onChange={(event) => setPrice(event.target.value)} onBlur={save} /></label>
        <label className="text-[11px] text-muted-foreground">Desconto %
          <Input
            value={discount}
            disabled={!editable}
            onChange={(event) => setDiscount(event.target.value)}
            onBlur={() => {
              const bp = bpFromPercentInput(discount);
              if (bp === undefined) return;
              setPrice(currencyInputFromCents(priceFromDiscount(item.listPriceCentsSnapshot, Math.min(10000, Math.max(0, bp)))));
              void onSave({ discountBp: Math.min(10000, Math.max(0, bp)) });
            }}
            inputMode="decimal"
          />
        </label>
      </div>
      <p className={cn("mt-2 text-xs tabular-nums", belowMinimum ? "font-medium text-rose-600 dark:text-rose-300" : "text-muted-foreground")}>
        Subtotal {formatCurrencyCents(item.subtotalProposedCents, currency)}
        {item.discountCents > 0 ? ` · desconto ${formatCurrencyCents(item.discountCents, currency)}` : ""}
        {summary.visibility.canViewMargin && item.grossMarginBp !== undefined ? ` · margem ${formatBp(item.grossMarginBp)}` : ""}
        {belowMinimum ? " · abaixo do mínimo" : ""}
      </p>
    </div>
  );
}

function DealTermsBlock({ workspaceId, deal, summary, editable, onSaved }: { workspaceId: string; deal: Deal; summary: DealCommercialSummary; editable: boolean; onSaved: () => Promise<void> }) {
  const [discount, setDiscount] = useState(currencyInputFromCents(deal.discountCents ?? 0));
  const [contract, setContract] = useState(deal.contractMonths ? String(deal.contractMonths) : "");
  const [manualValue, setManualValue] = useState(currencyInputFromCents(deal.valueCents));
  async function save(patch: Parameters<typeof updateDealCommercial>[1]) {
    try {
      await updateDealCommercial(deal.id, patch);
      await onSaved();
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: errorMessage(cause) });
    }
  }
  return (
    <DetailBlock label="Termos">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Modo do valor</Label>
          <Select value={summary.valueMode} disabled={!editable} onValueChange={(value) => void save({ workspaceId, valueMode: value as "manual" | "calculated" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="calculated">Calculado pelos produtos</SelectItem>
              <SelectItem value="manual">Valor manual (estimado)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {summary.valueMode === "manual" ? (
          <div>
            <Label htmlFor="deal-manual-value">Valor estimado</Label>
            <MoneyInput id="deal-manual-value" value={manualValue} disabled={!editable} onChange={(event) => setManualValue(event.target.value)} onBlur={() => void save({ workspaceId, valueCents: centsFromCurrencyInput(manualValue) })} />
          </div>
        ) : (
          <div>
            <Label htmlFor="deal-global-discount">Desconto global</Label>
            <MoneyInput id="deal-global-discount" value={discount} disabled={!editable} onChange={(event) => setDiscount(event.target.value)} onBlur={() => void save({ workspaceId, discountCents: centsFromCurrencyInput(discount) })} />
          </div>
        )}
        <div>
          <Label htmlFor="deal-contract">Contrato (meses) — recorrência</Label>
          <Input id="deal-contract" value={contract} disabled={!editable} placeholder="Sem prazo definido" onChange={(event) => setContract(event.target.value.replace(/\D/g, ""))} onBlur={() => void save({ workspaceId, contractMonths: contract ? Number(contract) : null })} inputMode="numeric" />
        </div>
      </div>
    </DetailBlock>
  );
}

// ---------------------------------------------------------------------------------------------
// Negociação: política, aprovação, probabilidade e forecast
// ---------------------------------------------------------------------------------------------

export function DealNegotiation({ workspaceId, deal }: { workspaceId: string; deal: Deal }) {
  const { data, error, isLoading, mutate } = useDealCommercial(workspaceId, deal.id);
  const invalidate = useInvalidateSales(workspaceId);
  const [justification, setJustification] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [probability, setProbability] = useState<string>(deal.probability !== undefined ? String(deal.probability) : "");

  if (isLoading) return <CockpitSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  const open = deal.status === "open";

  async function handleRequest() {
    setRequesting(true);
    try {
      await requestApproval(deal.id, { workspaceId, justification: justification.trim() || undefined });
      setJustification("");
      await Promise.all([mutate(), invalidate()]);
      toast.success("Pedido de aprovação enviado ao gestor.");
    } catch (cause) {
      toast.error("Não foi possível pedir aprovação", { description: errorMessage(cause) });
    } finally {
      setRequesting(false);
    }
  }

  async function saveForecast(patch: Parameters<typeof updateDealCommercial>[1]) {
    try {
      await updateDealCommercial(deal.id, patch);
      await Promise.all([mutate(), invalidate()]);
    } catch (cause) {
      toast.error("Não foi possível salvar", { description: errorMessage(cause) });
    }
  }

  const request = data.approval.request;
  return (
    <div className="space-y-7">
      <DetailBlock label="Política comercial">
        <div className="grid gap-2 sm:grid-cols-3">
          <Mini label="Margem mínima" value={data.visibility.canViewMargin ? formatBp(data.policy.minMarginBp) : "—"} />
          <Mini label="Desconto máximo" value={formatBp(data.policy.maxDiscountBp)} />
          <Mini label="Abaixo do mínimo" value={data.policy.allowBelowMinimum ? "Permitido" : "Exige aprovação"} hint={data.policy.source === "none" ? "sem política configurada" : `regra: ${({ user: "do vendedor", team: "da equipe", role: "do papel", workspace: "da empresa", none: "" } as const)[data.policy.source]}`} />
        </div>
      </DetailBlock>

      <DetailBlock label="Aprovação">
        {!data.evaluation.requiresApproval ? <p className="text-sm text-muted-foreground">Condição dentro da política — nenhuma aprovação necessária.</p> : (
          <div className="space-y-3">
            <p className="text-sm">{data.evaluation.reasons.map((reason) => APPROVAL_REASON_LABEL[reason]).join(" · ")}</p>
            {data.approval.status === "approved" ? <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Aprovado{request?.decisionReason ? ` — ${request.decisionReason}` : ""}. A proposta pode ser enviada.</p> : null}
            {data.approval.status === "pending" ? <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Aguardando decisão do gestor (pedido em {formatDateTime(request?.createdAt)}).</p> : null}
            {data.approval.status === "rejected" ? <p className="text-sm font-medium text-rose-600 dark:text-rose-300">Recusado{request?.decisionReason ? `: ${request.decisionReason}` : ""}. Ajuste a condição ou peça de novo.</p> : null}
            {open && (data.approval.status === "missing" || data.approval.status === "rejected") ? (
              <div className="space-y-2">
                <Label htmlFor="approval-justification">Justificativa para o gestor</Label>
                <Textarea id="approval-justification" value={justification} onChange={(event) => setJustification(event.target.value)} rows={2} placeholder="Ex.: cliente estratégico, concorrente ofereceu 15% menos" />
                <Button onClick={handleRequest} loading={requesting}>Pedir aprovação</Button>
              </div>
            ) : null}
          </div>
        )}
      </DetailBlock>

      <DetailBlock label="Forecast">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Categoria de forecast</Label>
            <Select value={data.forecastCategory} disabled={!open} onValueChange={(value) => void saveForecast({ workspaceId, forecastCategory: value as "pipeline" | "best_case" | "commit" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pipeline">Pipeline</SelectItem>
                <SelectItem value="best_case">Best case</SelectItem>
                <SelectItem value="commit">Commit (vai fechar)</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">Sua confiança no fechamento — não move a etapa.</p>
          </div>
          <div>
            <Label htmlFor="deal-probability">Probabilidade (%)</Label>
            <Input id="deal-probability" value={probability} disabled={!open} placeholder={`${data.probability.value} (padrão da etapa)`} onChange={(event) => setProbability(event.target.value.replace(/\D/g, "").slice(0, 3))} onBlur={() => void saveForecast({ workspaceId, probability: probability === "" ? null : Math.min(100, Number(probability)) })} inputMode="numeric" />
            <p className="mt-1 text-[11px] text-muted-foreground">Vazio = probabilidade da etapa. Ponderado: {formatCurrencyCents(data.weightedValueCents, data.currency)}.</p>
          </div>
        </div>
      </DetailBlock>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Fechamento: ganho e perda (motivos configuráveis)
// ---------------------------------------------------------------------------------------------

export function CloseDealModal({
  mode,
  deal,
  reasons,
  competitors,
  onClose,
  onConfirm,
}: {
  mode: "won" | "lost";
  deal: Deal;
  reasons: readonly { id: string; label: string }[];
  competitors: readonly { id: string; name: string }[];
  onClose: () => void;
  onConfirm: (input: { reason?: string; comment?: string; competitorId?: string; competitorName?: string; finalValueCents?: number }) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [newCompetitor, setNewCompetitor] = useState("");
  const [finalValue, setFinalValue] = useState(currencyInputFromCents(deal.valueCents));
  const [busy, setBusy] = useState(false);
  const lost = mode === "lost";
  return (
    <Modal title={lost ? "Marcar como perdida" : "Marcar como ganha"} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <Label>{lost ? "Motivo da perda" : "Motivo do ganho (opcional)"}</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{reasons.map((item) => <SelectItem key={item.id} value={item.label}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {lost ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label>Concorrente (opcional)</Label>
              <SearchableCombo items={competitors.map((item) => ({ id: item.id, label: item.name }))} value={competitor} onValueChange={setCompetitor} placeholder="Nenhum" searchPlaceholder="Buscar concorrente..." extraOption={{ value: "", label: "Nenhum" }} />
            </div>
            <div>
              <Label htmlFor="new-competitor">Ou novo concorrente</Label>
              <Input id="new-competitor" value={newCompetitor} onChange={(event) => setNewCompetitor(event.target.value)} placeholder="Nome" />
            </div>
          </div>
        ) : deal.valueMode !== "calculated" ? (
          <div>
            <Label htmlFor="final-value">Valor final</Label>
            <MoneyInput id="final-value" value={finalValue} onChange={(event) => setFinalValue(event.target.value)} />
          </div>
        ) : <p className="text-xs text-muted-foreground">Valor final = {formatCurrencyCents(deal.valueCents, deal.currency)} (produtos e condições negociadas). O snapshot da venda fica registrado e não muda depois.</p>}
        <div>
          <Label htmlFor="close-comment">Observação</Label>
          <Textarea id="close-comment" value={comment} onChange={(event) => setComment(event.target.value)} rows={2} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            variant={lost ? "danger" : "primary"}
            loading={busy}
            disabled={busy || (lost && !reason)}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm({
                  reason: reason || undefined,
                  comment: comment.trim() || undefined,
                  competitorId: competitor || undefined,
                  competitorName: newCompetitor.trim() || undefined,
                  finalValueCents: !lost && deal.valueMode !== "calculated" ? centsFromCurrencyInput(finalValue) : undefined,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {lost ? "Confirmar perda" : "Confirmar venda"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
