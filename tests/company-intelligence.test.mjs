import test from "node:test";
import assert from "node:assert/strict";
import { parseDisallowedPaths, isPathAllowed } from "../dist/infrastructure/company-intelligence/robots-txt.js";
import { categorizePage, extractNavLinks } from "../dist/infrastructure/company-intelligence/website-discovery.js";
import { extractContent } from "../dist/infrastructure/company-intelligence/content-extraction.js";
import { extractImages, extractVisualIdentity, mergeVisualIdentities } from "../dist/infrastructure/company-intelligence/visual-asset-extraction.js";
import { discoverFeatures } from "../dist/shared/utils/company-intelligence/feature-discovery.js";
import { classifyScreen } from "../dist/shared/utils/company-intelligence/screen-classification.js";
import { analyzeBrandLanguage } from "../dist/shared/utils/company-intelligence/brand-language-analysis.js";
import { classifySegment } from "../dist/shared/utils/company-intelligence/segment-classification.js";
import { buildCompanyProfile } from "../dist/shared/utils/company-intelligence/company-profile-builder.js";
import { buildKnowledgeGraph } from "../dist/shared/utils/company-intelligence/knowledge-graph-builder.js";
import { searchCompanyKnowledge } from "../dist/shared/utils/company-intelligence/search-api.js";
import { buildQualityReport } from "../dist/shared/utils/company-intelligence/quality-report.js";
import { hashPageContent, diffDiscoveredPages, pagesNeedingRecollection } from "../dist/shared/utils/company-intelligence/incremental-update.js";
import { slugify } from "../dist/shared/utils/company-intelligence/slug.js";

// ---------------------------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------------------------

test("parseDisallowedPaths respeita User-agent: * e ignora grupos de outros bots", () => {
  const body = [
    "User-agent: GoogleBot",
    "Disallow: /admin-google",
    "",
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /login",
  ].join("\n");
  const disallowed = parseDisallowedPaths(body, "*");
  assert.deepEqual(disallowed, ["/admin", "/login"]);
});

test("isPathAllowed bloqueia qualquer path que comece com um disallow declarado", () => {
  const rules = { disallowedPaths: ["/admin"], fetchedOk: true };
  assert.equal(isPathAllowed("/admin/users", rules), false);
  assert.equal(isPathAllowed("/precos", rules), true);
});

// ---------------------------------------------------------------------------------------------
// website discovery
// ---------------------------------------------------------------------------------------------

test("categorizePage classifica paths conhecidos corretamente", () => {
  assert.equal(categorizePage("/"), "home");
  assert.equal(categorizePage("/precos"), "plans");
  assert.equal(categorizePage("/demo"), "demo");
  assert.equal(categorizePage("/blog/post-1"), "blog");
  assert.equal(categorizePage("/faq"), "faq");
  assert.equal(categorizePage("/contato"), "contact");
  assert.equal(categorizePage("/politica-de-privacidade"), "policy");
});

test("extractNavLinks só retorna paths do mesmo domínio, sem arquivos estáticos", () => {
  const html = `<html><body>
    <a href="/precos">Preços</a>
    <a href="https://outrosite.com/pagina">Externo</a>
    <a href="/logo.png">Logo</a>
    <a href="mailto:contato@exemplo.com">Email</a>
    <a href="/demo">Demo</a>
  </body></html>`;
  const links = extractNavLinks(html, "https://exemplo.com/");
  assert.deepEqual(links.sort(), ["/demo", "/precos"]);
});

// ---------------------------------------------------------------------------------------------
// content extraction
// ---------------------------------------------------------------------------------------------

test("extractContent extrai headlines, CTAs, listas e FAQ de uma página real", () => {
  const html = `<html><body>
    <h1>Crie em minutos o site do seu evento</h1>
    <h2>Tudo o que você precisa</h2>
    <p>Uma plataforma completa e fácil de usar para organizar seu evento sem burocracia.</p>
    <ul><li>Lista de presentes</li><li>Confirmação de presença</li><li>Álbum colaborativo</li></ul>
    <a href="#">Criar meu site agora</a>
    <h3>Como funciona o RSVP?</h3>
    <p>Os convidados confirmam presença por um link único.</p>
  </body></html>`;
  const content = extractContent(html, "https://exemplo.com/");
  assert.deepEqual(content.headlines, ["Crie em minutos o site do seu evento"]);
  assert.ok(content.subheadlines.includes("Tudo o que você precisa"));
  assert.ok(content.ctas.some((cta) => cta.includes("Criar meu site")));
  assert.equal(content.lists.length, 1);
  assert.equal(content.lists[0].length, 3);
  assert.equal(content.faq.length, 1);
  assert.equal(content.faq[0].question, "Como funciona o RSVP?");
});

