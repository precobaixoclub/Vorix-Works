// ENSAIO DO PILOTO DE VÍDEO NO SERVIDOR (lado do host) — testes A–E sem deploy e sem publicar.
//
// - Codex REAL (usuário vorix-codex, `codex exec`, mesmo comando do piloto) como diretor criativo e revisor.
// - Backend do piloto e render rodam num container TEMPORÁRIO (imagem do video-worker, dist novo montado,
//   2 vCPU / 2 GiB / cpu-shares 256). Nada vai para a fila do banco (o worker de produção não vê nada),
//   nenhuma pauta é criada no Bolsão, nenhum post é criado e nenhuma mensagem é enviada.
// - Pautas sintéticas (B, C) existem só na memória deste ensaio.
//
// Uso (root, no servidor): node pilot-dry-run.mjs <container> <saida> [A,B,C,D,E] [pauta CMKV] [nota de direção CMKV]
import { spawn } from "node:child_process";
import { chown, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { directorPrompt, directorSchema, redoPrompt, redoSchema, reviewOutcome, reviewPrompt, reviewSchema, scopedReason, targetSecondsFor, toDraft } from "./video-director.mjs";

const [container, outDir, only = "A,B,C,D,E", cmkvIdea, cmkvDirection] = process.argv.slice(2);
if (!container || !outDir) throw new Error("Uso: node pilot-dry-run.mjs <container> <saida> [A,B,C,D,E]");
await mkdir(outDir, { recursive: true });
const tests = new Set(only.split(","));
const here = new URL("./", import.meta.url);
const backendSource = await readFile(new URL("codex-social-backend.mjs", here), "utf8");
const containerSource = await readFile(new URL("pilot-dry-run-container.mjs", here), "utf8");
const agentHome = "/var/lib/vorix-codex";
const agent = ["-u", "vorix-codex", "--", "env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", `HOME=${agentHome}`, `CODEX_HOME=${agentHome}/.codex`, "/opt/vorix-editorial/tools/node_modules/.bin/codex"];
const CMKV = "workspace-cee-prelaunch-mv47cmfh";
const VORIX = "workspace-mscc9pi2-jkvwbo";
const RAA = "workspace-mwmumsxd-fmvh3h";
const CMKV_ACCOUNTS = ["soc-mwkwg3lc-zj3g4xyk", "soc-mwmuj7ud-3py2gdyo"];
const report = { startedAt: new Date().toISOString(), tests: {} };
const say = (line) => console.error(`[ensaio] ${new Date().toISOString().slice(11, 19)} ${line}`);

function run(program, args, stdin, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`tempo limite: ${program} ${args.slice(0, 3).join(" ")}`)); }, timeout);
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    child.stdin.on("error", () => undefined);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString("utf8").trim());
      else reject(new Error(Buffer.concat(err).toString("utf8").trim().split("\n").slice(-6).join("\n") || `código ${code}`));
    });
    child.stdin.end(stdin);
  });
}

/** Amostra CPU/memória do container temporário enquanto uma etapa roda. */
async function sampled(fn) {
  let peakMem = 0;
  let peakCpu = 0;
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      try {
        const line = await run("docker", ["stats", "--no-stream", "--format", "{{.CPUPerc}};{{.MemUsage}}", container], "", 15000);
        const [cpu, mem] = line.split(";");
        peakCpu = Math.max(peakCpu, parseFloat(cpu));
        const [value, unit] = mem.split("/")[0].trim().match(/([\d.]+)\s*([KMG]i?B)/).slice(1);
        peakMem = Math.max(peakMem, Number(value) * ({ KiB: 1 / 1024, MiB: 1, GiB: 1024, kB: 1 / 1000, MB: 1, GB: 1000 }[unit] ?? 1));
      } catch { /* amostra perdida */ }
      await new Promise((done) => setTimeout(done, 1500));
    }
  })();
  const started = Date.now();
  try {
    const result = await fn();
    return { result, ms: Date.now() - started, peakMemMiB: Math.round(peakMem), peakCpuPercent: Math.round(peakCpu) };
  } finally {
    stop = true;
    await loop;
  }
}

