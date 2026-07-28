import test from "node:test";
import assert from "node:assert/strict";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  NoraVideoNarrationSkill,
  buildNarrationPlan,
  noraVideoNarrationManifest,
  validateNarrationAudio,
} from "../dist/skills/nora-video-narration/index.js";

const CLIENT_ID = "client-rumo";
const TENANT_ID = "tenant-rumo";
const EXECUTION_ID = "exec-nora";

function claraRecord(module, payload, overrides = {}) {
  return {
    id: overrides.id ?? `${module}-1`,
    module,
    clientId: payload.clientId,
    title: overrides.title ?? module,
    status: "active",
    currentVersion: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
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
        toneOfVoice: "acolhedor elegante confiante",
      }),
    ],
    AudienceContext: [
      claraRecord("AudienceContext", {
        clientId: CLIENT_ID,
        primaryAudience: "Casais recém-noivos organizando o casamento.",
      }),
    ],
    PublishingContext: [
      claraRecord("PublishingContext", {
        clientId: CLIENT_ID,
        approvalFlow: "Aprovação humana obrigatória antes da publicação.",
      }),
    ],
  };
}

class FakeValentina {
  constructor(tenants = []) {
    this.tenants = tenants;
  }

  async getClientContext(tenantId) {
    const tenant = this.tenants.find((candidate) => candidate.id === tenantId);
    if (!tenant) throw new Error(`Tenant ${tenantId} não encontrado.`);
    return toClientContext(tenant);
  }

  async getTenant(query) {
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
      deliveredAt: "2026-07-01T12:00:00.000Z",
      modules,
      records,
    };
  }
}

class FakeArtifactDelivery {
  constructor() {
    this.files = new Map();
    this.writeCalls = [];
    this.readCalls = [];
  }

  key(executionId, relativePath) {
    return `${executionId}:${relativePath}`;
  }

  seed(executionId, relativePath, bytes) {
    this.files.set(this.key(executionId, relativePath), new Uint8Array(bytes));
  }

  async writeFile(input) {
    this.writeCalls.push(input);
    const bytes = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);
    this.files.set(this.key(input.executionId, input.relativePath), new Uint8Array(bytes));
    return {
      absolutePath: `/fake/artifacts/${input.executionId}/${input.relativePath}`,
      relativePath: input.relativePath,
      sizeBytes: bytes.byteLength,
      mimeType: input.mimeType,
    };
  }

  async createZip() {
    throw new Error("Nora não deveria criar ZIP.");
  }

  async readFile(input) {
    this.readCalls.push(input);
    const data = this.files.get(this.key(input.executionId, input.relativePath));
    if (!data) return undefined;
    return {
      absolutePath: `/fake/artifacts/${input.executionId}/${input.relativePath}`,
      relativePath: input.relativePath,
      sizeBytes: data.byteLength,
      data,
    };
  }
}

