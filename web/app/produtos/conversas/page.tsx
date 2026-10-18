import { PublicProductPage } from "@/components/public/PublicProductPage";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
export const dynamic = "force-dynamic";
export const metadata = publicMetadata("Vorix Conversas — Atendimento que vira oportunidade", "WhatsApp, contatos, oportunidades, propostas e automações conectados para sua equipe atender e vender com contexto.", "/produtos/conversas");
export default async function Page() {
  const catalog = await getPublicProductCatalog();
  return <PublicProductPage startHref={catalog.products[0].cta.href} product={catalog.products.find(product => product.key === "conversations")!} />;
}
