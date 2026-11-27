// ENSAIO DO PILOTO DE VÍDEO NO SERVIDOR (lado do host) — testes A–E sem deploy e sem publicar.
//
// - Codex REAL (usuário vorix-codex, `codex exec`, mesmo comando do piloto) como diretor criativo e revisor.
// - Backend do piloto e render rodam num container TEMPORÁRIO (imagem do video-worker, dist novo montado,
//   2 vCPU / 2 GiB / cpu-shares 256). Nada vai para a fila do banco (o worker de produção não vê nada),
//   nenhuma pauta é criada no Bolsão, nenhum post é criado e nenhuma mensagem é enviada.
// - Pautas sintéticas (B, C) existem só na memória deste ensaio.
//
// Uso (root, no servidor): node pilot-dry-run.mjs <container> <saida> [A,B,C,D,E]
import { spawn } from "node:child_process";
import { chown, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { directorPrompt, directorSchema, redoPrompt, redoSchema, reviewOutcome, reviewPrompt, reviewSchema, targetSecondsFor, toDraft } from "./video-director.mjs";

const [container, outDir, only = "A,B,C,D,E"] = process.argv.slice(2);
if (!container || !outDir) throw new Error("Uso: node pilot-dry-run.mjs <container> <saida> [A,B,C,D,E]");
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
async function produce(name, { selection, materials, workspaceId, settings, sentences = [], transcribedFrom }) {
  const jobDir = await jobDirectory();
  const entry = { brand: selection.brand, idea: selection.idea.title, materials: materials.map(({ thumb, ...rest }) => rest), steps: [] };
  report.tests[name] = entry;
  const projectId = `ensaio-${name.toLowerCase()}-${Date.now().toString(36)}`;
  try {
    const plan = await codex(jobDir, { prompt: directorPrompt({ selection, materials, sentences, targetSeconds: settings.targetDurationSeconds }), schema: directorSchema, images: await images(jobDir, materials) });
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
    entry.steps.push({ step: "Codex: revisão v1", ms: verdict.ms, verdict: verdict.verdict, findings: verdict.findings, revisionRequest: verdict.revisionRequest });
    if (verdict.verdict === "revise" && verdict.revisionRequest) {
      const adjust = await codex(jobDir, { prompt: `${directorPrompt({ selection, materials, sentences, targetSeconds: settings.targetDurationSeconds })}\n\nRASCUNHO ATUAL (JSON do motor): ${JSON.stringify(status.draft)}\nAJUSTE PEDIDO PELA REVISÃO: ${verdict.revisionRequest}\nDevolva o rascunho completo com o ajuste; mantenha o resto igual.`, schema: directorSchema, images: await images(jobDir, materials) });
      entry.steps.push({ step: "Codex: ajuste", ms: adjust.ms });
      rendered = await sampled(() => inContainer({ ...common, versionId: `${name.toLowerCase()}-v2`, parentVersionId: status.versionId, request: verdict.revisionRequest, draft: toDraft(adjust.output) }));
      const next = rendered.result;
      entry.steps.push({ step: "render v2 (ajuste)", ms: rendered.ms, renderMs: next.renderMs, peakMemMiB: rendered.peakMemMiB, status: next.status, gate: next.gate?.status, error: next.error, warnings: next.warnings?.slice(0, 5) });
      await saveOutputs(name, next);
      if (next.status === "ready_for_review") {
        status = next;
        verdict = await review(jobDir, name, selection, status);
        entry.steps.push({ step: "Codex: revisão v2", ms: verdict.ms, verdict: verdict.verdict, findings: verdict.findings });
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
    const selection = await backend({ action: "video_select", workspaceId: CMKV, date: new Date().toISOString().slice(0, 10) });
    if (selection.empty || !selection.materials?.length) throw new Error(`A: sem pauta/material (${JSON.stringify(selection).slice(0, 300)})`);
    a = await produce("A", { selection, materials: selection.materials, workspaceId: CMKV, settings: settings(targetSecondsFor(selection.idea)) });
    a.selection = selection;
    report.tests.A.calendar = selection.calendar;
    if (a.draft) {
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
    say("C: gravação bruta com fala → transcrição (worker) → Codex escolhe as frases → Reels ~30 s");
    const idea = synthetic(RAA, { externalId: "ENSAIO-VIDEO-RAA", title: "Lista de presentes sem taxa", keyMessage: "Os noivos recebem os presentes no Pix, sem taxa, e montam o site em um minuto.", cta: "Crie o seu site", caption: "Presentes no Pix, sem taxa. #casamento" });
    const selection = { brand: "Rumo ao Altar", idea, request: `Pauta: ${idea.title}\nMensagem: ${idea.keyMessage}\nChamada: ${idea.cta}\nLegenda: ${idea.caption}` };
    const materials = [{ id: "M1", objectKey: "local/raw-recording.mp4", kind: "video", role: "footage", label: "gravação bruta com fala (tela do site + narração)" }];
    const projectId = `ensaio-c-${Date.now().toString(36)}`;
    const transcribed = await sampled(() => inContainer({ action: "render", projectId, workspaceId: RAA, ideaId: idea.id, title: idea.title, materials, settings: settings(30), request: selection.request, versionId: "c-transcricao" }));
    report.tests.C = { steps: [{ step: "transcrição (worker, faster-whisper)", ms: transcribed.ms, peakMemMiB: transcribed.peakMemMiB, stage: transcribed.result.stage, sentences: transcribed.result.sentences?.length }] };
    if (transcribed.result.stage !== "awaiting_draft") throw new Error(`C: transcrição não concluída (${transcribed.result.error ?? transcribed.result.status})`);
    const steps = report.tests.C.steps;
    await produce("C", { selection, materials, workspaceId: RAA, settings: settings(30), sentences: transcribed.result.sentences, transcribedFrom: { projectId } });
    report.tests.C.steps.unshift(...steps);
  }
  if (tests.has("D") && a?.status?.status === "ready_for_review") {
    say("D: refação — motivo simulado de reprovação no WhatsApp, só o que foi criticado muda");
    const jobDir = await jobDirectory();
    try {
      const job = { reason: "A abertura ficou fraca: troque o texto do gancho por uma pergunta mais curiosa", reasons: ["A abertura ficou fraca: troque o texto do gancho por uma pergunta mais curiosa"], idea: a.selection.idea };
      const sheet = join(jobDir, "reprovado.jpg");
      await writeFile(sheet, Buffer.from(a.status.output.sheet, "base64"), { mode: 0o644 });
      const redo = await codex(jobDir, { prompt: redoPrompt({ job, previousDraft: a.status.draft, materials: a.selection.materials.map(({ thumb, ...m }) => m) }), schema: redoSchema, images: [sheet] });
      const rendered = await sampled(() => inContainer({ action: "render", projectId: a.projectId, workspaceId: CMKV, ideaId: a.selection.idea.id, materials: a.selection.materials, settings: settings(20), request: job.reason, versionId: "d-refacao", parentVersionId: a.status.versionId, draft: toDraft(redo.output.draft) }));
      const status = rendered.result;
      await saveOutputs("D", status);
      const verdict = status.status === "ready_for_review" ? await review(jobDir, "D", a.selection, status) : { verdict: "n/a" };
      const changed = status.plan ? status.plan.clips.map((clip, i) => JSON.stringify(clip) !== JSON.stringify(a.status.plan.clips[i]) ? i + 1 : null).filter(Boolean) : [];
      report.tests.D = { reason: job.reason, changeSummary: redo.output.changeSummary, codexMs: redo.ms, renderMs: status.renderMs, firstRenderMs: a.status.renderMs, ms: rendered.ms, peakMemMiB: rendered.peakMemMiB, status: status.status, error: status.error, issues: status.warnings?.slice(0, 6), scenesChanged: changed, review: verdict.verdict, findings: verdict.findings, file: status.output?.file, sha256: status.output?.sha256 };
      if (status.status === "ready_for_review") a.redo = status;
    } finally {
      await rm(jobDir, { recursive: true, force: true });
    }
  }
  if (tests.has("E") && a?.status?.status === "ready_for_review" && a.verdict?.verdict === "approve") {
    say("E: preparação da aprovação (sem publicar, sem enviar): hash, validação do Reels nas contas, texto do WhatsApp");
    const final = a.redo ?? a.status;
    const media = [{ url: `https://storage.invalid/assets/tenant-vorix/${CMKV}/ensaio-video-${final.output.sha256.slice(0, 20)}.mp4`, kind: "video", width: 1080, height: 1920, mimeType: "video/mp4", sizeBytes: final.output.sizeBytes, durationSec: final.plan.durationSeconds, hasAudio: true }];
    const validation = await inContainer({ action: "social_validate", workspaceId: CMKV, accounts: CMKV_ACCOUNTS, caption: a.selection.idea.caption, media }, 300000);
    const preview = await inContainer({ action: "approval_preview", file: final.output.file, brand: a.selection.brand, caption: a.selection.idea.caption, when: "hoje às 20:00", networks: validation.checks.map((check) => check.network) }, 120000);
    report.tests.E = { versionId: final.versionId, sha256: final.output.sha256, review: a.redo ? report.tests.D.review : a.verdict?.verdict, validation, approval: preview, published: false, sent: false };
  }
} catch (error) {
  report.error = error.message.slice(0, 1500);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(outDir, "relatorio.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ done: true, error: report.error }));
}
