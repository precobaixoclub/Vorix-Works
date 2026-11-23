import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Globe, Megaphone, MessageSquare, ShieldCheck, Video } from "lucide-react";
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
            <li className="meetings"><Megaphone size={17} aria-hidden="true" /><span><strong>Vorix Marketing</strong><small>Ideias, conteúdo e publicação</small></span></li>
            <li className="conversations"><Globe size={17} aria-hidden="true" /><span><strong>Vorix Site</strong><small>Site, catálogo e loja</small></span></li>
            <li className="meetings"><Video size={17} aria-hidden="true" /><span><strong>Vorix Meetings</strong><small>Agenda, gravação e análises</small></span></li>
          </ul>
          <p className="public-auth-trust"><ShieldCheck size={15} aria-hidden="true" /> Uma conta para toda a plataforma, com isolamento por empresa.</p>
        </section>
        <section className="public-auth-card">{children}</section>
      </main>
    </div>
  );
}

/** Campo das telas de acesso. Fase 13: dica e erro ficam ligados ao campo (leitor de tela anuncia). */
export function AuthField({ id, label, hint, errorId, ...input }: { id: string; label: string; hint?: string; errorId?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = [hint ? `${id}-hint` : "", errorId ?? ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="public-auth-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={describedBy} aria-invalid={errorId ? true : undefined} {...input} />
      {hint ? <small id={`${id}-hint`} className="public-auth-hint">{hint}</small> : null}
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
