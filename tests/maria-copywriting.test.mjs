import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SkillManifestValidator } from "../dist/application/skills/skill-manifest.validator.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";
import {
  MariaCopywritingSkill,
  buildMariaPrompt,
  createCopyStrategy,
  evaluateCopyQuality,
  mariaCopywritingManifest,
} from "../dist/skills/maria-copywriting/index.js";

function createBriefing(overrides = {}) {
  return {
    objective: "Gerar interesse e conversão para uma publicação sobre presentes via PIX.",
    channel: "instagram",
    targetAudience: "Noivos e convidados de casamento",
    toneOfVoice: "leve divertido persuasivo",
    cta: "Conheça o Rumo ao Altar",
    keyMessage: "Convidados podem enviar presentes via PIX direto para os noivos com praticidade.",
    productName: "Rumo ao Altar",
    offer: "Site de casamento com lista de presentes por PIX",
    platformLimitations: {
      maxCaptionLength: 1200,
      maxHashtags: 25,
    },
    keywords: ["casamento", "pix", "presentes", "noivos"],
    forbiddenTerms: ["garantia absoluta"],
    language: "pt-BR",
    ...overrides,
  };
}

function createRequest(input = createBriefing()) {
  return {
    skillId: "maria-copywriting",
    input,
    context: {
      executionId: "exec-maria",
      taskId: "task-copy",
      correlationId: "corr-maria",
      locale: "pt-BR",
      dryRun: true,
      requestedBy: "helena",
      orchestratedBy: "arthur",
    },
  };
}

function goodCopyJson() {
  const caption = [
    "E se a lista de presentes do casamento não comesse um pedacinho do presente dos noivos? 💌",
    "",
    "O convidado quer presentear com carinho, os noivos querem receber com organização… e ninguém merece transformar esse momento em taxa, dúvida e comprovante perdido.",
    "",
    "Com o Rumo ao Altar, a lista fica simples: o convidado presenteia por Pix e o valor cai direto na conta dos noivos. Sem taxa na lista, sem climão e com tudo organizado no painel. ✨",
    "",
    "Você acha que isso deixaria a vida dos noivos mais leve? Comenta aqui. 👇",
    "",
    "Salva este post para lembrar dessa ideia e compartilha com aquele casal que está montando o site do casamento.",
  ].join("\n");
  const cta = "Conheça o Rumo ao Altar";
  const hashtags = [
    "#RumoAoAltar",
    "#TaxaZero",
    "#ListaDePresentes",
    "#ListaDeCasamento",
    "#PresentesDeCasamento",
    "#PixParaNoivos",
    "#CasamentoComPix",
    "#SiteDeCasamento",
    "#CasamentoDigital",
    "#Noivos",
    "#Noivas",
    "#Noivos2026",
    "#OrganizacaoDeCasamento",
    "#PlanejamentoDeCasamento",
    "#CasamentoSemStress",
    "#DicasParaNoivos",
  ];
  return JSON.stringify({
    title: "Presentear ficou mais fácil",
    caption,
    cta,
    hashtags,
    publication: [caption, cta, hashtags.join(" ")].join("\n\n"),
    keywords: ["casamento", "pix", "presentes", "noivos"],
    summary: "Copy para apresentar presentes via PIX no Rumo ao Altar.",
    objective: "Gerar interesse e conversão para uma publicação sobre presentes via PIX.",
    toneUsed: "leve divertido persuasivo",
    identifiedAudience: "Noivos e convidados de casamento",
    futureSuggestions: ["Criar variação para stories com enquete."],
    observations: ["CTA alinhado ao briefing."],
  });
}

function poorCopyJson() {
  return JSON.stringify({
    title: "",
    caption: "Presente pix pix pix pix pix",
    cta: "Clique",
    hashtags: ["#Pix", "#Pix", "#Pix", "#Casamento", "#Noivos", "#Festa", "#Amor"],
    publication: "",
    keywords: ["pix"],
    summary: "Rascunho fraco.",
    objective: "Outro objetivo",
    toneUsed: "frio",
    identifiedAudience: "todos",
    futureSuggestions: [],
    observations: [],
  });
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
    if (next?.status) return next;
    return {
      status: "completed",
      provider: { id: "fake-ai-provider", name: "Fake AI Provider" },
      model: { id: "fake-copy-model" },
      durationMs: 3,
      tokens: { input: request.prompt.length, output: 100, total: request.prompt.length + 100 },
      cost: { estimated: 0.01, currency: "USD" },
      content: next ?? goodCopyJson(),
      warnings: [],
      attempt: { total: 1, providerAttempt: 1, providerId: "fake-ai-provider" },
      fallbackUsed: false,
    };
  }
}

