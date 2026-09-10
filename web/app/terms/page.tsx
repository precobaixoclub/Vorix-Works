import type React from "react";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";

export const metadata = {
  title: "Termos de Serviço | Vorix",
  description: "Termos de serviço da plataforma Vorix.",
};

export default function TermsPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <PublicHeader />
      <LegalArticle title="Termos de Serviço" updated="05 de agosto de 2026">
        <p>Estes termos regulam o uso da Vorix, uma plataforma que conecta marketing, atendimento e vendas por IA — criação e publicação de conteúdo, atendimento via WhatsApp e CRM comercial.</p>
        <Section title="Uso da plataforma">O usuário é responsável pelas informações que envia, pelas contas externas que conecta e pelos conteúdos e mensagens que aprova. O uso deve respeitar as leis aplicáveis e as políticas das plataformas integradas (Meta, TikTok, YouTube, WhatsApp).</Section>
        <Section title="Contas conectadas">Ao conectar uma rede social ou canal de atendimento, o usuário autoriza a Vorix a executar as ações permitidas no fluxo de autorização, como consultar contas vinculadas, publicar conteúdos aprovados e enviar/receber mensagens em nome do workspace.</Section>
        <Section title="Disponibilidade">A plataforma depende de serviços de terceiros (redes sociais, provedores de IA, gateway de mensageria). Mudanças, limites, falhas ou revisões dessas plataformas podem afetar funcionalidades de conexão, agendamento, publicação ou atendimento.</Section>
        <Section title="Contato">Dúvidas sobre estes termos podem ser enviadas para <a href="mailto:legal@vorixworks.com" className="font-medium text-primary hover:underline">legal@vorixworks.com</a>.</Section>
      </LegalArticle>
      <PublicFooter />
    </main>
  );
}

function LegalArticle({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 text-sm leading-6 text-muted-foreground sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atualizado em {updated}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
      <div className="mt-8 space-y-7">{children}</div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2">{children}</p>
    </section>
  );
}

