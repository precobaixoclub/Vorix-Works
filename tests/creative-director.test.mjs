// Diretor Criativo Autônomo: classificação do briefing, inventário, seleção entre conceitos internos, ligação
// com imagem (arquétipos), vídeo (direção na MESMA chamada do plano, componentes conceituais) e Quality Gate.
// Respostas do Codex SIMULADAS (fixtures): estes testes provam a lógica, não a qualidade artística.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ADVERTISING_LANGUAGES, briefFromIdea, classifyBriefing, conceptScore, creativeDirectionSchema, directionImageLines, directionRecord, directionVideoLines,
  materialInventory, preferredArchetypes, recentConceptsFrom, selectCreativeDirection,
} from "../dist/application/creative-engine/creative-director.js";
import { buildPlanFromDraft } from "../dist/application/video-editing/build-plan-from-draft.js";
import { validateVideoEditDraftStructure } from "../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { CONCEPT_CHECK, DESIGN_TEMPLATES, categoryReviewOutcome, categoryReviewPrompt, directorPrompt, directorSchema, directorSchemaWith, dropInventedFigures, reviewSchemaFor } from "../scripts/editorial/video-director.mjs";

const concept = (id, extra = {}) => ({ id, name: `Conceito ${id}`, language: "Metáfora visual", idea: `ideia ${id}`, hook: "gancho", story: "história", reveal: "revelação", closing: "fecho", visualDevice: "objeto", resources: [], usesRealisticFootage: false, impact: 4, originality: 4, feasibility: 4, brandFit: 4, ...extra });
const raw = (concepts, chosen = "A") => ({ intent: "i", objective: "o", emotion: "curiosidade", audienceInsight: "a", requiredCovered: [], concepts, chosen, rationale: "r" });
const CONCEPTUAL = ["concept_scene", "concept_closeup", "concept_metaphor", "concept_3d", "typographic_statement"];

test("A · imagem: ideia simples de economia vira conceito escolhido pela IA, com encenação nos arquétipos permitidos", () => {
  const brief = briefFromIdea({
    medium: "image", brand: { name: "Preço Baixo Club", tone: "direto" }, idea: { title: "Comprar sem comparar preços pode custar caro", cta: "Compare antes" },
    instructions: [], inventory: materialInventory({ medium: "image", logo: true }),
  });
  assert.ok(brief.briefing.free.includes("linguagem publicitária"), "sem instrução, a linguagem é decisão da IA");
  assert.equal(brief.briefing.required.length, 0);
  for (const needle of ["Conceba 3 conceitos REALMENTE DIFERENTES", "Metáfora visual", "Humor absurdo proposital", "Nunca invente preço", "gancho visual"]) assert.ok(brief.prompt.includes(needle), needle);
  const d = selectCreativeDirection(raw([
    concept("A", { name: "Dinheiro que evapora entre etiquetas", language: "Metáfora visual", visualDevice: "notas de dinheiro sumindo entre etiquetas de preço (still life)", impact: 5, originality: 5 }),
    concept("B", { name: "Família no caixa", language: "Storytelling", impact: 3, originality: 2 }),
    concept("C", { name: "Etiqueta gigante", language: "Humor absurdo", impact: 4, originality: 3 }),
  ]), { inventory: { footage: false } });
  assert.equal(d.decision, "codex");
  assert.equal(d.concept.name, "Dinheiro que evapora entre etiquetas");
  assert.deepEqual(preferredArchetypes(d, CONCEPTUAL).slice(0, 1), ["concept_metaphor"]);
  assert.ok(directionImageLines(d).join(" ").includes("CONCEITO CRIATIVO ESCOLHIDO"));
  assert.equal(directionRecord(d).alternatives.length, 2, "alternativas internas registradas, não renderizadas");
});

test("B · vídeo de produtividade: o relógio é oferecido como recurso sem o cliente pedir; direção vem na mesma chamada do plano", () => {
  const brief = briefFromIdea({ medium: "video", brand: { name: "Vorix" }, idea: { title: "Nosso sistema economiza tempo" }, instructions: [], inventory: materialInventory({ medium: "video", logo: true }) });
  assert.ok(!/rel[oó]gio/i.test("Nosso sistema economiza tempo"));
  assert.ok(brief.prompt.includes("relógio/cronômetro animado"), "o repertório oferece o relógio");
  assert.ok(brief.prompt.includes("2 primeiros segundos"), "perguntas de vídeo (gancho)");
  const selection = { brand: "Vorix", idea: { title: "Nosso sistema economiza tempo" }, creativeBrief: { prompt: brief.prompt, schema: brief.schema } };
  const prompt = directorPrompt({ selection, materials: [] });
  assert.ok(prompt.includes("PRIMEIRO preencha direction") && prompt.includes("- clock (relógio/cronômetro)"));
  const schema = directorSchemaWith(creativeDirectionSchema);
  assert.equal(schema.required[0], "direction");
  assert.deepEqual(directorSchemaWith(undefined), directorSchema, "sem brief, o plano é o de antes");
  assert.ok(DESIGN_TEMPLATES.includes("clock") && DESIGN_TEMPLATES.includes("mask_reveal"));
  const d = selectCreativeDirection(raw([concept("A", { name: "O dia que escorre", language: "Suspense / motion conceitual", visualDevice: "relógio que acelera e para de repente" }), concept("B"), concept("C")]), { inventory: { footage: false } });
  assert.ok(directionVideoLines(d).join(" ").includes("relógio que acelera"));
});

