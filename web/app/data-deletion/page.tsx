import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Exclusao de Dados | Vorix",
  description: "Instrucoes para solicitacao de exclusao de dados na Vorix.",
};

export default function DataDeletionPage() {
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
            <h1 className="mt-2 text-3xl font-semibold text-ink">Exclusao de Dados</h1>
            <p className="mt-4">
              Para solicitar a exclusao dos seus dados associados a Vorix, envie um email para
              cleverton@imobilsi9.com.br com o assunto "Exclusao de dados Vorix".
            </p>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-ink">O que informar</h2>
            <p className="mt-2">
              Inclua o email da sua conta, o nome do workspace e, se aplicavel, a rede social conectada que deseja remover.
              Podemos solicitar confirmacao de identidade antes de processar a exclusao.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Prazo</h2>
            <p className="mt-2">
              Depois da confirmacao, removeremos ou anonimizaremos os dados elegiveis dentro de um prazo razoavel, salvo
              quando a retencao for necessaria por obrigacao legal, seguranca, auditoria ou prevencao de abuso.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
