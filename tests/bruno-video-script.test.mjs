import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  BrunoVideoScriptSkill,
  buildBaselineScript,
  buildVanessaBriefing,
  brunoVideoScriptManifest,
} from "../dist/skills/bruno-video-script/index.js";

const CLIENT_ID = "client-casamento-1";
const TENANT_ID = "tenant-casamento-1";

function claraRecord(module, payload, overrides = {}) {
  return {
    id: overrides.id ?? `${module}-1`,
    module,
    clientId: payload.clientId,
    title: overrides.title ?? module,
    status: "active",
    currentVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    payload,
    versions: [],
    history: [],
    tags: [],
  };
}

function fullKnowledgeBase() {
  return {
    BrandContext: [
      claraRecord("BrandContext", {
        clientId: CLIENT_ID,
        brandName: "Rumo ao Altar",
        promise: "Casamentos organizados com leveza e sem burocracia.",
        toneOfVoice: "leve divertido persuasivo",
      }),
    ],
    AudienceContext: [
      claraRecord("AudienceContext", {
        clientId: CLIENT_ID,
        targetAudience: "Noivos e convidados de casamento",
      }),
    ],
    ContentContext: [
      claraRecord("ContentContext", {
        clientId: CLIENT_ID,
        publicationHistory: [
          { publicationId: "pub-1", channel: "instagram", publishedAt: "2026-06-01T00:00:00.000Z" },
        ],
      }),
    ],
    PublishingContext: [
      claraRecord("PublishingContext", {
        clientId: CLIENT_ID,
        approvalFlow: "Aprovação obrigatória do time de marketing antes de publicar.",
      }),
    ],
  };
}

class FakeValentina {
  constructor(tenants = []) {
    this.tenants = tenants;
    this.getClientContextCalls = [];
    this.getTenantCalls = [];
  }

  async getClientContext(tenantId) {
    this.getClientContextCalls.push(tenantId);
    const tenant = this.tenants.find((candidate) => candidate.id === tenantId);
    if (!tenant) throw new Error(`Cliente ${tenantId} não encontrado pela Valentina.`);
    return toClientContext(tenant);
  }

  async getTenant(query) {
    this.getTenantCalls.push(query);
    return this.tenants.find((candidate) => candidate.clientId === query.clientId);
  }
}

function toClientContext(tenant) {
  return {
    tenantId: tenant.id,
    clientId: tenant.clientId,
    plan: tenant.plan ?? "PRO",
    status: "active",
    subscriptionStatus: "active",
    timezone: "America/Sao_Paulo",
    language: "pt-BR",
    country: "BR",
    environment: "production",
    enabledSpecialists: "all",
    enabledFeatures: "all",
    planLimits: {},
  };
}

class FakeClara {
  constructor(recordsByModule = {}) {
    this.recordsByModule = recordsByModule;
    this.requestContextCalls = [];
  }

  async requestContext(request) {
    this.requestContextCalls.push(request);
    const modules = {};
    let records = [];
    for (const moduleName of request.modules ?? Object.keys(this.recordsByModule)) {
      const moduleRecords = this.recordsByModule[moduleName] ?? [];
      if (moduleRecords.length > 0) {
        modules[moduleName] = moduleRecords;
        records = records.concat(moduleRecords);
      }
    }
    return {
      clientId: request.clientId,
      deliveredAt: "2026-07-02T12:00:00.000Z",
      modules,
      records,
    };
  }
}

class FakeIcaroBrain {
  constructor(responses) {
    this.responses = [...responses];
    this.calls = [];
  }

  async request(request) {
    this.calls.push(request);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return {
      status: "completed",
      provider: { id: "fake-ai-provider", name: "Fake AI Provider" },
      model: { id: "fake-script-model" },
      durationMs: 3,
      tokens: { input: request.prompt.length, output: 80, total: request.prompt.length + 80 },
      cost: { estimated: 0.01, currency: "USD" },
      content: next ?? enhancementJson(),
      warnings: [],
      attempt: { total: 1, providerAttempt: 1, providerId: "fake-ai-provider" },
      fallbackUsed: false,
    };
  }
}

