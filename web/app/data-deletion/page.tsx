import type React from "react";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";

export const metadata = {
  title: "Exclusão de Dados | Vorix",
  description: "Instruções para solicitação de exclusão de dados na Vorix.",
};

export default function DataDeletionPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <PublicHeader />
      <LegalArticle title="Exclusão de Dados" updated="05 de agosto de 2026">
        <p>
          Para solicitar a exclusão dos seus dados associados à Vorix, envie um e-mail para{" "}
          <a href="mailto:privacidade@vorixworks.com" className="font-medium text-primary hover:underline">privacidade@vorixworks.com</a>{" "}
          com o assunto "Exclusão de dados Vorix".
        </p>
        <Section title="O que informar">Inclua o e-mail da sua conta, o nome do workspace e, se aplicável, a rede social ou canal de atendimento conectado que deseja remover. Podemos solicitar confirmação de identidade antes de processar a exclusão.</Section>
        <Section title="Prazo">Depois da confirmação, removemos ou anonimizamos os dados elegíveis dentro de um prazo razoável, salvo quando a retenção for necessária por obrigação legal, segurança, auditoria ou prevenção de abuso.</Section>
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
