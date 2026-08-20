import test from "node:test";
import assert from "node:assert/strict";
import { buildApiContainer } from "../dist/interfaces/api/di/container.js";
import { buildCreativeContext } from "../dist/application/creative-engine/build-creative-context.js";

/**
 * Migração "Prompt Persistente de Produção" — achado numa autorrevisão: `resolveBrandProfile`
 * nunca estava ligado ao container real, então `creative_context.brandPositioning`/
 * `visualIdentityNotes`/etc. sempre chegavam `undefined` ao motor GPT, mesmo quando a Clara tinha
 * dados reais de marca para o workspace. Estes testes provam a correção usando o container REAL
 * (`buildApiContainer`, mesma raiz de composição da API), nunca uma reimplementação da lógica de
 * resolução — se este teste passa, a mesma função que roda em produção está correta.
 *
 * Também prova a correção de um bug encontrado durante o próprio conserto: `BrandContext.
 * brandName` é SEMPRE o literal "Vorix" nesta base de código (`ensureHouseBrandContext` grava
 * isso incondicionalmente) — nunca o nome real do cliente. Ligar `resolveBrandProfile` de forma
 * ingênua faria TODO workspace real ter seu nome de marca substituído por "Vorix" no
 * `creative_context`. Os testes abaixo provam que isso nunca acontece.
 */

function audit(reason) {
  return { actor: { id: "test", type: "system" }, reason };
}

test("resolveBrandProfile: workspace sem nenhum dado na Clara -> undefined (nunca inventa um perfil)", async () => {
  const container = buildApiContainer();
  const workspace = await container.workspaceRepository.create({ tenantId: "tenant-sem-dados", name: "Workspace sem Clara" });

  const profile = await container.resolveBrandProfile(workspace.id);
  assert.equal(profile, undefined);
});

test("resolveBrandProfile: workspace inexistente -> undefined, nunca lança", async () => {
  const container = buildApiContainer();
  const profile = await container.resolveBrandProfile("workspace-que-nao-existe");
  assert.equal(profile, undefined);
});

test("resolveBrandProfile: após o bootstrap genérico (ensureHouseTenantProfile, sem logo real) continua undefined — nunca surfa o preenchimento genérico como perfil real", async () => {
  const container = buildApiContainer();
  const tenantId = "tenant-bootstrap-generico";
  const workspace = await container.workspaceRepository.create({ tenantId, name: "Workspace bootstrap genérico" });

  // Mesmo bootstrap chamado antes de toda geração real em produção (production.route.ts) — sem
  // nenhuma logo cadastrada em Materiais, então tanto BrandContext quanto IdentityContext nascem
  // com o preenchimento neutro fixo (posicionamento genérico, cores padrão, sem logoUri real).
  await container.ensureHouseTenantProfile(tenantId, workspace.id);

  const profile = await container.resolveBrandProfile(workspace.id);
  assert.equal(profile, undefined, "o preenchimento genérico do bootstrap nunca deveria ser apresentado como perfil de marca real");
});

