"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Minus, Plus, MessageSquare, Video } from "lucide-react";
import { simulateCapacity, type CapacityRecommendationOption } from "@/features/platform-plans/api";
import type { PublicProductCatalog } from "@/features/public-site/catalog";
import {
  adjustQuantity, clamp, composeQuote, CONFIGURATOR_LIMITS, formatMoney, includedPlanQuote, initialConfiguratorState, setQuantity, toggleProduct,
  type ConfiguratorField, type ConfiguratorState,
} from "@/features/public-site/configurator";

/**
 * "Monte seu Vorix". Conversas: cotação do simulador OFICIAL (mesma conta do checkout), com cache
 * e debounce para o total responder na hora. Meetings: preço oficial do catálogo. "Contratar agora"
 * leva ao cadastro e ao pagamento com cartão com exatamente esta configuração.
 */
export function PlanConfigurator({ catalog }: { catalog: Pick<PublicProductCatalog, "products" | "plans"> & { billing?: PublicProductCatalog["billing"] } }) {
  const startPlan = catalog.plans[0] ?? null;
  const [state, setState] = useState<ConfiguratorState>(() => initialConfiguratorState(startPlan));
  const { quote: conversationsQuote, failed, loading, warm } = useConversationsQuote(state, startPlan ? includedPlanQuote(startPlan) : null, catalog.plans.length > 0);
  const quote = useMemo(() => composeQuote({ state, catalog, conversationsQuote, quoteFailed: failed }), [state, catalog, conversationsQuote, failed]);
  const total = quote.knownTotal === null ? null : formatMoney(quote.knownTotal, quote.currency);
  const { controlsRef, summaryRef, showBar } = useMobileBar();
  const totalCaption = quote.hasUndefinedAmounts ? "+ valores a definir" : quote.totalIsOfficial ? "por mês" : "por mês · estimativa";
  const meetingsContractable = catalog.products.find(product => product.key === "meetings")?.contractable === true;

  return <div className="public-configurator" id="monte" onPointerEnter={warm} onFocus={warm}>
    <div className="public-config-controls" ref={controlsRef}>
      <fieldset className="public-config-products">
        <legend>Escolha as soluções</legend>
        <ProductToggle product="conversations" checked={state.conversations} onChange={() => setState(current => toggleProduct(current, "conversations"))} title="Vorix Conversas" caption="Atendimento e vendas" />
        <ProductToggle product="meetings" checked={state.meetings} onChange={() => setState(current => toggleProduct(current, "meetings"))} title="Vorix Meetings" caption={meetingsContractable ? "Gravação e inteligência de reuniões" : "Disponível em breve"} />
      </fieldset>

      {state.conversations ? <section className="public-config-group conversations" aria-labelledby="config-conversations">
        <h3 id="config-conversations"><MessageSquare size={17} aria-hidden="true" /> Conversas</h3>
        <Stepper field="users" label="Usuários" hint="Pessoas que atendem e vendem" value={state.users} onChange={(field, value) => setState(current => setQuantity(current, field, value))} onStep={(field, delta) => setState(current => adjustQuantity(current, field, delta))} />
        <Stepper field="numbers" label="Números conectados" hint="Números de WhatsApp da operação" value={state.numbers} onChange={(field, value) => setState(current => setQuantity(current, field, value))} onStep={(field, delta) => setState(current => adjustQuantity(current, field, delta))} />
      </section> : null}

      {state.meetings ? <section className="public-config-group meetings" aria-labelledby="config-meetings">
        <h3 id="config-meetings"><Video size={17} aria-hidden="true" /> Meetings</h3>
        <Stepper field="recordings" label="Gravações simultâneas" hint="Reuniões gravadas ao mesmo tempo" value={state.recordings} onChange={(field, value) => setState(current => setQuantity(current, field, value))} onStep={(field, delta) => setState(current => adjustQuantity(current, field, delta))} />
      </section> : null}

      <ul className="public-config-facts">
        {state.conversations ? <li><MessageSquare size={15} aria-hidden="true" /><span>Depois de contratar, você ajusta usuários e números em <strong>Configurações → Plano</strong>.</span></li> : null}
        {state.meetings ? <li><Video size={15} aria-hidden="true" /><span>No Meetings, a unidade contratada é a <strong>gravação simultânea</strong>. As contas de gravação que você conecta não são cobradas como licença e podem ficar como reserva.</span></li> : null}
      </ul>
    </div>

    <aside className="public-config-summary" aria-labelledby="config-summary-title" ref={summaryRef}>
      <span className="public-eyebrow">Resumo</span>
      <h3 id="config-summary-title">{quote.title}</h3>
      <ul className="public-config-summary-list">{quote.summary.map(item => <li key={item.product} className={item.product}><strong>{item.name}</strong><span>{item.details.join(" · ")}</span></li>)}</ul>
      <div className={"public-config-total" + (loading ? " is-updating" : "")} aria-live="polite" aria-atomic="true">
        <small>Total mensal</small>
        <strong>{total ?? "—"}</strong>
        <span>{total ? totalCaption : "Valor indisponível no momento"}</span>
      </div>
      <details className="public-config-breakdown">
        <summary>Ver composição do preço</summary>
        <dl>{quote.lines.map(line => <div key={line.label} className={line.product}><dt>{line.label}{line.provisional ? <em> · referência</em> : null}</dt><dd>{line.amount === null ? "a definir" : formatMoney(line.amount, quote.currency)}</dd></div>)}</dl>
      </details>
      {quote.notes.length ? <ul className="public-config-notes">{quote.notes.map(note => <li key={note}>{note}</li>)}</ul> : null}
      <div className="public-config-actions">
        {quote.primaryCta.disabled
          ? <button type="button" className="public-button primary" disabled>{quote.primaryCta.label}</button>
          : <Link href={quote.primaryCta.href} className="public-button primary">{quote.primaryCta.label}<ArrowUpRight size={16} aria-hidden="true" /></Link>}
        {quote.secondaryCta ? <Link href={quote.secondaryCta.href} className="public-button secondary">{quote.secondaryCta.label}</Link> : null}
      </div>
    </aside>

    {/* Mobile: o total e o próximo passo nunca ficam escondidos enquanto a pessoa ajusta. */}
    <div className={"public-config-bar" + (showBar ? " is-visible" : "")} aria-hidden="true">
      <span><small>{quote.title}</small><strong>{total ?? "—"}</strong>{total ? <em>{quote.hasUndefinedAmounts ? "+ a definir" : "/mês"}</em> : null}</span>
      <a href="#config-summary-title" tabIndex={-1}>Ver resumo</a>
    </div>
  </div>;
}

