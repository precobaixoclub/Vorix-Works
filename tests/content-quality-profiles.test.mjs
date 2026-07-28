import test from "node:test";
import assert from "node:assert/strict";
import { resolveContentQualityProfile, CONTENT_QUALITY_PROFILES } from "../dist/shared/utils/content-quality-profile.js";
import { evaluateCopyQuality, MariaCopywritingSkill } from "../dist/skills/maria-copywriting/index.js";
import { buildBaselineReview } from "../dist/skills/lucas-quality-review/index.js";
import { ArthurOrchestrator } from "../dist/application/orchestration/arthur.orchestrator.js";

const REVIEW_THRESHOLDS = { approvalScoreThreshold: 90, warningScoreThreshold: 70, adjustmentScoreThreshold: 40 };

// ---------------------------------------------------------------------------------------------
// resolveContentQualityProfile
// ---------------------------------------------------------------------------------------------

test("resolveContentQualityProfile reconhece os 5 perfis a partir do rótulo do Eduardo (post único/carrossel/reels/vídeo/story)", () => {
  assert.equal(resolveContentQualityProfile("post único"), "feed");
  assert.equal(resolveContentQualityProfile("carrossel"), "carrossel");
  assert.equal(resolveContentQualityProfile("reels"), "reels");
  assert.equal(resolveContentQualityProfile("vídeo"), "video");
  assert.equal(resolveContentQualityProfile("story"), "story");
});

test("resolveContentQualityProfile cai em 'feed' para formato ausente, vazio ou desconhecido (compatibilidade com briefings antigos)", () => {
  assert.equal(resolveContentQualityProfile(undefined), "feed");
  assert.equal(resolveContentQualityProfile(null), "feed");
  assert.equal(resolveContentQualityProfile(""), "feed");
  assert.equal(resolveContentQualityProfile("imagem_unica"), "feed");
  assert.equal(resolveContentQualityProfile("algo-nao-mapeado"), "feed");
});

test("CONTENT_QUALITY_PROFILES cobre exatamente os 5 perfis pedidos", () => {
  assert.deepEqual([...CONTENT_QUALITY_PROFILES].sort(), ["carrossel", "feed", "reels", "story", "video"].sort());
});

// ---------------------------------------------------------------------------------------------
// Maria — evaluateCopyQuality por perfil
// ---------------------------------------------------------------------------------------------

function baseBriefing(overrides = {}) {
  return {
    objective: "Gerar interesse pela lista de presentes com taxa zero.",
    channel: "instagram",
    targetAudience: "Noivos e convidados de casamento",
    toneOfVoice: "leve divertido persuasivo",
    cta: "Conheça o Rumo ao Altar",
    keyMessage: "Taxa zero sobre presentes via Pix.",
    ...overrides,
  };
}

function withPublication(copy) {
  return { ...copy, publication: [copy.caption, copy.cta, copy.hashtags.join(" ")].filter(Boolean).join("\n\n") };
}

function feedPerfectCopy() {
  const caption = [
    "E se a lista de presentes do casamento não comesse um pedacinho do presente dos noivos? 💌",
    "O convidado quer presentear com carinho, os noivos querem receber com organização e ninguém merece transformar esse momento em taxa, dúvida e comprovante perdido.",
    "Com o Rumo ao Altar, a lista fica simples: o convidado presenteia por Pix e o valor cai direto na conta dos noivos. Sem taxa na lista, sem climão e com tudo organizado no painel. ✨",
    "Você acha que isso deixaria a vida dos noivos mais leve? Comenta aqui. 👇",
    "Salva este post para lembrar dessa ideia e compartilha com aquele casal que está montando o site do casamento.",
  ].join("\n");
  return withPublication({
    title: "Presentear ficou mais fácil",
    caption,
    cta: "Conheça o Rumo ao Altar",
    hashtags: [
      "#RumoAoAltar", "#TaxaZero", "#ListaDePresentes", "#ListaDeCasamento", "#PresentesDeCasamento",
      "#PixParaNoivos", "#CasamentoComPix", "#SiteDeCasamento", "#CasamentoDigital", "#Noivos",
      "#Noivas", "#Noivos2026", "#OrganizacaoDeCasamento", "#PlanejamentoDeCasamento", "#CasamentoSemStress",
    ],
    keywords: ["casamento", "pix", "presentes"],
    summary: "Copy sobre taxa zero.",
    objective: "Gerar interesse pela lista de presentes com taxa zero.",
    toneUsed: "leve divertido persuasivo",
    identifiedAudience: "Noivos e convidados de casamento",
    futureSuggestions: [],
    observations: [],
  });
}