class InMemoryMariaLogger {
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

test("Maria possui manifesto válido para Helena", () => {
  const validator = new SkillManifestValidator();
  const result = validator.validate(mariaCopywritingManifest);

  assert.equal(result.valid, true);
  assert.equal(result.manifest.id, "maria-copywriting");
  assert.deepEqual(result.manifest.capabilities, ["copywriting"]);
  assert.equal(result.manifest.enabled, true);
  assert.equal(result.manifest.owner, "helena-managed");
});

test("Maria gera estratégia de copy a partir do briefing estruturado", () => {
  const strategy = createCopyStrategy(createBriefing());

  assert.equal(strategy.channel, "instagram");
  assert.equal(strategy.audience, "Noivos e convidados de casamento");
  assert.equal(strategy.cta, "Conheça o Rumo ao Altar");
  assert.ok(strategy.valueProposition.includes("presentes via PIX"));
  assert.ok(strategy.platformGuidance.some((item) => item.includes("hashtags")));
});

test("Maria monta prompt com briefing, estratégia, formato JSON e ajustes de qualidade", () => {
  const briefing = createBriefing();
  const strategy = createCopyStrategy(briefing);
  const prompt = buildMariaPrompt(briefing, strategy, [
    { code: "WEAK_CTA", message: "CTA fraco.", severity: "high" },
  ], 2);

  assert.ok(prompt.includes("BRIEFING ESTRUTURADO"));
  assert.ok(prompt.includes("ESTRATÉGIA DE COPY"));
  assert.ok(prompt.includes("Retorne apenas JSON válido"));
  assert.ok(prompt.includes("CTA fraco"));
  assert.ok(prompt.includes("TENTATIVA: 2"));
  assert.ok(prompt.includes("entre 15 e 25"));
  assert.ok(prompt.includes("publication"));
  assert.ok(prompt.includes("comentários, salvamentos e compartilhamentos"));
});

test("Maria utiliza Ícaro, faz múltiplas tentativas e devolve copy estruturada aprovada", async () => {
  const provider = new FakeIcaroBrain([poorCopyJson(), goodCopyJson()]);
  const logger = new InMemoryMariaLogger();
  const events = new InMemoryZunoEventRecorder();
  const maria = new MariaCopywritingSkill({
    icaro: provider,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  const response = await maria.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(provider.calls.length, 2);
  assert.equal(response.output.title, "Presentear ficou mais fácil");
  assert.equal(response.output.cta, "Conheça o Rumo ao Altar");
  assert.equal(response.output.hashtags.length, 16);
  assert.deepEqual(response.output.hashtags.slice(0, 4), ["#RumoAoAltar", "#TaxaZero", "#ListaDePresentes", "#ListaDeCasamento"]);
  assert.equal(response.output.publication, [
    response.output.caption,
    response.output.cta,
    response.output.hashtags.join(" "),
  ].join("\n\n"));
  assert.equal(response.output.deliveredBestEffort, false);
  assert.equal(response.output.attempts.length, 2);
  assert.equal(response.output.quality.passed, true);
  assert.equal(provider.calls[0].taskType, "text_generation");
  assert.equal(provider.calls[0].specialistId, "maria-copywriting");
  assert.equal(provider.calls[0].expectedOutput, "json");
  assert.ok(provider.calls[0].prompt.includes("FORMATO OBRIGATÓRIO DO JSON"));
  assert.ok(provider.calls[1].prompt.includes("Corrigir"));
  assert.ok(logger.list().some((entry) => entry.action === "BriefingReceived"));
  assert.ok(logger.list().some((entry) => entry.action === "PromptBuilt" && entry.attempt === 1));
  assert.ok(logger.list().some((entry) => entry.action === "CopyApproved"));
  assert.ok(logger.list().some((entry) => entry.action === "CopyDelivered"));
  assert.deepEqual(events.list().map((event) => event.name), [
    "CopyGenerationStarted",
    "PromptBuilt",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "CopyValidated",
    "PromptBuilt",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "CopyValidated",
    "CopyDelivered",
  ]);
});

test("Maria devolve melhor resultado com relatório quando qualidade mínima não é atingida", async () => {
  const provider = new FakeIcaroBrain([poorCopyJson(), poorCopyJson(), poorCopyJson()]);
  const maria = new MariaCopywritingSkill({
    icaro: provider,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  const response = await maria.execute(createRequest());

  assert.equal(response.status, "completed");
  assert.equal(provider.calls.length, 3);
  assert.equal(response.output.deliveredBestEffort, true);
  assert.equal(response.output.quality.passed, false);
  assert.ok(response.output.quality.issues.length > 0);
  assert.ok(response.warnings.length > 0);
});

test("Maria trata falha total do Ícaro como erro estruturado", async () => {
  const provider = new FakeIcaroBrain([
    new Error("Provider indisponível"),
    new Error("Provider indisponível"),
    new Error("Provider indisponível"),
  ]);
  const logger = new InMemoryMariaLogger();
  const maria = new MariaCopywritingSkill({
    icaro: provider,
    logger,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  const response = await maria.execute(createRequest());

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "AI_PROVIDER_FAILURE");
  assert.equal(provider.calls.length, 3);
  assert.equal(logger.list().filter((entry) => entry.action === "ProviderError").length, 3);
});

test("Maria valida automaticamente critérios de qualidade", () => {
  const copy = JSON.parse(poorCopyJson());
  const quality = evaluateCopyQuality(copy, createBriefing(), 1);

  assert.equal(quality.passed, false);
  assert.ok(quality.issues.some((issue) => issue.code === "MISSING_TITLE"));
  assert.ok(quality.issues.some((issue) => issue.code === "DUPLICATED_HASHTAGS"));
  assert.ok(quality.issues.some((issue) => issue.code === "TOO_FEW_HASHTAGS"));
  assert.ok(quality.issues.some((issue) => issue.code === "TOO_FEW_EMOJIS"));
  assert.ok(quality.issues.some((issue) => issue.code === "MISSING_PUBLICATION"));
});

test("Maria aprova legenda profissional com emojis, CTA, hashtags suficientes e publicação completa", () => {
  const copy = JSON.parse(goodCopyJson());
  const quality = evaluateCopyQuality(copy, createBriefing(), 1);

  assert.equal(quality.passed, true);
  assert.equal(copy.hashtags.length >= 15, true);
  assert.match(copy.caption, /\p{Extended_Pictographic}/u);
  assert.ok((copy.caption.match(/\p{Extended_Pictographic}/gu) ?? []).length >= 2);
  assert.ok(copy.cta.length > 0);
  assert.equal(copy.publication, `${copy.caption}\n\n${copy.cta}\n\n${copy.hashtags.join(" ")}`);
  assert.equal(quality.issues.some((issue) => issue.code === "TOO_FEW_HASHTAGS"), false);
  assert.equal(quality.issues.some((issue) => issue.code === "TOO_FEW_EMOJIS"), false);
  assert.equal(quality.issues.some((issue) => issue.code === "MISSING_COMMENT_PROMPT"), false);
  assert.equal(quality.issues.some((issue) => issue.code === "MISSING_SAVE_SHARE_PROMPT"), false);
});

test("Maria reprova copy que não contém uma palavra obrigatória da marca", () => {
  const copy = JSON.parse(goodCopyJson());
  const briefing = createBriefing({ mandatoryWords: ["Presente Surpresa"] });
  const quality = evaluateCopyQuality(copy, briefing, 1);

  assert.equal(quality.passed, false);
  const issue = quality.issues.find((entry) => entry.code === "MISSING_MANDATORY_WORD");
  assert.ok(issue);
  assert.equal(issue.severity, "high");
  assert.ok(issue.message.includes("Presente Surpresa"));
});

test("Maria aprova copy quando toda palavra obrigatória da marca está presente", () => {
  const copy = JSON.parse(goodCopyJson());
  const briefing = createBriefing({ mandatoryWords: ["Rumo ao Altar"] });
  const quality = evaluateCopyQuality(copy, briefing, 1);

  assert.equal(quality.issues.some((entry) => entry.code === "MISSING_MANDATORY_WORD"), false);
});

test("Maria instrui o Ícaro a priorizar hashtags preferidas e incluir palavras obrigatórias no prompt", () => {
  const briefing = createBriefing({
    mandatoryWords: ["Rumo ao Altar"],
    preferredHashtags: ["#casamento", "#noivos"],
  });
  const strategy = createCopyStrategy(briefing);
  const prompt = buildMariaPrompt(briefing, strategy, [], 1);

  assert.ok(strategy.constraints.some((constraint) => constraint.includes("Incluir obrigatoriamente: Rumo ao Altar")));
  assert.ok(strategy.constraints.some((constraint) => constraint.includes("Priorizar estas hashtags da marca")));
  assert.ok(prompt.includes("PADRÃO DE QUALIDADE OBRIGATÓRIO"));
  assert.ok(prompt.includes("RESTRIÇÕES NEGATIVAS"));
  assert.ok(prompt.includes("mandatoryWords"));
  assert.ok(prompt.includes("preferredHashtags"));
});

test("Maria valida o briefing recebido antes de chamar o Ícaro", async () => {
  const provider = new FakeIcaroBrain([goodCopyJson()]);
  const logger = new InMemoryMariaLogger();
  const events = new InMemoryZunoEventRecorder();
  const maria = new MariaCopywritingSkill({
    icaro: provider,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  const response = await maria.execute(createRequest(createBriefing({ objective: "" })));

  assert.equal(response.status, "failed");
  assert.equal(response.error.code, "INVALID_BRIEFING");
  assert.equal(provider.calls.length, 0);
  assert.ok(logger.list().some((entry) => entry.action === "ValidationFailed"));
  assert.ok(events.list().some((event) => event.name === "CopyGenerationFailed"));
});

test("Maria registra os logs esperados em uma execução completa", async () => {
  const provider = new FakeIcaroBrain([goodCopyJson()]);
  const logger = new InMemoryMariaLogger();
  const maria = new MariaCopywritingSkill({
    icaro: provider,
    logger,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  await maria.execute(createRequest());

  const actions = logger.list().map((entry) => entry.action);
  assert.ok(actions.includes("BriefingReceived"));
  assert.ok(actions.includes("PromptBuilt"));
  assert.ok(actions.includes("CopyApproved"));
  assert.ok(actions.includes("CopyDelivered"));
});

test("Maria emite os eventos esperados em uma execução completa", async () => {
  const provider = new FakeIcaroBrain([goodCopyJson()]);
  const events = new InMemoryZunoEventRecorder();
  const maria = new MariaCopywritingSkill({
    icaro: provider,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  await maria.execute(createRequest());

  assert.deepEqual(events.list().map((event) => event.name), [
    "CopyGenerationStarted",
    "PromptBuilt",
    "AIGenerationStarted",
    "AIGenerationFinished",
    "CopyValidated",
    "CopyDelivered",
  ]);
});

test("Maria não chama outra Skill diretamente: todo import relativo aponta apenas para application/domain/shared ou para o próprio arquivo", async () => {
  const source = await readFile("src/skills/maria-copywriting/maria-copywriting.skill.ts", "utf8");
  const importSpecifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

  assert.ok(importSpecifiers.length > 0);
  for (const specifier of importSpecifiers) {
    const isSameFolder = specifier.startsWith("./");
    const isApplicationOrDomain = specifier.startsWith("../../application") || specifier.startsWith("../../domain") || specifier.startsWith("../../shared");
    assert.ok(isSameFolder || isApplicationOrDomain, `Import inesperado que pode apontar para outra Skill: ${specifier}`);
  }
});

test("Maria não importa providers concretos de IA e usa exclusivamente Ícaro", async () => {
  const source = await readFile("src/skills/maria-copywriting/maria-copywriting.skill.ts", "utf8");
  const lowered = source.toLowerCase();

  assert.ok(lowered.includes("icarobrainport"));
  assert.equal(lowered.includes("aitextproviderport"), false);
  assert.equal(lowered.includes("aiproviderport"), false);
  assert.equal(lowered.includes("from \"openai\""), false);
  assert.equal(lowered.includes("from 'openai'"), false);
  assert.equal(lowered.includes("from \"@google"), false);
  assert.equal(lowered.includes("from \"anthropic"), false);
});
