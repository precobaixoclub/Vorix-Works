import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { CommercialFAQ, CommercialFinalCTA, CommercialFlow, CommercialHero, CommercialIntelligence, CommercialModules, CommercialPricing, CommercialTeamBenefits } from "@/components/public/CommercialShowcase";
import { TrackPageView } from "@/components/TrackPageView";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
import "./commercial.css";

export const dynamic = "force-dynamic";
export const metadata = publicMetadata(
  "Vorix | Sua empresa conectada, do primeiro contato ao resultado",
  "Atendimento, vendas, marketing, sites e reuniões na mesma plataforma. Conheça as ferramentas e configure o plano para sua equipe.",
  "/",
);

const questions = [
  ["Preciso contratar as quatro ferramentas?", "Você pode começar por um módulo. A combinação e os adicionais são confirmados conforme a oferta e a capacidade da conta."],
  ["Como vejo o preço para minha equipe?", "No simulador, escolha o plano de Conversas, a quantidade total de usuários e os WhatsApps necessários. Para Meetings, ajuste as gravações simultâneas."],
  ["Posso ampliar a operação depois?", "Consulte os módulos e a capacidade em Conta e assinatura. Um ajuste só é enviado quando você revisa e confirma a alteração."],
  ["Quais integrações posso usar?", "A conexão de WhatsApp, redes sociais, gravação Google, pagamentos, frete e marketplaces segue a configuração e a liberação de cada conta."],
] as const;

export default async function RootPage() {
  const catalog = await getPublicProductCatalog();
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": "https://vorixworks.com/#organization", name: "Vorix", url: "https://vorixworks.com", email: "comercial@vorixworks.com" },
      { "@type": "WebSite", "@id": "https://vorixworks.com/#website", url: "https://vorixworks.com", name: "Vorix", inLanguage: "pt-BR", publisher: { "@id": "https://vorixworks.com/#organization" } },
    ],
  };
  return <div className="public-site vorix-commercial">
    <TrackPageView eventName="landing_view" />
    <PublicHeader startHref="/precos#monte" appearance="home" />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    <main id="conteudo">
      <CommercialHero />
      <CommercialModules />
      <CommercialFlow />
      <CommercialTeamBenefits />
      <CommercialIntelligence />
      <CommercialPricing catalog={catalog} />
      <CommercialFAQ entries={questions} />
      <CommercialFinalCTA />
    </main>
    <PublicFooter />
  </div>;
}