class InMemoryNoraLogger {
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

function createInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Crie um Reels sobre por que seu casamento merece um site oficial.",
    videoObjective: "Seu casamento merece um site oficial.",
    channel: "instagram",
    format: "reels",
    joaoStrategy: {
      objective: "Mostrar organização e tranquilidade com um site oficial de casamento.",
      targetAudience: "Casais recém-noivos.",
      toneOfVoice: "acolhedor elegante confiante",
      keyMessages: ["Site oficial", "RSVP", "Presentes", "Álbum colaborativo"],
      recommendedCta: "Conheça o Rumo ao Altar",
    },
    brunoScript: {
      hook: "Seu casamento merece um lugar só dele.",
      totalDurationSeconds: 12,
      scenes: [
        {
          order: 1,
          name: "Gancho",
          startSeconds: 0,
          durationSeconds: 4,
          spokenText: "Seu casamento merece um lugar só dele.",
          onScreenText: "Site oficial do casamento",
          publicVisibleText: "Site oficial do casamento",
          publicSubtitle: "Tudo começa organizado.",
          narrativeIntensity: "impacto",
        },
        {
          order: 2,
          name: "Demonstração",
          startSeconds: 4,
          durationSeconds: 4,
          spokenText: "RSVP, presentes e fotos ficam em um único lugar.",
          onScreenText: "Tudo em um só lugar",
          publicVisibleText: "Tudo em um só lugar",
          publicSubtitle: "RSVP, presentes e fotos.",
          narrativeIntensity: "demonstracao",
        },
        {
          order: 3,
          name: "CTA",
          startSeconds: 8,
          durationSeconds: 4,
          spokenText: "Conheça o Rumo ao Altar.",
          onScreenText: "Conheça o Rumo ao Altar",
          publicVisibleText: "Conheça o Rumo ao Altar",
          publicSubtitle: "rumoaoaltar.com.br",
          narrativeIntensity: "cta",
        },
      ],
      finalCta: "Conheça o Rumo ao Altar",
      channel: "instagram",
    },
    vanessaDirection: {
      visualRhythm: "Gancho elegante, demonstração clara e CTA confiante.",
      captionStyle: "Palavras-chave na tela, sem repetir a locução.",
      channel: "instagram",
      sceneDirections: [
        { order: 1, name: "Gancho" },
        { order: 2, name: "Demonstração" },
        { order: 3, name: "CTA" },
      ],
    },
    diegoEditingPlan: {
      totalDurationSeconds: 12,
      channel: "instagram",
      editingTimeline: [
        { order: 1, name: "Gancho", startSeconds: 0, endSeconds: 4, durationSeconds: 4, publicVisibleText: "Site oficial", publicSubtitle: "Do jeito de vocês", narrativeIntensity: "impacto", shotTimeline: [
          { shotId: "s1-shot-1", shotOrder: 1, startSeconds: 0, endSeconds: 2, durationSeconds: 2, purpose: "detail" },
          { shotId: "s1-shot-2", shotOrder: 2, startSeconds: 2, endSeconds: 4, durationSeconds: 2, purpose: "reaction" },
        ] },
        { order: 2, name: "Demonstração", startSeconds: 4, endSeconds: 8, durationSeconds: 4, publicVisibleText: "Tudo organizado", publicSubtitle: "RSVP, Pix e fotos", narrativeIntensity: "demonstracao", shotTimeline: [
          { shotId: "s2-shot-1", shotOrder: 1, startSeconds: 4, endSeconds: 6, durationSeconds: 2, purpose: "establishing" },
          { shotId: "s2-shot-2", shotOrder: 2, startSeconds: 6, endSeconds: 8, durationSeconds: 2, purpose: "detail" },
        ] },
        { order: 3, name: "CTA", startSeconds: 8, endSeconds: 12, durationSeconds: 4, publicVisibleText: "Conheça o Rumo ao Altar", publicSubtitle: "rumoaoaltar.com.br", narrativeIntensity: "cta", shotTimeline: [
          { shotId: "s3-shot-1", shotOrder: 1, startSeconds: 8, endSeconds: 10, durationSeconds: 2, purpose: "product" },
          { shotId: "s3-shot-2", shotOrder: 2, startSeconds: 10, endSeconds: 12, durationSeconds: 2, purpose: "closing" },
        ] },
      ],
    },
    ...overrides,
  };
}

function createRequest(input = createInput()) {
  return {
    skillId: "nora-video-narration",
    input,
    context: {
      executionId: EXECUTION_ID,
      taskId: "task-narration",
      correlationId: "corr-nora",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function createNora(overrides = {}) {
  const artifactDelivery = overrides.artifactDelivery ?? new FakeArtifactDelivery();
  const logger = overrides.logger ?? new InMemoryNoraLogger();
  const events = overrides.events ?? new InMemoryZunoEventRecorder();
  const nora = new NoraVideoNarrationSkill({
    valentina: overrides.valentina ?? new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID }]),
    clara: overrides.clara ?? new FakeClara(fullKnowledgeBase()),
    artifactDelivery,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-01T12:00:00.000Z"),
  });
  return { nora, artifactDelivery, logger, events };
}

function createValidWav(durationSeconds = 10, sampleRate = 44100) {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const samples = Math.floor(durationSeconds * sampleRate);
  const dataSize = samples * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 220) * 7000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return new Uint8Array(buffer);
}

function createSilentWav(durationSeconds = 4, sampleRate = 44100) {
  const wav = Buffer.from(createValidWav(durationSeconds, sampleRate));
  wav.fill(0, 44);
  return new Uint8Array(wav);
}

test("Nora possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(noraVideoNarrationManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "nora-video-narration");
  assert.deepEqual(result.manifest.capabilities, ["video_narration"]);
  assert.equal(result.manifest.enabled, true);
});

