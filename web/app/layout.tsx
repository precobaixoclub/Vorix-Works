import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/contexts/auth-context";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Vorix",
  description: "Experiência de Espaço de Trabalho — a plataforma de Marketing com IA da Vorix.",
  other: {
    "facebook-domain-verification": "0slbgshopmsabjin5tk6xt2ylbi4eg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
