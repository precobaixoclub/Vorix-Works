import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";
import { MessageSquare, ShieldCheck, Video } from "lucide-react";
import { Logo } from "@/components/Logo";

/**
 * Casca visual das telas de acesso (entrar/criar conta) na mesma linguagem do site público:
 * fundo escuro, tokens `--public-*`, as duas soluções visíveis. Só apresentação — a lógica de
 * autenticação continua nas páginas.
 */
export function AuthShell({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return (
    <div className="public-site public-auth">
      <div className="public-auth-grid" aria-hidden="true" />
      <header className="public-auth-top">
        <Link href="/" className="public-brand" aria-label="Vorix — início"><Logo viewBox="50 8 182 130" className="public-brand-mark" /><span>VORIX<span className="public-brand-dot">.</span></span></Link>
        <Link href="/" className="public-auth-back">Voltar ao site</Link>
      </header>
      <main id="conteudo" className="public-auth-main">
        <section className="public-auth-intro">
          <span className="public-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
          <ul className="public-auth-products">
            <li className="conversations"><MessageSquare size={17} aria-hidden="true" /><span><strong>Vorix Conversas</strong><small>Atendimento e vendas</small></span></li>
            <li className="meetings"><Video size={17} aria-hidden="true" /><span><strong>Vorix Meetings</strong><small>Reuniões inteligentes</small></span></li>
          </ul>
          <p className="public-auth-trust"><ShieldCheck size={15} aria-hidden="true" /> Uma conta para toda a plataforma, com isolamento por empresa.</p>
        </section>
        <section className="public-auth-card">{children}</section>
      </main>
    </div>
  );
}

export function AuthField({ id, label, ...input }: { id: string; label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="public-auth-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...input} />
    </div>
  );
}

export function AuthFallback({ label }: { label: string }) {
  return (
    <div className="public-site public-auth">
      <main className="public-auth-main public-auth-loading"><p role="status">{label}</p></main>
    </div>
  );
}
