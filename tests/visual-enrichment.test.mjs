import test from "node:test";
import assert from "node:assert/strict";
import {
  ANTI_GENERIC_VISUAL_CONSTRAINTS,
  VISUAL_REFERENCE_LIBRARY,
  VISUAL_REFERENCE_STYLES,
  enrichVisualConcept,
  inferVisualEmotionHint,
} from "../dist/shared/utils/visual-reference-library.js";
import { buildFinalImagePrompt, buildVisualEnrichments } from "../dist/skills/pedro-image-generation/index.js";
import { buildBaselineDirection as buildSofiaBaselineDirection } from "../dist/skills/sofia-art-direction/index.js";
import { buildBaselineDesign as buildBiancaBaselineDesign } from "../dist/skills/bianca-social-media-design/index.js";

const CLIENT_ID = "client-rumo";

// ---------------------------------------------------------------------------------------------
// Biblioteca compartilhada — enrichVisualConcept / inferVisualEmotionHint
// ---------------------------------------------------------------------------------------------

test("enrichVisualConcept transforma 'caixa de presente' em uma cena publicitária completa, nunca um objeto isolado", () => {
  const scene = enrichVisualConcept("caixa de presente", "loss");

  assert.equal(scene.concept, "caixa de presente");
  assert.ok(scene.protagonist.toLowerCase().includes("caixa de presente"));
  assert.ok(scene.background.length > 0);
  assert.ok(scene.lighting.length > 0);
  assert.ok(scene.depthOfField.length > 0);
  assert.ok(scene.simulatedLens.length > 0);
  assert.ok(scene.framing.length > 0);
  assert.ok(scene.composition.length > 0);
  assert.ok(scene.implicitMovement.length > 0);
  assert.ok(scene.visualEmotion.length > 0);
  assert.ok(scene.texture.length > 0);
  assert.ok(scene.materials.length > 0);
  assert.ok(scene.photographicQuality.length > 0);
  assert.ok(VISUAL_REFERENCE_STYLES.includes(scene.referenceStyle));
  // Mesmo exemplo citado no pedido original — protagonista, iluminação, movimento e emoção compostos em um parágrafo.
  assert.ok(scene.sceneDescription.includes("caixa de presente premium aberta"));
  assert.ok(scene.sceneDescription.includes("iluminada por"));
  assert.ok(scene.sceneDescription.includes("escapam lentamente da embalagem"));
  assert.ok(scene.sceneDescription.includes("perda financeira"));
});

test("enrichVisualConcept é determinístico: mesmo conceito e emoção sempre produzem a mesma cena", () => {
  const first = enrichVisualConcept("caixa de presente", "loss");
  const second = enrichVisualConcept("caixa de presente", "loss");
  assert.deepEqual(first, second);
});

test("enrichVisualConcept('dinheiro') varia a narrativa entre perda e ganho conforme o hint de emoção", () => {
  const loss = enrichVisualConcept("dinheiro", "loss");
  const gain = enrichVisualConcept("dinheiro", "gain");

  assert.notEqual(loss.implicitMovement, gain.implicitMovement);
  assert.notEqual(loss.visualEmotion, gain.visualEmotion);
  assert.ok(loss.sceneDescription.includes("perda"));
  assert.ok(gain.sceneDescription.includes("ganho") || gain.sceneDescription.includes("confiança"));
});

test("enrichVisualConcept reconhece aliança, convite, flores e casal com cenas próprias (nunca ícone genérico)", () => {
  const ring = enrichVisualConcept("aliança de casamento");
  const invitation = enrichVisualConcept("convite de casamento");
  const flowers = enrichVisualConcept("buquê de flores");
  const couple = enrichVisualConcept("casal de noivos");

  assert.equal(ring.referenceStyle, "highEndWeddingPhotography");
  assert.equal(invitation.referenceStyle, "luxuryEditorial");
  assert.equal(flowers.referenceStyle, "highEndWeddingPhotography");
  assert.equal(couple.referenceStyle, "highEndWeddingPhotography");
  for (const scene of [ring, invitation, flowers, couple]) {
    assert.notEqual(scene.protagonist, "");
    assert.ok(scene.materials.length > 0);
  }
});

