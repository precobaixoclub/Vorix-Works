import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Termos de Servico | Vorix",
  description: "Termos de servico da plataforma Vorix.",
};

export default function TermsPage() {
  return (
    <main className="min-h-dvh bg-surface px-3 py-6 text-ink sm:px-6 sm:py-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 flex items-center justify-between border-b border-border pb-6">
          <Link href="/" aria-label="Vorix">
            <Logo className="h-10 w-auto text-ink" />
          </Link>
          <Link href="/privacy" className="text-sm font-medium text-accent hover:underline">
            Privacidade
          </Link>
        </header>

        <article className="space-y-7 text-sm leading-6 text-ink-muted">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Atualizado em 05 de agosto de 2026</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Termos de Servico</h1>
            <p className="mt-4">
              Estes termos regulam o uso da Vorix, uma plataforma para criar, organizar, agendar e publicar conteudos em
              canais digitais conectados pelo proprio usuario.
            </p>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-ink">Uso da plataforma</h2>
            <p className="mt-2">
              O usuario e responsavel pelas informacoes que envia, pelas contas externas que conecta e pelos conteudos que
              aprova para publicacao. O uso deve respeitar leis aplicaveis e politicas das plataformas integradas.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Contas conectadas</h2>
            <p className="mt-2">
              Ao conectar uma rede social, o usuario autoriza a Vorix a executar as acoes permitidas no fluxo de autorizacao,
              como consultar contas vinculadas e publicar conteudos aprovados.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Disponibilidade</h2>
            <p className="mt-2">
              A plataforma pode depender de servicos de terceiros. Mudancas, limites, falhas ou revisoes dessas plataformas
              podem afetar funcionalidades de conexao, agendamento ou publicacao.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Contato</h2>
            <p className="mt-2">Duvidas sobre estes termos podem ser enviadas para cleverton@imobilsi9.com.br.</p>
          </section>
        </article>
      </div>
    </main>
  );
}
