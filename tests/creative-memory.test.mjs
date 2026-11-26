import test from "node:test";
import assert from "node:assert/strict";
import { interpretRejection } from "../dist/application/creative-engine/feedback-interpretation.js";
import { applyProductMemory, buildCreativeMemory, feedbackEventsFromRows, memoryGuidance } from "../dist/application/creative-engine/creative-memory.js";
import { chooseComposition } from "../dist/application/creative-engine/creative-spec.js";
import { planEditorialCreative } from "../dist/application/creative-engine/plan-editorial-creative.js";

// Memória criativa por marca (27/11/2026): aprovações/reprovações do WhatsApp viram orientação para as
// próximas peças — só o que se repete em pautas diferentes, nunca um pedido pontual, sempre por marca.

const NOW = new Date("2026-11-27T12:00:00Z");
const ws = "workspace-a";
let seq = 0;
const reject = (reason, extra = {}) => ({ workspaceId: ws, publicationId: `pub-${++seq}`, ideaId: `idea-${seq}`, decision: "reject", reason, at: "2026-11-26T15:00:00Z", format: "carousel", archetypes: ["concept_scene", "typographic_statement", "concept_closeup"], productCodes: [], ...extra });
const approve = (extra = {}) => ({ workspaceId: ws, publicationId: `pub-${++seq}`, ideaId: `idea-${seq}`, decision: "approve", at: "2026-11-26T15:00:00Z", format: "single_image", archetypes: ["concept_metaphor"], productCodes: [], ...extra });

test("leitura do motivo: texto, imagem vazia, tela citada, legenda, produto, 'não quero postar', pontual e motivo vago", () => {
  const phrase = interpretRejection("a frase ficou estranha");
  assert.deepEqual(phrase.categories, ["texto"]);
  assert.deepEqual(phrase.changes, { text: true, caption: false, image: false, product: false, logo: false, audio: false });

  // Caso real (26/11/2026): "texto no canto" descreve o vazio — é queixa de imagem, não do texto. "5 imagens" é contagem.
  const empty = interpretRejection("das 5 imagens ainda ficou 3 vazias com um texto no canto", { screenCount: 5 });
  assert.ok(empty.categories.includes("imagem_vazia"));
  assert.equal(empty.changes.text, false);
  assert.equal(empty.changes.image, true);
  assert.equal(empty.screens, undefined);

  assert.deepEqual(interpretRejection("a última imagem ficou feia", { screenCount: 5 }).screens, [5]);
  assert.deepEqual(interpretRejection("imagem 2 e 4 estão escuras demais", { screenCount: 5 }).screens, [2, 4]);
  assert.deepEqual(interpretRejection("a capa e a terceira tela", { screenCount: 5 }).screens, [1, 3]);
  assert.deepEqual(interpretRejection("a legenda está longa demais").changes, { text: false, caption: true, image: false, product: false, logo: false, audio: false });
  const product = interpretRejection("estampa errada, não combina com academia");
  assert.ok(product.changes.product && product.changes.image && !product.changes.text);
  assert.deepEqual(interpretRejection("ja foi usada essa imagem").categories, ["repeticao"], "caso real da CMKV (26/11/2026)");
  assert.equal(interpretRejection("não quero postar isso").noRedo, true);
  assert.equal(interpretRejection("só desta vez deixa a frase mais curta").oneOff, true);
  const vague = interpretRejection("não gostei");
  assert.equal(vague.unclear, true);
  assert.deepEqual(vague.categories, []);
});

test("memória: um erro visto uma vez (ou na mesma pauta refeita) não vira regra; em duas pautas diferentes, vira", () => {
  const once = buildCreativeMemory([reject("a frase ficou estranha")], { workspaceId: ws, now: NOW });
  assert.equal(once.lessons.length, 0);
  assert.deepEqual(once.observed.map((item) => item.category), ["texto"]);

  // Mesma pauta reprovada duas vezes pelo mesmo motivo: preferência daquela peça.
  const sameIdea = buildCreativeMemory([reject("frase estranha", { ideaId: "idea-x" }), reject("a frase continua estranha", { ideaId: "idea-x" })], { workspaceId: ws, now: NOW });
  assert.equal(sameIdea.lessons.length, 0);

  const twice = buildCreativeMemory([reject("a frase ficou estranha"), reject("texto sem sentido em português")], { workspaceId: ws, now: NOW });
  assert.deepEqual(twice.lessons.map((lesson) => lesson.category), ["texto"]);
  assert.equal(twice.lessons[0].occurrences, 2);
  assert.match(twice.lessons[0].guidance, /frase ficou estranha/);
  assert.ok(memoryGuidance(twice, "redo").length === 1 && memoryGuidance(twice, "image").length === 0, "texto orienta a reescrita, não a geração de imagem");
});

