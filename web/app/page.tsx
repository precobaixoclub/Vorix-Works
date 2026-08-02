import Link from "next/link";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";

const FEATURES = [
  {
    title: "Conversa vira briefing",
    description: "Chat com IA que extrai objetivo, público e contexto da campanha automaticamente, sem formulário.",
  },
  {
    title: "Planejamento automático",
    description: "Cada briefing confirmado já nasce como plano de execução — tarefas, formatos e canais definidos.",
  },
  {
    title: "Publicação multi-canal",
    description: "Aprove e publique direto nas redes conectadas, com fila, novas tentativas e conciliação de status.",
  },
  {
    title: "Governança e auditoria",
    description: "Credenciais, permissões e trilha de auditoria completa em cada ação, em cada Espaço de Trabalho.",
  },
] as const;

/**
 * Landing page pública — único ponto do app que não exige sessão (ver `proxy.ts`). Tudo depois do
 * clique em "Entrar" continua atrás do fluxo de autenticação normal.
 */
export default function RootPage() {
  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Logo className="h-7 w-auto text-ink" />
        <Link href="/login">
          <Button variant="secondary">Entrar</Button>
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-6 px-6 py-20 text-center">
        <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">Marketing com IA</span>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Da conversa ao post publicado, sem sair de um só lugar.
        </h1>
        <p className="max-w-2xl text-balance text-base text-ink-muted sm:text-lg">
          O Vorix transforma uma conversa em briefing, o briefing em plano de campanha e o plano em conteúdo
          publicado — com governança e histórico completo em cada etapa.
        </p>
        <div className="mt-2">
          <Link href="/login">
            <Button className="px-6 py-3 text-base">Entrar no Vorix</Button>
          </Link>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-xl border border-border bg-surface-raised p-5">
            <p className="text-sm font-semibold text-ink">{feature.title}</p>
            <p className="mt-1.5 text-sm text-ink-muted">{feature.description}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-ink-faint">
        © {new Date().getFullYear()} Vorix. Todos os direitos reservados.
      </footer>
    </main>
  );
}
