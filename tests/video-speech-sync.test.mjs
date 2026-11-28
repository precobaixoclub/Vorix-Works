// Narração natural e sincronia real: direção de locução (intenção, bloco × frase), alinhamento roteiro × áudio
// real, sincronia das legendas medida no áudio, tempo guiado pela fala, conceitos distintos, novidade em relação
// à versão atual e memória da avaliação humana (uma pauta = observado, não regra).
import test from "node:test";
import assert from "node:assert/strict";
import { CAMPAIGN_SPEECH, directedSegments, speechBlocks } from "../dist/application/video-editing/speech-script.js";
import { alignScriptToAsr, captionSync, normWord, wordSimilarity } from "../dist/application/video-editing/word-alignment.js";
import { buildSpeechTimeline } from "../dist/application/video-editing/speech-timeline.js";
import { proposalDistance, scoreProposal } from "../dist/application/video-editing/spot-storyboard.js";
import { buildCreativeMemory } from "../dist/application/creative-engine/creative-memory.js";
import { tasteFromMemory, videoFeedbackEvents } from "../dist/domain/video-editing/brand-video-taste.js";

const LINES = [
  { scene: 0, text: "Que traço é esse?", intent: "curiosidade" },
  { scene: 1, text: "Viu a borboleta...", intent: "curiosidade" },
  { scene: 2, text: "Qual é seu palpite", intent: "chamada" },
  { scene: 4, text: "A resposta é A", intent: "surpresa" },
  { scene: 6, text: "Conta se você foi de A ou de B.", intent: "chamada" },
];

test("locução: blocos contínuos, intenção vira pontuação/velocidade, sem reticências nem ênfase picotada", () => {
  const blocks = speechBlocks(LINES);
  assert.deepEqual(blocks.map((b) => b.lines.map((l) => l.scene)), [[0, 1], [2], [4], [6]], "cenas seguidas formam bloco; chamada abre bloco próprio");
  const bloco = directedSegments(LINES, "moda", "bloco");
  const frase = directedSegments(LINES, "moda", "frase");
  assert.equal(bloco.length, 4);
  assert.equal(frase.length, 5);
  assert.equal(bloco[0].text, "Que traço é esse? Viu a borboleta?", "reticências viram entonação de pergunta, não pausa");
  assert.equal(bloco[2].text, "á resposta é á!", "surpresa termina em exclamação; letras soltas pronunciadas");
  assert.ok(bloco.every((s) => s.speed >= CAMPAIGN_SPEECH.moda.speed * 0.98), "publicidade: nada abaixo do ritmo-base");
  assert.ok(bloco.every((s) => !/\.\.\.|…/.test(s.text)));
  assert.equal(bloco[0].sentencePause, CAMPAIGN_SPEECH.moda.sentencePause, "respiro entre frases é o do perfil, não o do motor");
  assert.ok(CAMPAIGN_SPEECH.ofertas.speed > CAMPAIGN_SPEECH.casamento.speed && CAMPAIGN_SPEECH.casamento.sentencePause > CAMPAIGN_SPEECH.ofertas.sentencePause, "gêneros diferentes, ritmos diferentes");
});

test("alinhamento: palavras do roteiro recebem o tempo do ÁUDIO REAL; números em dígitos casam; sem par = interpolado", () => {
  assert.equal(normWord("Três"), normWord("3"));
  assert.equal(normWord("000037"), normWord("37"));
  assert.ok(wordSimilarity("borboleta", "burboleta") > 0.8);
  const heard = [{ word: "Que", start: 0.1, end: 0.25 }, { word: "traço", start: 0.25, end: 0.6 }, { word: "esse?", start: 0.75, end: 1 }, { word: "3,", start: 1.4, end: 1.6 }, { word: "2,", start: 1.7, end: 1.9 }, { word: "1.", start: 2.0, end: 2.2 }];
  const { words, coverage } = alignScriptToAsr(["Que", "traço", "é", "esse?", "Três,", "dois,", "um."], heard);
  assert.deepEqual(words.map((w) => w.source), ["asr", "asr", "interpolated", "asr", "asr", "asr", "asr"]);
  assert.ok(words[2].start >= 0.6 && words[2].end <= 0.75, "palavra não ouvida fica entre as vizinhas medidas");
  assert.equal(words[4].start, 1.4);
  assert.ok(coverage > 0.8);
});

