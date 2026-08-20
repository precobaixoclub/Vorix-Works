import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Inter } from "next/font/google";
import { AuthProvider } from "@/contexts/auth-context";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
// Redesign "SaaS moderno + IA-first" — Instrument Sans para títulos (mais carácter que o Inter
// sem trocar a personalidade da UI) e IBM Plex Mono para metadado técnico (versão, modelo,
// timestamps) — nunca usados no corpo de texto, só em `font-display`/`font-mono`.
const instrumentSans = Instrument_Sans({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Vorix",
  description: "Experiência de Espaço de Trabalho — a plataforma de Marketing com IA da Vorix.",
  other: {
    "facebook-domain-verification": "0slbgshopmsabjin5tk6xt2ylbi4eg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${instrumentSans.variable} ${plexMono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
