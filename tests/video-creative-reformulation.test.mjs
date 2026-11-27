// Reformulação da direção criativa: medidor de linguagem (referências e diagnóstico), extração da estampa,
// storyboard (validação, distinção, seleção explícita, compilação na batida), gosto da marca + veredito
// editorial humano, vídeos de referência no Bolsão e trilha composta para o corte.
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFrames, compareProfiles, detectCuts, dominantPalette, referenceGuidance, shotStats } from "../dist/application/video-editing/reference-profile.js";
import { alignmentBetween, components, extractPrint, groupElements } from "../dist/application/video-editing/print-extraction.js";
import { compileProposal, proposalDistance, readingSeconds, scoreProposal, selectProposal, tasteViolations, validateProposal } from "../dist/application/video-editing/spot-storyboard.js";
import { editorialVerdict, normalizeFeedbackInput, tasteFromMemory, videoFeedbackEvents, VIDEO_TASTE_PATTERNS } from "../dist/domain/video-editing/brand-video-taste.js";
import { buildCreativeMemory } from "../dist/application/creative-engine/creative-memory.js";
import { normalizeReferenceVideos, parseManualEditorialIdea } from "../dist/domain/editorial/editorial-idea.model.js";
import { composeScore } from "../dist/infrastructure/video-editing/score-composer.js";
import { VideoProjectsService } from "../dist/application/video-editing/video-projects.service.js";
import { InMemoryVideoProjectRepository } from "../dist/infrastructure/storage/in-memory-video-project-repository.js";
import { InMemoryVideoBrandFeedbackRepository } from "../dist/infrastructure/storage/in-memory-video-brand-feedback-repository.js";
import { storyboardSchema, storyboardPrompt, revisionSchema, revisionPrompt } from "../scripts/editorial/storyboard-director.mjs";

// ------------------------------------------------------------------ medidor de linguagem

function synthetic({ w = 24, h = 40, fps = 6, shots }) {
  // shots: [{ frames, rgb, moving? }]
  const total = shots.reduce((a, s) => a + s.frames, 0);
  const data = new Uint8Array(total * w * h * 3);
  let f = 0;
  for (const s of shots) {
    for (let k = 0; k < s.frames; k += 1, f += 1) {
      for (let p = 0; p < w * h; p += 1) {
        const x = p % w, y = Math.floor(p / w);
        const square = s.moving ? x >= (k % 10) && x < (k % 10) + 8 && y > 10 && y < 26 : x > 8 && x < 16 && y > 10 && y < 26;
        const c = square ? [240, 240, 240] : s.rgb;
        data.set(c, (f * w * h + p) * 3);
      }
    }
  }
  return { width: w, height: h, fps, data };
}

test("medidor: cortes, planos, paleta e quadros vazios saem dos quadros (não de rótulos)", () => {
  const frames = synthetic({ shots: [{ frames: 12, rgb: [200, 30, 30] }, { frames: 18, rgb: [20, 30, 200] }, { frames: 6, rgb: [10, 10, 10] }] });
  const cuts = detectCuts(frames);
  assert.equal(cuts.length, 2);
  assert.ok(Math.abs(cuts[0] - 2) < 0.2 && Math.abs(cuts[1] - 5) < 0.2);
  const stats = shotStats(cuts, 6);
  assert.equal(stats.count, 3);
  assert.equal(stats.medianSeconds, 2);
  const profile = analyzeFrames(frames);
  assert.equal(profile.shots.count, 3);
  assert.ok(profile.palette.length >= 2, "paleta com as cores dominantes");
  assert.ok(profile.hookSeconds > 1.8 && profile.hookSeconds < 2.2);
  assert.ok(referenceGuidance(profile).some((l) => l.startsWith("Ritmo medido")));
  assert.ok(referenceGuidance(profile, {}, ["cor"]).every((l) => !l.startsWith("Ritmo")), "papel filtra os aspectos");
});

test("medidor: movimento dentro do plano é medido; plano parado é 'static'", () => {
  const still = analyzeFrames(synthetic({ shots: [{ frames: 24, rgb: [40, 40, 40] }] }));
  const moving = analyzeFrames(synthetic({ shots: [{ frames: 24, rgb: [40, 40, 40], moving: true }] }));
  assert.equal(still.motionClass, "static");
  assert.ok(moving.motionEnergy > still.motionEnergy);
  assert.ok(compareProfiles(still, moving).some((d) => d.includes("energia de movimento")));
});

