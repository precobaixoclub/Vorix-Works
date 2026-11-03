import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Check,
  CheckCheck,
  CircleCheck,
  Headphones,
  Layers3,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Video,
  Workflow,
  X,
} from "lucide-react";
import {
  AUTOMATIONS,
  CAPABILITIES,
  DEMO_CONTACT,
  HOME_PRODUCTS,
  JOURNEY,
} from "./content";
import { MarketingImage } from "./MarketingImage";
import { ProductDemo } from "./ProductDemo";

export function ConnectedIntro() {
  const items = [
    {
      Icon: MessageCircle,
      title: "Venda por conversa",
      text: "Atenda, qualifique e negocie com o histórico do cliente sempre por perto.",
    },
    {
      Icon: Layers3,
      title: "Operação integrada",
      text: "Atendimento, oportunidades, propostas e produtos funcionando juntos.",
    },
    {
      Icon: Sparkles,
      title: "Produtividade com IA",
      text: "Resumos de reuniões e apoio à criação para reduzir o trabalho repetitivo.",
    },
    {
      Icon: Workflow,
      title: "Controle para crescer",
      text: "Equipes, permissões, atividades e indicadores para acompanhar o processo.",
    },
  ];
  return (
    <section id="plataforma" className="vh-section vh-light vh-intro">
      <div className="vh-container">
        <div className="vh-section-split">
          <h2>
            Tudo conectado.
            <br />
            <span>Sem trocar de sistema.</span>
          </h2>
          <p>
            Uma conversa inicia a relação. O Vorix mantém atendimento,
            negociação e próximos passos no mesmo contexto, até a conclusão da
            venda.
          </p>
        </div>
        <div className="vh-benefit-grid">
          {items.map(({ Icon, title, text }) => (
            <article key={title}>
              <span className="vh-soft-icon">
                <Icon size={26} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function EcosystemShowcase() {
  return (
    <section id="produtos" className="vh-section vh-dark vh-ecosystem">
      <div className="vh-container">
        <div className="vh-section-heading">
          <p className="vh-eyebrow">Conheça o ecossistema</p>
          <h2>
            Quatro produtos. <span>Um só Vorix.</span>
          </h2>
          <p>
            Escolha por onde começar. Mantenha o contexto quando a sua operação
            crescer.
          </p>
        </div>
        <div className="vh-product-grid">
          {HOME_PRODUCTS.map(
            ({
              key,
              name,
              eyebrow,
              description,
              image,
              Icon,
              href,
              features,
              status,
            }) => (
              <article
                key={key}
                id={key === "conversations" ? "conversas" : key}
                className={`vh-product-card ${key}`}
              >
                <div className="vh-product-card-image">
                  <MarketingImage
                    asset={image}
                    alt={`Tela real do ${name} com dados demonstrativos`}
                    sizes="(max-width: 600px) 88vw, (max-width: 1000px) 45vw, 300px"
                  />
                  <span className={`vh-product-icon ${key}`}>
                    <Icon size={24} />
                  </span>
                </div>
                <div className="vh-product-card-copy">
                  <small>{eyebrow}</small>
                  <h3>{name}</h3>
                  <p>{description}</p>
                  <ul>
                    {features.map((feature) => (
                      <li key={feature}>
                        <Check size={12} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <div className="vh-product-status">{status}</div>
                  {key === "marketing" ? (
                    <ProductDemo
                      initial="marketing"
                      label="Conhecer Marketing"
                      className="vh-card-link"
                    />
                  ) : (
                    <Link href={href} className="vh-card-link">
                      Conhecer{" "}
                      {key === "site"
                        ? "Sites & Commerce"
                        : name.replace("Vorix ", "")}{" "}
                      <ArrowRight size={16} />
                    </Link>
                  )}
                </div>
              </article>
            ),
          )}
        </div>
        <p className="vh-section-footnote">
          Interfaces reais com dados demonstrativos. Recursos e acesso variam
          conforme o plano e a disponibilidade de cada integração.
        </p>
      </div>
    </section>
  );
}

export function WorkflowTimeline() {
  return (
    <section id="como-funciona" className="vh-section vh-light vh-workflow">
      <div className="vh-container">
        <div className="vh-section-heading">
          <p className="vh-eyebrow">O caminho inteiro, conectado</p>
          <h2>
            Da mensagem à venda,
            <br className="vh-mobile-break" /> o Vorix{" "}
            <span>organiza tudo.</span>
          </h2>
          <p>
            O atendimento abre a conversa. O processo comercial continua até o
            fechamento.
          </p>
        </div>
        <ol className="vh-journey">
          {JOURNEY.map(({ title, detail, Icon, example }, index) => (
            <li key={title}>
              <span className="vh-step-index">0{index + 1}</span>
              <span className={`vh-journey-icon step-${index}`}>
                <Icon size={23} />
              </span>
              <h3>{title}</h3>
              <p>{detail}</p>
              <small>{example}</small>
              {index < 7 ? (
                <ArrowRight
                  className="vh-journey-arrow"
                  size={18}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          ))}
        </ol>
        <p className="vh-workflow-note">
          <ShieldCheck size={15} /> O faturamento organiza a conferência
          comercial da venda. Não implica emissão automática de nota fiscal.
        </p>
      </div>
    </section>
  );
}

export function UnifiedContext() {
  const fragments = [
    "WhatsApp separado",
    "Planilha de contatos",
    "CRM sem histórico",
    "Reuniões em outro lugar",
    "Site e pedidos isolados",
  ];
  return (
    <section id="contexto" className="vh-section vh-light vh-context">
      <div className="vh-container vh-context-layout">
        <div className="vh-context-copy">
          <p className="vh-eyebrow">Contexto que acompanha o cliente</p>
          <h2>
            Um cliente.
            <br />
            Um histórico.
            <br />
            <span>Uma operação.</span>
          </h2>
          <p>
            Chega de reconstruir o que aconteceu. Conversas, propostas, produtos
            e decisões ficam ligados à relação comercial.
          </p>
          <div className="vh-context-comparison">
            <div>
              <small>Informação espalhada</small>
              {fragments.map((text) => (
                <span key={text}>
                  <X size={12} />
                  {text}
                </span>
              ))}
            </div>
            <div>
              <small>No mesmo ecossistema</small>
              {[
                "Uma conta e equipe",
                "Histórico acessível",
                "Próximo passo visível",
                "Reuniões organizadas",
                "Jornada rastreável",
              ].map((text) => (
                <span key={text}>
                  <Check size={13} />
                  {text}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="vh-context-visual">
          <div className="vh-context-orbits" aria-hidden="true" />
          <div className="vh-context-person">
            <span>
              <UsersRound size={30} />
            </span>
            <strong>Seu cliente</strong>
            <small>O contexto no centro.</small>
          </div>
          {[
            { label: "Conversas", Icon: MessageCircle },
            { label: "Atendimentos", Icon: Headphones },
            { label: "Reuniões", Icon: Video },
            { label: "Oportunidades", Icon: Layers3 },
            { label: "Propostas", Icon: BookOpenCheck },
            { label: "Produtos e pedidos", Icon: CheckCheck },
          ].map(({ label, Icon }, index) => (
            <div key={label} className={`vh-context-node node-${index}`}>
              <Icon size={18} />
              <span>{label}</span>
            </div>
          ))}
          <p>
            Menos informação perdida.
            <br />
            <strong>Mais clareza para agir.</strong>
          </p>
        </div>
      </div>
    </section>
  );
}

export function PeopleSection() {
  return (
    <section id="equipes" className="vh-section vh-light vh-people">
      <div className="vh-container vh-people-layout">
        <div className="vh-photo-collage">
          <MarketingImage
            asset="people/atendimento"
            photo
            alt="Profissional trabalhando em um notebook em ambiente de escritório"
            width={800}
            height={1200}
            sizes="(max-width: 767px) 60vw, 340px"
          />
          <MarketingImage
            asset="people/reuniao"
            photo
            alt="Profissional com headset trabalhando no notebook"
            width={800}
            height={533}
            sizes="(max-width: 767px) 35vw, 290px"
          />
          <MarketingImage
            asset="people/equipe"
            photo
            alt="Equipe colaborando em torno de um notebook"
            width={800}
            height={533}
            sizes="(max-width: 767px) 35vw, 290px"
          />
          <span className="vh-photo-caption">
            Tecnologia a serviço de quem faz acontecer.
          </span>
        </div>
        <div className="vh-people-copy">
          <p className="vh-eyebrow">Venda por conversa</p>
          <h2>
            Seu cliente chama.
            <br />
            Sua equipe atende.
            <br />
            <span>O Vorix organiza o resto.</span>
          </h2>
          <p>
            Feito para equipes comerciais modernas, que precisam vender com
            consistência e acompanhar cada cliente com atenção.
          </p>
          <ul>
            {[
              [
                "Produtividade",
                "menos tarefas repetidas, mais tempo para atender.",
              ],
              ["Organização", "o contexto do cliente no mesmo lugar."],
              ["Histórico", "conversas, propostas e decisões acessíveis."],
              ["Rastreabilidade", "cada etapa da negociação acompanhada."],
              ["Visão gerencial", "indicadores para decidir com clareza."],
            ].map(([title, text]) => (
              <li key={title}>
                <CircleCheck size={17} />
                <span>
                  <strong>{title}</strong> — {text}
                </span>
              </li>
            ))}
          </ul>
          <Link href={DEMO_CONTACT} className="vh-text-link">
            Conhecer o Vorix com nosso time <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function FeaturesSection() {
  return (
    <section id="recursos" className="vh-section vh-light vh-features">
      <div className="vh-container">
        <div className="vh-section-heading">
          <p className="vh-eyebrow">Ferramentas que trabalham juntas</p>
          <h2>
            Recursos que fazem diferença <span>na prática.</span>
          </h2>
          <p>
            Uma base comum de usuários, equipes, permissões e espaços de
            trabalho.
          </p>
        </div>
        <div className="vh-feature-grid">
          {CAPABILITIES.map(({ Icon, title, text }) => (
            <article key={title}>
              <span className="vh-soft-icon">
                <Icon size={23} />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="vh-automation">
          <div>
            <p className="vh-eyebrow">Inteligência e automação</p>
            <h3>
              Menos trabalho manual.
              <br />
              <span>Mais contexto.</span>
            </h3>
          </div>
          {AUTOMATIONS.map(({ Icon, title, text }) => (
            <article key={title}>
              <Icon size={23} />
              <h4>{title}</h4>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AnalyticsShowcase() {
  return (
    <section id="indicadores" className="vh-section vh-dark vh-analytics">
      <div className="vh-container vh-analytics-layout">
        <div>
          <p className="vh-eyebrow">Visão gerencial</p>
          <h2>
            Gestão com clareza.
            <br />
            <span>Decisões com contexto.</span>
          </h2>
          <p>
            Entenda o atendimento, o funil e as vendas sem depender de
            informações espalhadas.
          </p>
          <ul>
            {[
              "Acompanhe os indicadores por período",
              "Enxergue oportunidades e resultados",
              "Revise o andamento com sua equipe",
            ].map((text) => (
              <li key={text}>
                <Check size={15} />
                {text}
              </li>
            ))}
          </ul>
          <ProductDemo initial="conversations" label="Explorar as telas" />
        </div>
        <div className="vh-analytics-screen">
          <div className="vh-browser">
            <div className="vh-browser-bar">
              <span className="vh-window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>Resultados da operação</span>
              <span>Vorix</span>
            </div>
            <MarketingImage
              asset="analytics/dashboard"
              alt="Dashboard real de indicadores do Vorix, com dados demonstrativos e filtros de período"
              sizes="(max-width: 767px) 92vw, 800px"
            />
          </div>
          <p className="vh-shot-caption">
            Captura real · indicadores de demonstração, não resultados de
            clientes.
          </p>
        </div>
      </div>
    </section>
  );
}
