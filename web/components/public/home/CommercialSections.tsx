import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Camera,
  Car,
  Check,
  ChevronDown,
  CreditCard,
  Headphones,
  House,
  Layers3,
  MessageCircle,
  Music2,
  Package,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Video,
} from "lucide-react";
import {
  formatPublicPrice,
  PUBLIC_CONTACT,
  type PublicProductCatalog,
} from "@/features/public-site/catalog";
import { homeOffers } from "@/features/public-site/home";
import { DEMO_CONTACT } from "./content";

const INTEGRATIONS = [
  {
    name: "WhatsApp",
    detail: "Atendimento conectado",
    status: "Disponível",
    Icon: MessageCircle,
    tone: "green",
  },
  {
    name: "Instagram e Facebook",
    detail: "Publicações e canais Meta",
    status: "Em homologação",
    Icon: Camera,
    tone: "purple",
  },
  {
    name: "TikTok",
    detail: "Publicação social",
    status: "Em homologação",
    Icon: Music2,
    tone: "purple",
  },
  {
    name: "Mercado Pago",
    detail: "Pagamentos reais",
    status: "Em homologação",
    Icon: CreditCard,
    tone: "blue",
  },
  {
    name: "Melhor Envio",
    detail: "Cotação de frete",
    status: "Em homologação",
    Icon: Truck,
    tone: "blue",
  },
  {
    name: "Marketplaces",
    detail: "Mercado Livre · Shopee · TikTok Shop",
    status: "Beta · acesso controlado",
    Icon: ShoppingBag,
    tone: "orange",
  },
];
export function IntegrationStrip() {
  return (
    <section id="integracoes" className="vh-section vh-light vh-integrations">
      <div className="vh-container">
        <div className="vh-section-heading">
          <p className="vh-eyebrow">Uma operação, vários pontos de contato</p>
          <h2>
            Conecte o que faz parte <span>do seu dia.</span>
          </h2>
          <p>
            Disponibilidade clara, sem prometer uma integração antes da hora.
          </p>
        </div>
        <div className="vh-integration-grid">
          {INTEGRATIONS.map(({ name, detail, status, Icon, tone }) => (
            <article key={name}>
              <span className={`vh-integration-icon ${tone}`}>
                <Icon size={23} />
              </span>
              <h3>{name}</h3>
              <p>{detail}</p>
              <span className={`vh-integration-status ${tone}`}>{status}</span>
            </article>
          ))}
        </div>
        <p className="vh-section-footnote">
          Instagram Direct: texto sujeito à configuração do canal. Publicações
          sociais, pagamento, frete e marketplaces dependem de homologação e
          liberação de acesso.
        </p>
      </div>
    </section>
  );
}