test("medidor: paleta k-means é determinística", () => {
  const samples = [...Array(50)].map(() => [250, 250, 250]).concat([...Array(50)].map(() => [10, 10, 10]));
  assert.deepEqual(dominantPalette(samples), dominantPalette(samples));
  assert.equal(dominantPalette(samples).length, 2);
});

// ------------------------------------------------------------------ extração da estampa

function fabricWithPrint({ w = 120, h = 60, fabric = [25, 25, 25], blobs, hair }) {
  const rgb = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p += 1) rgb.set(fabric, p * 3);
  const paint = (x0, y0, bw, bh, c) => { for (let y = y0; y < y0 + bh; y += 1) for (let x = x0; x < x0 + bw; x += 1) rgb.set(c, (y * w + x) * 3); };
  for (const b of blobs) paint(b.x, b.y, b.w, b.h, b.c ?? [240, 210, 40]);
  if (hair) paint(0, 0, 6, h, [200, 160, 90]);
  return { rgb, w, h };
}

test("estampa: separa do tecido sem repintar, acha os elementos e ignora o que encosta na borda", () => {
  const { rgb, w, h } = fabricWithPrint({ blobs: [{ x: 20, y: 20, w: 15, h: 18 }, { x: 50, y: 20, w: 15, h: 18 }, { x: 80, y: 22, w: 14, h: 15, c: [120, 200, 60] }], hair: true });
  const r = extractPrint(rgb, w, h);
  assert.equal(r.elements.length, 3, "três elementos, o cabelo da borda fica de fora");
  assert.ok(r.confidence > 0.8);
  const center = (22 * w + 25) * 4;
  assert.deepEqual([...r.rgba.slice(center, center + 4)], [240, 210, 40, 255], "cor original preservada e opaca");
  assert.equal(r.rgba[(5 * w + 110) * 4 + 3], 0, "tecido transparente");
  assert.ok(r.bounds.x >= 18 && r.bounds.x + r.bounds.w <= 96);
});

test("estampa: traço cortado pela borda é sinalizado (a região cresce) e migalha isolada não alarga a caixa", () => {
  const cut = fabricWithPrint({ blobs: [{ x: 40, y: 30, w: 30, h: 30 }] });
  const r = extractPrint(cut.rgb, cut.w, cut.h, { x: 20, y: 10, w: 80, h: 45 });
  assert.equal(r.clipped.bottom, true);
  const parts = components(Uint8Array.from({ length: 100 }, (_, i) => (i % 10 < 3 && i < 30) || i === 99 ? 1 : 0), 10, 10, 1);
  assert.equal(parts.length, 2);
  const grouped = groupElements([{ x: 10, y: 10, w: 40, h: 40, area: 1600 }, { x: 400, y: 400, w: 3, h: 3, area: 9 }], 2);
  assert.deepEqual(grouped, [{ x: 10, y: 10, w: 40, h: 40 }], "migalha longe é descartada");
  const a = alignmentBetween({ x: 0.3, y: 0.3, w: 0.4, h: 0.1 }, { x: 0.32, y: 0.31, w: 0.44, h: 0.11 });
  assert.ok(Math.abs(a.scale - 1.1) < 1e-9);
});

// ------------------------------------------------------------------ storyboard

