import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, Check, Clock3, Download, FileText, Layers3, PlayCircle, ShieldCheck, Video } from "lucide-react";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { SectionHeading } from "@/components/public/LandingSections";
import { publicMetadata } from "@/features/public-site/metadata";
import { PUBLIC_CONTACT } from "@/features/public-site/catalog";
import { PUBLIC_MEETING_PLANS, PUBLIC_MEETING_RULES, PUBLIC_MEETING_TRIAL, SCREEN_CAPTURE_ENABLED } from "@/features/meeting-plans/public-plans";

// Página comercial dos planos de gravação. AGUARDANDO APROVAÇÃO: fora da navegação e fora dos
// buscadores (noindex) até a liberação comercial — o link existe só para revisão.
export const metadata: Metadata = {
  ...publicMetadata(
    "Vorix Meetings — Planos de gravação de reuniões",
    "Suas reuniões gravadas, transcritas e organizadas em um só lugar. Teste grátis por 7 dias.",
    "/produtos/meetings/planos",
  ),
  robots: { index: false, follow: false },
};

const START_HREF = "/signup";
const captured = SCREEN_CAPTURE_ENABLED ? "a tela e o áudio" : "o áudio";

const BENEFITS = [
  { Icon: Video, title: "Nada se perde", description: `O Vorix grava ${captured} da reunião e guarda tudo junto da reunião: quem participou, quando aconteceu e o que foi dito.` },
  { Icon: FileText, title: "Transcrição automática", description: "Cada gravação vira texto pesquisável, para você encontrar uma decisão sem assistir tudo de novo." },
  { Icon: Clock3, title: "Limites transparentes", description: "Você vê quantas horas usou no ciclo e quantas faltam. Sem cobrança surpresa por excedente." },
  { Icon: ShieldCheck, title: "Privacidade por padrão", description: "Gravações privadas, acesso por permissão e aviso de gravação para os participantes." },
] as const;

const STEPS = [
  { title: "Agende ou cole o link", description: "Conecte sua agenda Google ou informe o link do Google Meet. Você escolhe quais reuniões gravar." },
  { title: "O gravador entra na reunião", description: "Uma conta de gravação da sua empresa entra na chamada e o aviso de gravação é exibido aos participantes." },
  { title: "Gravação e texto prontos", description: "Ao fim da reunião, a gravação e a transcrição aparecem na própria reunião, com resumo e próximos passos." },
] as const;

const FAQ: readonly (readonly [string, string])[] = [
  ["Como as horas são contadas?", "Pela duração efetivamente gravada (e pelos arquivos que você enviar). O uso aparece em tempo real no seu painel."],
  ["As horas que sobram acumulam?", "Não. A franquia renova a cada ciclo de cobrança mensal e as horas não usadas não passam para o mês seguinte."],
  ["O que acontece quando a franquia acaba?", `Novas gravações ficam bloqueadas até a renovação ou até você mudar para um plano maior. Uma gravação que já começou não é cortada: ela vai até o fim da reunião (máximo de ${PUBLIC_MEETING_RULES.maxRecordingHours} horas por gravação) e o excedente é descontado do ciclo.`],
  ["Por quanto tempo os vídeos ficam guardados?", `Individual: 90 dias. Profissional: 180 dias. Equipes: 365 dias. O prazo conta a partir da data da gravação, e avisamos ${PUBLIC_MEETING_RULES.noticeDays.join(" e ")} dias antes de excluir um vídeo.`],
  ["Posso exportar minhas gravações?", "Sim. Vídeos e transcrições podem ser exportados a qualquer momento enquanto estiverem disponíveis."],
  ["E se eu cancelar?", `Você continua gravando até o fim do ciclo pago. Depois, tem ${PUBLIC_MEETING_RULES.exportWindowDays} dias para exportar vídeos e transcrições antes de os vídeos serem removidos.`],
  ["Como funciona o teste grátis?", `${PUBLIC_MEETING_TRIAL.days} dias com até ${PUBLIC_MEETING_TRIAL.hours} horas de gravação, sem cartão de crédito. É um teste por empresa. Ao terminar, novas gravações ficam bloqueadas até você escolher um plano — nada é cobrado automaticamente.`],
  ["Os participantes sabem que estão sendo gravados?", "Sim. O Vorix exibe um aviso de gravação na reunião, e você pode personalizar a mensagem. Pedidos de exclusão de dados (LGPD) são atendidos pela própria plataforma."],
];