function enhancementJson() {
  return JSON.stringify({
    narrativeStructure: "Curiosidade → Revelação → CTA: abre com uma pergunta inusitada sobre presentes de casamento.",
    hook: "Você sabia que dá pra receber presente de casamento via Pix sem pagar taxa nenhuma?",
    overallRhythm: "Ritmo ágil do início ao fim, sem quedas de energia entre as cenas.",
    musicSuggestions: ["Trilha eletrônica leve, com batida constante do início ao fim."],
    finalCta: "Crie sua lista agora no Rumo ao Altar",
  });
}

class InMemoryBrunoLogger {
  constructor() {
    this.entries = [];
  }

  async record(entry) {
    this.entries.push(entry);
  }

  list() {
    return [...this.entries];
  }
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

function createJoaoStrategy(overrides = {}) {
  return {
    overallStrategy: "Estratégia para instagram com foco em vender o pacote all-inclusive.",
    objective: "vender o pacote all-inclusive",
    targetAudience: "Noivos e convidados de casamento",
    channel: "instagram",
    format: "reels",
    toneOfVoice: "leve divertido persuasivo",
    angle: "Ângulo de conversão com benefício direto e chamada clara para ação.",
    centralPromise: "Receber presentes de casamento via Pix sem pagar taxa nenhuma.",
    valueProposition: "Lista de presentes via Pix sem taxas escondidas.",
    keyMessages: ["Taxa zero na lista de presentes.", "Dinheiro cai direto na conta dos noivos."],
    recommendedCta: "Crie sua lista agora no Rumo ao Altar",
    observations: [],
    risks: [],
    nextSteps: [],
    ...overrides,
  };
}

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero um roteiro de reels sobre taxa zero na lista de presentes.",
    joaoStrategy: createJoaoStrategy(),
    channel: "instagram",
    format: "reels",
    videoObjective: "explicar que a lista de presentes via Pix não cobra taxa",
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "bruno-video-script",
    input,
    context: {
      executionId: "exec-bruno",
      taskId: "task-script",
      correlationId: "corr-bruno",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createBruno(overrides = {}) {
  const valentina = overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = overrides.clara ?? new FakeClara(fullKnowledgeBase());
  const logger = overrides.logger ?? new InMemoryBrunoLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const bruno = new BrunoVideoScriptSkill({
    valentina,
    clara,
    icaro: overrides.icaro,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-08T12:00:00.000Z"),
  });
  return { bruno, valentina, clara, logger, events };
}

test("Bruno possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(brunoVideoScriptManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "bruno-video-script");
  assert.deepEqual(result.manifest.capabilities, ["video_script"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("Bruno consulta Valentina para resolver o cliente por tenantId e por clientId", async () => {
  const { bruno, valentina } = createBruno();

  await bruno.execute(createRequest(createInput({ clientId: undefined, tenantId: TENANT_ID })));
  assert.deepEqual(valentina.getClientContextCalls, [TENANT_ID]);

  await bruno.execute(createRequest(createInput()));
  assert.ok(valentina.getTenantCalls.some((query) => query.clientId === CLIENT_ID));
});

test("Bruno consulta Clara com os módulos de marca, público, conteúdo e publicação", async () => {
  const { bruno, clara } = createBruno();

  await bruno.execute(createRequest());

  assert.equal(clara.requestContextCalls.length, 1);
  assert.deepEqual(clara.requestContextCalls[0].modules, [
    "BrandContext",
    "AudienceContext",
    "ContentContext",
    "PublishingContext",
  ]);
  assert.equal(clara.requestContextCalls[0].requester.type, "specialist");
  assert.equal(clara.requestContextCalls[0].clientId, CLIENT_ID);
});

test("Bruno funciona sem Ícaro configurado e ainda gera roteiro estruturado", async () => {
  const { bruno, logger } = createBruno();

  const response = await bruno.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportSkipped"));
});

test("Bruno usa Ícaro de forma opcional para aprimorar o roteiro quando disponível", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { bruno, logger, events } = createBruno({ icaro });

  const response = await bruno.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, true);
  assert.equal(icaro.calls.length, 1);
  assert.equal(icaro.calls[0].taskType, "analysis");
  assert.equal(icaro.calls[0].specialistId, "bruno-video-script");
  assert.equal(response.output.hook, "Você sabia que dá pra receber presente de casamento via Pix sem pagar taxa nenhuma?");
  assert.deepEqual(response.output.musicSuggestions, ["Trilha eletrônica leve, com batida constante do início ao fim."]);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportRequested"));
  assert.ok(logger.list().some((entry) => entry.action === "AISupportApplied"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationStarted"));
  assert.ok(events.list().some((event) => event.name === "AIGenerationFinished"));
});

test("Bruno segue com a base heurística quando o Ícaro falha, sem interromper a execução", async () => {
  const icaro = new FakeIcaroBrain([new Error("Provider indisponível")]);
  const { bruno, logger } = createBruno({ icaro });

  const response = await bruno.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.aiSupportUsed, false);
  assert.ok(logger.list().some((entry) => entry.action === "AISupportFailed"));
});

test("Bruno nunca deixa o Ícaro redefinir as cenas: scenes permanece o construído por heurística mesmo com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { bruno } = createBruno({ icaro });

  const response = await bruno.execute(createRequest());

  assert.ok(Array.isArray(response.output.scenes));
  assert.ok(response.output.scenes.length >= 3);
  assert.equal(response.output.scenes[0].name, "Gancho");
  assert.equal(response.output.scenes[response.output.scenes.length - 1].name, "CTA final");
});

test("Bruno gera roteiro estruturado completo a partir da estratégia do João e do contexto da Clara", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(createRequest());

  const output = response.output;
  assert.ok(output.narrativeStructure.length > 0);
  assert.ok(output.hook.includes("Receber presentes de casamento via Pix sem pagar taxa nenhuma"));
  assert.equal(output.totalDurationSeconds, 30);
  assert.ok(Array.isArray(output.scenes));
  assert.ok(output.overallRhythm.length > 0);
  assert.ok(output.musicSuggestions.length > 0);
  assert.equal(output.finalCta, "Crie sua lista agora no Rumo ao Altar");
  assert.ok(output.recordingNotes.length > 0);
  assert.ok(output.editingNotes.length > 0);
  assert.ok(output.risks.length > 0);
  assert.ok(Array.isArray(output.observations));
  assert.ok(output.nextSteps.length > 0);
  assert.equal(response.artifacts[0].type, "plan");
});

test("Bruno assume 30 segundos de duração por padrão quando desiredDurationSeconds não é informado", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(createRequest());

  assert.equal(response.output.totalDurationSeconds, 30);
});

test("Bruno respeita desiredDurationSeconds quando informado", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(createRequest(createInput({ desiredDurationSeconds: 60 })));

  assert.equal(response.output.totalDurationSeconds, 60);
});