test("Nora gera script segmentado por cena e não apenas repete as headlines", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const plan = buildNarrationPlan(createInput(), context);

  assert.equal(plan.voiceProfile.language, "pt-BR");
  assert.equal(plan.segments.length, 3);
  assert.ok(plan.narrationScript.includes("casamento"));
  assert.ok(plan.segments.every((segment) => segment.text.length > 0));
  assert.notEqual(plan.segments[0].text, createInput().diegoEditingPlan.editingTimeline[0].publicVisibleText);
  assert.ok(plan.segments.every((segment) => segment.endTime > segment.startTime));
});

test("Nora deriva o Creative DNA da campanha e o usa nas instruções ao provider de voz", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const plan = buildNarrationPlan(createInput(), context);

  assert.ok(plan.creativeDna);
  assert.ok(plan.creativeDna.dominantEmotion.length > 0);
  assert.ok(plan.providerInstructions.some((line) => line.includes(plan.creativeDna.dominantEmotion) && line.includes("Creative DNA")));
});

test("Nora gera marcadores explícitos de entrega por segmento: intensidade, sorriso, surpresa e silêncio dramático", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const plan = buildNarrationPlan(createInput(), context);

  const [hook, demonstration, cta] = plan.segments;

  assert.equal(hook.intensity, "impacto");
  assert.equal(hook.surprise, true);
  assert.equal(hook.smile, false);
  assert.equal(hook.silenceBeforeMs, 300);

  assert.equal(demonstration.intensity, "demonstracao");
  assert.equal(demonstration.surprise, false);
  assert.equal(demonstration.silenceBeforeMs, 0);

  assert.equal(cta.intensity, "cta");
  assert.equal(cta.silenceBeforeMs, 250);

  for (const segment of plan.segments) {
    assert.equal(typeof segment.smile, "boolean");
    assert.equal(typeof segment.surprise, "boolean");
    assert.equal(typeof segment.silenceBeforeMs, "number");
  }
});

test("Nora marca uma respiração (breathBeforeMs) antes de uma fala que segue uma fala anterior longa, e nenhuma quando a anterior foi curta", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const base = createInput();
  const input = createInput({
    diegoEditingPlan: {
      ...base.diegoEditingPlan,
      editingTimeline: [
        { order: 1, name: "Gancho", startSeconds: 0, endSeconds: 8, durationSeconds: 8, publicVisibleText: "Site oficial", narrativeIntensity: "impacto" },
        { order: 2, name: "Demonstração", startSeconds: 8, endSeconds: 12, durationSeconds: 4, publicVisibleText: "Tudo organizado", narrativeIntensity: "demonstracao" },
        { order: 3, name: "CTA", startSeconds: 12, endSeconds: 16, durationSeconds: 4, publicVisibleText: "Conheça o Rumo ao Altar", narrativeIntensity: "cta" },
      ],
    },
    brunoScript: {
      ...base.brunoScript,
      scenes: [
        { ...base.brunoScript.scenes[0], order: 1, spokenText: "Depois de anos sonhando, finalmente chegou a hora de organizar tudo com calma." },
        { ...base.brunoScript.scenes[1], order: 2, spokenText: "Tudo fica pronto." },
        { ...base.brunoScript.scenes[1], order: 3, spokenText: "Conheça o Rumo ao Altar." },
      ],
    },
  });

  const plan = buildNarrationPlan(input, context);
  const [hook, demonstration] = plan.segments;

  assert.ok(hook.text.split(/\s+/).filter(Boolean).length > 8, `fala do gancho deveria ter mais de 8 palavras: "${hook.text}"`);
  assert.equal(hook.breathBeforeMs, 0, "a primeira fala nunca respira antes — não há fala anterior");
  assert.equal(demonstration.breathBeforeMs, 180, "deveria respirar antes, pois a fala anterior (gancho) foi longa");
});