test("sincronia das legendas é medida contra o que se OUVE (não contra o roteiro)", () => {
  const heard = [{ word: "Que", start: 0.1, end: 0.25 }, { word: "traço", start: 0.25, end: 0.6 }, { word: "esse", start: 0.75, end: 1 }];
  assert.equal(captionSync([{ word: "Que", at: 0.12 }, { word: "traço", at: 0.27 }, { word: "esse", at: 0.78 }], heard).status, "ok");
  const atrasada = captionSync([{ word: "Que", at: 0.5 }, { word: "traço", at: 0.7 }, { word: "esse", at: 1.2 }], heard);
  assert.equal(atrasada.status, "falha");
  assert.ok(atrasada.late >= 2 && atrasada.meanOffsetMs > 120);
  assert.equal(captionSync([{ word: "Olha", at: 0.1 }, { word: "perto", at: 0.4 }], heard).status, "falha", "texto da tela que a voz NÃO diz não é sincronia");
});

test("tempo guiado pela fala: corte na pausa real, cena muda mantém batidas, revelação depois do impacto, fechamento lê", () => {
  const tl = buildSpeechTimeline({ bpm: 120, scenes: [
    { beats: 4, role: "hook", words: [{ start: 0.05, end: 0.5 }, { start: 0.55, end: 1.0 }] },
    { beats: 4, role: "clue", words: [{ start: 1.3, end: 1.7 }] },
    { beats: 4, role: "tension", words: [] },
    { beats: 4, role: "reveal", words: [{ start: 0.05, end: 0.8 }] },
    { beats: 6, role: "cta", words: [{ start: 0.05, end: 1.5 }] },
  ], sceneBlock: [0, 0, undefined, 1, 2] });
  const [, c1, c2, c3, c4] = tl.cuts;
  const off0 = tl.blockOffsets[0];
  assert.ok(c1 > 1.0 + off0 && c1 < 1.3 + off0, "corte do gancho dentro da pausa entre as falas");
  assert.ok(Math.abs(c3 - c2 - 2) < 1e-6, "cena silenciosa: 4 batidas a 120 BPM = 2 s");
  assert.ok(tl.blockOffsets[1] + 0.05 >= c3 + 0.3, "a fala da revelação entra depois do impacto");
  assert.ok(tl.end - (tl.blockOffsets[2] + 1.5) >= 1.29, "fechamento segura a leitura da chamada");
  assert.ok(c4 > c3);
});

const sc = (kind, extra = {}) => ({ kind, purpose: kind, beats: 4, materials: ["M1"], camera: { from: "detail", to: "detail" }, texts: [], placement: "top", transition: "cut", field: "dark", focus: false, storyboardNote: "", ...extra });
const prop = (id, kinds, concept, extra = {}) => ({ id, title: id, concept, conceptDevice: concept, script: ["a"], language: "editorial", emphasis: "color", align: "left", artDirection: "", animationLanguage: "", audioTreatment: { mood: "elegant", bpm: 108, notes: "" }, fromStructureReference: "", fromAestheticReference: "", materialsNeeded: [], technicalResources: [], limitations: [], scenes: kinds.map((k) => sc(k)), ...extra });

test("distinção compara CONCEITOS (e não só efeitos); novidade em relação à versão atual entra na seleção", () => {
  const base = prop("B", ["hook_type", "macro", "bands", "countdown", "fullbleed", "fullbleed", "logo_resolve"], "quiz com pista e revelação da estampa na camiseta");
  const reskin = prop("X", ["hook_type", "macro", "bands", "countdown", "fullbleed", "fullbleed", "logo_resolve"], "quiz com pista e revelação da estampa na camiseta preta", { language: "graphic", emphasis: "block", align: "center", audioTreatment: { mood: "pop", bpm: 120, notes: "" } });
  const fresh = prop("Y", ["type_mask", "fullbleed", "bands", "type_card", "type_mask", "variant_cycle", "logo_resolve"], "visor tipográfico: a palavra esconde a pista e a letra abre a foto", { language: "graphic" });
  const d1 = proposalDistance(base, reskin);
  assert.equal(d1.distinct, false, "mudar cor/fonte/andamento no mesmo conceito e sequência NÃO é outra proposta");
  assert.ok(d1.conceptSimilarity >= 0.3);
  assert.equal(proposalDistance(base, fresh).distinct, true);
  const ctx = { fps: 30, hasCutout: true, palette: {}, materials: [{ id: "M1", kind: "product_photo" }, { id: "LOGO", kind: "logo" }] };
  const novelty = (p) => scoreProposal(p, ctx, {}, undefined, base).criteria.find((c) => c.key === "novelty");
  assert.ok(novelty(fresh).score > novelty(reskin).score);
  assert.equal(scoreProposal(fresh, ctx, {}, undefined, base).criteria.reduce((a, c) => a + c.weight, 0).toFixed(2), "1.00");
});