test("Bruno constrói cenas cuja soma de duração bate exatamente com a duração total, sempre com gancho no início e CTA final no fim", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(createRequest(createInput({ desiredDurationSeconds: 45 })));

  const scenes = response.output.scenes;
  const totalScenesDuration = scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
  assert.equal(totalScenesDuration, 45);
  assert.equal(scenes[0].name, "Gancho");
  assert.equal(scenes[scenes.length - 1].name, "CTA final");
  assert.equal(scenes[scenes.length - 1].spokenText, "Crie sua lista agora no Rumo ao Altar.");

  scenes.forEach((scene, index) => {
    assert.equal(scene.order, index + 1);
    assert.ok(scene.spokenText.length > 0);
    assert.ok(Array.isArray(scene.brollSuggestions));
    assert.ok(scene.framing.length > 0);
    assert.ok(scene.cameraMovement.length > 0);
    assert.ok(["lento", "moderado", "dinamico", "acelerado"].includes(scene.rhythm));
    assert.ok(Array.isArray(scene.soundEffectSuggestions));
  });
});

test("Bruno preserva tema site oficial e não coloca notas internas nos textos públicos", async () => {
  const { bruno } = createBruno();
  const response = await bruno.execute(
    createRequest(
      createInput({
        originalRequest: "Crie um Reels: Seu casamento merece um site oficial. Mostre RSVP, lista de presentes, álbum colaborativo, cronograma e informações para convidados.",
        joaoStrategy: createJoaoStrategy({
          objective: "Seu casamento merece um site oficial.",
          centralPromise: "Seu casamento merece um site oficial.",
          valueProposition: "Tudo organizado em um único lugar para noivos e convidados.",
          keyMessages: ["RSVP organizado.", "Lista de presentes.", "Álbum colaborativo.", "Cronograma e informações."],
          recommendedCta: "Conheça o Rumo ao Altar",
        }),
      }),
    ),
  );

  const scenes = response.output.scenes;
  const combinedPublicText = scenes.flatMap((scene) => [
    scene.spokenText,
    scene.publicVisibleText,
    scene.publicSubtitle,
    scene.onScreenText,
  ]).filter(Boolean).join(" ");

  assert.equal(scenes.length, 7);
  assert.deepEqual(scenes.map((scene) => scene.narrativeIntensity), [
    "impacto",
    "descoberta",
    "demonstracao",
    "beneficio",
    "prova",
    "convite",
    "cta",
  ]);
  assert.deepEqual(scenes.map((scene) => scene.sceneFunction), [
    "hook",
    "build",
    "payoff",
    "release",
    "build",
    "payoff",
    "cta",
  ]);
  // Duração nasce da narrativa, nunca de fatias iguais — mesmo com 5 cenas "do meio", a duração
  // delas não é toda idêntica.
  assert.ok(new Set(scenes.map((scene) => scene.durationSeconds)).size > 1);
  assert.match(combinedPublicText, /site oficial/i);
  assert.match(combinedPublicText, /RSVP/i);
  assert.match(combinedPublicText, /Presentes/i);
  assert.match(combinedPublicText, /Cronograma/i);
  assert.doesNotMatch(combinedPublicText, /Desenvolver a mensagem-chave|Abertura de impacto|ângulo estratégico/i);
  assert.ok(scenes.every((scene) => scene.publicVisibleText.length <= 52));
  assert.ok(scenes.every((scene) => scene.publicVisibleText.split(/\s+/).filter(Boolean).length <= 4));
  assert.ok(scenes.every((scene) => !scene.publicSubtitle || scene.publicSubtitle.split(/\s+/).filter(Boolean).length <= 6));
  assert.equal(scenes.at(-1).publicSubtitle, "rumoaoaltar.com.br");
});

