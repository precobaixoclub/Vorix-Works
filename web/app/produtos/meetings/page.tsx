import { PublicProductPage } from "@/components/public/PublicProductPage";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
export const dynamic = "force-dynamic";
export const metadata = publicMetadata("Vorix Meetings — Inteligência para suas reuniões", "Conheça a solução Vorix para agenda, gravação, transcrição, resumos e próximos passos. Conheça os planos e ajuste a capacidade de gravações simultâneas.", "/produtos/meetings");
export default async function Page() {
  const catalog = await getPublicProductCatalog();
  return <PublicProductPage startHref={catalog.products[0].cta.href} product={catalog.products.find(product => product.key === "meetings")!} />;
}