test("B · motor: relógio, número, comparação e revelação viram cenas do Remotion; número inventado é derrubado", () => {
  const brand = { name: "Vorix", primaryHex: "#1B1035", accentHex: "#B990FC", lightHex: "#FFFFFF", darkHex: "#111111" };
  const art = { id: "M1", fileName: "m1.png", kind: "image", role: "generated", width: 1024, height: 1536 };
  const scene = (materialId, purpose, extra = {}) => ({ materialId, purpose, durationSeconds: 3, motion: "static", motionIntensity: "medium", focus: "center", transitionIn: "cut", texts: [], ...extra });
  const d = { schemaVersion: 1, strategy: "s", rationale: "", captions: false, music: "none", logo: "none", warnings: [], scenes: [
    scene("CARD", "hook", { design: { template: "clock", lines: ["Seu dia acabou?"], label: "parou" } }),
    scene("CARD", "benefit", { design: { template: "counter", label: "3", lines: ["filtros que decidem"] } }),
    scene("CARD", "proof", { design: { template: "versus", lines: ["Planilha", "Vorix"], kicker: "Antes e depois" } }),
    scene("M1", "context", { design: { template: "mask_reveal", headline: "O tempo volta", kicker: "Vorix" } }),
    scene("CARD", "cta", { design: { template: "counter", label: "sem número" } }),
  ] };
  assert.equal(validateVideoEditDraftStructure(d).valid, true);
  const built = buildPlanFromDraft(d, { planId: "p", workspaceId: "ws", aspect: "9:16", request: "pauta", style: { editing: "dinamico", transitions: "moderadas", captions: false, music: false }, materials: [art], transcripts: {}, sentences: [], brand });
  assert.equal(built.ok, true, built.issues?.join("; "));
  const [clock, counter, versus, reveal, noFigure] = built.plan.clips;
  assert.deepEqual(clock.design.props.lines, ["Seu dia acabou?"]);
  assert.equal(counter.design.props.value, "3");
  assert.equal(versus.design.props.left, "Planilha");
  assert.equal(reveal.design.props.photo, "m1.png");
  assert.equal(noFigure.design, undefined, "counter sem número: cena segue sem animação");
  const guarded = dropInventedFigures({ scenes: [{ design: { template: "counter", label: "87%" } }, { design: { template: "counter", label: "3" } }] }, "A escolha certa tem 3 filtros");
  assert.equal(guarded.draft.scenes[0].design, undefined, "87% não está na pauta");
  assert.equal(guarded.draft.scenes[1].design.label, "3");
  assert.equal(guarded.warnings.length, 1);
});

test("C · camisetas: conceito que pede filmagem inexistente é descartado; com gravação real ele vale", () => {
  const inv = materialInventory({ medium: "video", productPhotos: 3, logo: true });
  assert.ok(inv.unavailable.some((item) => item.includes("filmagem real")));
  assert.ok(inv.have[0].includes("3 foto(s) oficial(is)"));
  const options = [
    concept("A", { name: "Máquina de costura", language: "Documental", usesRealisticFootage: true, impact: 5, originality: 5 }),
    concept("B", { name: "Do macro da estampa à peça", language: "Revelação", impact: 4, originality: 4 }),
    concept("C", { name: "Etiqueta de qualidade", language: "Minimalista", impact: 3, originality: 3 }),
  ];
  const noFootage = selectCreativeDirection(raw(options, "A"), { inventory: { footage: false } });
  assert.equal(noFootage.decision, "override");
  assert.equal(noFootage.concept.name, "Do macro da estampa à peça");
  assert.match(noFootage.warnings[0], /filmagem real que não existe/);
  const withFootage = selectCreativeDirection(raw(options, "A"), { inventory: { footage: true } });
  assert.equal(withFootage.decision, "codex");
});

test("D · humor sobre comparação de preços: conceito quase igual a um recente da marca não se repete", () => {
  const recent = recentConceptsFrom([{ direction: { name: "Carrinho que pesa no bolso", idea: "carrinho de compras pesado arrastando o bolso" } }, null, { direction: {} }]);
  assert.equal(recent.length, 1);
  const d = selectCreativeDirection(raw([
    concept("A", { name: "Carrinho que pesa no bolso", language: "Humor absurdo", idea: "carrinho de compras pesado arrastando o bolso", impact: 5, originality: 5 }),
    concept("B", { name: "Detetive de etiquetas", language: "Humor e situação inesperada", idea: "um detetive investiga etiquetas suspeitas no mercado", impact: 4, originality: 5 }),
    concept("C", { name: "Comparativo seco", language: "Comparação", impact: 3, originality: 2 }),
  ]), { inventory: { footage: false }, recentConcepts: recent });
  assert.equal(d.concept.name, "Detetive de etiquetas");
  assert.match(d.alternatives.find((item) => item.id === "A").rejected, /quase igual/);
});

