import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { ComplementSection, FAQSection, FinalCTA, Hero, PlatformSection, ProblemSection, ProductsSection } from "@/components/public/LandingSections";
import { PricingSection } from "@/components/public/PricingSection";
import { TrackPageView } from "@/components/TrackPageView";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";

export const revalidate = 300;
export const metadata = publicMetadata("Vorix — Conversas e Meetings para sua operação", "Atendimento, vendas e inteligência de reuniões em uma plataforma. Conheça Vorix Conversas e Vorix Meetings, duas soluções independentes sobre o mesmo Core.", "/");

export default async function RootPage() {
  const catalog = await getPublicProductCatalog();
  const startHref = catalog.products[0].cta.href;
  return <div className="public-site"><TrackPageView eventName="landing_view" /><PublicHeader startHref={startHref} />
    <main id="conteudo">
      {/* Narrativa: problema → plataforma → Conversas → Meetings → juntos → planos → CTA. */}
      <Hero startHref={startHref} /><ProblemSection /><PlatformSection /><ProductsSection products={catalog.products} /><ComplementSection /><PricingSection catalog={catalog} /><FAQSection /><FinalCTA startHref={startHref} />
    </main>
    <PublicFooter />
  </div>;
}