test("enrichVisualConcept nunca deixa um conceito sem reconhecimento sem cena — fallback genérico sempre enriquece", () => {
  const scene = enrichVisualConcept("um gráfico de crescimento de vendas");
  assert.ok(scene.protagonist.includes("um gráfico de crescimento de vendas"));
  assert.equal(scene.referenceStyle, "premiumCampaign");
  assert.ok(scene.sceneDescription.includes("cena fotográfica"));
});

test("enrichVisualConcept trata texto vazio sem quebrar, com um conceito de fallback", () => {
  const scene = enrichVisualConcept("   ");
  assert.equal(scene.concept, "elemento visual da campanha");
  assert.ok(scene.sceneDescription.length > 0);
});

test("inferVisualEmotionHint deriva perda, ganho ou neutro a partir do texto de contexto", () => {
  assert.equal(inferVisualEmotionHint("quanto você perderia sem perceber"), "loss");
  assert.equal(inferVisualEmotionHint("uma sensação de conquista e realização"), "gain");
  assert.equal(inferVisualEmotionHint("um texto qualquer sem sinalização"), "neutral");
  assert.equal(inferVisualEmotionHint(undefined, undefined), "neutral");
});

test("ANTI_GENERIC_VISUAL_CONSTRAINTS bane explicitamente clipart, ícone, PowerPoint, Canva e template", () => {
  const joined = ANTI_GENERIC_VISUAL_CONSTRAINTS.join(" | ").toLowerCase();
  for (const banned of ["clipart", "ícone", "desenho", "vetor genérico", "infantil", "powerpoint", "canva", "template"]) {
    assert.ok(joined.includes(banned), `esperava encontrar "${banned}" nas restrições anti-genéricas`);
  }
});

test("VISUAL_REFERENCE_LIBRARY cobre as seis referências de gênero pedidas", () => {
  assert.deepEqual(
    [...VISUAL_REFERENCE_STYLES].sort(),
    [
      "cinematicDirection",
      "highEndWeddingPhotography",
      "luxuryEditorial",
      "minimalistModernCampaign",
      "photographicAdvertising",
      "premiumCampaign",
    ].sort(),
  );
  for (const style of VISUAL_REFERENCE_STYLES) {
    assert.ok(VISUAL_REFERENCE_LIBRARY[style].length > 20);
  }
});

// ---------------------------------------------------------------------------------------------
// Pedro — estágio interno "Visual Enrichment"
// ---------------------------------------------------------------------------------------------

function createPedroInput(overrides = {}) {
  const slides = overrides.slides ?? [
    { slideIndex: 1, role: "Gancho", focalPoint: "caixa de presente", emphasis: "caixa de presente", visualWeightOrder: [] },
    { slideIndex: 2, role: "Dado", focalPoint: "dinheiro escapando da lista", emphasis: "dinheiro", visualWeightOrder: [] },
  ];
  const biancaDesign = {
    visualConcept: "caixa de presente",
    emotionalObjective: "gerar sensação de perda",
    desiredFeeling: "reflexão e alerta",
    suggestedPalette: ["#C97F91", "#111111", "#FFFFFF"],
  };
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quanto você perderia em outras listas de presentes?",
    biancaDesign,
    biancaPedroBriefing: { ...biancaDesign, slides },
    channel: "instagram",
    format: "carrossel",
    imageCount: slides.length,
    desiredAspectRatio: "4:5",
    ...overrides,
  };
}

test("buildVisualEnrichments produz uma cena por imagem, na mesma ordem dos slides da Bianca", () => {
  const input = createPedroInput();
  const enrichments = buildVisualEnrichments(input);

  assert.equal(enrichments.length, 2);
  assert.ok(enrichments[0].protagonist.toLowerCase().includes("caixa de presente"));
  assert.ok(enrichments[1].secondaryElement.length > 0);
  assert.notDeepEqual(enrichments[0], enrichments[1]);
});

