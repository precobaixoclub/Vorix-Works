import test from "node:test";
import assert from "node:assert/strict";
import { compareIdeasForSlot, rankIdeasForSlot, topicSimilarity, topicWords } from "../dist/application/creative-engine/editorial-calendar.js";

// Calendário inteligente (27/11/2026): a ordem das pautas do Bolsão considera o que já foi ao ar e o que
// está agendado perto do horário — sem passar por cima da data marcada pelo cliente e sem descartar pautas.

const SLOT = "2026-11-27T19:00";
let n = 0;
const idea = (extra = {}) => ({ id: `i${++n}`, externalId: `P-${String(n).padStart(3, "0")}`, title: `Pauta ${n}`, category: "Dicas", approach: "Pergunta", format: "single_image", keyMessage: "", priority: "normal", createdAt: `2026-11-0${Math.min(9, n)}T10:00:00Z`, ...extra });
const piece = (extra = {}) => ({ at: "2026-11-27T15:00:00Z", format: "single_image", ...extra });
const order = (ranked) => ranked.map((entry) => entry.idea.id);

test("sem histórico, a ordem é exatamente a de antes (data marcada → prioridade → data sugerida → criação)", () => {
  const ideas = [
    idea({ suggestedDate: "2026-12-10" }), idea({ priority: "high" }), idea({ scheduledDate: "2026-11-27" }),
    idea({ suggestedDate: "2026-11-20" }), idea(), idea({ priority: "high", suggestedDate: "2026-11-25" }),
  ];
  assert.deepEqual(order(rankIdeasForSlot(ideas, { slot: SLOT, recent: [] })), [...ideas].sort(compareIdeasForSlot).map((item) => item.id));
});

test("data marcada pelo cliente continua na frente, mesmo repetindo a categoria da peça das 12h", () => {
  const dated = idea({ category: "Vitrine", scheduledDate: "2026-11-27" });
  const other = idea({ category: "Bastidores", priority: "high" });
  const ranked = rankIdeasForSlot([other, dated], { slot: SLOT, recent: [piece({ category: "Vitrine" })] });
  assert.equal(ranked[0].idea.id, dated.id);
  assert.match(ranked[0].reasons[0], /Data marcada/);
});

test("categoria e abordagem iguais às da peça vizinha perdem a vez; nenhuma pauta é descartada", () => {
  const sameCategory = idea({ category: "Dicas", approach: "Pergunta" });
  const fresh = idea({ category: "Bastidores", approach: "Demonstração" });
  const ranked = rankIdeasForSlot([sameCategory, fresh], { slot: SLOT, recent: [piece({ category: "Dicas", approach: "Pergunta" })] });
  assert.deepEqual(order(ranked), [fresh.id, sameCategory.id]);
  assert.ok(ranked[1].reasons.some((reason) => /Categoria "Dicas"/.test(reason)));
  assert.equal(ranked.length, 2);
});

test("terceiro carrossel seguido perde a vez para uma imagem única", () => {
  const carousel = idea({ format: "carousel", category: "A" });
  const single = idea({ format: "single_image", category: "B" });
  const recent = [piece({ format: "carousel", category: "C" }), piece({ format: "carousel", category: "D", at: "2026-11-26T22:00:00Z" })];
  const ranked = rankIdeasForSlot([carousel, single], { slot: SLOT, recent });
  assert.deepEqual(order(ranked), [single.id, carousel.id]);
  assert.ok(ranked[1].reasons.some((reason) => /3º carrossel/.test(reason)));
});

test("assunto quase igual a uma peça agendada/publicada perto do horário perde a vez", () => {
  assert.ok(topicSimilarity(topicWords("O robô aspirador passa embaixo do sofá?"), topicWords("Robô aspirador: passa embaixo do sofá e da cama")) >= 0.45);
  const repeated = idea({ title: "O robô aspirador passa embaixo do sofá?", category: "Casa" });
  const different = idea({ title: "Panela elétrica: arroz soltinho sem vigiar", category: "Cozinha" });
  const ranked = rankIdeasForSlot([repeated, different], { slot: SLOT, recent: [piece({ title: "Robô aspirador: passa embaixo do sofá e da cama", category: "Casa" })] });
  assert.deepEqual(order(ranked), [different.id, repeated.id]);
  assert.ok(ranked[1].reasons.some((reason) => /Assunto quase igual/.test(reason)));
});

test("vizinhança: a peça das 12h de hoje pesa mais que a de dias atrás; prioridade alta ainda vence diferença pequena", () => {
  const a = idea({ category: "A" });
  const b = idea({ category: "B" });
  // A peça de hoje (vizinha) é da categoria B; a de 5 dias atrás, da A.
  const recent = [piece({ category: "A", at: "2026-11-22T15:00:00Z" }), piece({ category: "B", at: "2026-11-27T15:00:00Z" })];
  assert.deepEqual(order(rankIdeasForSlot([a, b], { slot: SLOT, recent })), [a.id, b.id]);
  const urgent = idea({ category: "B", priority: "high" });
  assert.equal(rankIdeasForSlot([a, urgent], { slot: SLOT, recent })[0].idea.id, urgent.id);
});

test("determinístico: a mesma entrada dá sempre a mesma ordem", () => {
  const ideas = Array.from({ length: 8 }, (_, index) => idea({ category: ["A", "B", "C"][index % 3], format: index % 2 ? "carousel" : "single_image", title: `Tema ${index} sobre casamento` }));
  const recent = [piece({ category: "A", format: "carousel" }), piece({ category: "B", format: "carousel", at: "2026-11-26T22:00:00Z" })];
  const first = order(rankIdeasForSlot(ideas, { slot: SLOT, recent }));
  assert.deepEqual(order(rankIdeasForSlot([...ideas].reverse(), { slot: SLOT, recent })), first);
  assert.equal(new Set(first).size, ideas.length);
});
