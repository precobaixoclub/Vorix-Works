import Link from "next/link";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { fetchPublicPlans, formatPlanPrice, formatTokenQuota, type PublicPlan } from "@/features/platform-plans/api";

export const revalidate = 300;

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
 * Landing page pública — único ponto do app que não exige sessão (ver `proxy.ts`). Duas CTAs
 * principais agora: "Criar conta grátis" (Fase 2 — vai para `/signup` e cria tenant FREE) e
 * "Entrar" (usuários que já têm conta). Mostra 4 features + preview de planos com CTA para
 * `/pricing`.
 */
export default async function RootPage() {
  let plans: readonly PublicPlan[] = [];
  try {
    plans = await fetchPublicPlans();
  } catch {
    // Falha silenciosa aqui: se a API está fora, a landing ainda renderiza — só o preview de
    // planos some. Botão de "Criar conta grátis" continua funcional (a chamada real acontece
    // via /signup, que reporta erro no formulário se a API estiver mesmo fora).
    plans = [];
  }

  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Logo className="h-12 w-auto text-ink" />
        <div className="flex items-center gap-2">
          <Link href="/pricing">
            <Button variant="ghost">Planos</Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary">Entrar</Button>
          </Link>
          <Link href="/signup">
            <Button>Criar conta grátis</Button>
          </Link>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-4xl flex-col items-center justify-center gap-6 px-6 py-20 text-center">
        <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">Marketing com IA</span>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Da conversa ao post publicado, sem sair de um só lugar.
        </h1>
        <p className="max-w-2xl text-balance text-base text-ink-muted sm:text-lg">
          O Vorix transforma uma conversa em briefing, o briefing em plano de campanha e o plano em conteúdo
          publicado — com governança e histórico completo em cada etapa.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup">
            <Button className="px-6 py-3 text-base">Criar conta grátis</Button>
          </Link>
          <Link href="/pricing">
            <Button variant="secondary" className="px-6 py-3 text-base">Ver planos</Button>
          </Link>
        </div>
        <p className="text-xs text-ink-muted">100 mil tokens de IA por mês. Sem cartão de crédito.</p>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-16 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-xl border border-border bg-surface-raised p-5">
            <p className="text-sm font-semibold text-ink">{feature.title}</p>
            <p className="mt-1.5 text-sm text-ink-muted">{feature.description}</p>
          </div>
        ))}
      </section>

      {plans.length > 0 ? (
        <section className="mx-auto w-full max-w-6xl px-6 pb-24">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Planos</p>
              <h2 className="mt-1 text-2xl font-semibold text-ink">Cresce com você.</h2>
            </div>
            <Link href="/pricing" className="text-sm font-medium text-accent hover:underline">
              Ver todos os planos →
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <div
                key={plan.code}
                className={
                  "rounded-xl border p-5 " +
                  (plan.highlighted
                    ? "border-accent bg-accent-soft/40"
                    : "border-border bg-surface-raised")
                }
              >
                <p className="text-sm font-semibold text-ink">{plan.name}</p>
                <p className="text-xs text-ink-muted">{plan.tagline}</p>
                <p className="mt-3 text-2xl font-semibold text-ink">
                  {formatPlanPrice(plan)}
                  {plan.monthlyPriceUsd > 0 ? <span className="ml-1 text-sm font-normal text-ink-muted">/mês</span> : null}
                </p>
                <p className="mt-1 text-xs text-ink-muted">{formatTokenQuota(plan.monthlyTokenQuota)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-ink-faint">
        © {new Date().getFullYear()} Vorix. Todos os direitos reservados.
      </footer>
    </main>
  );
}
