import test from "node:test";
import assert from "node:assert/strict";
import {
  CINEMATIC_REFERENCE_LIBRARY,
  CINEMATIC_REFERENCE_STYLES,
  EASING_CURVES,
  MUSIC_TRACK_LIBRARY,
  SHOT_TYPES,
  SOUND_EFFECT_LIBRARY,
  TRANSITION_STYLES,
  enrichCinematicScene,
  enrichEditingDecision,
  planShotsForScene,
  selectMusicTrack,
  selectSoundEffectsForScene,
} from "../dist/shared/utils/cinematic-reference-library.js";
import { buildBaselineDirection as buildVanessaBaselineDirection } from "../dist/skills/vanessa-video-direction/index.js";
import { buildBaselineEditingPlan as buildDiegoBaselineEditingPlan } from "../dist/skills/diego-video-editing/index.js";
import { RafaVideoRenderingSkill } from "../dist/skills/rafa-video-rendering/index.js";
import { compileFfmpegArgs } from "../dist/infrastructure/video-rendering/timeline-to-filter-compiler.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";

const CLIENT_ID = "client-rumo";
const TENANT_ID = "tenant-rumo";
const EXECUTION_ID = "exec-cinematic";

/**
 * AGENCY FILM PIPELINE 2.0 — todas as cenas de teste que fluem por Vanessa/Diego/Rafa precisam
 * carregar seus Shots. `withShots` usa o planner determinístico da shared library para gerar o
 * mínimo obrigatório (>=2) a partir do papel narrativo derivado do nome da cena.
 */
function withShots(scene) {
  const role = scene.name === "Gancho" ? "hook" : scene.name === "CTA final" ? "cta" : "development";
  const plan = planShotsForScene({
    sceneOrder: scene.order,
    sceneName: scene.name,
    sceneRole: role,
    sceneRhythm: scene.rhythm,
    sceneStartSeconds: scene.startSeconds,
    sceneDurationSeconds: scene.durationSeconds,
    sceneAction: scene.spokenText,
    beatIndex: 0,
    featureFocus: scene.featureFocus,
  });
  return { ...scene, shots: plan.shots };
}

// ---------------------------------------------------------------------------------------------
// Biblioteca compartilhada — cinematic-reference-library.ts
// ---------------------------------------------------------------------------------------------

test("enrichCinematicScene produz as 23 decisões cinematográficas explícitas para o gancho", () => {
  const scene = enrichCinematicScene("hook", "acelerado", 6);

  assert.ok(SHOT_TYPES.includes(scene.shotType));
  assert.ok(scene.cameraPosition.length > 0);
  assert.ok(scene.cameraHeight.length > 0);
  assert.ok(scene.simulatedLens.length > 0);
  assert.ok(scene.depthOfField.length > 0);
  assert.ok(scene.mainFocus.length > 0);
  assert.ok(scene.lighting.length > 0);
  assert.ok(scene.colorTemperature.length > 0);
  assert.ok(scene.emotion.length > 0);
  assert.ok(scene.pace.length > 0);
  assert.ok(scene.cameraMovement.length > 0);
  assert.ok(scene.cameraMovementSpeed.length > 0);
  assert.equal(scene.idealTakeDurationSeconds, 6);
  assert.ok(scene.composition.length > 0);
  assert.ok(scene.ruleOfThirds.length > 0);
  assert.ok(scene.gazeDirection.length > 0);
  assert.ok(scene.feeling.length > 0);
  assert.ok(scene.narrativeMotive.length > 0);
  assert.ok(CINEMATIC_REFERENCE_STYLES.includes(scene.referenceStyle));
  assert.ok(scene.visualObjective.length > 0);
  assert.ok(scene.progression.length > 0);
  assert.equal(scene.continuityFromPrevious, "N/A — é a primeira cena do vídeo, não herda nada da cena anterior.");
  assert.ok(scene.continuityToNext.length > 0);
  assert.ok(scene.emotionalDuration.length > 0);
});

test("enrichCinematicScene diferencia continuidade/progressão/duração emocional entre gancho, CTA e cada beat de desenvolvimento — nenhuma cena isolada", () => {
  const hook = enrichCinematicScene("hook", "acelerado", 6);
  const cta = enrichCinematicScene("cta", "moderado", 6);
  const build = enrichCinematicScene("development", "moderado", 8, 0);
  const payoff = enrichCinematicScene("development", "moderado", 8, 1);
  const release = enrichCinematicScene("development", "moderado", 8, 2);

  // O gancho não herda nada (é o início); o CTA não deixa nada em aberto (é o fim).
  assert.match(hook.continuityFromPrevious, /^N\/A/);
  assert.match(cta.continuityToNext, /^N\/A/);
  // Toda cena do meio herda algo da anterior e deixa algo em aberto para a próxima.
  for (const scene of [build, payoff, release]) {
    assert.doesNotMatch(scene.continuityFromPrevious, /^N\/A/);
    assert.doesNotMatch(scene.continuityToNext, /^N\/A/);
  }
  // As 5 posições narrativas têm objetivo visual, progressão e duração emocional distintos entre si.
  const progressions = new Set([hook, build, payoff, release, cta].map((scene) => scene.progression));
  assert.equal(progressions.size, 5);
  const emotionalDurations = new Set([hook, build, payoff, release, cta].map((scene) => scene.emotionalDuration));
  assert.equal(emotionalDurations.size, 5);
});