test("extractContent identifica planos e preços em blocos marcados como pricing", () => {
  const html = `<html><body>
    <div class="pricing-card">
      <h3>Essencial</h3>
      <p>R$ 49,90</p>
      <ul><li>1 página</li><li>Suporte por email</li></ul>
    </div>
  </body></html>`;
  const content = extractContent(html, "https://exemplo.com/precos");
  assert.equal(content.plans.length, 1);
  assert.equal(content.plans[0].name, "Essencial");
  assert.equal(content.plans[0].price, "R$ 49,90");
});

// ---------------------------------------------------------------------------------------------
// visual asset extraction
// ---------------------------------------------------------------------------------------------

test("extractImages classifica imagens de logo pela URL/alt", () => {
  const html = `<html><body>
    <img src="/brand/logo-mark.png" alt="Logo da empresa">
    <img src="/fotos/evento.jpg" alt="Casal no evento">
  </body></html>`;
  const images = extractImages(html, "https://exemplo.com/");
  assert.equal(images.length, 2);
  assert.equal(images.find((img) => img.url.includes("logo-mark")).likelyLogo, true);
  assert.equal(images.find((img) => img.url.includes("evento.jpg")).likelyLogo, false);
});

test("extractVisualIdentity coleta cores de theme-color e CSS inline, e fontes de font-family", () => {
  const html = `<html><head>
    <meta name="theme-color" content="#D8B26A">
    <style>body { font-family: 'Georgia', serif; color: #1c1c24; }</style>
    <link rel="icon" href="/favicon.ico">
  </head><body></body></html>`;
  const identity = extractVisualIdentity(html, "https://exemplo.com/");
  assert.ok(identity.primaryColors.includes("#d8b26a"));
  assert.ok(identity.primaryColors.includes("#1c1c24"));
  assert.ok(identity.fontFamilies.includes("Georgia"));
  assert.equal(identity.iconUrls.length, 1);
});

test("mergeVisualIdentities deduplica cores/fontes/logos entre páginas", () => {
  const merged = mergeVisualIdentities([
    { logoUrls: ["a.png"], iconUrls: [], primaryColors: ["#111"], secondaryColors: [], fontFamilies: ["Arial"] },
    { logoUrls: ["a.png"], iconUrls: [], primaryColors: ["#111", "#222"], secondaryColors: [], fontFamilies: ["Georgia"] },
  ]);
  assert.deepEqual(merged.logoUrls, ["a.png"]);
  assert.deepEqual(merged.primaryColors, ["#111", "#222"]);
  assert.deepEqual(merged.fontFamilies, ["Arial", "Georgia"]);
});

// ---------------------------------------------------------------------------------------------
// feature discovery / screen classification
// ---------------------------------------------------------------------------------------------

test("discoverFeatures liga funcionalidade a benefício, dor e tela real quando existem evidências", () => {
  const content = [{
    pageUrl: "https://exemplo.com/",
    headlines: [], subheadlines: [], paragraphs: ["Sem burocracia para confirmar presença via RSVP."],
    lists: [], faq: [], benefits: ["RSVP sem burocracia"],
    features: ["RSVP"], ctas: [], testimonials: [], plans: [], differentiators: [],
  }];
  const screens = [{ id: "screen-rsvp", sourceUrl: "https://exemplo.com/rsvp", category: "rsvp", absolutePath: "x.png", width: 400, height: 800, capturedAt: "2026-01-01" }];
  const features = discoverFeatures(content, screens);
  assert.equal(features.length, 1);
  assert.equal(features[0].name, "RSVP");
  assert.ok(features[0].benefit.includes("sem burocracia"));
  assert.ok(features[0].relatedScreenIds.includes("screen-rsvp"));
});

test("classifyScreen reconhece categorias conhecidas pelo path e cai em unknown para o resto", () => {
  assert.equal(classifyScreen("https://exemplo.com/site/demo/presentes"), "gift_list");
  assert.equal(classifyScreen("https://exemplo.com/site/demo/fotos"), "album");
  assert.equal(classifyScreen("https://exemplo.com/site/demo/consultar-mesa"), "table_lookup");
  assert.equal(classifyScreen("https://exemplo.com/site/demo"), "home");
  assert.equal(classifyScreen("https://exemplo.com/pagina-qualquer"), "unknown");
});

// ---------------------------------------------------------------------------------------------
// brand language / segment / profile
// ---------------------------------------------------------------------------------------------

test("analyzeBrandLanguage nunca inventa posicionamento quando não há headline nem slogan", () => {
  const language = analyzeBrandLanguage([{ pageUrl: "x", headlines: [], subheadlines: [], paragraphs: [], lists: [], faq: [], benefits: [], features: [], ctas: [], testimonials: [], plans: [], differentiators: [] }]);
  assert.equal(language.positioning, "");
});

