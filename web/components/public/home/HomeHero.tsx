import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import { HOME_PRODUCTS } from "./content";
import { MarketingImage } from "./MarketingImage";
import { ProductDemo } from "./ProductDemo";

export function HomeHero({ startHref }: { startHref: string }) {
  return (
    <section className="vh-hero" aria-labelledby="home-title">
      <div className="vh-hero-orbit" aria-hidden="true" />
      <div className="vh-container vh-hero-grid">
        <div className="vh-hero-copy">
          <p className="vh-pill">
            <Sparkles size={13} aria-hidden="true" /> Ecossistema comercial
            inteligente
          </p>
          <h1 id="home-title">
            O sistema operacional comercial para empresas que{" "}
            <span>vendem por conversa.</span>
          </h1>
          <p className="vh-hero-lead">
            Atendimento, CRM, propostas, reuniões, marketing e site. Uma
            operação inteira, com tudo conectado.
          </p>
          <div className="vh-actions">
            <Link href={startHref} className="vh-button vh-button-primary">
              Conhecer o Vorix <ArrowRight size={17} />
            </Link>
            <ProductDemo />
          </div>
          <p className="vh-hero-note">
            <Check size={14} /> Uma conta. Um histórico. O próximo passo sempre
            à mão.
          </p>
        </div>
        <div className="vh-hero-visual">
          <div className="vh-product-glow" aria-hidden="true" />
          <div className="vh-browser vh-hero-browser">
            <div className="vh-browser-bar">
              <span className="vh-window-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                <span className="vh-browser-lock" aria-hidden="true" />
                Sua operação no Vorix
              </span>
              <span className="vh-browser-live">
                <i />
                Conectado
              </span>
            </div>
            <MarketingImage
              asset="hero/command-center"
              alt="Dashboard real do Vorix, com atendimento e operação comercial no mesmo painel e dados demonstrativos"
              width={1440}
              height={960}
              priority
              sizes="(max-width: 767px) 94vw, (max-width: 1100px) 64vw, 850px"
            />
          </div>
          <div className="vh-float vh-float-conversation">
            <span className="vh-product-icon conversations">
              <MessageCircle size={20} />
            </span>
            <span>
              <small>Do primeiro contato</small>
              <strong>O cliente chama. O contexto fica.</strong>
            </span>
            <Check size={15} />
          </div>
          <div className="vh-float vh-float-flow">
            <BarChart3 size={19} />
            <span>
              Atendimento <ArrowRight size={11} /> proposta{" "}
              <ArrowRight size={11} /> venda
            </span>
          </div>
          <p className="vh-shot-caption">
            Interface real do Vorix · dados demonstrativos
          </p>
        </div>
      </div>
      <div
        className="vh-container vh-product-rail"
        aria-label="Quatro produtos do ecossistema"
      >
        {HOME_PRODUCTS.map(({ key, short, Icon }) => (
          <a key={key} href={`#${key === "conversations" ? "conversas" : key}`}>
            <span className={`vh-product-icon ${key}`}>
              <Icon size={23} />
            </span>
            <span>
              <strong>{short}</strong>
              <small>
                {key === "conversations"
                  ? "Atendimento, CRM e propostas"
                  : key === "meetings"
                    ? "Reuniões, transcrição e IA"
                    : key === "marketing"
                      ? "Conteúdo, calendário e publicações"
                      : "Site, catálogo e operação de vendas"}
              </small>
            </span>
            <ArrowUpRight size={14} />
          </a>
        ))}
      </div>
    </section>
  );
}
