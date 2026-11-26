import test from "node:test";
import assert from "node:assert/strict";
import { matchesRejectedPiece, redoScopeViolations, resolveRedoScope, scopedText } from "../dist/application/creative-engine/redo-scope.js";
import { COMPOSITION_ARCHETYPES } from "../dist/application/creative-engine/creative-spec.js";
import { videoRevisionPermissions, videoRevisionViolations } from "../dist/application/video-editing/video-revision-scope.js";
import { approvalRequestText } from "../dist/application/approvals/whatsapp-approval.js";
import { logoAdjustment, produceScreen } from "../scripts/editorial/creative-pipeline.mjs";
import { imagesAdPlan } from "./helpers/video-edit-fixtures.mjs";

// Refação direcionada (27/11/2026): o motivo da reprovação no WhatsApp decide exatamente o que muda; o resto
// da composição fica igual (sem gerar imagem nova para a tela que o cliente não criticou).

const ARCHETYPES = Object.fromEntries(COMPOSITION_ARCHETYPES.map((item) => [item.id, { operation: item.operation, mode: item.mode }]));

test("escopo: frase → só o texto; última imagem → só aquela tela; legenda → só a legenda; estampa → produto e imagem", () => {
  const phrase = resolveRedoScope({ reason: "a frase ficou estranha", screenCount: 1 });
  assert.deepEqual([phrase.text, phrase.image, phrase.caption, phrase.product], [[1], [], false, false]);
  assert.equal(phrase.changed, "texto");
  assert.equal(phrase.kept, "imagem, legenda");

  const last = resolveRedoScope({ reason: "a última imagem ficou vazia", screenCount: 5 });
  assert.deepEqual([last.text, last.image], [[], [5]]);
  assert.equal(last.changed, "imagem da tela 5");
  assert.equal(last.kept, "imagem da capa e das telas 2, 3 e 4, texto, legenda");

  const slideText = resolveRedoScope({ reason: "o texto da tela 3 ficou confuso", screenCount: 5 });
  assert.deepEqual([slideText.text, slideText.image], [[3], []]);

  const caption = resolveRedoScope({ reason: "a legenda está longa demais", screenCount: 3 });
  assert.deepEqual([caption.text, caption.image, caption.caption], [[], [], true]);

  const product = resolveRedoScope({ reason: "estampa errada, não combina com academia", screenCount: 1 });
  assert.deepEqual([product.product, product.image, product.text], [true, [1], []]);
  assert.equal(product.changed, "peça do catálogo e imagem");
});

test("escopo: o Codex precisa as telas quando o motivo não cita nenhuma, mas nunca amplia o que o cliente não criticou", () => {
  // Motivo de imagem sem tela citada: o Codex (que olhou a arte) aponta a tela 2.
  const pointed = resolveRedoScope({ reason: "a imagem ficou escura", screenCount: 4, codex: { imageScreens: [2], textScreens: [1, 2, 3, 4], changeText: true } });
  assert.deepEqual([pointed.image, pointed.text], [[2], []], "texto não foi criticado: o Codex não muda");
  // Motivo vago: o Codex decide (como antes), com precisão de tela.
  const vague = resolveRedoScope({ reason: "não gostei", screenCount: 3, codex: { changeText: false, imageScreens: [3], captionChanged: false } });
  assert.deepEqual([vague.text, vague.image, vague.caption], [[], [3], false]);
  // Sem leitura do Codex e motivo vago: tudo pode mudar (comportamento anterior).
  const blind = resolveRedoScope({ reason: "refaz", screenCount: 2 });
  assert.deepEqual([blind.text, blind.image], [[1, 2], [1, 2]]);
  assert.equal(resolveRedoScope({ reason: "não quero postar isso", screenCount: 1 }).noRedo, true);
});