test("memória: a avaliação da CMKV fica OBSERVADA (uma pauta ≠ regra) e não reprova o motor de voz", () => {
  const now = new Date("2026-11-28T00:00:00Z");
  const fb = (verdict, patterns, k) => ({ id: `f${k}`, tenantId: "t", workspaceId: "cmkv", projectId: "CMKV-QUIZ-RECORTE", versionId: "v", verdict, patterns, note: "", reviewerId: "u", createdAt: new Date(now.getTime() - 1000 + k).toISOString() });
  const items = [fb("approved", ["timbre_aceitavel"], 0), fb("rejected", ["narracao_lenta", "pausas_inadequadas"], 1), fb("rejected", ["legenda_dessincronizada"], 2), fb("approved", ["montagem_melhorou"], 3), fb("rejected", ["impacto_insuficiente"], 4)];
  const taste = tasteFromMemory(buildCreativeMemory(videoFeedbackEvents(items), { workspaceId: "cmkv", now }));
  assert.deepEqual(taste.rejected, [], "nada vira proibição com uma pauta só");
  assert.deepEqual(taste.observed.sort(), ["impacto_insuficiente", "legenda_dessincronizada", "narracao_lenta", "pausas_inadequadas"]);
  assert.ok(!taste.observed.some((p) => /kokoro|piper|voz_ruim/.test(p)), "nenhuma reprovação do motor de voz");
  assert.deepEqual(tasteFromMemory(buildCreativeMemory(videoFeedbackEvents(items), { workspaceId: "outra-marca", now })).observed, [], "isolada por marca");
});

test("refino pelo áudio: a 1ª palavra depois de pausa (marcada tarde pelo Whisper) volta ao início real", async () => {
  const { refineWordOnsets, captionSync: sync } = await import("../dist/application/video-editing/word-alignment.js");
  const rate = 1000, x = new Float32Array(2000);
  for (let i = 300; i < 600; i += 1) x[i] = 0.3 * Math.sin(i);
  for (let i = 620; i < 700; i += 1) x[i] = 0.3 * Math.sin(i);
  for (let i = 900; i < 1400; i += 1) x[i] = 0.3 * Math.sin(i);
  const out = refineWordOnsets([{ word: "a", start: 0.45, end: 0.6 }, { word: "b", start: 0.63, end: 0.7 }, { word: "c", start: 1.2, end: 1.4 }], x, rate);
  assert.equal(out[0].start, 0.3);
  assert.equal(out[1].start, 0.63, "palavra colada à anterior não é mexida");
  assert.equal(out[2].start, 0.9);
  // Whisper estende o início para trás ATRAVÉS de uma pausa longa (colado à palavra anterior): vai ao início real.
  const y = new Float32Array(3000);
  for (let i = 200; i < 800; i += 1) y[i] = 0.3 * Math.sin(i);
  for (let i = 1650; i < 2100; i += 1) y[i] = 0.3 * Math.sin(i);
  const back = refineWordOnsets([{ word: "um", start: 0.5, end: 0.8 }, { word: "resposta", start: 0.82, end: 1.95 }], y, rate);
  assert.ok(Math.abs(back[1].start - 1.65) < 0.02, `início no silêncio corrigido (${back[1].start})`);
  // Mesma palavra dita muito depois não é "atraso": a sincronia procura perto do instante mostrado.
  const r = sync([{ word: "A", at: 6.45 }], [{ word: "A", start: 6.41, end: 6.5 }, { word: "A", start: 12.45, end: 12.5 }]);
  assert.equal(r.maxOffsetMs, 40);
});