test("enrichCinematicScene é determinístico e diferencia gancho, CTA e desenvolvimento", () => {
  const hook = enrichCinematicScene("hook", "acelerado", 6);
  const cta = enrichCinematicScene("cta", "moderado", 6);
  const development = enrichCinematicScene("development", "moderado", 10);

  assert.deepEqual(hook, enrichCinematicScene("hook", "acelerado", 6));
  assert.notEqual(hook.gazeDirection, development.gazeDirection);
  assert.notEqual(hook.narrativeMotive, cta.narrativeMotive);
  // Gancho e CTA quebram a quarta parede por decisão consciente (ambos olham direto pra lente),
  // mesmo com o texto exato de cada um sendo diferente.
  assert.ok(hook.gazeDirection.includes("lente"));
  assert.ok(cta.gazeDirection.includes("lente"));
  assert.notEqual(hook.pace, development.pace);
});

test("enrichCinematicScene varia o desenvolvimento conforme o ritmo definido por Bruno (dinâmico vs. moderado)", () => {
  const fast = enrichCinematicScene("development", "dinamico", 5);
  const slow = enrichCinematicScene("development", "moderado", 5);

  assert.notEqual(fast.shotType, slow.shotType);
  assert.notEqual(fast.cameraMovement, slow.cameraMovement);
  assert.notEqual(fast.referenceStyle, slow.referenceStyle);
});

test("enrichCinematicScene varia composição/foco entre cenas de desenvolvimento pelo beatIndex, mantendo os campos derivados de isFast intactos", () => {
  const beat0 = enrichCinematicScene("development", "moderado", 8, 0);
  const beat1 = enrichCinematicScene("development", "moderado", 8, 1);
  const beat2 = enrichCinematicScene("development", "moderado", 8, 2);
  const beat3 = enrichCinematicScene("development", "moderado", 8, 3);

  // Composição/enquadramento variam com o beatIndex (rotação de 3 variantes) — é exatamente o
  // que corrige o defeito de cenas de desenvolvimento saindo cinematograficamente idênticas.
  assert.notEqual(beat0.composition, beat1.composition);
  assert.notEqual(beat1.composition, beat2.composition);
  assert.notEqual(beat0.cameraPosition, beat1.cameraPosition);
  assert.notEqual(beat0.ruleOfThirds, beat1.ruleOfThirds);
  assert.notEqual(beat0.gazeDirection, beat1.gazeDirection);
  assert.notEqual(beat0.mainFocus, beat1.mainFocus);
  // A rotação tem 3 variantes: beatIndex 3 repete beatIndex 0.
  assert.deepEqual(beat3, beat0);

  // Campos derivados de isFast (não do beatIndex) continuam idênticos entre beats do mesmo ritmo.
  assert.equal(beat0.shotType, beat1.shotType);
  assert.equal(beat0.simulatedLens, beat1.simulatedLens);
  assert.equal(beat0.emotion, beat1.emotion);
  assert.equal(beat0.pace, beat1.pace);
  assert.equal(beat0.cameraMovement, beat1.cameraMovement);
  assert.equal(beat0.referenceStyle, beat1.referenceStyle);
});

test("enrichEditingDecision produz o pacote completo de decisões de edição (nunca só tipo de corte)", () => {
  const decision = enrichEditingDecision("development", "dinamico", true);

  assert.ok(decision.cutType.length > 0);
  assert.ok(decision.cutSpeed.length > 0);
  assert.ok(decision.rhythm.length > 0);
  assert.equal(typeof decision.breathingPoint, "boolean");
  assert.ok(TRANSITION_STYLES.includes(decision.transition));
  for (const flag of ["zoom", "pan", "pushIn", "pullOut", "speedRamp", "whip", "fade", "blur", "glow", "mask", "motionBlur"]) {
    assert.equal(typeof decision[flag], "boolean", `${flag} deveria ser boolean`);
  }
  assert.ok(decision.textAnimation.length > 0);
  assert.ok(decision.ctaEntry.length > 0);
  assert.ok(decision.ctaExit.length > 0);
  assert.ok(EASING_CURVES.includes(decision.easing));
  assert.ok(decision.animationTimingSeconds > 0);
  assert.ok(decision.syncNotes.length > 0);
});