export default function MeetingPlansPage() {
  return (
    <div className="public-site meetings">
      <PublicHeader startHref={START_HREF} />
      <main id="conteudo">
        {/* 1. Apresentação */}
        <section className="public-page-hero public-meeting-plans-hero">
          <div className="public-container">
            <div>
              <span className="public-eyebrow-pill">Vorix Meetings</span>
              <h1>Suas reuniões gravadas, transcritas e organizadas em um só lugar.</h1>
              <p className="public-section-copy">Grave {captured} das suas reuniões, assista novamente quando precisar e consulte as transcrições em uma plataforma integrada à sua operação.</p>
              <div className="public-button-row">
                <Link href={START_HREF} className="public-button primary">Teste grátis por 7 dias <ArrowUpRight size={18} aria-hidden="true" /></Link>
                <Link href="#planos" className="public-button secondary">Ver planos <ArrowUpRight size={16} aria-hidden="true" /></Link>
              </div>
              <p className="public-release-notice"><ShieldCheck size={15} aria-hidden="true" />{PUBLIC_MEETING_TRIAL.hours} horas de gravação no teste, sem cartão de crédito. Nada é cobrado automaticamente.</p>
            </div>
            <ul className="public-product-feature-list">
              {[`Gravação de ${captured} das reuniões do Google Meet`, "Transcrição automática em português", "Reprodução da gravação dentro da reunião", "Histórico de reuniões da equipe", "Resumo, decisões e próximos passos", "Exportação de vídeos e transcrições"].map((feature) => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}
            </ul>
          </div>
        </section>

        {/* 2. Benefícios */}
        <section className="public-section">
          <div className="public-container">
            <SectionHeading eyebrow="Por que gravar com o Vorix" title="O que foi dito fica com você." />
            <div className="public-product-benefits public-meeting-benefits">
              {BENEFITS.map(({ Icon, title, description }) => <article key={title}><Icon size={26} aria-hidden="true" /><h3>{title}</h3><p>{description}</p></article>)}
            </div>
          </div>
        </section>

        {/* 3. Como a gravação acontece */}
        <section className="public-section public-how">
          <div className="public-container">
            <SectionHeading eyebrow="Como funciona" title="Da agenda à gravação, sem trabalho manual." />
            <ol className="public-steps">
              {STEPS.map((step, index) => <li key={step.title}><div className="public-step-top"><span className="public-step-number">0{index + 1}</span></div><h3>{step.title}</h3><p>{step.description}</p></li>)}
            </ol>
          </div>
        </section>

        {/* 4. Reprodução e transcrições */}
        <section className="public-section">
          <div className="public-container public-product-features-section">
            <div>
              <span className="public-eyebrow">Reprodução e transcrição</span>
              <h2>Assista de novo. Encontre em segundos.</h2>
              <p className="public-section-copy">A gravação abre dentro da reunião, com a transcrição ao lado. Pule para o trecho que importa, separe quem falou e compartilhe só o que precisa.</p>
            </div>
            <ul className="public-product-feature-list">
              {[[PlayCircle, "Player com navegação pela gravação"], [FileText, "Transcrição com identificação de quem falou"], [Download, "Exportação da gravação e da transcrição"], [ShieldCheck, "Links de compartilhamento que você controla"]].map(([Icon, text]) => {
                const I = Icon as typeof PlayCircle;
                return <li key={text as string}><I size={16} aria-hidden="true" />{text as string}</li>;
              })}
            </ul>
          </div>
        </section>

        {/* 5. Ecossistema Vorix */}
        <section className="public-section public-how">
          <div className="public-container public-product-features-section">
            <div>
              <span className="public-eyebrow">Integrado ao Vorix</span>
              <h2>A reunião continua no seu fluxo de trabalho.</h2>
              <p className="public-section-copy">Meetings usa a mesma conta, equipe e permissões do Vorix. O que foi combinado na reunião segue para onde a equipe trabalha.</p>
            </div>
            <ul className="public-product-feature-list">
              {["Reunião ligada ao contato e à oportunidade no CRM", "Tarefas do CRM criadas a partir dos próximos passos", "Mensagem de acompanhamento pelo WhatsApp do Vorix Conversas", "Agenda Google sincronizada com as reuniões"].map((feature) => <li key={feature}><Layers3 size={16} aria-hidden="true" />{feature}</li>)}
            </ul>
          </div>
        </section>

        {/* 6. Planos */}
        <section id="planos" className="public-section public-pricing">
          <div className="public-container">
            <SectionHeading eyebrow="Planos" title="Escolha quantas horas você precisa." description={`Valores mensais. Comece pelo teste grátis de ${PUBLIC_MEETING_TRIAL.days} dias com até ${PUBLIC_MEETING_TRIAL.hours} horas de gravação.`} />
            <div className="public-price-grid">
              {PUBLIC_MEETING_PLANS.map((plan) => {
                const featured = plan.code === "professional";
                return (
                  <article key={plan.code} className={"public-price-card meetings" + (featured ? " featured" : "")}>
                    <div className="public-price-card-top"><span className="public-icon small"><Video size={18} aria-hidden="true" /></span>{featured ? <span className="public-badge">Mais escolhido</span> : null}</div>
                    <h3>{plan.name}</h3>
                    <p className="public-price-description">{plan.description}</p>
                    <div className="public-price"><small>Plano mensal</small><strong>{plan.price}<span>/mês</span></strong><p>Cobrança mensal · cancele quando quiser</p></div>
                    <ul>
                      <li><Check size={14} aria-hidden="true" />{plan.hours} horas de gravação por mês{plan.shared ? ", compartilhadas pela equipe" : ""}</li>
                      <li><Check size={14} aria-hidden="true" />Vídeos guardados por {plan.retentionDays} dias</li>
                      <li><Check size={14} aria-hidden="true" />Transcrição, reprodução e histórico</li>
                      <li><Check size={14} aria-hidden="true" />{plan.concurrent} {plan.concurrent > 1 ? "gravações" : "gravação"} ao mesmo tempo</li>
                    </ul>
                    <Link href={START_HREF} className={"public-button " + (featured ? "primary" : "secondary")}>Teste grátis por 7 dias <ArrowUpRight size={16} aria-hidden="true" /></Link>
                    <small className="public-price-note">Sem cartão no teste</small>
                  </article>
                );
              })}
            </div>
            <p className="public-pricing-disclaimer">A franquia renova a cada ciclo e não acumula. Ao atingir o limite, novas gravações ficam bloqueadas até a renovação ou um upgrade; uma gravação em andamento não é interrompida (máximo de {PUBLIC_MEETING_RULES.maxRecordingHours} horas por gravação). Após o cancelamento, você tem {PUBLIC_MEETING_RULES.exportWindowDays} dias para exportar seus arquivos.</p>
          </div>
        </section>

        {/* 7. Perguntas frequentes */}
        <section id="faq" className="public-section public-faq">
          <div className="public-container public-faq-grid">
            <div>
              <span className="public-eyebrow">Perguntas frequentes</span>
              <h2>Antes de começar.</h2>
              <p className="public-section-copy">Como as horas são contadas, o que acontece no limite e como ficam seus arquivos.</p>
              <Link href={PUBLIC_CONTACT} className="public-text-link">Falar com o time <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
            <div className="public-faq-list">{FAQ.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
          </div>
        </section>

        {/* 8. Chamada final */}
        <section className="public-final-wrap">
          <div className="public-container">
            <div className="public-final-cta">
              <div className="public-final-landscape" aria-hidden="true"><div /><span>V<span>.</span></span></div>
              <div className="public-final-copy">
                <span className="public-eyebrow">Seu próximo passo</span>
                <h2>Grave sua próxima reunião de graça.</h2>
                <p>{PUBLIC_MEETING_TRIAL.days} dias, até {PUBLIC_MEETING_TRIAL.hours} horas de gravação, sem cartão.</p>
                <div className="public-button-row"><Link href={START_HREF} className="public-button primary">Teste grátis por 7 dias <ArrowUpRight size={18} aria-hidden="true" /></Link></div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
