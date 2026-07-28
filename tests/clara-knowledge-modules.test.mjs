import test from "node:test";
import assert from "node:assert/strict";
import { ClaraKnowledgeCenter, buildLearningContextPayload, syncQualityFeedbackToClara } from "../dist/application/knowledge/index.js";
import { InMemoryZunoEventRecorder, InMemoryClaraLogger } from "../dist/infrastructure/telemetry/index.js";
import { InMemoryClaraKnowledgeRepository } from "../dist/infrastructure/storage/index.js";
import { QualityFeedbackCenter } from "../dist/application/quality-feedback/index.js";
import { InMemoryQualityFeedbackRepository } from "../dist/infrastructure/storage/index.js";

const CLIENT_ID = "client-rumo";

function actor(overrides = {}) {
  return { id: "test-actor", type: "specialist", name: "Teste", ...overrides };
}

function audit(reason = "Cadastro de teste") {
  return { actor: actor(), reason, correlationId: "corr-clara-modules" };
}

function createDeterministicIdGenerator() {
  let nextNumber = 1;
  return {
    create(prefix) {
      const id = `${prefix}-${String(nextNumber).padStart(4, "0")}`;
      nextNumber += 1;
      return id;
    },
  };
}

function createClara(repository = new InMemoryClaraKnowledgeRepository()) {
  const logger = new InMemoryClaraLogger();
  const events = new InMemoryZunoEventRecorder();
  const clara = new ClaraKnowledgeCenter({
    repository,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-12T12:00:00.000Z"),
  });
  return { clara, logger, events, repository };
}

// ---------------------------------------------------------------------------------------------
// Módulo 1 — Identidade da Marca (extensão de BrandContext, já consultado por 9 das 12 Skills)
// ---------------------------------------------------------------------------------------------

test("Módulo 1 (Identidade da Marca): BrandContext aceita os novos campos e permanece compatível com registros antigos sem eles", async () => {
  const { clara } = createClara();

  const complete = await clara.create({
    module: "BrandContext",
    title: "Identidade completa",
    payload: {
      clientId: CLIENT_ID,
      brandName: "Rumo ao Altar",
      mission: "Tornar a organização do casamento leve para todo casal.",
      vision: "Ser a plataforma de casamento mais usada do Brasil.",
      values: ["transparência", "leveza", "cuidado"],
      purpose: "Reduzir o estresse de organizar um casamento.",
      personality: ["acolhedora", "divertida"],
      archetypes: ["Cuidador"],
      formalityLevel: "informal",
      preferredEmojis: ["💍", "✨"],
      forbiddenEmojis: ["💀"],
      communicationStyle: "caloroso e direto",
      audienceAddressForm: "você",
    },
    audit: audit(),
  });
  assert.equal(complete.payload.mission, "Tornar a organização do casamento leve para todo casal.");
  assert.deepEqual(complete.payload.values, ["transparência", "leveza", "cuidado"]);

  // Registro "antigo": só os campos que já existiam antes desta evolução, sem nenhum campo novo.
  const legacy = await clara.create({
    module: "BrandContext",
    title: "Identidade mínima (formato antigo)",
    payload: { clientId: CLIENT_ID, brandName: "Marca Legada" },
    audit: audit(),
  });
  assert.equal(legacy.payload.brandName, "Marca Legada");
  assert.equal(legacy.payload.mission, undefined);
  assert.equal(legacy.payload.formalityLevel, undefined);
});

// ---------------------------------------------------------------------------------------------
// Módulo 2 — Produto (extensão de ProductContext)
// ---------------------------------------------------------------------------------------------

test("Módulo 2 (Produto): ProductContext aceita funcionalidades, objeções, FAQ, limitações, comparativos, erros comuns e vantagens competitivas", async () => {
  const { clara } = createClara();

  const record = await clara.create({
    module: "ProductContext",
    title: "Produto Rumo ao Altar",
    payload: {
      clientId: CLIENT_ID,
      description: "Plataforma de casamento com site, presentes via Pix e RSVP.",
      features: ["Site de casamento", "Lista de presentes via Pix", "RSVP"],
      objections: ["Será que é seguro receber Pix por uma plataforma?"],
      salesArguments: ["Taxa zero sobre presentes recebidos via Pix."],
      faq: [{ question: "Tem taxa?", answer: "Não, taxa zero sobre o valor recebido via Pix." }],
      limitations: ["Não emite nota fiscal de presentes."],
      comparisons: [{ competitor: "Lista de presentes tradicional", comparison: "Sem loja física, 100% digital." }],
      commonCustomerMistakes: ["Esquecer de compartilhar o link do site com os convidados."],
      competitiveAdvantages: ["Taxa zero", "Painel em tempo real"],
    },
    audit: audit(),
  });

  assert.deepEqual(record.payload.features, ["Site de casamento", "Lista de presentes via Pix", "RSVP"]);
  assert.equal(record.payload.faq[0].question, "Tem taxa?");
  assert.equal(record.payload.competitiveAdvantages.length, 2);
});

