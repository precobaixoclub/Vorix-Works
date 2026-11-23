import test from "node:test";
import assert from "node:assert/strict";
import { buildEditorialGenerationBrief, parseManualEditorialIdea } from "../dist/domain/editorial/editorial-idea.model.js";
import {
  buildClientSceneBriefForImage,
  findDirectiveTextIssues,
  normalizeForTextMatch,
  parseCreativeDirective,
} from "../dist/shared/utils/creative-directive.js";
import { buildCreativePlanPrompt, buildImageGenerationPromptFromPlan, diagnoseCreativePlanInvalidity, parseCreativePlan } from "../dist/shared/utils/gpt-creative-plan.types.js";
import { buildCreativePlanRepairPrompt } from "../dist/application/creative-engine/creative-repair.js";

// Fase 2 (22/11/2026) — achados do teste real: o motor trocava a cena pedida por metáforas
// (constelação, espelho), descartava linhas do texto da arte e nunca mandava o prompt do cliente ao
// modelo de imagem. Fixture = a ideia real da Vorix usada no teste.
const VORIX_PROMPT = [
  "Crie uma peça publicitária premium para a Vorix Works.",
  "",
  "**CONCEITO CRIATIVO**",
  "",
  "Representar visualmente a diferença entre uma operação fragmentada e uma operação conectada.",
  "",
  "**DIREÇÃO DE ARTE**",
  "",
  "À esquerda, cinco módulos discretos e separados. À direita, um núcleo tecnológico integrado, com módulos conectados convergindo para o centro.",
  "",
  "**TIPOGRAFIA E COMPOSIÇÃO**",
  "",
  "Título grande, destacar “conexão entre elas” em roxo.",
  "",
  "**IDENTIDADE DA MARCA**",
  "",
  "Logo oficial da Vorix Works na parte inferior.",
  "",
  "**EVITAR**",
  "",
  "Não utilizar pessoas, robôs ou dashboards falsos.",
].join("\n");

function vorixIdea() {
  return parseManualEditorialIdea({
    title: "O problema não é a falta de ferramentas. É a falta de conexão entre elas.",
    format: "single_image",
    keyMessage: "O problema não é a falta de ferramentas.\n\nÉ a falta de conexão entre elas.\n\nConversações. CRM. Reuniões. Sites. Métricas.\n\nTudo conectado com a Vorix.",
    cta: "Conheça a Vorix",
    creativePrompt: VORIX_PROMPT,
  }, "IDEIA-004");
}

function context(ideaText) {
  return { brandName: "Vorix Works", objective: "Engajar", channel: "instagram", format: "4:5", ideaText, assets: [], confirmedFacts: [] };
}

function planJson(overrides = {}) {
  return JSON.stringify({
    objective: "o", angle: "a", targetAudience: "t", title: "t", description: "d",
    headline: "O problema não é a falta de ferramentas. É a falta de conexão entre elas.",
    subheadline: "Conversações. CRM. Reuniões. Sites. Métricas. Tudo conectado com a Vorix.",
    cta: "Conheça a Vorix",
    allowedRenderedTexts: ["O problema não é a falta de ferramentas. É a falta de conexão entre elas.", "Conversações. CRM. Reuniões. Sites. Métricas. Tudo conectado com a Vorix.", "Conheça a Vorix"],
    requiredRenderedFacts: [],
    visualDirection: "módulos fragmentados à esquerda, núcleo integrado à direita", compositionIntent: "contraste esquerda/direita",
    artDirection: { concept: "cinco módulos separados à esquerda contra um núcleo integrado à direita", visualFocus: "núcleo integrado à direita ocupando 40% do canvas", elementHierarchy: ["núcleo", "headline", "cta", "logo"], primaryMassPct: 40, contrastStrategy: "núcleo roxo #9333EA sobre fundo #0B0F19 quase preto", chromaticDirection: "grafite #0B0F19 com acentos roxos #9333EA", atmosphere: "silenciosa, organizada e precisa como um painel de controle", backgroundTreatment: "fundo grafite liso com vinheta sutil nas bordas", productTextRelationship: "headline no terço superior, cena abaixo", avoidedCliches: ["cards flutuantes"], justifiedCliches: [] },
    layoutPlan: [{ kind: "hero", rect: { xPct: 5, yPct: 35, widthPct: 90, heightPct: 50 }, priority: 1, rationale: "cena esquerda/direita" }, { kind: "headline", rect: { xPct: 8, yPct: 6, widthPct: 84, heightPct: 22 }, priority: 2, rationale: "título" }],
    assetUsage: {}, assetPlacements: [], textZones: [],
    requiredElements: ["headline", "cta"], forbiddenElements: [], visualDensity: "clean", styleNotes: "", rationale: "r",
    ...overrides,
  });
}