test("texto da refação: só as telas do escopo recebem o texto novo; sem mudança real, nada é sobrescrito", () => {
  const original = { headline: "Capa", body: "", slides: [{ headline: "Capa", body: "" }, { headline: "Dois", body: "b2" }, { headline: "Três", body: "b3" }] };
  const rewritten = { headline: "Capa NOVA", body: "", slides: [{ headline: "Capa NOVA", body: "" }, { headline: "Dois NOVO", body: "x" }, { headline: "Três melhor", body: "b3" }] };
  const scoped = scopedText(original, rewritten, { text: [3], screenCount: 3 });
  assert.deepEqual(scoped.slides.map((slide) => slide.headline), ["Capa", "Dois", "Três melhor"]);
  assert.equal(scopedText(original, rewritten, { text: [], screenCount: 3 }), undefined);
  assert.equal(scopedText(original, { ...original }, { text: [1, 2, 3], screenCount: 3 }), undefined);
  assert.deepEqual(scopedText({ headline: "Peito ou costas?" }, { headline: "Estampa na frente ou nas costas?", body: "" }, { text: [1], screenCount: 1 }), { headline: "Estampa na frente ou nas costas?", body: "", slides: [] });
});

test("nenhuma peça reprovada volta: mesmas imagens + mesma legenda bloqueia; tela que devia mudar e não mudou também", () => {
  const rejected = [{ imageSha256: ["a", "b"], caption: "Legenda" }];
  assert.equal(matchesRejectedPiece({ imageSha256: ["a", "b"], caption: "Legenda " }, rejected), true);
  assert.equal(matchesRejectedPiece({ imageSha256: ["a", "b"], caption: "Legenda nova" }, rejected), false, "reprovação de legenda: mesma arte, legenda nova é outra peça");
  assert.equal(matchesRejectedPiece({ imageSha256: ["a", "c"], caption: "Legenda" }, rejected), false);
  assert.deepEqual(redoScopeViolations({ text: [2], image: [] }, ["a", "b"], ["a", "b"]), ["A tela 2 devia mudar e ficou igual à versão reprovada."]);
  assert.deepEqual(redoScopeViolations({ text: [2], image: [] }, ["a", "b"], ["a", "x"]), []);
});

const planned = () => ({
  spec: { mode: "conceptual", subject: "convite", requiredReferences: [], blockers: [], visualDirection: "cena romântica", composition: { archetype: "concept_scene", alternatives: ["concept_closeup"] } },
  screen: { headline: "Frase nova" }, transmitted: [], instruction: "cena romântica",
});
const approved = { image: "final", quality: {}, gate: { approved: true, failures: [], passes: [], imageSha256: "sha-final" }, fingerprint: { archetype: "concept_scene", textLayout: "top", productCount: 0, palette: [], dHash: "f".repeat(16) } };
const reuse = { archetype: "concept_scene", base: "BASE-APROVADA", layout: "top", logoPlacement: "bottom_right", protectedAreas: [{ kind: "person", x: 10, y: 50, width: 40, height: 40 }], sceneReview: { verdict: "approve" } };

test("tela não criticada: recompõe sobre a base aprovada, sem gerar imagem nem revisar a cena de novo", async () => {
  let generated = 0;
  let reviewed = 0;
  const bases = [];
  const result = await produceScreen({
    planned: planned(), brand: { name: "RAA", logos: [] }, assets: {}, history: [], archetypes: ARCHETYPES, reuse,
    generateAi: async () => { generated += 1; return { base: "NOVA" }; },
    reviewScene: async () => { reviewed += 1; return { verdict: "approve" }; },
    render: async (request) => { bases.push(request.base); return approved; },
  });
  assert.equal(result.ok, true);
  assert.equal(generated, 0);
  assert.equal(reviewed, 0);
  assert.ok(bases.every((base) => base === "BASE-APROVADA"));
  assert.equal(result.generation.reused, true);
  assert.deepEqual(result.generation.protectedAreas, reuse.protectedAreas);
});

