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
  // Cache exclusivo de cada rodada do editor: evita disputar .next com o dev/build
  // e a limpeza de diretórios antigos bloqueados pelo OneDrive no Windows.
  ...(process.env.PLAYWRIGHT_TEST && /^\.next-site-qa-[a-f0-9-]+$/.test(process.env.SITE_BUILDER_QA_DIST_DIR ?? "")
    ? { distDir: process.env.SITE_BUILDER_QA_DIST_DIR, typescript: { tsconfigPath: ".tsconfig-site-qa.json" } }
    : {}),
};

export default nextConfig;