function storyPerfectCopy() {
  return withPublication({
    title: "Zero é zero mesmo?",
    caption: "Sabia que 100% do valor do Pix 💍 vai direto pros noivos?",
    cta: "rumoaoaltar.com.br",
    hashtags: ["#RumoAoAltar", "#TaxaZero"],
    keywords: ["taxa zero"],
    summary: "Story curto sobre taxa zero.",
    objective: "Gerar curiosidade rápida sobre taxa zero.",
    toneUsed: "leve divertido persuasivo",
    identifiedAudience: "Noivos e convidados de casamento",
    futureSuggestions: [],
    observations: [],
  });
}

function reelsPerfectCopy() {
  const caption = [
    "Você sabia que dá pra ter presente de casamento sem taxa nenhuma? 🎁",
    "Salva esse vídeo e manda pro casal que tá organizando o casamento.",
    "Conheça o Rumo ao Altar e crie sua lista com taxa zero agora mesmo.",
  ].join("\n");
  return withPublication({
    title: "Taxa zero em 15 segundos",
    caption,
    cta: "Conheça o Rumo ao Altar",
    hashtags: ["#RumoAoAltar", "#TaxaZero", "#ListaDePresentes", "#PixParaNoivos", "#CasamentoDigital"],
    keywords: ["taxa zero", "reels"],
    summary: "Reels curto sobre taxa zero.",
    objective: "Gerar interesse pela lista de presentes com taxa zero.",
    toneUsed: "leve divertido persuasivo",
    identifiedAudience: "Noivos e convidados de casamento",
    futureSuggestions: [],
    observations: [],
  });
}

function videoPerfectCopy() {
  const caption = [
    "Descubra como funciona a lista de presentes com taxa zero do Rumo ao Altar.",
    "O convidado paga por Pix e o valor cai inteiro na conta dos noivos.",
    "Conheça o Rumo ao Altar 🎥 e veja como configurar em minutos.",
  ].join("\n");
  return withPublication({
    title: "Como funciona a taxa zero",
    caption,
    cta: "Conheça o Rumo ao Altar",
    hashtags: ["#RumoAoAltar", "#TaxaZero", "#ListaDePresentes", "#Casamento"],
    keywords: ["taxa zero", "vídeo"],
    summary: "Vídeo curto explicando taxa zero.",
    objective: "Gerar interesse pela lista de presentes com taxa zero.",
    toneUsed: "leve divertido persuasivo",
    identifiedAudience: "Noivos e convidados de casamento",
    futureSuggestions: [],
    observations: [],
  });
}

test("Maria: perfil Feed (format ausente/'post único') aprova legenda longa com storytelling, CTA completo e hashtags — critérios inalterados desde antes da separação por perfil", () => {
  const quality = evaluateCopyQuality(feedPerfectCopy(), baseBriefing(), 1);
  assert.equal(quality.profile, "feed");
  assert.equal(quality.passed, true);
  assert.deepEqual(quality.issues, []);
});

test("Maria: perfil Story aprova texto curto, CTA curto e legenda com curiosidade — sem exigir legenda longa, CTA extenso, 15+ hashtags ou convite para comentar/salvar", () => {
  const quality = evaluateCopyQuality(storyPerfectCopy(), baseBriefing({ format: "story" }), 1);
  assert.equal(quality.profile, "story");
  assert.equal(quality.passed, true);
  assert.deepEqual(quality.issues, []);
});