test("enrichEditingDecision: gancho sempre corte duro e sem respiro; CTA sempre com ponto de respiração", () => {
  const hook = enrichEditingDecision("hook", "acelerado", true);
  const cta = enrichEditingDecision("cta", "moderado", true);

  assert.equal(hook.cutType, "hard_cut");
  assert.equal(hook.breathingPoint, false);
  assert.equal(cta.breathingPoint, true);
  assert.notEqual(hook.transition, cta.transition);
});

test("enrichEditingDecision varia zoom/pan/speedRamp/whip/motionBlur conforme o ritmo do desenvolvimento", () => {
  const fast = enrichEditingDecision("development", "dinamico", false);
  const slow = enrichEditingDecision("development", "moderado", false);

  assert.equal(fast.pan, true);
  assert.equal(fast.speedRamp, true);
  assert.equal(fast.whip, true);
  assert.equal(fast.motionBlur, true);
  assert.equal(slow.zoom, true);
  assert.equal(slow.pushIn, true);
  assert.equal(slow.pan, false);
});

test("enrichEditingDecision varia transição/animação/máscara/glow/blur entre cenas de desenvolvimento pelo beatIndex, mantendo os campos derivados de isFast intactos", () => {
  const beat0 = enrichEditingDecision("development", "moderado", false, 0);
  const beat1 = enrichEditingDecision("development", "moderado", false, 1);
  const beat2 = enrichEditingDecision("development", "moderado", false, 2);
  const beat3 = enrichEditingDecision("development", "moderado", false, 3);
  const beat4 = enrichEditingDecision("development", "moderado", false, 4);

  const signature = (decision) => JSON.stringify({
    transition: decision.transition,
    textAnimation: decision.textAnimation,
    mask: decision.mask,
    glow: decision.glow,
    blur: decision.blur,
  });
  const signatures = new Set([beat0, beat1, beat2, beat3].map(signature));
  assert.equal(signatures.size, 4, "as 4 variantes de sabor de edição deveriam ser distintas entre si");
  // A rotação tem 4 variantes: beatIndex 4 repete beatIndex 0.
  assert.equal(signature(beat4), signature(beat0));

  // Campos derivados de isFast (não do beatIndex) continuam idênticos entre beats do mesmo ritmo.
  for (const field of ["cutType", "cutSpeed", "rhythm", "breathingPoint", "zoom", "pan", "pushIn", "pullOut", "speedRamp", "whip", "motionBlur", "easing", "animationTimingSeconds", "ctaEntry", "ctaExit"]) {
    assert.deepEqual(beat0[field], beat1[field], `${field} não deveria variar por beatIndex`);
  }
});

test("enrichEditingDecision expõe pacingIntent — Diego como diretor de ritmo, nunca só executor de tempo fixo", () => {
  const hook = enrichEditingDecision("hook", "acelerado", true);
  const cta = enrichEditingDecision("cta", "moderado", true);
  const build = enrichEditingDecision("development", "moderado", false, 0);
  const payoff = enrichEditingDecision("development", "moderado", false, 1);
  const release = enrichEditingDecision("development", "moderado", false, 2);

  for (const decision of [hook, cta, build, payoff, release]) {
    assert.ok(decision.pacingIntent.length > 0);
  }
  // As 5 posições narrativas justificam o ritmo de forma distinta entre si.
  const intents = new Set([hook, cta, build, payoff, release].map((decision) => decision.pacingIntent));
  assert.equal(intents.size, 5);
});

test("CINEMATIC_REFERENCE_LIBRARY cobre as 8 referências de gênero pedidas, sem citar elementos de marca registrada", () => {
  assert.deepEqual(
    [...CINEMATIC_REFERENCE_STYLES].sort(),
    [
      "airbnbCinematicWarmth",
      "appleMinimalCommercial",
      "googleClarity",
      "notionCleanNarrative",
      "nikeEnergyMomentum",
      "nubankConfidentModern",
      "premiumCommercialPolish",
      "weddingFilmEmotional",
    ].sort(),
  );
  for (const style of CINEMATIC_REFERENCE_STYLES) {
    const description = CINEMATIC_REFERENCE_LIBRARY[style];
    assert.ok(description.length > 20);
    assert.ok(!/logo|jingle|tipografia registrada/i.test(description));
  }
});

test("MUSIC_TRACK_LIBRARY cobre as 7 categorias pedidas, com caminho local por convenção (sem API externa)", () => {
  const categories = Object.keys(MUSIC_TRACK_LIBRARY).sort();
  assert.deepEqual(categories, ["elegante", "emocional", "inspiradora", "minimalista", "moderna", "romantica", "wedding"].sort());
  for (const track of Object.values(MUSIC_TRACK_LIBRARY)) {
    assert.ok(track.localPath.startsWith("assets/audio/music/"));
    assert.ok(!track.localPath.startsWith("http"));
  }
});