test("base reaproveitada reprovada pedindo nova cena: aí sim gera de novo; arquétipo diferente nunca usa a base antiga", async () => {
  let generated = 0;
  let renders = 0;
  const result = await produceScreen({
    planned: planned(), brand: { name: "RAA", logos: [] }, assets: {}, history: [], archetypes: ARCHETYPES, reuse,
    generateAi: async () => { generated += 1; return { base: "NOVA", layout: "left", protectedAreas: [] }; },
    reviewScene: async () => ({ verdict: "approve" }),
    render: async () => { renders += 1; return renders === 1 ? { image: "x", quality: {}, gate: { approved: false, failures: [{ code: "VISUAL_DIRECTION_MISMATCH", message: "cena escura" }] }, revision: { action: "regenerate_scene_with_correction", correction: "mais luz" } } : approved; },
  });
  assert.equal(result.ok, true);
  assert.equal(generated, 1);
  assert.equal(result.generation.reused, false);
  const other = await produceScreen({
    planned: planned(), brand: { name: "RAA", logos: [] }, assets: {}, history: [], archetypes: ARCHETYPES, reuse: { ...reuse, archetype: "concept_closeup" },
    generateAi: async () => ({ base: "NOVA", layout: "top", protectedAreas: [] }), reviewScene: async () => ({ verdict: "approve" }), render: async () => approved,
  });
  assert.equal(other.generation.reused, false);
});

test("logo criticada: ajuste no renderizador, sem IA", () => {
  assert.deepEqual(logoAdjustment("a logo ficou muito grande", { scale: 1 }), { scale: 0.75 });
  assert.deepEqual(logoAdjustment("logo pequena demais"), { scale: 1.3 });
  assert.deepEqual(logoAdjustment("logo apagada, quase não aparece"), { treatment: "halo" });
  assert.deepEqual(logoAdjustment("tira essa caixa atrás da logo"), { treatment: "none" });
});

test("WhatsApp: a versão refeita diz o que mudou e o que ficou igual", () => {
  const text = approvalRequestText({ brand: "Rumo ao Altar", code: "AB12", networks: ["instagram", "facebook"], screens: 5,
    redo: { attempt: 1, max: 2, reason: "a última imagem ficou vazia", changes: "Mudou: imagem da tela 5. Mantive: imagem da capa e das telas 2, 3 e 4, texto, legenda." } });
  assert.match(text, /🔁 Versão refeita \(ajuste 1 de 2\)[^\n]*\nMudou: imagem da tela 5\. Mantive: /);
});

test("vídeo: o motivo vira permissão por cena — o que não foi criticado no plano de edição fica idêntico", () => {
  const original = imagesAdPlan();
  const lastScene = videoRevisionPermissions(original, "a última cena ficou escura");
  assert.deepEqual([lastScene.visualClipIds, lastScene.textClipIds, lastScene.logo, lastScene.audio], [["c4"], [], false, false]);
  const ok = structuredClone(original);
  ok.clips[3].assetId = "p3";
  ok.clips[3].motion = { type: "push_in", intensity: 0.4 };
  assert.deepEqual(videoRevisionViolations(original, ok, lastScene), []);
  const bad = structuredClone(ok);
  bad.clips[0].overlays[0].text = "Outra chamada";
  bad.music.gainDb = -6;
  assert.deepEqual(videoRevisionViolations(original, bad, lastScene), ["O texto da cena 1 mudou sem ter sido criticado.", "O áudio (música/narração) mudou sem ter sido criticado."]);
  const music = videoRevisionPermissions(original, "a música ficou alta demais");
  assert.equal(music.audio, true);
  assert.deepEqual(music.visualClipIds, []);
  assert.deepEqual(videoRevisionViolations(original, { ...structuredClone(original), music: { ...original.music, gainDb: -20 } }, music), []);
  const format = structuredClone(original);
  format.aspect = "1:1";
  assert.ok(videoRevisionViolations(original, format, videoRevisionPermissions(original, "refaz tudo")).some((item) => /formato/.test(item)));
});
