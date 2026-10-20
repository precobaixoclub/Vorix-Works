import type { ReactNode } from "react";
import { ArrowUpRight, CalendarDays, Check, Layers3, Sparkles } from "lucide-react";
import type { PublicProposal } from "@/features/crm/public-proposal-api";
import { BILLING_SUFFIX } from "@/features/sales/presentation";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import styles from "./ProposalDocument.module.css";

/** Documento compartilhado pela revisão do vendedor e pelo link recebido pelo cliente. */
export function ProposalDocument({ proposal, actions, preview }: { proposal: PublicProposal; actions?: ReactNode; preview?: boolean }) {
  const issuer = proposal.issuerName || "Proposta comercial";
  const mark = issuer.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  return (
    <article className={styles.document}>
      <header className={styles.brandbar}>
        <div className={styles.brand}><span className={styles.brandmark}>{mark}</span><div><strong>{issuer}</strong><span>Conectando ideias. Criando possibilidades.</span></div></div>
        <span className={styles.edition}>{preview ? "Prévia da proposta" : "Proposta comercial"}<ArrowUpRight size={14} aria-hidden="true" /></span>
      </header>

      <section className={styles.hero}>
        <div className={styles.orbit} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span />{proposal.number ?? "Sua proposta"}{proposal.version > 1 ? ` · versão ${proposal.version}` : ""}</p>
          <h1>{proposal.title}</h1>
          {proposal.customerName ? <p className={styles.recipient}>Para {proposal.customerName}{proposal.customerCompany ? ` · ${proposal.customerCompany}` : ""}</p> : null}
          <p className={styles.heroCaption}>O próximo passo começa com uma boa escolha.</p>
          <div className={styles.heroMeta}>
            <span><Layers3 size={15} aria-hidden="true" />{proposal.items.length} {proposal.items.length === 1 ? "item na sua solução" : "itens na sua solução"}</span>
            {proposal.validUntil ? <span><CalendarDays size={15} aria-hidden="true" />Válida até {formatDate(proposal.validUntil)}</span> : null}
          </div>
        </div>
        <div className={styles.heroValue}><Sparkles size={20} aria-hidden="true" /><span>INVESTIMENTO TOTAL</span><strong>{formatCurrencyCents(proposal.totalCents, proposal.currency)}</strong><p>Todos os detalhes. Uma decisão clara.</p></div>
      </section>

      <div className={styles.layout}>
        <div className={styles.content}>
          {proposal.introduction ? <section className={styles.introduction}><p className={styles.sectionLabel}>Pensada para você</p><p>{proposal.introduction}</p></section> : null}
          <section>
            <div className={styles.sectionHeading}><div><p className={styles.sectionLabel}>Sua solução, em detalhes</p><h2>O que está incluído</h2></div><span className={styles.counter}>{String(proposal.items.length).padStart(2, "0")}</span></div>
            <ol className={styles.items}>
              {proposal.items.map((item, index) => (
                <li key={index} className={styles.item}>
                  <span className={styles.itemIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <div className={styles.itemBody}><h3>{item.name}</h3>{item.description ? <p className={styles.itemDescription}>{item.description}</p> : null}<p className={styles.itemQuantity}>{String(item.quantity).replace(".", ",")} × {formatCurrencyCents(item.unitPriceCents, proposal.currency)}<span>{item.billingType ? BILLING_SUFFIX[item.billingType] ?? "" : ""}</span></p></div>
                  <strong className={styles.itemValue}>{formatCurrencyCents(item.subtotalCents, proposal.currency)}</strong>
                </li>
              ))}
            </ol>
          </section>
          {proposal.conditions ? <TextSection title="Condições comerciais" text={proposal.conditions} /> : null}
          {proposal.notes ? <TextSection title="Observações" text={proposal.notes} /> : null}
          {proposal.terms ? <TextSection title="Termos" text={proposal.terms} /> : null}
        </div>

        <aside className={styles.summary}>
          <p className={styles.sectionLabel}>Tudo em um só lugar</p><h2>Seu investimento</h2>
          <dl className={styles.amounts}>
            <div><dt>Subtotal</dt><dd>{formatCurrencyCents(proposal.subtotalCents, proposal.currency)}</dd></div>
            {proposal.discountCents > 0 ? <div className={styles.discount}><dt>Desconto</dt><dd>− {formatCurrencyCents(proposal.discountCents, proposal.currency)}</dd></div> : null}
            <div className={styles.total}><dt>Total</dt><dd>{formatCurrencyCents(proposal.totalCents, proposal.currency)}</dd></div>
          </dl>
          <div className={styles.summaryDetails}>
            <p><Check size={15} aria-hidden="true" />{proposal.customerName ? `Preparada para ${proposal.customerName}` : "Preparada especialmente para você"}</p>
            {proposal.validUntil ? <p><CalendarDays size={15} aria-hidden="true" />Válida até {formatDate(proposal.validUntil)}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
          <p className={styles.summaryNote}>Confira os itens e as condições antes de responder. Sua decisão será enviada à equipe responsável.</p>
        </aside>
      </div>
      <footer className={styles.footer}><span>{issuer}</span><span>Uma proposta. Novas possibilidades.</span></footer>
    </article>
  );
}

function TextSection({ title, text }: { title: string; text: string }) {
  return <section className={styles.textSection}><h2>{title}</h2><p>{text}</p></section>;
}

export { styles as proposalStyles };