test("Maria: a mesma legenda curta de Story é REPROVADA pelo perfil Feed (prova de que os critérios são realmente diferentes por formato)", () => {
  const quality = evaluateCopyQuality(storyPerfectCopy(), baseBriefing({ format: "post único" }), 1);
  assert.equal(quality.profile, "feed");
  assert.equal(quality.passed, false);
  const codes = quality.issues.map((issue) => issue.code);
  assert.ok(codes.includes("CAPTION_TOO_SHORT"));
  assert.ok(codes.includes("TOO_FEW_HASHTAGS"));
  assert.ok(codes.includes("MISSING_COMMENT_PROMPT"));
  assert.ok(codes.includes("MISSING_SAVE_SHARE_PROMPT"));
});

test("Maria: perfil Carrossel usa os mesmos critérios de progressão/fechamento do Feed (legenda longa, CTA completo, hashtags)", () => {
  const quality = evaluateCopyQuality(feedPerfectCopy(), baseBriefing({ format: "carrossel" }), 1);
  assert.equal(quality.profile, "carrossel");
  assert.equal(quality.passed, true);
  assert.deepEqual(quality.issues, []);
});

test("Maria: perfil Reels aprova gancho curto, ritmo direto e CTA — sem exigir convite para comentar nem legenda longa", () => {
  const quality = evaluateCopyQuality(reelsPerfectCopy(), baseBriefing({ format: "reels" }), 1);
  assert.equal(quality.profile, "reels");
  assert.equal(quality.passed, true);
  assert.deepEqual(quality.issues, []);
});

test("Maria: perfil Vídeo aprova narrativa objetiva com gancho e encerramento — sem exigir convite para comentar/salvar", () => {
  const quality = evaluateCopyQuality(videoPerfectCopy(), baseBriefing({ format: "vídeo" }), 1);
  assert.equal(quality.profile, "video");
  assert.equal(quality.passed, true);
  assert.deepEqual(quality.issues, []);
});

test("Maria: perfil Reels reprova legenda sem gancho curto no início (MISSING_HOOK)", () => {
  const rambling = "Bom, então, deixa eu te contar uma história bem longa sobre como surgiu a ideia da nossa lista de presentes, começando lá do início, quando os fundadores ainda nem tinham pensado nisso direito, e foi um processo bem gradual até chegarmos na taxa zero que vocês conhecem hoje.";
  const copy = withPublication({
    title: "História da taxa zero",
    caption: `${rambling}\nConheça o Rumo ao Altar.`,
    cta: "Conheça o Rumo ao Altar",
    hashtags: ["#RumoAoAltar", "#TaxaZero", "#ListaDePresentes", "#PixParaNoivos", "#Casamento"],
    keywords: [],
    summary: "x",
    objective: "x",
    toneUsed: "leve divertido persuasivo",
    identifiedAudience: "Noivos",
    futureSuggestions: [],
    observations: [],
  });
  const quality = evaluateCopyQuality(copy, baseBriefing({ format: "reels" }), 1);
  assert.equal(quality.passed, false);
  assert.ok(quality.issues.some((issue) => issue.code === "MISSING_HOOK"));
});

test("Maria: perfil Story reprova legenda sem gatilho de curiosidade (MISSING_CURIOSITY_TRIGGER) e CTA longo demais (CTA_TOO_LONG_FOR_FORMAT)", () => {
  const copy = withPublication({
    title: "Taxa zero",
    caption: "Todo valor do Pix cai direto na conta dos noivos.",
    cta: "Conheça o Rumo ao Altar em rumoaoaltar.com.br agora mesmo sem enrolação",
    hashtags: ["#RumoAoAltar"],
    keywords: [],
    summary: "x",
    objective: "x",
    toneUsed: "leve divertido persuasivo",
    identifiedAudience: "Noivos",
    futureSuggestions: [],
    observations: [],
  });
  const quality = evaluateCopyQuality(copy, baseBriefing({ format: "story" }), 1);
  const codes = quality.issues.map((issue) => issue.code);
  assert.ok(codes.includes("MISSING_CURIOSITY_TRIGGER"));
  assert.ok(codes.includes("CTA_TOO_LONG_FOR_FORMAT"));
});

// ---------------------------------------------------------------------------------------------
// Retries não devem ocorrer quando a copy já atende perfeitamente ao perfil correto
// ---------------------------------------------------------------------------------------------

