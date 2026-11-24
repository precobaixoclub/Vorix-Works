import { CommercialProduct } from "@/components/public/CommercialShowcase";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
import "../../commercial.css";

export const dynamic = "force-dynamic";
export const metadata = publicMetadata("Vorix Marketing | Criação de conteúdo com IA", "Organize pautas, crie artes e legendas com IA e revise peças no calendário editorial.", "/produtos/marketing");

export default async function Page() {
  return <CommercialProduct moduleKey="marketing" catalog={await getPublicProductCatalog()} />;
}