function ProductToggle({ product, checked, onChange, title, caption }: { product: "conversations" | "meetings"; checked: boolean; onChange: () => void; title: string; caption: string }) {
  const Icon = product === "meetings" ? Video : MessageSquare;
  return <label className={"public-config-toggle " + product}>
    <input type="checkbox" checked={checked} onChange={onChange} />
    <span className="public-config-check" aria-hidden="true">{checked ? <Check size={13} /> : null}</span>
    <Icon size={18} aria-hidden="true" />
    <span><strong>{title}</strong><small>{caption}</small></span>
  </label>;
}

function Stepper({ field, label, hint, value, onStep, onChange }: { field: ConfiguratorField; label: string; hint: string; value: number; onStep: (field: ConfiguratorField, delta: number) => void; onChange: (field: ConfiguratorField, value: number) => void }) {
  const { min, max } = CONFIGURATOR_LIMITS[field];
  const id = `config-${field}`;
  return <div className="public-stepper">
    <div><label htmlFor={id}>{label}</label><small id={id + "-hint"}>{hint}</small></div>
    <div className="public-stepper-control">
      <button type="button" onClick={() => onStep(field, -1)} disabled={value <= min} aria-label={`Diminuir ${label.toLowerCase()}`}><Minus size={15} aria-hidden="true" /></button>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} aria-describedby={id + "-hint"}
        onChange={event => { const next = Number(event.target.value); if (event.target.value !== "") onChange(field, next); }}
        onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); onStep(field, event.key === "ArrowUp" ? 1 : -1); } }} />
      <button type="button" onClick={() => onStep(field, 1)} disabled={value >= max} aria-label={`Aumentar ${label.toLowerCase()}`}><Plus size={15} aria-hidden="true" /></button>
    </div>
    {value >= max ? <p className="public-stepper-limit">Limite desta simulação. Depois de contratar, você amplia em Configurações → Plano.</p> : null}
  </div>;
}

