import type { Metadata } from "next";

// A página de login não é conteúdo público — o Google a marcava como "Cópia sem página canônica".
// Tiramos do índice (noindex); ela continua acessível normalmente para quem for entrar.
export const metadata: Metadata = {
  title: "Entrar no Vorix",
  robots: { index: false, follow: false },
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