test("Bruno cria uma cena de desenvolvimento por mensagem-chave do João, até no máximo três", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(
    createRequest(
      createInput({
        joaoStrategy: createJoaoStrategy({
          keyMessages: ["Mensagem 1.", "Mensagem 2.", "Mensagem 3.", "Mensagem 4.", "Mensagem 5."],
        }),
      }),
    ),
  );

  const developmentScenes = response.output.scenes.filter((scene) => scene.name.startsWith("Desenvolvimento"));
  assert.equal(developmentScenes.length, 3);
});

test("Bruno escreve como roteirista publicitário: cada cena de desenvolvimento tem objetivo emocional, tensão, recompensa, expectativa e payoff, nunca renderizados", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(
    createRequest(
      createInput({
        joaoStrategy: createJoaoStrategy({
          keyMessages: ["Mensagem 1.", "Mensagem 2.", "Mensagem 3."],
        }),
      }),
    ),
  );

  for (const scene of response.output.scenes) {
    assert.ok(scene.emotionalGoal?.trim().length > 0, `${scene.name} sem emotionalGoal`);
    assert.ok(scene.tension?.trim().length > 0, `${scene.name} sem tension`);
    assert.ok(scene.reward?.trim().length > 0, `${scene.name} sem reward`);
    assert.ok(scene.expectation?.trim().length > 0, `${scene.name} sem expectation`);
    assert.ok(scene.payoff?.trim().length > 0, `${scene.name} sem payoff`);
  }
});

