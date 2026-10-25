import type { Metadata } from "next";

const title = "Sua proposta comercial";
const description = "Confira os itens, valores e condições da sua proposta e responda quando estiver pronto.";

// Link previews do not fetch the proposal API or count as a customer opening the document.
export const metadata: Metadata = {
  title: `${title} · Vorix`,
  description,
  robots: { index: false, follow: false },
  openGraph: { title, description, siteName: "Vorix", locale: "pt_BR", type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function ProposalLayout({ children }: { children: React.ReactNode }) { return children; }
