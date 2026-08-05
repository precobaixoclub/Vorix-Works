import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = {
  title: "Politica de Privacidade | Vorix",
  description: "Politica de privacidade da plataforma Vorix.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-surface px-6 py-8 text-ink">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 flex items-center justify-between border-b border-border pb-6">
          <Link href="/" aria-label="Vorix">
            <Logo className="h-10 w-auto text-ink" />
          </Link>
          <Link href="/terms" className="text-sm font-medium text-accent hover:underline">
            Termos
          </Link>
        </header>

        <article className="space-y-7 text-sm leading-6 text-ink-muted">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Atualizado em 05 de agosto de 2026</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Politica de Privacidade</h1>
            <p className="mt-4">
              A Vorix fornece ferramentas de planejamento, criacao, agendamento e publicacao de conteudo em redes sociais.
              Esta politica explica quais dados podem ser tratados quando uma pessoa usa a plataforma.
            </p>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-ink">Dados que coletamos</h2>
            <p className="mt-2">
              Podemos coletar dados de cadastro, identificadores de workspace, configuracoes de campanha, conteudos enviados
              pelo usuario, registros operacionais e informacoes retornadas por plataformas conectadas, como contas, paginas,
              permississoes concedidas e status de publicacao.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Como usamos os dados</h2>
            <p className="mt-2">
              Usamos os dados para autenticar usuarios, operar workspaces, conectar contas externas, publicar conteudos
              autorizados, registrar auditoria, melhorar estabilidade e cumprir obrigacoes legais ou de seguranca.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Compartilhamento</h2>
            <p className="mt-2">
              Dados podem ser enviados para provedores externos apenas quando necessario para executar uma acao solicitada,
              como autenticar uma conta ou publicar conteudo em uma rede social. Nao vendemos dados pessoais.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Exclusao de dados</h2>
            <p className="mt-2">
              O usuario pode solicitar a exclusao de dados pelo email abaixo ou pela pagina de instrucoes em{" "}
              <Link href="/data-deletion" className="font-medium text-accent hover:underline">
                /data-deletion
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-ink">Contato</h2>
            <p className="mt-2">Solicitacoes sobre privacidade podem ser enviadas para cleverton@imobilsi9.com.br.</p>
          </section>
        </article>
      </div>
    </main>
  );
}