/** Barra fixa do mobile: só enquanto os controles estão na tela e o resumo ainda não. */
function useMobileBar() {
  const controlsRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === controlsRef.current) setControlsVisible(entry.isIntersecting);
        if (entry.target === summaryRef.current) setSummaryVisible(entry.isIntersecting);
      }
    }, { threshold: 0.05 });
    if (controlsRef.current) observer.observe(controlsRef.current);
    if (summaryRef.current) observer.observe(summaryRef.current);
    return () => observer.disconnect();
  }, []);
  return { controlsRef, summaryRef, showBar: controlsVisible && !summaryVisible };
}

/**
 * Cotação oficial com cache por configuração, deduplicação e PRÉ-BUSCA das vizinhas (±1 usuário,
 * ±1 número): o próximo clique já encontra o valor pronto. Todo valor vem do simulador oficial.
 */
function useConversationsQuote(state: ConfiguratorState, initial: CapacityRecommendationOption | null, enabled: boolean) {
  const cache = useRef(new Map<string, CapacityRecommendationOption | null>());
  const pending = useRef(new Map<string, Promise<CapacityRecommendationOption | null>>());
  const key = quoteKeyOf(state.users, state.numbers);
  if (initial && cache.current.size === 0) cache.current.set(quoteKeyOf(initial.includedUsers ?? 0, initial.includedWhatsappConnections ?? 0), initial);
  const [quote, setQuote] = useState<CapacityRecommendationOption | null>(initial);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  // Pré-busca só depois da primeira interação: abrir a página não gera chamadas ao simulador.
  const touched = useRef(false);
  if (initial && key !== quoteKeyOf(initial.includedUsers ?? 0, initial.includedWhatsappConnections ?? 0)) touched.current = true;

  const fetchQuote = (users: number, numbers: number) => {
    const quoteKey = quoteKeyOf(users, numbers);
    const existing = pending.current.get(quoteKey);
    if (existing) return existing;
    const request = simulateCapacity({ users, whatsappConnections: numbers })
      .then(result => { const value = result.recommended ?? null; cache.current.set(quoteKey, value); return value; })
      .finally(() => pending.current.delete(quoteKey));
    pending.current.set(quoteKey, request);
    return request;
  };
  const prefetchAround = (users: number, numbers: number) => {
    for (const [u, n] of [[users + 1, numbers], [users - 1, numbers], [users, numbers + 1], [users, numbers - 1]] as const) {
      const nextUsers = clamp("users", u);
      const nextNumbers = clamp("numbers", n);
      const quoteKey = quoteKeyOf(nextUsers, nextNumbers);
      if (!cache.current.has(quoteKey) && !pending.current.has(quoteKey)) void fetchQuote(nextUsers, nextNumbers).catch(() => undefined);
    }
  };

  useEffect(() => {
    if (!enabled || !state.conversations) return;
    const cached = cache.current.get(key);
    if (cached !== undefined) {
      setQuote(cached); setFailed(cached === null); setLoading(false);
      if (touched.current) prefetchAround(state.users, state.numbers);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchQuote(state.users, state.numbers)
        .then(value => { if (!cancelled) { setQuote(value); setFailed(value === null); prefetchAround(state.users, state.numbers); } })
        .catch(() => { if (!cancelled) { setQuote(null); setFailed(true); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, pending.current.has(key) ? 0 : 80);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, enabled, state.conversations, state.users, state.numbers]); // eslint-disable-line react-hooks/exhaustive-deps
  // Aquece o cache quando a pessoa chega ao configurador (mouse/foco), antes do primeiro clique.
  const warm = () => {
    if (touched.current || !enabled || !state.conversations) return;
    touched.current = true;
    prefetchAround(state.users, state.numbers);
  };
  return { quote: enabled ? quote : null, failed: enabled ? failed : true, loading, warm };
}

const quoteKeyOf = (users: number, numbers: number) => `${users}:${numbers}`;
