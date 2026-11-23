import { describe, expect, it } from "vitest";
import { SITE_EDITOR_GROUPS, SITE_EDITOR_SECTIONS, groupOfSection, publicationSummary } from "@/features/sites/editor-groups";
import { initialSiteSnapshot } from "@/features/sites/customization";
import { collapsedByDefault } from "@/contexts/sidebar-context";
import type { SiteSnapshot } from "@/features/sites/types";

// Valores de `?section=` que existiam antes da Fase 8: links salvos e atalhos internos não podem quebrar.
const LEGACY_SECTIONS = ["modelos", "geral", "aparencia", "menu", "banners", "secoes", "paginas", "catalogo", "rodape", "contato", "textos", "regras", "loja", "seo", "dominio"];

describe("editor de sites — grupos (Fase 8)", () => {
  it("mantém exatamente as mesmas seções, sem perder nem inventar nenhuma", () => {
    expect(SITE_EDITOR_SECTIONS.map((item) => item.value).sort()).toEqual([...LEGACY_SECTIONS].sort());
    expect(new Set(SITE_EDITOR_SECTIONS.map((item) => item.value)).size).toBe(SITE_EDITOR_SECTIONS.length);
  });

  it("organiza em Modelo / Aparência / Conteúdo / Vendas / Publicação e domínio, nessa ordem", () => {
    expect(SITE_EDITOR_GROUPS).toEqual(["MODELO", "APARÊNCIA", "CONTEÚDO", "VENDAS", "PUBLICAÇÃO E DOMÍNIO"]);
    const order = SITE_EDITOR_SECTIONS.map((item) => SITE_EDITOR_GROUPS.indexOf(item.group));
    expect(order).toEqual([...order].sort((a, b) => a - b)); // grupos contíguos, sem intercalar
    for (const group of SITE_EDITOR_GROUPS) expect(SITE_EDITOR_SECTIONS.some((item) => item.group === group)).toBe(true);
  });

  it("cada seção cai no grupo do que a pessoa quer fazer", () => {
    expect(groupOfSection("modelos")).toBe("MODELO");
    expect(groupOfSection("geral")).toBe("APARÊNCIA");
    expect(groupOfSection("aparencia")).toBe("APARÊNCIA");
    for (const value of ["banners", "secoes", "paginas", "menu", "rodape", "contato", "textos"]) expect(groupOfSection(value)).toBe("CONTEÚDO");
    for (const value of ["catalogo", "loja", "regras"]) expect(groupOfSection(value)).toBe("VENDAS");
    for (const value of ["seo", "dominio"]) expect(groupOfSection(value)).toBe("PUBLICAÇÃO E DOMÍNIO");
    expect(groupOfSection("inexistente")).toBeUndefined();
  });
});

describe("resumo da publicação", () => {
  const base = initialSiteSnapshot("Empresa QA", "nexus");
  const withSeo = (snapshot: SiteSnapshot, title: string, description: string): SiteSnapshot => ({ ...snapshot, content: { ...snapshot.content, seo: { ...snapshot.content.seo, title, description } } });
  const item = (items: ReturnType<typeof publicationSummary>, key: string) => items.find((entry) => entry.key === key)!;

  it("site nunca publicado: nada no ar e nenhuma alteração visível", () => {
    const items = publicationSummary({ slug: "empresa-qa", draft: base, publishedAt: undefined, published: undefined }, base, "/s/empresa-qa");
    expect(item(items, "published").ok).toBe(false);
    expect(item(items, "changes").ok).toBe(false);
    expect(item(items, "changes").detail).toMatch(/Publique/);
    expect(item(items, "address")).toMatchObject({ ok: true, detail: "/s/empresa-qa" });
  });

  it("publicado e igual ao rascunho salvo: tudo em dia", () => {
    const draft = withSeo(base, "Empresa QA", "Descrição para o Google");
    const items = publicationSummary({ slug: "empresa-qa", draft, published: draft as never, publishedAt: "2026-11-20T12:00:00.000Z" }, draft, "empresa-qa.vorix.site");
    expect(items.every((entry) => entry.ok)).toBe(true);
    expect(item(items, "published").detail).toContain("20/11/2026");
  });

  it("rascunho salvo diferente do publicado: avisa que os visitantes ainda não veem", () => {
    const changed = { ...base, content: { ...base.content, name: "Nome novo" } };
    const items = publicationSummary({ slug: "empresa-qa", draft: changed, published: base as never, publishedAt: "2026-11-20T12:00:00.000Z" }, changed, "/s/empresa-qa");
    expect(item(items, "changes")).toMatchObject({ ok: false });
    expect(item(items, "changes").detail).toMatch(/ainda não veem/);
  });

  it("troca de endereço pendente e SEO vazio apontam para a seção certa", () => {
    const draft = { ...withSeo(base, "", ""), siteSlug: "novo-endereco" };
    const items = publicationSummary({ slug: "empresa-qa", draft: base, published: undefined, publishedAt: undefined }, draft, "/s/empresa-qa");
    expect(item(items, "address")).toMatchObject({ ok: false, section: "dominio" });
    expect(item(items, "address").detail).toContain("novo-endereco");
    expect(item(items, "seo")).toMatchObject({ ok: false, section: "seo" });
  });
});

describe("modo foco do editor", () => {
  it("recolhe o menu global por padrão no editor do site e em Conversas, e só neles", () => {
    expect(collapsedByDefault("/workspaces/ws-1/site")).toBe(true);
    expect(collapsedByDefault("/workspaces/ws-1/site/")).toBe(true);
    expect(collapsedByDefault("/workspaces/ws-1/conversas")).toBe(true);
    expect(collapsedByDefault("/workspaces/ws-1/site/pedidos")).toBe(false);
    expect(collapsedByDefault("/workspaces/ws-1/site/analytics")).toBe(false);
    expect(collapsedByDefault("/workspaces/ws-1")).toBe(false);
    expect(collapsedByDefault(undefined)).toBe(false);
  });
});
