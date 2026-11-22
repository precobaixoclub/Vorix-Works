import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import {
  buildEditorialCalendar,
  buildEditorialGenerationBrief,
  businessDays,
  nextManualExternalId,
  normalizeCreativePrompt,
  parseEditorialPack,
  parseManualEditorialIdea,
} from "../dist/domain/editorial/editorial-idea.model.js";
import { InMemoryEditorialIdeaRepository } from "../dist/infrastructure/storage/in-memory-editorial-idea-repository.js";
import { InMemoryWorkspaceRepository } from "../dist/infrastructure/storage/in-memory-workspace-repository.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { registerEditorialIdeasRoutes } from "../dist/interfaces/api/routes/v1/editorial-ideas.route.js";

const PACK_FILE = "scripts/editorial/vorix-works-pautas.json";

function idea(id, overrides = {}) {
  return {
    id, title: `Pauta ${id}`, category: "Conversações e CRM", commercialObjective: "Gerar interesse qualificado",
    targetAudience: "Donos de pequenas empresas", concept: "Conceito", keyMessage: "Mensagem", format: "single_image",
    approach: "Pergunta provocativa", visualDirection: "Direção", narrativeStructure: "Estrutura", caption: "Legenda", cta: "Conheça a Vorix Works",
    priority: "normal", ...overrides,
  };
}
const pack = (ideas) => ({ schema: "vorix.editorial-pack/v1", ideas });

test("pacote: valida campos, ids únicos, roteiros por formato e datas", () => {
  const parsed = parseEditorialPack(pack([idea("A-1"), idea("A-2", { format: "carousel", carouselScript: [{ headline: "1", body: "a" }, { headline: "2", body: "b" }], suggestedDate: "2026-11-23" })]));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].carouselScript.length, 2);
  assert.throws(() => parseEditorialPack(pack([idea("A-1"), idea("A-1")])), /duas vezes/);
  assert.throws(() => parseEditorialPack(pack([idea("A-1", { format: "carousel" })])), /carrossel sem roteiro/);
  assert.throws(() => parseEditorialPack(pack([idea("A-1", { format: "video" })])), /vídeo sem roteiro/);
  assert.throws(() => parseEditorialPack(pack([idea("A-1", { suggestedDate: "2026-02-30" })])), /data sugerida/);
  assert.throws(() => parseEditorialPack(pack([idea("A-1", { title: "" })])), /title/);
  assert.throws(() => parseEditorialPack({ ideas: [idea("A-1")] }), /esquema/);
});