test("Bruno varia o ritmo entre cenas de desenvolvimento (rotação de beats) em vez de sempre usar 'moderado'", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(
    createRequest(
      createInput({
        joaoStrategy: createJoaoStrategy({
          keyMessages: ["Mensagem 1.", "Mensagem 2.", "Mensagem 3."],
        }),
      }),
    ),
  );

  const developmentScenes = response.output.scenes.filter((scene) => scene.name.startsWith("Desenvolvimento"));
  assert.equal(developmentScenes.length, 3);
  const rhythms = developmentScenes.map((scene) => scene.rhythm);
  assert.ok(new Set(rhythms).size > 1, "cenas de desenvolvimento não deveriam ter todas o mesmo ritmo");
});

test("Bruno atribui uma função de comercial a cada cena (hook/build/payoff/release/cta), nunca repetida entre cenas adjacentes", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(
    createRequest(
      createInput({
        joaoStrategy: createJoaoStrategy({
          keyMessages: ["Mensagem 1.", "Mensagem 2.", "Mensagem 3."],
        }),
      }),
    ),
  );

  const functions = response.output.scenes.map((scene) => scene.sceneFunction);
  assert.deepEqual(functions, ["hook", "build", "payoff", "release", "cta"]);
  for (let index = 1; index < functions.length; index += 1) {
    assert.notEqual(functions[index], functions[index - 1], `cena ${index} repete a função da cena anterior`);
  }
});

test("Bruno distribui a duração das cenas proporcionalmente à função de comercial, nunca em fatias iguais", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(
    createRequest(
      createInput({
        joaoStrategy: createJoaoStrategy({
          keyMessages: ["Mensagem 1.", "Mensagem 2.", "Mensagem 3."],
        }),
      }),
    ),
  );

  const durations = response.output.scenes.map((scene) => scene.durationSeconds);
  assert.ok(new Set(durations).size > 1, "as cenas não deveriam ter todas a mesma duração");
  assert.equal(durations.reduce((total, value) => total + value, 0), response.output.totalDurationSeconds);
  // A cena de payoff (a prova/identificação central) é deliberadamente a mais longa do bloco de
  // desenvolvimento — nunca mais curta que build/release, que existem para preparar/desacelerar.
  const [, buildDuration, payoffDuration, releaseDuration] = durations;
  assert.ok(payoffDuration > buildDuration);
  assert.ok(payoffDuration > releaseDuration);
});

