import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `web/` é um pacote npm independente do backend na raiz (dois lockfiles de propósito, ver
  // relatório da Sprint 04) — isto só confirma para o Turbopack qual dos dois é a raiz certa.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  // Deploy em container (ver Dockerfile em web/) — gera .next/standalone, uma imagem de runtime
  // muito mais leve (só o necessário para rodar, sem todo node_modules de build/dev).
  output: "standalone",
  // Só quando rodando sob Playwright (`playwright.config.ts` passa esta env var pro `next dev`
  // que ele mesmo sobe) — o badge de dev do Next ("stale version"/Turbopack, canto inferior)
  // intercepta cliques na sidebar recolhida por baixo dele; nunca desligado no dev normal.
  ...(process.env.PLAYWRIGHT_TEST ? { devIndicators: false } : {}),
};

export default nextConfig;