test("calendário: 5 por semana em dias úteis, alterna categoria e formato, respeita o que já está agendado", async () => {
  assert.deepEqual(businessDays("2026-11-23", 7), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
  const repo = new InMemoryEditorialIdeaRepository();
  const categories = ["CRM", "Reuniões", "Sites"];
  const formats = ["single_image", "carousel", "video"];
  const contents = parseEditorialPack(pack(Array.from({ length: 40 }, (_, i) => idea(`X-${String(i).padStart(3, "0")}`, {
    category: categories[i % 2 === 0 ? 0 : 1 + (i % 3 === 0 ? 1 : 0)],
    format: "single_image",
    ...(i % 5 === 0 ? { format: formats[1], carouselScript: [{ headline: "a", body: "b" }, { headline: "c", body: "d" }] } : {}),
  }))));
  await repo.importMany({ tenantId: "t", workspaceId: "w", ideas: contents });
  const all = await repo.listByWorkspace("w");
  await repo.update("w", all[10].id, { scheduledDate: "2026-11-25" });
  const assignments = buildEditorialCalendar(await repo.listByWorkspace("w"), { startDate: "2026-11-23", days: 30 });
  const days = businessDays("2026-11-23", 30);
  assert.equal(assignments.length, days.length - 1, "o dia já ocupado fica com a pauta que estava lá");
  assert.ok(!assignments.some((a) => a.date === "2026-11-25"));
  assert.ok(assignments.every((a) => days.includes(a.date)));
  const byId = new Map(all.map((item) => [item.id, item]));
  const ordered = days.map((date) => (date === "2026-11-25" ? all[10] : byId.get(assignments.find((a) => a.date === date).ideaId)));
  for (let i = 1; i < ordered.length; i += 1) assert.notEqual(ordered[i].category, ordered[i - 1].category, `categoria repetida em ${days[i]}`);
});

test("motor criativo: brief respeita os limites da rota de geração; vídeo não vai para o motor de ideias", () => {
  const [carousel] = parseEditorialPack(pack([idea("C-1", { format: "carousel", concept: "x".repeat(1400), carouselScript: [{ headline: "Capa", body: "a".repeat(400) }, { headline: "Fim", body: "b".repeat(400) }] })]));
  const brief = buildEditorialGenerationBrief(carousel);
  assert.equal(brief.format, "carousel");
  assert.ok(brief.ideaText.length <= 8000 && brief.objective.length <= 300 && brief.targetAudience.length <= 300);
  assert.match(brief.ideaText, /não invente/);
  const [video] = parseEditorialPack(pack([idea("V-1", { format: "video", videoScript: [{ time: "0-2s", visual: "a", text: "b" }, { time: "2-5s", visual: "c", text: "d" }] })]));
  assert.throws(() => buildEditorialGenerationBrief(video), /vídeo/);
});

test("prompt criativo específico: parse opcional, normalização e injeção dominante no brief", () => {
  // normalização: vazio vira undefined; espaços aparados; excesso recusado.
  assert.equal(normalizeCreativePrompt(undefined), undefined);
  assert.equal(normalizeCreativePrompt("   "), undefined);
  assert.equal(normalizeCreativePrompt("  arte editorial  "), "arte editorial");
  assert.throws(() => normalizeCreativePrompt("x".repeat(8001)), /8000/);

  // parse: aceita creativePrompt opcional e o apara; sem campo = ausente.
  const [withPrompt] = parseEditorialPack(pack([idea("P-1", { creativePrompt: "  Fotografia editorial hiper-realista, roxo como acento.  " })]));
  assert.equal(withPrompt.creativePrompt, "Fotografia editorial hiper-realista, roxo como acento.");
  const [withoutPrompt] = parseEditorialPack(pack([idea("P-2")]));
  assert.equal(withoutPrompt.creativePrompt, undefined);
  const [emptyPrompt] = parseEditorialPack(pack([idea("P-3", { creativePrompt: "   " })]));
  assert.equal(emptyPrompt.creativePrompt, undefined, "prompt vazio não vira campo");

  // brief COM prompt: o prompt entra como direção dominante; o fecho de segurança continua inteiro.
  const briefWith = buildEditorialGenerationBrief(withPrompt);
  assert.match(briefWith.ideaText, /PROMPT CRIATIVO ESPECÍFICO/);
  assert.match(briefWith.ideaText, /Fotografia editorial hiper-realista/);
  assert.match(briefWith.ideaText, /não invente/, "fecho de segurança preservado");
  assert.doesNotMatch(briefWith.ideaText, /Conceito:/, "com prompt, o conceito genérico dá lugar à direção dominante");

  // brief SEM prompt: comportamento padrão (conceito + direção visual), sem bloco de prompt.
  const briefWithout = buildEditorialGenerationBrief(withoutPrompt);
  assert.doesNotMatch(briefWithout.ideaText, /PROMPT CRIATIVO ESPECÍFICO/);
  assert.match(briefWithout.ideaText, /Conceito:/);
  assert.match(briefWithout.ideaText, /Direção visual:/);

  // prompt longo (~2k) não estoura o orçamento do ideaText (limite 8000 da rota de geração).
  const [longPrompt] = parseEditorialPack(pack([idea("P-4", { creativePrompt: "BRIEF CRIATIVO. ".repeat(130) })]));
  const briefLong = buildEditorialGenerationBrief(longPrompt);
  assert.ok(briefLong.ideaText.length <= 8000);
  assert.match(briefLong.ideaText, /BRIEF CRIATIVO/);
});

async function api(tenantId = "tenant-a") {
  let seq = 0;
  const workspaceRepository = new InMemoryWorkspaceRepository({ idGenerator: () => ["workspace-a", "workspace-a2", "workspace-b"][seq++] });
  const workspaceA = await workspaceRepository.create({ tenantId: "tenant-a", name: "Vorix Works" });
  const workspaceA2 = await workspaceRepository.create({ tenantId: "tenant-a", name: "Outro" });
  const workspaceB = await workspaceRepository.create({ tenantId: "tenant-b", name: "B" });
  const editorialIdeaRepository = new InMemoryEditorialIdeaRepository();
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.addHook("onRequest", async (request) => {
    request.zunoContext = { principal: { userId: "user-1", tenantId, role: "owner", sessionId: "s", isPlatformAdmin: false } };
  });
  await registerEditorialIdeasRoutes(app, { editorialIdeaRepository, workspaceRepository, now: () => new Date("2026-11-20T15:00:00Z") });
  return { app, workspaceA, workspaceA2, workspaceB, editorialIdeaRepository };
}

test("API: importa só no workspace pedido, reimportar não duplica, outro tenant recebe 404", async () => {
  const ctx = await api();
  const payload = { workspaceId: ctx.workspaceA.id, pack: pack([idea("VWX-001"), idea("VWX-002")]) };
  const first = await ctx.app.inject({ method: "POST", url: "/editorial-ideas/import", payload });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json().data, { created: 2, skipped: 0, total: 2 });
  const again = await ctx.app.inject({ method: "POST", url: "/editorial-ideas/import", payload });
  assert.deepEqual(again.json().data, { created: 0, skipped: 2, total: 2 });
  assert.equal((await ctx.app.inject({ method: "GET", url: `/editorial-ideas?workspaceId=${ctx.workspaceA.id}` })).json().data.length, 2);
  assert.equal((await ctx.app.inject({ method: "GET", url: `/editorial-ideas?workspaceId=${ctx.workspaceA2.id}` })).json().data.length, 0, "outro workspace do mesmo tenant não vê as pautas");
  assert.equal((await ctx.app.inject({ method: "GET", url: `/editorial-ideas?workspaceId=${ctx.workspaceB.id}` })).statusCode, 404);
  assert.equal((await ctx.app.inject({ method: "POST", url: "/editorial-ideas/import", payload: { ...payload, workspaceId: ctx.workspaceB.id } })).statusCode, 404);
  const bad = await ctx.app.inject({ method: "POST", url: "/editorial-ideas/import", payload: { workspaceId: ctx.workspaceA.id, pack: pack([idea("VWX-003", { format: "carousel" })]) } });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error.message, /carrossel sem roteiro/);
  await ctx.app.close();
});