test("resolveBrandProfile: com dados REAIS na Clara (posicionamento real + logo real), devolve o perfil real — e NUNCA inclui brandName (sempre 'Vorix' nesta base de código, nunca o nome real do cliente)", async () => {
  const container = buildApiContainer();
  const tenantId = "tenant-preco-baixo-club-real";
  const workspace = await container.workspaceRepository.create({ tenantId, name: "Preço Baixo Club" });

  await container.clara.create({
    module: "BrandContext",
    title: "Identidade de marca real",
    payload: { clientId: tenantId, brandName: "Vorix", positioning: "Site que centraliza as melhores ofertas da Shopee e Mercado Livre em um só lugar." },
    audit: audit("Cadastro real de teste"),
  });
  await container.clara.create({
    module: "IdentityContext",
    title: "Identidade visual real",
    payload: { clientId: tenantId, colors: ["#0D0D0D", "#39FF14"], fonts: ["Inter"], imageStyle: "Moderno, tecnológico, alto contraste", logoUri: "https://cdn.example.com/preco-baixo-club/logo.png" },
    audit: audit("Cadastro real de teste"),
  });
  await container.clara.create({
    module: "BusinessContext",
    title: "Negócio real",
    payload: { clientId: tenantId, businessName: "Preço Baixo Club", description: "Plataforma que agrega e divulga promoções reais de outros e-commerces." },
    audit: audit("Cadastro real de teste"),
  });
  await container.clara.create({
    module: "AudienceContext",
    title: "Público real",
    payload: { clientId: tenantId, targetAudience: "Caçadores de promoção, 20-45 anos, ativos em redes sociais." },
    audit: audit("Cadastro real de teste"),
  });
  await container.clara.create({
    module: "ProductContext",
    title: "Produto real",
    payload: { clientId: tenantId, productName: "Tênis RV", description: "Tênis em promoção relâmpago." },
    audit: audit("Cadastro real de teste"),
  });

  const profile = await container.resolveBrandProfile(workspace.id);
  assert.ok(profile, "deveria resolver um perfil real, já que a Clara tem dados reais para este tenant");
  assert.equal(profile.brandName, undefined, "brandName NUNCA deve ser surfado — é sempre o literal 'Vorix' nesta base, nunca o nome real do cliente");
  assert.equal(profile.positioning, "Site que centraliza as melhores ofertas da Shopee e Mercado Livre em um só lugar.");
  assert.equal(profile.businessDescription, "Plataforma que agrega e divulga promoções reais de outros e-commerces.");
  assert.equal(profile.targetAudience, "Caçadores de promoção, 20-45 anos, ativos em redes sociais.");
  assert.deepEqual(profile.productsOrServices, ["Tênis RV"]);
  assert.deepEqual(profile.brandColors, ["#0D0D0D", "#39FF14"]);
  assert.equal(profile.visualIdentityNotes, "Moderno, tecnológico, alto contraste");
});

test("resolveBrandProfile: posicionamento genérico do bootstrap é ignorado mesmo quando IdentityContext já tem logo real (só o campo específico afetado fica de fora, não o perfil inteiro)", async () => {
  const container = buildApiContainer();
  const tenantId = "tenant-logo-sem-positioning-real";
  const workspace = await container.workspaceRepository.create({ tenantId, name: "Workspace parcial" });

  await container.clara.create({
    module: "BrandContext",
    title: "Identidade de marca (ainda genérica)",
    payload: { clientId: tenantId, brandName: "Vorix", positioning: "Plataforma de marketing com IA para pequenos e médios negócios." },
    audit: audit("Ainda não customizado"),
  });
  await container.clara.create({
    module: "IdentityContext",
    title: "Identidade visual real",
    payload: { clientId: tenantId, colors: ["#111111"], fonts: ["Inter"], imageStyle: "Estilo real derivado da logo", logoUri: "https://cdn.example.com/logo-real.png" },
    audit: audit("Logo real cadastrada"),
  });

  const profile = await container.resolveBrandProfile(workspace.id);
  assert.ok(profile);
  assert.equal(profile.positioning, undefined, "posicionamento ainda genérico não deveria ser apresentado como real");
  assert.equal(profile.visualIdentityNotes, "Estilo real derivado da logo", "identidade visual real (com logo) deveria continuar passando normalmente");
});

// Prova PONTA A PONTA: dado real na Clara -> resolveBrandProfile REAL do container -> creative_context
// real montado por buildCreativeContext. As três camadas usadas aqui são exatamente as de produção.
test("ponta a ponta: Brand Profile real do workspace chega ao creative_context via buildCreativeContext + resolveBrandProfile real do container", async () => {
  const container = buildApiContainer();
  const tenantId = "tenant-ponta-a-ponta";
  const workspace = await container.workspaceRepository.create({ tenantId, name: "Preço Baixo Club E2E" });

  await container.clara.create({
    module: "BrandContext",
    title: "Identidade de marca real",
    payload: { clientId: tenantId, brandName: "Vorix", positioning: "Site que centraliza ofertas reais de várias lojas." },
    audit: audit("teste ponta a ponta"),
  });

  const context = await buildCreativeContext(
    { resolveBrandProfile: container.resolveBrandProfile },
    {
      workspaceId: workspace.id,
      brandName: "Preço Baixo Club",
      objective: "Divulgar o site",
      channel: "instagram",
      format: "4:5",
      ideaText: "Crie uma publicação divulgando nosso site.",
      assets: [],
    },
  );

  // O nome real (do briefing) sobrevive intacto — nunca sobrescrito pelo literal "Vorix" da Clara.
  assert.equal(context.brandName, "Preço Baixo Club");
  assert.equal(context.brandPositioning, "Site que centraliza ofertas reais de várias lojas.");
});
