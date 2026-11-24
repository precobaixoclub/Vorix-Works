import { CommercialProduct } from "@/components/public/CommercialShowcase";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
import "../../commercial.css";

export const dynamic = "force-dynamic";
export const metadata = publicMetadata("Vorix Meetings | Gravação, transcrição e análise com IA", "Conheça as opções de gravação, transcrição, resumos e próximos passos da Vorix.", "/produtos/meetings");

export default async function Page() {
  return <CommercialProduct moduleKey="meetings" catalog={await getPublicProductCatalog()} />;
}