test("buildVisualEnrichments usa o emotionHint inferido do pedido original/objetivo emocional da Bianca", () => {
  const lossInput = createPedroInput({ originalRequest: "Quanto você perderia sem perceber" });
  const gainInput = createPedroInput({
    originalRequest: "Sinta a sensação de conquista e realização",
    biancaDesign: {
      visualConcept: "dinheiro",
      emotionalObjective: "gerar sensação de conquista",
      desiredFeeling: "realização e sucesso",
      suggestedPalette: ["#C97F91"],
    },
  });
  // `biancaPedroBriefing` precisa refletir o mesmo `biancaDesign` sobrescrito, senão o teste mistura sinais de perda e ganho.
  gainInput.biancaPedroBriefing = { ...gainInput.biancaDesign, slides: gainInput.biancaPedroBriefing.slides };

  const lossScenes = buildVisualEnrichments(lossInput);
  const gainScenes = buildVisualEnrichments(gainInput);

  assert.notEqual(lossScenes[1].visualEmotion, gainScenes[1].visualEmotion);
  assert.ok(gainScenes[1].sceneDescription.includes("ganho") || gainScenes[1].sceneDescription.includes("confiança"));
});

test("buildVisualEnrichments funciona para peça única (sem slides), usando o visualConcept da Bianca", () => {
  const input = createPedroInput({
    slides: [],
    biancaPedroBriefing: { visualConcept: "aliança de casamento", slides: [] },
    imageCount: 1,
  });
  const enrichments = buildVisualEnrichments(input);

  assert.equal(enrichments.length, 1);
  assert.equal(enrichments[0].referenceStyle, "highEndWeddingPhotography");
});

test("buildFinalImagePrompt inclui a seção de Visual Enrichment e a biblioteca de referências no prompt final", () => {
  const input = createPedroInput();
  const context = { modules: {}, records: [] };
  const prompt = buildFinalImagePrompt(input, context);

  assert.ok(prompt.includes("VISUAL ENRICHMENT"));
  assert.ok(prompt.includes("REFERÊNCIA DE ESTILO FOTOGRÁFICO"));
  assert.ok(prompt.includes("sceneDescription"));
  assert.ok(prompt.includes("caixa de presente premium aberta"));
});

test("buildFinalImagePrompt sempre inclui as restrições anti-genéricas explícitas no negative prompt", () => {
  const input = createPedroInput();
  const context = { modules: {}, records: [] };
  const prompt = buildFinalImagePrompt(input, context);

  assert.ok(prompt.includes("nunca clipart"));
  assert.ok(prompt.includes("nunca ícone simples"));
  assert.ok(prompt.includes("nunca aparência de slide de PowerPoint"));
  assert.ok(prompt.includes("nunca aparência de template pronto de Canva básico"));
});

// ---------------------------------------------------------------------------------------------
// Sofia — cena cinematográfica, não conceito solto
// ---------------------------------------------------------------------------------------------

function sofiaContext(overrides = {}) {
  return {
    records: [],
    modules: {
      BrandContext: [{ payload: { promise: "Casamentos sem taxas escondidas", toneOfVoice: "leve divertido" } }],
      AudienceContext: [],
      IdentityContext: [],
      ContentContext: [],
      PublishingContext: [],
      ...overrides,
    },
  };
}

function sofiaInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quanto você perderia em outras listas de presentes?",
    joaoStrategy: {
      angle: "Aversão à perda",
      centralPromise: "Seu presente deveria ser do casal. Não da plataforma.",
      keyMessages: [],
      recommendedCta: "Conheça o Rumo ao Altar",
    },
    joaoSofiaBriefing: { status: "preliminary", channel: "instagram", format: "carrossel", angle: "Aversão à perda", centralPromise: "x", keyMessages: [], visualDirectionNotes: [], brandIdentityNotes: [], notes: [] },
    channel: "instagram",
    format: "carrossel",
    visualObjective: "caixa de presente",
    ...overrides,
  };
}