// ---------------------------------------------------------------------------------------------
// Módulo 3 — Personas (extensão de AudienceContext.personas, já consultado por João/Sofia/Bruno/Vanessa/Diego)
// ---------------------------------------------------------------------------------------------

test("Módulo 3 (Personas): AudienceContext permite múltiplas personas com os novos campos (idade, momento de vida, medos, gatilhos, canais, estágio do funil)", async () => {
  const { clara } = createClara();

  const record = await clara.create({
    module: "AudienceContext",
    title: "Público Rumo ao Altar",
    payload: {
      clientId: CLIENT_ID,
      targetAudience: "Noivos organizando casamento",
      personas: [
        {
          name: "Marina, a noiva organizadora",
          description: "Cuida de todos os detalhes do casamento.",
          age: "28-34",
          lifeMoment: "Planejando o casamento com 8 meses de antecedência",
          goals: ["Organizar tudo sem gastar mais do que o planejado"],
          pains: ["Perder tempo negociando com fornecedores"],
          fears: ["Esquecer algo importante"],
          desires: ["Ter uma festa inesquecível sem estresse"],
          objections: ["Será que vale a pena usar uma plataforma?"],
          emotionalTriggers: ["Alívio", "Controle"],
          preferredLanguage: "leve e direta",
          preferredChannels: ["instagram", "whatsapp"],
          funnelStage: "meio",
        },
        {
          name: "Convidado prático",
          description: "Quer presentear sem complicação.",
          funnelStage: "topo",
        },
      ],
    },
    audit: audit(),
  });

  assert.equal(record.payload.personas.length, 2);
  assert.equal(record.payload.personas[0].funnelStage, "meio");
  assert.deepEqual(record.payload.personas[0].emotionalTriggers, ["Alívio", "Controle"]);
  // A segunda persona usa só os campos mínimos — prova que os novos campos são opcionais por persona.
  assert.equal(record.payload.personas[1].age, undefined);
});

// ---------------------------------------------------------------------------------------------
// Módulo 5 — Direção Criativa (extensão de IdentityContext, já consultado por Sofia/Bianca/Pedro/...)
// ---------------------------------------------------------------------------------------------

test("Módulo 5 (Direção Criativa): IdentityContext aceita referências visuais, composição, iluminação, exemplos aprovados e reprovados", async () => {
  const { clara } = createClara();

  const record = await clara.create({
    module: "IdentityContext",
    title: "Direção criativa Rumo ao Altar",
    payload: {
      clientId: CLIENT_ID,
      colors: ["#C97F91", "#111111", "#FFFFFF"],
      visualReferences: ["Convites de casamento editoriais"],
      composition: "Centralizada, com bastante espaço negativo.",
      lighting: "Luz suave e uniforme.",
      framing: ["Close-up", "Plano médio"],
      photographyStyle: "Editorial romântico",
      mockupGuidelines: ["Usar mockup apenas quando não houver arte tipográfica suficiente."],
      iconography: ["Linear, traço fino"],
      backgroundStyles: ["Gradiente rosé", "Sólido preto"],
      layoutPatterns: ["Selo central com CTA no rodapé."],
      approvedExamples: [{ description: "Selo TAXA ZERO do post de conversão", uri: "artifacts/exemplo-1/images/slide-01.png" }],
      rejectedExamples: [{ description: "Arte com texto cortado nas bordas", reason: "Fora da área segura do Instagram." }],
    },
    audit: audit(),
  });

  assert.equal(record.payload.composition, "Centralizada, com bastante espaço negativo.");
  assert.equal(record.payload.approvedExamples.length, 1);
  assert.equal(record.payload.rejectedExamples[0].reason, "Fora da área segura do Instagram.");
});

