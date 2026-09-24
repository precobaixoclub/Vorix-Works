import Link from "next/link";
import type React from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  Lightbulb,
  MessageSquareText,
  type LucideIcon,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/Button";
import { PlanSelectLink } from "@/components/PlanSelectLink";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { TrackPageView } from "@/components/TrackPageView";
import { fetchPublicPlans, formatCapacityLine, formatPlanPrice, type PublicPlan } from "@/features/platform-plans/api";
import { cn } from "@/lib/utils";

export const revalidate = 300;

const JOURNEY = ["Criar", "Publicar", "Conversar", "Vender", "Medir"] as const;

const PRODUCT_SECTIONS: readonly ProductSection[] = [
  {
    eyebrow: "Conversas",
    title: "Atenda seus clientes sem perder o contexto comercial.",
    description: "Inbox, contato, negocio e proximos passos ficam na mesma tela para o time responder com clareza.",
    visual: "conversations",
  },
  {
    eyebrow: "CRM",
    title: "Da conversa ao negocio sem trocar de ferramenta.",
    description: "O pipeline mostra em que etapa cada oportunidade esta, quem e responsavel e qual follow-up vem agora.",
    visual: "crm",
    reverse: true,
  },
  {
    eyebrow: "Marketing + IA",
    title: "Crie conteudo com a identidade da sua marca e organize a producao.",
    description: "A IA participa do fluxo de criacao, revisao e agenda sem virar uma caixa preta fora da operacao.",
    visual: "marketing",
  },
];

const FAQ: readonly { question: string; answer: string }[] = [
  { question: "Preciso cadastrar cartao?", answer: "Nao. Voce cria a conta e comeca a testar sem informar forma de pagamento." },
  { question: "Quanto tempo dura o teste?", answer: "Sao 7 dias para usar o Vorix antes de contratar um plano." },
  { question: "O que acontece depois dos 7 dias?", answer: "Seu acesso operacional e pausado ate voce escolher um plano. Nada do que voce criou e apagado." },
  { question: "Quando comeca a cobranca?", answer: "So depois que voce confirmar a contratacao de um plano dentro do Vorix." },
  { question: "Posso cancelar?", answer: "Sim, a qualquer momento, direto em Plano e cobranca. Seu acesso continua ate o fim do periodo ja pago." },
];

