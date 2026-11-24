import { CommercialProduct } from "@/components/public/CommercialShowcase";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
import "../../commercial.css";

export const dynamic = "force-dynamic";
export const metadata = publicMetadata("Vorix Site | Editor visual, catálogo e loja", "Crie um site profissional, personalize o modelo, organize o catálogo e configure a venda.", "/produtos/site");

export default async function Page() {
  return <CommercialProduct moduleKey="site" catalog={await getPublicProductCatalog()} />;
}