class ScriptedIcaroBrain {
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
      model: { id: "fake-copy-model" },
      durationMs: 3,
      tokens: { input: request.prompt.length, output: 100, total: request.prompt.length + 100 },
      cost: { estimated: 0.01, currency: "USD" },
      content: next,
      warnings: [],
      attempt: { total: 1, providerAttempt: 1, providerId: "fake-ai-provider" },
      fallbackUsed: false,
    };
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

test("Retries não ocorrem quando a copy já atende perfeitamente ao perfil Story na primeira tentativa (1 única chamada ao Ícaro)", async () => {
  const provider = new ScriptedIcaroBrain([JSON.stringify(storyPerfectCopy())]);
  const maria = new MariaCopywritingSkill({ icaro: provider, idGenerator: createDeterministicIdGenerator(), now: () => new Date("2026-07-12T12:00:00.000Z") });

  const response = await maria.execute({
    skillId: "maria-copywriting",
    input: baseBriefing({ format: "story" }),
    context: { executionId: "exec-story", taskId: "task-copy", correlationId: "corr-story", locale: "pt-BR", dryRun: true, requestedBy: "helena", orchestratedBy: "arthur" },
  });

  assert.equal(response.status, "completed");
  assert.equal(provider.calls.length, 1, "não deveria ter feito nenhuma tentativa adicional");
  assert.equal(response.output.attempts.length, 1);
  assert.equal(response.output.deliveredBestEffort, false);
  assert.equal(response.output.quality.passed, true);
  assert.equal(response.output.quality.profile, "story");
});

// ---------------------------------------------------------------------------------------------
// Lucas — buildBaselineReview por perfil
// ---------------------------------------------------------------------------------------------

const CLIENT_ID = "client-casamento-1";

function lucasBaseInput(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    originalRequest: "Quero uma peça sobre a lista de presentes com taxa zero.",
    joaoStrategy: {
      objective: "Gerar interesse pela taxa zero",
      targetAudience: "Noivos e convidados de casamento",
      channel: "instagram",
      toneOfVoice: "leve divertido persuasivo",
      angle: "Ângulo de conversão com benefício direto.",
      centralPromise: "Taxa zero sobre presentes via Pix.",
      valueProposition: "100% do valor cai direto na conta dos noivos.",
      keyMessages: ["Taxa zero sobre todo valor recebido via Pix."],
      recommendedCta: "Conheça o Rumo ao Altar",
      risks: ["Evitar prometer isenção de tarifas do próprio banco do convidado."],
    },
    mariaCopy: {
      title: "Taxa zero",
      caption: "Todo valor do Pix cai direto na conta dos noivos, sem desconto.",
      cta: "Conheça o Rumo ao Altar",
      hashtags: ["#RumoAoAltar", "#TaxaZero"],
      keywords: ["taxa zero"],
      summary: "Copy sobre taxa zero.",
      objective: "Gerar interesse pela taxa zero",
      toneUsed: "leve divertido persuasivo",
      identifiedAudience: "Noivos e convidados de casamento",
      qualityScore: 92,
      qualityPassed: true,
    },
    channel: "instagram",
    format: "carrossel",
    ...overrides,
  };
}

const CONTEXT_WITH_BRAND = {
  modules: {
    BrandContext: [{ payload: { toneOfVoice: "leve divertido persuasivo", forbiddenWords: [], forbiddenHashtags: [], mandatoryWords: [] } }],
    IdentityContext: [{ payload: {} }],
  },
  records: [],
};

