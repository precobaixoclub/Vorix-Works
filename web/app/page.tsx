import Link from "next/link";
import type React from "react";
import { ArrowRight, CheckCircle2, MessageSquareText, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/Button";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { TrackPageView } from "@/components/TrackPageView";
import { fetchPublicPlans, type PublicPlan } from "@/features/platform-plans/api";

export const revalidate = 300;

const JOURNEY = ["Criar", "Publicar", "Conversar", "Vender", "Medir"];

const WHY = [
  ["Menos ferramentas", "Marketing, atendimento, CRM e resultados na mesma operação."],
  ["Mais contexto", "A conversa vira contato, negócio, tarefa e proposta sem perder histórico."],
  ["IA integrada", "Apoio para criar conteúdo, responder melhor e enxergar oportunidades."],
  ["Operação conectada", "O time vê o que aconteceu e o que precisa fazer agora."],
];

export default async function RootPage() {
  let plans: readonly PublicPlan[] = [];
  try {
    plans = await fetchPublicPlans();
  } catch {
    plans = [];
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <TrackPageView eventName="landing_view" />
      <PublicHeader />

      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.35)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.25)_1px,transparent_1px)] bg-[size:56px_56px] opacity-30" aria-hidden />
        <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/10 to-transparent" aria-hidden />
        <div className="relative mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,0.86fr)_minmax(520px,1.14fr)]">
          <div className="max-w-2xl">
            <p className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Vorix Intelligence</p>
            <h1 className="mt-5 text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              Marketing, atendimento e vendas conectados por IA.
            </h1>
            <p className="mt-5 max-w-xl text-balance text-base leading-7 text-muted-foreground sm:text-lg">
              Do primeiro conteúdo à venda, o Vorix conecta a jornada da sua empresa em uma operação simples por fora e poderosa por dentro.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/signup"><Button className="px-5 py-3">Criar conta</Button></Link>
              <Link href="#produto"><Button variant="secondary" className="px-5 py-3">Ver como funciona</Button></Link>
            </div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section id="produto" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-4 md:grid-cols-5">
          {JOURNEY.map((step, index) => (
            <div key={step} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{String(index + 1).padStart(2, "0")}</p>
              <p className="mt-3 text-lg font-semibold">{step}</p>
              <p className="mt-2 text-sm text-muted-foreground">{journeyCopy(step)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="solucoes" className="border-y border-border bg-muted/20">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-3">
          <Feature title="Marketing" icon={<Sparkles className="h-5 w-5" />} items={["Crie conteúdo com IA", "Organize produção", "Publique nas redes conectadas", "Acompanhe performance"]} />
          <Feature title="Conversas" icon={<MessageSquareText className="h-5 w-5" />} items={["Atenda no WhatsApp", "Humano + IA no mesmo fluxo", "CRM contextual", "Takeover quando necessário"]} />
          <Feature title="CRM" icon={<TrendingUp className="h-5 w-5" />} items={["Contatos", "Pipeline", "Tarefas", "Propostas", "Da conversa ao negócio sem perder contexto"]} />
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Vorix Intelligence</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Sinais úteis, decisões nas mãos do time.</h2>
          <p className="mt-4 text-muted-foreground">A IA destaca oportunidades e riscos operacionais sem prometer decisões críticas autônomas.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {["Lead quente sem resposta", "Proposta sem retorno", "Tarefa atrasada", "Oportunidade no pipeline"].map((item) => (
            <div key={item} className="rounded-xl border border-border bg-card p-4">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <p className="mt-3 font-medium">{item}</p>
              <p className="mt-1 text-sm text-muted-foreground">O Vorix aponta o contexto e sugere o próximo passo.</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="grid gap-4 md:grid-cols-4">
          {WHY.map(([title, description]) => (
            <div key={title} className="rounded-xl border border-border bg-card p-5">
              <p className="font-semibold">{title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {plans.length > 0 ? (
        <section className="border-t border-border bg-muted/20">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Comece simples. Cresça quando precisar.</h2>
              <p className="mt-2 text-sm text-muted-foreground">{plans.length} planos reais carregados da API de pricing.</p>
            </div>
            <Link href="/pricing"><Button>Ver preços <ArrowRight className="ml-2 h-4 w-4" /></Button></Link>
          </div>
        </section>
      ) : null}

      <PublicFooter />
    </main>
  );
}

function ProductPreview() {
  return (
    <div className="relative min-h-[460px] lg:min-h-[560px]" aria-label="Preview do produto Vorix">
      <div className="absolute right-0 top-0 w-[88%] rounded-xl border border-border bg-card p-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <p className="text-sm font-semibold">Command Center</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Ao vivo</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {["Marketing", "Atendimento", "Comercial"].map((label, index) => (
            <div key={label} className="rounded-lg bg-muted/45 p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{[18, 42, 7][index]}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 h-32 rounded-lg bg-[linear-gradient(135deg,hsl(var(--primary)/0.26),hsl(var(--muted)))]" />
      </div>
      <div className="absolute bottom-20 left-0 w-[44%] rounded-xl border border-border bg-background p-4 shadow-xl">
        <p className="text-sm font-semibold">Conversas</p>
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-muted p-3 text-sm">Cliente pediu proposta pelo WhatsApp.</div>
          <div className="rounded-lg bg-primary/15 p-3 text-sm">IA sugeriu resposta com contexto do CRM.</div>
        </div>
      </div>
      <div className="absolute bottom-0 right-8 w-[52%] rounded-xl border border-border bg-card p-4 shadow-xl">
        <p className="text-sm font-semibold">Pipeline</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {["Novo", "Proposta", "Ganho"].map((stage) => <div key={stage} className="h-28 rounded-lg bg-muted/55 p-2 text-xs text-muted-foreground">{stage}</div>)}
        </div>
      </div>
    </div>
  );
}

function Feature({ title, icon, items }: { title: string; icon: React.ReactNode; items: readonly string[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-primary">{icon}<h2 className="text-lg font-semibold text-foreground">{title}</h2></div>
      <ul className="mt-5 space-y-3 text-sm text-muted-foreground">
        {items.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{item}</li>)}
      </ul>
    </div>
  );
}

function journeyCopy(step: string) {
  if (step === "Criar") return "Transforme ideia em conteúdo com contexto da marca.";
  if (step === "Publicar") return "Envie ou agende nos canais conectados.";
  if (step === "Conversar") return "Atenda clientes no WhatsApp com histórico.";
  if (step === "Vender") return "Crie negócios, tarefas e propostas.";
  return "Veja marketing, atendimento e comercial juntos.";
}
