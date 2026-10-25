import type { ReactNode } from "react";
import { CalendarDays, FileText } from "lucide-react";
import type { PublicProposal } from "@/features/crm/public-proposal-api";
import { BILLING_SUFFIX } from "@/features/sales/presentation";
import { formatCurrencyCents, formatDate } from "@/lib/format";
import styles from "./ProposalDocument.module.css";

/** Documento compartilhado pela revisão do vendedor e pelo link recebido pelo cliente. */
export function ProposalDocument({ proposal, actions, preview }: { proposal: PublicProposal; actions?: ReactNode; preview?: boolean }) {
  const issuer = proposal.issuerName || "Proposta comercial";
  const mark = issuer.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  const customerName = proposal.customerName && /\p{L}/u.test(proposal.customerName) && !proposal.customerName.includes("@") ? proposal.customerName.trim() : undefined;
  const customer = [customerName, proposal.customerCompany?.trim()].filter(Boolean).join(" · ");
  return (
    <article className={styles.document}>
      <header className={styles.brandbar}>
        <div className={styles.brand}><span className={styles.brandmark} aria-hidden="true">{mark}</span><strong>{issuer}</strong></div>
        <span className={styles.edition}><FileText size={14} aria-hidden="true" />{preview ? "Prévia da proposta" : "Proposta comercial"}</span>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span />{proposal.number ?? "Sua proposta"}{proposal.version > 1 ? ` · versão ${proposal.version}` : ""}</p>
          <h1>{proposal.title}</h1>
          {customer ? <p className={styles.recipient}>Para {customer}</p> : null}
          <div className={styles.heroMeta}>
            {proposal.validUntil ? <span><CalendarDays size={15} aria-hidden="true" />Válida até {formatDate(proposal.validUntil)}</span> : null}
          </div>
        </div>
      </section>

      <div className={styles.layout}>
        <div className={styles.content}>
          {proposal.introduction ? <section className={styles.introduction} aria-label="Apresentação"><p>{proposal.introduction}</p></section> : null}
          <section>
            <div className={styles.sectionHeading}><h2>O que está incluído</h2><span className={styles.counter}>{proposal.items.length} {proposal.items.length === 1 ? "item" : "itens"}</span></div>
            <ol className={styles.items}>
              {proposal.items.map((item, index) => (
                <li key={index} className={styles.item}>
                  <span className={styles.itemIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <div className={styles.itemBody}><h3>{item.name}</h3>{item.description ? <p className={styles.itemDescription}>{item.description}</p> : null}<p className={styles.itemQuantity}>{item.quantity === 1 ? "Quantidade: 1" : `${String(item.quantity).replace(".", ",")} × ${formatCurrencyCents(item.unitPriceCents, proposal.currency)}`}</p></div>
                  <strong className={styles.itemValue}>{formatCurrencyCents(item.subtotalCents, proposal.currency)}<span>{item.billingType ? BILLING_SUFFIX[item.billingType] ?? "" : ""}</span></strong>
                </li>
              ))}
            </ol>
          </section>
          {proposal.conditions ? <TextSection title="Condições comerciais" text={proposal.conditions} /> : null}
          {proposal.notes ? <TextSection title="Observações" text={proposal.notes} /> : null}
          {proposal.terms ? <TextSection title="Termos" text={proposal.terms} /> : null}
        </div>

        <aside className={styles.summary} aria-label="Resumo da proposta">
          <h2>Resumo da proposta</h2>
          <dl className={styles.amounts}>
            {proposal.discountCents > 0 ? <div><dt>Subtotal</dt><dd>{formatCurrencyCents(proposal.subtotalCents, proposal.currency)}</dd></div> : null}
            {proposal.discountCents > 0 ? <div className={styles.discount}><dt>Desconto</dt><dd>− {formatCurrencyCents(proposal.discountCents, proposal.currency)}</dd></div> : null}
            <div className={styles.total}><dt>Total</dt><dd>{formatCurrencyCents(proposal.totalCents, proposal.currency)}</dd></div>
          </dl>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
          <p className={styles.summaryNote}>Confira os itens e as condições comerciais. Se tiver alguma dúvida, fale com quem enviou esta proposta.</p>
        </aside>
      </div>
      <footer className={styles.footer}>Documento preparado para sua análise. O aceite confirma as condições apresentadas.</footer>
    </article>
  );
}

function TextSection({ title, text }: { title: string; text: string }) {
  return <section className={styles.textSection}><h2>{title}</h2><p>{text}</p></section>;
}

export { styles as proposalStyles };
