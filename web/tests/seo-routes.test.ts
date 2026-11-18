import { describe, expect, it } from "vitest";
import robots from "../app/robots";
import sitemap from "../app/sitemap";

describe("robots.txt", () => {
  it("aponta para o sitemap e não bloqueia _next nem o login", () => {
    const result = robots();
    expect(result.sitemap).toBe("https://vorixworks.com/sitemap.xml");
    const rule = Array.isArray(result.rules) ? result.rules[0]! : result.rules!;
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    expect(disallow).toContain("/workspaces/");
    expect(disallow.some((path) => path.startsWith("/_next"))).toBe(false);
    expect(disallow).not.toContain("/login"); // login usa noindex; precisa ser rastreável para o Google ver
  });
});

describe("sitemap.xml", () => {
  const urls = sitemap().map((entry) => entry.url);

  it("inclui as páginas públicas reais e nada fora de propósito", () => {
    expect(urls).toContain("https://vorixworks.com");
    expect(urls).toContain("https://vorixworks.com/precos");
    expect(urls).toContain("https://vorixworks.com/produtos/meetings");
    // /pricing redireciona e /produtos/meetings/planos está não publicado (noindex).
    expect(urls).not.toContain("https://vorixworks.com/pricing");
    expect(urls).not.toContain("https://vorixworks.com/produtos/meetings/planos");
  });

  it("todas as URLs são absolutas do domínio e sem barra final duplicada", () => {
    for (const url of urls) {
      expect(url.startsWith("https://vorixworks.com")).toBe(true);
      expect(url.endsWith("/")).toBe(false);
    }
  });
});
