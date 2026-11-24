"use client";

import Link from "next/link";
import { useState } from "react";
import { AudioLines, Check, ChevronDown, Globe, MessageCircle, Minus, Plus, Sparkles } from "lucide-react";
import useSWR from "swr";
import { useDebounce } from "@/hooks/useDebounce";
import { formatCapacityLine, formatCreditsQuota, simulateCapacity } from "@/features/platform-plans/api";
import type { PublicProductCatalog } from "@/features/public-site/catalog";
import { clamp, CONFIGURATOR_LIMITS, formatMoney, type ConfiguratorField } from "@/features/public-site/configurator";
import { capacityForPlan, initialSelection, makeModularQuote, toggleModule } from "@/features/public-site/modular-quote";
import { MODULE_KEYS, MODULE_SHOWCASE } from "@/features/public-site/showcase";

const icons = { conversations: MessageCircle, marketing: Sparkles, site: Globe, meetings: AudioLines };

export function PlanConfigurator({ catalog, initialModule }: { catalog: PublicProductCatalog; initialModule?: string }) {
  const [selection, setSelection] = useState(() => initialSelection(catalog, initialModule));
  const plan = catalog.plans.find(item => item.code === selection.planCode);
  const hasConversas = selection.modules.includes("conversations");
  const hasMeetings = selection.modules.includes("meetings");
  const key = `${selection.users}:${selection.numbers}`;
  const debounced = useDebounce(key, 160);
  const needsOptions = hasConversas && !!plan && (selection.users !== (catalog.plans[0]?.includedUsers ?? 2) || selection.numbers !== (catalog.plans[0]?.includedWhatsappConnections ?? 1));
  const result = useSWR(needsOptions && debounced === key ? ["public-plan-capacity", debounced] : null, ([, quantities]) => {
    const [users, whatsappConnections] = quantities.split(":").map(Number);
    return simulateCapacity({ users, whatsappConnections });
  }, { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 30_000 });
  const options = debounced === key ? result.data?.options : undefined;
  const pending = needsOptions && (debounced !== key || result.isLoading);
  const quote = makeModularQuote(catalog, selection, options);
  const official = catalog.billing?.priceSource === "plan_versions";
  const recordingsOffer = official ? catalog.billing?.meetingsOffer : null;
  const current = plan && capacityForPlan(plan, selection, options);
  const improvedOption = selection.period === "monthly" && plan && current && options
    ? options.filter(candidate => candidate.feasible && candidate.currency === current.currency
      && candidate.totalMonthlyAmount < current.totalMonthlyAmount
      && catalog.plans.some(item => item.code === candidate.planCode && item.monthlyPriceUsd > plan.monthlyPriceUsd))
      .sort((a, b) => a.totalMonthlyAmount - b.totalMonthlyAmount)[0]
    : undefined;
  const improved = catalog.plans.find(item => item.code === improvedOption?.planCode);
  const setQuantity = (field: ConfiguratorField, value: number) => setSelection(previous => ({ ...previous, [field]: clamp(field, value) }));

  return <div className="vc-config" id="monte">
    <fieldset className="vc-module-picker">
      <legend>Escolha os módulos</legend>
      <div className="vc-picker-grid">{MODULE_KEYS.map(key => {
        const item = MODULE_SHOWCASE[key];
        const Icon = icons[key];
        const selected = selection.modules.includes(key);
        const product = catalog.products.find(product => product.key === key);
        const value = key === "conversations" && product && !product.provisional ? product.monthlyPrice : key === "meetings" ? recordingsOffer?.baseMonthlyPrice : null;
        const available = product?.contractable;
        const condition = key === "conversations" && available ? "Contratação online" : key === "meetings" && available ? "Capacidade na conta" : "Atendimento comercial";
        return <label key={key} className="vc-picker-card" data-selected={selected}>
          <input type="checkbox" name="modulos" aria-label={`Vorix ${item.name}`} checked={selected} disabled={selected && selection.modules.length === 1} onChange={() => setSelection(previous => toggleModule(previous, key))} />
          <span className="vc-picker-card-top"><Icon size={23} aria-hidden="true" /><span className="vc-picker-check">{selected && <Check size={16} aria-hidden="true" />}</span></span>
          <strong>{item.name}</strong>
          <span>{item.benefits.slice(0, 3).join(" · ")}</span>
          <span className="vc-picker-price">{value && Number.isFinite(value) && value > 0 ? `A partir de ${formatMoney(value, product?.currency ?? "BRL")}/mês` : "Sob consulta"}</span>
          <small>{condition}</small>
        </label>;
      })}</div>
    </fieldset>

    <div className="vc-config-grid">
      <div className="vc-config-controls">
        <h2>Ajuste a capacidade</h2>
        <fieldset className="vc-period">
          <legend>Período de cobrança</legend>
          {[["monthly", "Mensal"], ["yearly", "Anual"]].map(([value, label]) => <label key={value}>
            <input type="radio" name="periodo" checked={selection.period === value} value={value} onChange={() => setSelection(previous => ({ ...previous, period: value === "yearly" ? "yearly" : "monthly" }))} />{label}
          </label>)}
        </fieldset>
        {hasConversas && <section className="vc-config-block" aria-labelledby="capacity-conversations">
          <h3 id="capacity-conversations">Conversas</h3>
          {catalog.plans.length ? <label className="vc-plan-select">
            <span>Plano de Conversas</span>
            <select value={selection.planCode ?? ""} onChange={event => {
              const code = catalog.plans.find(item => item.code === event.target.value)?.code;
              if (code) setSelection(previous => ({ ...previous, planCode: code }));
            }}>
              {catalog.plans.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
            <ChevronDown size={17} aria-hidden="true" />
          </label> : <p>Consulte o time comercial para confirmar os planos disponíveis.</p>}
          {plan && <p className="vc-plan-included">{formatCapacityLine(plan)} · {formatCreditsQuota(plan.monthlyCreditsQuota)} por mês</p>}
          <CapacityInput id="users" label="Usuários" hint="Quantidade total de pessoas na operação" value={selection.users} onChange={setQuantity} />
          <CapacityInput id="numbers" label="Números de WhatsApp" hint="Quantidade total de números conectados" value={selection.numbers} onChange={setQuantity} />
          {improved && improvedOption && <div className="vc-recommendation">
            <p><strong>Vale comparar o plano {improved.name}.</strong> Com esta capacidade, ele fica em {formatMoney(improvedOption.totalMonthlyAmount, improvedOption.currency)}/mês e inclui {formatCapacityLine(improved)} e {formatCreditsQuota(improved.monthlyCreditsQuota)} por mês.</p>
            <button type="button" className="public-button secondary" onClick={() => setSelection(previous => ({ ...previous, planCode: improved.code }))}>Selecionar {improved.name}</button>
          </div>}
        </section>}
        {hasMeetings && <section className="vc-config-block" aria-labelledby="capacity-meetings">
          <h3 id="capacity-meetings">Meetings</h3>
          {recordingsOffer ? <CapacityInput id="recordings" label="Gravações simultâneas" hint="Quantas reuniões precisam ser gravadas ao mesmo tempo" value={selection.recordings} onChange={setQuantity} /> : <p>Os preços da capacidade de gravação estão sob consulta.</p>}
          <p>As contas Google conectadas atendem a infraestrutura de gravação. O adicional é por gravação simultânea.</p>
        </section>}
        {(["marketing", "site"] as const).filter(key => selection.modules.includes(key)).map(key => <section key={key} className="vc-config-block">
          <h3>{MODULE_SHOWCASE[key].name}</h3><p>{MODULE_SHOWCASE[key].capacity}</p>
        </section>)}
      </div>

      <aside className="vc-config-summary" aria-labelledby="config-summary-title">
        <h2 id="config-summary-title">Resumo da configuração</h2>
        <dl className="vc-quote-lines">{quote.lines.map(line => <div key={line.label}><dt>{line.label}</dt><dd>{line.amount === null ? "Sob consulta" : formatMoney(line.amount, line.currency)}</dd></div>)}</dl>
        <div className="vc-quote-total" aria-live="polite" aria-atomic="true">
          <span>{quote.complete ? `Total por ${quote.period}` : `Subtotal conhecido por ${quote.period}`}</span>
          <strong>{quote.total === null ? "Sob consulta" : formatMoney(quote.total, quote.currency)}</strong>
        </div>
        {quote.discount > 0 && <p>Desconto da combinação {formatMoney(quote.discount, quote.currency)}</p>}
        {selection.modules.length > 1 && <p>As condições comerciais da combinação serão confirmadas conforme os módulos escolhidos.</p>}
        {quote.notes.map(note => <p key={note}>{note}</p>)}
        {pending && <p role="status">Consultando a capacidade no catálogo…</p>}
        {result.error && <p role="status">A cotação de capacidade está indisponível. Consulte o time comercial para confirmar os adicionais.</p>}
        {pending && !quote.complete
          ? <button className="public-button primary" type="button" disabled>Consultando o valor</button>
          : <Link className="public-button primary" href={quote.href} prefetch={false}>{quote.action}</Link>}
        {!quote.direct && <details><summary>Ver configuração para compartilhar</summary><p className="vc-share-summary">{quote.summary}</p></details>}
        <Link className="public-text-link" href="/login?destino=assinatura">Já sou assinante</Link>
      </aside>
    </div>
  </div>;
}

function CapacityInput({ id, label, hint, value, onChange }: { id: ConfiguratorField; label: string; hint: string; value: number; onChange: (field: ConfiguratorField, value: number) => void }) {
  const { min, max } = CONFIGURATOR_LIMITS[id];
  return <div className="vc-capacity-input">
    <div><label htmlFor={`capacity-${id}`}>{label}</label><p id={`capacity-${id}-hint`}>{hint}</p></div>
    <div className="vc-capacity-stepper">
      <button type="button" aria-label={`Diminuir ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(id, value - 1)}><Minus size={16} aria-hidden="true" /></button>
      <input id={`capacity-${id}`} aria-describedby={`capacity-${id}-hint`} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={event => { if (event.target.value !== "") onChange(id, event.target.valueAsNumber); }} />
      <button type="button" aria-label={`Aumentar ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(id, value + 1)}><Plus size={16} aria-hidden="true" /></button>
    </div>
  </div>;
}