test("Sofia (buildBaselineDirection) transforma 'caixa de presente' em cena cinematográfica, não em conceito solto", () => {
  const direction = buildSofiaBaselineDirection(sofiaInput(), sofiaContext());

  assert.ok(direction.visualConcept.includes("caixa de presente premium aberta"));
  assert.ok(direction.visualConcept.includes("iluminada por"));
  assert.ok(!direction.visualConcept.startsWith("Conceito visual alinhado ao ângulo"));
  assert.ok(direction.moodboard.some((item) => item.startsWith("Estilo de referência:")));
  assert.ok(direction.designReferences.some((item) => item.toLowerCase().includes("cena fotográfica")));
});

// ---------------------------------------------------------------------------------------------
// Bianca — pensa como Diretora de Arte, não só layout
// ---------------------------------------------------------------------------------------------

function biancaInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quanto você perderia em outras listas de presentes?",
    joaoStrategy: { angle: "Aversão à perda", centralPromise: "Seu presente deveria ser do casal.", keyMessages: ["Dado 1", "Dado 2"], recommendedCta: "Conheça o Rumo ao Altar" },
    sofiaDirection: {
      visualConcept: "caixa de presente premium",
      recommendedStyle: "editorial romântico",
      emotionalTone: "reflexivo",
      suggestedPalette: ["#C97F91"],
      typography: ["Georgia"],
      moodboard: [],
      designReferences: [],
      recommendedFormat: "carrossel",
      recommendedAspectRatio: "4:5",
      visualConstraints: [],
      visualRisks: [],
      observations: [],
      nextSteps: [],
    },
    sofiaBriefing: { status: "preliminary", visualConcept: "caixa de presente premium", recommendedStyle: "editorial romântico", emotionalTone: "reflexivo", suggestedPalette: ["#C97F91"], typography: ["Georgia"], moodboard: [], designReferences: [], recommendedFormat: "carrossel", recommendedAspectRatio: "4:5", visualConstraints: [], channel: "instagram", notes: [] },
    channel: "instagram",
    format: "carrossel",
    recommendedSlideCount: 4,
    ...overrides,
  };
}

function biancaContext() {
  return { records: [], modules: { IdentityContext: [], PublishingContext: [] } };
}

test("Bianca (buildBaselineDesign) preenche artDirection em todo slide, com julgamento de Diretora de Arte", () => {
  const design = buildBiancaBaselineDesign(biancaInput(), biancaContext());

  assert.ok(design.slides.length >= 3);
  for (const slide of design.slides) {
    assert.ok(slide.artDirection, `slide ${slide.slideIndex} deveria ter artDirection`);
    assert.ok(slide.artDirection.dominantElement.length > 0);
    assert.ok(slide.artDirection.dominantElementScreenShare.length > 0);
    assert.ok(slide.artDirection.eyeFlowFirstFocus.length > 0);
    assert.ok(slide.artDirection.emotionBeforeReading.length > 0);
    assert.ok(slide.artDirection.timeToUnderstand.length > 0);
    assert.ok(slide.artDirection.visualTension.length > 0);
    assert.ok(slide.artDirection.balance.length > 0);
    assert.ok(slide.artDirection.contrastAssessment.length > 0);
  }
});

test("Bianca diferencia a decisão de Diretora de Arte entre o slide de gancho e o slide de CTA", () => {
  const design = buildBiancaBaselineDesign(biancaInput(), biancaContext());
  const hookSlide = design.slides[0];
  const ctaSlide = design.slides[design.slides.length - 1];

  assert.notEqual(hookSlide.artDirection.dominantElementScreenShare, ctaSlide.artDirection.dominantElementScreenShare);
  assert.notEqual(hookSlide.artDirection.visualTension, ctaSlide.artDirection.visualTension);
  assert.ok(hookSlide.artDirection.dominantElementScreenShare.includes("60%-70%"));
  assert.ok(ctaSlide.artDirection.eyeFlowFirstFocus.toLowerCase().includes("cta"));
});