const CTX = { fps: 30, hasCutout: true, palette: { dark: "#0B0B0B", light: "#F7F5F0", accent: "#C9A227", ink: "#111111" }, materials: [{ id: "M1", kind: "product_photo", name: "preta", fabricHex: "#1B1B1C" }, { id: "M2", kind: "product_photo", name: "preta", fabricHex: "#1B1B1C" }, { id: "M3", kind: "product_photo", name: "branca", fabricHex: "#C4C3CC" }, { id: "LOGO", kind: "logo" }] };
const scene = (kind, beats, extra = {}) => ({ kind, purpose: kind, beats, materials: ["M1"], camera: { from: "detail", to: "detail" }, texts: [], placement: "top", transition: "cut", field: "dark", focus: false, storyboardNote: "", ...extra });
function proposal(id, language, scenes, extra = {}) {
  return { id, title: id, concept: "c", script: ["a", "b", "c"], language, emphasis: "color", align: "left", artDirection: "", animationLanguage: "", audioTreatment: { mood: "elegant", bpm: 120, notes: "" }, fromStructureReference: "", fromAestheticReference: "", materialsNeeded: [], technicalResources: [], limitations: [], scenes, ...extra };
}
// Quiz no padrão novo: pistas em fragmentos, pergunta, tensão, e o traço completo só como PAGAMENTO da revelação.
const QUIZ = (id, language, hookCam = { from: "detail", to: "detail" }, logoMaterials = ["LOGO"]) => proposal(id, language, [
  scene("hook_type", 4, { camera: hookCam, role: "hook", texts: [{ role: "headline", text: "Já viu esse *traço*?" }] }),
  scene("macro", 3, { camera: { from: "detail2", to: "detail2" }, role: "clue" }),
  scene("bands", 6, { materials: ["M1", "M2"], role: "question", texts: [{ role: "label", text: "A" }, { role: "label", text: "B" }, { role: "caption", text: "A ou B?" }] }),
  scene("countdown", 6, { materials: ["M1", "M2"], role: "tension" }),
  scene("trace_draw", 6, { camera: { from: "chest", to: "chest" }, transition: "iris_print", role: "reveal", texts: [{ role: "headline", text: "Era a *A*." }] }),
  scene("variant_cycle", 8, { materials: ["M1", "M3"], transition: "color_wipe", camera: { from: "chest", to: "chest" }, role: "proof" }),
  scene("logo_resolve", 8, { materials: logoMaterials, role: "cta", texts: [{ role: "headline", text: "Você acertou?" }, { role: "cta", text: "Conta: A ou B" }] }),
]);

test("storyboard: validação mede gancho, leitura, revelação (spoiler), material e CTA", () => {
  assert.deepEqual(validateProposal(QUIZ("P1", "cinematic"), CTX), []);
  const spoiler = validateProposal(QUIZ("P2", "cinematic", { from: "macro", to: "detail" }), CTX);
  assert.ok(spoiler.some((i) => i.code === "spoiler"), "gancho que mostra a estampa inteira antes de 'Era a A'");
  // O desenho da prova anterior (traço completo ANTES da pergunta) agora é reprovado: quebra o mistério.
  const old = QUIZ("P5", "cinematic");
  old.scenes[1] = scene("trace_draw", 3, { role: "clue" });
  assert.ok(validateProposal(old, CTX).some((i) => i.code === "spoiler" && i.scene === 1));
  // Redundância, fala que não cabe e ritmo uniforme.
  const flat = proposal("P6", "graphic", [scene("hook_type", 4, { role: "hook", texts: [{ role: "headline", text: "Olha" }] }), scene("macro", 4, { role: "clue" }), scene("macro", 4, { role: "clue" }), scene("fullbleed", 4, { role: "proof", narration: { line: "Uma fala longa demais para caber neste plano tão curto de agora mesmo, viu", pauseAfterMs: 300, delivery: "" } }), scene("logo_resolve", 8, { materials: ["LOGO"], role: "cta", texts: [{ role: "cta", text: "Comente" }] })]);
  const codes2 = validateProposal(flat, CTX).map((i) => i.code);
  for (const code of ["redundant", "narration_long", "narration_fit", "flat_rhythm"]) assert.ok(codes2.includes(code), code);
  const bad = proposal("P3", "graphic", [scene("hook_type", 6, { texts: [{ role: "headline", text: "Uma frase longa demais para gancho" }] }), scene("fullbleed", 10, { materials: ["X9"] }), scene("bands", 4), scene("type_card", 4)]);
  const codes = validateProposal(bad, CTX).map((i) => i.code);
  for (const code of ["hook", "material", "variants", "long_static", "cta"]) assert.ok(codes.includes(code), code);
  assert.ok(readingSeconds("*abc*") < readingSeconds("abcdef"));
});