test("mergeScriptEnhancement propaga o finalCta aprimorado pela IA para dentro da cena 'CTA final' já construída (spokenText/onScreenText/publicVisibleText)", async () => {
  const icaro = new FakeIcaroBrain([JSON.stringify({
    narrativeStructure: "Curiosidade → Revelação → CTA.",
    hook: "Você sabia que dá pra receber presente de casamento via Pix sem pagar taxa nenhuma?",
    overallRhythm: "Ritmo ágil.",
    musicSuggestions: ["Trilha eletrônica leve."],
    finalCta: "Comece agora mesmo pelo Rumo ao Altar",
  })]);
  const { bruno } = createBruno({ icaro });

  const response = await bruno.execute(createRequest());

  assert.equal(response.output.finalCta, "Comece agora mesmo pelo Rumo ao Altar");
  const ctaScene = response.output.scenes[response.output.scenes.length - 1];
  assert.equal(ctaScene.name, "CTA final");
  // A narração (spokenText) carrega a frase completa; o texto na tela é sempre resumido ao limite
  // de 4 palavras (a narração conta, a tela só reforça — ver COMMERCIAL ENGINE v1).
  assert.ok(ctaScene.spokenText.includes("Comece agora mesmo pelo Rumo ao Altar"));
  assert.equal(ctaScene.onScreenText, "Comece agora mesmo pelo…");
  assert.equal(ctaScene.publicVisibleText, "Comece agora mesmo pelo…");
  assert.ok(ctaScene.onScreenText.split(/\s+/).filter(Boolean).length <= 4);
});

test("Bruno monta briefing estruturado para Vanessa com roteiro completo", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(createRequest());

  const briefing = response.output.vanessaBriefing;
  assert.equal(briefing.status, "preliminary");
  assert.equal(briefing.narrativeStructure, response.output.narrativeStructure);
  assert.equal(briefing.hook, response.output.hook);
  assert.equal(briefing.totalDurationSeconds, response.output.totalDurationSeconds);
  assert.deepEqual(briefing.scenes, response.output.scenes);
  assert.equal(briefing.finalCta, response.output.finalCta);
  assert.equal(briefing.channel, "instagram");
  assert.ok(briefing.notes.some((note) => note.includes("Produção, filmagem, edição, renderização e publicação")));
});

test("Bruno não gera, edita, renderiza ou publica vídeo; devolve apenas roteiro e briefing estruturados", async () => {
  const { bruno } = createBruno();

  const response = await bruno.execute(createRequest());

  assert.equal(response.output.videoUrl, undefined);
  assert.equal(response.output.videoBase64, undefined);
  assert.equal(response.artifacts[0].type, "plan");
  assert.notEqual(response.artifacts[0].type, "video");
});