// ---------------------------------------------------------------------------------------------
// Módulo 4 — Marketing (novo módulo)
// ---------------------------------------------------------------------------------------------

test("Módulo 4 (Marketing): MarketingContext registra ganchos, gatilhos mentais, calendário sazonal, temas usados e proibidos", async () => {
  const { clara } = createClara();

  const record = await clara.create({
    module: "MarketingContext",
    title: "Playbook de marketing Rumo ao Altar",
    payload: {
      clientId: CLIENT_ID,
      preferredCtas: ["Conheça o Rumo ao Altar"],
      hooks: ["Você sabia que taxa zero é real?"],
      storytellingFrameworks: ["Problema → Solução → Prova → CTA"],
      mentalTriggers: ["Prova social", "Escassez leve"],
      openingStyles: ["Pergunta provocativa"],
      closingStyles: ["Convite direto para o site"],
      captionStyles: ["Leve e divertido", "Direto e objetivo"],
      preferredFormats: ["carrossel", "reels"],
      campaignObjectives: ["Gerar cadastros no site"],
      seasonalCalendar: [{ date: "2026-06-12", theme: "Dia dos Namorados", notes: "Campanha de lista de presentes." }],
      usedThemes: ["taxa zero", "rsvp", "álbum colaborativo", "cronograma"],
      forbiddenThemes: ["comparação agressiva com concorrentes"],
      idealFrequency: "3 posts por semana",
    },
    audit: audit(),
  });

  assert.equal(record.module, "MarketingContext");
  assert.deepEqual(record.payload.usedThemes, ["taxa zero", "rsvp", "álbum colaborativo", "cronograma"]);
  assert.equal(record.payload.seasonalCalendar[0].theme, "Dia dos Namorados");
});

// ---------------------------------------------------------------------------------------------
// Módulo 7 — Concorrência (novo módulo)
// ---------------------------------------------------------------------------------------------

test("Módulo 7 (Concorrência): CompetitionContext registra concorrentes, pontos fortes/fracos, oportunidades e diferenciais do cliente", async () => {
  const { clara } = createClara();

  const record = await clara.create({
    module: "CompetitionContext",
    title: "Concorrência Rumo ao Altar",
    payload: {
      clientId: CLIENT_ID,
      competitors: [{ name: "Concorrente A", strengths: ["Marca conhecida"], weaknesses: ["Cobra taxa sobre presentes"] }],
      opportunities: ["Posicionar taxa zero como diferencial central."],
      clientDifferentiators: ["Taxa zero", "Painel em tempo real"],
    },
    audit: audit(),
  });

  assert.equal(record.payload.competitors[0].name, "Concorrente A");
  assert.deepEqual(record.payload.clientDifferentiators, ["Taxa zero", "Painel em tempo real"]);
});

// ---------------------------------------------------------------------------------------------
// Módulo 8 — Playbook (novo módulo; "histórico de mudanças" vem de graça do versionamento genérico)
// ---------------------------------------------------------------------------------------------

test("Módulo 8 (Playbook): PlaybookContext registra regras, boas práticas e campanhas aprovadas/reprovadas, e o histórico de mudanças usa o versionamento genérico da Clara (sem campo próprio)", async () => {
  const { clara } = createClara();

  const created = await clara.create({
    module: "PlaybookContext",
    title: "Playbook Rumo ao Altar",
    payload: {
      clientId: CLIENT_ID,
      brandRules: ["Nunca prometer garantia absoluta."],
      bestPractices: ["Sempre incluir CTA com o domínio do site."],
      campaignExamples: ["Campanha de taxa zero (jul/2026)"],
      approvedCampaigns: ["Campanha de taxa zero (jul/2026)"],
      rejectedCampaigns: [],
      importantDecisions: ["Eduardo passou a ser a única autoridade sobre o formato da peça."],
    },
    audit: audit("Cadastro inicial do playbook"),
  });
  assert.equal(created.currentVersion, 1);
  assert.equal(created.history.length, 1);
  assert.equal(created.history[0].action, "created");

  const updated = await clara.update({
    id: created.id,
    patch: { rejectedCampaigns: ["Campanha com comparação agressiva de concorrente"] },
    audit: audit("Registro de campanha reprovada"),
  });

  // Histórico de mudanças: nenhum campo próprio do Playbook — usa versions/history genéricos,
  // já existentes para qualquer módulo da Clara (ver docs/clara-knowledge-center.md).
  assert.equal(updated.currentVersion, 2);
  assert.equal(updated.versions.length, 2);
  assert.equal(updated.history.length, 2);
  assert.equal(updated.history[1].action, "updated");
  assert.equal(updated.history[1].reason, "Registro de campanha reprovada");
  assert.deepEqual(updated.payload.rejectedCampaigns, ["Campanha com comparação agressiva de concorrente"]);
  // Campos não tocados pelo patch permanecem intactos (merge raso sobre o payload existente).
  assert.deepEqual(updated.payload.brandRules, ["Nunca prometer garantia absoluta."]);

  const oldVersion = await clara.getVersion(created.id, 1);
  assert.deepEqual(oldVersion.payload.rejectedCampaigns, []);
});

