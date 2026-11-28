// Evolução do motor criativo: roteiro falado (pronúncia, pausa, ênfase, perfis por campanha), encaixe da fala
// nos planos, revisão audiovisual temporal, trilha com tensão/ducking e o diretor escrevendo para voz humana.
import test from "node:test";
import assert from "node:assert/strict";
import { campaignKindOf, fitNarration, normalizeForSpeech, numberToWords, toSegments, VOICE_PROFILES } from "../dist/application/video-editing/speech-script.js";
import { hashDistance, reviewAudiovisual } from "../dist/application/video-editing/av-review.js";
import { compileProposal } from "../dist/application/video-editing/spot-storyboard.js";
import { composeScore } from "../dist/infrastructure/video-editing/score-composer.js";
import { interpretRejection } from "../dist/application/creative-engine/feedback-interpretation.js";
import { storyboardSchema, storyboardPrompt } from "../scripts/editorial/storyboard-director.mjs";

test("pronúncia pt-BR: letras soltas, siglas, códigos, números e marcas (erros medidos com o Whisper)", () => {
  assert.equal(normalizeForSpeech("Era a *A*."), "Era a á.");
  assert.equal(normalizeForSpeech("A ou B... pensa rápido."), "á ou bê... pensa rápido.");
  assert.equal(normalizeForSpeech("CMKV 000037", { CMKV: "cê eme cá vê" }), "cê eme cá vê trinta e sete");
  assert.equal(normalizeForSpeech("Pix direto no Preço Baixo Club"), "píks direto no Preço Baixo clâb");
  assert.equal(normalizeForSpeech("Na Vorix"), "Na Vórix");
  assert.equal(normalizeForSpeech("PDF"), "pê dê éfe");
  assert.deepEqual([numberToWords(0), numberToWords(21), numberToWords(100), numberToWords(101), numberToWords(1250), numberToWords(2026)], ["zero", "vinte e um", "cem", "cento e um", "mil duzentos e cinquenta", "dois mil e vinte e seis"]);
});

test("interpretação: pausa exata, ênfase como trecho mais lento com respiro, perfil da campanha", () => {
  const seg = toSegments([{ text: "Era a... *A*.", pauseAfterMs: 400 }, { text: "Olha esse *traço*." }], VOICE_PROFILES.moda);
  assert.deepEqual(seg.map((s) => s.text), ["Era a", "á.", "Olha esse", "traço."]);
  assert.ok(seg[0].pauseAfterMs >= 380 * VOICE_PROFILES.moda.pauseScale, "reticências viram suspense");
  assert.ok(seg[1].speed < seg[0].speed && seg[1].emphasis, "ênfase mais lenta");
  assert.equal(seg[1].pauseAfterMs, Math.round(400 * VOICE_PROFILES.moda.pauseScale), "pausa final do roteiro × perfil");
  const fast = toSegments([{ text: "Corre que acaba" }], VOICE_PROFILES.ofertas)[0];
  const calm = toSegments([{ text: "Corre que acaba" }], VOICE_PROFILES.casamento)[0];
  assert.ok(fast.speed > calm.speed && VOICE_PROFILES.casamento.pauseScale > VOICE_PROFILES.ofertas.pauseScale);
  assert.equal(campaignKindOf({ tone: "romântico, casamento" }), "casamento");
  assert.equal(campaignKindOf({ businessKind: "software" }), "tecnologia");
  assert.equal(campaignKindOf({ tone: "ofertas e descontos" }), "ofertas");
  assert.equal(campaignKindOf({ tone: "streetwear premium" }), "moda");
});

test("encaixe da fala: começa no plano dela e acusa o que não cabe", () => {
  const fit = fitNarration([1.2, 2.5], [{ start: 0, end: 1.8, line: 0 }, { start: 1.8, end: 3.6, line: 1 }, { start: 3.6, end: 6 }]);
  assert.equal(fit.placements[0].at, 0.12);
  assert.equal(fit.placements[1].at, 1.92);
  assert.equal(fit.overflowing.length, 1);
});