test("selectMusicTrack escolhe a categoria certa a partir de texto de contexto, com fallback determinístico", () => {
  assert.equal(selectMusicTrack("Quero um vídeo romântico para o casal").category, "romantica");
  assert.equal(selectMusicTrack("Tom sofisticado e premium").category, "elegante");
  assert.equal(selectMusicTrack("Uma campanha moderna e tech").category, "moderna");
  assert.equal(selectMusicTrack("texto sem nenhuma palavra-chave reconhecida").category, "wedding");
  assert.equal(selectMusicTrack(undefined, undefined).category, "wedding");
});

test("SOUND_EFFECT_LIBRARY cobre os 8 efeitos pedidos, com caminho local por convenção", () => {
  const names = Object.keys(SOUND_EFFECT_LIBRARY).sort();
  assert.deepEqual(names, ["click", "impact_leve", "notification", "pop", "rise", "sparkle", "sweep", "whoosh"].sort());
  for (const effect of Object.values(SOUND_EFFECT_LIBRARY)) {
    assert.ok(effect.localPath.startsWith("assets/audio/sfx/"));
  }
});

test("selectSoundEffectsForScene escolhe efeitos automaticamente por papel narrativo e tipo de transição", () => {
  const hookEffects = selectSoundEffectsForScene("hook", "cut");
  const ctaEffects = selectSoundEffectsForScene("cta", "glow");
  const whipEffects = selectSoundEffectsForScene("development", "whip");
  const noEffects = selectSoundEffectsForScene("development", "slide");

  assert.ok(hookEffects.some((effect) => effect.name === "impact_leve"));
  assert.ok(ctaEffects.some((effect) => effect.name === "notification"));
  assert.ok(whipEffects.some((effect) => effect.name === "whoosh"));
  assert.deepEqual(noEffects, []);
});

// ---------------------------------------------------------------------------------------------
// Vanessa — Diretora de Comerciais
// ---------------------------------------------------------------------------------------------

function vanessaInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Reels sobre taxa zero na lista de presentes",
    joaoStrategy: {
      overallStrategy: "x", objective: "x", targetAudience: "x", channel: "instagram", format: "reels",
      toneOfVoice: "leve divertido persuasivo", angle: "Conversão direta", centralPromise: "Taxa zero real",
      valueProposition: "x", keyMessages: [], recommendedCta: "Conheça o Rumo ao Altar",
    },
    brunoScript: {
      status: "preliminary", narrativeStructure: "Gancho -> Desenvolvimento -> CTA", hook: "x", totalDurationSeconds: 20,
      scenes: [
        withShots({ order: 1, name: "Gancho", startSeconds: 0, durationSeconds: 5, spokenText: "x", brollSuggestions: [], framing: "x", cameraMovement: "Estático", rhythm: "acelerado", soundEffectSuggestions: [] }),
        withShots({ order: 2, name: "Desenvolvimento", startSeconds: 5, durationSeconds: 9, spokenText: "x", brollSuggestions: [], framing: "x", cameraMovement: "x", rhythm: "moderado", soundEffectSuggestions: [] }),
        withShots({ order: 3, name: "CTA final", startSeconds: 14, durationSeconds: 6, spokenText: "x", brollSuggestions: [], framing: "x", cameraMovement: "Estático", rhythm: "moderado", soundEffectSuggestions: [] }),
      ],
      overallRhythm: "moderado", musicSuggestions: [], finalCta: "x", recordingNotes: [], editingNotes: [], channel: "instagram", notes: [],
    },
    channel: "instagram",
    format: "reels",
    videoObjective: "x",
    ...overrides,
  };
}

function vanessaContext() {
  return { records: [], modules: { IdentityContext: [], BrandContext: [], ContentContext: [] } };
}

test("Vanessa (buildBaselineDirection) preenche cinematography em toda cena, com as 18 decisões", () => {
  const direction = buildVanessaBaselineDirection(vanessaInput(), vanessaContext());

  assert.equal(direction.sceneDirections.length, 3);
  for (const scene of direction.sceneDirections) {
    assert.ok(scene.cinematography, `cena ${scene.name} deveria ter cinematography`);
    assert.ok(SHOT_TYPES.includes(scene.cinematography.shotType));
    assert.ok(scene.cinematography.narrativeMotive.length > 0);
  }
});

test("Vanessa diferencia as decisões cinematográficas entre gancho, desenvolvimento e CTA", () => {
  const direction = buildVanessaBaselineDirection(vanessaInput(), vanessaContext());
  const [hook, development, cta] = direction.sceneDirections;

  assert.notEqual(hook.cinematography.pace, development.cinematography.pace);
  assert.notEqual(hook.cinematography.narrativeMotive, cta.cinematography.narrativeMotive);
  assert.equal(hook.cinematography.idealTakeDurationSeconds, 5);
  assert.equal(development.cinematography.idealTakeDurationSeconds, 9);
});

// ---------------------------------------------------------------------------------------------
// Diego — Editor profissional
// ---------------------------------------------------------------------------------------------

