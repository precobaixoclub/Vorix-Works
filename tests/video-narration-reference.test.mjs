import { test } from "node:test";
import assert from "node:assert/strict";

const W = (text, start, gap = 0.06, perWord = 0.3) => text.split(" ").map((word, i) => ({ word, start: +(start + i * (perWord + gap)).toFixed(2), end: +(start + i * (perWord + gap) + perWord).toFixed(2) }));

test("narração medida: falas, velocidade, cobertura, respiros, estilo e voz × trilha", async () => {
  const { narrationProfile, segmentPhrases } = await import("../dist/application/video-editing/narration-profile.js");
  const words = [...W("Você ainda perde tempo pesquisando?", 0), ...W("E sabe o melhor?", 2.2), ...W("Com a gente você economiza.", 4.0)];
  const phrases = segmentPhrases(words);
  assert.equal(phrases.length, 3);
  const p = narrationProfile(words, 6.5, { speechDb: [-16, -17, -16], bedDb: [-28, -29] });
  assert.equal(p.wordsPerPhrase, 5);
  assert.ok(p.coverage > 0.7 && p.coverage < 0.85, `cobertura ${p.coverage}`);
  assert.equal(p.firstWordAt, 0);
  assert.ok(Math.abs(p.voiceOverMusicDb - 12.5) < 0.6);
  assert.ok(p.questionShare > 0.6, "2 de 3 falas são pergunta");
  assert.ok(p.connectorShare > 0.6, "E…, Com…");
  assert.ok(p.secondPersonShare > 0.6, "você");
});

test("comparação com a referência: legenda lida (falas de 2–3 palavras, voz rala, código soletrado) é apontada com número", async () => {
  const { narrationProfile, narrationTarget, compareNarration, narrationGuidance, spokenCodes } = await import("../dist/application/video-editing/narration-profile.js");
  const ref = narrationProfile([...W("Você ainda perde tempo pesquisando o mesmo produto?", 0), ...W("Cada site mostra uma oferta diferente.", 3.0), ...W("Com o clube você pesquisa uma vez só.", 5.6), ...W("Pesquise, compare e economize.", 8.6)], 10.5, { speechDb: [-16], bedDb: [-28] });
  const target = narrationTarget([ref]);
  const ours = narrationProfile([...W("Viu a linha?", 0), ...W("Bateu o olho?", 2.4), ...W("Era a A.", 6.0), ...W("CMKV 000037.", 8.6)], 12, { speechDb: [-16], bedDb: [-21] });
  const codes = compareNarration(ours, target, "Viu a linha? Bateu o olho? Era a A. CMKV 000037.").map((f) => f.code);
  for (const c of ["falas_fragmentadas", "voz_rala", "respiro_longo", "codigo_falado", "voz_baixa"]) assert.ok(codes.includes(c), c);
  assert.deepEqual(compareNarration(ref, target, "Pesquise, compare e economize."), [], "a referência cabe no próprio alvo");
  assert.deepEqual(spokenCodes("modelo CMKV 000037 e o A1B2, PIX e QR Code"), ["000037", "A1B2"], "sigla que se fala (PIX, CMKV) não é código");
  const g = narrationGuidance([{ label: "Vídeo 2", profile: ref }]);
  assert.ok(g.some((l) => /palavras por fala/.test(l)) && g.some((l) => /^Alvo/.test(l)));
});

test("storyboard: fala lida como legenda e código falado viram problema; frase completa de até 16 palavras passa", async () => {
  const { validateProposal } = await import("../dist/application/video-editing/spot-storyboard.js");
  const ctx = { fps: 30, hasCutout: true, palette: { dark: "#000000", light: "#FFFFFF", accent: "#C9A227", ink: "#111111" }, materials: [{ id: "M1", kind: "product_photo" }, { id: "M2", kind: "product_photo" }, { id: "LOGO", kind: "logo" }] };
  const sc = (kind, role, line, beats = 6, extra = {}) => ({ kind, purpose: kind, beats, materials: ["M1"], camera: { from: "detail", to: "detail2" }, texts: [{ role: "headline", text: "Olha" }], placement: "top", transition: "cut", field: "dark", focus: false, storyboardNote: "", role, narration: line ? { line, pauseAfterMs: 120, delivery: "" } : undefined, ...extra });
  const mk = (lines) => ({ id: "P1", audioTreatment: { mood: "pop", bpm: 112, notes: "" }, language: "graphic", scenes: [sc("hook_type", "hook", lines[0], 4), sc("bands", "question", lines[1], 6, { materials: ["M1", "M2"], texts: [{ role: "label", text: "A" }] }), sc("fullbleed", "reveal", lines[2], 6, { camera: { from: "full", to: "full" } }), sc("logo_resolve", "cta", lines[3], 8, { materials: ["LOGO"], texts: [{ role: "cta", text: "Comente" }] })] });
  const frag = validateProposal(mk(["Viu a linha?", "A ou B?", "CMKV 000037.", "Comenta aí."]), ctx).map((i) => i.code);
  assert.ok(frag.includes("narration_fragmented") && frag.includes("narration_code"));
  const good = validateProposal(mk(["Você reparou na linha dessa estampa?", "Ela é a A ou a B, o que você acha?", "Era a A, a estampa Fé em traço contínuo.", "Conta pra gente se você acertou."]), ctx).map((i) => i.code);
  assert.ok(!good.includes("narration_fragmented") && !good.includes("narration_code") && !good.includes("narration_long"), good.join());
});
