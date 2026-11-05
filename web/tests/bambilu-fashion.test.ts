import {describe, it, expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {templateDemo} from "@/features/sites/demo-content";
import {initialSiteSnapshot} from "@/features/sites/customization";
import {TenantSiteRenderer} from "@/components/sites/TenantSiteRenderer";
import {FashionKidsHero, FashionKidsHeader} from "@/components/sites/templates/FashionKids";

function fixture() {
  const site = templateDemo("nexus"), snapshot = initialSiteSnapshot("Bambilu Kids", "nexus");
  return {...site, slug: "bambilu-kids", content: snapshot.content, theme: snapshot.theme, categories: []};
}
const render = (site: ReturnType<typeof fixture>) => renderToStaticMarkup(createElement(TenantSiteRenderer, {site, basePath: "/s/" + site.slug, preview: true}));

describe("Fashion Kids: isolamento da apresentação", () => {
  it("a composição exclusiva não modifica dados do catálogo, regras ou configuração comercial", () => {
    const site = fixture();
    site.commerce = {mode: "SHOWCASE", cartEnabled: false, checkoutAvailable: false, whatsappEnabled: false, showcaseCta: "Tenho interesse"};
    site.products[0].quantityOffers = [{id: "rule", name: "Quantidade", currency: "BRL", count: "ELIGIBLE", tiers: [{minimum: 3, maximum: 4, unitPriceCents: 5500}, {minimum: 5, unitPriceCents: 5000}]}];
    const before = structuredClone(site), html = render(site);
    expect(site).toEqual(before);
    expect(html).toContain('class="fk-hero"');
    expect(html).toContain('class="fk-editorial"');
    expect(html).toContain('class="fk-card-offer"');
    expect(html).toContain("55,00"); expect(html).toContain("50,00");
    expect(html).not.toContain("Abrir carrinho");
    expect(html).not.toContain("Mais vendidos");
    expect(html).not.toContain("Frete grátis");
    expect(html).not.toContain(">Meninas<");
  });

  it("mantém o Nexus original em outras lojas e os outros templates na Bambilu", () => {
    const site = fixture();
    expect(render({...site, slug: "outra-loja"})).toContain('class="nexus-hero"');
    expect(render({...site, slug: "outra-loja"})).not.toContain("tenant-site-fashion-kids");
    const aura = {...site, theme: {...site.theme, template: "aura"}};
    expect(render(aura)).toContain('class="aura-hero"');
    expect(render(aura)).not.toContain("tenant-site-fashion-kids");
  });

  it("respeita seções desabilitadas e links externos configurados", () => {
    const site = fixture();
    site.content.blocks = site.content.blocks.map(b => ({...b, enabled: b.type === "hero"}));
    site.content.header!.navigation.push({id: "social", label: "Instagram", url: "https://example.com/bambilu", enabled: true, newTab: true});
    const html = render(site);
    expect(html).not.toContain('class="fk-editorial"');
    expect(html).not.toContain('id="em-destaque"');
    const header = renderToStaticMarkup(createElement(FashionKidsHeader, {site, basePath: "/s/bambilu-kids", query: "", onQuery: () => {}, onSearch: () => {}, menuOpen: true, onMenu: () => {}}));
    expect(header.split('href="https://example.com/bambilu" target="_blank" rel="noopener noreferrer"')).toHaveLength(3);
  });

  it("reutiliza a campanha própria e a foto mobile quando forem cadastradas", () => {
    const site = fixture(), block = site.content.blocks[0];
    site.layoutConfig = {heroVariant: "signature", productGallery: "split", heroImageUrl: "/campaign.webp", heroMobileImageUrl: "/campaign-mobile.webp"};
    const html = renderToStaticMarkup(createElement(FashionKidsHero, {site, block, basePath: "/s/bambilu-kids"}));
    expect(html).toContain('src="/campaign.webp"');
    expect(html).toContain('srcSet="/campaign-mobile.webp"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).not.toContain("data-fashion-product-photo");
  });
});