test("E · briefing detalhado: obrigatório, preferências e linguagem pedida são respeitados; o resto fica livre", () => {
  const b = classifyBriefing({ intent: "Quero divulgar minhas camisetas", instructions: ["Destacar as estampas, usar suspense e fazer uma revelação impactante. Nunca mostrar preço.", "Talvez usar fundo escuro."] });
  assert.ok(b.required.some((item) => /Nunca mostrar preço/.test(item)));
  assert.ok(b.preferences.some((item) => /Destacar as estampas/.test(item)));
  assert.ok(b.suggestions.some((item) => /Talvez/.test(item)));
  assert.ok(b.requestedLanguages.includes("suspense") && b.requestedLanguages.includes("revelacao"));
  assert.ok(!b.free.includes("linguagem publicitária") && b.free.includes("trilha e efeitos sonoros"), "decide o que não foi dito");
  const d = selectCreativeDirection(raw([
    concept("A", { name: "Catálogo alegre", language: "Humor", impact: 5, originality: 5 }),
    concept("B", { name: "Sombra que revela a estampa", language: "Suspense e revelação", impact: 4, originality: 4 }),
    concept("C", { name: "Lado a lado", language: "Comparação", impact: 3, originality: 3 }),
  ], "A"), { inventory: { footage: false }, requestedLanguages: b.requestedLanguages });
  assert.equal(d.concept.name, "Sombra que revela a estampa");
  assert.match(d.alternatives.find((item) => item.id === "A").rejected, /linguagem pedida/);
  const brief = briefFromIdea({ medium: "video", brand: { name: "CMKV" }, idea: { title: "Camisetas" }, instructions: ["Nunca mostrar preço. Usar suspense."], inventory: materialInventory({ medium: "video", productPhotos: 2 }) });
  assert.ok(brief.prompt.includes("OBRIGATÓRIO (cumpra à risca):") && brief.prompt.includes("Linguagem pedida pelo cliente: Suspense cinematográfico"));
});

test("F · Quality Gate: o conceito precisa ser entregue (bloqueia), originalidade é registro; sem direção nada muda", () => {
  const base = { hookInFirstSeconds: true, textReadable: true, brandConsistent: true, materialFaithful: true, notSlideshow: true, motionVaried: true, compositionVaried: true, subjectClear: true, narrativeProgression: true, closingAction: true, findings: [], verdict: "approve", revisionRequest: "", revisionScope: "pontual", adGrade: true, commercialScore: 8 };
  const schema = reviewSchemaFor("generic", { concept: true });
  assert.ok(schema.required.includes(CONCEPT_CHECK) && schema.required.includes("originalityScore"));
  assert.ok(!reviewSchemaFor("generic").required.includes(CONCEPT_CHECK), "sem direção, schema igual ao anterior");
  const missed = categoryReviewOutcome({ ...base, [CONCEPT_CHECK]: false, originalityScore: 9 }, { category: "generic", concept: true });
  assert.equal(missed.verdict, "revise");
  assert.ok(missed.findings.some((item) => item.includes(CONCEPT_CHECK)));
  const ok = categoryReviewOutcome({ ...base, [CONCEPT_CHECK]: true, originalityScore: 3 }, { category: "generic", concept: true });
  assert.equal(ok.verdict, base.verdict === "approve" && ok.commercialScore >= ok.minScore ? "approve" : ok.verdict);
  assert.equal(ok.originalityScore, 3, "originalidade baixa é registrada, não reprova sozinha");
  const prompt = categoryReviewPrompt({ selection: { brand: "B", idea: { title: "t" } }, plan: { strategy: "s", durationSeconds: 15, clips: [] }, gate: { status: "pass" }, category: "generic", direction: ["CONCEITO ESCOLHIDO: x"] });
  assert.ok(prompt.includes("CONCEITO CRIATIVO que a peça deveria executar"));
});

test("seleção: sem conceitos válidos usa o de maior nota com aviso; resposta vazia não produz direção", () => {
  assert.equal(selectCreativeDirection(undefined, { inventory: { footage: false } }), undefined);
  assert.equal(selectCreativeDirection({ concepts: [] }, { inventory: { footage: false } }), undefined);
  const d = selectCreativeDirection(raw([concept("A", { feasibility: 2, impact: 5 }), concept("B", { feasibility: 1 }), concept("C", { usesRealisticFootage: true })]), { inventory: { footage: false } });
  assert.equal(d.decision, "fallback");
  assert.match(d.warnings[0], /nenhum conceito passou/);
  assert.equal(conceptScore({ impact: 5, originality: 5, feasibility: 5, brandFit: 5 }), 5);
  assert.ok(ADVERTISING_LANGUAGES.length >= 17);
});
