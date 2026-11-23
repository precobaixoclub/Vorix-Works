import { publicMetadata } from "@/features/public-site/metadata";

// Fase 13: o cadastro é a porta de entrada pública (está no sitemap) — título, descrição e
// canônico próprios, em vez de herdar os da raiz.
export const metadata = publicMetadata("Criar conta — Vorix", "Crie sua conta Vorix e escolha as ferramentas da sua empresa: Conversas, Marketing, Site e Meetings.", "/signup");

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