export function UseCases() {
  const cases = [
    { name: "Vendas por WhatsApp", Icon: MessageCircle },
    { name: "Equipe comercial", Icon: UsersIcon },
    { name: "Serviços", Icon: Headphones },
    { name: "Varejo", Icon: Store },
    { name: "E-commerce", Icon: ShoppingCart },
    { name: "Imobiliário", Icon: House },
    { name: "Automotivo", Icon: Car },
    { name: "Distribuição e B2B", Icon: Package },
  ];
  return (
    <section id="solucoes" className="vh-section vh-light vh-usecases">
      <div className="vh-container">
        <div>
          <p className="vh-eyebrow">Seu jeito de vender, mais organizado</p>
          <h2>
            Para operações diferentes.
            <br />
            <span>Com o mesmo cuidado pelo cliente.</span>
          </h2>
        </div>
        <ul>
          {cases.map(({ name, Icon }) => (
            <li key={name}>
              <Icon size={18} />
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
const UsersIcon = Building2;

export function HomePricing({ catalog }: { catalog: PublicProductCatalog }) {
  const offers = homeOffers(catalog),
    conversations = offers.conversations,
    meetings = offers.meetings;
  const cards = [
    {
      key: "conversations",
      name: "Conversas",
      Icon: MessageCircle,
      description: "Atendimento, CRM, oportunidades e propostas.",
      price: offers.conversationsPrice,
      currency: conversations?.currency ?? "BRL",
      detail:
        offers.conversationsPrice !== null
          ? "Plano de entrada · cobrança mensal"
          : "Condições conforme o plano disponível",
      features: conversations?.plan
        ? [
            `${conversations.plan.includedUsers ?? "Usuários conforme plano"} usuários e ${conversations.plan.includedWhatsappConnections ?? "conexões conforme plano"} WhatsApp incluídos`,
            "Capacidade ajustável para sua equipe",
          ]
        : ["Atendimento e operação comercial", "Capacidade conforme o plano"],
      label: conversations?.contractable
        ? "Começar com Conversas"
        : "Consultar condições",
      href: conversations?.cta.href ?? PUBLIC_CONTACT,
    },
    {
      key: "meetings",
      name: "Meetings",
      Icon: Video,
      description: "Gravação, transcrição e inteligência de reuniões.",
      price: offers.meetingsPrice,
      currency: meetings?.currency ?? "BRL",
      detail: "Capacidade de gravação · plano da conta à parte",
      features: [
        "Gravações simultâneas configuráveis",
        "Conexão Google sujeita à homologação",
      ],
      label: "Configurar Meetings",
      href: "/precos#monte",
    },
    {
      key: "site",
      name: "Sites & Commerce",
      Icon: ShoppingCart,
      description: "Site, catálogo e operação de vendas conectada.",
      price: null,
      currency: "BRL",
      detail: "Acesso por plano ou adicional",
      features: [
        "Produtos, variações e estoque",
        "Pagamentos e frete em homologação",
      ],
      label: "Conhecer as condições",
      href: "/precos#vorix-site",
    },
    {
      key: "suite",
      name: "Seu ecossistema Vorix",
      Icon: Layers3,
      description: "Uma configuração pensada para a sua operação.",
      price: null,
      currency: "BRL",
      detail: "Produtos e capacidade conforme a proposta",
      features: [
        "Escolha os produtos de que precisa",
        "Acesso ao Marketing sob consulta",
      ],
      label: "Falar sobre minha equipe",
      href: DEMO_CONTACT,
    },
  ];
  return (
    <section id="precos" className="vh-section vh-light vh-pricing">
      <div className="vh-container">
        <div className="vh-section-heading">
          <p className="vh-eyebrow">Comece do seu jeito</p>
          <h2>
            O plano ideal para <span>o seu momento.</span>
          </h2>
          <p>
            Capacidade flexível. Valores conectados ao catálogo oficial de
            contratação.
          </p>
        </div>
        <div className="vh-pricing-grid">
          {cards.map(
            ({
              key,
              name,
              Icon,
              description,
              price,
              currency,
              detail,
              features,
              label,
              href,
            }) => (
              <article key={key} className={`vh-pricing-card ${key}`}>
                <div className="vh-price-heading">
                  <span className={`vh-product-icon ${key}`}>
                    <Icon size={21} />
                  </span>
                  <h3>{name}</h3>
                </div>
                <p>{description}</p>
                <div className="vh-price-value">
                  {price !== null ? (
                    <>
                      <small>
                        {key === "meetings"
                          ? "Gravações a partir de"
                          : "A partir de"}
                      </small>
                      <strong>
                        {formatPublicPrice({ currency, monthlyPrice: price })}
                        <span>/mês</span>
                      </strong>
                    </>
                  ) : (
                    <>
                      <small>Condições comerciais</small>
                      <strong>Sob consulta</strong>
                    </>
                  )}
                  <p>{detail}</p>
                </div>
                <ul>
                  {features.map((feature) => (
                    <li key={feature}>
                      <Check size={13} />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href={href}
                  className={`vh-button ${key === "suite" ? "vh-button-primary" : "vh-button-light"}`}
                >
                  {label}
                  <ArrowRight size={15} />
                </Link>
              </article>
            ),
          )}
        </div>
        <p className="vh-pricing-footnote">
          Meetings: o valor de gravações é adicional ao plano base da conta.
          Créditos de IA, capacidade e recursos variam conforme a contratação.
          {offers.trialDays
            ? ` O plano de Conversas oferece ${offers.trialDays} dias de teste, conforme as condições da contratação.`
            : ""}
        </p>
        <Link className="vh-text-link" href="/precos">
          Comparar planos e ajustar capacidade <ArrowUpRight size={16} />
        </Link>
      </div>
    </section>
  );
}

const FAQ = [
  [
    "Preciso contratar os quatro produtos?",
    "Não. Você pode começar com o produto de que precisa e ampliar o acesso na mesma conta, conforme a disponibilidade comercial. O Marketing tem acesso sob consulta; integrações externas podem exigir homologação.",
  ],
  [
    "O que fica conectado entre atendimento e vendas?",
    "Contatos, conversas, oportunidades, produtos e propostas acompanham a negociação. A equipe mantém o histórico e os próximos passos no workspace em que trabalha.",
  ],
  [
    "O que significa faturamento na jornada?",
    "É a conferência e o registro comercial da proposta aceita antes de concluir a venda. Isso não inclui emissão automática de nota fiscal nem transforma o aceite em pagamento confirmado.",
  ],
  [
    "Posso vender produtos pelo site?",
    "O Site reúne vitrine, catálogo, variações e oportunidades geradas pelo interesse nos produtos. A operação de carrinho e pedidos faz parte do mesmo produto; pagamentos reais, frete e marketplaces dependem de homologação e liberação.",
  ],
  [
    "Como funcionam as reuniões e a IA?",
    "O Meetings organiza gravações, transcrições, resumos e decisões. A gravação Google depende da conexão das contas e da homologação; a capacidade simultânea e o consumo de IA seguem a contratação.",
  ],
  [
    "Como conhecer o Vorix para minha empresa?",
    "Explore as telas demonstrativas nesta página, consulte os planos ou entre em contato com o time comercial para conversar sobre os produtos e a capacidade de que sua equipe precisa.",
  ],
];
export function HomeFAQ() {
  return (
    <section id="faq" className="vh-section vh-light vh-faq">
      <div className="vh-container">
        <div>
          <p className="vh-eyebrow">Antes do próximo passo</p>
          <h2>
            Clareza desde
            <br />
            <span>a primeira conversa.</span>
          </h2>
          <a href={PUBLIC_CONTACT} className="vh-text-link">
            Falar com o time <ArrowUpRight size={16} />
          </a>
        </div>
        <div>
          {FAQ.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <ChevronDown size={17} />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomeFinalCTA({ startHref }: { startHref: string }) {
  return (
    <section id="contato" className="vh-final">
      <div className="vh-container">
        <div>
          <p className="vh-eyebrow">Da conversa à venda. Tudo conectado.</p>
          <h2>
            Transforme sua operação
            <br />
            comercial <span>com o Vorix.</span>
          </h2>
        </div>
        <div>
          <p>
            Centralize atendimento, vendas, reuniões, conteúdo e presença
            digital em um único ecossistema.
          </p>
          <div className="vh-actions">
            <a href={DEMO_CONTACT} className="vh-button vh-button-primary">
              Agendar demonstração <ArrowUpRight size={17} />
            </a>
            <Link href={startHref} className="vh-button vh-button-outline">
              Conhecer o Vorix <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
