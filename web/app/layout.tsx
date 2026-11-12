import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AuthProvider } from "@/contexts/auth-context";
import { Providers } from "./providers";
import "./globals.css";

const inter = localFont({ src: "./fonts/inter.woff2", weight: "100 900", display: "swap", variable: "--font-sans" });
// Redesign "SaaS moderno + IA-first" — Instrument Sans para títulos (mais carácter que o Inter
// sem trocar a personalidade da UI) e IBM Plex Mono para metadado técnico (versão, modelo,
// timestamps) — nunca usados no corpo de texto, só em `font-display`/`font-mono`.
const instrumentSans = localFont({ src: "./fonts/instrument-sans.woff2", weight: "400 700", display: "swap", variable: "--font-display" });
const plexMono = localFont({ src: [{path:"./fonts/ibm-plex-mono-400.woff2",weight:"400"},{path:"./fonts/ibm-plex-mono-500.woff2",weight:"500"}], display:"swap", variable:"--font-mono" });

// No celular o teclado encolhe a área visível (o campo de mensagem fica acima dele) e a página
// usa a tela inteira, respeitando o notch via `env(safe-area-inset-*)`.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content" };

export const metadata: Metadata = {
  metadataBase: new URL("https://vorixworks.com"),
  title: "Vorix — Atendimento e vendas no mesmo fluxo",
  description: "Transforme contexto em ação com o Vorix Conversas: atendimento, CRM e gestão comercial conectados em uma única operação.",
  openGraph: {
    title: "Vorix — Transforme contexto em ação",
    description: "Atendimento e vendas no mesmo fluxo.",
    url: "https://vorixworks.com",
    siteName: "Vorix",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "Vorix — Transforme contexto em ação" }],
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vorix — Transforme contexto em ação",
    description: "Atendimento e vendas no mesmo fluxo.",
    images: ["/opengraph-image.png"],
  },
  // Google Search Console: comprova o domínio para a verificação do app OAuth (Google Calendar).
  // Não remover — o Google confere de novo periodicamente.
  verification: {
    google: "HoC1d--vDZQJBn1J2UuCAAuyO5B2jm77360SHVXpP7Y",
  },
  other: {
    "facebook-domain-verification": "0slbgshopmsabjin5tk6xt2ylbi4eg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${instrumentSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body>
        <Providers>
          <AuthProvider>{children}</AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