test("API: estado editorial, data e calendário; pauta de outro workspace não muda", async () => {
  const ctx = await api();
  await ctx.app.inject({ method: "POST", url: "/editorial-ideas/import", payload: { workspaceId: ctx.workspaceA.id, pack: pack([idea("VWX-001"), idea("VWX-002", { category: "Sites" }), idea("VWX-003", { format: "video", videoScript: [{ time: "0-2s", visual: "a", text: "b" }, { time: "2-5s", visual: "c", text: "d" }] })]) } });
  const [first, , video] = (await ctx.app.inject({ method: "GET", url: `/editorial-ideas?workspaceId=${ctx.workspaceA.id}` })).json().data;
  const patched = await ctx.app.inject({ method: "PATCH", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA.id, status: "in_production", executionRunId: "run-1" } });
  assert.equal(patched.json().data.status, "in_production");
  assert.equal(patched.json().data.executionRunId, "run-1");
  assert.equal((await ctx.app.inject({ method: "PATCH", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA2.id, status: "archived" } })).statusCode, 404);
  assert.equal((await ctx.app.inject({ method: "PATCH", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA.id, scheduledDate: "2026-13-01" } })).statusCode, 400);
  const calendar = await ctx.app.inject({ method: "POST", url: "/editorial-ideas/calendar", payload: { workspaceId: ctx.workspaceA.id } });
  assert.equal(calendar.statusCode, 200);
  assert.equal(calendar.json().data.startDate, "2026-11-20");
  assert.equal(calendar.json().data.scheduled, 2, "só pautas disponíveis entram no cronograma");
  assert.equal((await ctx.app.inject({ method: "GET", url: `/editorial-ideas/${video.id}/brief?workspaceId=${ctx.workspaceA.id}` })).statusCode, 400);
  const brief = await ctx.app.inject({ method: "GET", url: `/editorial-ideas/${first.id}/brief?workspaceId=${ctx.workspaceA.id}` });
  assert.equal(brief.json().data.name, "Pauta VWX-001");
  await ctx.app.close();
});