test("storyboard: distinção entre propostas e seleção por critérios explícitos (sem nota do Codex)", () => {
  const a = QUIZ("P1", "cinematic");
  const b = { ...QUIZ("P2", "graphic"), emphasis: "block", align: "center", audioTreatment: { mood: "pop", bpm: 106, notes: "" } };
  const c = proposal("P3", "editorial", [scene("print_assemble", 4, { texts: [{ role: "headline", text: "Monta aí" }] }), scene("macro", 4), scene("fullbleed", 6), scene("logo_resolve", 8, { materials: ["LOGO"], texts: [{ role: "cta", text: "Comente" }] })]);
  assert.equal(proposalDistance(a, a).distinct, false, "a mesma proposta não é 'diferente'");
  assert.equal(proposalDistance(a, b).distinct, true);
  const taste = { preferred: ["montagem_da_estampa"], rejected: ["cartoes_de_foto"] };
  const sel = selectProposal([a, b, c], CTX, { structureMedianShot: 1.33, aestheticLuma: 68 }, taste);
  assert.equal(sel.scores.length, 3);
  for (const s of sel.scores) {
    assert.equal(s.criteria.reduce((x, k) => x + k.weight, 0).toFixed(2), "1.00", "pesos somam 1");
    assert.ok(s.criteria.every((k) => typeof k.evidence === "string" && k.evidence.length > 0), "cada critério mostra a evidência");
  }
  const withCards = scoreProposal(QUIZ("P4", "cinematic", undefined, ["M1", "LOGO"]), CTX, {}, taste);
  assert.ok(withCards.total < scoreProposal(a, CTX, {}, taste).total, "padrão reprovado pela marca derruba a nota");
  assert.deepEqual(tasteViolations(QUIZ("P4", "cinematic", undefined, ["M1", "LOGO"]), taste), ["cartoes_de_foto"]);
});

test("storyboard: compila na grade da batida, com eventos de som; regra da marca vale na compilação", () => {
  const p = QUIZ("P1", "cinematic", undefined, ["M1", "LOGO"]);
  const beat = 30 * 60 / 120;
  const compiled = compileProposal(p, CTX, 5, { preferred: [], rejected: ["cartoes_de_foto"] });
  let beats = 0;
  for (const [i, shot] of compiled.shots.entries()) {
    assert.equal(shot.from, Math.round(beats * beat), `plano ${i + 1} começa na batida`);
    beats += p.scenes[i].beats;
  }
  assert.equal(compiled.durationInFrames, Math.round(beats * beat));
  assert.equal(compiled.shots[0].transition, "cut", "o primeiro plano nunca entra com transição (sem fade do preto)");
  assert.equal(compiled.shots[6].strip, undefined, "marca que reprova cartões de foto não recebe a faixa de fotos");
  assert.ok(compileProposal(p, CTX, 5).shots[6].strip?.length, "sem a regra, a faixa existe");
  assert.deepEqual(compiled.shots[3].texts.filter((t) => t.role === "label").map((t) => t.text), ["A", "B"], "a contagem herda os rótulos da comparação");
  assert.equal(compiled.shots[3].events.length, 3, "3-2-1");
  const kinds = new Set(compiled.audio.map((e) => e.kind));
  for (const k of ["hit", "land", "pop", "switch", "logo", "click"]) assert.ok(kinds.has(k), `evento de som ${k}`);
  assert.ok(compiled.sections.every((s) => s.energy > 0 && s.energy <= 1));
});

test("diretor de storyboard: schema estrito (3 propostas), prompt com pauta, referências medidas e regras", () => {
  const schema = storyboardSchema();
  assert.equal(schema.properties.proposals.minItems, 3);
  assert.equal(schema.properties.proposals.items.additionalProperties, false);
  assert.ok(schema.properties.proposals.items.properties.scenes.items.properties.kind.enum.includes("trace_draw"));
  const prompt = storyboardPrompt({ idea: { title: "Quiz", commercialObjective: "o", targetAudience: "p", concept: "c", visualDirection: "v", narrativeStructure: "n", cta: "Comente" }, brand: { name: "CMKV", tone: "premium", display: "DM Serif Display", palette: CTX.palette }, materials: [{ id: "M1", label: "foto" }], references: [{ role: "structure", label: "Vídeo 1", note: "gancho", guidance: ["Ritmo medido: 23 planos"] }], taste: { preferred: [], rejected: ["cartoes_de_foto"] }, facts: ["A é 000037"] });
  for (const needle of ["TRÊS propostas", "VISUALMENTE DISTINTAS", "ESTRUTURA", "Ritmo medido: 23 planos", "cartoes_de_foto", "NÃO invente", "nunca copie"]) assert.ok(prompt.includes(needle), needle);
  assert.deepEqual(Object.keys(revisionSchema().properties), ["proposal", "changes"]);
  assert.ok(revisionPrompt({ proposal: { id: "P1" }, issues: ["gancho mostra demais"] }).includes("gancho mostra demais"));
});