function diegoInput(overrides = {}) {
  const brunoScenes = [
    withShots({ order: 1, name: "Gancho", startSeconds: 0, durationSeconds: 5, spokenText: "x", brollSuggestions: [], framing: "x", cameraMovement: "x", rhythm: "acelerado", soundEffectSuggestions: [] }),
    withShots({ order: 2, name: "Desenvolvimento", startSeconds: 5, durationSeconds: 9, spokenText: "x", brollSuggestions: [], framing: "x", cameraMovement: "x", rhythm: "dinamico", soundEffectSuggestions: [] }),
    withShots({ order: 3, name: "CTA final", startSeconds: 14, durationSeconds: 6, spokenText: "x", brollSuggestions: [], framing: "x", cameraMovement: "x", rhythm: "moderado", soundEffectSuggestions: [] }),
  ];
  return {
    clientId: CLIENT_ID,
    originalRequest: "Reels sobre taxa zero na lista de presentes",
    joaoStrategy: {
      overallStrategy: "x", objective: "x", targetAudience: "x", channel: "instagram", format: "reels",
      toneOfVoice: "leve divertido persuasivo wedding", angle: "Conversão direta", centralPromise: "Taxa zero real",
      valueProposition: "x", keyMessages: [], recommendedCta: "Conheça o Rumo ao Altar",
    },
    brunoScript: {
      status: "preliminary", narrativeStructure: "x", hook: "x", totalDurationSeconds: 20, scenes: brunoScenes,
      overallRhythm: "moderado", musicSuggestions: [], finalCta: "x", recordingNotes: [], editingNotes: [], channel: "instagram", notes: [],
    },
    vanessaDirection: {
      status: "preliminary",
      sceneDirections: brunoScenes.map((scene) => ({
        order: scene.order, name: scene.name, framing: "x", visualComposition: "x", cameraMovement: "x",
        transitionToNext: scene.name === "CTA final" ? undefined : "x", visualEffects: [],
      })),
      visualRhythm: "x", captionStyle: "x", soundDesignGuidance: [], musicDirection: "trilha wedding romantica",
      brollGuidance: [], lightDirection: "x", colorDirection: "x", recordingGuidance: [], editingGuidance: [],
      channel: "instagram", notes: [],
    },
    channel: "instagram",
    format: "reels",
    videoObjective: "x",
    ...overrides,
  };
}

function diegoContext() {
  return { records: [], modules: { IdentityContext: [], ContentContext: [] } };
}

test("Diego (buildBaselineEditingPlan) preenche editingDecision e selectedSoundEffects em toda cena", () => {
  const plan = buildDiegoBaselineEditingPlan(diegoInput(), diegoContext());

  assert.equal(plan.editingTimeline.length, 3);
  for (const entry of plan.editingTimeline) {
    assert.ok(entry.editingDecision, `cena ${entry.name} deveria ter editingDecision`);
    assert.ok(Array.isArray(entry.selectedSoundEffects));
    assert.ok(TRANSITION_STYLES.includes(entry.editingDecision.transition));
  }
});

test("Diego seleciona a trilha automaticamente da biblioteca local a partir do contexto (wedding/romântica)", () => {
  const plan = buildDiegoBaselineEditingPlan(diegoInput(), diegoContext());

  assert.ok(["wedding", "romantica"].includes(plan.musicTrack.category));
  assert.ok(plan.musicTrackPlan.includes(plan.musicTrack.name));
  assert.ok(plan.musicTrackPlan.toLowerCase().includes("ducking"));
});

test("Diego diferencia decisões de edição entre gancho (corte duro, sem respiro) e desenvolvimento dinâmico (whip, speed ramp)", () => {
  const plan = buildDiegoBaselineEditingPlan(diegoInput(), diegoContext());
  const [hook, development] = plan.editingTimeline;

  assert.equal(hook.editingDecision.cutType, "hard_cut");
  assert.equal(hook.editingDecision.breathingPoint, false);
  assert.equal(development.editingDecision.whip, true);
  assert.equal(development.editingDecision.speedRamp, true);
});

// ---------------------------------------------------------------------------------------------
// Rafa — renderizador de motion graphics (execução completa, VideoRenderRequest capturado)
// ---------------------------------------------------------------------------------------------

class FakeValentina {
  constructor(tenants) {
    this.tenants = tenants;
  }
  async getClientContext(tenantId) {
    const tenant = this.tenants.find((candidate) => candidate.id === tenantId);
    return { tenantId: tenant.id, clientId: tenant.clientId, plan: "PRO", status: "active", subscriptionStatus: "active", timezone: "America/Sao_Paulo", language: "pt-BR", country: "BR", environment: "production", enabledSpecialists: "all", enabledFeatures: "all", planLimits: {} };
  }
  async getTenant(query) {
    return this.tenants.find((candidate) => candidate.clientId === query.clientId);
  }
}