test("Nora marca sorriso na entrega para descoberta, benefício e convite (tom acolhedor), nunca para impacto/CTA", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const base = createInput();
  const input = createInput({
    diegoEditingPlan: {
      ...base.diegoEditingPlan,
      editingTimeline: [
        { order: 1, name: "Gancho", startSeconds: 0, endSeconds: 4, durationSeconds: 4, publicVisibleText: "Site oficial", narrativeIntensity: "impacto" },
        { order: 2, name: "Descoberta", startSeconds: 4, endSeconds: 9, durationSeconds: 5, publicVisibleText: "Tudo em um só lugar", narrativeIntensity: "descoberta" },
        { order: 3, name: "Benefícios", startSeconds: 9, endSeconds: 14, durationSeconds: 5, publicVisibleText: "Presentes, fotos e detalhes", narrativeIntensity: "beneficio" },
      ],
    },
  });

  const plan = buildNarrationPlan(input, context);
  const [hook, discovery, benefit] = plan.segments;

  assert.equal(hook.smile, false);
  assert.equal(discovery.smile, true);
  assert.equal(benefit.smile, true);
});

test("Nora encurta locuções longas sem terminar frases com conectivos soltos", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const input = createInput({
    brunoScript: {
      ...createInput().brunoScript,
      scenes: createInput().brunoScript.scenes.map((scene, index) => ({
        ...scene,
        spokenText: index === 0
          ? "Seu casamento merece um site oficial, elegante e fácil de compartilhar com todos os convidados sem complicação."
          : "Em um só lugar, os convidados encontram tudo o que precisam para acompanhar o casamento com tranquilidade.",
      })),
    },
  });

  const plan = buildNarrationPlan(input, context);
  const danglingEnding = /\b(?:a|as|ao|aos|com|da|das|de|do|dos|e|em|na|nas|no|nos|o|os|ou|para|por|que|sem|um|uma)[.!?]?$/iu;

  assert.ok(plan.segments.every((segment) => !danglingEnding.test(segment.text)));
  assert.ok(plan.segments.every((segment) => /[.!?]$/u.test(segment.text)));
});

test("Nora varia a locução por função narrativa e não confunde palavras como conectados com CTA", () => {
  const context = { modules: fullKnowledgeBase(), records: [] };
  const base = createInput();
  const input = createInput({
    brunoScript: {
      ...base.brunoScript,
      scenes: [
        {
          ...base.brunoScript.scenes[0],
          spokenText: "Seu casamento merece um site oficial, elegante e fácil de compartilhar com todos os convidados.",
          featureFocus: "site oficial",
          narrativeIntensity: "impacto",
        },
        {
          ...base.brunoScript.scenes[1],
          spokenText: "Em um só lugar, os convidados encontram tudo o que precisam para o grande dia.",
          featureFocus: "site oficial",
          narrativeIntensity: "descoberta",
        },
        {
          ...base.brunoScript.scenes[1],
          order: 3,
          spokenText: "A lista de presentes, o álbum colaborativo e as informações ficam conectados ao mesmo endereço.",
          featureFocus: "presentes album informações",
          narrativeIntensity: "beneficio",
        },
        {
          ...base.brunoScript.scenes[2],
          order: 4,
          spokenText: "Depois é só compartilhar o link e deixar cada convidado encontrar o caminho.",
          featureFocus: "convidados informações site oficial",
          narrativeIntensity: "convite",
        },
      ],
    },
    diegoEditingPlan: {
      ...base.diegoEditingPlan,
      totalDurationSeconds: 18,
      editingTimeline: [
        { order: 1, name: "Gancho", startSeconds: 0, endSeconds: 4, durationSeconds: 4, publicVisibleText: "Site oficial", narrativeIntensity: "impacto" },
        { order: 2, name: "Descoberta", startSeconds: 4, endSeconds: 9, durationSeconds: 5, publicVisibleText: "Tudo em um só lugar", narrativeIntensity: "descoberta" },
        { order: 3, name: "Benefícios", startSeconds: 9, endSeconds: 14, durationSeconds: 5, publicVisibleText: "Presentes, fotos e detalhes", narrativeIntensity: "beneficio" },
        { order: 4, name: "Convite", startSeconds: 14, endSeconds: 18, durationSeconds: 4, publicVisibleText: "Compartilhe o link", narrativeIntensity: "convite" },
      ],
    },
  });

  const plan = buildNarrationPlan(input, context);
  const texts = plan.segments.map((segment) => segment.text);

  assert.match(texts[1], /um só lugar/i);
  assert.match(texts[2], /Presentes, fotos e detalhes/i);
  assert.match(texts[3], /Compartilhe o link/i);
  assert.equal(texts.filter((text) => text === texts[0]).length, 1);
  assert.equal(texts[2].includes("Conheça o Rumo ao Altar"), false);
});

