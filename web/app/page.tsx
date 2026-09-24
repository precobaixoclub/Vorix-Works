import Link from "next/link";
import type React from "react";
import { ArrowRight } from "lucide-react";
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
    description: "Lista, conversa, mensagens e contexto comercial aparecem no mesmo fluxo para a equipe responder com clareza.",
    label: "Conversas",
    image: "conversas",
    width: 1280,
    widths: [960, 1280],
    aspect: "aspect-[1280/844]",
    overlay: {
      label: "Contexto comercial",
      image: "conversas-contexto",
      width: 920,
      widths: [920],
      className: "right-5 top-5 hidden w-[33%] lg:block",
    },
  },
  {
    eyebrow: "CRM",
    title: "Transforme conversas em oportunidades e acompanhe cada negociacao.",
    description: "O Kanban real mostra etapa, responsavel, origem, valor e proximo passo sem tirar o time da operacao.",
    label: "CRM / Kanban",
    image: "crm-kanban",
    width: 1120,
    widths: [900, 1120],
    aspect: "aspect-[1120/700]",
    reverse: true,
    overlay: {
      label: "Negocio",
      image: "deal-context",
      width: 920,
      widths: [920],
      className: "bottom-5 left-5 hidden w-[42%] lg:block",
    },
  },
  {
    eyebrow: "Marketing + IA",
    title: "Crie e organize conteudo com IA sem sair da plataforma.",
    description: "A tela de Criar e o planejamento de Producao mostram como a IA entra no fluxo real de marketing.",
    label: "Criar conteudo",
    image: "marketing-criar",
    width: 1120,
    widths: [900, 1120],
    aspect: "aspect-[1120/825]",
    overlay: {
      label: "Producao",
      image: "producao",
      width: 1120,
      widths: [900, 1120],
      className: "bottom-5 right-5 hidden w-[42%] lg:block",
    },
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

      <section className="relative border-b border-white/10 bg-[#080c13]">
        <div className="mx-auto grid max-w-7xl items-center gap-9 px-4 py-14 sm:px-6 sm:py-18 lg:grid-cols-[0.76fr_1.24fr] lg:py-20">
          <div className="max-w-2xl">
            <div className="inline-flex flex-col gap-1">
              <span className="font-mono text-sm font-semibold uppercase tracking-[0.28em] text-[#d7ff74]">Vorix</span>
              <span className="text-sm font-medium text-slate-300">Transforme contexto em ação.</span>
            </div>
            <h1 className="mt-5 text-balance font-display text-4xl font-semibold sm:text-5xl lg:text-6xl">
              Marketing, atendimento e vendas conectados por IA.
            </h1>
            <p className="mt-5 max-w-xl text-balance text-base leading-7 text-slate-300 sm:text-lg">
              O Vorix conecta conteudo, conversas, CRM e resultados para sua equipe transformar contexto em ação e ação em receita.
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
            <p className="text-sm font-semibold uppercase text-[#addb46]">Produto real</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-white sm:text-4xl">O Vorix conecta toda a sua operacao.</h2>
            <p className="mt-3 text-base leading-7 text-slate-300">
              As telas abaixo sao capturas da interface real do Vorix com dados ficticios controlados.
            </p>
          </div>
          <div className="mt-10 space-y-14">
            {PRODUCT_SECTIONS.map((section) => (
              <ProductShowcase key={section.eyebrow} section={section} />
            ))}
          </div>
        </div>
      </section>

      <BrandMissionSection />

      <section id="intelligence" className="border-y border-white/10 bg-[#070b12]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:py-20">
          <div>
            <p className="text-sm font-semibold uppercase text-[#addb46]">Intelligence</p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-white sm:text-4xl">Sinais uteis, no ritmo da operacao.</h2>
            <p className="mt-4 text-slate-300">
              O Command Center e Resultados destacam oportunidades e riscos operacionais no contexto certo: conversa, tarefa, proposta ou pipeline.
            </p>
          </div>
          <ProductBrowserFrame label="Resultados / Intelligence" className="shadow-2xl shadow-black/35">
            <ProductShot
              name="resultados"
              alt="Tela real de Resultados do Vorix com metricas de marketing, atendimento, receita e alerta de analytics"
              width={1120}
              widths={[900, 1120]}
              className="h-full w-full object-cover"
            />
          </ProductBrowserFrame>
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
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.28em] text-[#addb46]">Vorix</p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-white sm:text-4xl">Crie. Atenda. Venda. Tudo conectado.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-300">Transforme contexto em ação com marketing, conversas e vendas trabalhando no mesmo fluxo.</p>
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
  label: string;
  image: ProductShotName;
  width: number;
  widths: readonly number[];
  aspect: string;
  reverse?: boolean;
  overlay?: {
    label: string;
    image: ProductShotName;
    width: number;
    widths: readonly number[];
    className: string;
  };
};