test("analyzeBrandLanguage usa o primeiro headline real como posicionamento quando não há slogan explícito", () => {
  const language = analyzeBrandLanguage([{ pageUrl: "x", headlines: ["Crie o site do seu casamento"], subheadlines: [], paragraphs: [], lists: [], faq: [], benefits: [], features: [], ctas: ["Criar meu site"], testimonials: [], plans: [], differentiators: [] }]);
  assert.equal(language.positioning, "Crie o site do seu casamento");
  assert.deepEqual(language.ctas, ["Criar meu site"]);
});

test("classifySegment reconhece o segmento de casamentos e cai em não classificado quando não há evidência", () => {
  assert.equal(classifySegment("Site de casamento com RSVP e lista de presentes para noivos"), "casamentos");
  assert.equal(classifySegment("texto genérico sem nenhuma palavra-chave conhecida"), "não classificado");
});

test("buildCompanyProfile nunca preenche público-alvo/concorrentes com inferência forçada", () => {
  const profile = buildCompanyProfile({
    domain: "exemplo.com",
    homeTitle: "Exemplo - Site oficial",
    content: [{ pageUrl: "x", headlines: ["Crie seu site"], subheadlines: [], paragraphs: [], lists: [], faq: [], benefits: [], features: [], ctas: ["Criar agora"], testimonials: [], plans: [], differentiators: [] }],
    features: [],
    visualIdentity: { logoUrls: [], iconUrls: [], primaryColors: [], secondaryColors: [], fontFamilies: [] },
    brandLanguage: { tone: "direto", style: "curto", vocabulary: [], recurringExpressions: [], ctas: ["Criar agora"], promises: [], positioning: "Crie seu site" },
  });
  assert.equal(profile.companyName, "Exemplo");
  assert.equal(profile.targetAudience, "");
  assert.deepEqual(profile.identifiedCompetitors, []);
  assert.equal(profile.officialCta, "Criar agora");
});

// ---------------------------------------------------------------------------------------------
// knowledge graph / search API / quality report
// ---------------------------------------------------------------------------------------------

function sampleBase() {
  const features = [{ id: "rsvp", name: "RSVP", description: "RSVP", benefit: "Confirmação fácil", painPointSolved: "sem mensagens perdidas", category: "product", keywords: ["rsvp"], relatedScreenIds: ["screen-rsvp"] }];
  const screens = [{ id: "screen-rsvp", sourceUrl: "https://exemplo.com/rsvp", category: "rsvp", absolutePath: "x.png", width: 400, height: 800, capturedAt: "2026-01-01" }];
  const mediaLibrary = [{ id: "media-1", category: "screen_capture", description: "Captura RSVP", tags: ["rsvp"], origin: "https://exemplo.com/rsvp", license: "third_party_public_page", date: "2026-01-01", relatedFeatureIds: ["rsvp"] }];
  const pages = [{ url: "https://exemplo.com/rsvp", path: "/rsvp", category: "page", title: "RSVP", discoveredVia: "seed", contentHash: "abc" }];
  const brandLanguage = { tone: "direto", style: "curto", vocabulary: ["rsvp"], recurringExpressions: [], ctas: ["Confirmar presença"], promises: ["sem burocracia"], positioning: "O jeito fácil de confirmar presença" };
  const profile = {
    id: "company-exemplo-com", companyName: "Exemplo", domain: "exemplo.com", segment: "casamentos", language: "pt-BR", market: "Brasil",
    valueProposition: "O jeito fácil de confirmar presença", toneOfVoice: "direto",
    visualIdentity: { logoUrls: [], iconUrls: [], primaryColors: ["#d8b26a"], secondaryColors: [], fontFamilies: [] },
    targetAudience: "noivos", objectives: ["Confirmar presença"], keyDifferentiators: [], painPointsSolved: ["sem mensagens perdidas"],
    keyBenefits: ["Confirmação fácil"], identifiedCompetitors: [], keywords: ["rsvp"], slogan: "O jeito fácil de confirmar presença",
    officialCta: "Confirmar presença", discoveredAt: "2026-01-01", updatedAt: "2026-01-01",
  };
  const graph = buildKnowledgeGraph({ features, screens, mediaLibrary, pages, ctas: brandLanguage.ctas, targetAudience: profile.targetAudience });
  const qualityReport = { domain: "exemplo.com", generatedAt: "2026-01-01", pagesFound: 0, featuresIdentified: 0, ctasFound: 0, assetsCollected: 0, screensCaptured: 0, benefitsFound: 0, painPointsSolved: 0, brandScore: 0, coverageScore: 0, pendingItems: [] };
  return { profile, pages, content: [], screens, mediaLibrary, features, brandLanguage, graph, qualityReport };
}