test("Lucas: perfil Feed/Carrossel não dispara nenhum critério exclusivo de Story/Reels/Vídeo", () => {
  const review = buildBaselineReview(lucasBaseInput({
    format: "carrossel",
    sofiaDirection: { visualConcept: "x", recommendedStyle: "x", suggestedPalette: [], recommendedFormat: "carrossel", recommendedAspectRatio: "4:5", visualConstraints: [], visualRisks: [] },
    biancaDesign: { designConcept: "x", gridSystem: "x", slides: [{ slideIndex: 1, role: "a" }, { slideIndex: 2, role: "b" }, { slideIndex: 3, role: "c" }], designRisks: [] },
    pedroImages: { imageCount: 3, images: [{ width: 1080, height: 1350, aspectRatio: "4:5" }, { width: 1080, height: 1350, aspectRatio: "4:5" }, { width: 1080, height: 1350, aspectRatio: "4:5" }] },
  }), CONTEXT_WITH_BRAND, REVIEW_THRESHOLDS);

  assert.equal(review.qualityProfile, "carrossel");
  const codes = review.issues.map((issue) => issue.code);
  assert.equal(codes.some((code) => code.startsWith("STORY_")), false);
  assert.equal(codes.includes("CARROSSEL_INSUFFICIENT_PROGRESSION"), false);
  assert.equal(codes.includes("CARROSSEL_MISSING_FINAL_CTA"), false);
  assert.ok(review.checklist.some((item) => item.item.includes("perfil Carrossel")));
});

test("Lucas: perfil Story não penaliza legenda curta (nenhum critério de Feed é aplicado) e relata o perfil usado", () => {
  const review = buildBaselineReview(lucasBaseInput({
    format: "story",
    mariaCopy: { ...lucasBaseInput().mariaCopy, caption: "Sabia que 100% do Pix vai pros noivos? 💍", cta: "rumoaoaltar.com.br" },
  }), CONTEXT_WITH_BRAND, REVIEW_THRESHOLDS);

  assert.equal(review.qualityProfile, "story");
  const codes = review.issues.map((issue) => issue.code);
  assert.equal(codes.includes("STORY_CAPTION_TOO_LONG"), false);
  assert.equal(codes.includes("STORY_CTA_TOO_LONG"), false);
  assert.equal(codes.includes("STORY_MISSING_CURIOSITY"), false);
  assert.ok(review.checklist.some((item) => item.item.includes("perfil Story")));
});

test("Lucas: perfil Story identifica legenda longa demais, CTA longo demais e falta de curiosidade", () => {
  const longCaption = "Todo valor recebido via Pix na lista de presentes cai cem por cento direto na conta dos noivos, sem nenhum desconto, sem percentual retido pela plataforma e sem qualquer tipo de intermediário no meio do caminho, garantindo total transparência.".repeat(2);
  const review = buildBaselineReview(lucasBaseInput({
    format: "story",
    mariaCopy: {
      ...lucasBaseInput().mariaCopy,
      caption: longCaption,
      cta: "Conheça o Rumo ao Altar em rumoaoaltar.com.br sem enrolação nenhuma",
    },
  }), CONTEXT_WITH_BRAND, REVIEW_THRESHOLDS);

  const codes = review.issues.map((issue) => issue.code);
  assert.ok(codes.includes("STORY_CAPTION_TOO_LONG"));
  assert.ok(codes.includes("STORY_CTA_TOO_LONG"));
  assert.ok(codes.includes("STORY_MISSING_CURIOSITY"));
});

test("Lucas: perfil Carrossel identifica progressão insuficiente (menos de 3 slides) e CTA final ausente", () => {
  const review = buildBaselineReview(lucasBaseInput({
    format: "carrossel",
    mariaCopy: { ...lucasBaseInput().mariaCopy, cta: "" },
    pedroImages: { imageCount: 1, images: [{ width: 1080, height: 1350, aspectRatio: "4:5" }] },
  }), CONTEXT_WITH_BRAND, REVIEW_THRESHOLDS);

  const codes = review.issues.map((issue) => issue.code);
  assert.ok(codes.includes("CARROSSEL_INSUFFICIENT_PROGRESSION"));
  assert.ok(codes.includes("CARROSSEL_MISSING_FINAL_CTA"));
});