test("brief do Bolsão carrega a diretiva íntegra: texto da arte linha a linha, prompt com fim marcado e CTA", () => {
  const brief = buildEditorialGenerationBrief(vorixIdea());
  const directive = parseCreativeDirective(brief.ideaText);
  assert.deepEqual(directive.artTextLines, [
    "O problema não é a falta de ferramentas.",
    "É a falta de conexão entre elas.",
    "Conversações. CRM. Reuniões. Sites. Métricas.",
    "Tudo conectado com a Vorix.",
  ]);
  assert.equal(directive.clientPrompt, VORIX_PROMPT, "o prompt do cliente é preservado e registrado integralmente");
  assert.equal(directive.cta, "Conheça a Vorix");
  assert.equal(parseCreativeDirective("Pauta X — texto solto sem diretiva"), undefined);
});

test("validação do texto: cada linha precisa estar inteira no título ou subtítulo; CTA exato; caixa e pontuação toleradas", () => {
  const directive = parseCreativeDirective(buildEditorialGenerationBrief(vorixIdea()).ideaText);
  const ok = { headline: "O PROBLEMA NÃO É A FALTA DE FERRAMENTAS — é a falta de conexão entre elas", subheadline: "Conversações, CRM, Reuniões, Sites, Métricas. Tudo conectado com a Vorix!", cta: "Conheça a Vorix" };
  assert.deepEqual(findDirectiveTextIssues(ok, directive), []);
  const lost = findDirectiveTextIssues({ headline: "O problema não é a falta de ferramentas.", subheadline: "É a falta de conexão entre elas.", cta: "Saiba mais" }, directive);
  assert.deepEqual(lost.map((issue) => issue.kind), ["missing_art_text_line", "missing_art_text_line", "cta_mismatch"]);
  const reworded = findDirectiveTextIssues({ ...ok, subheadline: "Tudo integrado com a Vorix." }, directive);
  assert.ok(reworded.length > 0, "trocar palavra (conectado → integrado) conta como perda");
  assert.equal(normalizeForTextMatch("  Olá, MUNDO! "), "olá mundo");
});

test("plano que descarta linha do texto da arte é rejeitado e o diagnóstico diz exatamente o que corrigir", () => {
  const directive = parseCreativeDirective(buildEditorialGenerationBrief(vorixIdea()).ideaText);
  assert.ok(parseCreativePlan(planJson(), { creativeDirective: directive }), "plano fiel passa");
  const truncated = planJson({ subheadline: "", allowedRenderedTexts: ["O problema não é a falta de ferramentas. É a falta de conexão entre elas.", "Conheça a Vorix"] });
  assert.equal(parseCreativePlan(truncated, { creativeDirective: directive }), undefined);
  assert.match(diagnoseCreativePlanInvalidity(truncated, { creativeDirective: directive }), /Conversações\. CRM\. Reuniões\. Sites\. Métricas\./);
  assert.ok(parseCreativePlan(truncated), "sem diretiva, comportamento antigo inalterado");
});

test("prompt do diretor: restrições obrigatórias da cena, liberdade só no acabamento, e a marca configurada vence em cor/logo/tipografia", () => {
  const prompt = buildCreativePlanPrompt(context(buildEditorialGenerationBrief(vorixIdea()).ideaText));
  assert.match(prompt, /BRIEF DO CLIENTE — RESTRIÇÕES OBRIGATÓRIAS/);
  assert.match(prompt, /Nunca troque por metáfora/);
  assert.match(prompt, /módulos à esquerda e núcleo integrado à direita e o plano usa constelações/);
  assert.match(prompt, /Liberdade criativa SOMENTE em: iluminação/);
  assert.match(prompt, /PERFIL DA MARCA vence/);
  assert.match(prompt, /"Tudo conectado com a Vorix\."/);
  assert.match(prompt, /`cta` = exatamente "Conheça a Vorix"/);
  const repair = buildCreativePlanRepairPrompt(JSON.parse(planJson()), context(buildEditorialGenerationBrief(vorixIdea()).ideaText), ["texto cortado"]);
  assert.match(repair, /BRIEF DO CLIENTE — RESTRIÇÕES OBRIGATÓRIAS/, "o reparo continua preso ao brief");
});

test("prompt de imagem recebe a cena do cliente (sem seções de tipografia/marca); sem diretiva, nada muda", () => {
  const scene = buildClientSceneBriefForImage(VORIX_PROMPT);
  assert.match(scene, /À esquerda, cinco módulos discretos/);
  assert.match(scene, /EVITAR:/);
  assert.doesNotMatch(scene, /TIPOGRAFIA|conexão entre elas|Logo oficial/);
  const ctx = context(buildEditorialGenerationBrief(vorixIdea()).ideaText);
  const plan = parseCreativePlan(planJson());
  const editorial = buildImageGenerationPromptFromPlan(plan, ctx, { compositionMode: "editorial_experimental" });
  assert.match(editorial, /CLIENT SCENE BRIEF — MANDATORY/);
  assert.match(editorial, /À esquerda, cinco módulos discretos/);
  assert.match(editorial, /zero readable text/, "o contrato de zero texto do modelo de imagem continua");
  const standard = buildImageGenerationPromptFromPlan(plan, ctx);
  assert.match(standard, /CENA DESCRITA PELO CLIENTE — OBRIGATÓRIA/);
  const plain = buildImageGenerationPromptFromPlan(plan, context("Pauta antiga sem prompt próprio"), { compositionMode: "editorial_experimental" });
  assert.doesNotMatch(plain, /CLIENT SCENE BRIEF/);
});
