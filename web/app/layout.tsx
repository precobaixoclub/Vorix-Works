import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Inter } from "next/font/google";
import { AuthProvider } from "@/contexts/auth-context";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
// Redesign "SaaS moderno + IA-first" — Instrument Sans para títulos (mais carácter que o Inter
// sem trocar a personalidade da UI) e IBM Plex Mono para metadado técnico (versão, modelo,
// timestamps) — nunca usados no corpo de texto, só em `font-display`/`font-mono`.
const instrumentSans = Instrument_Sans({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://vorixworks.com"),
  title: "Vorix",
  description: "Marketing, atendimento e vendas conectados por IA.",
  openGraph: {
    title: "Vorix",
    description: "Marketing, atendimento e vendas conectados por IA.",
    url: "https://vorixworks.com",
    siteName: "Vorix",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Vorix Command Center" }],
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vorix",
    description: "Marketing, atendimento e vendas conectados por IA.",
    images: ["/opengraph-image"],
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