test("Lucas: perfil Reels/Vídeo sem nenhum pacote de vídeo (Bruno/Vanessa/Diego) identifica MISSING_VIDEO_PACKAGE_FOR_FORMAT", () => {
  const reelsReview = buildBaselineReview(lucasBaseInput({ format: "reels", sofiaDirection: undefined, biancaDesign: undefined, pedroImages: undefined }), CONTEXT_WITH_BRAND, REVIEW_THRESHOLDS);
  assert.equal(reelsReview.qualityProfile, "reels");
  assert.ok(reelsReview.issues.some((issue) => issue.code === "MISSING_VIDEO_PACKAGE_FOR_FORMAT"));
  assert.ok(reelsReview.checklist.some((item) => item.item.includes("Reels") && item.passed === false));

  const videoReview = buildBaselineReview(lucasBaseInput({ format: "vídeo", sofiaDirection: undefined, biancaDesign: undefined, pedroImages: undefined }), CONTEXT_WITH_BRAND, REVIEW_THRESHOLDS);
  assert.equal(videoReview.qualityProfile, "video");
  assert.ok(videoReview.issues.some((issue) => issue.code === "MISSING_VIDEO_PACKAGE_FOR_FORMAT"));
});

test("Lucas: perfil Reels com pacote de vídeo completo (Bruno/Vanessa/Diego/Rafa) não dispara MISSING_VIDEO_PACKAGE_FOR_FORMAT", () => {
  const review = buildBaselineReview(lucasBaseInput({
    format: "reels",
    sofiaDirection: undefined,
    biancaDesign: undefined,
    pedroImages: undefined,
    brunoScript: {
      hook: "Gancho claro.",
      totalDurationSeconds: 15,
      scenes: [{ order: 1, name: "Gancho", durationSeconds: 15, spokenText: "x" }],
      finalCta: "Conheça o Rumo ao Altar",
      channel: "instagram",
    },
    vanessaDirection: { sceneDirections: [{ order: 1, name: "Gancho" }], visualRhythm: "acelerado", captionStyle: "bold", channel: "instagram" },
    diegoEditingPlan: { editingTimeline: [{ order: 1, name: "Gancho" }], totalDurationSeconds: 15, channel: "instagram" },
    rafaVideo: {
      fileName: "final-video.mp4",
      mimeType: "video/mp4",
      extension: "mp4",
      specs: { width: 1080, height: 1920, aspectRatio: "9:16", durationSeconds: 15, format: "mp4" },
      sizeBytes: 200000,
      motionSummary: {
        scenes: 1,
        totalAnimatedElements: 4,
        totalIndependentAnimations: 4,
        averageAnimatedElementsPerScene: 4,
        transitionTypes: ["cut", "slide_up", "pop"],
        elementAnimations: ["slide_up", "pop", "fade"],
        maxStaticMockupSeconds: 0.6,
        mockupElements: 1,
        simultaneousEntryWarnings: 0,
      },
    },
  }), CONTEXT_WITH_BRAND, REVIEW_THRESHOLDS);

  assert.equal(review.issues.some((issue) => issue.code === "MISSING_VIDEO_PACKAGE_FOR_FORMAT"), false);
});

// ---------------------------------------------------------------------------------------------
// Wiring: Lucas precisa receber o formato REAL do Eduardo (recommendedFormatLabel), não o
// placeholder estático de Arthur — sem isso, o perfil correto nunca chegaria até Lucas.
// ---------------------------------------------------------------------------------------------

function createDeterministicArthurIdGenerator() {
  let nextNumber = 1;
  return {
    create(prefix) {
      const id = `${prefix}-${String(nextNumber).padStart(4, "0")}`;
      nextNumber += 1;
      return id;
    },
  };
}

test("Arthur monta o binding de 'format' da etapa de Revisão a partir de recommendedFormatLabel do Eduardo (não do placeholder estático)", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicArthurIdGenerator() });
  const result = await arthur.planFromText({
    command: "crie um Story sobre a lista de presentes com taxa zero para o Rumo ao Altar",
    clientId: "client-rumo",
  });

  const reviewStep = result.executionPlan.steps.find((step) => step.skillCapability === "quality_review");
  assert.ok(reviewStep, "deveria existir uma etapa de revisão");
  const formatBinding = reviewStep.inputBindings?.find((binding) => binding.targetField === "format");
  assert.ok(formatBinding, "a etapa de Revisão deveria ter um inputBinding para 'format'");
  assert.equal(formatBinding.sourcePath, "recommendedFormatLabel");

  const editorialStep = result.executionPlan.steps.find((step) => step.skillCapability === "editorial_planning");
  assert.equal(formatBinding.fromStepId, editorialStep.id);
});