class FakeClara {
  constructor(recordsByModule) {
    this.recordsByModule = recordsByModule;
  }
  async requestContext(request) {
    const modules = {};
    let records = [];
    for (const moduleName of request.modules ?? Object.keys(this.recordsByModule)) {
      const moduleRecords = this.recordsByModule[moduleName] ?? [];
      if (moduleRecords.length > 0) {
        modules[moduleName] = moduleRecords;
        records = records.concat(moduleRecords);
      }
    }
    return { clientId: request.clientId, deliveredAt: "2026-07-08T12:00:00.000Z", modules, records };
  }
}

class FakeArtifactDelivery {
  constructor() {
    this.files = new Map();
  }
  key(executionId, relativePath) {
    return `${executionId}:${relativePath}`;
  }
  seed(executionId, relativePath, bytes) {
    this.files.set(this.key(executionId, relativePath), bytes);
  }
  async writeFile(input) {
    const bytes = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);
    this.files.set(this.key(input.executionId, input.relativePath), new Uint8Array(bytes));
    return { absolutePath: `/fake/${input.executionId}/${input.relativePath}`, relativePath: input.relativePath, sizeBytes: bytes.byteLength, mimeType: input.mimeType };
  }
  async createZip() {
    throw new Error("não usado neste teste");
  }
  async readFile(input) {
    const data = this.files.get(this.key(input.executionId, input.relativePath));
    if (!data) return undefined;
    return { absolutePath: `/fake/${input.executionId}/${input.relativePath}`, relativePath: input.relativePath, sizeBytes: data.byteLength, data };
  }
}