// ------------------------------------------------------------------ gosto da marca e veredito editorial

test("gosto da marca: reprovação com motivo, derivação e veredito — só pessoa aprova o padrão comercial", () => {
  assert.throws(() => normalizeFeedbackInput({ verdict: "rejected" }), /diga o que estava errado/);
  assert.deepEqual(normalizeFeedbackInput({ verdict: "rejected", patterns: ["slideshow", "inexistente"] }).patterns, ["slideshow"]);
  const f = (verdict, patterns, at, note, projectId = "p1") => ({ id: at, tenantId: "t", workspaceId: "w", projectId, versionId: `v-${at}`, verdict, patterns, reviewerId: "u", createdAt: at, ...(note ? { note } : {}) });
  const now = new Date("2026-11-10T00:00:00Z");
  const taste = (items) => tasteFromMemory(buildCreativeMemory(videoFeedbackEvents(items), { workspaceId: "w", now }));
  // Uma crítica pontual NÃO vira proibição: fica só observada.
  const once = taste([f("rejected", ["slideshow"], "2026-11-01", "parece slide")]);
  assert.deepEqual(once.rejected, []);
  assert.deepEqual(once.observed, ["slideshow"]);
  // Duas pautas diferentes com o mesmo problema: aí sim vira algo a evitar (memória criativa existente).
  const twice = taste([f("rejected", ["slideshow", "narracao_artificial"], "2026-11-01", "voz robótica", "p1"), f("rejected", ["slideshow"], "2026-11-03", "", "p2"), f("approved", ["montagem_da_estampa"], "2026-11-04", "", "p3"), f("approved", ["montagem_da_estampa"], "2026-11-05", "", "p4")]);
  assert.deepEqual(twice.rejected, ["slideshow"]);
  assert.deepEqual(twice.preferred, ["montagem_da_estampa"]);
  // A mesma pauta reprovada duas vezes é preferência daquela peça, não da marca.
  assert.deepEqual(taste([f("rejected", ["slideshow"], "2026-11-01"), f("rejected", ["slideshow"], "2026-11-02")]).rejected, []);
  // Expira: fora da janela de 60 dias não conta.
  assert.deepEqual(tasteFromMemory(buildCreativeMemory(videoFeedbackEvents([f("rejected", ["slideshow"], "2026-11-01", "", "p1"), f("rejected", ["slideshow"], "2026-11-03", "", "p2")]), { workspaceId: "w", now: new Date("2027-03-01T00:00:00Z") })).rejected, []);
  // O motivo entra na leitura por categoria (voz) e vira orientação quando se repete.
  const voice = taste([f("rejected", ["narracao_artificial"], "2026-11-01", "voz robótica", "p1"), f("rejected", [], "2026-11-02", "a narração ficou artificial", "p2")]);
  assert.ok(voice.notes.some((n) => /Voz: fala natural/.test(n)));
  assert.equal(editorialVerdict({ technical: "needs_revision", feedback: [] }).status, "blocked_technical");
  assert.equal(editorialVerdict({ technical: "ready_for_review", feedback: [], advisory: "Codex: parece ótimo" }).status, "awaiting_human", "a revisão do Codex nunca aprova");
  assert.equal(editorialVerdict({ technical: "ready_for_review", feedback: [f("approved", [], "2026-11-04")] }).status, "approved_commercial");
  assert.match(editorialVerdict({ technical: "ready_for_review", feedback: [f("rejected", ["gancho_fraco"], "2026-11-05", "sem gancho")] }).reason, /Gancho fraco.*sem gancho/);
  assert.ok(Object.keys(VIDEO_TASTE_PATTERNS).length >= 15);
});