test("revisão audiovisual: achados com tempo e medida (gancho, redundância, voz × trilha, pausas, fechamento)", () => {
  const shots = [
    { index: 0, start: 0, end: 2.6, kind: "hook_type", role: "hook", texts: [], motion: 0.8, product: true, hash: 0n },
    { index: 1, start: 2.6, end: 5, kind: "macro", role: "clue", texts: [], motion: 5, product: true, hash: 0xffn },
    { index: 2, start: 5, end: 9.2, kind: "fullbleed", role: "proof", texts: [], motion: 1, product: true, hash: 0xfen },
    { index: 3, start: 9.2, end: 11, kind: "logo_resolve", role: "cta", texts: ["Já viu esse *traço*?"], product: false },
  ];
  shots[0].texts = ["Já viu esse traço?"];
  const r = reviewAudiovisual({ duration: 11, shots, lines: [{ line: "Olha esse traço", start: 0.7, end: 2.3, syllablesPerSecond: 3, pitchStd: 1.1, longestInnerPause: 0.9 }, { line: "Era a A", start: 6, end: 7, syllablesPerSecond: 5, pitchStd: 3, longestInnerPause: 0.1 }], audio: { integratedLufs: -18, truePeakDb: -0.4, voiceOverMusicDb: [2, 9] }, hasNarration: true });
  const codes = new Set(r.findings.map((f) => f.code));
  for (const code of ["gancho_fraco", "cenas_redundantes", "movimento_sem_intencao", "audio_desequilibrado", "narracao_artificial", "pausas_inadequadas", "encerramento_fraco"]) assert.ok(codes.has(code), code);
  assert.ok(r.findings.every((f) => typeof f.from === "number" && typeof f.to === "number" && f.evidence.length > 5), "todo achado tem tempo e evidência");
  assert.equal(r.findings[0].severity, "alta");
  assert.ok(r.limits.some((l) => /não ouve/.test(l)), "declara que não ouve");
  assert.equal(hashDistance(0b1011n, 0b0001n), 2);
});

test("trilha: segura uma batida antes da revelação e abaixa EXATAMENTE onde há voz", () => {
  const base = { bpm: 120, seconds: 6, mood: "pop", sections: [{ from: 0, to: 3, energy: 0.8, kind: "bands" }, { from: 3, to: 6, energy: 1, kind: "fullbleed" }], events: [{ at: 2.5, kind: "tension_stop", strength: 1 }, { at: 3, kind: "drop", strength: 1 }], tailSeconds: 0.2 };
  const plain = composeScore(base);
  const ducked = composeScore({ ...base, duck: { intervals: [{ from: 4, to: 5 }], depthDb: 9 } });
  const rms = (x, a, b) => { let s = 0; for (let i = Math.floor(a * 48000); i < b * 48000; i += 1) s += x[i] ** 2; return Math.sqrt(s / ((b - a) * 48000)); };
  assert.ok(rms(plain.left, 2.6, 2.95) < rms(plain.left, 1.5, 2.4) * 0.6, "silêncio de tensão antes da revelação");
  assert.ok(rms(plain.left, 3.0, 3.4) > rms(plain.left, 2.6, 2.95) * 2, "a revelação cai com impacto");
  const before = rms(ducked.left, 4.3, 4.9) / rms(plain.left, 4.3, 4.9);
  assert.ok(before < 0.6, `trilha abaixa sob a voz (×${before.toFixed(2)})`);
  assert.ok(Math.abs(rms(ducked.left, 0.5, 1.5) - rms(plain.left, 0.5, 1.5)) < 1e-6, "fora da voz, nada muda");
  // Antecipação: na 1ª sílaba (primeiros 100 ms) a trilha já está baixa.
  const onset = rms(ducked.left, 4.0, 4.1) / rms(plain.left, 4.0, 4.1);
  assert.ok(onset < 0.6, `trilha já baixa quando a voz entra (×${onset.toFixed(2)})`);
  // Profundidade por trecho: fala logo depois da queda abaixa mais.
  const deep = composeScore({ ...base, duck: { intervals: [{ from: 4, to: 5, depthDb: 17 }], depthDb: 9 } });
  assert.ok(rms(deep.left, 4.3, 4.9) < rms(ducked.left, 4.3, 4.9) * 0.7, "trecho com profundidade própria abaixa mais");
});