/** Backend do piloto (o MESMO arquivo), no container temporário. Pauta sintética só em memória. */
async function backend(request, syntheticIdea) {
  let source = backendSource;
  if (syntheticIdea) {
    const anchor = "const c = buildApiContainer(loadApiConfig());";
    if (!source.includes(anchor)) throw new Error("ponto de injeção do ensaio não encontrado");
    source = source.replace(anchor, `${anchor}\n{ const original = c.editorialIdeaRepository.listByWorkspace.bind(c.editorialIdeaRepository); c.editorialIdeaRepository.listByWorkspace = async (ws) => [...await original(ws), ${JSON.stringify(syntheticIdea)}]; }`);
  }
  const output = await run("docker", ["exec", "-i", "-w", "/app", container, "node", "--input-type=module"], `const request = ${JSON.stringify(request)};\n${source}`, 300000);
  return JSON.parse(output.split("\n").at(-1));
}

async function inContainer(request, timeout = 20 * 60000) {
  const output = await run("docker", ["exec", "-i", "-w", "/app", container, "node", "--input-type=module"], `const request = ${JSON.stringify(request)};\n${containerSource}`, timeout);
  return JSON.parse(output.split("\n").at(-1));
}

async function codex(jobDir, { prompt, schema, images = [] }) {
  const schemaFile = join(jobDir, `schema-${Date.now()}.json`);
  await writeFile(schemaFile, JSON.stringify(schema), { mode: 0o644 });
  const started = Date.now();
  const events = await run("runuser", [...agent, "--ask-for-approval", "never", "exec", "--model", "gpt-6.2-sol", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check",
    "--cd", jobDir, "--json", "--output-schema", schemaFile, ...images.flatMap((path) => ["--image", path]), "-"], `${prompt}\nNão gere imagens e não execute comandos.`, 300000);
  const last = events.split("\n").flatMap((line) => { try { const e = JSON.parse(line); return e.type === "item.completed" && e.item?.type === "agent_message" ? [e.item.text] : []; } catch { return []; } }).at(-1);
  if (!last) throw new Error("Codex sem resposta");
  return { output: JSON.parse(last), ms: Date.now() - started };
}

async function jobDirectory() {
  const dir = await mkdtemp(join(agentHome, "jobs", "ensaio-video-"));
  const user = (await readFile("/etc/passwd", "utf8")).split("\n").find((line) => line.startsWith("vorix-codex:"))?.split(":");
  await chown(dir, Number(user[2]), Number(user[3]));
  return dir;
}

async function images(jobDir, materials) {
  const files = [];
  for (const [index, material] of materials.entries()) {
    if (!material.thumb) continue;
    const file = join(jobDir, `material-${index + 1}.jpg`);
    await writeFile(file, Buffer.from(material.thumb, "base64"), { mode: 0o644 });
    files.push(file);
  }
  return files;
}

async function saveOutputs(name, status) {
  const dir = join(outDir, name);
  await mkdir(dir, { recursive: true });
  if (status.output?.sheet) await writeFile(join(dir, `prancha-v${status.number}.jpg`), Buffer.from(status.output.sheet, "base64"));
  await writeFile(join(dir, `status-v${status.number}.json`), JSON.stringify({ ...status, output: status.output ? { ...status.output, sheet: undefined } : undefined }, null, 2));
}

