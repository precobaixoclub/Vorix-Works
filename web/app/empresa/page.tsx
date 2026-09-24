import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/Button";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { TrackPageView } from "@/components/TrackPageView";

export const metadata: Metadata = {
  title: "Empresa — Vorix",
  description: "Por que o Vorix existe: eliminar rupturas entre criar, atender e vender para transformar contexto em ação.",
  openGraph: {
    title: "Empresa — Vorix",
    description: "Transforme contexto em ação.",
    url: "https://vorixworks.com/empresa",
  },
};

const PRINCIPLES = [
  {
    title: "Contexto antes de complexidade",
    description: "Tudo que o time precisa para decidir deve atravessar a operação, sem se perder entre ferramentas.",
  },
  {
    title: "Automação sem perder controle",
    description: "IA e automação ajudam a equipe a agir melhor, sem esconder o que está acontecendo.",
  },
  {
    title: "Simples por fora",
    description: "O sistema pode ser sofisticado internamente, mas precisa ser claro para quem opera todos os dias.",
  },
  {
    title: "Resultado acima de ferramenta",
    description: "Tecnologia só importa quando reduz ruptura, melhora cadência e ajuda a operação a avançar.",
  },
];

export default function EmpresaPage() {
  return (
    <main className="min-h-dvh bg-[#070b12] text-white">
      <TrackPageView eventName="landing_view" />
      <PublicHeader />

      <section className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.28em] text-[#addb46]">Vorix</p>
          <h1 className="mt-5 max-w-4xl font-display text-4xl font-semibold sm:text-5xl lg:text-6xl">
            Existimos para eliminar rupturas entre criar, atender e vender.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Marketing cria demanda. A demanda vira conversa. A conversa vira contato. O contato vira negócio. O contexto não deveria se perder nesse caminho.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup">
              <Button className="bg-[#addb46] px-5 py-3 text-[#071009] hover:bg-[#c7f45b]">Testar por 7 dias</Button>
            </Link>
            <Link href="/#produto">
              <Button variant="secondary" className="border-white/20 bg-white/5 px-5 py-3 text-white hover:bg-white/10">Ver produto</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#0a0f18]">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:py-20">
          <div>
            <p className="font-mono text-sm font-semibold uppercase tracking-[0.24em] text-[#addb46]">Nossa missão</p>
          </div>
          <div>
            <p className="font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Eliminar as rupturas entre criar, atender e vender.
            </p>
            <p className="mt-5 max-w-3xl text-base leading-8 text-slate-300">
              Nossa missão é eliminar as rupturas entre criar, atender e vender, conectando marketing, conversas e gestão comercial em uma única operação inteligente — para transformar contexto em ação e ação em resultado.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
          <InstitutionBlock
            eyebrow="O problema"
            title="Operações crescem em sistemas separados."
            body="Quando criação, atendimento e vendas ficam isolados, o time perde histórico, repete trabalho e deixa oportunidades sem próxima ação."
          />
          <InstitutionBlock
            eyebrow="Nossa visão"
            title="Um futuro sem contextos separados."
            body="Acreditamos em empresas operando marketing, atendimento e vendas em uma mesma cadência, com informação conectada e decisões mais claras."
          />
        </div>
      </section>

      <section className="bg-[#0b1019]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-3xl">
            <p className="font-mono text-sm font-semibold uppercase tracking-[0.24em] text-[#addb46]">Princípios</p>
            <h2 className="mt-4 font-display text-3xl font-semibold text-white sm:text-4xl">O que guia o produto.</h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {PRINCIPLES.map((principle) => (
              <article key={principle.title} className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
                <h3 className="font-semibold text-white">{principle.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">{principle.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#070b12]">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 lg:py-20">
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.28em] text-[#addb46]">Vorix</p>
          <h2 className="mt-3 font-display text-3xl font-semibold text-white sm:text-4xl">Transforme contexto em ação.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-300">Crie. Atenda. Venda. Tudo conectado.</p>
          <Link href="/signup">
            <Button className="mt-7 bg-[#addb46] px-6 py-3 text-[#071009] hover:bg-[#c7f45b]">
              Testar por 7 dias <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

function InstitutionBlock({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-[#101827] p-6">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[#addb46]">{eyebrow}</p>
      <h2 className="mt-4 font-display text-2xl font-semibold text-white sm:text-3xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-slate-300">{body}</p>
    </article>
  );
}
