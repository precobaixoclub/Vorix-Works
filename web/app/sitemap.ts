import type { MetadataRoute } from "next";

const BASE = "https://vorixworks.com";

/**
 * Sitemap das páginas públicas REAIS — para o Google indexar o que importa, em vez de descobrir
 * sozinho endpoints de asset/imagem. Fora de propósito: `/pricing` (redireciona para `/precos`) e
 * `/produtos/meetings/planos` (redireciona para o configurador de Meetings).
 */
const PAGES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1, changeFrequency: "weekly" },
  { path: "/precos", priority: 0.9, changeFrequency: "weekly" },
  { path: "/produtos/conversas", priority: 0.9, changeFrequency: "weekly" },
  { path: "/produtos/meetings", priority: 0.9, changeFrequency: "weekly" },
  { path: "/produtos/site", priority: 0.8, changeFrequency: "weekly" },
  { path: "/produtos/marketing", priority: 0.8, changeFrequency: "weekly" },
  { path: "/empresa", priority: 0.6, changeFrequency: "monthly" },
  { path: "/signup", priority: 0.7, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/data-deletion", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PAGES.map(({ path, priority, changeFrequency }) => ({
    url: `${BASE}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