test("API: prompt criativo — grava pelo PATCH, chega ao brief, remove com null e respeita o workspace", async () => {
  const ctx = await api();
  await ctx.app.inject({ method: "POST", url: "/editorial-ideas/import", payload: { workspaceId: ctx.workspaceA.id, pack: pack([idea("VWX-001")]) } });
  const [first] = (await ctx.app.inject({ method: "GET", url: `/editorial-ideas?workspaceId=${ctx.workspaceA.id}` })).json().data;
  assert.equal(first.creativePrompt, undefined, "nasce sem prompt");

  // grava
  const saved = await ctx.app.inject({ method: "PATCH", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA.id, creativePrompt: "  Colagem editorial corporativa, sem tela fictícia.  " } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().data.creativePrompt, "Colagem editorial corporativa, sem tela fictícia.");

  // chega ao brief como direção dominante
  const brief = (await ctx.app.inject({ method: "GET", url: `/editorial-ideas/${first.id}/brief?workspaceId=${ctx.workspaceA.id}` })).json().data;
  assert.match(brief.ideaText, /Colagem editorial corporativa/);
  assert.match(brief.ideaText, /PROMPT CRIATIVO ESPECÍFICO/);

  // isolamento: outro workspace não consegue editar
  assert.equal((await ctx.app.inject({ method: "PATCH", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA2.id, creativePrompt: "x" } })).statusCode, 404);

  // excesso recusado
  assert.equal((await ctx.app.inject({ method: "PATCH", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA.id, creativePrompt: "x".repeat(8001) } })).statusCode, 400);

  // remove com null
  const removed = await ctx.app.inject({ method: "PATCH", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA.id, creativePrompt: null } });
  assert.equal(removed.json().data.creativePrompt, undefined);
  const briefAfter = (await ctx.app.inject({ method: "GET", url: `/editorial-ideas/${first.id}/brief?workspaceId=${ctx.workspaceA.id}` })).json().data;
  assert.doesNotMatch(briefAfter.ideaText, /PROMPT CRIATIVO ESPECÍFICO/);
  await ctx.app.close();
});

test("cadastro manual: só título e formato obrigatórios, código automático, padrões derivados", () => {
  assert.equal(nextManualExternalId([]), "IDEIA-001");
  assert.equal(nextManualExternalId(["VWX-001", "IDEIA-002", "IDEIA-010"]), "IDEIA-011");
  const parsed = parseManualEditorialIdea({ title: "  Promoção de fone  ", format: "single_image", referenceImages: ["https://x.test/a.jpg", "https://x.test/a.jpg"] }, "IDEIA-001");
  assert.equal(parsed.title, "Promoção de fone");
  assert.equal(parsed.keyMessage, "Promoção de fone");
  assert.equal(parsed.category, "Geral");
  assert.deepEqual(parsed.referenceImages, ["https://x.test/a.jpg"], "imagem repetida entra uma vez só");
  assert.throws(() => parseManualEditorialIdea({ title: "", format: "single_image" }, "IDEIA-001"), /título/);
  assert.throws(() => parseManualEditorialIdea({ title: "x", format: "carousel" }, "IDEIA-001"), /2 a 10 telas/);
  assert.throws(() => parseManualEditorialIdea({ title: "x", format: "single_image", referenceImages: Array.from({ length: 7 }, (_, i) => `https://x.test/${i}.jpg`) }, "IDEIA-001"), /no máximo 6/);
  assert.throws(() => parseManualEditorialIdea({ title: "x", format: "single_image", referenceImages: ["javascript:alert(1)"] }, "IDEIA-001"), /inválida/);
  assert.ok(parseManualEditorialIdea({ title: "Roteiro", format: "video" }, "IDEIA-001"), "vídeo manual pode entrar sem cenas");
  const brief = buildEditorialGenerationBrief(parsed);
  assert.match(brief.ideaText, /imagens de referência/);
});