// ---------------------------------------------------------------------------------------------
// Módulo 6 — Aprendizado (integração automática com o Quality Feedback)
// ---------------------------------------------------------------------------------------------

function baseSubmission(overrides = {}) {
  return {
    executionId: "workflow-execution-0001",
    clientId: CLIENT_ID,
    contentType: "imagem",
    format: "carrossel",
    skillsUsed: ["eduardo-editorial-planning", "joao-marketing-strategy", "pedro-image-generation"],
    rating: { kind: "score", value: 9 },
    ...overrides,
  };
}

function createQualityFeedbackCenter() {
  return new QualityFeedbackCenter({
    repository: new InMemoryQualityFeedbackRepository(),
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-12T12:00:00.000Z"),
  });
}

test("Módulo 6 (Aprendizado): buildLearningContextPayload traduz um QualityFeedbackReport em LearningContext sem decidir nada por conta própria", () => {
  const report = {
    generatedAt: "2026-07-12T12:00:00.000Z",
    totalFeedbackCount: 2,
    overallAverageScore: 7.5,
    averageByFormat: [{ key: "carrossel", averageScore: 9, count: 1 }, { key: "story", averageScore: 6, count: 1 }],
    averageBySkill: [],
    averageByCampaign: [],
    qualityOverTime: [{ period: "2026-07", averageScore: 7.5, count: 2 }],
    bestRatedContent: [{ executionId: "exec-1", clientId: CLIENT_ID, format: "carrossel", overallScore: 9, submittedAt: "2026-07-12T12:00:00.000Z" }],
    worstRatedContent: [{ executionId: "exec-2", clientId: CLIENT_ID, format: "story", overallScore: 6, submittedAt: "2026-07-12T12:00:00.000Z", comment: "CTA fraco." }],
    topRecurringComplaints: [{ category: "cta", count: 1, ratio: 0.5 }],
  };

  const payload = buildLearningContextPayload(CLIENT_ID, report, () => new Date("2026-07-12T13:00:00.000Z"));

  assert.equal(payload.clientId, CLIENT_ID);
  assert.deepEqual(payload.bestRatedContent, [{ executionId: "exec-1", format: "carrossel", score: 9 }]);
  assert.deepEqual(payload.rejectedContent, [{ executionId: "exec-2", format: "story", score: 6, reasons: ["CTA fraco."] }]);
  assert.ok(payload.recurringPatterns[0].includes("cta"));
  assert.deepEqual(payload.qualityEvolution, [{ period: "2026-07", averageScore: 7.5 }]);
  assert.ok(payload.futureRecommendations.length > 0);
  assert.equal(payload.lastSyncedAt, "2026-07-12T13:00:00.000Z");
});

test("Módulo 6 (Aprendizado): syncQualityFeedbackToClara cria o LearningContext na primeira sincronização e atualiza (nova versão) nas seguintes", async () => {
  const { clara } = createClara();
  const qualityFeedback = createQualityFeedbackCenter();

  await qualityFeedback.record(baseSubmission({ executionId: "exec-1", format: "carrossel", rating: { kind: "score", value: 9 } }));

  const firstSync = await syncQualityFeedbackToClara({ clara, qualityFeedback, clientId: CLIENT_ID, now: () => new Date("2026-07-12T13:00:00.000Z") });
  assert.equal(firstSync.module, "LearningContext");
  assert.equal(firstSync.currentVersion, 1);
  assert.equal(firstSync.payload.bestRatedContent.length, 1);

  await qualityFeedback.record(baseSubmission({ executionId: "exec-2", format: "story", rating: { kind: "score", value: 4 }, comment: "Legenda fraca." }));

  const secondSync = await syncQualityFeedbackToClara({ clara, qualityFeedback, clientId: CLIENT_ID, now: () => new Date("2026-07-12T14:00:00.000Z") });
  // Mesmo registro (mesmo id), agora na versão 2 — não cria um segundo LearningContext para o mesmo cliente.
  assert.equal(secondSync.id, firstSync.id);
  assert.equal(secondSync.currentVersion, 2);
  assert.equal(secondSync.payload.lastSyncedAt, "2026-07-12T14:00:00.000Z");

  const allLearningRecords = await clara.list({ clientId: CLIENT_ID, module: "LearningContext" });
  assert.equal(allLearningRecords.length, 1);
});

