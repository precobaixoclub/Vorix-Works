import Link from "next/link";
import { ArrowUpRight, Check, Megaphone } from "lucide-react";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PUBLIC_CONTACT } from "@/features/public-site/catalog";
import { publicMetadata } from "@/features/public-site/metadata";

export const metadata = publicMetadata(
  "Vorix Marketing — Ideias, conteúdo e publicação",
  "Ideias, criação de conteúdo com IA, identidade visual e calendário de publicações nas redes da sua empresa, no mesmo lugar do atendimento e das vendas.",
  "/produtos/marketing",
);

/**
 * Página pública do Vorix Marketing (Fase 13). Só descreve o que o produto JÁ faz dentro da Vorix
 * (Bolsão de ideias, Criar conteúdo, Revisão, Calendário, Marca e identidade, Redes sociais e
 * Anúncios). Não há preço self-service no catálogo oficial: a contratação é pelo time comercial.
 */
const STEPS = [
  ["Ideias", "O Bolsão de ideias guarda as pautas da empresa — suas e sugeridas pela IA — prontas para virar conteúdo."],
  ["Criação", "A IA escreve a legenda e cria a arte seguindo a Marca e identidade cadastrada: cores, tom de voz e logotipo."],
  ["Revisão", "Cada conteúdo passa por revisão antes de sair. Você ajusta, aprova ou pede outra versão."],
  ["Publicação", "Agende no Calendário e acompanhe o que foi publicado, o que está agendado e o que falhou."],
] as const;

const FEATURES = [
  "Bolsão de ideias para as pautas da empresa",
  "Criação de texto e arte com IA, guiada pela identidade da marca",
  "Revisão e aprovação antes de publicar",
  "Calendário único de publicações",
  "Publicação no Instagram e no Facebook",
  "Conexão de anúncios da Meta dentro de Anúncios",
  "Indicadores de produção e publicação",
] as const;

export default function MarketingProductPage() {
  return (
    <div className="public-site">
      <PublicHeader />
      <main id="conteudo">
        <section className="public-page-hero">
          <div className="public-container">
            <div>
              <span className="public-eyebrow-pill"><Megaphone size={16} aria-hidden="true" /> Vorix Marketing</span>
              <h1>Da ideia à publicação, com a cara da sua marca.</h1>
              <p className="public-section-copy">Organize as pautas, crie conteúdo com IA a partir da identidade da empresa, revise e agende as publicações — no mesmo lugar onde sua equipe atende e vende.</p>
              <div className="public-button-row">
                <a href={PUBLIC_CONTACT} className="public-button primary">Falar com o time <ArrowUpRight size={18} aria-hidden="true" /></a>
                <Link href="/precos" className="public-button secondary">Ver planos</Link>
              </div>
            </div>
            <ul className="public-product-feature-list">
              {FEATURES.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}
            </ul>
          </div>
        </section>

        <section className="public-section public-how">
          <div className="public-container">
            <h2>Como funciona na prática</h2>
            <ol className="public-marketing-steps">
              {STEPS.map(([title, text], index) => (
                <li key={title}>
                  <span className="public-eyebrow">{String(index + 1).padStart(2, "0")} · {title}</span>
                  <p className="public-section-copy">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="public-section public-how">
          <div className="public-container">
            <h2>Para quem é</h2>
            <p className="public-section-copy">Para empresas que precisam manter as redes ativas sem montar uma equipe de criação, e que querem o conteúdo conversando com o atendimento e as vendas da mesma conta Vorix.</p>
            <h2>Disponibilidade</h2>
            <p className="public-section-copy">A publicação no Instagram e no Facebook usa a integração oficial da Meta. TikTok e YouTube dependem da aprovação de cada plataforma e são liberados conforme a homologação. A contratação do Vorix Marketing é feita com o nosso time comercial.</p>
            <div className="public-button-row">
              <a href={PUBLIC_CONTACT} className="public-button primary">Consultar condições <ArrowUpRight size={18} aria-hidden="true" /></a>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