test("Nora pausa em Developer Assisted Mode e grava pacote de trabalho quando narration.wav ainda não existe", async () => {
  const { nora, artifactDelivery, logger, events } = createNora();

  const response = await nora.execute(createRequest());

  assert.equal(response.status, "needs_assisted_generation");
  assert.equal(response.output.pendingNarrations.length, 1);
  assert.equal(response.output.pendingNarrations[0].expectedRelativePath, "audio/narration.wav");
  assert.ok(response.output.pendingNarrations[0].prompt.includes("ROTEIRO COMPLETO"));
  assert.ok(artifactDelivery.writeCalls.some((call) => call.relativePath === "audio/narration-script.txt"));
  assert.ok(artifactDelivery.writeCalls.some((call) => call.relativePath === "audio/narration-work-package.json"));
  assert.ok(logger.list().some((entry) => entry.action === "AssistedGenerationRequested"));
  assert.ok(events.list().some((event) => event.name === "VideoNarrationAwaitingAssistedInput"));
});

test("Nora retoma com arquivo WAV válido e entrega briefing estruturado para Rafa", async () => {
  const { nora, artifactDelivery, events } = createNora();
  artifactDelivery.seed(EXECUTION_ID, "audio/narration.wav", createValidWav(10));

  const response = await nora.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(response.output.audio.relativePath, "audio/narration.wav");
  assert.equal(response.output.audio.validation.valid, true);
  assert.equal(response.output.rafaBriefing.audio.relativePath, "audio/narration.wav");
  assert.equal(response.output.rafaBriefing.segments.length, 3);
  assert.ok(response.output.rafaBriefing.providerInstructions.some((instruction) => instruction.includes("ducking")));
  assert.ok(events.list().some((event) => event.name === "VideoNarrationGenerated"));
  assert.ok(response.output.creativeDna);
  assert.ok(response.output.creativeDna.bigIdea.length > 0);
});

test("Nora rejeita áudio inválido, silencioso ou de outra duração antes de liberar Rafa", () => {
  assert.equal(validateNarrationAudio(Buffer.from("mp3 fake"), "audio/narration.mp3", 12).valid, false);

  const silent = validateNarrationAudio(createSilentWav(4), "audio/narration.wav", 12);
  assert.equal(silent.valid, false);
  assert.ok(silent.reason.includes("sem sinal"));

  const tooLong = validateNarrationAudio(createValidWav(20), "audio/narration.wav", 12);
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.reason.includes("excede"));
});


// ---------------------------------------------------------------------------------------------
// AGENCY FILM PIPELINE 2.0 — Nora sincroniza a voz com Shots
// ---------------------------------------------------------------------------------------------

test("AGENCY FILM PIPELINE 2.0: cada segmento de Nora expõe shotSyncMarkers alinhados aos Shots de Diego", async () => {
  const { nora } = createNora();
  const response = await nora.execute(createRequest());
  // Sem narrationProvider configurado, Nora vai para o modo assistido — os segments com
  // shotSyncMarkers ficam expostos dentro de `pendingNarrations[0].segments`.
  const segments = response.output.segments ?? response.output.pendingNarrations?.[0]?.segments;
  assert.ok(segments && segments.length > 0, "esperava segments no output (completo ou assistido)");
  for (const segment of segments) {
    assert.ok(Array.isArray(segment.shotSyncMarkers), `segmento ${segment.sceneId} sem shotSyncMarkers`);
    assert.ok(segment.shotSyncMarkers.length >= 2, `segmento ${segment.sceneId} com ${segment.shotSyncMarkers.length} marker(s)`);
    for (const marker of segment.shotSyncMarkers) {
      assert.ok(marker.shotId.length > 0);
      assert.ok(typeof marker.startSeconds === "number");
      assert.ok(typeof marker.endSeconds === "number");
      assert.ok(typeof marker.textSlice === "string");
      assert.ok(typeof marker.breathOnEnterMs === "number");
    }
    // Primeiro marker não pede respiração; os seguintes sim.
    assert.equal(segment.shotSyncMarkers[0].breathOnEnterMs, 0);
    for (let i = 1; i < segment.shotSyncMarkers.length; i++) {
      assert.ok(segment.shotSyncMarkers[i].breathOnEnterMs > 0);
    }
  }
});