test("serviço: avaliação humana aprova a versão no fluxo de sempre; reprovação vira gosto da marca", async () => {
  const repository = new InMemoryVideoProjectRepository();
  const feedbackRepository = new InMemoryVideoBrandFeedbackRepository();
  const service = new VideoProjectsService({ repository, feedbackRepository, isEnabled: () => true, keyOwner: () => ({ tenantId: "t", workspaceId: "w" }), urlToKey: (u) => u, previewUrl: (k) => k, musicLibraryAvailable: false });
  const scope = { tenantId: "t", workspaceId: "w" };
  await assert.rejects(service.recordFeedback(scope, "nao-existe", "u", { verdict: "rejected", patterns: ["slideshow"] }), /não encontrada/);
  await assert.rejects(service.recordFeedback(scope, "x", "u", { verdict: "rejected" }), /diga o que estava errado/);
  await feedbackRepository.record({ id: "f1", tenantId: "t", workspaceId: "w", projectId: "p1", verdict: "rejected", patterns: ["cartoes_de_foto"], note: "sem grade de fotos", reviewerId: "u", createdAt: new Date().toISOString() });
  await feedbackRepository.record({ id: "f2", tenantId: "t", workspaceId: "w", projectId: "p2", verdict: "rejected", patterns: ["cartoes_de_foto"], reviewerId: "u", createdAt: new Date().toISOString() });
  await feedbackRepository.record({ id: "f3", tenantId: "t", workspaceId: "outro", projectId: "p9", verdict: "rejected", patterns: ["slideshow"], reviewerId: "u", createdAt: new Date().toISOString() });
  const taste = await service.brandTaste(scope);
  assert.deepEqual(taste.rejected, ["cartoes_de_foto"], "gosto é por marca (workspace) e vem da memória criativa");
});

// ------------------------------------------------------------------ Bolsão: vídeos de referência

test("bolsão: vídeos de referência com papel e nota (estrutura × estética), sem repetir, no máximo 3", () => {
  const videos = normalizeReferenceVideos([{ url: "https://s/a.mp4", role: "structure", note: " gancho rápido " }, { url: "https://s/b.mp4", role: "aesthetic" }, "https://s/a.mp4", { url: "https://s/c.mp4" }]);
  assert.deepEqual(videos, [{ url: "https://s/a.mp4", role: "structure", note: "gancho rápido" }, { url: "https://s/b.mp4", role: "aesthetic" }, { url: "https://s/c.mp4", role: "both" }]);
  assert.throws(() => normalizeReferenceVideos([{ url: "ftp://x" }]), /inválido/);
  assert.throws(() => normalizeReferenceVideos([{ url: "https://s/a.mp4", role: "copiar" }]), /papel/);
  assert.throws(() => normalizeReferenceVideos(["https://1", "https://2", "https://3", "https://4"].map((url) => ({ url }))), /no máximo 3/);
  const idea = parseManualEditorialIdea({ title: "Quiz", format: "video", referenceVideos: [{ url: "https://s/a.mp4", role: "structure" }] }, "IDEIA-001");
  assert.equal(idea.referenceVideos[0].role, "structure");
  assert.equal(parseManualEditorialIdea({ title: "Sem vídeo", format: "video" }, "IDEIA-002").referenceVideos, undefined, "ideias antigas continuam iguais");
});

// ------------------------------------------------------------------ trilha composta

test("trilha: composta para as seções e eventos do corte, determinística, com pico controlado", () => {
  const input = { bpm: 120, seconds: 6, mood: "pop", sections: [{ from: 0, to: 2, energy: 0.75, kind: "hook_type" }, { from: 2, to: 4, energy: 1, kind: "variant_cycle" }, { from: 4, to: 6, energy: 0.45, kind: "logo_resolve" }], events: [{ at: 0, kind: "hit", strength: 1 }, { at: 2.5, kind: "switch", strength: 0.7 }, { at: 4.1, kind: "logo", strength: 0.9 }], tailSeconds: 0.5 };
  const a = composeScore(input);
  const b = composeScore(input);
  assert.equal(a.left.length, Math.ceil(6.5 * 48000));
  assert.ok(a.notes > 10);
  assert.deepEqual(a.left.slice(1000, 1010), b.left.slice(1000, 1010), "mesma entrada, mesma trilha");
  let peak = 0;
  for (let i = 0; i < a.left.length; i += 1) peak = Math.max(peak, Math.abs(a.left[i]), Math.abs(a.right[i]));
  assert.ok(peak <= 0.9 && peak > 0.3, `pico ${peak}`);
  const energy = (from, to) => { let s = 0; for (let i = Math.floor(from * 48000); i < to * 48000; i += 1) s += a.left[i] ** 2; return s / ((to - from) * 48000); };
  assert.ok(energy(2.1, 3.9) > energy(4.6, 5.9), "o corpo (bateria) tem mais energia que a resolução final");
});