function createMinimalMp4(sizeBytes = 150 * 1024) {
  const buffer = Buffer.alloc(sizeBytes, 0);
  buffer.writeUInt32BE(sizeBytes, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("isom", 8, "ascii");
  return new Uint8Array(buffer);
}

class FakeVideoRendering {
  constructor(artifactDelivery) {
    this.artifactDelivery = artifactDelivery;
    this.renderCalls = [];
    this.resolveAssetsImpl = async (input) => ({ resolutions: input.candidates.map((c) => ({ id: c.id, kind: c.kind, resolved: false, reason: "não configurado" })) });
  }
  async resolveAssets(input) {
    return this.resolveAssetsImpl(input);
  }
  async render(input) {
    this.renderCalls.push(input);
    this.artifactDelivery.seed(input.executionId, input.outputRelativePath, createMinimalMp4());
    return {
      absolutePath: `/fake/${input.outputRelativePath}`,
      relativePath: input.outputRelativePath,
      sizeBytes: 150 * 1024,
      durationSeconds: input.totalDurationSeconds,
      width: input.width,
      height: input.height,
      aspectRatio: "9:16",
      fps: input.fps,
      videoCodec: "H.264 (libx264)",
      hasAudio: false,
      renderTimeMs: 10,
      logsSummary: [],
      warnings: [],
    };
  }
}

function rafaInput() {
  const diegoTimeline = [
    {
      order: 1, name: "Gancho", startSeconds: 0, endSeconds: 5, durationSeconds: 5,
      captionText: "x", onScreenText: "Taxa zero", cutType: "y", transitionToNext: "cut", visualEffects: [], soundEffectSuggestions: [],
      editingDecision: enrichEditingDecision("hook", "acelerado", true),
      selectedSoundEffects: selectSoundEffectsForScene("hook", "cut"),
    },
    {
      order: 2, name: "Desenvolvimento", startSeconds: 5, endSeconds: 14, durationSeconds: 9,
      captionText: "x", onScreenText: undefined, cutType: "y", transitionToNext: "whip", visualEffects: [], soundEffectSuggestions: [],
      editingDecision: enrichEditingDecision("development", "dinamico", true),
      selectedSoundEffects: selectSoundEffectsForScene("development", "whip"),
    },
    {
      order: 3, name: "CTA final", startSeconds: 14, endSeconds: 20, durationSeconds: 6,
      captionText: "x", onScreenText: "Conheça o Rumo ao Altar", cutType: "y", transitionToNext: undefined, visualEffects: [], soundEffectSuggestions: [],
      editingDecision: enrichEditingDecision("cta", "moderado", true),
      selectedSoundEffects: selectSoundEffectsForScene("cta", "glow"),
    },
  ];
  return {
    clientId: CLIENT_ID,
    originalRequest: "Renderizar o reels final sobre taxa zero",
    joaoStrategy: { overallStrategy: "x", objective: "x", targetAudience: "x", channel: "instagram", format: "reels", toneOfVoice: "x", angle: "x", centralPromise: "x", valueProposition: "x", keyMessages: [], recommendedCta: "x" },
    brunoScript: {
      status: "preliminary", narrativeStructure: "x", hook: "x", totalDurationSeconds: 20,
      scenes: diegoTimeline.map((entry) => ({ order: entry.order, name: entry.name, startSeconds: entry.startSeconds, durationSeconds: entry.durationSeconds, spokenText: entry.captionText, onScreenText: entry.onScreenText, brollSuggestions: [], framing: "x", cameraMovement: "x", rhythm: "moderado", soundEffectSuggestions: [] })),
      overallRhythm: "x", musicSuggestions: [], finalCta: "x", recordingNotes: [], editingNotes: [], channel: "instagram", notes: [],
    },
    vanessaDirection: {
      status: "preliminary",
      sceneDirections: diegoTimeline.map((entry) => ({ order: entry.order, name: entry.name, framing: "x", visualComposition: "x", cameraMovement: "x", transitionToNext: entry.transitionToNext, visualEffects: [] })),
      visualRhythm: "x", captionStyle: "x", soundDesignGuidance: [], musicDirection: "x", brollGuidance: [], lightDirection: "x", colorDirection: "x", recordingGuidance: [], editingGuidance: [], channel: "instagram", notes: [],
    },
    diegoEditingPlan: {
      status: "preliminary", editingTimeline: diegoTimeline, totalDurationSeconds: 20,
      musicTrackPlan: "trilha x", musicTrack: MUSIC_TRACK_LIBRARY.wedding,
      requiredAssets: [], editingInstructions: [], technicalChecklist: [], channel: "instagram", notes: [],
    },
    channel: "instagram",
    format: "reels",
    videoObjective: "x",
  };
}

function claraRecord(module, payload) {
  return {
    id: `${module}-1`, module, clientId: payload.clientId, title: module, status: "active", currentVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", payload, versions: [], history: [], tags: [],
  };
}

function createRafa() {
  const valentina = new FakeValentina([{ id: TENANT_ID, clientId: CLIENT_ID, plan: "PRO" }]);
  const clara = new FakeClara({
    BrandContext: [claraRecord("BrandContext", { clientId: CLIENT_ID, brandName: "Rumo ao Altar", promise: "Casamentos sem taxas escondidas.", toneOfVoice: "leve divertido" })],
    IdentityContext: [claraRecord("IdentityContext", { clientId: CLIENT_ID, colors: ["#C97F91", "#111111", "#FFFFFF"], fonts: ["Georgia"], imageStyle: "editorial romântico" })],
    PublishingContext: [],
  });
  const artifactDelivery = new FakeArtifactDelivery();
  const videoRendering = new FakeVideoRendering(artifactDelivery);
  const events = new InMemoryZunoEventRecorder();
  const rafa = new RafaVideoRenderingSkill({
    valentina, clara, artifactDelivery, videoRendering, eventRecorder: events,
    idGenerator: { create: (prefix) => `${prefix}-0001` },
    now: () => new Date("2026-07-12T12:00:00.000Z"),
  });
  return { rafa, artifactDelivery, videoRendering };
}

test("Rafa nunca deixa uma cena sem movimento: zoom/pan derivam da decisão explícita de Diego (push-in/pull-out/pan), nunca de index%2 improvisado", async () => {
  const { rafa, videoRendering } = createRafa();

  const response = await rafa.execute({
    skillId: "rafa-video-rendering",
    input: rafaInput(),
    context: { executionId: EXECUTION_ID, taskId: "task-rafa", correlationId: "corr-rafa", locale: "pt-BR", dryRun: true, requestedBy: "helena", orchestratedBy: "arthur" },
  });

  assert.equal(response.status, "completed");
  assert.equal(videoRendering.renderCalls.length, 1);
  const request = videoRendering.renderCalls[0];

  for (const scene of request.scenes) {
    assert.notEqual(scene.zoom, "none", `cena ${scene.order} nunca deveria ficar sem zoom (garantia de movimento contínuo)`);
  }

  // Cena 2 (desenvolvimento, ritmo dinâmico) tem pan=true na decisão de Diego -> Rafa aplica pan real.
  const developmentScene = request.scenes.find((scene) => scene.order === 2);
  assert.notEqual(developmentScene.pan, "none");
});

test("Rafa traduz o estilo de transição explícito de Diego (whip) para o VideoRenderRequest, em vez de sempre usar fade", async () => {
  const { rafa, videoRendering } = createRafa();

  await rafa.execute({
    skillId: "rafa-video-rendering",
    input: rafaInput(),
    context: { executionId: EXECUTION_ID, taskId: "task-rafa", correlationId: "corr-rafa", locale: "pt-BR", dryRun: true, requestedBy: "helena", orchestratedBy: "arthur" },
  });

  const request = videoRendering.renderCalls[0];
  const hookScene = request.scenes.find((scene) => scene.order === 1);
  const developmentScene = request.scenes.find((scene) => scene.order === 2);
  assert.equal(hookScene.transitionToNext, "cut");
  assert.equal(developmentScene.transitionToNext, "whip");
});

test("Rafa configura ducking automático da trilha nos pontos onde há efeito sonoro selecionado por Diego", async () => {
  const { rafa, artifactDelivery, videoRendering } = createRafa();
  artifactDelivery.seed(EXECUTION_ID, "music.mp3", new Uint8Array([1, 2, 3]));
  videoRendering.resolveAssetsImpl = async (input) => ({
    resolutions: input.candidates.map((c) => (c.id === "music" ? { id: c.id, kind: c.kind, resolved: true, absolutePath: "/fake/music.mp3", sizeBytes: 3 } : { id: c.id, kind: c.kind, resolved: false, reason: "não fornecido" })),
  });

  await rafa.execute({
    skillId: "rafa-video-rendering",
    input: { ...rafaInput(), localAssets: { musicTrackPath: "/fake/music.mp3" } },
    context: { executionId: EXECUTION_ID, taskId: "task-rafa", correlationId: "corr-rafa", locale: "pt-BR", dryRun: true, requestedBy: "helena", orchestratedBy: "arthur" },
  });

  const request = videoRendering.renderCalls[0];
  const musicTrack = request.audioTracks.find((track) => track.role === "music");
  assert.ok(musicTrack, "deveria haver uma faixa de música no VideoRenderRequest");
  assert.equal(musicTrack.fadeInSeconds, 1);
  assert.equal(musicTrack.fadeOutSeconds, 2);
  assert.ok(musicTrack.duckAtSeconds.length >= 2, "deveria duckar nos pontos com efeito sonoro (cenas 1 e 2)");
});

// ---------------------------------------------------------------------------------------------
// Compilador de filtros do FFmpeg — vinheta sempre-ligada, transições reais, fade/ducking de áudio
// ---------------------------------------------------------------------------------------------

function minimalRenderRequest(overrides = {}) {
  return {
    executionId: EXECUTION_ID,
    outputRelativePath: "videos/final-video.mp4",
    width: 1080,
    height: 1920,
    fps: 30,
    totalDurationSeconds: 10,
    scenes: [
      { order: 1, startSeconds: 0, durationSeconds: 5, background: { type: "solid", color: "#111111" }, overlays: [], transitionToNext: "dissolve", zoom: "in", pan: "none" },
      { order: 2, startSeconds: 5, durationSeconds: 5, background: { type: "solid", color: "#C97F91" }, overlays: [], zoom: "out", pan: "left_to_right" },
    ],
    assets: [],
    audioTracks: [],
    ...overrides,
  };
}

test("compileFfmpegArgs aplica vinheta muito leve sempre, em toda cena", () => {
  const args = compileFfmpegArgs({
    request: minimalRenderRequest(),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "C:/fake/final-video.mp4",
    fonts: { regular: "C:/fonts/regular.ttf", bold: "C:/fonts/bold.ttf" },
    supportsGradients: true,
  });
  const filterComplexIndex = args.indexOf("-filter_complex");
  const filterComplex = args[filterComplexIndex + 1];
  assert.ok(filterComplex.includes("vignette=angle=PI/6"));
});

test("compileFfmpegArgs traduz o estilo de transição de Diego para o nome real do efeito xfade do FFmpeg", () => {
  const args = compileFfmpegArgs({
    request: minimalRenderRequest(),
    overlayTextFiles: new Map(),
    outputAbsolutePath: "C:/fake/final-video.mp4",
    fonts: { regular: "C:/fonts/regular.ttf", bold: "C:/fonts/bold.ttf" },
    supportsGradients: true,
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.ok(filterComplex.includes("xfade=transition=dissolve"), "estilo 'dissolve' deveria virar transition=dissolve, nunca sempre 'fade'");
});

test("compileFfmpegArgs aplica fade-in/fade-out e ducking automático na trilha via afade/volume", () => {
  const request = minimalRenderRequest({
    assets: [{ id: "music", kind: "audio", absolutePath: "C:/fake/music.mp3" }],
    audioTracks: [
      { assetId: "music", role: "music", startSeconds: 0, volume: 0.5, fadeInSeconds: 1, fadeOutSeconds: 2, duckAtSeconds: [2, 6], duckAmount: 0.5, duckDurationSeconds: 0.6 },
    ],
  });
  const args = compileFfmpegArgs({
    request,
    overlayTextFiles: new Map(),
    outputAbsolutePath: "C:/fake/final-video.mp4",
    fonts: { regular: "C:/fonts/regular.ttf", bold: "C:/fonts/bold.ttf" },
    supportsGradients: true,
  });
  const filterComplex = args[args.indexOf("-filter_complex") + 1];
  assert.ok(filterComplex.includes("afade=t=in:st=0:d=1.000"));
  assert.ok(filterComplex.includes("afade=t=out:st=8.000:d=2.000"));
  assert.ok(filterComplex.includes("between(t,2.000,2.600)"));
  assert.ok(filterComplex.includes("between(t,6.000,6.600)"));
});
