import type { MetadataRoute } from "next";

const BASE = "https://vorixworks.com";

/**
 * robots.txt — guia os buscadores para as páginas públicas e tira do rastreamento as áreas de app
 * (que exigem login e não são conteúdo). NÃO bloqueia `/_next/` porque o Google precisa do CSS/JS
 * para renderizar as páginas. O login usa `noindex` (não entra aqui) para o Google ver a diretiva.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/workspaces/", "/admin/", "/conta/", "/api/"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