test("memória: pontual, 'não quero postar', sem motivo, fora da janela ou de outra marca nunca ensinam", () => {
  const memory = buildCreativeMemory([
    reject("só hoje, troca a frase"), reject("hoje não, a frase ficou estranha"),
    reject("não quero postar isso"), reject("não quero publicar essa"),
    reject(undefined), reject(""),
    reject("a frase ficou estranha", { at: "2026-08-01T12:00:00Z" }), reject("texto ruim", { at: "2026-08-02T12:00:00Z" }),
    reject("a frase ficou estranha", { workspaceId: "workspace-b" }), reject("texto ruim", { workspaceId: "workspace-b" }),
  ], { workspaceId: ws, now: NOW });
  assert.equal(memory.lessons.length, 0);
  assert.equal(memory.sample.rejected, 0);
});

test("memória: linguagem reprovada em pautas diferentes perde pontos (só a da tela citada); aprovada ganha pouco; produto vai pro fim do rodízio", () => {
  const memory = buildCreativeMemory([
    reject("a segunda imagem ficou vazia"),
    reject("tela 2 sem imagem, só texto"),
    approve(), approve(), approve(),
    reject("estampa errada", { format: "single_image", archetypes: ["fashion_poster"], productCodes: ["000036"] }),
    reject("não é essa camisa", { format: "single_image", archetypes: ["fashion_poster"], productCodes: ["000036"] }),
  ], { workspaceId: ws, now: NOW });
  assert.ok(memory.archetypeBias.typographic_statement < 0, "a tela 2 era a tipográfica");
  assert.equal(memory.archetypeBias.concept_scene, undefined, "a capa não foi criticada");
  assert.ok(memory.archetypeBias.concept_metaphor > 0 && memory.archetypeBias.concept_metaphor <= 0.5);
  assert.deepEqual(memory.avoidProducts, ["000036"]);
  assert.deepEqual(applyProductMemory(["000036", "000040", "000041"], memory), ["000040", "000041", "000036"]);
  assert.ok(memoryGuidance(memory, "image").some((line) => /Toda tela precisa de uma imagem/.test(line)));
  assert.ok(memoryGuidance(memory, "video").some((line) => /Toda tela precisa de uma imagem/.test(line)));
});

test("memória → escolha da linguagem: a reprovada de forma recorrente perde a vez, sem ser proibida", () => {
  const base = { mode: "conceptual", idea: { title: "Seu site não precisa parecer um formulário", keyMessage: "Convite" }, references: { primary: undefined, variants: [], complementary: [], transmitted: [], excluded: [], missing: [] }, history: [], allowAi: true, seed: "idea-1" };
  const without = chooseComposition(base);
  const withMemory = chooseComposition({ ...base, bias: { [without.archetype.id]: -1.8 } });
  assert.notEqual(withMemory.archetype.id, without.archetype.id);
  assert.ok(withMemory.alternatives.includes(without.archetype.id), "continua disponível como alternativa");
  assert.ok(withMemory.reasons.some((reason) => /Memória da marca/.test(reason)));
});

test("memória → instrução da imagem: aprendizado entra no briefing; sem memória o plano é idêntico ao de antes", () => {
  const input = {
    workspaceId: ws, brandName: "Marca", businessKind: "services", idea: { id: "idea-9", title: "Convite", format: "single_image", keyMessage: "Seu convite começa aqui" },
    ideaReferences: [], history: [], allowAi: true,
  };
  const plain = planEditorialCreative(input);
  const same = planEditorialCreative({ ...input, memory: { archetypeBias: {}, guidance: [] } });
  assert.equal(same.screens[0].instruction, plain.screens[0].instruction);
  const learned = planEditorialCreative({ ...input, memory: { guidance: ["Toda tela precisa de uma imagem com assunto visível."] } });
  assert.match(learned.screens[0].instruction, /APRENDIZADO DA MARCA[\s\S]*Toda tela precisa de uma imagem/);
  assert.doesNotMatch(plain.screens[0].instruction, /APRENDIZADO/);
});

test("linhas do banco → eventos: decisão, motivo, linguagens, produtos e formato; linha sem decisão é descartada", () => {
  const events = feedbackEventsFromRows([
    { workspace_id: ws, publication_id: "p1", decision: "reject", reason: " frase estranha ", decided_at: new Date("2026-11-26T15:00:00Z"),
      payload: { editorialIdeaId: "i1", imageUrls: ["a", "b"], catalogProductCodes: ["000036"], creative: { archetypes: ["concept_scene", "concept_3d"] } } },
    { workspace_id: ws, publication_id: "p2", decision: null, decided_at: "2026-11-26T15:00:00Z", payload: {} },
  ]);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { workspaceId: ws, publicationId: "p1", decision: "reject", at: "2026-11-26T15:00:00.000Z", ideaId: "i1", reason: "frase estranha", format: "carousel", archetypes: ["concept_scene", "concept_3d"], productCodes: ["000036"] });
});
