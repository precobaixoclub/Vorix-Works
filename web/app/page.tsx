import Link from "next/link";
import type React from "react";
import { CheckCircle2, FileText, MessageSquareText, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanSelectLink } from "@/components/PlanSelectLink";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { TrackPageView } from "@/components/TrackPageView";
import { fetchPublicPlans, formatCapacityLine, formatPlanPrice, type PublicPlan } from "@/features/platform-plans/api";

export const revalidate = 300;

const JOURNEY = ["Marketing", "Conversa", "Contato", "Negócio", "Follow-up", "Proposta", "Venda"];

const PILLARS: readonly { title: string; description: string; icon: React.ReactNode }[] = [
  { title: "Marketing", description: "Crie e publique conteúdo com IA nos canais conectados.", icon: <Sparkles className="h-5 w-5" /> },
  { title: "Conversas", description: "Centralize o atendimento e os canais num único lugar.", icon: <MessageSquareText className="h-5 w-5" /> },
  { title: "CRM Comercial", description: "Organize contatos, negócios e follow-ups sem perder contexto.", icon: <TrendingUp className="h-5 w-5" /> },
  { title: "Propostas", description: "Crie, envie e acompanhe propostas com link público.", icon: <FileText className="h-5 w-5" /> },
  { title: "IA", description: "Apoio em toda a operação — criação, organização e insights.", icon: <Sparkles className="h-5 w-5" /> },
  { title: "Resultados", description: "Acompanhe o que está acontecendo na sua operação.", icon: <TrendingUp className="h-5 w-5" /> },
];

const WHY = [
  ["Menos ferramentas", "Marketing, atendimento, CRM e resultados na mesma operação."],
  ["Mais contexto", "A conversa vira contato, negócio, tarefa e proposta sem perder histórico."],
  ["IA integrada", "Apoio para criar conteúdo, responder melhor e enxergar oportunidades."],
  ["Operação conectada", "O time vê o que aconteceu e o que precisa fazer agora."],
];

const FAQ: readonly { question: string; answer: string }[] = [
  { question: "O teste é gratuito?", answer: "Sim. Você usa o Vorix por 7 dias sem pagar nada." },
  { question: "Preciso cadastrar cartão?", answer: "Não. Você cria a conta e começa a usar sem informar nenhuma forma de pagamento." },
  { question: "O que acontece depois dos 7 dias?", answer: "Seu acesso operacional é pausado até você escolher um plano. Nada do que você criou é apagado." },
  { question: "Quando começa a cobrança?", answer: "Só depois que você confirmar a contratação de um plano, dentro do Vorix — nunca automaticamente." },
  { question: "Posso cancelar?", answer: "Sim, a qualquer momento, direto em Plano e cobrança. Seu acesso continua até o fim do período já pago." },
  { question: "Posso trocar de plano?", answer: "Sim. Upgrade e downgrade são self-service, sem precisar falar com o suporte." },
  { question: "Meus dados são apagados se eu não contratar?", answer: "Não. Contatos, negócios, tarefas, propostas e configurações continuam salvos." },
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
              Centralize sua operação comercial, converse com seus clientes, organize oportunidades e use IA para transformar contatos em vendas.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/signup"><Button className="px-5 py-3">Testar por 7 dias</Button></Link>
              <Link href="#produto"><Button variant="secondary" className="px-5 py-3">Ver como funciona</Button></Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Sem cartão de crédito para começar.</p>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">O problema</p>
        <h2 className="mx-auto mt-3 max-w-3xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Marketing em uma ferramenta. WhatsApp em outra. CRM em outra. Follow-up esquecido. Proposta perdida.
        </h2>
        <p className="mt-4 text-muted-foreground">Com o Vorix, tudo se conecta — do primeiro contato até a venda.</p>
      </section>

      <section id="produto" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {JOURNEY.map((step, index) => (
            <div key={step} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{String(index + 1).padStart(2, "0")}</p>
              <p className="mt-3 text-base font-semibold">{step}</p>
              <p className="mt-2 text-xs text-muted-foreground">{journeyCopy(step)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="solucoes" className="border-y border-border bg-muted/20">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div key={pillar.title} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-primary">{pillar.icon}<h2 className="text-lg font-semibold text-foreground">{pillar.title}</h2></div>
              <p className="mt-3 text-sm text-muted-foreground">{pillar.description}</p>
            </div>
          ))}
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
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
            <div className="text-center">
              <h2 className="text-2xl font-semibold">Comece simples. Cresça quando precisar.</h2>
              <p className="mt-2 text-sm text-muted-foreground">7 dias de teste em qualquer plano, sem cartão de crédito.</p>
            </div>
            <div className="mx-auto mt-8 grid max-w-4xl gap-4 sm:grid-cols-3">
              {plans.map((plan) => (
                <div key={plan.code} className={`flex flex-col rounded-xl border p-5 ${plan.highlighted ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
                  {plan.highlighted ? <span className="mb-2 w-fit rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">Recomendado</span> : null}
                  <p className="font-semibold">{plan.name}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{formatPlanPrice(plan)}<span className="text-xs font-normal text-muted-foreground">/mês</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatCapacityLine(plan)}</p>
                  <PlanSelectLink planCode={plan.code} className="mt-4" variant={plan.highlighted ? "primary" : "secondary"}>
                    Testar {plan.name}
                  </PlanSelectLink>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-sm">
              <Link href="/pricing" className="font-medium text-primary hover:underline">Ver todos os detalhes dos planos</Link>
            </p>
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-semibold">Perguntas frequentes</h2>
        <div className="mt-8 space-y-6">
          {FAQ.map((item) => (
            <div key={item.question}>
              <p className="font-medium">{item.question}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.answer}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-muted/20">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-balance text-3xl font-semibold tracking-tight">Pronto para conectar marketing, atendimento e vendas?</h2>
          <p className="mt-3 text-muted-foreground">Teste o Vorix por 7 dias, sem cartão de crédito.</p>
          <Link href="/signup"><Button className="mt-6 px-6 py-3">Começar meu teste</Button></Link>
        </div>
      </section>

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

function journeyCopy(step: string) {
  if (step === "Marketing") return "Crie e publique conteúdo com IA.";
  if (step === "Conversa") return "Atenda clientes no WhatsApp com histórico.";
  if (step === "Contato") return "A conversa vira contato pesquisável no CRM.";
  if (step === "Negócio") return "Organize a oportunidade com valor e etapa.";
  if (step === "Follow-up") return "Nunca perca o próximo passo.";
  if (step === "Proposta") return "Crie, envie e acompanhe com link público.";
  return "Feche o negócio sem sair do Vorix.";
}