// ---------------------------------------------------------------------------------------------
// Fallback seguro e compatibilidade — novos módulos não quebram clientes antigos
// ---------------------------------------------------------------------------------------------

test("requestContext sem registros do novo módulo devolve lista vazia, nunca lança erro (fallback seguro)", async () => {
  const { clara } = createClara();
  await clara.create({ module: "BrandContext", title: "Marca", payload: { clientId: CLIENT_ID, brandName: "Rumo ao Altar" }, audit: audit() });

  const context = await clara.requestContext({
    requester: actor(),
    clientId: CLIENT_ID,
    modules: ["MarketingContext", "CompetitionContext", "PlaybookContext", "LearningContext"],
    reason: "Teste de fallback",
  });

  assert.equal(context.records.length, 0);
  assert.equal(context.modules.MarketingContext, undefined);
  assert.equal(context.modules.CompetitionContext, undefined);
});

test("Uma Skill que não atualizou sua lista de módulos continua sem ver os novos módulos (nenhuma mudança de comportamento sem edição explícita na própria Skill)", async () => {
  const { clara } = createClara();
  await clara.create({ module: "BrandContext", title: "Marca", payload: { clientId: CLIENT_ID, brandName: "Rumo ao Altar" }, audit: audit() });
  await clara.create({ module: "MarketingContext", title: "Marketing", payload: { clientId: CLIENT_ID, usedThemes: ["taxa zero"] }, audit: audit() });

  // Simula uma Skill "antiga" pedindo só o que ela já pedia antes desta evolução.
  const context = await clara.requestContext({
    requester: actor(),
    clientId: CLIENT_ID,
    modules: ["BrandContext"],
    reason: "Simulação de Skill não atualizada",
  });

  assert.equal(context.records.length, 1);
  assert.equal(context.modules.BrandContext.length, 1);
  assert.equal(context.modules.MarketingContext, undefined);
});

test("Novos módulos aparecem em requestContext quando nenhum filtro de módulos é informado (comportamento padrão, hoje não usado por nenhuma Skill real)", async () => {
  const { clara } = createClara();
  await clara.create({ module: "PlaybookContext", title: "Playbook", payload: { clientId: CLIENT_ID, brandRules: ["regra 1"] }, audit: audit() });

  const context = await clara.requestContext({ requester: actor(), clientId: CLIENT_ID, reason: "Sem filtro de módulos" });

  assert.equal(context.modules.PlaybookContext?.length, 1);
});

test("Registro antigo simulado (sem nenhum campo novo em BrandContext/IdentityContext) continua sendo lido normalmente pela Clara", async () => {
  const repository = new InMemoryClaraKnowledgeRepository();
  const { clara } = createClara(repository);

  // Simula exatamente o formato persistido antes desta evolução (sem os campos novos).
  const legacyBrand = await clara.create({
    module: "BrandContext",
    title: "Marca legada",
    payload: { clientId: CLIENT_ID, brandName: "Marca Legada", toneOfVoice: "formal" },
    audit: audit(),
  });
  const legacyIdentity = await clara.create({
    module: "IdentityContext",
    title: "Identidade legada",
    payload: { clientId: CLIENT_ID, colors: ["#000000"] },
    audit: audit(),
  });

  const fetchedBrand = await clara.get({ id: legacyBrand.id });
  const fetchedIdentity = await clara.get({ id: legacyIdentity.id });

  assert.equal(fetchedBrand.payload.brandName, "Marca Legada");
  assert.equal(fetchedBrand.payload.mission, undefined);
  assert.equal(fetchedIdentity.payload.colors[0], "#000000");
  assert.equal(fetchedIdentity.payload.composition, undefined);
});
