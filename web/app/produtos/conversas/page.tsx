import { CommercialProduct } from "@/components/public/CommercialShowcase";
import { getPublicProductCatalog } from "@/features/public-site/server";
import { publicMetadata } from "@/features/public-site/metadata";
import "../../commercial.css";

export const dynamic = "force-dynamic";
export const metadata = publicMetadata("Vorix Conversas | Atendimento, CRM e propostas", "WhatsApp, oportunidades e propostas comerciais em um fluxo compartilhado.", "/produtos/conversas");

export default async function Page() {
  return <CommercialProduct moduleKey="conversations" catalog={await getPublicProductCatalog()} />;
}