test("Bruno trata erro quando o cliente não é encontrado pela Valentina", async () => {
  const { bruno, logger, events } = createBruno({ valentina: new FakeValentina([]) });

  const response = await bruno.execute(createRequest(createInput({ clientId: "cliente-inexistente" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "CLIENT_NOT_FOUND");
  assert.ok(logger.list().some((entry) => entry.action === "ClientNotFound"));
  assert.ok(events.list().some((event) => event.name === "VideoScriptFailed"));
});

test("Bruno trata contexto incompleto na Clara como necessidade de mais contexto", async () => {
  const { bruno, logger, events } = createBruno({ clara: new FakeClara({}) });

  const response = await bruno.execute(createRequest());

  assert.equal(response.status, "needs_more_context");
  assert.ok(response.warnings.length > 0);
  assert.ok(logger.list().some((entry) => entry.action === "ContextIncomplete"));
  assert.ok(events.list().some((event) => event.name === "VideoScriptFailed"));
});

test("Bruno valida a solicitação recebida antes de consultar Valentina ou Clara", async () => {
  const { bruno, valentina, clara, logger, events } = createBruno();

  const response = await bruno.execute(createRequest(createInput({ videoObjective: "" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_REQUEST");
  assert.equal(valentina.getTenantCalls.length, 0);
  assert.equal(clara.requestContextCalls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "VideoScriptFailed"));
});

test("Bruno rejeita desiredDurationSeconds inválido (zero, negativo ou não numérico)", async () => {
  const { bruno } = createBruno();

  const zeroResponse = await bruno.execute(createRequest(createInput({ desiredDurationSeconds: 0 })));
  assert.equal(zeroResponse.status, "failed");
  assert.equal(zeroResponse.error.code, "INVALID_REQUEST");

  const negativeResponse = await bruno.execute(createRequest(createInput({ desiredDurationSeconds: -10 })));
  assert.equal(negativeResponse.status, "failed");
  assert.equal(negativeResponse.error.code, "INVALID_REQUEST");
});

test("Bruno registra os logs esperados em uma execução completa", async () => {
  const { bruno, logger } = createBruno();

  await bruno.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("RequestReceived"));
  assert.ok(actions.includes("ClientResolved"));
  assert.ok(actions.includes("ContextConsulted"));
  assert.ok(actions.includes("ScriptStarted"));
  assert.ok(actions.includes("ScriptFinalized"));
  assert.ok(actions.includes("VanessaBriefingCreated"));
});

test("Bruno emite os eventos esperados em uma execução completa com apoio de IA", async () => {
  const icaro = new FakeIcaroBrain([enhancementJson()]);
  const { bruno, events } = createBruno({ icaro });

  await bruno.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "VideoScriptStarted",
    "VideoScriptContextLoaded",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "VideoScriptGenerated",
    "VanessaBriefingCreated",
  ]);
});

test("buildBaselineScript e buildVanessaBriefing são puros e reutilizáveis", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "bruno-video-script", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const input = createInput();

  const script = buildBaselineScript(input, context);
  assert.equal(script.finalCta, "Crie sua lista agora no Rumo ao Altar");

  const briefing = buildVanessaBriefing(script, input);
  assert.equal(briefing.status, "preliminary");
});

test("Bruno deriva o Creative DNA da campanha e o usa no gancho e nas notas de gravação", async () => {
  const clara = new FakeClara(fullKnowledgeBase());
  const context = await clara.requestContext({
    requester: { id: "bruno-video-script", type: "specialist" },
    clientId: CLIENT_ID,
  });
  const input = createInput();

  const script = buildBaselineScript(input, context);

  assert.ok(script.creativeDna);
  assert.ok(script.creativeDna.emotionalHook.length > 0);
  assert.ok(script.creativeDna.heroScene.length > 0);
  assert.ok(script.hook.includes(script.creativeDna.emotionalHook));
  assert.ok(script.recordingNotes.some((note) => note.includes(script.creativeDna.heroScene)));
});

test("Bruno não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/bruno-video-script/bruno-video-script.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});

test("Bruno não chama Vanessa (ou qualquer outra Skill) diretamente nem acessa storage diretamente", async () => {
  const source = await readFile("src/skills/bruno-video-script/bruno-video-script.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  // Bruno monta um briefing PARA a futura Vanessa (daí referências a "vanessaBriefing"), mas
  // nunca deve importar, instanciar ou executar nenhuma outra Skill concreta.
  assert.equal(lowered.includes("vanessa-video-production"), false);
  assert.equal(lowered.includes("vanessavideoproductionskill"), false);
  assert.equal(lowered.includes("createvanessa"), false);
  assert.equal(lowered.includes("joao-marketing-strategy"), false);
  assert.equal(lowered.includes("joaomarketingstrategyskill"), false);
  assert.equal(lowered.includes("createjoaomarketingstrategyskill"), false);
  assert.equal(lowered.includes("node:fs"), false);
  assert.equal(lowered.includes("infrastructure/storage"), false);
  assert.equal(lowered.includes("storageport"), false);
});

test("Bruno não gera, edita, renderiza ou publica vídeo em código: nenhum uso de child_process, ffmpeg ou providers de vídeo", async () => {
  const source = await readFile("src/skills/bruno-video-script/bruno-video-script.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.equal(lowered.includes("child_process"), false);
  assert.equal(lowered.includes("ffmpeg"), false);
  assert.equal(lowered.includes("spawn("), false);
  assert.equal(lowered.includes("execsync("), false);
});


// ---------------------------------------------------------------------------------------------
// AGENCY FILM PIPELINE 2.0 — Shot Planning por cena
// ---------------------------------------------------------------------------------------------

test("AGENCY FILM PIPELINE 2.0: cada cena de Bruno é composta por pelo menos 2 Shots", async () => {
  const { bruno } = createBruno();
  const response = await bruno.execute(createRequest(createInput({ desiredDurationSeconds: 45 })));
  const scenes = response.output.scenes;
  assert.ok(scenes.length > 0);
  for (const scene of scenes) {
    assert.ok(Array.isArray(scene.shots), `cena ${scene.name} sem shots`);
    assert.ok(scene.shots.length >= 2, `cena ${scene.name} tem apenas ${scene.shots.length} Shot(s), mínimo é 2`);
  }
});

test("AGENCY FILM PIPELINE 2.0: soma da duração dos Shots é igual à duração da cena", async () => {
  const { bruno } = createBruno();
  const response = await bruno.execute(createRequest(createInput({ desiredDurationSeconds: 45 })));
  for (const scene of response.output.scenes) {
    const shotsSum = scene.shots.reduce((total, shot) => total + shot.durationSeconds, 0);
    assert.ok(
      Math.abs(shotsSum - scene.durationSeconds) < 0.02,
      `cena ${scene.name}: soma dos Shots ${shotsSum}s difere da duração ${scene.durationSeconds}s`,
    );
  }
});

test("AGENCY FILM PIPELINE 2.0: Shots de uma cena têm propósitos distintos e nenhum adjacente igual", async () => {
  const { bruno } = createBruno();
  const response = await bruno.execute(createRequest(createInput({ desiredDurationSeconds: 45 })));
  for (const scene of response.output.scenes) {
    for (let i = 1; i < scene.shots.length; i++) {
      assert.notEqual(
        scene.shots[i].purpose,
        scene.shots[i - 1].purpose,
        `cena ${scene.name}: Shots adjacentes ${i - 1}->${i} têm mesmo propósito ${scene.shots[i].purpose}`,
      );
    }
  }
});

test("AGENCY FILM PIPELINE 2.0: cada Shot tem cinematografia, motion com motivação e transição definidas", async () => {
  const { bruno } = createBruno();
  const response = await bruno.execute(createRequest(createInput({ desiredDurationSeconds: 30 })));
  for (const scene of response.output.scenes) {
    for (const shot of scene.shots) {
      assert.ok(shot.cinematography, `Shot ${shot.id} sem cinematografia`);
      assert.ok(shot.cinematography.shotType, `Shot ${shot.id} sem shotType`);
      assert.ok(shot.assetRequirement, `Shot ${shot.id} sem assetRequirement`);
      assert.ok(shot.assetRequirement.sequenceRole, `Shot ${shot.id} sem sequenceRole no assetRequirement`);
      assert.ok(shot.motion?.entrance, `Shot ${shot.id} sem motion.entrance`);
      assert.ok(shot.motion?.action, `Shot ${shot.id} sem motion.action`);
      assert.ok(shot.motion?.exit, `Shot ${shot.id} sem motion.exit`);
      assert.ok(shot.motion.motivation?.length > 0, `Shot ${shot.id} sem motivação de movimento`);
      assert.ok(shot.transitionFromPrevious, `Shot ${shot.id} sem transitionFromPrevious`);
      assert.ok(shot.transitionToNext, `Shot ${shot.id} sem transitionToNext`);
      assert.ok(shot.id.startsWith(`s${scene.order}-shot-`), `Shot ${shot.id} não segue convenção de id da cena ${scene.order}`);
    }
  }
});

test("AGENCY FILM PIPELINE 2.0: Bruno emite log ShotPlanningCompleted em execução bem-sucedida", async () => {
  const { bruno, logger } = createBruno();
  await bruno.execute(createRequest(createInput({ desiredDurationSeconds: 30 })));
  const log = logger.list().find((entry) => entry.action === "ShotPlanningCompleted");
  assert.ok(log, "esperava log ShotPlanningCompleted em execução bem-sucedida");
  assert.ok(typeof log.metadata.totalShots === "number");
  assert.ok(log.metadata.totalShots > 0);
});