function BrandMissionSection() {
  const flow = ["Criar", "Atender", "Vender"];
  return (
    <section className="border-y border-white/10 bg-[#0a0f18]">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:py-20">
        <div>
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.26em] text-[#addb46]">Por que o Vorix existe</p>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold text-white sm:text-4xl">
            Criar, atender e vender não deveriam acontecer em mundos separados.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
            Empresas ainda operam marketing, atendimento e vendas como áreas isoladas. O resultado é perda de contexto, retrabalho e oportunidades esquecidas.
          </p>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            O Vorix nasceu para eliminar essas rupturas: conectar criação, conversas e gestão comercial em uma operação inteligente.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="#produto">
              <Button variant="secondary" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
                Ver o Vorix em ação
              </Button>
            </Link>
            <Link href="/empresa">
              <Button variant="ghost" className="text-white hover:bg-white/10">Conhecer a missão</Button>
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#101827] p-5 shadow-2xl shadow-black/30 sm:p-6">
          <div className="mb-6">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.24em] text-[#d7ff74]">Vorix</p>
            <p className="mt-2 text-2xl font-semibold text-white">Transforme contexto em ação.</p>
            <p className="mt-1 text-sm text-slate-400">Transforme ação em resultado.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {flow.map((item, index) => (
              <div key={item} className="relative rounded-xl border border-white/10 bg-white/[0.04] p-4">
                {index < flow.length - 1 ? (
                  <ArrowRight className="absolute -right-5 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-[#addb46] md:block" />
                ) : null}
                <p className="font-mono text-xs text-slate-500">0{index + 1}</p>
                <p className="mt-3 text-xl font-semibold text-white">{item}</p>
                <p className="mt-2 text-sm leading-6 text-slate-400">{brandFlowCopy(item)}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-[#addb46]/25 bg-[#addb46]/10 p-4">
            <p className="text-sm font-medium text-[#e6ff9f]">O contexto atravessa a operação.</p>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              A conversa carrega o contato. O CRM conhece a conversa. A proposta conhece o negócio. O time decide com menos ruptura.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

type ProductShotName =
  | "command-center"
  | "conversas"
  | "conversas-contexto"
  | "crm-kanban"
  | "deal-context"
  | "marketing-criar"
  | "mobile-conversas"
  | "mobile-deal"
  | "producao"
  | "resultados";

function HeroProductVisual() {
  return (
    <div className="relative mx-auto w-full max-w-4xl" aria-label="Telas reais do Vorix">
      <div className="rounded-[1.35rem] border border-white/12 bg-white/[0.03] p-2 shadow-2xl shadow-black/40">
        <ProductBrowserFrame label="Command Center" priority>
          <ProductShot
            name="command-center"
            alt="Tela real da Home do Vorix com Command Center, KPIs e Vorix Intelligence"
            width={1280}
            widths={[960, 1280]}
            className="h-full w-full object-cover"
            priority
          />
        </ProductBrowserFrame>
      </div>

      <div className="absolute -bottom-8 -left-3 hidden w-[25%] min-w-40 rounded-[1.1rem] border border-white/14 bg-[#0d1420] p-1.5 shadow-2xl shadow-black/45 sm:block">
        <ProductShot
          name="mobile-conversas"
          alt="Tela mobile real de Conversas do Vorix"
          width={390}
          widths={[390]}
          className="aspect-[390/844] w-full rounded-[0.85rem] object-cover"
        />
      </div>

      <div className="absolute -bottom-5 right-4 hidden w-[40%] rounded-xl border border-white/14 bg-[#0d1420] p-1.5 shadow-2xl shadow-black/45 lg:block">
        <ProductShot
          name="deal-context"
          alt="Modal real de negocio do Vorix com contexto comercial"
          width={920}
          widths={[920]}
          className="aspect-[920/740] w-full rounded-lg object-cover object-top"
        />
      </div>
    </div>
  );
}

function ProductShowcase({ section }: { section: ProductSection }) {
  return (
    <section className={cn("grid gap-7 lg:grid-cols-[0.68fr_1.32fr] lg:items-center", section.reverse && "lg:grid-cols-[1.32fr_0.68fr]")}>
      <div className={cn("max-w-xl", section.reverse && "lg:order-2")}>
        <p className="text-sm font-semibold uppercase text-[#addb46]">{section.eyebrow}</p>
        <h3 className="mt-3 font-display text-2xl font-semibold text-white sm:text-3xl">{section.title}</h3>
        <p className="mt-3 text-base leading-7 text-slate-300">{section.description}</p>
      </div>
      <div className={cn("relative", section.reverse && "lg:order-1")}>
        <ProductBrowserFrame label={section.label} className="shadow-2xl shadow-black/35">
          <ProductShot
            name={section.image}
            alt={`Tela real do Vorix: ${section.label}`}
            width={section.width}
            widths={section.widths}
            className={cn(section.aspect, "w-full object-cover object-top")}
          />
        </ProductBrowserFrame>
        {section.overlay ? (
          <div className={cn("absolute rounded-xl border border-white/14 bg-[#0d1420] p-1.5 shadow-2xl shadow-black/45", section.overlay.className)}>
            <ProductShot
              name={section.overlay.image}
              alt={`Recorte real do Vorix: ${section.overlay.label}`}
              width={section.overlay.width}
              widths={section.overlay.widths}
              className="aspect-[16/10] w-full rounded-lg object-cover object-top"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProductBrowserFrame({
  label,
  priority,
  className,
  children,
}: {
  label: string;
  priority?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-white/12 bg-[#101827]", priority && "lg:translate-y-3", className)}>
      <div className="flex h-9 items-center justify-between border-b border-white/10 px-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff6b6b]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#f6c85f]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#addb46]" />
        </div>
        <span className="truncate pl-3 text-xs text-slate-400">{label}</span>
      </div>
      <div className="bg-[#0a101a] p-1.5">{children}</div>
    </div>
  );
}

function ProductShot({
  name,
  alt,
  width,
  widths,
  className,
  priority,
}: {
  name: ProductShotName;
  alt: string;
  width: number;
  widths: readonly number[];
  className?: string;
  priority?: boolean;
}) {
  const sortedWidths = [...widths].sort((a, b) => a - b);
  const srcSet = (extension: "avif" | "webp") => sortedWidths.map((item) => `/product-shots/${name}-${item}.${extension} ${item}w`).join(", ");

  return (
    <picture>
      <source type="image/avif" srcSet={srcSet("avif")} sizes="(min-width: 1024px) 58vw, 100vw" />
      <source type="image/webp" srcSet={srcSet("webp")} sizes="(min-width: 1024px) 58vw, 100vw" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/product-shots/${name}-${width}.webp`}
        alt={alt}
        className={className}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
    </picture>
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

function journeyCopy(step: (typeof JOURNEY)[number]) {
  if (step === "Criar") return "Briefing, marca e IA no mesmo ponto de partida.";
  if (step === "Publicar") return "Conteudo revisado segue para os canais certos.";
  if (step === "Conversar") return "O retorno entra no atendimento com historico.";
  if (step === "Vender") return "Contato vira oportunidade, tarefa e proposta.";
  return "O time acompanha sinais e resultado sem perder contexto.";
}

function brandFlowCopy(step: string) {
  if (step === "Criar") return "Marketing gera demanda com identidade e direção.";
  if (step === "Atender") return "Conversas preservam histórico e intenção.";
  return "Oportunidades, tarefas e propostas avançam com contexto.";
}