test("API: cadastrar, editar e excluir ideia manual — sempre presa ao workspace", async () => {
  const ctx = await api();
  const created = await ctx.app.inject({ method: "POST", url: "/editorial-ideas", payload: { workspaceId: ctx.workspaceA.id, idea: { title: "Casal no altar", format: "carousel", carouselScript: [{ headline: "1", body: "a" }, { headline: "2", body: "b" }] } } });
  assert.equal(created.statusCode, 200);
  const first = created.json().data;
  assert.equal(first.externalId, "IDEIA-001");
  assert.equal(first.status, "available");
  const second = (await ctx.app.inject({ method: "POST", url: "/editorial-ideas", payload: { workspaceId: ctx.workspaceA.id, idea: { title: "Outra", format: "single_image" } } })).json().data;
  assert.equal(second.externalId, "IDEIA-002");
  assert.equal((await ctx.app.inject({ method: "POST", url: "/editorial-ideas", payload: { workspaceId: ctx.workspaceA.id, idea: { title: "", format: "single_image" } } })).statusCode, 400);
  assert.equal((await ctx.app.inject({ method: "POST", url: "/editorial-ideas", payload: { workspaceId: ctx.workspaceB.id, idea: { title: "x", format: "single_image" } } })).statusCode, 404);

  await ctx.app.inject({ method: "PATCH", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA.id, status: "published", scheduledDate: "2026-11-25" } });
  const edited = await ctx.app.inject({ method: "PUT", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA.id, idea: { title: "Casal no altar (v2)", format: "single_image", caption: "Legenda nova" } } });
  assert.equal(edited.statusCode, 200);
  const data = edited.json().data;
  assert.equal(data.title, "Casal no altar (v2)");
  assert.equal(data.carouselScript, undefined, "trocar para imagem única descarta as telas");
  assert.equal(data.externalId, "IDEIA-001");
  assert.equal(data.status, "published", "editar não muda o estado");
  assert.equal(data.scheduledDate, "2026-11-25", "editar não tira do calendário");
  assert.equal((await ctx.app.inject({ method: "PUT", url: `/editorial-ideas/${first.id}`, payload: { workspaceId: ctx.workspaceA2.id, idea: { title: "x", format: "single_image" } } })).statusCode, 404);

  assert.equal((await ctx.app.inject({ method: "DELETE", url: `/editorial-ideas/${first.id}?workspaceId=${ctx.workspaceA2.id}` })).statusCode, 404, "outro workspace não exclui");
  assert.equal((await ctx.app.inject({ method: "DELETE", url: `/editorial-ideas/${first.id}?workspaceId=${ctx.workspaceA.id}` })).statusCode, 200);
  const left = (await ctx.app.inject({ method: "GET", url: `/editorial-ideas?workspaceId=${ctx.workspaceA.id}` })).json().data;
  assert.deepEqual(left.map((item) => item.externalId), ["IDEIA-002"]);
  await ctx.app.close();
});

test("pacote Vorix Works: 200 pautas válidas, distribuição por categoria, roteiros variados e sem preço inventado", async () => {
  const contents = parseEditorialPack(JSON.parse(await readFile(PACK_FILE, "utf8")));
  assert.equal(contents.length, 200);
  const count = (category) => contents.filter((item) => item.category === category).length;
  assert.deepEqual(
    ["Conversações e CRM", "Gravação de reuniões", "Sites e métricas", "Integração da operação", "Personalização", "Conteúdo e IA", "Conversão e posicionamento"].map(count),
    [35, 30, 35, 35, 20, 25, 20],
  );
  assert.equal(new Set(contents.map((item) => item.title)).size, 200, "títulos únicos");
  assert.equal(new Set(contents.map((item) => item.caption)).size, 200, "legendas únicas");
  assert.ok(new Set(contents.map((item) => item.approach)).size >= 10, "abordagens variadas");
  assert.ok(new Set(contents.map((item) => item.narrativeStructure)).size >= 10, "estruturas narrativas variadas");
  for (const item of contents) {
    assert.doesNotMatch(`${item.caption} ${item.concept} ${item.keyMessage}`, /R\$\s?\d|\d+\s?%/, `${item.externalId} sem preço ou percentual inventado`);
    if (item.format === "carousel") assert.ok(item.carouselScript.length >= 4, item.externalId);
    if (item.format === "video") assert.ok(item.videoScript.length >= 3, item.externalId);
  }
  const dates = contents.map((item) => item.suggestedDate).sort();
  assert.equal(new Set(dates).size, 200, "uma data sugerida por pauta");
  assert.ok(dates.every((date) => [1, 2, 3, 4, 5].includes(new Date(`${date}T00:00:00Z`).getUTCDay())), "datas só em dias úteis");
});