export default async function RootPage() {
  let plans: readonly PublicPlan[] = [];
  try {
    plans = (await fetchPublicPlans()).filter((plan) => plan.code !== "FREE");
  } catch {
    plans = [];
  }

  return (
    <main className="min-h-dvh overflow-hidden bg-[#070b12] text-white">
      <TrackPageView eventName="landing_view" />
      <PublicHeader />

      <section className="relative border-b border-white/10 bg-[radial-gradient(circle_at_20%_12%,rgba(173,219,70,0.18),transparent_30%),radial-gradient(circle_at_85%_20%,rgba(96,165,250,0.16),transparent_28%),linear-gradient(180deg,#08111f_0%,#070b12_72%)]">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:py-24">
          <div className="max-w-2xl">
            <p className="inline-flex rounded-full border border-[#addb46]/35 bg-[#addb46]/10 px-3 py-1 text-xs font-medium text-[#d7ff74]">
              Vorix Intelligence
            </p>
            <h1 className="mt-5 text-balance font-display text-4xl font-semibold sm:text-5xl lg:text-6xl">
              Marketing, atendimento e vendas conectados por IA.
            </h1>
            <p className="mt-5 max-w-xl text-balance text-base leading-7 text-slate-300 sm:text-lg">
              O Vorix conecta conteudo, conversas, CRM e resultados para sua equipe transformar contexto em receita.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/signup">
                <Button className="bg-[#addb46] px-5 py-3 text-[#071009] hover:bg-[#c7f45b]">Testar por 7 dias</Button>
              </Link>
              <Link href="#produto">
                <Button variant="secondary" className="border-white/20 bg-white/5 px-5 py-3 text-white hover:bg-white/10">
                  Ver o Vorix em acao
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-400">7 dias para testar · sem cartao para comecar</p>
          </div>

          <HeroProductVisual />
        </div>
      </section>

      <section id="produto" className="bg-[#0b1019]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase text-[#addb46]">Produto em foco</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-white sm:text-4xl">Uma operacao inteira. Um unico lugar.</h2>
            <p className="mt-3 text-base leading-7 text-slate-300">
              Veja como marketing, atendimento e vendas se conectam no Vorix sem depender de listas longas para explicar o produto.
            </p>
          </div>
          <div className="mt-10 space-y-14">
            {PRODUCT_SECTIONS.map((section) => (
              <ProductShowcase key={section.eyebrow} section={section} />
            ))}
          </div>
        </div>
      </section>

      <section id="intelligence" className="border-y border-white/10 bg-[#070b12]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.78fr_1.22fr] lg:py-20">
          <div>
            <p className="text-sm font-semibold uppercase text-[#addb46]">Intelligence</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-white sm:text-4xl">Sinais uteis, no ritmo da operacao.</h2>
            <p className="mt-4 text-slate-300">
              O Command Center destaca oportunidades e riscos operacionais no contexto certo: conversa, tarefa, proposta ou pipeline.
            </p>
          </div>
          <IntelligenceVisual />
        </div>
      </section>

      <section className="bg-[#f7f8fb] text-slate-950">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase text-[#4f6b1a]">Jornada</p>
              <h2 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">Do conteudo ao resultado, sem perder o fio.</h2>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="grid min-w-[680px] grid-cols-5">
                {JOURNEY.map((step, index) => (
                  <div key={step} className="relative border-r border-slate-200 px-4 py-5 last:border-r-0">
                    {index < JOURNEY.length - 1 ? <ArrowRight className="absolute right-3 top-6 h-4 w-4 text-slate-300" /> : null}
                    <p className="text-xs font-medium text-slate-500">{String(index + 1).padStart(2, "0")}</p>
                    <p className="mt-3 font-semibold">{step}</p>
                    <p className="mt-2 text-sm leading-5 text-slate-600">{journeyCopy(step)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {plans.length > 0 ? (
        <section className="bg-white text-slate-950">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-semibold uppercase text-[#4f6b1a]">Planos</p>
              <h2 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">Comece com o que sua operacao precisa hoje.</h2>
              <p className="mt-3 text-sm text-slate-600">7 dias de teste em qualquer plano, sem cartao para comecar.</p>
            </div>
            <div className="mx-auto mt-9 grid max-w-5xl gap-4 md:grid-cols-3">
              {plans.map((plan) => (
                <PlanSummary key={plan.code} plan={plan} />
              ))}
            </div>
            <p className="mt-6 text-center text-sm">
              <Link href="/pricing" className="font-medium text-[#4f6b1a] hover:underline">
                Ver todos os detalhes dos planos
              </Link>
            </p>
          </div>
        </section>
      ) : null}

      <section className="border-y border-white/10 bg-[#0b1019]">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 lg:py-20">
          <h2 className="font-display text-3xl font-semibold text-white sm:text-4xl">Pronto para conectar sua operacao?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-300">Marketing, atendimento e vendas trabalhando juntos no mesmo fluxo.</p>
          <Link href="/signup">
            <Button className="mt-7 bg-[#addb46] px-6 py-3 text-[#071009] hover:bg-[#c7f45b]">Testar o Vorix por 7 dias</Button>
          </Link>
          <p className="mt-3 text-sm text-slate-400">Sem cartao para comecar.</p>
        </div>
      </section>

      <section className="bg-white text-slate-950">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-center font-display text-2xl font-semibold">Perguntas frequentes</h2>
          <div className="mt-8 space-y-5">
            {FAQ.map((item) => (
              <div key={item.question} className="border-b border-slate-200 pb-5 last:border-b-0">
                <p className="font-medium">{item.question}</p>
                <p className="mt-1 text-sm text-slate-600">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

type ProductSection = {
  eyebrow: string;
  title: string;
  description: string;
  visual: "conversations" | "crm" | "marketing";
  reverse?: boolean;
};

function ProductShowcase({ section }: { section: ProductSection }) {
  return (
    <section className={cn("grid gap-7 lg:grid-cols-[0.68fr_1.32fr] lg:items-center", section.reverse && "lg:grid-cols-[1.32fr_0.68fr]")}>
      <div className={cn("max-w-xl", section.reverse && "lg:order-2")}>
        <p className="text-sm font-semibold uppercase text-[#addb46]">{section.eyebrow}</p>
        <h3 className="mt-3 font-display text-2xl font-semibold text-white sm:text-3xl">{section.title}</h3>
        <p className="mt-3 text-base leading-7 text-slate-300">{section.description}</p>
      </div>
      <div className={cn(section.reverse && "lg:order-1")}>
        <ProductFrame label={section.eyebrow}>
          {section.visual === "conversations" ? <ConversationsVisual /> : null}
          {section.visual === "crm" ? <CrmVisual /> : null}
          {section.visual === "marketing" ? <MarketingVisual /> : null}
        </ProductFrame>
      </div>
    </section>
  );
}

function HeroProductVisual() {
  return (
    <div className="relative" aria-label="Command Center do Vorix com conversas, pipeline e insights">
      <div className="absolute -inset-4 rounded-[2rem] bg-[#addb46]/10 blur-3xl" aria-hidden />
      <ProductFrame label="Command Center" priority>
        <div className="grid gap-4 lg:grid-cols-[1fr_0.86fr]">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Conversas" value="12" tone="lime" />
              <Metric label="Pipeline" value="R$ 48k" tone="blue" />
              <Metric label="Follow-ups" value="8" tone="violet" />
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0f1724] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-white">Prioridades de hoje</p>
                <span className="rounded-full bg-[#addb46]/12 px-2 py-1 text-xs text-[#d7ff74]">prioridade</span>
              </div>
              <div className="mt-4 space-y-3">
                <InsightLine icon={MessageSquareText} title="Lead quente sem resposta" meta="Conversa aberta ha 18 min" />
                <InsightLine icon={FileText} title="Proposta visualizada" meta="Enviar follow-up comercial" />
                <InsightLine icon={Clock3} title="Tarefa atrasada" meta="Renovar contato com decisor" />
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#0d1420] p-3">
            <p className="text-sm font-medium text-white">Pipeline</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {["Novo", "Proposta", "Ganho"].map((stage, index) => (
                <div key={stage} className="min-h-44 rounded-md bg-white/[0.04] p-2">
                  <p className="text-xs text-slate-400">{stage}</p>
                  <DealCard title={["Casa Aurora", "Studio Nexo", "Metodo Viva"][index]} value={["R$ 8,4k", "R$ 14k", "R$ 22k"][index]} compact />
                  {index === 1 ? <DealCard title="Clube Prisma" value="R$ 6,8k" compact /> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </ProductFrame>
    </div>
  );
}

function ProductFrame({ label, priority, children }: { label: string; priority?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-white/10 bg-[#101827] p-2 shadow-2xl shadow-black/30",
        priority && "lg:translate-y-3",
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b6b]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#f6c85f]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#addb46]" />
        </div>
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <div className="bg-[#0a101a] p-3 sm:p-4">{children}</div>
    </div>
  );
}

function ConversationsVisual() {
  return (
    <div className="grid min-h-[390px] gap-3 md:grid-cols-[0.72fr_1.1fr_0.78fr]">
      <div className="space-y-2 rounded-lg border border-white/10 bg-[#101827] p-3">
        {["Marina Costa", "Joao Lima", "Studio Nexo", "Casa Aurora"].map((name, index) => (
          <div key={name} className={cn("rounded-md p-3", index === 0 ? "bg-[#addb46]/12 ring-1 ring-[#addb46]/30" : "bg-white/[0.04]")}>
            <p className="text-sm font-medium text-white">{name}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{["Pediu uma proposta", "Quer reagendar", "Aguardando retorno", "Novo lead"][index]}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col rounded-lg border border-white/10 bg-[#101827] p-3">
        <div className="border-b border-white/10 pb-3">
          <p className="font-medium text-white">Marina Costa</p>
          <p className="text-xs text-slate-400">WhatsApp · oportunidade aberta</p>
        </div>
        <div className="flex flex-1 flex-col justify-end gap-3 py-4">
          <ChatBubble side="left">Gostei do pacote Pro. Voce consegue enviar uma proposta hoje?</ChatBubble>
          <ChatBubble side="right">Consigo sim. Vou montar com os pontos que voce comentou.</ChatBubble>
          <ChatBubble side="left">Perfeito. Preciso validar com meu socio ainda hoje.</ChatBubble>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#0b111d] px-3 py-2 text-sm text-slate-400">
          <Sparkles className="h-4 w-4 text-[#9aa7ff]" />
          Resposta sugerida com contexto do negocio
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-[#101827] p-3">
        <p className="text-sm font-medium text-white">Contexto comercial</p>
        <div className="mt-4 space-y-3 text-sm">
          <InfoRow label="Etapa" value="Proposta" />
          <InfoRow label="Valor" value="R$ 14.000" />
          <InfoRow label="Proximo passo" value="Enviar follow-up" />
        </div>
      </div>
    </div>
  );
}

function CrmVisual() {
  return (
    <div className="grid min-h-[390px] grid-cols-[repeat(3,minmax(210px,1fr))] gap-3 overflow-x-auto pb-2">
      {[
        ["Novo", ["Casa Aurora", "Metodo Viva"]],
        ["Proposta", ["Studio Nexo", "Clube Prisma"]],
        ["Fechamento", ["Marina Costa"]],
      ].map(([stage, deals]) => (
        <div key={stage as string} className="rounded-lg border border-white/10 bg-[#101827] p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white">{stage as string}</p>
            <span className="text-xs text-slate-500">{(deals as string[]).length}</span>
          </div>
          <div className="mt-3 space-y-3">
            {(deals as string[]).map((deal, index) => (
              <DealCard key={deal} title={deal} value={index === 0 ? "R$ 14k" : "R$ 8k"} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MarketingVisual() {
  return (
    <div className="grid min-h-[390px] gap-3 md:grid-cols-[0.92fr_1.08fr]">
      <div className="rounded-lg border border-white/10 bg-[#101827] p-4">
        <p className="text-sm font-medium text-white">Criar conteudo</p>
        <div className="mt-4 rounded-md border border-[#9aa7ff]/20 bg-[#9aa7ff]/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Sparkles className="h-4 w-4 text-[#9aa7ff]" />
            Direcao de IA
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Gerar sequencia educativa para leads que chegaram pelo WhatsApp e ainda nao receberam proposta.
          </p>
        </div>
        <div className="mt-4 space-y-2">
          {["Tom da marca aplicado", "Argumentos comerciais", "Revisao pendente"].map((item) => (
            <div key={item} className="flex items-center gap-2 rounded-md bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
              <CheckCircle2 className="h-4 w-4 text-[#addb46]" />
              {item}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-[#101827] p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-white">Producao</p>
          <span className="text-xs text-slate-500">Semana atual</span>
        </div>
        <div className="mt-4 grid gap-3">
          {["Ideia", "Roteiro", "Arte", "Agendado"].map((stage, index) => (
            <div key={stage} className="grid grid-cols-[90px_1fr] items-center gap-3">
              <p className="text-xs text-slate-500">{stage}</p>
              <div className="h-9 rounded-md bg-white/[0.04]">
                <div
                  className={cn("h-full rounded-md", index < 3 ? "bg-[#addb46]/70" : "bg-[#60a5fa]/70")}
                  style={{ width: `${[82, 66, 48, 36][index]}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IntelligenceVisual() {
  return (
    <ProductFrame label="Vorix Intelligence">
      <div className="relative min-h-[420px] rounded-lg border border-white/10 bg-[#0f1724] p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Conversas abertas" value="12" tone="lime" />
          <Metric label="Propostas ativas" value="5" tone="blue" />
          <Metric label="Tarefas vencendo" value="3" tone="violet" />
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
          <div className="rounded-lg border border-white/10 bg-[#0a101a] p-4">
            <p className="font-medium text-white">Fila de atencao</p>
            <div className="mt-4 space-y-3">
              <InsightLine icon={Lightbulb} title="Oportunidade no pipeline" meta="Negocio parado na etapa Proposta" />
              <InsightLine icon={MessageSquareText} title="Lead quente sem resposta" meta="Ultima mensagem ha 18 min" />
              <InsightLine icon={Clock3} title="Tarefa atrasada" meta="Responsavel ja definido" />
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#0a101a] p-4">
            <p className="font-medium text-white">Resultado</p>
            <div className="mt-4 h-40 rounded-md bg-[linear-gradient(135deg,rgba(173,219,70,0.22),rgba(96,165,250,0.14))] p-4">
              <BarChart3 className="h-5 w-5 text-[#addb46]" />
              <p className="mt-16 text-sm text-slate-300">Volume de resposta e avancos comerciais por semana</p>
            </div>
          </div>
        </div>
      </div>
    </ProductFrame>
  );
}

function PlanSummary({ plan }: { plan: PublicPlan }) {
  return (
    <div className={cn("flex flex-col rounded-lg border p-5", plan.highlighted ? "border-[#addb46] bg-[#f5fde6]" : "border-slate-200 bg-white")}>
      {plan.highlighted ? <span className="mb-3 w-fit rounded-full bg-[#4f6b1a] px-2.5 py-1 text-xs font-semibold uppercase text-white">Recomendado</span> : null}
      <p className="font-semibold">{plan.name}</p>
      <p className="mt-1 text-3xl font-semibold">
        {formatPlanPrice(plan)}
        <span className="text-sm font-normal text-slate-500">/mes</span>
      </p>
      <p className="mt-3 text-sm text-slate-600">{formatCapacityLine(plan)}</p>
      <PlanSelectLink planCode={plan.code} className="mt-5" variant={plan.highlighted ? "primary" : "secondary"}>
        Testar {plan.name}
      </PlanSelectLink>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "lime" | "blue" | "violet" }) {
  const toneClass = {
    lime: "text-[#d7ff74] bg-[#addb46]/10 border-[#addb46]/20",
    blue: "text-[#93c5fd] bg-[#60a5fa]/10 border-[#60a5fa]/20",
    violet: "text-[#c4b5fd] bg-[#8b5cf6]/10 border-[#8b5cf6]/20",
  }[tone];

  return (
    <div className={cn("rounded-lg border p-3", toneClass)}>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function InsightLine({ icon: Icon, title, meta }: { icon: LucideIcon; title: string; meta: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.04] p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#addb46]" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{title}</p>
        <p className="mt-1 truncate text-xs text-slate-400">{meta}</p>
      </div>
    </div>
  );
}

function DealCard({ title, value, compact }: { title: string; value: string; compact?: boolean }) {
  return (
    <div className={cn("mt-3 rounded-md border border-white/10 bg-[#0a101a] p-3", compact && "p-2")}>
      <p className="truncate text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-xs text-slate-400">{value} · proximo passo definido</p>
      {!compact ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <CircleDollarSign className="h-3.5 w-3.5 text-[#addb46]" />
          Proposta em acompanhamento
        </div>
      ) : null}
    </div>
  );
}

function ChatBubble({ side, children }: { side: "left" | "right"; children: React.ReactNode }) {
  return (
    <div className={cn("max-w-[82%] rounded-lg px-3 py-2 text-sm leading-6", side === "right" ? "ml-auto bg-[#addb46] text-[#071009]" : "bg-white/[0.06] text-slate-200")}>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/[0.04] px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-slate-200">{value}</p>
    </div>
  );
}

function journeyCopy(step: (typeof JOURNEY)[number]) {
  if (step === "Criar") return "Briefing, marca e IA no mesmo ponto de partida.";
  if (step === "Publicar") return "Conteudo revisado segue para os canais certos.";
  if (step === "Conversar") return "O retorno entra no atendimento com historico.";
  if (step === "Vender") return "Contato vira oportunidade, tarefa e proposta.";
  return "O time acompanha sinais e resultado sem perder contexto.";
}