test("buildKnowledgeGraph liga funcionalidade a benefício, problema e tela", () => {
  const base = sampleBase();
  const featureNode = base.graph.nodes.find((node) => node.id === "feature:rsvp");
  assert.ok(featureNode);
  assert.ok(base.graph.edges.some((edge) => edge.from === "feature:rsvp" && edge.relation === "solves_with_benefit"));
  assert.ok(base.graph.edges.some((edge) => edge.from === "feature:rsvp" && edge.relation === "solves_problem"));
  assert.ok(base.graph.edges.some((edge) => edge.from === "feature:rsvp" && edge.to === "screen:screen-rsvp"));
});

test("searchCompanyKnowledge responde perguntas no estilo da especificação (CTA, cor, slogan, tela)", () => {
  const base = sampleBase();
  assert.equal(searchCompanyKnowledge(base, "Qual o CTA oficial?").answer, "Confirmar presença");
  assert.equal(searchCompanyKnowledge(base, "Qual a cor principal?").answer, "#d8b26a");
  assert.equal(searchCompanyKnowledge(base, "Qual o slogan?").answer, "O jeito fácil de confirmar presença");
  const screenAnswer = searchCompanyKnowledge(base, "Qual a tela oficial do RSVP?");
  assert.ok(screenAnswer.answer.includes("exemplo.com/rsvp"));
});

test("searchCompanyKnowledge responde honestamente (confiança 0) quando não há dado coletado", () => {
  const base = sampleBase();
  const result = searchCompanyKnowledge(base, "Qual o preço do plano internacional em euros?");
  assert.equal(result.confidence, 0);
});

test("buildQualityReport pontua Brand Score e Coverage Score de forma auditável e reporta pendências reais", () => {
  const base = sampleBase();
  const report = buildQualityReport(base);
  assert.ok(report.brandScore > 0);
  assert.ok(report.coverageScore > 0);
  assert.equal(report.featuresIdentified, base.features.length);
  assert.equal(report.screensCaptured, base.screens.length);
});

test("buildQualityReport relata pendências honestas quando não há tela real associada", () => {
  const base = sampleBase();
  base.features = [{ ...base.features[0], relatedScreenIds: [] }];
  const report = buildQualityReport(base);
  assert.ok(report.pendingItems.some((item) => item.includes("sem tela real")));
});

// ---------------------------------------------------------------------------------------------
// continuous learning (incremental update)
// ---------------------------------------------------------------------------------------------

test("hashPageContent é determinístico e muda quando o conteúdo muda", () => {
  const hashA = hashPageContent("<html>A</html>");
  const hashB = hashPageContent("<html>A</html>");
  const hashC = hashPageContent("<html>B</html>");
  assert.equal(hashA, hashB);
  assert.notEqual(hashA, hashC);
});

test("diffDiscoveredPages identifica páginas novas, alteradas, inalteradas e removidas", () => {
  const previous = [
    { url: "https://x.com/", path: "/", category: "home", discoveredVia: "seed", contentHash: "h1" },
    { url: "https://x.com/precos", path: "/precos", category: "plans", discoveredVia: "seed", contentHash: "h2" },
    { url: "https://x.com/old", path: "/old", category: "page", discoveredVia: "seed", contentHash: "h3" },
  ];
  const next = [
    { url: "https://x.com/", path: "/", category: "home", discoveredVia: "seed", contentHash: "h1" },
    { url: "https://x.com/precos", path: "/precos", category: "plans", discoveredVia: "seed", contentHash: "h2-changed" },
    { url: "https://x.com/demo", path: "/demo", category: "demo", discoveredVia: "seed", contentHash: "h4" },
  ];
  const changeSet = diffDiscoveredPages(previous, next);
  assert.deepEqual(changeSet.newPaths, ["/demo"]);
  assert.deepEqual(changeSet.changedPaths, ["/precos"]);
  assert.deepEqual(changeSet.unchangedPaths, ["/"]);
  assert.deepEqual(changeSet.removedPaths, ["/old"]);
  assert.deepEqual(pagesNeedingRecollection(changeSet).sort(), ["/demo", "/precos"]);
});

// ---------------------------------------------------------------------------------------------
// slug
// ---------------------------------------------------------------------------------------------

test("slugify normaliza acentos e espaços de forma determinística", () => {
  assert.equal(slugify("Confirmação de Presença!"), "confirmacao-de-presenca");
  assert.equal(slugify("  Múltiplos   Espaços  "), "multiplos-espacos");
});
