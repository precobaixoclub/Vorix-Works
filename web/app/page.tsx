import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { HomeHero } from "@/components/public/home/HomeHero";
import {
  AnalyticsShowcase,
  ConnectedIntro,
  EcosystemShowcase,
  FeaturesSection,
  PeopleSection,
  UnifiedContext,
  WorkflowTimeline,
} from "@/components/public/home/EcosystemSections";
import {
  HomeFAQ,
  HomeFinalCTA,
  HomePricing,
  IntegrationStrip,
  UseCases,
} from "@/components/public/home/CommercialSections";
import { TrackPageView } from "@/components/TrackPageView";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
import "./home.css";

export const dynamic = "force-dynamic";
export const metadata = {
  ...publicMetadata(
    "Vorix | Da conversa à venda. Tudo conectado.",
    "O sistema operacional comercial para empresas que vendem por conversa. Atendimento, CRM, propostas, reuniões, marketing, site e vendas no mesmo ecossistema.",
    "/",
  ),
  openGraph: {
    ...publicMetadata(
      "Vorix | Da conversa à venda. Tudo conectado.",
      "Atendimento, CRM, reuniões, marketing e Sites & Commerce em um único ecossistema.",
      "/",
    ).openGraph,
    images: [
      {
        url: "/marketing/home/hero/social-card.webp",
        width: 1200,
        height: 630,
        alt: "Vorix — Da conversa à venda. Tudo conectado.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Vorix | Da conversa à venda. Tudo conectado.",
    description:
      "O sistema operacional comercial para empresas que vendem por conversa.",
    images: ["/marketing/home/hero/social-card.webp"],
  },
};

export default async function RootPage() {
  const catalog = await getPublicProductCatalog();
  const startHref =
    catalog.products.find((product) => product.key === "conversations")?.cta
      .href ?? "/precos";
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://vorixworks.com/#organization",
        name: "Vorix",
        url: "https://vorixworks.com",
        email: "comercial@vorixworks.com",
      },
      {
        "@type": "WebSite",
        "@id": "https://vorixworks.com/#website",
        url: "https://vorixworks.com",
        name: "Vorix",
        inLanguage: "pt-BR",
        publisher: { "@id": "https://vorixworks.com/#organization" },
      },
    ],
  };
  return (
    <div className="public-site vorix-home">
      <TrackPageView eventName="landing_view" />
      <PublicHeader startHref={startHref} appearance="home" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <main id="conteudo">
        <HomeHero startHref={startHref} />
        <ConnectedIntro />
        <EcosystemShowcase />
        <WorkflowTimeline />
        <UnifiedContext />
        <PeopleSection />
        <FeaturesSection />
        <AnalyticsShowcase />
        <UseCases />
        <IntegrationStrip />
        <HomePricing catalog={catalog} />
        <HomeFAQ />
        <HomeFinalCTA startHref={startHref} />
      </main>
      <PublicFooter appearance="home" />
    </div>
  );
}
