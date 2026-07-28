import * as cheerio from "cheerio";
import type { DiscoveredPage, PageCategory } from "../../domain/company-intelligence/company-intelligence.model.js";
import { fetchRobotsRules, isPathAllowed, type RobotsRules } from "./robots-txt.js";

/**
 * Descoberta de site (seção 2). Dado apenas um domínio, encontra a Home e segue os links de
 * navegação/rodapé para achar Páginas/Landing Pages/Blog/FAQ/Contato/Política/Planos/
 * Funcionalidades/Recursos/Integrações/Documentação — sempre respeitando robots.txt e um teto
 * explícito de páginas (`maxPages`), nunca um crawl irrestrito.
 *
 * Quando `allowedPaths` é informado, o crawler NUNCA visita nada fora dessa lista — usado pela
 * validação real desta sprint para respeitar o escopo de crawl aprovado explicitamente pelo
 * usuário (8 URLs públicas de rumoaoaltar.com.br), mesmo que a página descubra mais links.
 */

export type WebsiteDiscoveryOptions = {
  maxPages?: number;
  requestDelayMs?: number;
  userAgent?: string;
  /** Quando definido, restringe o crawl a exatamente estes paths (allowlist), mesmo que mais links sejam descobertos. */
  allowedPaths?: string[];
  /** Paths adicionais a visitar além da Home, mesmo que não estejam linkados na navegação. */
  seedPaths?: string[];
};

export type FetchedPage = {
  page: DiscoveredPage;
  html: string | null;
};

const DEFAULT_MAX_PAGES = 12;
const DEFAULT_DELAY_MS = 400;
const DEFAULT_USER_AGENT = "ZunoCompanyIntelligenceBot/1.0 (+respectful research crawl)";
const FETCH_TIMEOUT_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function categorizePage(path: string, title?: string): PageCategory {
  const p = path.toLowerCase();
  const t = (title ?? "").toLowerCase();
  if (p === "/" || p === "") return "home";
  if (p.includes("preco") || p.includes("plano") || p.includes("pricing")) return "plans";
  if (p.includes("demo")) return "demo";
  if (p.includes("blog")) return "blog";
  if (p.includes("faq") || p.includes("duvida") || p.includes("ajuda")) return "faq";
  if (p.includes("contato") || p.includes("contact")) return "contact";
  if (p.includes("politica") || p.includes("privacidade") || p.includes("termos") || p.includes("policy")) return "policy";
  if (p.includes("funcionalidade") || p.includes("feature") || t.includes("funcionalidade")) return "features";
  if (p.includes("recurso") || p.includes("resource")) return "resources";
  if (p.includes("integra")) return "integrations";
  if (p.includes("documenta") || p.includes("docs")) return "documentation";
  if (p.includes("menu") || p.includes("cardapio")) return "menu";
  if (p.split("/").filter(Boolean).length >= 1) return "page";
  return "unknown";
}

async function fetchHtml(url: string, userAgent: string): Promise<{ html: string | null; status?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: controller.signal });
    if (!response.ok) return { html: null, status: response.status };
    return { html: await response.text(), status: response.status };
  } catch {
    return { html: null };
  } finally {
    clearTimeout(timeout);
  }
}

export function extractNavLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;
  const paths = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.origin !== origin) return;
      if (/\.(png|jpg|jpeg|svg|pdf|zip|css|js)$/i.test(resolved.pathname)) return;
      paths.add(resolved.pathname);
    } catch {
      // href inválido (mailto:, javascript:, etc.) — ignora.
    }
  });
  return Array.from(paths);
}

export async function discoverWebsite(domain: string, options: WebsiteDiscoveryOptions = {}): Promise<FetchedPage[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const delayMs = options.requestDelayMs ?? DEFAULT_DELAY_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const origin = `https://${domain}`;

  const robots: RobotsRules = await fetchRobotsRules(domain, userAgent);

  const toVisit: Array<{ path: string; via: DiscoveredPage["discoveredVia"] }> = [{ path: "/", via: "seed" }];
  for (const seed of options.seedPaths ?? []) {
    if (!toVisit.some((entry) => entry.path === seed)) toVisit.push({ path: seed, via: "seed" });
  }

  const visited = new Set<string>();
  const results: FetchedPage[] = [];

  while (toVisit.length > 0 && results.length < maxPages) {
    const next = toVisit.shift()!;
    if (visited.has(next.path)) continue;
    visited.add(next.path);

    if (options.allowedPaths && !options.allowedPaths.includes(next.path)) continue;
    if (!isPathAllowed(next.path, robots)) continue;

    if (results.length > 0) await sleep(delayMs);

    const url = `${origin}${next.path}`;
    const { html, status } = await fetchHtml(url, userAgent);
    const title = html ? cheerio.load(html)("title").first().text().trim() : undefined;

    results.push({
      page: {
        url,
        path: next.path,
        category: categorizePage(next.path, title),
        title: title || undefined,
        discoveredVia: next.via,
        fetchedAt: new Date().toISOString(),
        httpStatus: status,
      },
      html,
    });

    if (html && (!options.allowedPaths || options.allowedPaths.length === 0)) {
      for (const linkedPath of extractNavLinks(html, url)) {
        if (!visited.has(linkedPath) && !toVisit.some((entry) => entry.path === linkedPath)) {
          toVisit.push({ path: linkedPath, via: "nav_link" });
        }
      }
    }
  }

  return results;
}