async function review(jobDir, name, selection, status) {
  if (!status.output?.sheet || !status.plan) return { verdict: "inconclusive", findings: ["sem prancha"] };
  const sheet = join(jobDir, `prancha-${status.number}.jpg`);
  await writeFile(sheet, Buffer.from(status.output.sheet, "base64"), { mode: 0o644 });
  try {
    const { output, ms } = await codex(jobDir, { prompt: reviewPrompt({ selection, plan: status.plan, gate: status.gate }), schema: reviewSchema, images: [sheet] });
    return { ...reviewOutcome(output), raw: output, ms };
  } catch (error) {
    return { verdict: "inconclusive", findings: [error.message.slice(0, 200)] };
  }
}

/** Mesma lógica do orquestrador: plano → render → revisão (até 1 ajuste). */
async function produce(name, { selection, materials, workspaceId, settings, sentences = [], transcribedFrom, initialCorrection }) {
  const jobDir = await jobDirectory();
  const entry = { brand: selection.brand, idea: selection.idea.title, materials: materials.map(({ thumb, ...rest }) => rest), steps: [] };
  report.tests[name] = entry;
  const projectId = `ensaio-${name.toLowerCase()}-${Date.now().toString(36)}`;
  try {
    const plan = await codex(jobDir, { prompt: directorPrompt({ selection, materials, sentences, targetSeconds: settings.targetDurationSeconds, correction: initialCorrection }), schema: directorSchema, images: await images(jobDir, materials) });
    entry.steps.push({ step: "Codex: plano", ms: plan.ms });
    entry.concept = plan.output.concept;
    const draft = toDraft(plan.output);
    await mkdir(join(outDir, name), { recursive: true });
    await writeFile(join(outDir, name, "rascunho-codex.json"), JSON.stringify(plan.output, null, 2));
    const common = { action: "render", projectId: transcribedFrom?.projectId ?? projectId, workspaceId, ideaId: selection.idea.id, title: selection.idea.title, materials, settings, request: selection.request };
    let rendered = await sampled(() => inContainer({ ...common, versionId: `${name.toLowerCase()}-v1`, draft }));
    let status = rendered.result;
    entry.steps.push({ step: "render v1", ms: rendered.ms, renderMs: status.renderMs, peakMemMiB: rendered.peakMemMiB, peakCpuPercent: rendered.peakCpuPercent, status: status.status, gate: status.gate?.status, failures: status.gate?.failures, error: status.error });
    await saveOutputs(name, status);
    if (status.status === "failed" && /recusado|montado|frase|material/i.test(status.error ?? "")) {
      // Mesma regra do orquestrador: o motivo da recusa volta ao Codex, uma correção.
      const fix = await codex(jobDir, { prompt: directorPrompt({ selection, materials, sentences, targetSeconds: settings.targetDurationSeconds, correction: status.error }), schema: directorSchema, images: await images(jobDir, materials) });
      entry.steps.push({ step: "Codex: correção do plano", ms: fix.ms, motivo: status.error });
      rendered = await sampled(() => inContainer({ ...common, versionId: `${name.toLowerCase()}-v1b`, draft: toDraft(fix.output) }));
      status = rendered.result;
      entry.steps.push({ step: "render v1 (corrigido)", ms: rendered.ms, renderMs: status.renderMs, peakMemMiB: rendered.peakMemMiB, peakCpuPercent: rendered.peakCpuPercent, status: status.status, gate: status.gate?.status, failures: status.gate?.failures, error: status.error });
      await saveOutputs(name, status);
    }
    if (status.status !== "ready_for_review") return { status, entry, projectId: common.projectId };
    let verdict = await review(jobDir, name, selection, status);
    entry.steps.push({ step: "Codex: revisão v1", ms: verdict.ms, verdict: verdict.verdict, findings: verdict.findings, revisionRequest: verdict.revisionRequest, raw: verdict.raw });
    if (verdict.verdict === "revise" && verdict.revisionRequest) {
      // Mesma regra do orquestrador: escopo decidido e registrado; recusa por escopo volta uma vez ao Codex.
      const scoped = scopedReason({ reason: verdict.revisionRequest, scope: verdict.scope, from: "revisao" });
      entry.steps.push({ step: "escopo do ajuste", ...scoped.trace });
      const base = status;
      let next;
      let correction;
      for (let round = 0; round < 2; round += 1) {
        const adjust = await codex(jobDir, { prompt: `${directorPrompt({ selection, materials, sentences, targetSeconds: settings.targetDurationSeconds })}\n\nRASCUNHO ATUAL (JSON do motor): ${JSON.stringify(base.draft)}\nAJUSTE PEDIDO PELA REVISÃO (${scoped.mode}): ${verdict.revisionRequest}\n${scoped.mode === "abrangente" ? "Ajuste abrangente: pode reorganizar ritmo, ordem e composição." : "Ajuste pontual: mude só o que foi pedido e mantenha o resto IDÊNTICO."}${correction ? `\nCORREÇÃO: ${correction}` : ""}\nDevolva o rascunho completo.`, schema: directorSchema, images: await images(jobDir, materials) });
        entry.steps.push({ step: round ? "Codex: ajuste (correção do escopo)" : "Codex: ajuste", ms: adjust.ms });
        rendered = await sampled(() => inContainer({ ...common, versionId: `${name.toLowerCase()}-v2${round ? "b" : ""}`, parentVersionId: base.versionId, request: scoped.reason, draft: toDraft(adjust.output) }));
        next = rendered.result;
        entry.steps.push({ step: `render v2${round ? "b" : ""} (ajuste)`, ms: rendered.ms, renderMs: next.renderMs, peakMemMiB: rendered.peakMemMiB, peakCpuPercent: rendered.peakCpuPercent, status: next.status, gate: next.gate?.status, error: next.error, scope: next.warnings?.find((w) => w.startsWith("refação")) });
        await saveOutputs(name, next);
        if (next.status === "ready_for_review" || !/não pedia/.test(next.error ?? "")) break;
        correction = `a versão anterior foi recusada: ${next.error}. Mantenha IDÊNTICO tudo o que o pedido não citou.`;
      }
      if (next.status === "ready_for_review") {
        status = next;
        verdict = await review(jobDir, name, selection, status);
        entry.steps.push({ step: "Codex: revisão v2", ms: verdict.ms, verdict: verdict.verdict, findings: verdict.findings, revisionRequest: verdict.revisionRequest, raw: verdict.raw });
      }
    }
    entry.final = { versionId: status.versionId, file: status.output?.file, sha256: status.output?.sha256, sizeBytes: status.output?.sizeBytes, durationSeconds: status.plan?.durationSeconds, strategy: status.plan?.strategy, layouts: status.plan?.clips.map((c) => c.layout), music: status.plan?.music, review: verdict.verdict };
    return { status, verdict, entry, projectId: common.projectId, draft: status.draft };
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

/** "Antes": o mesmo rascunho só com os recursos do motor antigo (tela cheia, transições e textos antigos). */
function legacyDraft(draft) {
  const motion = { punch_in: "push_in", drift: "pan_left" };
  const transition = (t) => (["cut", "cross_dissolve", "dip_to_black", "push_left", "push_up", "zoom_in"].includes(t) ? t : "cross_dissolve");
  return { ...draft, scenes: draft.scenes.map(({ layout, ...scene }) => ({ ...scene, motion: motion[scene.motion] ?? scene.motion, transitionIn: transition(scene.transitionIn), texts: scene.texts.map((t) => ({ ...t, animation: t.animation === "kinetic" ? "fade" : t.animation, position: t.position === "center" && scene.materialId !== "CARD" ? "top" : t.position })) })) };
}

const settings = (target) => ({ targetDurationSeconds: target, editing: "dinamico", transitions: "moderadas", captions: true, music: true });
const synthetic = (workspaceId, fields) => ({ id: `ensaio-${fields.externalId}`, tenantId: "tenant-vorix", workspaceId, format: "video", status: "available", referenceImages: [], scheduledDate: null, createdAt: "2026-11-26T00:00:00.000Z", updatedAt: "2026-11-26T00:00:00.000Z", category: "Ensaio", approach: "Demonstração", ...fields });

try {
  let a;
  if (tests.has("A") || tests.has("D") || tests.has("E")) {
    say("A: pauta real de vídeo da CMKV (Bolsão) → seleção pelo backend do piloto");
    const selection = await backend({ action: "video_select", workspaceId: CMKV, date: new Date().toISOString().slice(0, 10), onlyIdea: cmkvIdea });
    if (selection.empty || !selection.materials?.length) throw new Error(`A: sem pauta/material (${JSON.stringify(selection).slice(0, 300)})`);
    if (cmkvIdea === "CMKV-QUIZ-RECORTE" && selection.idea.title !== "De qual camiseta é esse traço?") throw new Error("A: o título da pauta não corresponde ao quiz");
    a = await produce("A", { selection, materials: selection.materials, workspaceId: CMKV, settings: settings(targetSecondsFor(selection.idea)), initialCorrection: cmkvDirection });
    a.selection = selection;
    report.tests.A.calendar = selection.calendar;
    if (a.draft && !cmkvIdea) {
      say("A: versão 'antes' (mesmo rascunho, recursos do motor antigo)");
      const before = await sampled(() => inContainer({ action: "render", projectId: `ensaio-antes-${Date.now().toString(36)}`, workspaceId: CMKV, ideaId: selection.idea.id, title: "antes", materials: selection.materials, settings: settings(20), request: selection.request, versionId: "antes-v1", draft: legacyDraft(a.draft) }));
      report.tests.A.before = { ms: before.ms, renderMs: before.result.renderMs, status: before.result.status, file: before.result.output?.file, durationSeconds: before.result.plan?.durationSeconds };
      await saveOutputs("A-antes", before.result);
    }
  }
  if (tests.has("B")) {
    say("B: Vorix — pauta sintética (só em memória) com capturas reais da Biblioteca");
    const idea = synthetic(VORIX, { externalId: "ENSAIO-VIDEO-VORIX", title: "Seu atendimento no WhatsApp sem perder o histórico", keyMessage: "Quando o cliente muda de atendente, a conversa e o contexto continuam no mesmo lugar.", cta: "Conheça a Vorix", visualDirection: "Reels 9:16 com capturas reais do atendimento pelo WhatsApp e do histórico da conversa.", caption: "Troca de atendente sem recomeçar a conversa. #atendimento" });
    const selection = await backend({ action: "video_select", workspaceId: VORIX, date: new Date().toISOString().slice(0, 10), onlyIdea: idea.id }, idea);
    if (!selection.materials?.length) throw new Error(`B: sem capturas (${JSON.stringify(selection).slice(0, 300)})`);
    await produce("B", { selection, materials: selection.materials, workspaceId: VORIX, settings: settings(20) });
  }
  if (tests.has("C")) {
    say("C: gravação bruta com fala → transcrição (worker) → Codex escolhe as frases → Reels focado no Pix");
    const idea = synthetic(RAA, { externalId: "ENSAIO-VIDEO-RAA", title: "Lista de presentes sem taxa", keyMessage: "Os noivos recebem os presentes no Pix, sem taxa.", cta: "Crie o seu site", caption: "Presentes no Pix, sem taxa. #casamento" });
    const selection = { brand: "Rumo ao Altar", idea, request: `Pauta: ${idea.title}\nMensagem: ${idea.keyMessage}\nChamada: ${idea.cta}\nLegenda: ${idea.caption}` };
    const materials = [{ id: "M1", objectKey: "local/raw-recording.mp4", kind: "video", role: "screen_recording", label: "tela do site com narração; prancha da mídia completa, quadros em sequência" }];
    const direction = "Foque no Pix. Guarde a pergunta sobre a taxa e a resposta da fala, na ordem. A interface bruta não acompanha a narração quando ela passa a RSVP, QR Code e preços: omita essas frases. No trecho falado sobre receber no Pix (aproximadamente 23–31 s da fonte), abra um detalhe estável do cartão Lista de presentes com region {x:0.48,y:0.25,width:0.42,height:0.32,start:null}; esse retângulo foi conferido durante a rolagem e inclui bordas, título, ícone e a frase do Pix. Antes dele, a pergunta entra com voz sobre uma visão geral. Feche com logo e «Crie o seu site», CTA sem animação e com tempo de leitura.";
    const videoSettings = settings(16);
    const projectId = `ensaio-c-${Date.now().toString(36)}`;
    const transcribed = await sampled(() => inContainer({ action: "render", projectId, workspaceId: RAA, ideaId: idea.id, title: idea.title, materials, settings: videoSettings, request: selection.request, versionId: "c-transcricao" }));
    report.tests.C = { steps: [{ step: "transcrição e prancha de origem (worker, faster-whisper)", ms: transcribed.ms, peakMemMiB: transcribed.peakMemMiB, peakCpuPercent: transcribed.peakCpuPercent, stage: transcribed.result.stage, sentences: transcribed.result.sentences?.length }] };
    if (transcribed.result.stage !== "awaiting_draft") throw new Error(`C: transcrição não concluída (${transcribed.result.error ?? transcribed.result.status})`);
    if (!transcribed.result.sourcePreviews?.M1) throw new Error("C: o worker não produziu a prancha do material narrado");
    materials[0].thumb = transcribed.result.sourcePreviews.M1;
    const steps = report.tests.C.steps;
    await produce("C", { selection, materials, workspaceId: RAA, settings: videoSettings, sentences: transcribed.result.sentences, transcribedFrom: { projectId }, initialCorrection: direction });
    report.tests.C.steps.unshift(...steps);
  }
  /** Refação pelo motivo do cliente (WhatsApp simulado): mesmo fluxo do orquestrador (escopo + 1 correção). */
  async function redoCase(key, reason, versionSuffix) {
    const jobDir = await jobDirectory();
    try {
      const job = { reason, reasons: [reason], idea: a.selection.idea };
      const sheet = join(jobDir, "reprovado.jpg");
      await writeFile(sheet, Buffer.from(a.status.output.sheet, "base64"), { mode: 0o644 });
      const materials = a.selection.materials.map(({ thumb, ...m }) => m);
      const steps = [];
      let output;
      let status;
      let scoped;
      let correction;
      let rendered;
      for (let round = 0; round < 2; round += 1) {
        const redo = await codex(jobDir, { prompt: `${redoPrompt({ job, previousDraft: a.status.draft, materials })}${correction ? `\nCORREÇÃO: ${correction}` : ""}`, schema: redoSchema, images: [sheet] });
        output = redo.output;
        scoped = scopedReason({ reason, scope: output.scope, justification: output.scopeJustification, from: "cliente" });
        steps.push({ step: round ? "Codex: refação (correção do escopo)" : "Codex: refação", ms: redo.ms, scope: scoped.trace });
        rendered = await sampled(() => inContainer({ action: "render", projectId: a.projectId, workspaceId: CMKV, ideaId: a.selection.idea.id, materials: a.selection.materials, settings: settings(targetSecondsFor(a.selection.idea)), request: scoped.reason, versionId: `${versionSuffix}${round ? "b" : ""}`, parentVersionId: a.status.versionId, draft: toDraft(output.draft) }));
        status = rendered.result;
        steps.push({ step: "render", ms: rendered.ms, renderMs: status.renderMs, peakMemMiB: rendered.peakMemMiB, status: status.status, error: status.error, scope: status.warnings?.find((w) => w.startsWith("refação")) });
        await saveOutputs(key, status);
        if (status.status === "ready_for_review" || !/não pedia/.test(status.error ?? "")) break;
        correction = `a versão anterior foi recusada: ${status.error}. Mantenha IDÊNTICO tudo o que o motivo não citou.`;
      }
      const verdict = status.status === "ready_for_review" ? await review(jobDir, key, a.selection, status) : { verdict: "n/a" };
      const before = a.status.plan.clips;
      const changed = status.plan ? status.plan.clips.map((clip, i) => JSON.stringify(clip) !== JSON.stringify(before[i]) ? i + 1 : null).filter(Boolean) : [];
      report.tests[key] = { reason, applied: scoped.mode, scopeTrace: scoped.trace, changeSummary: output.changeSummary, steps, renderMs: status.renderMs, firstRenderMs: a.status.renderMs, status: status.status, error: status.error,
        scenesBefore: before.length, scenesAfter: status.plan?.clips.length, scenesChanged: changed, review: verdict.verdict, findings: verdict.findings, file: status.output?.file, sha256: status.output?.sha256 };
      return status.status === "ready_for_review" ? { status, verdict } : undefined;
    } finally {
      await rm(jobDir, { recursive: true, force: true });
    }
  }
  if (tests.has("D") && a?.status?.status === "ready_for_review") {
    say("D1: refação PONTUAL — o cliente critica só o texto da abertura");
    const d1 = await redoCase("D1", "A abertura ficou fraca: troque o texto do gancho por uma pergunta mais curiosa", "d1-refacao");
    say("D2: refação ABRANGENTE — o cliente critica o ritmo do vídeo inteiro");
    const d2 = await redoCase("D2", "O vídeo ficou lento e com cara de apresentação de fotos. Quero mais ritmo e mais variedade de enquadramento.", "d2-refacao");
    const best = [d2, d1].find((item) => item?.verdict?.verdict === "approve") ?? d1 ?? d2;
    if (best) { a.redo = best.status; a.redoVerdict = best.verdict.verdict; }
  }
  if (tests.has("E") && (a?.redo ?? a?.status)?.status === "ready_for_review") {
    say("E: preparação da aprovação (sem publicar, sem enviar): hash, validação do Reels nas contas, texto do WhatsApp");
    const final = a.redo ?? a.status;
    // Trava do hash: o arquivo que vai ao WhatsApp e à publicação é o mesmo revisado (o backend recusa outro).
    const media = [{ url: `https://storage.invalid/assets/tenant-vorix/${CMKV}/ensaio-video-${final.output.sha256.slice(0, 20)}.mp4`, kind: "video", width: 1080, height: 1920, mimeType: "video/mp4", sizeBytes: final.output.sizeBytes, durationSec: final.plan.durationSeconds, hasAudio: true }];
    const validation = await inContainer({ action: "social_validate", workspaceId: CMKV, accounts: CMKV_ACCOUNTS, caption: a.selection.idea.caption, media }, 300000);
    const preview = await inContainer({ action: "approval_preview", file: final.output.file, brand: a.selection.brand, caption: a.selection.idea.caption, when: "hoje às 20:00", networks: validation.checks.map((check) => check.network) }, 120000);
    const approvalRequired = await inContainer({ action: "approval_rule", workspaces: [CMKV, VORIX, RAA] }, 120000);
    const reviewVerdict = a.redo ? a.redoVerdict : a.verdict?.verdict;
    // No piloto real só segue para o agendamento com a revisão editorial aprovada; senão vai para revisão manual.
    report.tests.E = { versionId: final.versionId, sha256: final.output.sha256, review: reviewVerdict, pilotWouldSchedule: reviewVerdict === "approve", manualReviewInstead: reviewVerdict !== "approve", approvalRequired, validation, approval: preview, published: false, sent: false };
  }
} catch (error) {
  report.error = error.message.slice(0, 1500);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(outDir, "relatorio.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ done: true, error: report.error }));
}