test("compilação: revelação gera tensão e queda na trilha; fala e papel vão para o plano", () => {
  const ctx = { fps: 30, hasCutout: true, palette: { dark: "#000000", light: "#FFFFFF", accent: "#C9A227", ink: "#111111" }, materials: [{ id: "M1", kind: "product_photo" }, { id: "M2", kind: "product_photo" }, { id: "LOGO", kind: "logo" }] };
  const sc = (kind, role, extra = {}) => ({ kind, purpose: kind, beats: 4, materials: ["M1"], camera: { from: "detail", to: "detail" }, texts: [], placement: "top", transition: "cut", field: "dark", focus: false, storyboardNote: "", role, ...extra });
  const p = { id: "P1", audioTreatment: { mood: "pop", bpm: 120, notes: "" }, language: "graphic", scenes: [sc("hook_type", "hook", { narration: { line: "Olha de *perto*.", pauseAfterMs: 200, delivery: "baixo" }, texts: [{ role: "headline", text: "Que traço?" }] }), sc("fullbleed", "reveal", { camera: { from: "detail", to: "full" } }), sc("logo_resolve", "cta", { materials: ["LOGO"], texts: [{ role: "cta", text: "Comente" }] })] };
  const c = compileProposal(p, ctx, 0);
  assert.equal(c.shots[0].narration.line, "Olha de *perto*.");
  assert.equal(c.shots[1].role, "reveal");
  const stop = c.audio.find((e) => e.kind === "tension_stop");
  const drop = c.audio.find((e) => e.kind === "drop");
  assert.equal(drop.frame, c.shots[1].from);
  assert.equal(stop.frame, c.shots[1].from - 15, "uma batida antes (120 BPM = 15 quadros)");
});

test("memória: críticas de vídeo caem em categorias próprias (voz, trilha, ritmo, abertura, CTA)", () => {
  assert.deepEqual(interpretRejection("a voz ficou robótica").categories, ["voz"]);
  assert.ok(interpretRejection("música repetitiva e o começo sem gancho").categories.includes("trilha"));
  assert.ok(interpretRejection("música repetitiva e o começo sem gancho").categories.includes("abertura"));
  assert.ok(interpretRejection("ritmo muito lento").categories.includes("ritmo"));
  assert.ok(interpretRejection("o encerramento ficou fraco").categories.includes("cta"));
  assert.equal(interpretRejection("a narração está alta demais").changes.audio, true, "voz libera mexer no áudio na refação");
});

test("diretor: escreve fala para voz humana, papel narrativo e tipo de campanha", () => {
  const items = storyboardSchema().properties.proposals.items;
  assert.deepEqual(items.properties.campaignKind.enum, ["moda", "tecnologia", "casamento", "ofertas"]);
  assert.ok(items.properties.scenes.items.required.includes("narration"));
  assert.ok(items.properties.scenes.items.properties.role.enum.includes("reveal"));
  const prompt = storyboardPrompt({ idea: { title: "Quiz", commercialObjective: "o", targetAudience: "p", concept: "c", visualDirection: "v", narrativeStructure: "n", cta: "Comente" }, brand: { name: "CMKV", tone: "premium", display: "DM Serif Display", palette: { dark: "#000", light: "#fff", accent: "#c90" } }, materials: [], facts: [] });
  for (const needle of ["PRESERVE O MISTÉRIO", "Ritmo VARIÁVEL", "não legendas lidas", "TEXTO CONTÍNUO", "NUNCA leia códigos", "PALAVRAS-CHAVE DA FALA", "Não repita a pergunta do gancho"]) assert.ok(prompt.includes(needle), needle);
  assert.ok(!/até 10 palavras/.test(prompt), "a regra antiga de fala curta saiu");
});
